import numpy as np
import pandas as pd

from hfgi_pro import config
from hfgi_pro.backtest import run_backtest
from hfgi_pro.engine import HFGIEngine


def _fake_ohlcv(n, seed, start_price=100.0, index=None):
    rng = np.random.default_rng(seed)
    steps = rng.normal(loc=0.0003, scale=0.015, size=n)
    close = start_price * np.cumprod(1 + steps)
    if index is None:
        index = pd.bdate_range("2021-01-04", periods=n)
    return pd.DataFrame(
        {
            "Open": close,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": rng.integers(1_000_000, 5_000_000, size=n).astype(float),
        },
        index=index,
    )


def _fake_price_data(n=400):
    index = pd.bdate_range("2021-01-04", periods=n)
    return {
        config.PRIMARY_TICKER: _fake_ohlcv(n, seed=1, index=index),
        config.ADR_REFERENCE_TICKER: _fake_ohlcv(n, seed=2, index=index),
        "SMH": _fake_ohlcv(n, seed=3, index=index),
        "SOXX": _fake_ohlcv(n, seed=4, index=index),
        config.MARKET_VOLATILITY_TICKER: _fake_ohlcv(n, seed=5, start_price=20.0, index=index),
    }


def test_engine_output_has_expected_columns_and_bounded_hfgi():
    price_data = _fake_price_data()
    engine = HFGIEngine()
    result = engine.compute(price_data)

    expected_cols = {
        "HFGI", "State",
        "PriceMomentum_Score", "RSI_Score", "MACD_Score", "Volume_Score",
        "ATR_Score", "RelativeStrength_Score", "Drawdown_Score", "ADRPremium_Score",
        "MarketVolatility_Score", "Close", "ADR_Premium_Raw", "RelativeStrength_Raw",
        "VIX_Close", "LookbackDays",
    }
    assert expected_cols.issubset(result.columns)

    hfgi = result["HFGI"].dropna()
    assert (hfgi >= 0).all() and (hfgi <= 100).all()
    assert result["State"].dropna().isin(list(config.STATE_THRESHOLDS.keys()) + ["Unknown"]).all()
    assert result["MarketVolatility_Score"].dropna().between(0, 100).all()
    assert result["RSI_Score"].dropna().between(0, 100).all()


def test_engine_rsi_score_is_nan_until_enough_history_like_other_subscores():
    """RSI_Score should be percentile-ranked like the rest, so it needs the
    same minimum history before producing a value, not RSI's raw 0-100
    reading available from day one."""
    price_data = _fake_price_data(n=400)
    engine = HFGIEngine()
    result = engine.compute(price_data)
    assert result["RSI_Score"].iloc[:19].isna().all()


def test_engine_lookback_days_grows_with_history_and_caps_at_window():
    price_data = _fake_price_data(n=400)
    engine = HFGIEngine(rolling_window=100)
    result = engine.compute(price_data)
    lookback = result["LookbackDays"].dropna()
    assert lookback.iloc[0] <= lookback.iloc[-1]
    assert lookback.max() <= 100


def test_engine_hfgi_survives_missing_reference_ticker():
    """A missing ADR reference (e.g. analyzing an ETF with no ADR pair)
    should not blank out the whole HFGI via a single all-NaN sub-score."""
    price_data = _fake_price_data()
    del price_data[config.ADR_REFERENCE_TICKER]

    engine = HFGIEngine()
    result = engine.compute(price_data)

    assert result["ADRPremium_Score"].isna().all()
    hfgi = result["HFGI"].dropna()
    assert len(hfgi) > 0
    assert (hfgi >= 0).all() and (hfgi <= 100).all()


def test_engine_relative_strength_excludes_subject_from_its_own_benchmark():
    """When the subject is itself one of the sector benchmark tickers (e.g.
    SOXX, added to WATCHLIST as a sector-wide reading), comparing it to a
    benchmark blend that includes itself dilutes Relative Strength toward
    zero instead of reflecting genuine relative performance."""
    price_data = _fake_price_data()
    engine = HFGIEngine()

    _, _, extras_as_subject = engine.compute_subscores(price_data, subject="SOXX")
    # Recompute what the (broken) self-inclusive benchmark would have been:
    # SOXX's ROC minus the average of (SMH, SOXX) ROC.
    soxx_roc = engine.compute_indicators(price_data, subject="SOXX")["ROC"]
    smh_roc = price_data["SMH"]["Close"].pct_change(engine.momentum_window)
    self_inclusive_benchmark = pd.concat([smh_roc, soxx_roc], axis=1).mean(axis=1)
    self_inclusive_relative_strength = soxx_roc - self_inclusive_benchmark

    # The fixed version should differ from (and generally have larger
    # magnitude than) the self-inclusive one, since it's benchmarked only
    # against SMH.
    diff = (extras_as_subject["relative_strength_raw"] - self_inclusive_relative_strength).dropna()
    assert (diff.abs() > 1e-9).any()


