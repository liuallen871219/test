# HFGI Pro

A Fear & Greed Index toolkit focused on SK Hynix (SKHY / 000660.KS), built
against the semiconductor sector (SMH, SOXX).

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

This downloads OHLCV data for `SKHY`, `000660.KS`, `SMH`, `SOXX`, `^VIX` via
`yfinance` through a reusable, caching `DataLoader`
(`hfgi_pro/data_loader.py`), then runs the full pipeline (indicators → HFGI
engine → backtest) and writes everything under `data/`:

- `data/<TICKER>.parquet` — raw OHLCV per ticker
- `data/hfgi.parquet` — HFGI, State, and each weighted sub-score
- `data/backtest_summary.json` — CAGR / Sharpe / Max Drawdown / Win Rate
- `data/backtest_trades.csv` — individual trades
- `data/backtest_equity.parquet` — strategy equity curve

Cached downloads live in `data/cache/` and are reused for up to 24h before a
fresh download is attempted; date-range filtering is applied in memory on
top of the cached full history, so requesting a different `--start/--end`
never forces a re-download.

## Task 2 — Technical indicators (`hfgi_pro/indicators.py`)

RSI(14), MACD, ATR, SMA(20/50/125), Drawdown, and Volume Ratio.

## Task 3 — HFGI Engine (`hfgi_pro/engine.py`)

```
HFGI = 20% Price Momentum + 15% RSI + 15% MACD + 15% Volume
     + 10% ATR + 10% Relative Strength + 10% Drawdown + 15% ADR Premium
```

Each raw indicator is turned into a 0-100 "sub-score" via a rolling
252-day percentile rank (RSI is already 0-100 and used directly; ATR is
inverted since higher volatility reads as fear). The weights above sum to
110, so the engine divides by the actual weight total to keep the final
`HFGI` on a 0-100 scale. Output columns: `HFGI`, `State`, and each
`*_Score` column.

**Note on ADR Premium**: no FX-rate ticker was available, so `ADR Premium`
is approximated as the cumulative-return spread between SKHY and
000660.KS rather than an FX-adjusted price premium. `^VIX` is downloaded
and cached for future macro-overlay use but isn't yet part of the formula.

## Task 4 — Backtest (`hfgi_pro/backtest.py`)

Contrarian long-only strategy: buy when `HFGI < 30`, sell when `HFGI > 70`.
Reports CAGR, Sharpe Ratio, Max Drawdown, and Win Rate.

## Task 5 — Dashboard (`dashboard.py`)

```bash
streamlit run dashboard.py
```

Shows the HFGI curve, price with SMAs and Buy/Sell markers, RSI, MACD,
volume, and the ADR Premium proxy.

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
