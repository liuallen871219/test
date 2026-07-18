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

    assert result.positions.isin([0, 1]).all()
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
