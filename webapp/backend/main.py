# -*- coding: utf-8 -*-
"""
FastAPI 後端：重用專案根目錄的 market.py / analysis.py，
資料來源跟 Streamlit 版共用同一批 CSV / config.json（不重複維護兩份邏輯）。
"""
import os
import sys
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date as date_cls

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# 專案根目錄（webapp/backend/ 的上上層），讓我們可以直接 import 既有的 market.py / analysis.py
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT_DIR)

import market as mk   # noqa: E402
import analysis as an  # noqa: E402
import github_sync   # noqa: E402

HOLDINGS_FILE = os.path.join(ROOT_DIR, "holdings.csv")
WATCH_FILE = os.path.join(ROOT_DIR, "watchlist.csv")
HISTORY_FILE = os.path.join(ROOT_DIR, "history.csv")
CONFIG_FILE = os.path.join(ROOT_DIR, "config.json")

# Render 這類免費方案重啟後磁碟是全新的，開機時先把 GitHub 上最新的資料拉回來
# （本機開發沒設定 GITHUB_TOKEN 就完全不會發生，行為跟以前一樣）
for _repo_path, _local_path in [
    ("holdings.csv", HOLDINGS_FILE), ("watchlist.csv", WATCH_FILE),
    ("history.csv", HISTORY_FILE), ("config.json", CONFIG_FILE),
]:
    github_sync.pull_file(_repo_path, _local_path)

HOLD_COLS = ["symbol", "shares", "avg_cost", "stop_price", "note"]
WATCH_COLS = ["symbol", "target_buy", "note"]

GREEN = "#4a9a6c"
RED = "#c26661"
GREY = "#94907f"
ORANGE = "#d9822b"

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")

app = FastAPI(title="美股投資追蹤 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------
# 資料存取（跟 app.py 的 load_csv / load_config 邏輯一致，共用同一批檔案）
# ------------------------------------------------------------------
def load_csv(path, cols, numeric):
    if os.path.exists(path):
        df = pd.read_csv(path, dtype={"symbol": str})
    else:
        df = pd.DataFrame(columns=cols)
    for c in cols:
        if c not in df.columns:
            df[c] = None
    df = df[cols]
    df["symbol"] = df["symbol"].fillna("").astype(str).str.upper().str.strip()
    for c in numeric:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    if "note" in df.columns:
        df["note"] = df["note"].fillna("").astype(str)
    df = df[df["symbol"] != ""].reset_index(drop=True)
    return df


def load_holdings():
    df = load_csv(HOLDINGS_FILE, HOLD_COLS, ["shares", "avg_cost", "stop_price"])
    df["shares"] = df["shares"].fillna(0.0)
    df["avg_cost"] = df["avg_cost"].fillna(0.0)
    return df


def save_holdings(df):
    df[HOLD_COLS].to_csv(HOLDINGS_FILE, index=False, encoding="utf-8-sig")
    github_sync.push_file(HOLDINGS_FILE, "holdings.csv", "更新持股 holdings.csv")


def load_watch():
    return load_csv(WATCH_FILE, WATCH_COLS, ["target_buy"])


def save_watch(df):
    df[WATCH_COLS].to_csv(WATCH_FILE, index=False, encoding="utf-8-sig")
    github_sync.push_file(WATCH_FILE, "watchlist.csv", "更新追蹤清單 watchlist.csv")


def load_history():
    if not os.path.exists(HISTORY_FILE):
        return pd.DataFrame()
    df = pd.read_csv(HISTORY_FILE, dtype={"symbol": str})
    for c in ["shares", "price", "pl_pct", "pl_usd", "pl_twd", "cost_usd",
              "income_usd", "fee", "tax"]:
        if c not in df.columns:
            df[c] = 0.0
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)
    if "type" not in df.columns:
        df["type"] = "賣出"
    df["type"] = df["type"].fillna("賣出").astype(str)
    return df


