"""Live-only Put/Call ratio overlay (CNN Fear & Greed Index's last
component we had no equivalent of).

Every other factor in this project is a rolling time series computed from
OHLCV history, which is what lets the engine percentile-rank it and the
backtest replay it day by day. Options data can't work that way here:
yfinance's `option_chain()` only exposes *today's* live snapshot — Yahoo
Finance doesn't expose historical options chains for free — so there is no
252-day history to rank against and no way to backtest this factor at all.

This module fetches today's put/call volume ratio for a single, liquid,
broad-market ticker (config.PUT_CALL_TICKER — CNN's own version of this
factor is SPX-options-based, a market-wide read, not per-stock) and maps
it to a 0-100 score using fixed reference bands (config.PUT_CALL_GREED_RATIO
/ PUT_CALL_FEAR_RATIO) instead of a rolling percentile rank, since there's
no history to rank against. Callers inject the result into a single day's
already-computed scores (see run.py) rather than it flowing through
HFGIEngine.compute_subscores like everything else, keeping the core engine
deterministic and testable without live network access.
"""

from __future__ import annotations

import logging
from typing import Optional

from . import config

logger = logging.getLogger(__name__)


def _volume_or_open_interest(df) -> float:
    return float(df["volume"].fillna(df["openInterest"]).sum())


def fetch_put_call_ratio(
    ticker: str = None,
    num_expirations: int = None,
) -> Optional[float]:
    """Fetch today's live put/call volume ratio for `ticker`, summed across
    the nearest `num_expirations` option expirations. Returns None if the
    data can't be fetched (network issue, no listed options, etc.) rather
    than raising — this is best-effort live data, not a hard dependency.
    """
    ticker = ticker or config.PUT_CALL_TICKER
    num_expirations = num_expirations or config.PUT_CALL_NUM_EXPIRATIONS

    try:
        import yfinance as yf

        yf_ticker = yf.Ticker(ticker)
        expirations = yf_ticker.options[:num_expirations]
        if not expirations:
            logger.warning("No listed options found for %s.", ticker)
            return None

        call_volume = 0.0
        put_volume = 0.0
        for expiration in expirations:
            chain = yf_ticker.option_chain(expiration)
            call_volume += _volume_or_open_interest(chain.calls)
            put_volume += _volume_or_open_interest(chain.puts)

        if call_volume <= 0:
            return None
        return put_volume / call_volume
    except Exception as exc:
        logger.warning("Failed to fetch put/call ratio for %s: %s", ticker, exc)
        return None


def put_call_ratio_to_score(
    ratio: float,
    greed_ratio: float = None,
    fear_ratio: float = None,
) -> float:
    """Map a put/call volume ratio to a 0-100 score via fixed reference
    bands (see module docstring for why this isn't a percentile rank like
    every other sub-score): `ratio <= greed_ratio` -> 100 (greed), `ratio
    >= fear_ratio` -> 0 (fear), linear in between.
    """
    greed_ratio = greed_ratio if greed_ratio is not None else config.PUT_CALL_GREED_RATIO
    fear_ratio = fear_ratio if fear_ratio is not None else config.PUT_CALL_FEAR_RATIO
    if ratio <= greed_ratio:
        return 100.0
    if ratio >= fear_ratio:
        return 0.0
    span = fear_ratio - greed_ratio
    return 100.0 * (fear_ratio - ratio) / span


def fetch_put_call_score(ticker: str = None, num_expirations: int = None) -> Optional[dict]:
    """Convenience wrapper: {"ratio": ..., "score": ...} or None if the
    live fetch failed.
    """
    ratio = fetch_put_call_ratio(ticker, num_expirations)
    if ratio is None:
        return None
    return {"ratio": ratio, "score": put_call_ratio_to_score(ratio)}
