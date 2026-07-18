"""Contrarian backtest: scale into the position as HFGI signals deepening
fear (加倉 / averaging in via tiers), and exit fully once HFGI recovers
into greed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd

from . import config

TRADING_DAYS_PER_YEAR = 252
TRADES_COLUMNS = ["entry_date", "exit_date", "entry_price", "exit_price", "fraction", "return"]


@dataclass
class BacktestResult:
    equity_curve: pd.Series
    positions: pd.Series       # fractional exposure, 0..1
    tranche_count: pd.Series   # how many tiers have fired in the current cycle
    trades: pd.DataFrame       # one row per tranche fill, sharing its cycle's exit
    cagr: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    recommendation: dict

    def summary(self) -> dict:
        return {
            "cagr": self.cagr,
            "sharpe_ratio": self.sharpe_ratio,
            "max_drawdown": self.max_drawdown,
            "win_rate": self.win_rate,
            "num_trades": len(self.trades),
        }


def _empty_result(recommendation: dict = None) -> BacktestResult:
    return BacktestResult(
        equity_curve=pd.Series(dtype=float),
        positions=pd.Series(dtype=float),
        tranche_count=pd.Series(dtype=int),
        trades=pd.DataFrame(columns=TRADES_COLUMNS),
        cagr=float("nan"),
        sharpe_ratio=float("nan"),
        max_drawdown=float("nan"),
        win_rate=float("nan"),
        recommendation=recommendation or {"action": "no_data", "message": "歷史資料不足,尚無法產生建議。"},
    )


def _build_positions(hfgi: pd.Series, tiers: List[Dict], sell_threshold: float):
    """State machine: fill tiers in order as HFGI drops through each
    threshold (at most one tier per day), fully exit once HFGI rises past
    sell_threshold. Returns (position, tranche_count) series.
    """
    n = len(hfgi)
    position = np.zeros(n, dtype=float)
    tranche_count = np.zeros(n, dtype=int)
    filled = 0
    exposure = 0.0
    for i, value in enumerate(hfgi.values):
        if filled > 0 and value > sell_threshold:
            filled = 0
            exposure = 0.0
        elif filled < len(tiers) and value < tiers[filled]["threshold"]:
            exposure += tiers[filled]["fraction"]
            filled += 1
        position[i] = exposure
        tranche_count[i] = filled
    return (
        pd.Series(position, index=hfgi.index, name="Position"),
        pd.Series(tranche_count, index=hfgi.index, name="TrancheCount"),
    )


def _build_trades(
    close: pd.Series, position: pd.Series, tranche_count: pd.Series, transaction_cost_bps: float
) -> pd.DataFrame:
    if position.empty:
        return pd.DataFrame(columns=TRADES_COLUMNS)

    round_trip_cost = 2 * (transaction_cost_bps / 10_000.0)
    entry_only_cost = transaction_cost_bps / 10_000.0

    trades = []
    open_entries: List[dict] = []  # tranches filled in the current holding cycle
    prev_tc = 0
    prev_position = 0.0

    for date in position.index:
        tc = int(tranche_count.loc[date])
        pos = float(position.loc[date])

        if tc > prev_tc:
            open_entries.append(
                {"entry_date": date, "entry_price": float(close.loc[date]), "fraction": pos - prev_position}
            )
        elif tc == 0 and prev_tc > 0:
            exit_date, exit_price = date, float(close.loc[date])
            for entry in open_entries:
                trades.append(
                    {
                        **entry,
                        "exit_date": exit_date,
                        "exit_price": exit_price,
                        "return": exit_price / entry["entry_price"] - 1.0 - round_trip_cost,
                    }
                )
            open_entries = []

        prev_tc, prev_position = tc, pos

    if open_entries:
        # Cycle never closed out (still holding at the end of the data): mark
        # to market at the last available price, only entry-side cost paid so far.
        exit_date, exit_price = position.index[-1], float(close.iloc[-1])
        for entry in open_entries:
            trades.append(
                {
                    **entry,
                    "exit_date": exit_date,
                    "exit_price": exit_price,
                    "return": exit_price / entry["entry_price"] - 1.0 - entry_only_cost,
                }
            )

    return pd.DataFrame(trades, columns=TRADES_COLUMNS)


def _recommend_action(hfgi_value: float, tranche_count: int, tiers: List[Dict], sell_threshold: float) -> dict:
    n_tiers = len(tiers)
    if pd.isna(hfgi_value):
        return {"action": "no_data", "message": "歷史資料不足,尚無法產生建議。"}

    if tranche_count >= n_tiers:
        if hfgi_value > sell_threshold:
            return {
                "action": "exit",
                "message": f"HFGI={hfgi_value:.1f} > {sell_threshold},已滿倉({n_tiers}/{n_tiers}),建議全數出場。",
            }
        return {
            "action": "hold_full",
            "message": f"已滿倉({n_tiers}/{n_tiers}),續抱,等待出場點(HFGI > {sell_threshold})。",
        }

    if tranche_count == 0:
        if hfgi_value < tiers[0]["threshold"]:
            return {
                "action": "enter",
                "message": (
                    f"HFGI={hfgi_value:.1f} < {tiers[0]['threshold']},建議建立第 1/{n_tiers} 批倉位"
                    f"({tiers[0]['fraction'] * 100:.0f}%)。"
                ),
            }
        return {
            "action": "wait",
            "message": f"HFGI={hfgi_value:.1f},尚未到進場區間(< {tiers[0]['threshold']})。",
        }

    if hfgi_value > sell_threshold:
        return {
            "action": "exit",
            "message": f"HFGI={hfgi_value:.1f} > {sell_threshold},持有 {tranche_count}/{n_tiers} 批,建議全數出場。",
        }
    next_tier = tiers[tranche_count]
    if hfgi_value < next_tier["threshold"]:
        return {
            "action": "add",
            "message": (
                f"HFGI={hfgi_value:.1f} < {next_tier['threshold']},建議加碼第 {tranche_count + 1}/{n_tiers} 批"
                f"(+{next_tier['fraction'] * 100:.0f}%)。"
            ),
        }
    return {
        "action": "hold",
        "message": (
            f"持有中({tranche_count}/{n_tiers} 批),等待加碼點(HFGI < {next_tier['threshold']})"
            f"或出場點(HFGI > {sell_threshold})。"
        ),
    }


def run_backtest(
    hfgi_df: pd.DataFrame,
    tiers: List[Dict] = None,
    sell_threshold: float = config.BACKTEST_SELL_THRESHOLD,
    transaction_cost_bps: float = config.BACKTEST_TRANSACTION_COST_BPS,
) -> BacktestResult:
    tiers = tiers or config.ADD_ON_STRATEGIES[config.DEFAULT_ADD_ON_STRATEGY]
    # Add-on/exit decisions trigger off the smoothed HFGI series when it's
    # available (a real SOXX drawdown showed raw daily HFGI whipsawing back
    # above the buy threshold several times before the actual capitulation);
    # ad-hoc HFGI tables built without HFGI_Smoothed fall back to raw HFGI.
    decision_col = "HFGI_Smoothed" if "HFGI_Smoothed" in hfgi_df.columns else "HFGI"
    df = hfgi_df.dropna(subset=[decision_col, "Close"]).copy()

    if df.empty:
        return _empty_result()

    position, tranche_count = _build_positions(df[decision_col], tiers, sell_threshold)
    daily_return = df["Close"].pct_change().fillna(0)
    strategy_return = position.shift(1).fillna(0) * daily_return

    # Charge a cost (commission + slippage) proportional to how much
    # exposure changed hands each day, not just a frictionless mark-to-market.
    position_change = position.diff().abs()
    position_change.iloc[0] = position.iloc[0]
    strategy_return = strategy_return - position_change * (transaction_cost_bps / 10_000.0)

    equity_curve = (1 + strategy_return).cumprod()

    trades = _build_trades(df["Close"], position, tranche_count, transaction_cost_bps)

    n_years = (df.index[-1] - df.index[0]).days / 365.25
    cagr = equity_curve.iloc[-1] ** (1 / n_years) - 1 if n_years > 0 else float("nan")

    sharpe_ratio = (
        strategy_return.mean() / strategy_return.std() * np.sqrt(TRADING_DAYS_PER_YEAR)
        if strategy_return.std() > 0
        else float("nan")
    )

    running_max = equity_curve.cummax()
    max_drawdown = (equity_curve / running_max - 1.0).min()

    win_rate = float((trades["return"] > 0).mean()) if len(trades) else float("nan")

    # The recommendation is "given where you stood coming into today, what
    # does today's HFGI reading call for" — i.e. the state *before* today's
    # own fill, not tranche_count's already-acted-on end-of-day value (which
    # would describe today's signal as already handled instead of actionable).
    prior_tranche_count = int(tranche_count.iloc[-2]) if len(tranche_count) >= 2 else 0
    recommendation = _recommend_action(df[decision_col].iloc[-1], prior_tranche_count, tiers, sell_threshold)

    return BacktestResult(
        equity_curve=equity_curve,
        positions=position,
        tranche_count=tranche_count,
        trades=trades,
        cagr=float(cagr),
        sharpe_ratio=float(sharpe_ratio),
        max_drawdown=float(max_drawdown),
        win_rate=win_rate,
        recommendation=recommendation,
    )
