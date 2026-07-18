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

import pandas as pd

from hfgi_pro import config
from hfgi_pro.backtest import run_backtest
from hfgi_pro.data_loader import DataLoader
from hfgi_pro.engine import HFGIEngine, combine_scores
from hfgi_pro.price_target import estimate_price_targets
from hfgi_pro.put_call import fetch_put_call_score

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=None, help="Start date, e.g. 2019-01-01")
    parser.add_argument("--end", default=None, help="End date, e.g. 2026-07-18")
    parser.add_argument("--refresh", action="store_true", help="Force re-download, ignoring cache")
    parser.add_argument("--data-dir", default=str(config.DATA_DIR))
    parser.add_argument(
        "--skip-put-call",
        action="store_true",
        help=(
            "Skip the live Put/Call ratio fetch (config.PUT_CALL_TICKER options "
            "chain). It's a live network call with no historical equivalent "
            "(see hfgi_pro/put_call.py), so it only ever adjusts *today's* "
            "reading, never the backtest; skip it if you don't need that or "
            "want a fully offline/deterministic run."
        ),
    )
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

    put_call_info = None
    if not args.skip_put_call:
        put_call_info = fetch_put_call_score()
        if put_call_info is not None:
            print(
                f"\nPut/Call ratio ({config.PUT_CALL_TICKER}, 即時, 非歷史序列): "
                f"{put_call_info['ratio']:.3f} -> score {put_call_info['score']:.1f}"
            )
        else:
            logger.warning("Could not fetch live Put/Call ratio; skipping that overlay.")

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

        adjusted_today = None
        if put_call_info is not None:
            score_cols = [c for c in hfgi_df.columns if c.endswith("_Score")]
            last_scores = hfgi_df[score_cols].iloc[[-1]].copy()
            last_scores["PutCall_Score"] = put_call_info["score"]
            adjusted_today = float(combine_scores(last_scores, engine.weights).iloc[0])
            raw_today = hfgi_df["HFGI"].iloc[-1]
            if pd.notna(raw_today):
                print(
                    f"  即時調整後 HFGI(含 Put/Call,僅供今天參考,不影響回測): "
                    f"{adjusted_today:.1f}(原始 {raw_today:.1f})"
                )

        # Run the backtests first: both strategies share the same tier
        # thresholds (only the fractions differ), so tranche_count is
        # identical between them — it tells us which tiers are still ahead
        # vs. already triggered this cycle, so we don't print a "target
        # price" for a tier that's moot because it already fired.
        backtest_results = {}
        for strategy_name, tiers in config.ADD_ON_STRATEGIES.items():
            result = run_backtest(hfgi_df, tiers=tiers)
            backtest_results[strategy_name] = result
            result.trades.to_csv(data_dir / f"backtest_{tag}_{strategy_name}_trades.csv", index=False)
            result.equity_curve.to_frame("Equity").to_parquet(
                data_dir / f"backtest_{tag}_{strategy_name}_equity.parquet"
            )

        any_result = next(iter(backtest_results.values()))
        current_tranche_count = int(any_result.tranche_count.iloc[-1]) if len(any_result.tranche_count) else 0
        n_tiers = len(config.ADD_ON_STRATEGIES[config.DEFAULT_ADD_ON_STRATEGY])

        upcoming_thresholds = [
            t["threshold"] for t in config.ADD_ON_STRATEGIES[config.DEFAULT_ADD_ON_STRATEGY][current_tranche_count:]
        ]
        all_thresholds = upcoming_thresholds + [config.BACKTEST_SELL_THRESHOLD]
        price_targets = estimate_price_targets(price_data, subject, all_thresholds, engine=engine, weights=target_weights)
        last_close = float(hfgi_df["Close"].dropna().iloc[-1]) if hfgi_df["Close"].notna().any() else None

        def format_target(threshold):
            info = price_targets.get(threshold, {"price": None, "exact": False})
            price = info["price"]
            if price is None or last_close is None:
                return "歷史資料不足,無法估計", "N/A"
            pct = f"{(price / last_close - 1) * 100:+.1f}%"
            note = "" if info["exact"] else " (未達門檻:即使漲跌到此仍不夠,非精確解)"
            return f"{price:.2f}{note}", pct

        print(f"{subject} 加倉/出場目標價格 (現價 {last_close}, 目前 {current_tranche_count}/{n_tiers} 批已進場):")
        if current_tranche_count >= n_tiers:
            print("    已滿倉,無下一批加碼門檻")
        else:
            for strategy_name, tiers in config.ADD_ON_STRATEGIES.items():
                print(f"  [{strategy_name}] 剩餘可加碼批次:")
                for tier in tiers[current_tranche_count:]:
                    price_str, pct = format_target(tier["threshold"])
                    print(f"    HFGI<{tier['threshold']} 加碼{tier['fraction'] * 100:.0f}% -> 目標價 {price_str} ({pct})")
        exit_str, exit_pct = format_target(config.BACKTEST_SELL_THRESHOLD)
        print(f"    HFGI>{config.BACKTEST_SELL_THRESHOLD} 全數出場 -> 目標價 {exit_str} ({exit_pct})")

        all_summaries[subject] = {
            "last_close": last_close,
            "current_tranche_count": current_tranche_count,
            "price_targets": {str(k): v for k, v in price_targets.items()},
            "price_target_excluded_factors": excluded_factors,
            "put_call": put_call_info,
            "hfgi_adjusted_for_put_call": adjusted_today,
        }
        for strategy_name, result in backtest_results.items():
            summary = result.summary()
            summary["recommendation"] = result.recommendation
            all_summaries[subject][strategy_name] = summary
            logger.info("%s [%s] backtest summary: %s", subject, strategy_name, summary)
            print(f"{subject} [{strategy_name}]: {summary}")
            print(f"  -> {result.recommendation['message']}")

    (data_dir / "backtest_summary.json").write_text(json.dumps(all_summaries, indent=2, default=str))
    print("\n=== HFGI Pro pipeline complete ===")


if __name__ == "__main__":
    main()
