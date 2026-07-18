"""The HFGI (Hynix Fear & Greed Index) composite engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional

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

    def compute_indicators(self, price_data: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Return the raw indicator table for the primary ticker."""
        primary = price_data[config.PRIMARY_TICKER]
        close = primary["Close"]

        ind = pd.DataFrame(index=primary.index)
        ind["Close"] = close
        ind["Volume"] = primary["Volume"]
        ind["RSI"] = indicators.rsi(close, config.RSI_WINDOW)

        macd_df = indicators.macd(close, config.MACD_FAST, config.MACD_SLOW, config.MACD_SIGNAL)
        ind["MACD"] = macd_df["macd"]
        ind["MACD_Signal"] = macd_df["signal"]
        ind["MACD_Hist"] = macd_df["histogram"]

        ind["ATR"] = indicators.atr(primary, config.ATR_WINDOW)
        for w in config.SMA_WINDOWS:
            ind[f"SMA{w}"] = indicators.sma(close, w)
        ind["Drawdown"] = indicators.drawdown(close)
        ind["VolumeRatio"] = indicators.volume_ratio(primary["Volume"], config.VOLUME_SMA_WINDOW)
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

    def _adr_premium_raw(self, ind: pd.DataFrame, price_data: Dict[str, pd.DataFrame]) -> pd.Series:
        """Proxy for ADR premium: the spread between the primary listing's
        and the reference listing's cumulative return since the start of
        the series. No FX-rate ticker is available in this dataset, so this
        is a return-spread proxy rather than an FX-adjusted price premium.
        """
        ref_ticker = config.ADR_REFERENCE_TICKER
        if ref_ticker not in price_data:
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

    def compute(self, price_data: Dict[str, pd.DataFrame]) -> pd.DataFrame:
        """Compute the full HFGI table: Date (index), HFGI, State, and each
        weighted sub-score.
        """
        ind = self.compute_indicators(price_data)

        relative_strength_raw = self._relative_strength_raw(ind, price_data)
        adr_premium_raw = self._adr_premium_raw(ind, price_data)

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
        total_weight = sum(weight_map.values())
        weighted_sum = sum(scores[col] * w for col, w in weight_map.items())
        hfgi = weighted_sum / total_weight

        result = pd.DataFrame(index=ind.index)
        result["HFGI"] = hfgi
        result["State"] = result["HFGI"].apply(_classify_state)
        result = result.join(scores)
        result["Close"] = ind["Close"]
        result["ADR_Premium_Raw"] = adr_premium_raw
        result["RelativeStrength_Raw"] = relative_strength_raw
        return result
