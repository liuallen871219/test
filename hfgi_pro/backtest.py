"""Simple contrarian backtest: buy when HFGI signals fear, sell on greed."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config

TRADING_DAYS_PER_YEAR = 252


@dataclass
class BacktestResult:
    equity_curve: pd.Series
    positions: pd.Series
    trades: pd.DataFrame
    cagr: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float

    def summary(self) -> dict:
        return {
            "cagr": self.cagr,
            "sharpe_ratio": self.sharpe_ratio,
            "max_drawdown": self.max_drawdown,
            "win_rate": self.win_rate,
            "num_trades": len(self.trades),
        }


def _build_positions(hfgi: pd.Series, buy_threshold: float, sell_threshold: float) -> pd.Series:
    """State machine: go long once HFGI < buy_threshold, exit once HFGI > sell_threshold."""
    positions = np.zeros(len(hfgi), dtype=int)
    state = 0
    for i, value in enumerate(hfgi.values):
        if state == 0 and value < buy_threshold:
            state = 1
        elif state == 1 and value > sell_threshold:
            state = 0
        positions[i] = state
    return pd.Series(positions, index=hfgi.index, name="Position")


def _build_trades(close: pd.Series, positions: pd.Series) -> pd.DataFrame:
    diff = positions.diff().fillna(positions.iloc[0])
    entries = list(positions.index[diff == 1])
    exits = list(positions.index[diff == -1])

    trades = []
    exit_idx = 0
    for entry_date in entries:
        while exit_idx < len(exits) and exits[exit_idx] <= entry_date:
            exit_idx += 1
        if exit_idx < len(exits):
            exit_date = exits[exit_idx]
            exit_idx += 1
        else:
            exit_date = positions.index[-1]
        entry_price = close.loc[entry_date]
        exit_price = close.loc[exit_date]
        trades.append(
            {
                "entry_date": entry_date,
                "exit_date": exit_date,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "return": exit_price / entry_price - 1.0,
            }
        )
    return pd.DataFrame(trades)


def run_backtest(
    hfgi_df: pd.DataFrame,
    buy_threshold: float = config.BACKTEST_BUY_THRESHOLD,
    sell_threshold: float = config.BACKTEST_SELL_THRESHOLD,
) -> BacktestResult:
    df = hfgi_df.dropna(subset=["HFGI", "Close"]).copy()

    positions = _build_positions(df["HFGI"], buy_threshold, sell_threshold)
    daily_return = df["Close"].pct_change().fillna(0)
    strategy_return = positions.shift(1).fillna(0) * daily_return
    equity_curve = (1 + strategy_return).cumprod()

    trades = _build_trades(df["Close"], positions)

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

    return BacktestResult(
        equity_curve=equity_curve,
        positions=positions,
        trades=trades,
        cagr=float(cagr),
        sharpe_ratio=float(sharpe_ratio),
        max_drawdown=float(max_drawdown),
        win_rate=win_rate,
    )
