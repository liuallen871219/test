"""Reusable, caching data loader built on top of yfinance."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Dict, Iterable, Optional

import pandas as pd
import yfinance as yf

from . import config

logger = logging.getLogger(__name__)


class DataLoader:
    """Downloads OHLCV data for a ticker via yfinance, caching it on disk.

    Cached data is stored as full-history parquet files per ticker. Requests
    for a specific ``start``/``end`` window are served by slicing the cached
    (or freshly downloaded) frame in memory, so the same cache file backs
    any date range.
    """

    def __init__(self, cache_dir: Path = config.CACHE_DIR, max_cache_age_hours: float = 24.0):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_cache_age_hours = max_cache_age_hours

    def _cache_path(self, ticker: str) -> Path:
        return self.cache_dir / f"{config.sanitize_ticker(ticker)}.parquet"

    def _cache_is_fresh(self, path: Path) -> bool:
        if not path.exists():
            return False
        age_hours = (time.time() - path.stat().st_mtime) / 3600
        return age_hours < self.max_cache_age_hours

    def _download(self, ticker: str) -> pd.DataFrame:
        df = yf.download(ticker, period="max", auto_adjust=True, progress=False)
        if df is None or df.empty:
            raise ValueError(f"yfinance returned no data for {ticker!r}")
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.index.name = "Date"
        return df

    def get(
        self,
        ticker: str,
        start: Optional[str] = None,
        end: Optional[str] = None,
        refresh: bool = False,
    ) -> pd.DataFrame:
        """Return OHLCV data for ``ticker``, optionally sliced to [start, end]."""
        cache_path = self._cache_path(ticker)

        df: Optional[pd.DataFrame] = None
        if not refresh and self._cache_is_fresh(cache_path):
            df = pd.read_parquet(cache_path)
        else:
            try:
                df = self._download(ticker)
                df.to_parquet(cache_path)
            except Exception as exc:
                if cache_path.exists():
                    logger.warning("Download failed for %s (%s); using stale cache.", ticker, exc)
                    df = pd.read_parquet(cache_path)
                else:
                    raise

        if start is not None:
            df = df[df.index >= pd.Timestamp(start)]
        if end is not None:
            df = df[df.index <= pd.Timestamp(end)]
        return df

    def get_many(
        self,
        tickers: Iterable[str],
        start: Optional[str] = None,
        end: Optional[str] = None,
        refresh: bool = False,
    ) -> Dict[str, pd.DataFrame]:
        """Fetch several tickers, skipping (with a warning) any that fail."""
        result: Dict[str, pd.DataFrame] = {}
        for ticker in tickers:
            try:
                result[ticker] = self.get(ticker, start=start, end=end, refresh=refresh)
            except Exception as exc:
                logger.warning("Skipping %s: %s", ticker, exc)
        return result
