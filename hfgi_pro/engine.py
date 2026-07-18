"""The HFGI (Hynix Fear & Greed Index) composite engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict

import numpy as np
import pandas as pd

from . import config, indicators


def _percentile_score(series: pd.Series, window: int) -> pd.Series:
    """Rolling percentile rank of the latest value within its own trailing
    window, scaled to 0-100. This turns an arbitrary-scale raw indicator
    into a comparable "how greedy is this relative to its recent history"
    sub-score.
    """
    min_periods = max(20, window // 5)
    return series.rolling(window, min_periods=min_periods).rank(pct=True) * 100


def _classify_state(score: float) -> str:
    if pd.isna(score):
        return "Unknown"
    for state, (low, high) in config.STATE_THRESHOLDS.items():
        if low <= score < high:
            return state
    return "Unknown"


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

    def _relative_strength_raw(self, ind: pd.DataFrame, price_data: Dict[str, pd.DataFrame]) -> pd.Series:
        benchmark_rocs = [
            indicators.roc(price_data[t]["Close"], self.momentum_window).reindex(ind.index)
            for t in config.SECTOR_BENCHMARK_TICKERS
            if t in price_data
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

    def compute(self, price_data: Dict[str, pd.DataFrame], subject: str = None) -> pd.DataFrame:
        """Compute the full HFGI table for `subject`: Date (index), HFGI,
        State, and each weighted sub-score. Defaults to config.PRIMARY_TICKER.
        """
        subject = subject or config.PRIMARY_TICKER
        ind = self.compute_indicators(price_data, subject)

        relative_strength_raw = self._relative_strength_raw(ind, price_data)
        adr_premium_raw = self._adr_premium_raw(ind, price_data, subject)

        scores = pd.DataFrame(index=ind.index)
        scores["PriceMomentum_Score"] = _percentile_score(ind["ROC"], self.rolling_window)
        scores["RSI_Score"] = ind["RSI"]
        scores["MACD_Score"] = _percentile_score(ind["MACD_Hist"], self.rolling_window)
        scores["Volume_Score"] = _percentile_score(ind["VolumeRatio"], self.rolling_window)
        # High ATR (volatility) reads as fear, so invert the percentile rank.
        scores["ATR_Score"] = 100 - _percentile_score(ind["ATR"], self.rolling_window)
        scores["RelativeStrength_Score"] = _percentile_score(relative_strength_raw, self.rolling_window)
        scores["Drawdown_Score"] = _percentile_score(ind["Drawdown"], self.rolling_window)
        scores["ADRPremium_Score"] = _percentile_score(adr_premium_raw, self.rolling_window)

        weight_map = {
            "PriceMomentum_Score": self.weights["price_momentum"],
            "RSI_Score": self.weights["rsi"],
            "MACD_Score": self.weights["macd"],
            "Volume_Score": self.weights["volume"],
            "ATR_Score": self.weights["atr"],
            "RelativeStrength_Score": self.weights["relative_strength"],
            "Drawdown_Score": self.weights["drawdown"],
            "ADRPremium_Score": self.weights["adr_premium"],
        }
        # Weighted average that ignores any sub-score missing for a given row
        # (e.g. no ADR reference ticker was supplied), rather than letting a
        # single NaN column blank out the whole composite.
        weights = pd.Series(weight_map)
        weighted_sum = scores.fillna(0).mul(weights, axis=1).sum(axis=1)
        available_weight = scores.notna().mul(weights, axis=1).sum(axis=1)
        hfgi = (weighted_sum / available_weight.replace(0, np.nan))

        result = pd.DataFrame(index=ind.index)
        result["HFGI"] = hfgi
        result["State"] = result["HFGI"].apply(_classify_state)
        result = result.join(scores)
        result["Close"] = ind["Close"]
        result["ADR_Premium_Raw"] = adr_premium_raw
        result["RelativeStrength_Raw"] = relative_strength_raw
        return result