def test_engine_hfgi_survives_missing_vix():
    """No ^VIX ticker supplied should degrade gracefully, same as ADR Premium."""
    price_data = _fake_price_data()
    del price_data[config.MARKET_VOLATILITY_TICKER]

    engine = HFGIEngine()
    result = engine.compute(price_data)

    assert result["MarketVolatility_Score"].isna().all()
    hfgi = result["HFGI"].dropna()
    assert len(hfgi) > 0
    assert (hfgi >= 0).all() and (hfgi <= 100).all()


def test_backtest_runs_and_produces_bounded_metrics():
    price_data = _fake_price_data()
    engine = HFGIEngine()
    hfgi_df = engine.compute(price_data)

    result = run_backtest(hfgi_df)
    summary = result.summary()

    assert (result.positions >= 0).all() and (result.positions <= 1.0 + 1e-9).all()
    assert result.tranche_count.between(0, 3).all()
    assert -1.0 <= summary["max_drawdown"] <= 0.0
    if summary["num_trades"] > 0:
        assert 0.0 <= summary["win_rate"] <= 1.0


def test_backtest_transaction_costs_reduce_returns():
    price_data = _fake_price_data()
    engine = HFGIEngine()
    hfgi_df = engine.compute(price_data)

    free = run_backtest(hfgi_df, transaction_cost_bps=0)
    costly = run_backtest(hfgi_df, transaction_cost_bps=50)

    if len(free.trades) > 0:
        assert costly.equity_curve.iloc[-1] < free.equity_curve.iloc[-1]
        assert np.allclose(
            costly.trades["return"].values,
            free.trades["return"].values - 2 * (50 / 10_000.0),
        )


def test_backtest_add_on_tiers_scale_position_in_as_fear_deepens():
    """A steadily worsening HFGI should fill tiers one at a time rather than
    going all-in on the first breach, and pyramid vs. inverse_pyramid should
    size those tranches oppositely even though they fire on the same days."""
    index = pd.bdate_range("2021-01-04", periods=6)
    hfgi = pd.Series([50, 25, 25, 15, 15, 5], index=index)
    close = pd.Series([100.0, 100.0, 101.0, 101.0, 102.0, 102.0], index=index)
    hfgi_df = pd.DataFrame({"HFGI": hfgi, "Close": close})

    pyramid = run_backtest(hfgi_df, tiers=config.ADD_ON_STRATEGIES["pyramid"], transaction_cost_bps=0)
    inverse = run_backtest(hfgi_df, tiers=config.ADD_ON_STRATEGIES["inverse_pyramid"], transaction_cost_bps=0)

    # Same trigger days for both (identical thresholds), fully filled by the end.
    assert (pyramid.tranche_count == inverse.tranche_count).all()
    assert pyramid.tranche_count.iloc[-1] == 3

    # Pyramid front-loads size (0.5 first tranche); inverse_pyramid back-loads it (0.5 last).
    assert pyramid.positions.iloc[1] > inverse.positions.iloc[1]
    assert np.isclose(pyramid.positions.iloc[-1], 1.0)
    assert np.isclose(inverse.positions.iloc[-1], 1.0)


def test_backtest_recommendation_reflects_current_state():
    index = pd.bdate_range("2021-01-04", periods=3)
    tiers = config.ADD_ON_STRATEGIES["pyramid"]

    waiting = pd.DataFrame({"HFGI": [50.0, 50.0, 50.0], "Close": [100.0, 101.0, 102.0]}, index=index)
    result = run_backtest(waiting, tiers=tiers)
    assert result.recommendation["action"] == "wait"

    ready_to_enter = pd.DataFrame({"HFGI": [50.0, 50.0, 25.0], "Close": [100.0, 101.0, 102.0]}, index=index)
    result = run_backtest(ready_to_enter, tiers=tiers)
    assert result.recommendation["action"] == "enter"

    ready_to_exit = pd.DataFrame({"HFGI": [25.0, 15.0, 75.0]}, index=index)
    ready_to_exit["Close"] = [100.0, 101.0, 102.0]
    result = run_backtest(ready_to_exit, tiers=tiers)
    assert result.recommendation["action"] == "exit"
