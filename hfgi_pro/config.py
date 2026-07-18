"""Central configuration for the HFGI Pro pipeline."""

from pathlib import Path

# --- Universe -----------------------------------------------------------
# SKHY / 000660.KS are the two listings of the primary subject (SK Hynix).
# SMH / SOXX are semiconductor-sector benchmarks used for relative strength.
# ^VIX is a macro overlay: elevated market-wide volatility reads as fear
# regardless of the subject's own price action (see market_volatility below).
PRIMARY_TICKER = "SKHY"
ADR_REFERENCE_TICKER = "000660.KS"
SECTOR_BENCHMARK_TICKERS = ["SMH", "SOXX"]
MARKET_VOLATILITY_TICKER = "^VIX"

# Additional subjects to run the HFGI engine on individually (each gets its
# own HFGI/State/sub-score table and backtest, using the same sector
# benchmarks above for relative strength). ADR Premium only applies to
# PRIMARY_TICKER; the others simply omit that sub-score.
#   DRAM  - Roundhill Memory ETF (pure-play DRAM/memory sector)
#   QQQ   - Invesco QQQ Trust (broad Nasdaq-100 market benchmark)
#   ALAB  - Astera Labs (AI-datacenter connectivity chipmaker)
WATCHLIST = [PRIMARY_TICKER, "DRAM", "QQQ", "ALAB"]

TICKERS = sorted(set(
    WATCHLIST
    + [ADR_REFERENCE_TICKER]
    + SECTOR_BENCHMARK_TICKERS
    + [MARKET_VOLATILITY_TICKER]
))

# --- Indicator parameters ------------------------------------------------
RSI_WINDOW = 14
MACD_FAST, MACD_SLOW, MACD_SIGNAL = 12, 26, 9
ATR_WINDOW = 14
SMA_WINDOWS = (20, 50, 125)
VOLUME_SMA_WINDOW = 20
MOMENTUM_WINDOW = 20  # days, used for price-momentum ROC and relative strength

# --- HFGI Engine ----------------------------------------------------------
# Sub-scores are normalized to 0-100 and combined with these weights (in %).
# Note: the weights below (from spec) sum to 110, not 100; the engine
# divides by the actual sum so the final HFGI still lands on a 0-100 scale.
HFGI_WEIGHTS = {
    "price_momentum": 20,
    "rsi": 15,
    "macd": 15,
    "volume": 15,
    "atr": 10,
    "relative_strength": 10,
    "drawdown": 10,
    "adr_premium": 15,
    # Macro overlay (added beyond the original spec): market-wide VIX
    # percentile, inverted (high VIX -> low score) same as ATR. Weighted
    # comparably to the other secondary factors so idiosyncratic,
    # asset-specific momentum still dominates the composite.
    "market_volatility": 15,
}

# Rolling lookback window (trading days) used to percentile-rank raw
# indicator values into 0-100 sub-scores.
ROLLING_WINDOW = 252

STATE_THRESHOLDS = {
    "Extreme Fear": (0, 30),
    "Fear": (30, 45),
    "Neutral": (45, 55),
    "Greed": (55, 70),
    "Extreme Greed": (70, 101),  # upper bound exclusive; 101 so HFGI==100 is included
}

# --- Backtest --------------------------------------------------------------
BACKTEST_BUY_THRESHOLD = 30
BACKTEST_SELL_THRESHOLD = 70

# --- Paths ------------------------------------------------------------------
DATA_DIR = Path("data")
CACHE_DIR = DATA_DIR / "cache"


def sanitize_ticker(ticker: str) -> str:
    """Turn a yfinance ticker into a filesystem-safe name, e.g. '^VIX' -> 'VIX'."""
    return ticker.replace("^", "").replace(".", "_")
