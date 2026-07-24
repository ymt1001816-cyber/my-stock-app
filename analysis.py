# -*- coding: utf-8 -*-
"""分析引擎：把行情數字轉成「續抱 / 減碼 / 停損 / 加碼」的建議與理由。
   全部為機械式規則計算，不構成投資建議。"""

import math
from concurrent.futures import ThreadPoolExecutor

import market as mk


def _num(x):
    """把 NaN / None 統一成 None（pandas 空值是 NaN，且 NaN 在 Python 是 truthy）。"""
    if x is None:
        return None
    try:
        if isinstance(x, float) and math.isnan(x):
            return None
    except Exception:
        pass
    return x

REC_ZH = {
    "strong_buy": "強力買進", "buy": "買進", "hold": "持有",
    "sell": "賣出", "strong_sell": "強力賣出", "underperform": "劣於大盤",
    "outperform": "優於大盤", "none": "無", None: "無",
}


def _fmt_pct(x):
    return f"{x:+.1f}%" if x is not None else "—"


def analyze_holding(q: dict, shares: float, avg_cost: float,
                    stop_price: float, rsi_val, stop_pct: float = 15.0,
                    macd_val=None, vol_ratio=None) -> dict:
    """回傳持股的綜合判斷。"""
    price = q.get("price") or 0.0
    ma50 = q.get("ma50") or 0.0
    ma200 = q.get("ma200") or 0.0
    target = _num(q.get("target_mean"))
    rec = q.get("recommend")
    wk52_high = q.get("wk52_high") or 0.0
    stop_price = _num(stop_price)

    pl_pct = ((price - avg_cost) / avg_cost * 100) if avg_cost else 0.0
    upside = ((target - price) / price * 100) if (target and price) else None
    below_high = ((price - wk52_high) / wk52_high * 100) if wk52_high else None

    score = 0
    reasons = []

    # 趨勢（均線）
    if ma50 and ma200:
        if price > ma50 > ma200:
            score += 2; reasons.append("🟢 價格站上 50 日與 200 日均線，多頭排列")
        elif price < ma200:
            score -= 2; reasons.append("🔴 價格跌破 200 日均線，長線走弱")
        elif price < ma50:
            score -= 1; reasons.append("🟠 價格跌破 50 日均線，短線轉弱")
    # 分析師
    if rec in ("strong_buy", "buy"):
        score += 1; reasons.append(f"🟢 分析師評等：{REC_ZH.get(rec)}")
    elif rec in ("sell", "strong_sell", "underperform"):
        score -= 2; reasons.append(f"🔴 分析師評等：{REC_ZH.get(rec)}")
    if upside is not None:
        if upside >= 15:
            score += 1; reasons.append(f"🟢 距分析師目標價還有 {upside:+.0f}% 空間")
        elif upside <= -5:
            score -= 1; reasons.append(f"🟠 已超過分析師目標價 {abs(upside):.0f}%")
    # RSI
    if rsi_val is not None:
        if rsi_val >= 75:
            score -= 1; reasons.append(f"🟠 RSI {rsi_val:.0f} 過熱，短線追高風險")
        elif rsi_val <= 30:
            score += 1; reasons.append(f"🔵 RSI {rsi_val:.0f} 超賣，可能有反彈")
    # MACD 金叉／死叉（柱狀圖由負轉正／由正轉負）
    if macd_val is not None:
        if macd_val["prev_hist"] <= 0 and macd_val["hist"] > 0:
            score += 1; reasons.append("🔵 MACD 出現黃金交叉，動能轉強")
        elif macd_val["prev_hist"] >= 0 and macd_val["hist"] < 0:
            score -= 1; reasons.append("🟠 MACD 出現死亡交叉，動能轉弱")
    # 成交量異常放大
    if vol_ratio is not None and vol_ratio >= 2:
        reasons.append(f"📊 成交量是 20 日均量的 {vol_ratio:.1f} 倍，留意消息面波動")
    # 損益 / 停損
    hit_stop = bool(stop_price and price <= stop_price)
    if hit_stop:
        reasons.append(f"🔴 已跌破你設定的停損價 ${stop_price:,.2f}")
    if pl_pct <= -stop_pct:
        score -= 2; reasons.append(f"🔴 帳面虧損 {pl_pct:.0f}%，超過停損門檻")
    elif pl_pct >= 30:
        reasons.append(f"🎯 帳面獲利 {pl_pct:.0f}%，可考慮部分獲利了結")
    if below_high is not None and below_high <= -25:
        reasons.append(f"📉 距 52 週高點已回落 {below_high:.0f}%")

    # 綜合判定
    if hit_stop or pl_pct <= -stop_pct:
        label, emoji, color = "考慮停損", "🔴", "#e03131"
    elif score >= 3:
        label, emoji, color = "續抱 / 可加碼", "🔵", "#1971c2"
    elif score >= 1:
        label, emoji, color = "續抱", "🟢", "#2f9e44"
    elif score <= -2:
        label, emoji, color = "偏弱 / 考慮減碼", "🟠", "#e8590c"
    else:
        label, emoji, color = "中性觀察", "⚪", "#868e96"

    return {
        "label": label, "emoji": emoji, "color": color, "score": score,
        "reasons": reasons or ["ℹ️ 無明顯訊號，維持觀察。"],
        "pl_pct": pl_pct, "upside": upside, "rsi": rsi_val,
        "macd": macd_val, "vol_ratio": vol_ratio,
        "target": target, "rec": REC_ZH.get(rec, "無"),
        # 目標與停損參考價
        "t10": price * 1.10, "t20": price * 1.20,
        "cost_t10": avg_cost * 1.10, "cost_t20": avg_cost * 1.20,
        "suggest_stop": stop_price or round(avg_cost * (1 - stop_pct / 100), 2),
    }


