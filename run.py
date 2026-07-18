"""HFGI Pro pipeline entry point.

Downloads/caches OHLCV data for the configured ticker universe, computes the
HFGI composite index for each ticker in the watchlist, and runs the
contrarian backtest for each. Results are written under `data/`:

  data/<TICKER>.parquet                  raw OHLCV per ticker
  data/hfgi_<TICKER>.parquet             HFGI, State, and each weighted
                                          sub-score, per watchlist ticker
  data/backtest_<TICKER>_equity.parquet  strategy equity curve, per ticker
  data/backtest_<TICKER>_trades.csv      individual trades, per ticker
  data/backtest_summary.json             CAGR / Sharpe / Max Drawdown /
                                          Win Rate for every watchlist ticker
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from hfgi_pro import config
from hfgi_pro.backtest import run_backtest
from hfgi_pro.data_loader import DataLoader
from hfgi_pro.engine import HFGIEngine

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=None, help="Start date, e.g. 2019-01-01")
    parser.add_argument("--end", default=None, help="End date, e.g. 2026-07-18")
    parser.add_argument("--refresh", action="store_true", help="Force re-download, ignoring cache")
    parser.add_argument("--data-dir", default=str(config.DATA_DIR))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    loader = DataLoader()
    price_data = loader.get_many(config.TICKERS, start=args.start, end=args.end, refresh=args.refresh)

    for ticker, df in price_data.items():
        out_path = data_dir / f"{config.sanitize_ticker(ticker)}.parquet"
        df.to_parquet(out_path)
        logger.info("Saved %s (%d rows) -> %s", ticker, len(df), out_path)

    engine = HFGIEngine()
    all_summaries = {}

    for subject in config.WATCHLIST:
        if subject not in price_data:
            logger.warning("Skipping %s: no data available.", subject)
            continue

        hfgi_df = engine.compute(price_data, subject=subject)
        tag = config.sanitize_ticker(subject)
        hfgi_df.to_parquet(data_dir / f"hfgi_{tag}.parquet")
        logger.info("Saved %s HFGI scores -> %s", subject, data_dir / f"hfgi_{tag}.parquet")

        result = run_backtest(hfgi_df)
        summary = result.summary()
        all_summaries[subject] = summary
        result.trades.to_csv(data_dir / f"backtest_{tag}_trades.csv", index=False)
        result.equity_curve.to_frame("Equity").to_parquet(data_dir / f"backtest_{tag}_equity.parquet")
        logger.info("%s backtest summary: %s", subject, summary)

        print(f"\n=== {subject}: HFGI (last 5 rows) ===")
        print(hfgi_df[["HFGI", "State"]].tail())
        print(f"{subject} backtest summary: {summary}")

    (data_dir / "backtest_summary.json").write_text(json.dumps(all_summaries, indent=2, default=str))
    print("\n=== HFGI Pro pipeline complete ===")


if __name__ == "__main__":
    main()
