"""HFGI Pro pipeline entry point.

Downloads/caches OHLCV data for the configured ticker universe, computes the
HFGI composite index, and runs the contrarian backtest. Results are written
under `data/`:

  data/<TICKER>.parquet          raw OHLCV per ticker
  data/hfgi.parquet              HFGI, State, and each weighted sub-score
  data/backtest_equity.parquet   strategy equity curve
  data/backtest_trades.csv       individual trades
  data/backtest_summary.json     CAGR / Sharpe / Max Drawdown / Win Rate
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

    if config.PRIMARY_TICKER not in price_data:
        raise RuntimeError(
            f"Failed to obtain data for primary ticker {config.PRIMARY_TICKER!r}; aborting."
        )

    for ticker, df in price_data.items():
        out_path = data_dir / f"{config.sanitize_ticker(ticker)}.parquet"
        df.to_parquet(out_path)
        logger.info("Saved %s (%d rows) -> %s", ticker, len(df), out_path)

    engine = HFGIEngine()
    hfgi_df = engine.compute(price_data)
    hfgi_df.to_parquet(data_dir / "hfgi.parquet")
    logger.info("Saved HFGI scores -> %s", data_dir / "hfgi.parquet")

    result = run_backtest(hfgi_df)
    summary = result.summary()
    (data_dir / "backtest_summary.json").write_text(json.dumps(summary, indent=2, default=str))
    result.trades.to_csv(data_dir / "backtest_trades.csv", index=False)
    result.equity_curve.to_frame("Equity").to_parquet(data_dir / "backtest_equity.parquet")
    logger.info("Backtest summary: %s", summary)

    print("\n=== HFGI Pro pipeline complete ===")
    print(hfgi_df[["HFGI", "State"]].tail())
    print("\nBacktest summary:")
    for key, value in summary.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