def is_dca(note) -> bool:
    """定期定額 / ETF：不提醒獲利了結。"""
    s = str(note or "")
    return ("定期" in s) or ("ETF" in s) or ("etf" in s)


def analyze_light(price, ma50, ma200, pl_pct, stop_price=None, dca=False) -> dict:
    """輕量判斷（價格/均線/損益）。卡片、總覽、個股頁、簡報都用這個 → 判斷一致。"""
    reasons = []
    if ma50 and ma200:
        if price > ma50 > ma200:
            reasons.append("🟢 站上 50 日與 200 日均線，多頭排列")
        elif price < ma200:
            reasons.append("🔴 跌破 200 日均線，長線走弱")
        elif price < ma50:
            reasons.append("🟠 跌破 50 日均線，短線轉弱")
    if pl_pct >= 20:
        reasons.append(f"🎯 帳面已獲利 {pl_pct:.0f}%")
    elif pl_pct <= -15:
        reasons.append(f"🔴 帳面虧損 {pl_pct:.0f}%")
    hit = bool(stop_price and price <= stop_price)
    if hit:
        reasons.append(f"🛑 已跌破你設定的停損價 ${stop_price:,.2f}")

    if hit or pl_pct <= -15:
        r = {"label": "考慮停損", "emoji": "🔴", "color": "#c26661"}
    elif dca:
        r = {"label": "定期定額·長期持有", "emoji": "📈", "color": "#4f7fa3"}
    elif pl_pct >= 20:
        r = {"label": "可留意獲利了結", "emoji": "🎯", "color": "#2f7d54"}
    elif ma200 and price < ma200:
        r = {"label": "偏弱觀察", "emoji": "🟠", "color": "#bd8a44"}
    elif ma50 and ma200 and price > ma50 > ma200:
        r = {"label": "續抱", "emoji": "🟢", "color": "#4a9a6c"}
    else:
        r = {"label": "中性觀察", "emoji": "⚪", "color": "#94907f"}
    r["reasons"] = reasons or ["ℹ️ 目前無明顯訊號，維持觀察"]
    return r


_GREEN = "#3f9668"
_RED = "#c1685f"


def _sec(title):
    return f"<div class='sec'>{title}</div>"


