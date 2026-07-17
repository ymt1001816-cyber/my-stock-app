# -*- coding: utf-8 -*-
"""每日投資簡報 (獨立排程用，不需開 app、不需金鑰、不花錢)。
讀 holdings.csv → 抓即時報價 → 用規則引擎生成簡報 → 寫回 config.json 的 last_briefing，
並存一份到 reports/。由 Windows 工作排程每天早上自動執行。
"""
import os
import sys
import json
import warnings
from datetime import date

warnings.filterwarnings("ignore")

import pandas as pd
import market as mk
import analysis as an

BASE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(BASE, "config.json")
HOLD = os.path.join(BASE, "holdings.csv")
REPORTS = os.path.join(BASE, "reports")

# 排程直接寫本機 config.json，不會經過新版網頁的後端，所以這裡額外呼叫一次
# github_sync，讓排程產生的簡報也能同步回 GitHub → 手機上的新版 App 看得到。
sys.path.insert(0, os.path.join(BASE, "webapp", "backend"))
import github_sync  # noqa: E402


def log(msg):
    print(f"[daily_briefing] {msg}")


def main():
    cfg = {}
    if os.path.exists(CFG):
        cfg = json.load(open(CFG, encoding="utf-8"))
    if not os.path.exists(HOLD):
        log("沒有 holdings.csv，略過。")
        return
    hold = pd.read_csv(HOLD, dtype={"symbol": str})
    hold = hold[hold["symbol"].notna() & (hold["symbol"].astype(str).str.strip() != "")]
    if hold.empty:
        log("holdings.csv 是空的，略過。")
        return

    usdtwd = mk.get_usdtwd()
    rows = []
    for _, r in hold.iterrows():
        sym = str(r["symbol"]).upper().strip()
        q = mk.get_light(sym)
        shares = float(r.get("shares") or 0)
        avg = float(r.get("avg_cost") or 0)
        price = q["price"] or 0
        cost = shares * avg
        mv = shares * price
        rows.append({
            "symbol": sym, "name": q["name"], "shares": shares, "avg_cost": avg,
            "stop_price": r.get("stop_price"), "note": r.get("note", ""),
            "price": price, "cost": cost, "market_value": mv, "pl": mv - cost,
            "pl_pct": ((mv - cost) / cost * 100) if cost else 0,
            "day_pct": q["change_pct"], "q": q,
        })

    watch_syms = []
    wf = os.path.join(BASE, "watchlist.csv")
    if os.path.exists(wf):
        try:
            w = pd.read_csv(wf, dtype={"symbol": str})
            watch_syms = [str(x).upper().strip() for x in w["symbol"].dropna()
                          if str(x).strip()]
        except Exception:
            pass

    text = an.generate_briefing(rows, usdtwd, watch_syms)
    cfg["last_briefing"] = text
    cfg["last_briefing_at"] = str(date.today())
    json.dump(cfg, open(CFG, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    github_sync.push_file(CFG, "config.json", "每日排程更新簡報 config.json")
    os.makedirs(REPORTS, exist_ok=True)
    open(os.path.join(REPORTS, f"briefing_{date.today()}.txt"), "w",
         encoding="utf-8").write(text)
    log(f"完成，已更新 {date.today()} 簡報。")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"失敗：{e}")
