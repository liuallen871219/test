"""HFGI Pro pipeline entry point.

Downloads/caches OHLCV data for the configured ticker universe, computes the
HFGI composite index for each ticker in the watchlist, and runs the
contrarian add-on backtest for each under both sizing strategies (pyramid
and inverse_pyramid, see config.ADD_ON_STRATEGIES). Results are written
under `data/`:

  data/<TICKER>.parquet                          raw OHLCV per ticker
  data/hfgi_<TICKER>.parquet                     HFGI, State, and each
                                                  weighted sub-score
  data/backtest_<TICKER>_<STRATEGY>_equity.parquet  strategy equity curve
  data/backtest_<TICKER>_<STRATEGY>_trades.csv      individual tranche trades
  data/backtest_summary.json                     CAGR / Sharpe / Max
                                                  Drawdown / Win Rate /
                                                  current recommendation,
                                                  for every ticker x strategy
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
from hfgi_pro.price_target import estimate_price_targets

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=None, help="Start date, e.g. 2019-01-01")
    parser.add_argument("--end", default=None, help="End date, e.g. 2026-07-18")
    parser.add_argument("--refresh", action="store_true", help="Force re-download, ignoring cache")
    parser.add_argument("--data-dir", default=str(config.DATA_DIR))
    parser.add_argument(
        "--exclude-price-target-factors",
        default="",
        help=(
            "Comma-separated config.HFGI_WEIGHTS keys to drop entirely from the "
            "add-on/exit price-target solve (not from the live HFGI/backtest "
            "itself) — e.g. 'market_volatility,volume'. Those factors are "
            "otherwise held fixed at today's actual value, which can make a "
            "tier mathematically unreachable by price alone; excluding them "
            "answers 'what price would it take if we don't require volume/VIX "
            "to move too'."
        ),
    )
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

    excluded_factors = [f.strip() for f in args.exclude_price_target_factors.split(",") if f.strip()]
    target_weights = {k: v for k, v in engine.weights.items() if k not in excluded_factors}
    if excluded_factors:
        print(f"\n(加倉目標價格計算排除下列因子: {excluded_factors})")

    for subject in config.WATCHLIST:
        if subject not in price_data:
            logger.warning("Skipping %s: no data available.", subject)
            continue

        hfgi_df = engine.compute(price_data, subject=subject)
        tag = config.sanitize_ticker(subject)
        hfgi_df.to_parquet(data_dir / f"hfgi_{tag}.parquet")
        logger.info("Saved %s HFGI scores -> %s", subject, data_dir / f"hfgi_{tag}.parquet")

        print(f"\n=== {subject}: HFGI (last 5 rows) ===")
        print(hfgi_df[["HFGI", "State"]].tail())

        tier_thresholds = [t["threshold"] for t in config.ADD_ON_STRATEGIES[config.DEFAULT_ADD_ON_STRATEGY]]
        all_thresholds = tier_thresholds + [config.BACKTEST_SELL_THRESHOLD]
        price_targets = estimate_price_targets(price_data, subject, all_thresholds, engine=engine, weights=target_weights)
        last_close = float(hfgi_df["Close"].dropna().iloc[-1]) if hfgi_df["Close"].notna().any() else None

        still_fixed = [f for f in ("volume", "market_volatility") if f not in excluded_factors]
        unreachable_msg = (
            f"無法僅靠價格達成(需搭配{'/'.join(still_fixed)}變化)" if still_fixed
            else "無法僅靠價格達成(即使排除成交量/VIX,單日價格波動幅度仍不足)"
        )

        print(f"{subject} 加倉/出場目標價格 (現價 {last_close}):")
        for strategy_name, tiers in config.ADD_ON_STRATEGIES.items():
            print(f"  [{strategy_name}]")
            for tier in tiers:
                price = price_targets.get(tier["threshold"])
                pct = f"{(price / last_close - 1) * 100:+.1f}%" if price and last_close else "N/A"
                price_str = f"{price:.2f}" if price else unreachable_msg
                print(f"    HFGI<{tier['threshold']} 加碼{tier['fraction'] * 100:.0f}% -> 目標價 {price_str} ({pct})")
        exit_price = price_targets.get(config.BACKTEST_SELL_THRESHOLD)
        exit_pct = f"{(exit_price / last_close - 1) * 100:+.1f}%" if exit_price and last_close else "N/A"
        exit_str = f"{exit_price:.2f}" if exit_price else unreachable_msg
        print(f"    HFGI>{config.BACKTEST_SELL_THRESHOLD} 全數出場 -> 目標價 {exit_str} ({exit_pct})")

        all_summaries[subject] = {
            "last_close": last_close,
            "price_targets": {str(k): v for k, v in price_targets.items()},
            "price_target_excluded_factors": excluded_factors,
        }
        for strategy_name, tiers in config.ADD_ON_STRATEGIES.items():
            result = run_backtest(hfgi_df, tiers=tiers)
            summary = result.summary()
            summary["recommendation"] = result.recommendation
            all_summaries[subject][strategy_name] = summary

            result.trades.to_csv(data_dir / f"backtest_{tag}_{strategy_name}_trades.csv", index=False)
            result.equity_curve.to_frame("Equity").to_parquet(
                data_dir / f"backtest_{tag}_{strategy_name}_equity.parquet"
            )
            logger.info("%s [%s] backtest summary: %s", subject, strategy_name, summary)
            print(f"{subject} [{strategy_name}]: {summary}")
            print(f"  -> {result.recommendation['message']}")

    (data_dir / "backtest_summary.json").write_text(json.dumps(all_summaries, indent=2, default=str))
    print("\n=== HFGI Pro pipeline complete ===")


if __name__ == "__main__":
    main()
