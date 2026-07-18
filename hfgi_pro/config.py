"""Central configuration for the HFGI Pro pipeline."""

from pathlib import Path

# --- Universe -----------------------------------------------------------
# SKHY / 000660.KS are the two listings of the primary subject (SK Hynix).
# SMH / SOXX are semiconductor-sector benchmarks; QQQ / VOO add broad-market
# context (Nasdaq-100, S&P 500) so Relative Strength isn't purely
# sector-relative — a stock can lag its sector while still beating the
# broad market, or vice versa. All four are used for every subject's
# Relative Strength (a subject that's also one of these four excludes
# itself from its own benchmark blend, see engine._relative_strength_raw).
# ^VIX is a macro overlay: elevated market-wide volatility reads as fear
# regardless of the subject's own price action (see market_volatility below).
PRIMARY_TICKER = "SKHY"
ADR_REFERENCE_TICKER = "000660.KS"
SECTOR_BENCHMARK_TICKERS = ["SMH", "SOXX", "QQQ", "VOO"]
MARKET_VOLATILITY_TICKER = "^VIX"

# Additional subjects to run the HFGI engine on individually (each gets its
# own HFGI/State/sub-score table and backtest, using the same sector
# benchmarks above for relative strength). ADR Premium only applies to
# PRIMARY_TICKER; the others simply omit that sub-score.
#   DRAM  - Roundhill Memory ETF (pure-play DRAM/memory sector)
#   QQQ   - Invesco QQQ Trust (broad Nasdaq-100 market benchmark)
#   ALAB  - Astera Labs (AI-datacenter connectivity chipmaker)
#   NVDA  - Nvidia (AI/GPU compute)
#   TSM   - Taiwan Semiconductor (foundry)
#   ASML  - ASML Holding (lithography equipment)
#   PLTR  - Palantir Technologies (AI/data analytics software)
#   MRVL  - Marvell Technology (data-infrastructure semiconductors)
#   GLW   - Corning (fiber optic cable/glass)
#   LITE  - Lumentum Holdings (optical components)
#   COHR  - Coherent Corp (photonics/optical components)
#   AAOI  - Applied Optoelectronics (optical networking components)
#   SMH   - VanEck Semiconductor ETF (broad semiconductor-sector index)
#   SOXX  - iShares Semiconductor ETF (broad semiconductor-sector index)
# SMH/SOXX double as both a WATCHLIST subject (a sector-wide fear/greed
# reading in their own right) and the SECTOR_BENCHMARK_TICKERS used for
# every other subject's Relative Strength factor.
WATCHLIST = [
    PRIMARY_TICKER, "DRAM", "QQQ", "ALAB", "NVDA", "TSM", "ASML",
    "PLTR", "MRVL", "GLW", "LITE", "COHR", "AAOI", "SMH", "SOXX",
]

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
BREADTH_SMA_WINDOW = 50  # for the breadth factor below

# --- HFGI Engine ----------------------------------------------------------
# Sub-scores are normalized to 0-100 and combined with these weights (in %).
# The engine divides by whatever weight is actually available per row (see
# engine.combine_scores), so these don't need to sum to exactly 100.
#
# These are calibrate_weights.py's "mean of top 20" result (500 random
# trials, seed=0, evaluated on QQQ/ALAB/NVDA/TSM/ASML): median backtest
# Sharpe 0.56 vs. 0.43 for the original hand-picked weights below. This is
# an in-sample search over 5 correlated tech tickers over one overlapping
# history window, not a validated out-of-sample result — re-run
# calibrate_weights.py periodically rather than trusting these forever.
# Original hand-picked weights (ChatGPT spec + the VIX overlay added on
# top), kept here in case you want to revert:
#   {"price_momentum": 20, "rsi": 15, "macd": 15, "volume": 15, "atr": 10,
#    "relative_strength": 10, "drawdown": 10, "adr_premium": 15,
#    "market_volatility": 15}
HFGI_WEIGHTS = {
    "price_momentum": 9.9,
    "rsi": 8.6,
    "macd": 6.8,
    "volume": 8.2,
    "atr": 13.7,
    "relative_strength": 7.8,
    "drawdown": 7.6,
    "adr_premium": 13.1,
    "market_volatility": 24.3,
    # Cross-sectional market-breadth overlay (added beyond calibration,
    # inspired by CNN Fear & Greed Index's "Stock Price Strength/Breadth"
    # component, which we had no equivalent of): what fraction of the rest
    # of the watchlist is trading above its own BREADTH_SMA_WINDOW-day SMA.
    # Weighted comparably to market_volatility since both are macro/
    # cross-sectional overlays applied identically to every subject, not
    # idiosyncratic to it. Not included in the calibrate_weights.py search
    # yet — re-run that with this factor in the mix rather than trusting
    # this placeholder weight forever.
    "breadth": 15,
}

