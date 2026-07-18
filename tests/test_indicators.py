import numpy as np
import pandas as pd

from hfgi_pro import indicators


def _sample_close(n=300, seed=0):
    rng = np.random.default_rng(seed)
    steps = rng.normal(loc=0.0005, scale=0.02, size=n)
    prices = 100 * np.cumprod(1 + steps)
    idx = pd.bdate_range("2023-01-02", periods=n)
    return pd.Series(prices, index=idx, name="Close")


def test_sma_matches_manual_rolling_mean():
    close = _sample_close()
    result = indicators.sma(close, 20)
    assert np.isclose(result.iloc[50], close.iloc[31:51].mean())


def test_rsi_bounded_between_0_and_100():
    close = _sample_close()
    rsi = indicators.rsi(close, 14).dropna()
    assert (rsi >= 0).all() and (rsi <= 100).all()


def test_rsi_is_high_for_strictly_rising_series():
    close = pd.Series(np.arange(1, 40, dtype=float))
    rsi = indicators.rsi(close, 14)
    assert rsi.iloc[-1] > 95


def test_macd_histogram_equals_macd_minus_signal():
    close = _sample_close()
    macd_df = indicators.macd(close)
    diff = (macd_df["macd"] - macd_df["signal"] - macd_df["histogram"]).abs()
    assert diff.max() < 1e-9


def test_atr_non_negative():
    close = _sample_close()
    df = pd.DataFrame({
        "Close": close,
        "High": close * 1.01,
        "Low": close * 0.99,
    })
    atr = indicators.atr(df, 14).dropna()
    assert (atr >= 0).all()


def test_drawdown_is_zero_at_new_high_and_negative_after_drop():
    close = pd.Series([100.0, 110.0, 90.0])
    dd = indicators.drawdown(close)
    assert dd.iloc[1] == 0
    assert np.isclose(dd.iloc[2], 90 / 110 - 1)


def test_volume_ratio_is_one_for_constant_volume():
    volume = pd.Series([1000.0] * 30)
    ratio = indicators.volume_ratio(volume, window=20).dropna()
    assert np.allclose(ratio, 1.0)


def test_roc_matches_percentage_change():
    close = pd.Series([100.0, 105.0, 110.0, 90.0])
    roc = indicators.roc(close, 1)
    assert np.isclose(roc.iloc[1], 0.05)
    assert np.isclose(roc.iloc[3], (90 - 110) / 110)
