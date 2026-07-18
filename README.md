# HFGI Pro

A Fear & Greed Index toolkit focused on SK Hynix (SKHY / 000660.KS), built
against the semiconductor sector (SMH, SOXX). The same engine also runs on
a watchlist of other memory/semiconductor-adjacent tickers: `DRAM`
(Roundhill Memory ETF), `QQQ` (Nasdaq-100), `ALAB` (Astera Labs), `NVDA`
(Nvidia), `TSM` (Taiwan Semiconductor), `ASML` (ASML Holding), `PLTR`
(Palantir), `MRVL` (Marvell), `GLW` (Corning), `LITE` (Lumentum), `COHR`
(Coherent), `AAOI` (Applied Optoelectronics) — and `SMH`/`SOXX`
themselves, which double as both a Relative Strength benchmark and a
watchlist subject in their own right, i.e. a sector-wide semiconductor
fear/greed reading. `config.SECTOR_BENCHMARK_TICKERS` (`SMH`, `SOXX`,
`QQQ`, `VOO`) is the full Relative Strength benchmark blend — sector ETFs
plus broad-market ones, so the factor reflects both "vs. the semis
sector" and "vs. the overall market"; a subject that's also in that list
excludes itself from its own benchmark (see Task 3).

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

This downloads OHLCV data for every ticker in `config.TICKERS` (the full
`config.WATCHLIST` plus `000660.KS` and `^VIX`) via `yfinance` through a
reusable, caching `DataLoader`
(`hfgi_pro/data_loader.py`), then runs the full pipeline (indicators → HFGI
engine → backtest) **for each ticker in `config.WATCHLIST`** and writes
everything under `data/`:

- `data/<TICKER>.parquet` — raw OHLCV per ticker
- `data/hfgi_<TICKER>.parquet` — HFGI, State, and each weighted sub-score,
  per watchlist ticker
- `data/backtest_<TICKER>_<STRATEGY>_trades.csv` / `_equity.parquet` — per
  ticker, per add-on strategy (`pyramid` / `inverse_pyramid`, see Task 4)
- `data/backtest_summary.json` — CAGR / Sharpe / Max Drawdown / Win Rate /
  current recommendation, for every watchlist ticker x strategy

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
     + 15% Market Volatility (VIX) + 15% Breadth   [both added beyond the original spec]
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

**Breadth overlay**: inspired by the CNN Fear & Greed Index's "Stock Price
Strength/Breadth" component (advancing/declining stocks, new highs vs.
lows), which we had no equivalent of — every other factor looks at a
single ticker (plus, at most, a couple of benchmarks), never "how many of
its peers are also in trouble." `Breadth_Raw` is the % of the rest of
`config.WATCHLIST` trading above its own `BREADTH_SMA_WINDOW`-day (50)
SMA on that date; `Breadth_Score` percentile-ranks that against its own
history (not inverted — higher breadth already means more greed). It's
computed from each peer's raw price vs. its own SMA, never another
peer's *composite* HFGI, specifically so 15 tickers scoring each other
can't create a circular dependency. A subject that's itself in
`WATCHLIST` excludes itself from its own breadth reading, same rationale
as Relative Strength. Not included in the `calibrate_weights.py` search
yet — re-run that with this factor in the mix rather than trusting its
placeholder weight (15) forever.

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
using `config.SECTOR_BENCHMARK_TICKERS` (`SMH`/`SOXX`/`QQQ`/`VOO`) for
Relative Strength — excluding `subject` itself from that blend if it's
also one of those four (otherwise, e.g., `SOXX`'s Relative Strength would
partly be measured against its own momentum, diluting the signal instead
of reflecting genuine relative performance).
`compute_subscores(price_data, subject)` does the expensive rolling-
percentile work and returns it separately from any particular weighting
(`combine_scores(scores, weights)` applies weights afterward) — this is
what lets `calibrate_weights.py` try hundreds of weight vectors without
recomputing indicators for each one.

**HFGI_Smoothed**: a real SOXX drawdown (peak 2026-06-22, -20% by
2026-07-17) showed raw daily `HFGI` whipsawing back above the buy
threshold several times during the decline before the actual
capitulation. `HFGI_Smoothed` (`config.HFGI_SMOOTHING_WINDOW`-day simple
moving average of `HFGI`, default 3 days) is what add-on/exit decisions
actually trigger off (see Task 4) — `HFGI` itself is kept as the raw,
undelayed daily reading for display.

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

Contrarian strategy, but scaling in rather than going all-in the moment
`HFGI` first crosses below 30: three tiers at `HFGI < 30 / 20 / 10`, each
adding a fraction of a full position (at most one tier fires per day),
then a full exit once `HFGI > 70`. Decisions use `HFGI_Smoothed`, not raw
`HFGI` (falls back to `HFGI` if a hand-built table has no `HFGI_Smoothed`
column) — see Task 3. Two opposite sizing philosophies, both
in `config.ADD_ON_STRATEGIES`:

- **`pyramid`** (金字塔): 50% / 30% / 20% — biggest tranche at the first,
  least extreme signal, tapering down as fear deepens. Caps risk if fear
  keeps deepening into a real crash.
