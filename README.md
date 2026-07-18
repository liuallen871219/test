# HFGI Pro

A Fear & Greed Index toolkit focused on SK Hynix (SKHY / 000660.KS), built
against the semiconductor sector (SMH, SOXX). The same engine also runs on
a watchlist of other memory/semiconductor-adjacent tickers: `DRAM`
(Roundhill Memory ETF), `QQQ` (Nasdaq-100), `ALAB` (Astera Labs), `NVDA`
(Nvidia), `TSM` (Taiwan Semiconductor), and `ASML` (ASML Holding).

## Setup

```bash
pip install -r requirements.txt
```

## Task 1 — Data pipeline

```bash
python run.py                       # default date range (full history)
python run.py --start 2019-01-01 --end 2026-07-18
python run.py --refresh             # bypass the cache and force re-download
```

This downloads OHLCV data for every ticker in `config.TICKERS` (the
watchlist `SKHY`/`DRAM`/`QQQ`/`ALAB`/`NVDA`/`TSM`/`ASML`, plus `000660.KS`,
`SMH`, `SOXX`, `^VIX`) via `yfinance` through a reusable, caching `DataLoader`
(`hfgi_pro/data_loader.py`), then runs the full pipeline (indicators → HFGI
engine → backtest) **for each ticker in `config.WATCHLIST`** and writes
everything under `data/`:

- `data/<TICKER>.parquet` — raw OHLCV per ticker
- `data/hfgi_<TICKER>.parquet` — HFGI, State, and each weighted sub-score,
  per watchlist ticker
- `data/backtest_<TICKER>_trades.csv` / `_equity.parquet` — per ticker
- `data/backtest_summary.json` — CAGR / Sharpe / Max Drawdown / Win Rate
  for every watchlist ticker, keyed by ticker

Cached downloads live in `data/cache/` and are reused for up to 24h before a
fresh download is attempted; date-range filtering is applied in memory on
top of the cached full history, so requesting a different `--start/--end`
never forces a re-download.

## Task 2 — Technical indicators (`hfgi_pro/indicators.py`)

RSI(14), MACD, ATR, SMA(20/50/125), Drawdown, and Volume Ratio.

## Task 3 — HFGI Engine (`hfgi_pro/engine.py`)

The original spec's weights (all in `config.HFGI_WEIGHTS`):

```
HFGI = 20% Price Momentum + 15% RSI + 15% MACD + 15% Volume
     + 10% ATR + 10% Relative Strength + 10% Drawdown + 15% ADR Premium
     + 15% Market Volatility (VIX)   [added beyond the original spec]
```

`config.HFGI_WEIGHTS` currently holds `calibrate_weights.py`'s calibrated
result instead (see **Weight calibration** below) — the original numbers
above are kept in a comment in `config.py` if you want to revert.

Each raw indicator is turned into a 0-100 "sub-score" via a rolling
252-day percentile rank — **including RSI**, ranked against its own
history rather than used as a raw 0-100 reading, so every factor is on
the same relative scale and the weights are actually comparable to each
other (ATR and VIX are inverted since higher volatility/fear reads as
fear). The engine divides by whichever weight is actually available per
row, so the weights don't need to sum to any particular total. Output
columns: `HFGI`, `State`, each `*_Score` column, and `LookbackDays` (see
below).

**LookbackDays**: a newly-listed ticker's percentile ranks are computed
against however much history actually exists, not a full 252-day window —
statistically noisier, even though the 0-100 number looks the same. This
column reports how many days of history backed each row's ranks (capped
at 252) so you can tell a thin, noisy reading from a well-supported one
at a glance, instead of it being silently hidden.

**Market Volatility (VIX) overlay**: the original 8-factor spec only looks
at each subject's own price action, so it has no way to distinguish
"this specific stock is being sold off" from "the whole market is
risk-off" — a systemic sell-off reads identically to idiosyncratic
weakness. `MarketVolatility_Score` is `^VIX`'s rolling percentile rank,
inverted (elevated VIX -> low score), applied identically to every
watchlist subject. If `^VIX` data isn't available it's simply omitted,
same graceful degradation as ADR Premium below.