def _bcard(title, sub="", cc="var(--line)"):
    s = f"<div class='s'>{sub}</div>" if sub else ""
    return f"<div class='bcard' style='border-left-color:{cc}'><div class='t'>{title}</div>{s}</div>"


def generate_briefing(rows, usdtwd=0, watch_syms=None) -> str:
    """免 API 的每日簡報，回答：1) 大盤+新聞 2) 持股漲跌+原因+買賣 3) 值得關注。
       回傳一張張卡片組成的 HTML；金額用 &#36; 跳脫。原因以真實新聞標題呈現。"""
    out = []

    # 1) 今天美股大盤
    out.append(_sec("📈 今天美股大盤"))
    idx = mk.get_indices()
    idx_cards = []
    for i in idx:
        up = i["pct"] >= 0
        cc = _GREEN if up else _RED
        arrow = "▲" if up else "▼"
        idx_cards.append(
            f"<div class='tcard' style='border-left-color:{cc}'>"
            f"<div class='nm'>{i['name']}</div>"
            f"<div style='color:{cc};font-weight:800'>{arrow} {i['pct']:+.2f}%</div></div>")
    out.append("".join(idx_cards))
    spx = next((i for i in idx if "S&P" in i["name"]), None)
    if spx:
        mood = ("偏多、風險偏好回升" if spx["pct"] > 0.3
                else "偏空、避險情緒升溫" if spx["pct"] < -0.3 else "小幅震盪、方向不明")
        out.append(f"<div style='color:#8a8983;font-size:.86rem;margin:0 0 8px 2px'>"
                   f"📌 整體{mood}。</div>")
    mnews = mk.get_market_news(4)
    if mnews:
        news_cards = []
        for n in mnews:
            meta = " · ".join(x for x in [n.get("provider", ""), n.get("pub", "")] if x)
            body = f"<div class='nrow-t'>{n['title']}</div><div class='nrow-m'>{meta}</div>"
            news_cards.append(f"<a href='{n['link']}' target='_blank' class='nrow'>{body}</a>"
                              if n.get("link") else f"<div class='nrow'>{body}</div>")
        out.append("".join(news_cards))

    # 2) 我的持股：今日大幅漲跌
    out.append(_sec("🔔 我的持股：今日大幅漲跌"))
    movers = sorted([r for r in rows if abs(r.get("day_pct") or 0) >= 3],
                    key=lambda r: -abs(r["day_pct"]))
    if not movers:
        out.append(_bcard("今天沒有漲跌超過 3% 的持股，整體平穩 👍", cc=_GREEN))
    else:
        # limit=4 才會跟 /api/_warm_cache 用同一組快取鍵，不然每次都要重新現抓，很慢；
        # 平行抓也是因為同樣的原因——就算真的沒中快取，也不用一支一支排隊等。
        with ThreadPoolExecutor(max_workers=min(6, len(movers))) as ex:
            mover_news = list(ex.map(lambda r: mk.get_news(r["symbol"], 4), movers))
        for r, news in zip(movers, mover_news):
            up = r["day_pct"] > 0
            cc = _GREEN if up else _RED
            d = "大漲" if up else "大跌"
            headline = news[0]["title"] if news else "（暫無相關新聞）"
            title = (f"{r['symbol']} <span style='color:{cc};font-weight:800'>"
                     f"今日{d} {r['day_pct']:+.1f}%</span>")
            out.append(_bcard(title, headline, cc))

    # 3) 值得關注的股票
    out.append(_sec("🎯 值得關注的股票"))
    watch_syms = (watch_syms or [])[:6]
    if not watch_syms:
        out.append(_bcard("你的追蹤清單是空的",
                          "到「👀 追蹤清單」加入想買的股票，這裡每天就會幫你盯著＋附上新聞。"))
    else:
        with ThreadPoolExecutor(max_workers=min(6, len(watch_syms))) as ex:
            quotes = list(ex.map(mk.get_light, watch_syms))
            watch_news = list(ex.map(lambda s: mk.get_news(s, 4), watch_syms))
        for s, q, news in zip(watch_syms, quotes, watch_news):
            trend = ("多頭趨勢" if (q["ma50"] and q["ma200"] and q["price"] > q["ma50"] > q["ma200"])
                     else "偏弱" if (q["ma200"] and q["price"] < q["ma200"]) else "區間整理")
            headline = news[0]["title"] if news else "（暫無相關新聞）"
            title = (f"{s} 現價 &#36;{q['price']:,.2f}（今日 {q['change_pct']:+.1f}%）· {trend}")
            out.append(_bcard(title, headline))

    # 4) 我的組合摘要
    if rows:
        total_mv = sum(r["market_value"] for r in rows)
        total_cost = sum(r["cost"] for r in rows)
        pl = total_mv - total_cost
        plpct = pl / total_cost * 100 if total_cost else 0
        tw = f"（約 NT&#36;{total_mv * usdtwd:,.0f}）" if usdtwd else ""
        out.append(_sec("💼 我的組合摘要"))
        gain20 = [r["symbol"] for r in rows
                  if r["pl_pct"] >= 20 and not is_dca(r.get("note"))]
        sub = f"🎯 已達 +20%、可留意獲利了結：{'、'.join(gain20)}（定期定額標的不列入）" if gain20 else ""
        pl_cc = _GREEN if pl >= 0 else _RED
        title = (f"總市值 &#36;{total_mv:,.0f}{tw}，未實現損益 "
                 f"<span style='color:{pl_cc};font-weight:800'>"
                 f"&#36;{pl:+,.0f}（{plpct:+.1f}%）</span>")
        out.append(_bcard(title, sub, pl_cc))

    out.append("<div style='color:#8a8983;font-size:.8rem;margin-top:4px'>"
               "※ 依即時數據與新聞自動整理，非投資建議。</div>")
    return "".join(out)


