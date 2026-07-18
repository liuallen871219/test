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
    }


def test_engine_output_has_expected_columns_and_bounded_hfgi():
    price_data = _fake_price_data()
    engine = HFGIEngine()
    result = engine.compute(price_data)

    expected_cols = {
        "HFGI", "State",
        "PriceMomentum_Score", "RSI_Score", "MACD_Score", "Volume_Score",
        "ATR_Score", "RelativeStrength_Score", "Drawdown_Score", "ADRPremium_Score",
        "Close", "ADR_Premium_Raw", "RelativeStrength_Raw",
    }
    assert expected_cols.issubset(result.columns)

    hfgi = result["HFGI"].dropna()
    assert (hfgi >= 0).all() and (hfgi <= 100).all()
    assert result["State"].dropna().isin(list(config.STATE_THRESHOLDS.keys()) + ["Unknown"]).all()


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
