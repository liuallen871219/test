"""Estimate the closing price that would produce a given HFGI level.

HFGI depends on much more than price alone (volume, relative strength, ADR
premium, VIX), so "what price gives HFGI=20" has no single algebraic
answer. This holds every non-price-derived sub-score at its latest actual
value, and for the price-derived ones (Price Momentum, RSI, MACD, ATR,
Drawdown, Relative Strength, and — for the primary ticker — ADR Premium)
re-derives what a hypothetical closing price today would do to each one
via the same one-step EWM/rolling update the live indicators use, then
bisection-searches for the price where the resulting HFGI matches the
target.

This is an estimate, not a guarantee: it assumes the hypothetical day's
High/Low collapse to its Close (no way to know intraday range in advance),
which understates true ATR-driven volatility for a very large single-day
move, and it holds Volume/Relative Strength/VIX at today's actual values
even though a big move would likely shift those too.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from . import config
from .engine import HFGIEngine, combine_scores


def _rank_with_hypothetical(hypothetical: float, history: pd.Series, window: int) -> float:
    tail = history.iloc[-(window - 1):] if window > 1 else history.iloc[0:0]
    tail = tail.dropna()
    min_periods = max(20, window // 5)
    if len(tail) < min_periods - 1:
        return float("nan")
    combined = np.append(tail.values, hypothetical)
    return (combined <= hypothetical).sum() / len(combined) * 100


def _hfgi_as_function_of_price(ind: pd.DataFrame, scores: pd.DataFrame, extras: dict, subject: str,
                                engine: HFGIEngine, weights: Dict[str, float]):
    """Returns hfgi(price) -> float, closing over the ticker's current state."""
    close = ind["Close"]
    prev_close = float(close.iloc[-2])
    window = engine.rolling_window
    momentum_window = engine.momentum_window

    roc_base = float(close.iloc[-1 - momentum_window])
    benchmark_roc_latest = float((ind["ROC"] - extras["relative_strength_raw"]).iloc[-1])

    delta = close.diff()
    gain_series = delta.clip(lower=0)
    loss_series = -delta.clip(upper=0)
    avg_gain_prev = float(
        gain_series.ewm(alpha=1 / config.RSI_WINDOW, min_periods=config.RSI_WINDOW, adjust=False).mean().iloc[-2]
    )
    avg_loss_prev = float(
        loss_series.ewm(alpha=1 / config.RSI_WINDOW, min_periods=config.RSI_WINDOW, adjust=False).mean().iloc[-2]
    )

    alpha_fast = 2 / (config.MACD_FAST + 1)
    alpha_slow = 2 / (config.MACD_SLOW + 1)
    alpha_signal = 2 / (config.MACD_SIGNAL + 1)
    ema_fast_series = close.ewm(span=config.MACD_FAST, adjust=False).mean()
    ema_slow_series = close.ewm(span=config.MACD_SLOW, adjust=False).mean()
    signal_series = (ema_fast_series - ema_slow_series).ewm(span=config.MACD_SIGNAL, adjust=False).mean()
    ema_fast_prev = float(ema_fast_series.iloc[-2])
    ema_slow_prev = float(ema_slow_series.iloc[-2])
    signal_prev = float(signal_series.iloc[-2])

    alpha_atr = 1 / config.ATR_WINDOW
    atr_prev = float(ind["ATR"].iloc[-2])
    running_max_prev = float(close.iloc[:-1].cummax().iloc[-1])

    is_primary = subject == config.PRIMARY_TICKER and extras["adr_premium_raw"].notna().any()
    if is_primary:
        primary_base = float(close.dropna().iloc[0])
        primary_cum_return_latest = float(close.iloc[-1]) / primary_base - 1.0
        ref_cum_return_latest = primary_cum_return_latest - float(extras["adr_premium_raw"].iloc[-1])

    fixed_scores = {
        "Volume_Score": float(scores["Volume_Score"].iloc[-1]),
        "MarketVolatility_Score": float(scores["MarketVolatility_Score"].iloc[-1]),
    }
    if not is_primary:
        fixed_scores["ADRPremium_Score"] = float("nan")

    def hfgi(price: float) -> float:
        roc_hyp = price / roc_base - 1.0
        gain_hyp = max(price - prev_close, 0.0)
        loss_hyp = max(prev_close - price, 0.0)
        avg_gain_hyp = avg_gain_prev * (1 - 1 / config.RSI_WINDOW) + gain_hyp / config.RSI_WINDOW
        avg_loss_hyp = avg_loss_prev * (1 - 1 / config.RSI_WINDOW) + loss_hyp / config.RSI_WINDOW
        rsi_hyp = 100.0 if avg_loss_hyp == 0 else 100 - 100 / (1 + avg_gain_hyp / avg_loss_hyp)

        ema_fast_hyp = alpha_fast * price + (1 - alpha_fast) * ema_fast_prev
        ema_slow_hyp = alpha_slow * price + (1 - alpha_slow) * ema_slow_prev
        macd_line_hyp = ema_fast_hyp - ema_slow_hyp
        signal_hyp = alpha_signal * macd_line_hyp + (1 - alpha_signal) * signal_prev
        macd_hist_hyp = macd_line_hyp - signal_hyp

        tr_hyp = abs(price - prev_close)
        atr_hyp = atr_prev * (1 - alpha_atr) + tr_hyp * alpha_atr

        running_max_hyp = max(running_max_prev, price)
        drawdown_hyp = price / running_max_hyp - 1.0

        relative_strength_hyp = roc_hyp - benchmark_roc_latest

        row = dict(fixed_scores)
        row["PriceMomentum_Score"] = _rank_with_hypothetical(roc_hyp, ind["ROC"], window)
        row["RSI_Score"] = _rank_with_hypothetical(rsi_hyp, ind["RSI"], window)
        row["MACD_Score"] = _rank_with_hypothetical(macd_hist_hyp, ind["MACD_Hist"], window)
        row["ATR_Score"] = 100 - _rank_with_hypothetical(atr_hyp, ind["ATR"], window)
        row["Drawdown_Score"] = _rank_with_hypothetical(drawdown_hyp, ind["Drawdown"], window)
        row["RelativeStrength_Score"] = _rank_with_hypothetical(
            relative_strength_hyp, extras["relative_strength_raw"], window
        )
        if is_primary:
            adr_premium_hyp = (price / primary_base - 1.0) - ref_cum_return_latest
            row["ADRPremium_Score"] = _rank_with_hypothetical(adr_premium_hyp, extras["adr_premium_raw"], window)

        scores_row = pd.DataFrame([row])
        return float(combine_scores(scores_row, weights).iloc[0])

    return hfgi