- **`inverse_pyramid`** (倒金字塔): 20% / 30% / 50% — smallest tranche
  first, growing as fear deepens. Commits the most capital at the least
  certain, most volatile point — higher risk, higher payoff if that point
  turns out to mark the actual bottom.

Both fire on the same days (identical thresholds), just sized oppositely.
`run.py` backtests every watchlist ticker under both and writes both to
`data/backtest_summary.json`; in this project's data, `pyramid` currently
comes out ahead on Sharpe for `QQQ`/`NVDA`/`TSM`/`ASML`, `inverse_pyramid`
ahead for `ALAB` (n=8 trades — not enough to read much into that).

Reports CAGR, Sharpe Ratio, Max Drawdown, and Win Rate. A round-trip
transaction cost (`config.BACKTEST_TRANSACTION_COST_BPS`, default 10bps)
is charged proportional to the size of each entry/add-on/exit — a prior
all-in-one-shot version ran 39+ trades over QQQ's history completely
frictionless, which meaningfully overstated CAGR and Sharpe. Pass
`transaction_cost_bps=0` to `run_backtest(...)` to see the frictionless
numbers for comparison.

**加倉建議 (`result.recommendation`)**: every `run_backtest(...)` call
also returns the actionable next step for the *latest* row — "尚未到進場
區間" (not yet in the entry zone), "建議建立第 1/3 批倉位" (enter tranche
1), "建議加碼第 2/3 批" (add tranche 2), "持有中,等待…" (hold, waiting for
the next add-on or exit level), "已滿倉,續抱" (fully in, hold), or "建議
全數出場" (exit). It's computed from the state as of *yesterday's* close
plus *today's* `HFGI` reading — i.e. what today's number calls for you to
do next, not a description of what the backtest already auto-filled today.

### Add-on target prices (`hfgi_pro/price_target.py`)

`run.py` also prints, per ticker, the estimated closing price that would
trigger each add-on tier and the full exit — "加倉目標價格及倉位比例
對應". HFGI depends on far more than price (volume, relative strength, ADR
premium, VIX), so there's no clean algebra from "HFGI < 20" to "price =
$X". `estimate_price_targets(...)` holds every non-price-derived
sub-score at today's actual value, re-derives what a hypothetical
closing price would do to the price-derived ones (Price Momentum, RSI,
MACD, ATR, Drawdown, Relative Strength, and ADR Premium for `SKHY`) via
the same one-step EWM/rolling update the live indicators use, and
bisection-searches for the price where the resulting HFGI matches each
tier threshold — accounting for `HFGI_Smoothed`'s moving average (since
that's what actually triggers a tier), by solving for the *raw* HFGI that,
averaged with the already-known prior `HFGI_SMOOTHING_WINDOW - 1` days,
lands the smoothed value on the target.

This is an estimate, not a guarantee — it assumes the hypothetical day's
High/Low collapse to its Close, and holds Volume/VIX/Breadth fixed even
though a real move that size would likely shift those too (Breadth is
inherently about the rest of the watchlist, so it couldn't be re-derived
from the subject's own hypothetical price anyway).

`estimate_price_targets(...)` returns `{threshold: {"price": ..., "exact":
...}}`. `price` is only `None` when there isn't enough history to
evaluate the model at all (e.g. `SKHY`'s ~6 rows) — otherwise it's always
a number within `[close * PRICE_TARGET_LOW_MULT, close * PRICE_TARGET_HIGH_MULT]`
(±40%/+60% by default): a realistic single-day-move range, not a search
range so wide that hitting its boundary produces a meaningless price (an
earlier version searched 0.05x-3x, so an unreachable tier could show a
"target price" like -95% or +200%, which isn't a real single-day move for
a liquid stock). A large single-day move raises ATR (and thus reads as
more "fear," pulling the score back down) regardless of direction, and
holding Volume/VIX/Breadth fixed adds its own floor/ceiling on top of
that, so a tier's exact HFGI target can still sit outside even this
realistic range — in which case `exact=False` and `price` is the boundary
itself (still meaningful: "not reachable even with a move this large"),
and `run.py` labels it accordingly rather than presenting it as a normal
target price.

`run.py` also only prints tiers *still ahead* of a ticker's current
add-on state — e.g. once a ticker has already filled tranche 1, showing
"target price to enter tranche 1" is moot (it already happened this
cycle); only tranche 2 onward and the exit price are relevant going
forward. This uses the tranche count from `run_backtest`'s result, which
is identical between `pyramid` and `inverse_pyramid` (only the fractions
differ, not the trigger thresholds).

`estimate_price_targets(..., weights=...)` accepts a weights override, so
you can drop a normally-fixed factor from the solve entirely instead of
holding it at today's value — answering "what price would it take if we
don't require volume/VIX to move too." `run.py --exclude-price-target-factors
market_volatility,volume` does this for every ticker (only for the
price-target solve; the live HFGI/backtest keep the full weights). This
generally moves a tier's target price closer to (or within) the exact
range, since the fixed contribution from those factors is removed rather
than pinned at whatever it happens to be today.

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
