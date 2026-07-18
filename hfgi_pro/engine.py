"""The HFGI (Hynix Fear & Greed Index) composite engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

import numpy as np
import pandas as pd

from . import config, indicators


def _min_periods(window: int) -> int:
    return max(20, window // 5)


def _percentile_score(series: pd.Series, window: int) -> pd.Series:
    """Rolling percentile rank of the latest value within its own trailing
    window, scaled to 0-100. This turns an arbitrary-scale raw indicator
    into a comparable "how greedy is this relative to its recent history"
    sub-score.
    """
    return series.rolling(window, min_periods=_min_periods(window)).rank(pct=True) * 100


def _lookback_count(series: pd.Series, window: int) -> pd.Series:
    """How many observations each row's percentile rank actually used (capped
    at `window`). A newly-listed ticker's early scores are computed against a
    handful of days rather than a full year, so percentile ranks are noisier
    and less statistically stable than they look; this makes that visible
    instead of hiding it.
    """
    return series.rolling(window, min_periods=_min_periods(window)).count()


def _classify_state(score: float) -> str:
    if pd.isna(score):
        return "Unknown"
    for state, (low, high) in config.STATE_THRESHOLDS.items():
        if low <= score < high:
            return state
    return "Unknown"


# Maps each sub-score column to its key in config.HFGI_WEIGHTS / HFGIEngine.weights.
SCORE_WEIGHT_KEYS = {
    "PriceMomentum_Score": "price_momentum",
    "RSI_Score": "rsi",
    "MACD_Score": "macd",
    "Volume_Score": "volume",
    "ATR_Score": "atr",
    "RelativeStrength_Score": "relative_strength",
    "Drawdown_Score": "drawdown",
    "ADRPremium_Score": "adr_premium",
    "MarketVolatility_Score": "market_volatility",
}


def combine_scores(scores: pd.DataFrame, weights: Dict[str, float]) -> pd.Series:
    """Weighted average of `scores` columns using `weights` (keyed by
    config.HFGI_WEIGHTS names, see SCORE_WEIGHT_KEYS), ignoring whichever
    sub-scores are NaN for a given row instead of letting a single missing
    column (e.g. no ADR reference ticker) blank out the whole composite.
    """
    weight_series = pd.Series({col: weights[key] for col, key in SCORE_WEIGHT_KEYS.items() if key in weights})
    scores = scores[weight_series.index]
    weighted_sum = scores.fillna(0).mul(weight_series, axis=1).sum(axis=1)
    available_weight = scores.notna().mul(weight_series, axis=1).sum(axis=1)
    return weighted_sum / available_weight.replace(0, np.nan)


@dataclass
class HFGIEngine:
    weights: Dict[str, float] = field(default_factory=lambda: dict(config.HFGI_WEIGHTS))
    rolling_window: int = config.ROLLING_WINDOW
    momentum_window: int = config.MOMENTUM_WINDOW

    def compute_indicators(self, price_data: Dict[str, pd.DataFrame], subject: str = None) -> pd.DataFrame:
        """Return the raw indicator table for `subject` (defaults to config.PRIMARY_TICKER)."""
        subject = subject or config.PRIMARY_TICKER
        subject_ohlcv = price_data[subject]
        close = subject_ohlcv["Close"]

        ind = pd.DataFrame(index=subject_ohlcv.index)
        ind["Close"] = close
        ind["Volume"] = subject_ohlcv["Volume"]
        ind["RSI"] = indicators.rsi(close, config.RSI_WINDOW)

        macd_df = indicators.macd(close, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL)
        ind["MACD"] = macd_df["macd"]
        ind["MACD_Signal"] = macd_df["signal"]
        ind["MACD_Hist"] = macd_df["histogram"]

        ind["ATR"] = indicators.atr(subject_ohlcv, config.ATR_WINDOW)
        for w in config.SMA_WINDOWS:
            ind[f"SMA{w}"] = indicators.sma(close, w)
        ind["Drawdown"] = indicators.drawdown(close)
        ind["VolumeRatio"] = indicators.volume_ratio(subject_ohlcv["Volume"], config.VOLUME_SMA_WINDOW)
        ind["ROC"] = indicators.roc(close, self.momentum_window)
        return ind

    def _relative_strength_raw(self, ind: pd.DataFrame, price_data: Dict[str, pd.DataFrame], subject: str) -> pd.Series:
        """Subject's momentum vs. the sector benchmark's. Excludes `subject`
        itself from the benchmark set — otherwise a subject that's also one
        of config.SECTOR_BENCHMARK_TICKERS (e.g. SOXX, which is itself a
        semiconductor-sector ETF) would be compared partly against its own
        momentum, diluting the signal toward zero instead of reflecting real
        sector-relative performance.
        """
        benchmark_rocs = [
            indicators.roc(price_data[t]["Close"], self.momentum_window).reindex(ind.index)
            for t in config.SECTOR_BENCHMARK_TICKERS
            if t in price_data and t != subject
        ]
        if not benchmark_rocs:
            return pd.Series(index=ind.index, dtype=float)
        benchmark_roc = pd.concat(benchmark_rocs, axis=1).mean(axis=1)
        return ind["ROC"] - benchmark_roc

    def _adr_premium_raw(self, ind: pd.DataFrame, price_data: Dict[str, pd.DataFrame], subject: str) -> pd.Series:
        """Proxy for ADR premium: the spread between the primary listing's
        and the reference listing's cumulative return since the start of
        the series. No FX-rate ticker is available in this dataset, so this
        is a return-spread proxy rather than an FX-adjusted price premium.

        Only meaningful for the SKHY/000660.KS dual-listing pair; other
        watchlist subjects (an ETF, an unrelated stock) have no ADR
        reference, so this sub-score is simply omitted for them.
        """
        ref_ticker = config.ADR_REFERENCE_TICKER
        if subject != config.PRIMARY_TICKER or ref_ticker not in price_data:
            return pd.Series(index=ind.index, dtype=float)

        ref_close = price_data[ref_ticker]["Close"].reindex(ind.index).ffill()
        primary_close = ind["Close"]

        primary_base = primary_close.dropna().iloc[0] if primary_close.notna().any() else None
        ref_base = ref_close.dropna().iloc[0] if ref_close.notna().any() else None
        if not primary_base or not ref_base:
            return pd.Series(index=ind.index, dtype=float)

        primary_cum_return = primary_close / primary_base - 1.0
        ref_cum_return = ref_close / ref_base - 1.0
        return primary_cum_return - ref_cum_return

    def _vix_close(self, ind: pd.DataFrame, price_data: Dict[str, pd.DataFrame]) -> pd.Series:
        vix_ticker = config.MARKET_VOLATILITY_TICKER
        if vix_ticker not in price_data:
            return pd.Series(index=ind.index, dtype=float)
        return price_data[vix_ticker]["Close"].reindex(ind.index).ffill()

    def compute_subscores(self, price_data: Dict[str, pd.DataFrame], subject: str = None):
        """Compute `subject`'s raw indicators and 0-100 sub-scores, independent
        of any particular weighting. Returns (ind, scores, extras); `extras`
        carries the raw (non-percentile-ranked) series needed for reporting
        (ADR premium, relative strength, VIX close). Split out from `compute`
        so a weight search can reuse the (expensive) rolling-percentile work
        across many candidate weight vectors instead of recomputing it per
        candidate.
        """
        subject = subject or config.PRIMARY_TICKER
        ind = self.compute_indicators(price_data, subject)

        relative_strength_raw = self._relative_strength_raw(ind, price_data, subject)
        adr_premium_raw = self._adr_premium_raw(ind, price_data, subject)
        vix_close = self._vix_close(ind, price_data)

        scores = pd.DataFrame(index=ind.index)
        scores["PriceMomentum_Score"] = _percentile_score(ind["ROC"], self.rolling_window)
        # Percentile-ranked like every other sub-score, rather than RSI's raw
        # 0-100 reading used directly: a stock that structurally trades in
        # the 60-70 RSI range isn't "always greedy", it's just there normally,
        # so ranking against its own history keeps this factor's weight
        # comparable to the others instead of mixing an absolute scale in.
        scores["RSI_Score"] = _percentile_score(ind["RSI"], self.rolling_window)
        scores["MACD_Score"] = _percentile_score(ind["MACD_Hist"], self.rolling_window)
        scores["Volume_Score"] = _percentile_score(ind["VolumeRatio"], self.rolling_window)
        # High ATR (volatility) reads as fear, so invert the percentile rank.
        scores["ATR_Score"] = 100 - _percentile_score(ind["ATR"], self.rolling_window)
        scores["RelativeStrength_Score"] = _percentile_score(relative_strength_raw, self.rolling_window)
        scores["Drawdown_Score"] = _percentile_score(ind["Drawdown"], self.rolling_window)
        scores["ADRPremium_Score"] = _percentile_score(adr_premium_raw, self.rolling_window)
        # High VIX (market-wide fear) reads as fear, so invert the rank too.
        scores["MarketVolatility_Score"] = 100 - _percentile_score(vix_close, self.rolling_window)

        extras = {
            "adr_premium_raw": adr_premium_raw,
            "relative_strength_raw": relative_strength_raw,
            "vix_close": vix_close,
            "lookback_days": _lookback_count(ind["ROC"], self.rolling_window),
        }
        return ind, scores, extras

    def compute(self, price_data: Dict[str, pd.DataFrame], subject: str = None, weights: Dict[str, float] = None) -> pd.DataFrame:
        """Compute the full HFGI table for `subject`: Date (index), HFGI,
        State, and each weighted sub-score. Defaults to config.PRIMARY_TICKER
        and self.weights.
        """
        ind, scores, extras = self.compute_subscores(price_data, subject)
        hfgi = combine_scores(scores, weights or self.weights)

        result = pd.DataFrame(index=ind.index)
        result["HFGI"] = hfgi
        result["State"] = result["HFGI"].apply(_classify_state)
        result = result.join(scores)
        result["Close"] = ind["Close"]
        result["ADR_Premium_Raw"] = extras["adr_premium_raw"]
        result["RelativeStrength_Raw"] = extras["relative_strength_raw"]
        result["VIX_Close"] = extras["vix_close"]
        # How many days of history back each row's percentile-ranked
        # sub-scores were actually computed over (capped at rolling_window).
        # Low values (e.g. a ticker with only a few months of trading) mean
        # the sub-scores above are a much noisier signal than usual.
        result["LookbackDays"] = extras["lookback_days"]
        return result
