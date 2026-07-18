import numpy as np
import pandas as pd

from hfgi_pro import config
from hfgi_pro.engine import HFGIEngine
from hfgi_pro.price_target import estimate_price_targets


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


def test_price_target_at_current_close_reproduces_actual_hfgi():
    price_data = _fake_price_data()
    engine = HFGIEngine()
    hfgi_df = engine.compute(price_data, subject=config.PRIMARY_TICKER)
    actual_smoothed_hfgi = hfgi_df["HFGI_Smoothed"].iloc[-1]

    # Solving for the actual current HFGI_Smoothed level should land right
    # back on (approximately) today's real closing price, and be an exact solve.
    targets = estimate_price_targets(price_data, config.PRIMARY_TICKER, [actual_smoothed_hfgi], engine=engine)
    result = targets[actual_smoothed_hfgi]
    assert result["price"] is not None
    assert result["exact"] is True
    assert np.isclose(result["price"], hfgi_df["Close"].iloc[-1], rtol=0.02)


def test_price_target_for_lower_hfgi_is_a_lower_price():
    price_data = _fake_price_data()
    engine = HFGIEngine()
    targets = estimate_price_targets(price_data, config.PRIMARY_TICKER, [40, 20], engine=engine)
    # Non-strict: both thresholds can legitimately collapse to the same
    # boundary price if neither is exactly reachable within the (realistic)
    # search range (monotonic non-decreasing, never reversed).
    assert targets[20]["price"] <= targets[40]["price"]


def test_price_target_stays_within_realistic_bounds_when_unreachable():
    """0.001 and 99.999 are extreme edges very unlikely to be exactly
    reachable while other sub-scores stay pinned at today's actual values
    — but the function should still return a usable, *realistic* number
    (within config.PRICE_TARGET_LOW_MULT/HIGH_MULT of today's close), not
    an absurd single-day move, and should flag it as inexact."""
    price_data = _fake_price_data()
    engine = HFGIEngine()
    ind, _scores, _extras = engine.compute_subscores(price_data, subject=config.PRIMARY_TICKER)
    last_close = float(ind["Close"].iloc[-1])

    targets = estimate_price_targets(price_data, config.PRIMARY_TICKER, [0.001, 99.999], engine=engine)
    low, high = targets[0.001], targets[99.999]
    assert low["price"] is not None and high["price"] is not None
    assert low["exact"] is False and high["exact"] is False
    assert last_close * config.PRICE_TARGET_LOW_MULT <= low["price"] <= last_close
    assert last_close <= high["price"] <= last_close * config.PRICE_TARGET_HIGH_MULT


def test_price_target_handles_newly_listed_ticker_without_crashing():
    """A ticker with only a handful of trading days (like SKHY, ~6 rows in
    production) shouldn't blow up on out-of-bounds indexing when momentum/
    RSI/MACD/ATR all need more history than exists yet."""
    price_data = _fake_price_data()
    price_data[config.PRIMARY_TICKER] = price_data[config.PRIMARY_TICKER].iloc[-6:]
    engine = HFGIEngine()
    targets = estimate_price_targets(price_data, config.PRIMARY_TICKER, [30, 20, 10], engine=engine)
    assert targets == {
        30: {"price": None, "exact": False},
        20: {"price": None, "exact": False},
        10: {"price": None, "exact": False},
    }
