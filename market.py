# -*- coding: utf-8 -*-
"""行情資料層：所有 Yahoo Finance 的抓取都集中在這裡，並加上快取。"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pandas as pd
import requests
import streamlit as st

try:
    import yfinance as yf
    HAS_YF = True
except Exception:
    HAS_YF = False

# Yahoo Finance 有時候對雲端主機（Render 這類）的 IP 回應得很慢甚至掛住不回應，
# 一律用這個 pool 包一層時間上限，避免單一卡住的請求拖垮整個 App（其他請求
# 會被卡在同一個執行緒池裡排隊等）。
_NET_POOL = ThreadPoolExecutor(max_workers=32)


def _bounded(fn, *args, timeout=6, retries=1, **kwargs):
    """跟 Yahoo 要資料：有時只是同時打太多次被暫時擋一下，重試一次通常就過了。
    兩次都失敗就直接 raise（不要回傳假的預設值！）——凡是包這層的函式都設計成
    「失敗就整個 raise 出去、不快取」，這樣下次呼叫才會真的重新問一次，
    不會卡在同一個壞結果裡一路卡到快取過期（之前這樣讓 VOO 這種正常股票
    顯示 -100% 損益，卡了整整 10 分鐘的快取時間）。"""
    last_exc = RuntimeError("_bounded: no attempt made")
    for attempt in range(retries + 1):
        fut = _NET_POOL.submit(fn, *args, **kwargs)
        try:
            return fut.result(timeout=timeout)
        except Exception as e:
            last_exc = e
    raise last_exc

# 產業中文對照
SECTOR_ZH = {
    "Technology": "科技",
    "Communication Services": "通訊服務",
    "Consumer Cyclical": "非必需消費",
    "Consumer Defensive": "必需消費",
    "Financial Services": "金融",
    "Healthcare": "醫療保健",
    "Industrials": "工業",
    "Energy": "能源",
    "Utilities": "公用事業",
    "Real Estate": "房地產",
    "Basic Materials": "原物料",
    "": "其他/未分類",
    None: "其他/未分類",
}


# 公司在做什麼（中文一句話）；查不到就用產業/英文摘要
BIZ_ZH = {
    "AMZN": "電商與雲端運算（AWS）龍頭",
    "APP": "手機遊戲廣告與行銷技術平台",
    "ASML": "半導體微影設備（EUV 曝光機）獨家供應商",
    "AVGO": "半導體與企業軟體（晶片、網通、AI）",
    "CRWV": "AI 雲端運算（GPU 算力）服務商",
    "INTC": "CPU 與晶圓代工半導體大廠",
    "LITE": "光通訊與雷射元件（資料中心光模組）",
    "META": "臉書、IG、WhatsApp 社群與數位廣告",
    "MU": "記憶體晶片（DRAM／NAND）大廠",
    "TTWO": "遊戲開發商（GTA、NBA 2K）",
    "VOO": "追蹤標普 500 的指數型 ETF",
    "VRT": "資料中心電源與散熱設備",
    "NVDA": "AI／繪圖晶片（GPU）龍頭",
    "GOOG": "Google 搜尋、雲端、YouTube",
    "GOOGL": "Google 搜尋、雲端、YouTube",
    "SNOW": "雲端資料倉儲平台",
    "AMD": "CPU／GPU 半導體大廠",
    "MRVL": "資料中心網通晶片",
    "SMR": "小型模組化核電（SMR）",
    "CHA": "中式茶飲連鎖（霸王茶姬）",
    "PANW": "網路資安（防火牆、雲端資安）",
    "SNDK": "儲存與快閃記憶體",
    "MSFT": "微軟：軟體與雲端（Azure、Office）",
    "AAPL": "iPhone、Mac 與服務生態系",
    "TSLA": "電動車與能源",
    "TSM": "台積電 ADR：晶圓代工龍頭",
}


def biz_zh(symbol, industry=""):
    return BIZ_ZH.get(symbol.upper(), industry or "—")


# 公司官網網域（給 Clearbit logo 用）；沒對應的就不顯示 logo（避免破圖）
DOMAIN = {
    "AMZN": "amazon.com", "APP": "applovin.com", "ASML": "asml.com",
    "AVGO": "broadcom.com", "CRWV": "coreweave.com", "INTC": "intel.com",
    "LITE": "lumentum.com", "META": "meta.com", "MU": "micron.com",
    "TTWO": "take2games.com", "VOO": "vanguard.com", "VRT": "vertiv.com",
    "NVDA": "nvidia.com", "GOOG": "google.com", "GOOGL": "google.com",
    "SNOW": "snowflake.com", "AMD": "amd.com", "MRVL": "marvell.com",
    "SMR": "nuscalepower.com", "CHA": "chagee.com", "PANW": "paloaltonetworks.com",
    "SNDK": "sandisk.com", "MSFT": "microsoft.com", "AAPL": "apple.com",
    "TSLA": "tesla.com", "TSM": "tsmc.com", "PLTR": "palantir.com",
    "NFLX": "netflix.com", "COST": "costco.com",
}


def logo_url(symbol):
    # Financial Modeling Prep 依「股票代號」提供 logo（任何美股皆適用）
    return f"https://financialmodelingprep.com/image-stock/{symbol.upper()}.png"


def _ts_to_date(ts):
    """unix 秒 -> date；抓不到回 None。"""
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).date()
    except Exception:
        return None


def _empty_quote(symbol):
    return {
        "symbol": symbol, "name": symbol, "sector": "", "industry": "",
        "currency": "USD", "market_state": "", "price": 0.0, "prev_close": 0.0,
        "change": 0.0, "change_pct": 0.0, "day_high": 0.0, "day_low": 0.0,
        "pre_price": None, "pre_pct": None, "post_price": None, "post_pct": None,
        "wk52_high": 0.0, "wk52_low": 0.0, "ma50": 0.0, "ma200": 0.0,
        "pe": None, "market_cap": None, "div_rate": None, "div_yield": None,
        "ex_div_date": None, "div_date": None, "earnings_date": None,
        "target_mean": None, "recommend": None, "ok": False,
    }


@st.cache_data(ttl=600, show_spinner=False)
def _get_quote_cached(symbol: str) -> dict:
    q = _empty_quote(symbol)
    t = yf.Ticker(symbol)

    def _fi():
        return dict(t.fast_info)

    def _info():
        try:
            return t.info or {}
        except Exception:
            return {}

    def _cal():
        try:
            return t.calendar or {}
        except Exception:
            return {}

    # 三個 yfinance 呼叫互相獨立，平行抓取加快載入；每個都設時間上限，
    # 免得 Yahoo 那邊卡住不回應時，這個 request 也跟著卡住不放。
    with ThreadPoolExecutor(max_workers=3) as ex:
        fi_f, info_f, cal_f = ex.submit(_fi), ex.submit(_info), ex.submit(_cal)
        # fast_info 是現價的關鍵資料，這裡故意不接 except：抓不到就讓例外整個
        # 往外傳、不要快取這次結果，下次呼叫才會真的重新問一次，不然會把
        # 「現價 0」快取起來卡 10 分鐘（曾經讓 VOO 這種正常股票顯示 -100%）。
        fi = fi_f.result(timeout=6)
        try:
            info = info_f.result(timeout=6)
        except Exception:
            info = {}
        try:
            cal = cal_f.result(timeout=6)
        except Exception:
            cal = {}

    if not fi.get("lastPrice"):
        raise RuntimeError(f"empty fast_info for {symbol}")

    q["price"] = float(fi.get("lastPrice") or 0)
    q["prev_close"] = float(fi.get("previousClose") or 0)
    q["day_high"] = float(fi.get("dayHigh") or 0)
    q["day_low"] = float(fi.get("dayLow") or 0)
    q["wk52_high"] = float(fi.get("yearHigh") or 0)
    q["wk52_low"] = float(fi.get("yearLow") or 0)
    q["ma50"] = float(fi.get("fiftyDayAverage") or 0)
    q["ma200"] = float(fi.get("twoHundredDayAverage") or 0)
    q["market_cap"] = fi.get("marketCap")
    q["currency"] = fi.get("currency") or "USD"
    if info:
        q["name"] = info.get("shortName") or info.get("longName") or symbol
        q["sector"] = info.get("sector") or ""
        q["industry"] = info.get("industry") or ""
        q["market_state"] = info.get("marketState") or ""
        # 現價/昨收一律用上面 fast_info 的 lastPrice/previousClose，跟持股清單
        # （get_light）同一個資料來源，不要在這裡用 info 的 regularMarketPrice
        # 覆蓋掉，不然清單跟個股詳細頁的損益金額會兜不起來。
        q["pre_price"] = info.get("preMarketPrice")
        q["pre_pct"] = info.get("preMarketChangePercent")
        q["post_price"] = info.get("postMarketPrice")
        q["post_pct"] = info.get("postMarketChangePercent")
        q["pe"] = info.get("trailingPE")
        q["div_rate"] = info.get("dividendRate")
        q["div_yield"] = info.get("dividendYield")
        q["ex_div_date"] = _ts_to_date(info.get("exDividendDate"))
        q["earnings_date"] = _ts_to_date(info.get("earningsTimestamp"))
        q["target_mean"] = info.get("targetMeanPrice")
        q["recommend"] = info.get("recommendationKey")
    # 財報 / 除息日（calendar 較準）
    try:
        ed = cal.get("Earnings Date")
        if isinstance(ed, list) and ed:
            q["earnings_date"] = ed[0]
        elif ed:
            q["earnings_date"] = ed
        if cal.get("Ex-Dividend Date"):
            q["ex_div_date"] = cal.get("Ex-Dividend Date")
        if cal.get("Dividend Date"):
            q["div_date"] = cal.get("Dividend Date")
    except Exception:
        pass
    if q["prev_close"]:
        q["change"] = q["price"] - q["prev_close"]
        q["change_pct"] = q["change"] / q["prev_close"] * 100
    q["ok"] = q["price"] > 0
    return q


def get_quote(symbol: str) -> dict:
    """單一股票的即時報價 + 基本面 + 盤前盤後 + 分析師資料。
    抓失敗（尤其現價）不會被快取，下次呼叫會重新真的問一次，不會卡住顯示 0。"""
    if not HAS_YF:
        return _empty_quote(symbol)
    try:
        return _get_quote_cached(symbol)
    except Exception:
        return _empty_quote(symbol)


def _empty_light(symbol):
    return {"symbol": symbol, "name": symbol, "sector": "", "price": 0.0,
           "prev_close": 0.0, "change_pct": 0.0, "ma50": 0.0, "ma200": 0.0,
           "wk52_high": 0.0, "wk52_low": 0.0}


@st.cache_data(ttl=600, show_spinner=False)  # 跟 get_quote 同一個快取時間，清單跟詳細頁才不會分別顯示不同時間點的價格
def _get_light_cached(symbol: str) -> dict:
    fi = _bounded(lambda: dict(yf.Ticker(symbol).fast_info))
    if not fi.get("lastPrice"):
        raise RuntimeError(f"empty fast_info for {symbol}")
    out = _empty_light(symbol)
    out["price"] = float(fi.get("lastPrice") or 0)
    out["prev_close"] = float(fi.get("previousClose") or 0)
    out["ma50"] = float(fi.get("fiftyDayAverage") or 0)
    out["ma200"] = float(fi.get("twoHundredDayAverage") or 0)
    out["wk52_high"] = float(fi.get("yearHigh") or 0)
    out["wk52_low"] = float(fi.get("yearLow") or 0)
    if out["prev_close"]:
        out["change_pct"] = (out["price"] - out["prev_close"]) / out["prev_close"] * 100
    return out


def get_light(symbol: str) -> dict:
    """輕量報價：只用 fast_info（快很多），給總覽/卡片用。
    抓失敗不會被快取，下次呼叫會重新真的問一次，不會卡住顯示 0。"""
    if not HAS_YF:
        return _empty_light(symbol)
    try:
        return _get_light_cached(symbol)
    except Exception:
        return _empty_light(symbol)


@st.cache_data(ttl=300, show_spinner=False)
def get_indices() -> list:
    """美股大盤指數即時漲跌。"""
    out = []
    if not HAS_YF:
        return out
    for sym, name in [("^GSPC", "S&P 500"), ("^IXIC", "那斯達克"),
                      ("^DJI", "道瓊"), ("^SOX", "費城半導體")]:
        try:
            fi = _bounded(lambda s=sym: dict(yf.Ticker(s).fast_info))
            if not fi.get("lastPrice"):
                continue
            p = float(fi.get("lastPrice") or 0)
            pc = float(fi.get("previousClose") or 0)
            out.append({"name": name, "price": p,
                        "pct": (p - pc) / pc * 100 if pc else 0})
        except Exception:
            pass
    return out


@st.cache_data(ttl=900, show_spinner=False)
def get_market_news(limit: int = 5) -> list:
    """美股大盤相關新聞（用 S&P500 / SPY）。"""
    news = get_news("^GSPC", limit)
    if not news:
        news = get_news("SPY", limit)
    return news


@st.cache_data(ttl=900, show_spinner=False)
def portfolio_value_series(holdings_tuple, period: str, interval: str) -> pd.Series:
    """把每檔『股數 × 歷史收盤』相加 → 投資組合歷史總市值(USD) 時間序列。
       holdings_tuple = ((symbol, shares), ...)（tuple 方便快取）。"""
    frames = []
    for sym, sh in holdings_tuple:
        h = get_chart(sym, period, interval)
        if h.empty or not sh:
            continue
        frames.append((h["Close"] * float(sh)).rename(sym))
    if not frames:
        return pd.Series(dtype=float)
    df = pd.concat(frames, axis=1).sort_index().ffill().dropna()
    return df.sum(axis=1)


@st.cache_data(ttl=300, show_spinner=False)
def _get_chart_cached(symbol: str, period: str, interval: str) -> pd.DataFrame:
    h = _bounded(lambda: yf.Ticker(symbol).history(period=period, interval=interval), timeout=8)
    if h is None or h.empty:
        raise RuntimeError(f"empty chart for {symbol}")
    return h


def get_chart(symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    """抓失敗（空資料）不會被快取，下次呼叫會重新真的問一次。"""
    if not HAS_YF:
        return pd.DataFrame()
    try:
        return _get_chart_cached(symbol, period, interval)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=86400, show_spinner=False)
def _translate_zh(text: str) -> str:
    """免費、免金鑰的 Google 翻譯（英文新聞標題→中文）。失敗就照原文顯示。"""
    if not text or not text.strip():
        return text
    try:
        r = requests.get(
            "https://translate.googleapis.com/translate_a/single",
            params={"client": "gtx", "sl": "auto", "tl": "zh-TW", "dt": "t", "q": text},
            timeout=4,
        )
        data = r.json()
        return "".join(seg[0] for seg in data[0] if seg and seg[0]) or text
    except Exception:
        return text


@st.cache_data(ttl=900, show_spinner=False)
def get_news(symbol: str, limit: int = 4) -> list:
    """抓新聞標題並翻成中文（不抓冗長摘要，標題就夠）。翻譯平行處理加快載入。"""
    if not HAS_YF:
        return []
    items = []
    try:
        news = _bounded(lambda: yf.Ticker(symbol).news) or []
        for n in news[:limit]:
            c = n.get("content", n)
            title = c.get("title") or n.get("title")
            if not title:
                continue
            link = ""
            if isinstance(c.get("clickThroughUrl"), dict):
                link = c["clickThroughUrl"].get("url", "")
            link = link or c.get("link") or n.get("link", "")
            prov = c.get("provider", {})
            provider = prov.get("displayName", "") if isinstance(prov, dict) else ""
            pub = c.get("pubDate") or ""
            items.append({"title": title, "link": link,
                          "provider": provider, "pub": str(pub)[:10]})
    except Exception:
        pass
    if items:
        with ThreadPoolExecutor(max_workers=len(items)) as ex:
            titles_zh = list(ex.map(_translate_zh, [it["title"] for it in items]))
        for it, tzh in zip(items, titles_zh):
            it["title"] = tzh
    return items


@st.cache_data(ttl=600, show_spinner=False)
def _get_usdtwd_cached() -> float:
    h = _bounded(lambda: yf.Ticker("TWD=X").history(period="5d"))
    if h is None or h.empty:
        raise RuntimeError("empty TWD=X history")
    return float(h["Close"].iloc[-1])


def get_usdtwd() -> float:
    """抓失敗不會被快取，下次呼叫會重新真的問一次，不會卡著回傳 0。"""
    if not HAS_YF:
        return 0.0
    try:
        return _get_usdtwd_cached()
    except Exception:
        return 0.0


def rsi(series: pd.Series, period: int = 14) -> float:
    """計算最新 RSI；資料不足回 None。"""
    if series is None or len(series) < period + 1:
        return None
    delta = series.diff().dropna()
    up = delta.clip(lower=0).rolling(period).mean()
    down = (-delta.clip(upper=0)).rolling(period).mean()
    rs = up / down.replace(0, 1e-9)
    val = 100 - 100 / (1 + rs)
    try:
        return float(val.iloc[-1])
    except Exception:
        return None
