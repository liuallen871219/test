"""Streamlit dashboard for HFGI Pro.

Run with: streamlit run dashboard.py
Requires `python run.py` to have been run first so data/*.parquet exists.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from hfgi_pro import config
from hfgi_pro.backtest import run_backtest
from hfgi_pro.engine import HFGIEngine

st.set_page_config(page_title="HFGI Pro Dashboard", layout="wide")


@st.cache_data
def load_data(subject: str):
    tag = config.sanitize_ticker(subject)
    hfgi_df = pd.read_parquet(config.DATA_DIR / f"hfgi_{tag}.parquet")
    price_df = pd.read_parquet(config.DATA_DIR / f"{tag}.parquet")
    return hfgi_df, price_df


STRATEGY_LABELS = {
    "pyramid": "金字塔(先大後小,前重後輕)",
    "inverse_pyramid": "倒金字塔(先小後大,越跌加越多)",
}


def main() -> None:
    st.title("HFGI Pro — Fear & Greed Index Dashboard")

    col_subject, col_strategy = st.columns(2)
    subject = col_subject.selectbox("追蹤標的", config.WATCHLIST, index=0)
    strategy_name = col_strategy.selectbox(
        "加碼策略", list(config.ADD_ON_STRATEGIES.keys()),
        format_func=lambda s: STRATEGY_LABELS.get(s, s), index=0,
    )
    tiers = config.ADD_ON_STRATEGIES[strategy_name]

    try:
        hfgi_df, price_df = load_data(subject)
    except FileNotFoundError:
        st.error("找不到資料,請先在終端機執行 `python run.py` 下載資料並計算指標。")
        return

    engine = HFGIEngine()
    ind = engine.compute_indicators({subject: price_df}, subject=subject)
    result = run_backtest(hfgi_df, tiers=tiers)

    tier_desc = " → ".join(f"HFGI<{t['threshold']} 加碼{t['fraction'] * 100:.0f}%" for t in tiers)
    st.caption(f"{STRATEGY_LABELS.get(strategy_name, strategy_name)}:{tier_desc} → HFGI>{config.BACKTEST_SELL_THRESHOLD} 全出場")

    recommendation = result.recommendation
    action_style = {
        "enter": st.success, "add": st.success, "exit": st.warning,
        "hold": st.info, "hold_full": st.info, "wait": st.info, "no_data": st.error,
    }.get(recommendation["action"], st.info)
    action_style(f"**目前建議**:{recommendation['message']}")

    has_adr = subject == config.PRIMARY_TICKER and hfgi_df["ADR_Premium_Raw"].notna().any()

    latest = hfgi_df.dropna(subset=["HFGI"]).iloc[-1] if hfgi_df["HFGI"].notna().any() else None
    col1, col2, col3, col4, col5 = st.columns(5)
    if latest is not None:
        col1.metric("最新 HFGI", f"{latest['HFGI']:.1f}", latest["State"])
    else:
        col1.metric("最新 HFGI", "N/A", "歷史資料不足")
    col2.metric("收盤價", f"{ind['Close'].iloc[-1]:.2f}")
    col3.metric("RSI(14)", f"{ind['RSI'].iloc[-1]:.1f}" if pd.notna(ind["RSI"].iloc[-1]) else "N/A")
    if has_adr:
        col4.metric("ADR Premium (proxy)", f"{hfgi_df['ADR_Premium_Raw'].iloc[-1] * 100:.2f}%")
    else:
        col4.metric("ADR Premium (proxy)", "N/A", "僅 SKHY 適用")
    latest_vix = hfgi_df["VIX_Close"].iloc[-1]
    col5.metric("VIX", f"{latest_vix:.1f}" if pd.notna(latest_vix) else "N/A")

    summary = result.summary()
    s1, s2, s3, s4 = st.columns(4)
    s1.metric("CAGR", f"{summary['cagr'] * 100:.2f}%" if summary["cagr"] == summary["cagr"] else "N/A")
    s2.metric("Sharpe Ratio", f"{summary['sharpe_ratio']:.2f}" if summary["sharpe_ratio"] == summary["sharpe_ratio"] else "N/A")
    s3.metric("Max Drawdown", f"{summary['max_drawdown'] * 100:.2f}%" if summary["max_drawdown"] == summary["max_drawdown"] else "N/A")
    s4.metric("Win Rate", f"{summary['win_rate'] * 100:.1f}%" if summary["win_rate"] == summary["win_rate"] else "N/A")

    # --- HFGI curve -------------------------------------------------------
    fig_hfgi = go.Figure()
    fig_hfgi.add_trace(go.Scatter(x=hfgi_df.index, y=hfgi_df["HFGI"], name="HFGI", line=dict(color="orange")))
    fig_hfgi.add_hline(y=config.BACKTEST_BUY_THRESHOLD, line_dash="dash", line_color="green",
                        annotation_text=f"Buy (<{config.BACKTEST_BUY_THRESHOLD})")
    fig_hfgi.add_hline(y=config.BACKTEST_SELL_THRESHOLD, line_dash="dash", line_color="red",
                        annotation_text=f"Sell (>{config.BACKTEST_SELL_THRESHOLD})")
    fig_hfgi.update_layout(title=f"{subject} — HFGI 曲線", yaxis_range=[0, 100], height=350)
    st.plotly_chart(fig_hfgi, use_container_width=True)

    # --- Price chart with add-on entries / exits --------------------------
    fig_price = go.Figure()
    fig_price.add_trace(go.Scatter(x=ind.index, y=ind["Close"], name="收盤價", line=dict(color="steelblue")))
    for w in config.SMA_WINDOWS:
        fig_price.add_trace(go.Scatter(x=ind.index, y=ind[f"SMA{w}"], name=f"SMA{w}", line=dict(width=1)))
    if len(result.trades):
        # Marker size scales with each tranche's fraction, so a pyramid's big
        # first bite and an inverse_pyramid's big last bite are visible.
        entry_sizes = 10 + result.trades["fraction"] * 40
        fig_price.add_trace(go.Scatter(
            x=result.trades["entry_date"], y=result.trades["entry_price"],
            mode="markers", name="加碼進場",
            marker=dict(symbol="triangle-up", size=entry_sizes, color="green"),
            text=[f"+{f * 100:.0f}%" for f in result.trades["fraction"]],
            hovertemplate="%{x}<br>價格 %{y:.2f}<br>加碼 %{text}<extra></extra>",
        ))
        exits = result.trades.drop_duplicates(subset=["exit_date"])
        fig_price.add_trace(go.Scatter(
            x=exits["exit_date"], y=exits["exit_price"],
            mode="markers", name="出場", marker=dict(symbol="triangle-down", size=14, color="red"),
        ))
    fig_price.update_layout(title=f"{subject} — 股價 & 加碼/出場訊號", height=400)
    st.plotly_chart(fig_price, use_container_width=True)

    # --- RSI / MACD / Volume / VIX / ADR Premium in a 2x3 grid --------------
    adr_title = "ADR Premium (proxy)" if has_adr else "ADR Premium (僅 SKHY 適用)"
    fig = make_subplots(
        rows=2, cols=3,
        subplot_titles=("RSI(14)", "MACD", "成交量", "VIX(市場恐慌總體指標)", adr_title, ""),
    )

    fig.add_trace(go.Scatter(x=ind.index, y=ind["RSI"], name="RSI"), row=1, col=1)
    fig.add_hline(y=70, line_dash="dot", line_color="red", row=1, col=1)
    fig.add_hline(y=30, line_dash="dot", line_color="green", row=1, col=1)

    fig.add_trace(go.Scatter(x=ind.index, y=ind["MACD"], name="MACD"), row=1, col=2)
    fig.add_trace(go.Scatter(x=ind.index, y=ind["MACD_Signal"], name="Signal"), row=1, col=2)
    fig.add_trace(go.Bar(x=ind.index, y=ind["MACD_Hist"], name="Histogram"), row=1, col=2)

    fig.add_trace(go.Bar(x=ind.index, y=ind["Volume"], name="Volume"), row=1, col=3)

    if hfgi_df["VIX_Close"].notna().any():
        fig.add_trace(go.Scatter(x=hfgi_df.index, y=hfgi_df["VIX_Close"], name="VIX"), row=2, col=1)

    if has_adr:
        fig.add_trace(
            go.Scatter(x=hfgi_df.index, y=hfgi_df["ADR_Premium_Raw"] * 100, name="ADR Premium %"),
            row=2, col=2,
        )

    fig.update_layout(height=650, showlegend=False)
    st.plotly_chart(fig, use_container_width=True)

    with st.expander("交易紀錄"):
        st.dataframe(result.trades)


if __name__ == "__main__":
    main()
