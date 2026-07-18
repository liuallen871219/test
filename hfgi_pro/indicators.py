"""Technical indicators used by the HFGI engine."""

from __future__ import annotations

import numpy as np
import pandas as pd


def sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window).mean()


def rsi(series: pd.Series, window: int = 14) -> pd.Series:
    """Wilder's RSI."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    result = 100 - (100 / (1 + rs))
    # avg_loss == 0 (no losses anywhere in the window) means "maximally
    # overbought" once the window is actually full; don't confuse that with
    # avg_gain/avg_loss still being NaN because there isn't enough history yet.
    no_losses_in_full_window = avg_loss.eq(0) & avg_gain.notna()
    return result.where(~no_losses_in_full_window, 100)


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "histogram": histogram})


def atr(df: pd.DataFrame, window: int = 14) -> pd.Series:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return true_range.ewm(alpha=1 / window, min_periods=window, adjust=False).mean()


def drawdown(series: pd.Series) -> pd.Series:
    """Drawdown from the running peak, expressed as a fraction (e.g. -0.15)."""
    running_max = series.cummax()
    return series / running_max - 1.0


def volume_ratio(volume: pd.Series, window: int = 20) -> pd.Series:
    return volume / volume.rolling(window).mean()


def roc(series: pd.Series, window: int) -> pd.Series:
    """Rate of change (percentage) over `window` periods."""
    return series.pct_change(window)
