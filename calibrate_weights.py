"""Exploratory random-search calibration for HFGI_WEIGHTS.

The default weights (from the original spec, plus the VIX overlay added
later) were never anything but hand-picked. This script searches over
random weight vectors and scores each by the median backtest Sharpe ratio
across a handful of watchlist tickers with enough real history to be
worth backtesting, then reports the best candidates found.

CAVEAT: this evaluates on ~5 correlated large-cap tech/semiconductor
names over one overlapping (mostly bullish, with a 2022 drawdown) stretch
of history. A weight vector that wins this search is not a validated,
out-of-sample-tested result — it is a plausible starting point at best,
picked to beat this specific small sample. Treat it as such; don't mistake
"won a 500-trial random search over 5 correlated tickers" for "will
outperform going forward."

Usage: python calibrate_weights.py [--trials 500] [--seed 0]
"""

from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

from hfgi_pro import config
from hfgi_pro.backtest import run_backtest
from hfgi_pro.data_loader import DataLoader
from hfgi_pro.engine import HFGIEngine, combine_scores

# Tickers with enough real trading history to make a backtest meaningful.
# SKHY (~6 days) and DRAM (~73 days) are excluded: too little history for
# their Sharpe ratios to mean anything.
CALIBRATION_TICKERS = ["QQQ", "ALAB", "NVDA", "TSM", "ASML"]
MIN_TRADES = 3


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trials", type=int, default=500)
    parser.add_argument("--seed", type=int, default=0)
    return parser.parse_args()


def sample_weights(rng: np.random.Generator) -> dict:
    """Dirichlet-sample a weight vector over the 9 HFGI factors, summing to
    100, with a floor so no factor gets weighted out entirely.
    """
    keys = list(config.HFGI_WEIGHTS.keys())
    raw = rng.dirichlet(np.full(len(keys), 2.0)) * 100
    floored = np.clip(raw, 3.0, None)
    floored = floored / floored.sum() * 100
    return dict(zip(keys, floored))


def build_hfgi_df(ind: pd.DataFrame, scores: pd.DataFrame, weights: dict) -> pd.DataFrame:
    hfgi = combine_scores(scores, weights)
    df = pd.DataFrame(index=ind.index)
    df["HFGI"] = hfgi
    df["Close"] = ind["Close"]
    return df


def median_sharpe(scored_tickers: dict, weights: dict) -> float:
    sharpes = []
    for ind, scores, _extras in scored_tickers.values():
        hfgi_df = build_hfgi_df(ind, scores, weights)
        result = run_backtest(hfgi_df)
        if len(result.trades) >= MIN_TRADES and result.sharpe_ratio == result.sharpe_ratio:
            sharpes.append(result.sharpe_ratio)
    if not sharpes:
        return float("-inf")
    return float(np.median(sharpes))


def main() -> None:
    args = parse_args()
    rng = np.random.default_rng(args.seed)

    loader = DataLoader()
    tickers = sorted(set(CALIBRATION_TICKERS + config.SECTOR_BENCHMARK_TICKERS + [config.MARKET_VOLATILITY_TICKER]))
    price_data = loader.get_many(tickers)

    engine = HFGIEngine()
    scored_tickers = {}
    for ticker in CALIBRATION_TICKERS:
        if ticker not in price_data:
            print(f"Skipping {ticker}: no data.")
            continue
        ind, scores, extras = engine.compute_subscores(price_data, subject=ticker)
        scored_tickers[ticker] = (ind, scores, extras)

    baseline_score = median_sharpe(scored_tickers, config.HFGI_WEIGHTS)
    print(f"Baseline (current config.HFGI_WEIGHTS) median Sharpe: {baseline_score:.3f}")
    print(f"  weights: {config.HFGI_WEIGHTS}\n")

    results = []
    for _ in range(args.trials):
        weights = sample_weights(rng)
        score = median_sharpe(scored_tickers, weights)
        results.append((score, weights))

    results.sort(key=lambda r: r[0], reverse=True)

    print(f"Top 5 of {args.trials} random weight vectors (median Sharpe across "
          f"{list(scored_tickers.keys())}):\n")
    for rank, (score, weights) in enumerate(results[:5], start=1):
        rounded = {k: round(v, 1) for k, v in weights.items()}
        print(f"#{rank}: median Sharpe={score:.3f}  weights={rounded}")

    # A single "winning" trial can just be a lucky corner of a noisy search
    # space (the top 5 above rarely agree on individual weights even though
    # their scores are close). Averaging the top-K candidates is a more
    # robust recommendation than taking #1 at face value.
    top_k = 20
    top_weights = [w for _, w in results[:top_k]]
    keys = list(config.HFGI_WEIGHTS.keys())
    averaged = {k: float(np.mean([w[k] for w in top_weights])) for k in keys}
    averaged_score = median_sharpe(scored_tickers, averaged)
    print(f"\nRobust recommendation (mean of top {top_k}), re-scored median Sharpe={averaged_score:.3f}:")
    print(f"  {{{', '.join(f'{k!r}: {round(v, 1)}' for k, v in averaged.items())}}}")

    with open("data/calibrated_weights.json", "w") as f:
        json.dump(
            {
                "baseline_sharpe": baseline_score,
                "best_trial": {"median_sharpe": results[0][0], "weights": results[0][1]},
                "averaged_top_k": {"k": top_k, "median_sharpe": averaged_score, "weights": averaged},
            },
            f, indent=2,
        )
    print("\nFull results written to data/calibrated_weights.json")
    print(
        "\nReminder: this is a small-sample, in-sample search (5 correlated "
        "tickers, one overlapping history window) — a good showing here is "
        "a starting point to sanity-check, not a validated result."
    )


if __name__ == "__main__":
    main()