def append_history(rec):
    h = load_history()
    h = (pd.concat([h, pd.DataFrame([rec])], ignore_index=True)
         if not h.empty else pd.DataFrame([rec]))
    h.to_csv(HISTORY_FILE, index=False, encoding="utf-8-sig")
    github_sync.push_file(HISTORY_FILE, "history.csv", "新增交易紀錄 history.csv")


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            return json.load(open(CONFIG_FILE, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_config(cfg):
    json.dump(cfg, open(CONFIG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    github_sync.push_file(CONFIG_FILE, "config.json", "更新 config.json")


def enrich_holdings(hold):
    recs = hold.to_dict("records")
    if not recs:
        return []
    # 平行度不要開太大：一次打太多次 Yahoo Finance 反而容易被暫時擋掉，
    # 一堆股票的報價就會變成 0。
    with ThreadPoolExecutor(max_workers=min(4, len(recs))) as ex:
        quotes = list(ex.map(lambda r: mk.get_light(r["symbol"]), recs))
    rows = []
    for r, q in zip(recs, quotes):
        shares = r["shares"] or 0.0
        avg = r["avg_cost"] or 0.0
        price = q["price"] or 0.0
        cost = shares * avg
        mv = shares * price
        pl = mv - cost
        plpct = (pl / cost * 100) if cost else 0.0
        rows.append({
            **r, "q": q, "price": price, "cost": cost,
            "market_value": mv, "pl": pl, "pl_pct": plpct,
            "day_pct": q["change_pct"],
            "name": q["name"],
        })
    return rows


# ------------------------------------------------------------------
# API
# ------------------------------------------------------------------
class ConfigUpdate(BaseModel):
    cur: str | None = None
    cash_usd: float | None = None


@app.get("/api/config")
def get_config():
    cfg = load_config()
    rate = mk.get_usdtwd()
    return {
        "cur": cfg.get("cur", "USD"),
        "cash_usd": float(cfg.get("cash_usd") or 0),
        "rate": rate,
    }


@app.post("/api/config")
def update_config(body: ConfigUpdate):
    cfg = load_config()
    if body.cur is not None:
        cfg["cur"] = body.cur
    if body.cash_usd is not None:
        cfg["cash_usd"] = body.cash_usd
    save_config(cfg)
    return {"ok": True}


@app.get("/api/summary")
def get_summary():
    """總覽頁需要的所有資料：淨資產、今日/未實現損益、資產配置、提醒。"""
    hold = load_holdings()
    cfg = load_config()
    cash = float(cfg.get("cash_usd") or 0)

    if hold.empty:
        return {
            "empty": True, "cash_usd": cash, "total_mv_usd": 0, "assets_usd": cash,
            "day_pl_usd": 0, "total_pl_usd": 0, "pl_pct": 0,
            "allocation": [], "winners": [], "alerts": [],
        }

    rows = enrich_holdings(hold)
    total_mv = sum(r["market_value"] for r in rows)
    total_cost = sum(r["cost"] for r in rows)
    total_pl = total_mv - total_cost
    day_pl = sum((r["price"] - r["q"]["prev_close"]) * (r["shares"] or 0)
                 for r in rows if r["q"]["prev_close"])
    plpct = (total_pl / total_cost * 100) if total_cost else 0
    assets = total_mv + cash

    palette = ["#d9564a", "#dd8a3d", "#d9b83f", "#5a9e52", "#3aa89e",
               "#4a8fc9", "#3f6fae", "#9a9a4a", "#a8734a", "#8f8a7a"]
    order = sorted(rows, key=lambda r: -r["market_value"])
    items = [(r["symbol"], r["market_value"]) for r in order[:8]]
    if order[8:]:
        items.append(("其他", sum(r["market_value"] for r in order[8:])))
    if cash > 0:
        items.append(("現金", cash))
    base = sum(v for _, v in items) or 1
    allocation = [
        {"name": n, "value_usd": v, "pct": v / base * 100, "color": palette[i % len(palette)]}
        for i, (n, v) in enumerate(items)
    ]

    winners = sorted([r for r in rows if r["pl_pct"] >= 20 and not an.is_dca(r.get("note"))],
                      key=lambda r: -r["pl_pct"])
    winners_out = [
        {"symbol": r["symbol"], "name": r["name"][:16], "pl_pct": r["pl_pct"],
         "pl_usd": r["pl"], "price_usd": r["price"]}
        for r in winners
    ]

    alerts = []
    for r in rows:
        v = an.analyze_light(r["price"], r["q"].get("ma50", 0), r["q"].get("ma200", 0),
                              r["pl_pct"], r.get("stop_price"))
        if v["label"] == "考慮停損":
            alerts.append({"kind": "stop", "symbol": r["symbol"],
                           "pl_pct": r["pl_pct"], "pl_usd": r["pl"]})
        elif v["label"] == "偏弱觀察":
            alerts.append({"kind": "weak", "symbol": r["symbol"],
                           "pl_pct": r["pl_pct"], "pl_usd": r["pl"]})
        if abs(r["day_pct"] or 0) >= 5:
            day_amt = ((r["price"] - r["q"]["prev_close"]) * (r["shares"] or 0)
                       if r["q"].get("prev_close") else None)
            alerts.append({"kind": "day_up" if r["day_pct"] > 0 else "day_down",
                           "symbol": r["symbol"], "day_pct": r["day_pct"],
                           "day_amt_usd": day_amt})

    return {
        "empty": False, "cash_usd": cash, "total_mv_usd": total_mv, "assets_usd": assets,
        "day_pl_usd": day_pl, "total_pl_usd": total_pl, "pl_pct": plpct,
        "allocation": allocation, "winners": winners_out, "alerts": alerts,
    }


# ------------------------------------------------------------------
# 📦 持股
# ------------------------------------------------------------------
@app.get("/api/holdings")
def get_holdings(sort: str = "mv"):
    """持股清單（含即時報價與判斷）。sort: mv | symbol | day_pct"""
    hold = load_holdings()
    if hold.empty:
        return {"empty": True, "rows": []}
    rows = enrich_holdings(hold)
    total_mv = sum(r["market_value"] for r in rows) or 1
    out = []
    for r in rows:
        dca = an.is_dca(r.get("note"))
        v = an.analyze_light(r["price"], r["q"].get("ma50", 0), r["q"].get("ma200", 0),
                              r["pl_pct"], r.get("stop_price"), dca)
        out.append({
            "symbol": r["symbol"], "shares": r["shares"], "avg_cost_usd": r["avg_cost"],
            "price_usd": r["price"],
            "day_pct": r["day_pct"], "market_value_usd": r["market_value"],
            "weight_pct": r["market_value"] / total_mv * 100,
            "pl_usd": r["pl"], "pl_pct": r["pl_pct"],
            "emoji": v["emoji"], "label": v["label"],
        })
    if sort == "symbol":
        out.sort(key=lambda r: r["symbol"])
    elif sort == "day_pct":
        out.sort(key=lambda r: (r["day_pct"] or 0))
    else:
        out.sort(key=lambda r: -r["market_value_usd"])
    return {"empty": False, "rows": out}


@app.get("/api/symbols")
def get_symbols():
    """已知代號清單（持有中 + 曾經買賣過），給配息表單的下拉選單用。"""
    hold = load_holdings()
    hist = load_history()
    syms = set(hold["symbol"].tolist())
    if not hist.empty:
        syms |= set(hist["symbol"].tolist())
    return {"symbols": sorted(syms)}


@app.get("/api/holdings/{symbol}")
def get_holding_detail(symbol: str):
    """個股詳細頁：報價、我的部位、投資成果、停損目標、續抱判斷、關鍵數據、新聞。"""
    symbol = symbol.upper().strip()
    q = mk.get_quote(symbol)
    hold = load_holdings()
    row = hold[hold["symbol"] == symbol]
    position = None
    if not row.empty:
        r = row.iloc[0]
        shares = float(r["shares"] or 0)
        avg = float(r["avg_cost"] or 0)
        stop_price = r.get("stop_price")
        note = r.get("note") or ""
        mv = shares * q["price"]
        cost = shares * avg
        pl = mv - cost
        plpct = (pl / cost * 100) if cost else 0.0

        hist = load_history()
        sh = hist[hist["symbol"] == symbol] if not hist.empty else pd.DataFrame()
        realized = float(sh[sh["type"] != "配息"]["pl_usd"].sum()) if len(sh) else 0.0
        divs = float(sh[sh["type"] == "配息"]["pl_usd"].sum()) if len(sh) else 0.0

        daily = mk.get_chart(symbol, period="6mo")
        rsi_val = mk.rsi(daily["Close"]) if not daily.empty else None
        verdict = an.analyze_holding(q, shares, avg,
                                     stop_price if pd.notna(stop_price) else None, rsi_val)
        dca = an.is_dca(note)
        light = an.analyze_light(q["price"], q.get("ma50", 0), q.get("ma200", 0),
                                 plpct, stop_price if pd.notna(stop_price) else None, dca)
        position = {
            "shares": shares, "avg_cost": avg,
            "stop_price": float(stop_price) if pd.notna(stop_price) else None,
            "note": note, "market_value_usd": mv, "cost_usd": cost,
            "pl_usd": pl, "pl_pct": plpct,
            "realized_pl_usd": realized, "dividends_usd": divs,
            "total_return_usd": pl + realized + divs,
            "dca": dca,
            "verdict": {"label": verdict["label"], "emoji": verdict["emoji"],
                        "color": verdict["color"], "reasons": verdict["reasons"],
                        "suggest_stop": verdict["suggest_stop"], "cost_t20": verdict["cost_t20"],
                        "t20": verdict["t20"]},
            "light": {"label": light["label"], "emoji": light["emoji"],
                     "color": light["color"], "reasons": light["reasons"]},
        }

    news = mk.get_news(symbol, limit=4)
    return {
        "symbol": symbol, "name": q["name"], "logo_url": mk.logo_url(symbol),
        "biz": mk.biz_zh(symbol, q["industry"]),
        "sector": mk.SECTOR_ZH.get(q["sector"], q["sector"] or "未分類"),
        "price_usd": q["price"], "change_pct": q["change_pct"],
        "market_state": q.get("market_state", ""),
        "pre_price_usd": q.get("pre_price"), "pre_pct": q.get("pre_pct"),
        "post_price_usd": q.get("post_price"), "post_pct": q.get("post_pct"),
        "position": position,
        "key_stats": {
            "target_mean_usd": q["target_mean"], "recommend": an.REC_ZH.get(q["recommend"], "—"),
            "wk52_high_usd": q["wk52_high"], "wk52_low_usd": q["wk52_low"],
            "day_high_usd": q["day_high"], "day_low_usd": q["day_low"],
            "pe": q["pe"], "market_cap": q["market_cap"],
            "ma50_usd": q["ma50"], "ma200_usd": q["ma200"],
            "div_yield_pct": q["div_yield"] * 100 if q["div_yield"] else None,
            "div_rate_usd": q["div_rate"],
        },
        "dates": {
            "earnings_date": str(q["earnings_date"]) if q["earnings_date"] else None,
            "ex_div_date": str(q["ex_div_date"]) if q["ex_div_date"] else None,
            "div_date": str(q["div_date"]) if q["div_date"] else None,
        },
        "news": news,
    }


@app.get("/api/chart/{symbol}")
def get_chart(symbol: str, range: str = "1mo"):
    period_map = {"1d": ("1d", "5m"), "5d": ("5d", "30m"), "1mo": ("1mo", "1d"),
                  "3mo": ("3mo", "1d"), "6mo": ("6mo", "1d"), "1y": ("1y", "1d")}
    period, interval = period_map.get(range, ("1mo", "1d"))
    hist = mk.get_chart(symbol.upper().strip(), period=period, interval=interval)
    if hist.empty:
        return {"points": []}
    close = hist["Close"].dropna()
    points = [{"t": idx.isoformat(), "v": float(v)} for idx, v in close.items()]
    return {"points": points}


# ------------------------------------------------------------------
# 交易：買進 / 賣出 / 配息（跟 app.py 的表單邏輯完全一致，共用同一批 CSV）
# ------------------------------------------------------------------
class BuyIn(BaseModel):
    symbol: str
    shares: float
    price: float
    date: str
    fee: float = 0.0
    stop_price: float | None = None
    note: str = ""


class SellIn(BaseModel):
    symbol: str
    shares: float
    price: float
    date: str
    fee: float = 0.0
    tax: float = 0.0


class DividendIn(BaseModel):
    symbol: str
    amount: float
    date: str


def _qtr(d):
    return (d.month - 1) // 3 + 1


@app.post("/api/transactions/buy")
def transaction_buy(body: BuyIn):
    s = body.symbol.upper().strip()
    sh, px, fee = body.shares, body.price, body.fee
    if not s or sh <= 0 or px <= 0:
        raise HTTPException(400, "請填代號、股數、買進價。")
    dt = date_cls.fromisoformat(body.date)
    hh = load_holdings()
    if s in hh["symbol"].values:
        o = hh[hh["symbol"] == s].iloc[0]
        osh = float(o["shares"] or 0)
        oav = float(o["avg_cost"] or 0)
        nsh = osh + sh
        nav = (osh * oav + sh * px + fee) / nsh if nsh else px
        hh.loc[hh["symbol"] == s, "shares"] = nsh
        hh.loc[hh["symbol"] == s, "avg_cost"] = round(nav, 4)
        if body.stop_price:
            hh.loc[hh["symbol"] == s, "stop_price"] = body.stop_price
        if body.note:
            hh.loc[hh["symbol"] == s, "note"] = body.note
    else:
        hh = pd.concat([hh, pd.DataFrame([{
            "symbol": s, "shares": sh, "avg_cost": round((sh * px + fee) / sh, 4),
            "stop_price": body.stop_price or None, "note": body.note}])], ignore_index=True)
    save_holdings(hh)
    q = mk.get_quote(s)
    qtr = _qtr(dt)
    append_history({"date": str(dt), "symbol": s, "name": q["name"], "type": "買進",
                    "shares": sh, "price": px, "pl_pct": 0, "pl_usd": 0, "pl_twd": 0,
                    "fee": fee, "tax": 0, "year": dt.year, "quarter": qtr,
                    "yq": f"{dt.year}Q{qtr}", "cost_usd": round(sh * px + fee, 2),
                    "income_usd": 0})
    return {"ok": True, "message": f"已買進 {s} {sh:g} 股，持股與平均成本已更新！"}


@app.post("/api/transactions/sell")
def transaction_sell(body: SellIn):
    s = body.symbol.upper().strip()
    sh, px, fee, tax = body.shares, body.price, body.fee, body.tax
    hh = load_holdings()
    row = hh[hh["symbol"] == s]
    if row.empty:
        raise HTTPException(400, f"目前沒有持有 {s}。")
    held = float(row.iloc[0]["shares"] or 0)
    avg = float(row.iloc[0]["avg_cost"] or 0)
    if sh <= 0 or px <= 0 or sh > held + 1e-9:
        raise HTTPException(400, "請填正確的賣出股數與價格。")
    dt = date_cls.fromisoformat(body.date)
    income = sh * px
    cost = sh * avg
    pl = income - cost - fee - tax
    plpct = pl / cost if cost else 0
    rate = mk.get_usdtwd() or 0
    q = mk.get_quote(s)
    qtr = _qtr(dt)
    append_history({"date": str(dt), "symbol": s, "name": q["name"], "type": "賣出",
                    "shares": sh, "price": px, "pl_pct": round(plpct, 6),
                    "pl_usd": round(pl, 2), "pl_twd": round(pl * rate, 2),
                    "fee": fee, "tax": tax, "year": dt.year, "quarter": qtr,
                    "yq": f"{dt.year}Q{qtr}", "cost_usd": round(cost, 2),
                    "income_usd": round(income, 2)})
    left = held - sh
    if left <= 1e-9:
        hh = hh[hh["symbol"] != s]
    else:
        hh.loc[hh["symbol"] == s, "shares"] = left
    save_holdings(hh)
    return {"ok": True, "message": f"已賣出 {s} {sh:g} 股，實現損益 ${pl:+,.2f}（{plpct*100:+.1f}%）！"}


# ------------------------------------------------------------------
# 👀 追蹤清單
# ------------------------------------------------------------------
class WatchIn(BaseModel):
    symbol: str
    target_buy: float | None = None
    note: str = ""


@app.get("/api/watchlist")
def get_watchlist():
    watch = load_watch()
    if watch.empty:
        return {"empty": True, "rows": []}
    recs = watch.to_dict("records")
    # 平行抓（跟持股清單同一套節流設定），不然一次看的股票一多，一支一支排隊抓會很慢
    with ThreadPoolExecutor(max_workers=min(4, len(recs))) as ex:
        quotes = list(ex.map(lambda w: mk.get_light(w["symbol"]), recs))
    rows = []
    for w, q in zip(recs, quotes):
        tb = w.get("target_buy")
        tb = float(tb) if pd.notna(tb) else None
        v = an.analyze_watch(q, tb, None)
        rows.append({
            "symbol": w["symbol"], "target_buy_usd": tb, "note": w.get("note") or "",
            "price_usd": q["price"], "day_pct": q["change_pct"],
            "emoji": v["emoji"], "label": v["label"],
        })
    return {"empty": False, "rows": rows}


@app.post("/api/watchlist")
def add_watchlist(body: WatchIn):
    s = body.symbol.upper().strip()
    if not s:
        raise HTTPException(400, "請填代號。")
    nw = load_watch()
    if s in nw["symbol"].values:
        return {"ok": False, "message": f"{s} 已在清單。"}
    nw = pd.concat([nw, pd.DataFrame([{
        "symbol": s, "target_buy": body.target_buy or None, "note": body.note}])],
        ignore_index=True)
    save_watch(nw)
    return {"ok": True, "message": f"已加入 {s}！"}


@app.post("/api/transactions/dividend")
def transaction_dividend(body: DividendIn):
    s = body.symbol.upper().strip()
    if not s or body.amount <= 0:
        raise HTTPException(400, "請填代號與金額。")
    dt = date_cls.fromisoformat(body.date)
    rate = mk.get_usdtwd() or 0
    q = mk.get_quote(s)
    qtr = _qtr(dt)
    append_history({"date": str(dt), "symbol": s, "name": q["name"], "type": "配息",
                    "shares": 0, "price": 0, "pl_pct": 0, "pl_usd": round(body.amount, 2),
                    "pl_twd": round(body.amount * rate, 2), "fee": 0, "tax": 0,
                    "year": dt.year, "quarter": qtr, "yq": f"{dt.year}Q{qtr}",
                    "cost_usd": 0, "income_usd": round(body.amount, 2)})
    return {"ok": True, "message": f"已記錄 {s} 配息 ${body.amount:,.2f}！"}


# ------------------------------------------------------------------
# 📊 統計報表
# ------------------------------------------------------------------
@app.get("/api/stats")
def get_stats(period: str = "all", start: str | None = None, end: str | None = None):
    """period: all | ytd | 90d | custom（custom 時要帶 start/end，YYYY-MM-DD）"""
    hist = load_history()
    if hist.empty:
        return {"empty": True}

    d = pd.to_datetime(hist["date"], errors="coerce")
    dmin, dmax = d.min(), d.max()
    today = date_cls.today()

    if period == "ytd":
        p_start, p_end = date_cls(today.year, 1, 1), today
    elif period == "90d":
        p_start = date_cls.fromordinal(today.toordinal() - 90)
        p_end = today
    elif period == "custom" and start and end:
        p_start, p_end = date_cls.fromisoformat(start), date_cls.fromisoformat(end)
    else:
        period = "all"
        p_start = dmin.date() if pd.notna(dmin) else date_cls(2025, 1, 1)
        p_end = dmax.date() if pd.notna(dmax) else today

    rng = hist[(d.dt.date >= p_start) & (d.dt.date <= p_end)]
    rpl = float(rng["pl_usd"].sum())
    rcost = float(rng["cost_usd"].sum()) if "cost_usd" in rng else 0.0
    rpct = (rpl / rcost * 100) if rcost else None
    total_pl_all = float(hist["pl_usd"].sum())

    det = rng.sort_values("date", ascending=False) if "date" in rng else rng
    buy_syms = sorted(set(str(s) for s in det.loc[det["type"] == "買進", "symbol"]))
    live_prices = {}
    if buy_syms:
        with ThreadPoolExecutor(max_workers=min(10, len(buy_syms))) as ex:
            live_prices = dict(zip(buy_syms, ex.map(lambda s: mk.get_light(s)["price"], buy_syms)))

    transactions = []
    for _, t in det.iterrows():
        sym = str(t["symbol"])
        ttype = str(t.get("type", "賣出"))
        rec = {
            "date": str(t["date"])[:10], "symbol": sym, "name": str(t.get("name") or sym),
            "type": ttype, "shares": float(t["shares"] or 0), "price_usd": float(t["price"] or 0),
            "pl_usd": float(t["pl_usd"] or 0),
            "pl_pct": float(t["pl_pct"] * 100) if pd.notna(t.get("pl_pct")) else 0.0,
            "fee": float(t.get("fee") or 0), "tax": float(t.get("tax") or 0),
            "live_price_usd": live_prices.get(sym) if ttype == "買進" else None,
        }
        transactions.append(rec)

    rank = (hist.groupby("symbol", dropna=False)["pl_usd"].sum()
            .reset_index().sort_values("pl_usd", ascending=False))
    ranking = [{"symbol": str(r["symbol"]), "pl_usd": float(r["pl_usd"])} for _, r in rank.iterrows()]

    return {
        "empty": False, "period": period,
        "range_pl_usd": rpl, "range_pl_pct": rpct, "range_count": len(rng),
        "total_pl_all_usd": total_pl_all,
        "transactions": transactions, "ranking": ranking,
        "range_start": str(p_start), "range_end": str(p_end),
    }


# ------------------------------------------------------------------
# 📰 每日簡報
# ------------------------------------------------------------------
@app.get("/api/briefing")
def get_briefing():
    cfg = load_config()
    return {"html": cfg.get("last_briefing"), "last_at": cfg.get("last_briefing_at")}


@app.post("/api/briefing/generate")
def generate_briefing():
    hold = load_holdings()
    if hold.empty:
        raise HTTPException(400, "先到「我的持股」新增持股，才有東西可以分析。")
    rows = enrich_holdings(hold)
    watch_syms = load_watch()["symbol"].tolist()
    rate = mk.get_usdtwd() or 0
    html = an.generate_briefing(rows, rate, watch_syms)
    cfg = load_config()
    cfg["last_briefing"] = html
    cfg["last_briefing_at"] = str(date_cls.today())
    save_config(cfg)
    return {"html": html, "last_at": cfg["last_briefing_at"]}


@app.post("/api/cache/clear")
def clear_cache():
    import streamlit as st
    st.cache_data.clear()
    return {"ok": True}


# ------------------------------------------------------------------
# 📈 資產走勢（總覽頁點淨資產進去）
# ------------------------------------------------------------------
@app.get("/api/trend")
def get_trend(gran: str = "日"):
    hold = load_holdings()
    if hold.empty:
        return {"empty": True}
    period, interval, resample = {
        "日": ("1mo", "1d", None), "月": ("1y", "1d", "ME"), "年": ("5y", "1mo", "YE"),
    }.get(gran, ("1mo", "1d", None))
    ht = tuple((r["symbol"], float(r["shares"] or 0)) for _, r in hold.iterrows())
    s = mk.portfolio_value_series(ht, period, interval)
    if s.empty or len(s) < 2:
        return {"empty": True, "reason": "no_data"}
    if resample:
        s = s.resample(resample).last().dropna()
    change = s.diff().dropna()
    cur = float(s.iloc[-1])
    delta = float(s.iloc[-1] - s.iloc[0])
    pctchg = (delta / s.iloc[0] * 100) if s.iloc[0] else 0
    return {
        "empty": False, "gran": gran, "cur_value_usd": cur,
        "delta_usd": delta, "delta_pct": pctchg,
        "series": [{"t": str(t), "v": float(v)} for t, v in s.items()],
        "changes": [{"t": str(t), "v": float(v)} for t, v in change.items()],
    }


def _asset_version(*names):
    """用檔案的修改時間當版本號，加在 <script>/<link> 網址後面。
    這樣每次部署改了 js/css，瀏覽器（包括手機）才會抓新的，
    不會因為快取繼續執行舊版程式碼。"""
    mtimes = []
    for name in names:
        try:
            mtimes.append(os.path.getmtime(os.path.join(FRONTEND_DIR, name)))
        except OSError:
            pass
    return int(max(mtimes)) if mtimes else 0


@app.get("/", response_class=HTMLResponse)
def index():
    with open(os.path.join(FRONTEND_DIR, "index.html"), encoding="utf-8") as f:
        html = f.read()
    v_css = _asset_version("css/style.css")
    v_chart = _asset_version("js/chart.js")
    v_app = _asset_version("js/app.js")
    html = (html
            .replace('href="css/style.css"', f'href="css/style.css?v={v_css}"')
            .replace('src="js/chart.js"', f'src="js/chart.js?v={v_chart}"')
            .replace('src="js/app.js"', f'src="js/app.js?v={v_app}"'))
    return HTMLResponse(html, headers={"Cache-Control": "no-cache"})


# 前端靜態檔案（放在 API 路由後面掛載，避免蓋掉 /api/*）
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