**Note on ADR Premium**: no FX-rate ticker was available, so `ADR Premium`
is approximated as the cumulative-return spread between SKHY and
000660.KS rather than an FX-adjusted price premium. It only applies to
`SKHY` itself — for the other watchlist tickers (`DRAM`, `QQQ`, `ALAB`,
which have no ADR pair) it's simply omitted; the NaN-tolerant weighted
average re-normalizes over whichever sub-scores are available for a
given row (so a single missing sub-score, e.g. no ADR reference or no
VIX data, no longer blanks out the whole composite).

`HFGIEngine.compute(price_data, subject=...)` computes the index for any
one ticker in `price_data` (defaults to `config.PRIMARY_TICKER`), always
using `config.SECTOR_BENCHMARK_TICKERS` (SMH/SOXX) for Relative Strength.
`compute_subscores(price_data, subject)` does the expensive rolling-
percentile work and returns it separately from any particular weighting
(`combine_scores(scores, weights)` applies weights afterward) — this is
what lets `calibrate_weights.py` try hundreds of weight vectors without
recomputing indicators for each one.

### Weight calibration (`calibrate_weights.py`)

```bash
python calibrate_weights.py --trials 500 --seed 0
```

The original weights were hand-picked (from the spec, then the VIX
overlay added on top of that), never empirically checked. This script
random-searches weight vectors and scores each by median backtest Sharpe
ratio across `QQQ`/`ALAB`/`NVDA`/`TSM`/`ASML` (tickers with enough real
history to backtest; `SKHY`/`DRAM` are excluded as too short), then
reports the best candidates and writes them to
`data/calibrated_weights.json`. `config.HFGI_WEIGHTS` currently holds the
"mean of the top 20 trials" result from a 500-trial run (median Sharpe
0.56 vs. 0.43 for the original weights) — averaging the top-K is more
robust than taking the single best trial, which tends to just be a lucky
corner of a noisy search space.

**Take this with real skepticism**: it's an in-sample search over 5
correlated large-cap tech/semiconductor names across one overlapping
history window (mostly a bull market plus the 2022 drawdown), not an
out-of-sample-validated result. Winning a random search over a small,
correlated sample is a plausible starting point, not proof it'll hold up
going forward — re-run it periodically rather than trusting these
weights forever, and be more convinced by a candidate that's stable
across re-runs with different seeds than by any single run's #1.

## Task 4 — Backtest (`hfgi_pro/backtest.py`)

Contrarian long-only strategy: buy when `HFGI < 30`, sell when `HFGI > 70`.
Reports CAGR, Sharpe Ratio, Max Drawdown, and Win Rate.

A round-trip transaction cost (`config.BACKTEST_TRANSACTION_COST_BPS`,
default 10bps) is charged on every entry and every exit — a prior version
ran 39+ trades over QQQ's history completely frictionless, which
meaningfully overstated CAGR and Sharpe. Pass `transaction_cost_bps=0` to
`run_backtest(...)` to see the frictionless numbers for comparison.

## Task 5 — Dashboard (`dashboard.py`)

```bash
streamlit run dashboard.py
```

A dropdown lets you pick any ticker in `config.WATCHLIST`. Shows the HFGI
curve, price with SMAs and Buy/Sell markers, RSI, MACD, volume, the VIX
overlay, and (for `SKHY` only) the ADR Premium proxy.

## Tests

```bash
pytest
```

Indicator, engine, and backtest logic are covered with synthetic data (no
network access required).

## Known limitations

- `yfinance`'s HTTP client (`curl_cffi`) does browser-TLS-fingerprint
  impersonation, which TLS-inspecting egress proxies (corporate networks,
  some sandboxes) reset instead of tunneling. `hfgi_pro/data_loader.py`
  sets `YF_DISABLE_CURL_CFFI=1` by default so `yfinance` falls back to its
  officially supported plain-`requests` path, which works through such
  proxies; set that env var to `0` before importing the package if you'd
  rather keep curl_cffi's fingerprint impersonation.
- `SKHY` (SK Hynix's Nasdaq listing) only started trading around
  2026-07-10, so until it accumulates more history, RSI(14) and the
  252-day rolling-percentile sub-scores stay `NaN` and the backtest has no
  trades — `run.py` still completes (it no longer crashes on empty data),
  it just has nothing to show yet for the primary ticker. `000660.KS`,
  `SMH`, and `SOXX` all have full history today, so pointing
  `config.PRIMARY_TICKER` at one of them (e.g. for a demo) already
  produces a real HFGI curve and backtest.
