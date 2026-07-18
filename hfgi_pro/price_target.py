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
move, and it holds Volume/VIX/Breadth at today's actual values even though
a big move would likely shift those too (Breadth is inherently about the
*rest* of the watchlist, so it can't be re-derived from the subject's own
hypothetical price anyway).
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
        # Breadth depends on the *rest* of the watchlist's prices, not the
        # subject's own hypothetical price, so it's held fixed here too.
        "Breadth_Score": float(scores["Breadth_Score"].iloc[-1]),
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
    """Find price P in [lo, hi] with f(P) == target. f is assumed
    monotonic non-decreasing over [lo, hi] (true here except at the very
    extremes, where ATR-driven "any big move reads as fear" can flatten it).

    If `target` isn't actually reachable within [lo, hi] — e.g. a fixed
    factor (Volume/VIX) or the ATR ceiling caps how far HFGI can move by
    price alone — this returns the boundary (lo or hi) closest to it
    instead of None/NaN, since "the most extreme price in a very wide,
    already-generous range" is still a usable answer, just not an exact
    root. Returns None only when f itself can't be evaluated (NaN inputs,
    e.g. insufficient history) — a fundamentally different failure than
    "reachable in principle, just not within this range."
    """
    f_lo, f_hi = f(lo), f(hi)
    if any(pd.isna(v) for v in (f_lo, f_hi)):
        return None
    if f_lo > f_hi:
        lo, hi, f_lo, f_hi = hi, lo, f_hi, f_lo
    if target <= f_lo:
        return lo
    if target >= f_hi:
        return hi
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
    smoothing_window: int = None,
) -> Dict[float, Optional[float]]:
    """For each HFGI_Smoothed level in `thresholds` (add-on/exit decisions
    trigger off the smoothed series, see backtest.run_backtest), estimate
    today's closing price that would produce it. Holds non-price-derived
    sub-scores fixed at their latest actual values (pass `weights` without
    a factor's key to exclude it from the solve entirely instead).

    Always returns a numeric price per threshold — never NaN/None — except
    when there isn't enough history to evaluate the model at all (e.g. a
    newly-listed ticker like SKHY). A threshold outside what's achievable
    within the (already wide, 0.05x-3x) search range still returns the
    closest boundary price reached rather than giving up; see `_bisect`.
    Returns {threshold: price}.
    """
    engine = engine or HFGIEngine()
    weights = weights or engine.weights
    smoothing_window = smoothing_window if smoothing_window is not None else config.HFGI_SMOOTHING_WINDOW
    ind, scores, extras = engine.compute_subscores(price_data, subject=subject)

    min_history = max(engine.momentum_window, config.RSI_WINDOW, config.MACD_SLOW, config.ATR_WINDOW) + 1
    if len(ind) < min_history or ind["Close"].iloc[-2:].isna().any():
        return {t: None for t in thresholds}

    hfgi_fn = _hfgi_as_function_of_price(ind, scores, extras, subject, engine, weights)
    last_close = float(ind["Close"].iloc[-1])
    lo, hi = last_close * 0.05, last_close * 3.0

    # HFGI_Smoothed is a simple moving average over `smoothing_window` days
    # including today. Today's raw HFGI is the only unknown (the prior
    # smoothing_window-1 days already happened), so solving for
    # smoothed(P) == threshold is equivalent to solving
    # raw_hfgi(P) == threshold * window - sum(prior raw HFGI values).
    prior_raw_hfgi = combine_scores(scores, weights).iloc[-smoothing_window:-1]
    if len(prior_raw_hfgi) < smoothing_window - 1 or prior_raw_hfgi.isna().any():
        return {t: None for t in thresholds}
    prior_sum = float(prior_raw_hfgi.sum())

    def raw_target_for_smoothed(threshold: float) -> float:
        return threshold * smoothing_window - prior_sum

    return {t: _bisect(hfgi_fn, raw_target_for_smoothed(t), lo, hi) for t in thresholds}