def _bisect(f, target: float, lo: float, hi: float, tol: float = 0.01, max_iter: int = 60) -> Optional[float]:
    f_lo, f_hi = f(lo), f(hi)
    if any(pd.isna(v) for v in (f_lo, f_hi)):
        return None
    if f_lo > f_hi:
        lo, hi, f_lo, f_hi = hi, lo, f_hi, f_lo
    if not (f_lo - 1e-6 <= target <= f_hi + 1e-6):
        return None
    for _ in range(max_iter):
        mid = (lo + hi) / 2
        f_mid = f(mid)
        if abs(f_mid - target) < tol or (hi - lo) < 0.01:
            return mid
        if f_mid < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def estimate_price_targets(
    price_data: Dict[str, pd.DataFrame],
    subject: str,
    thresholds: List[float],
    engine: HFGIEngine = None,
    weights: Dict[str, float] = None,
) -> Dict[float, Optional[float]]:
    """For each HFGI level in `thresholds`, estimate today's closing price
    that would produce it (holding non-price-derived sub-scores fixed at
    their latest actual values). Returns {threshold: price_or_None}.
    """
    engine = engine or HFGIEngine()
    weights = weights or engine.weights
    ind, scores, extras = engine.compute_subscores(price_data, subject=subject)

    min_history = max(engine.momentum_window, config.RSI_WINDOW, config.MACD_SLOW, config.ATR_WINDOW) + 1
    if len(ind) < min_history or ind["Close"].iloc[-2:].isna().any():
        return {t: None for t in thresholds}

    hfgi_fn = _hfgi_as_function_of_price(ind, scores, extras, subject, engine, weights)
    last_close = float(ind["Close"].iloc[-1])
    lo, hi = last_close * 0.05, last_close * 3.0

    return {t: _bisect(hfgi_fn, t, lo, hi) for t in thresholds}