# Rolling lookback window (trading days) used to percentile-rank raw
# indicator values into 0-100 sub-scores.
ROLLING_WINDOW = 252

# Simple moving average window applied to daily HFGI to get HFGI_Smoothed.
# A real SOXX drawdown (2026-06-22 to 2026-07-17) showed raw daily HFGI
# whipsawing back above the buy threshold several times during the decline
# before the real capitulation — add-on/exit decisions use the smoothed
# series (see backtest.run_backtest) so a single noisy day doesn't trigger
# a tier fill or exit on its own.
HFGI_SMOOTHING_WINDOW = 3

STATE_THRESHOLDS = {
    "Extreme Fear": (0, 30),
    "Fear": (30, 45),
    "Neutral": (45, 55),
    "Greed": (55, 70),
    "Extreme Greed": (70, 101),  # upper bound exclusive; 101 so HFGI==100 is included
}

# --- Backtest --------------------------------------------------------------
# Scale into the position in tiers as fear deepens (加倉 / averaging in),
# rather than going all-in the moment HFGI first crosses below 30. Each
# tier fires at most once per holding cycle, in order, at the same three
# HFGI thresholds (30/20/10); the position exits fully once HFGI recovers
# past BACKTEST_SELL_THRESHOLD. Two opposite sizing philosophies:
#
#   pyramid         - biggest tranche first, tapering down as fear deepens
#                      (most conviction at the first, least extreme signal;
#                      caps risk if fear keeps deepening into a real crash)
#   inverse_pyramid - smallest tranche first, growing as fear deepens
#                      (most conviction at the most extreme signal; commits
#                      the most capital at the least certain, most volatile
#                      point — higher risk, higher payoff if it marks the
#                      actual bottom)
ADD_ON_STRATEGIES = {
    "pyramid": [
        {"threshold": 30, "fraction": 0.5},
        {"threshold": 20, "fraction": 0.3},
        {"threshold": 10, "fraction": 0.2},
    ],
    "inverse_pyramid": [
        {"threshold": 30, "fraction": 0.2},
        {"threshold": 20, "fraction": 0.3},
        {"threshold": 10, "fraction": 0.5},
    ],
}
DEFAULT_ADD_ON_STRATEGY = "pyramid"
BACKTEST_BUY_THRESHOLD = ADD_ON_STRATEGIES[DEFAULT_ADD_ON_STRATEGY][0]["threshold"]  # display/back-compat
BACKTEST_SELL_THRESHOLD = 70
# Round-trip cost (commission + slippage) charged on every entry and exit,
# in basis points of the trade price. A prior version ran 39 trades over
# QQQ's history at zero cost, which meaningfully overstated CAGR/Sharpe.
BACKTEST_TRANSACTION_COST_BPS = 10

# --- Paths ------------------------------------------------------------------
DATA_DIR = Path("data")
CACHE_DIR = DATA_DIR / "cache"


def sanitize_ticker(ticker: str) -> str:
    """Turn a yfinance ticker into a filesystem-safe name, e.g. '^VIX' -> 'VIX'."""
    return ticker.replace("^", "").replace(".", "_")