def analyze_watch(q: dict, target_buy, rsi_val) -> dict:
    """回傳追蹤股「現在值不值得買」的判斷。"""
    price = q.get("price") or 0.0
    ma50 = q.get("ma50") or 0.0
    ma200 = q.get("ma200") or 0.0
    target = _num(q.get("target_mean"))
    rec = q.get("recommend")
    target_buy = _num(target_buy)

    upside = ((target - price) / price * 100) if (target and price) else None
    score = 0
    reasons = []

    if target_buy and price <= target_buy:
        score += 2; reasons.append(f"🟢 已跌到你的目標買價 ${target_buy:,.2f} 以下")
    elif target_buy:
        gap = (price - target_buy) / target_buy * 100
        reasons.append(f"⏳ 距你的目標買價還高 {gap:.0f}%")

    if ma50 and ma200 and price > ma50 > ma200:
        score += 1; reasons.append("🟢 多頭排列，趨勢向上")
    elif ma200 and price < ma200:
        reasons.append("🟠 仍在 200 日均線之下，趨勢偏弱")

    if rec in ("strong_buy", "buy"):
        score += 1; reasons.append(f"🟢 分析師：{REC_ZH.get(rec)}")
    if upside is not None and upside >= 15:
        score += 1; reasons.append(f"🟢 距目標價 {upside:+.0f}% 空間")
    if rsi_val is not None and rsi_val <= 35:
        score += 1; reasons.append(f"🔵 RSI {rsi_val:.0f} 偏超賣，較佳進場點")
    elif rsi_val is not None and rsi_val >= 75:
        score -= 1; reasons.append(f"🟠 RSI {rsi_val:.0f} 過熱，別追高")

    if score >= 3:
        label, emoji, color = "可考慮進場", "🟢", "#2f9e44"
    elif score >= 1:
        label, emoji, color = "接近，續觀察", "🟡", "#f08c00"
    else:
        label, emoji, color = "再等等", "⚪", "#868e96"

    return {"label": label, "emoji": emoji, "color": color, "score": score,
            "reasons": reasons or ["ℹ️ 無明顯訊號。"], "upside": upside,
            "rec": REC_ZH.get(rec, "無")}
