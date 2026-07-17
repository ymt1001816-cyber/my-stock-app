# -*- coding: utf-8 -*-
"""
📈 我的美股投資中心 (國泰複委託適用)
====================================================
功能總覽：
  🏠 總覽      - 資產總額、當日損益、產業分布、快速健檢
  📦 我的持股  - 卡片式呈現，點進去看個股完整資訊 (像看股票 App)；新增/編輯持股與交易都在這頁的展開區塊
  👀 追蹤清單  - 想買/值得買的股票，持續關注進場點；編輯清單也在這頁展開區塊
  📊 統計報表  - 歷史已實現損益、年度/季度、個股排行 (吃 Excel)；匯入/備份在這頁展開區塊
  📰 每日簡報 - 免費規則式盤點投資組合、給提醒

即時股價、盤前盤後、財報日、除息日、分析師評等：Yahoo Finance
資料全部存在本機，不外流。
執行：  雙擊 執行.bat  或  python -m streamlit run app.py
"""

import os
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pandas as pd
import streamlit as st

import market as mk
import analysis as an

try:
    import plotly.graph_objects as go
    HAS_PLOTLY = True
except Exception:
    HAS_PLOTLY = False

# ------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOLDINGS_FILE = os.path.join(BASE_DIR, "holdings.csv")
WATCH_FILE = os.path.join(BASE_DIR, "watchlist.csv")
HISTORY_FILE = os.path.join(BASE_DIR, "history.csv")
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")

HOLD_COLS = ["symbol", "shares", "avg_cost", "stop_price", "note"]
WATCH_COLS = ["symbol", "target_buy", "note"]

GREEN = "#4a9a6c"   # 獲利 / 上漲（低飽和）
RED = "#c26661"     # 虧損 / 下跌（低飽和）
GREY = "#94907f"    # 中性（暖灰）
ORANGE = "#d9822b"  # 注意 / 配息（低飽和）

st.set_page_config(page_title="我的美股投資中心", page_icon="📈", layout="centered",
                   initial_sidebar_state="collapsed")

# 全域樣式：淺灰底、金黃色點綴、圓潤科技風
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap');
:root{
  --ink:#2b2b28; --sub:#87867e; --line:rgba(40,38,30,.11);
  --card:#ffffff; --card2:#f1f0ec;
  --accent:#dba53f; --accent-dk:#b8802a; --accent-lt:#f3ddb0;
  --green:#3f9668; --red:#c1685f;
  --r-sm:12px; --r-md:16px; --r-lg:22px; --r-xl:26px;
  --sh-sm:0 1px 3px rgba(40,38,30,.08);
  --sh-md:0 3px 10px rgba(40,38,30,.09), 0 1px 3px rgba(40,38,30,.07);
  --sh-lg:0 14px 32px -8px rgba(30,28,22,.20), 0 2px 8px rgba(30,28,22,.08);
  --bounce:cubic-bezier(.34,1.56,.64,1);
}
.stApp{background:
  radial-gradient(1100px 520px at 12% -8%, #f8f7f4 0%, transparent 60%),
  radial-gradient(900px 480px at 100% 0%, #f4f2ec 0%, transparent 55%),
  #ececea}
.block-container{padding-top:1.8rem;padding-bottom:3rem;max-width:1080px}
html, body, [class*="css"]{font-size:15px}
h1,h2,h3,.nm,.wb,[data-testid="stMetricValue"]{
  font-family:'Manrope',-apple-system,'Segoe UI','PingFang TC','Microsoft JhengHei',sans-serif}
[data-testid="stMetricValue"]{font-size:1.15rem;color:var(--ink)}
[data-testid="stMetricLabel"]{font-size:.78rem;color:var(--sub)}
/* metric 卡片 */
[data-testid="stMetric"]{background:var(--card);border:1px solid var(--line);
  border-radius:var(--r-md);padding:13px 16px;box-shadow:var(--sh-sm);
  transition:box-shadow .2s,transform .2s var(--bounce)}
[data-testid="stMetric"]:hover{box-shadow:var(--sh-md);transform:translateY(-2px) scale(1.015)}
.statgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin:4px 0 2px}
.statcell{background:var(--card);border:1px solid var(--line);border-radius:var(--r-sm);
  padding:9px 13px;box-shadow:var(--sh-sm)}
.statcell .l{font-size:.7rem;color:var(--sub);line-height:1.3}
.statcell .v{font-size:1.02rem;font-weight:700;line-height:1.35;color:var(--ink)}
/* 關鍵數據：仿 Apple 股市，一排可左右滑動的小卡 */
/* 關鍵數據：iOS 設定風格，全部塞進同一張卡片，一列三個 */
.statcardwrap{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:14px 16px 4px;box-shadow:var(--sh-sm);margin:4px 0 2px}
.statcardwrap .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px 8px}
.statcardwrap .cell .l{font-size:.66rem;color:var(--sub);line-height:1.3;margin-bottom:3px}
.statcardwrap .cell .v{font-size:.88rem;font-weight:700;color:var(--ink);line-height:1.3}
.statcardwrap .cell{padding-bottom:14px}
/* 區塊標題：左側色條＋圓點 */
.sec{position:relative;font-size:1.04rem;font-weight:800;letter-spacing:.2px;
  margin:26px 0 10px;padding-left:13px;color:var(--ink)}
.sec::before{content:'';position:absolute;left:0;top:2px;bottom:2px;width:4px;
  border-radius:99px;background:linear-gradient(180deg,var(--accent),var(--accent-dk))}
.posblock{border-radius:var(--r-md);padding:14px 18px;margin:6px 0;box-shadow:var(--sh-sm)}
/* 統計摘要：全部合併成一張卡片 */
.statsummary{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:16px 18px;box-shadow:var(--sh-sm);margin:4px 0 2px}
.statsummary .row+.row{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.statsummary .l{font-size:.78rem;color:var(--sub);font-weight:700}
.statsummary .v{font-size:1.3rem;font-weight:800;margin-top:3px}
.statsummary .s{font-size:.78rem;color:var(--sub);margin-top:2px}
.badge{display:inline-block;border-radius:999px;padding:5px 15px;font-weight:800;
  font-size:.92rem;box-shadow:inset 0 0 0 1px rgba(0,0,0,.03)}
/* st.container(border=True) 持股小卡 */
[data-testid="stVerticalBlockBorderWrapper"]{border-radius:var(--r-lg)!important;
  background:var(--card);border:1px solid var(--line)!important;
  box-shadow:var(--sh-md)!important}
div[data-testid="stExpander"]{border-radius:var(--r-md);box-shadow:var(--sh-sm)}
button[kind]{border-radius:999px!important;
  transition:transform .2s var(--bounce),box-shadow .2s!important}
button[kind]:hover{transform:translateY(-1px) scale(1.02);box-shadow:var(--sh-sm)}
button[kind]:active{transform:scale(.95)!important;transition:transform .08s!important}
button[kind="primary"]{background:linear-gradient(135deg,#c99a3c,#a97c28)!important;
  border:none!important;box-shadow:var(--sh-sm)!important;color:#fff!important}
/* 返回鈕：小圓按鈕，靠最左上角，可愛一點 */
.st-key-backnav{margin-bottom:6px}
.st-key-backnav button{width:42px!important;height:42px!important;min-width:42px!important;
  padding:0!important;border-radius:50%!important;font-size:1.15rem!important;
  font-weight:800!important;background:var(--card)!important;
  border:1px solid var(--line)!important;box-shadow:var(--sh-sm)!important;color:var(--ink)!important}
.st-key-backnav button:hover{transform:translateY(-1px) scale(1.05);box-shadow:var(--sh-md)!important}
/* 標題列：讓右邊的圓形按鈕跟標題保持同一行，手機也不要疊行 */
.st-key-txheader{width:100%}
.st-key-txheader div[data-testid="stHorizontalBlock"]{flex-wrap:nowrap!important;
  align-items:center!important;gap:6px!important;width:100%!important}
.st-key-txheader div[data-testid="stColumn"]{width:auto!important;min-width:0!important;
  flex:0 0 auto!important}
.st-key-txheader div[data-testid="stColumn"]:first-child{flex:1 1 auto!important}
/* 幣別切換：小小一顆藥丸按鈕 */
.st-key-curbtn button{height:38px!important;padding:0 14px!important;
  border-radius:999px!important;font-size:.78rem!important;font-weight:700!important;
  white-space:nowrap;background:var(--card)!important;border:1px solid var(--line)!important;
  box-shadow:var(--sh-sm)!important;color:var(--ink)!important}
/* 新增交易：圓形按鈕，靠右邊；展開的表單用浮出的方式，不會把標題擠不見 */
.st-key-addtx{display:flex;justify-content:flex-end;position:relative;z-index:20}
.st-key-addtx div[data-testid="stExpander"]{border:none!important;box-shadow:none!important;
  background:transparent!important;width:fit-content!important;margin-left:auto}
.st-key-addtx details{border:none!important}
.st-key-addtx div[data-testid="stExpanderDetails"]{position:absolute!important;top:52px;
  right:0;width:min(95vw,440px);z-index:100;background:var(--card)!important;
  border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--sh-lg);
  padding:14px 16px}
.st-key-addtx summary{width:42px;height:42px;border-radius:50%!important;padding:0!important;
  display:flex!important;align-items:center;justify-content:center;gap:0!important;
  background:radial-gradient(circle at 30% 24%, rgba(255,255,255,.98) 0%,
    rgba(255,255,255,.62) 36%, rgba(228,234,237,.4) 72%, rgba(206,216,222,.3) 100%)!important;
  backdrop-filter:blur(8px) saturate(1.3);-webkit-backdrop-filter:blur(8px) saturate(1.3);
  box-shadow:0 6px 16px -4px rgba(60,70,80,.25), 0 2px 5px rgba(60,70,80,.12),
    inset 0 -4px 8px rgba(120,135,145,.16), inset 0 3px 5px rgba(255,255,255,.95)!important;
  border:1px solid rgba(255,255,255,.75)!important;
  list-style:none;position:relative;overflow:visible;
  transition:transform .3s var(--bounce),box-shadow .3s}
.st-key-addtx summary::before{content:'';position:absolute;top:6px;left:9px;
  width:13px;height:7px;border-radius:50%;background:rgba(255,255,255,.95);
  filter:blur(.5px);transform:rotate(-25deg);pointer-events:none}
.st-key-addtx summary:hover{transform:scale(1.12) translateY(-2px);
  box-shadow:0 10px 20px -4px rgba(60,70,80,.3), 0 2px 6px rgba(60,70,80,.15),
    inset 0 -4px 8px rgba(120,135,145,.16), inset 0 3px 5px rgba(255,255,255,.95)!important}
.st-key-addtx summary:active{transform:scale(.9)}
.st-key-addtx summary span:has(> [data-testid="stIconMaterial"]){display:none!important}
.st-key-addtx summary > span{display:flex!important;align-items:center;justify-content:center;
  width:100%;height:100%}
.st-key-addtx summary > span > div{display:flex!important;align-items:center;
  justify-content:center;width:100%;height:100%;text-align:center!important}
.st-key-addtx summary div[data-testid="stMarkdownContainer"]{width:100%;text-align:center!important}
.st-key-addtx summary p{color:var(--ink)!important;font-size:1.25rem!important;margin:0!important;
  font-weight:700!important;line-height:1}
h1{font-size:1.68rem!important;font-weight:800!important;letter-spacing:.1px}
hr{border-color:var(--line)!important}
/* 底部固定分頁列（手機 App 風格） */
.bottomnav{position:fixed;bottom:0;left:0;right:0;z-index:9999;display:flex;
  justify-content:space-around;align-items:center;gap:2px;
  background:rgba(255,255,255,.86);backdrop-filter:blur(14px) saturate(1.4);
  border-top:1px solid var(--line);padding:7px 8px calc(9px + env(safe-area-inset-bottom));
  box-shadow:0 -8px 26px rgba(30,28,22,.10)}
.navlink{text-decoration:none!important;text-align:center;flex:1;padding:9px 2px;
  border-radius:14px;transition:background .2s,transform .2s var(--bounce)}
.navlink:hover{background:var(--card2);transform:translateY(-1px)}
.navlink:active{transform:scale(.9)}
.navlink.active{background:linear-gradient(180deg,rgba(219,165,63,.20),rgba(219,165,63,.07));
  box-shadow:inset 0 0 0 1px rgba(219,165,63,.25)}
.navlink .ic{font-size:1.55rem;line-height:1.1;transition:transform .25s var(--bounce)}
.navlink.active .ic{transform:scale(1.14)}
.block-container{padding-bottom:84px!important}
/* 可左右滑動的卡片列（Apple Wallet 感） */
.carousel{display:flex;gap:13px;overflow-x:auto;padding:4px 2px 16px;
  scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
.carousel::-webkit-scrollbar{height:6px}
.carousel::-webkit-scrollbar-thumb{background:#d4d3ce;border-radius:99px}
.wcard{position:relative;overflow:hidden;min-width:214px;flex:0 0 auto;
  scroll-snap-align:start;border-radius:var(--r-xl);padding:17px 20px;color:#fff;
  box-shadow:var(--sh-lg);transition:transform .25s var(--bounce)}
.wcard::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(120px 90px at 88% -10%, rgba(255,255,255,.30), transparent 70%)}
.wcard:hover{transform:translateY(-3px) scale(1.015)}
.wcard:active{transform:scale(.97)}
.wcard .wl{font-size:.8rem;opacity:.88;font-weight:700;letter-spacing:.2px}
.wcard .wb{font-size:1.68rem;font-weight:800;margin:5px 0 2px;letter-spacing:.3px}
.wcard .ws{font-size:.83rem;opacity:.92;font-weight:500}
/* 淨資產：純文字放最上面，無底色無邊框 */
.hero-plain{padding:6px 2px 4px}
.hero-plain .wl{font-size:.85rem;font-weight:700;color:var(--sub);letter-spacing:.2px}
.hero-plain .wb{font-size:2.3rem;font-weight:800;color:var(--ink);margin:6px 0 3px;letter-spacing:.2px}
.hero-plain .ws{font-size:.85rem;color:var(--sub);font-weight:500}
/* 兩張等大小卡：今日損益、未實現損益 */
.wrow{display:flex;gap:9px;margin:0 0 8px}
.wrow>a{flex:1 1 0;min-width:0;display:block;text-decoration:none!important;color:inherit!important}
.wcard.sm{min-width:0;flex:1 1 0;padding:12px 11px;border-radius:var(--r-lg);
  background:var(--card)!important;border:1px solid var(--line);
  box-shadow:var(--sh-sm)!important;color:var(--ink);display:flex;flex-direction:column;
  justify-content:space-between;min-height:78px}
.wcard.sm::after{display:none}
.wcard.sm .wl{font-size:.66rem;letter-spacing:0;color:var(--sub);opacity:1}
.wcard.sm .wb{font-size:1.12rem;margin:3px 0 1px}
.wcard.sm .ws{font-size:.68rem;color:var(--sub);opacity:1}
/* 可用資金：細長條 */
.cashstrip{display:flex;align-items:center;justify-content:space-between;gap:8px;
  background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);
  padding:11px 16px;margin:0 0 10px;box-shadow:var(--sh-sm);color:var(--ink);
  transition:box-shadow .2s,transform .2s var(--bounce)}
.cashstrip:hover{box-shadow:var(--sh-md);transform:translateY(-1px)}
.cashstrip:active{transform:scale(.98)}
.cashstrip .l{font-size:.82rem;font-weight:700;color:var(--sub)}
.cashstrip .v{font-size:1rem;font-weight:800;margin-right:auto;margin-left:10px;color:var(--ink)}
.cashstrip .arrow{font-size:1.3rem;color:var(--sub);font-weight:700}
/* 資產配置卡片 */
.alloccard{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);
  padding:16px 18px 8px;box-shadow:var(--sh-md);margin:6px 0 4px}
/* 資產配置橫條 */
.allocbar{display:flex;height:15px;border-radius:99px;overflow:hidden;margin:2px 0 12px;
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.05), var(--sh-sm)}
.allocbar span{height:100%}
.legend{display:flex;align-items:center;justify-content:space-between;
  padding:8px 4px;border-radius:10px;font-size:.94rem;transition:background .12s}
.legend:hover{background:var(--card2)}
.legend .dot{width:10px;height:10px;border-radius:99px;display:inline-block;margin-right:9px;
  box-shadow:0 0 0 3px rgba(0,0,0,.03)}
/* 券商風格持倉列（整列可點，改為堆疊小卡） */
.hlink{text-decoration:none!important;color:inherit!important;display:block}
.hitem{display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:var(--card);padding:12px 14px;margin-bottom:8px;border-radius:var(--r-md);
  border:1px solid var(--line);box-shadow:var(--sh-sm);
  transition:box-shadow .2s,transform .2s var(--bounce),border-color .2s}
.hitem:hover{box-shadow:var(--sh-md);transform:translateY(-2px) scale(1.008);
  border-color:rgba(219,165,63,.38)}
.hitem:active{transform:scale(.98)}
.nm{font-weight:800;font-size:1.04rem;line-height:1.2;color:var(--ink)}
.sub{color:var(--sub);font-size:.78rem}
.chip{display:inline-block;border-radius:999px;padding:2px 9px;font-weight:800;
  font-size:.82rem;margin-top:2px;transition:transform .2s var(--bounce)}
.hitem:hover .chip{transform:scale(1.06)}
/* 交易卡片 */
.tcard{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);
  border-radius:var(--r-md);padding:12px 16px;margin:9px 0;
  display:flex;justify-content:space-between;align-items:center;box-shadow:var(--sh-sm);
  transition:box-shadow .2s,transform .2s var(--bounce)}
.tcard:hover{box-shadow:var(--sh-md);transform:translateY(-2px) scale(1.008)}
.tcard:active{transform:scale(.98)}
.tcard.buy{border-left-color:var(--red)}
.tcard.sell{border-left-color:var(--green)}
.tcard.div{border-left-color:#d9822b}
/* 新聞：一句話重點列表，不用點進去也能秒懂 */
.nrow{display:block;text-decoration:none!important;color:inherit!important;
  background:var(--card);border:1px solid var(--line);border-radius:var(--r-sm);
  padding:9px 13px;margin-bottom:7px;box-shadow:var(--sh-sm);
  transition:box-shadow .2s,transform .2s var(--bounce),border-color .2s}
.nrow:hover{box-shadow:var(--sh-md);transform:translateY(-2px) scale(1.008);
  border-color:rgba(219,165,63,.38)}
.nrow:active{transform:scale(.98)}
.nrow-t{font-weight:700;font-size:.92rem;line-height:1.35;color:var(--ink)}
.nrow-m{color:var(--sub);font-size:.72rem;margin-top:4px}
/* 每日簡報：一張張卡片 */
.bcard{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);
  border-radius:var(--r-md);padding:11px 15px;margin:8px 0;box-shadow:var(--sh-sm)}
.bcard .t{font-weight:800;font-size:.98rem;color:var(--ink)}
.bcard .s{color:#5c5b56;font-size:.86rem;margin-top:4px;line-height:1.4}
</style>
""", unsafe_allow_html=True)


# ------------------------------------------------------------------
# 資料讀寫
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


def load_watch():
    return load_csv(WATCH_FILE, WATCH_COLS, ["target_buy"])


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
        df["type"] = "賣出"          # 舊資料一律當賣出
    df["type"] = df["type"].fillna("賣出").astype(str)
    return df


def save_holdings(df):
    df[HOLD_COLS].to_csv(HOLDINGS_FILE, index=False, encoding="utf-8-sig")


def save_watch(df):
    df[WATCH_COLS].to_csv(WATCH_FILE, index=False, encoding="utf-8-sig")


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            return json.load(open(CONFIG_FILE, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_config(cfg):
    json.dump(cfg, open(CONFIG_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


# ------------------------------------------------------------------
# 小工具
# ------------------------------------------------------------------
def color_of(x):
    if x is None:
        return GREY
    return GREEN if x > 0 else (RED if x < 0 else GREY)


# 幣別狀態（側邊欄設定後覆寫）
CUR_USD = True
RATE = 0.0


def seg(options, default, key=None):
    """按鈕式單選（取代圓點 radio）。回傳選中的選項；點掉時退回 default。"""
    val = st.segmented_control(
        "seg", options, default=default, label_visibility="collapsed", key=key)
    return val if val is not None else default


def cur_button():
    """幣別切換：小小一顆按鈕，放在每頁標題旁邊（取代原本頂端獨立一整條）。"""
    with st.container(key="curbtn"):
        if st.button("USD" if CUR_USD else "TWD", key="cur_toggle"):
            cfg["cur"] = "TWD" if CUR_USD else "USD"
            save_config(cfg)
            st.rerun()


def page_header(title, n_extra=0):
    """標題列：標題（伸縮）＋幣別切換＋可選的額外小按鈕欄位（如新增用的圓形按鈕）。
       回傳額外欄位的 column 物件 list（n_extra=0 時回傳 []）。"""
    with st.container(key="txheader"):
        cols = st.columns([4, 1] + [1] * n_extra)
        cols[0].title(title)
        with cols[1]:
            cur_button()
    return cols[2:]


def _mny(u, sign, dollar):
    if u is None:
        return "—"
    if CUR_USD or not RATE:
        v, pre, dec = u, dollar, 2
    else:
        v, pre, dec = u * RATE, "NT" + dollar, 0
    s = f"{v:+,.{dec}f}" if sign else f"{v:,.{dec}f}"
    return f"{pre}{s}"


def fmt_money(x, sign=False):
    """給 st.metric / 純 markdown 用（\\$ 跳脫）；跟著選定幣別。"""
    return _mny(x, sign, "\\$")


def mh(x, sign=False):
    """給原始 HTML(unsafe_allow_html) 用（&#36; 實體）；跟著選定幣別。"""
    return _mny(x, sign, "&#36;")


def usd_only(x):
    """永遠以美金顯示（每股價格用，HTML 版）。"""
    return "—" if x is None else f"&#36;{x:,.2f}"


def pct(x):
    return f"{x:+.2f}%" if x is not None else "—"


def esc(s):
    """HTML 內文用：把 $ 換成 HTML 實體，避免被當成 LaTeX 或殘留反斜線。"""
    return str(s).replace("$", "&#36;")


def stat_grid(items):
    """緊湊的資訊格：items = [(label, value, color), ...]。
       value 若含金額請先用 fmt_money 或自行以 \\$ 跳脫。"""
    cells = "".join(
        f"<div class='statcell'><div class='l'>{l}</div>"
        f"<div class='v' style='color:{c}'>{v}</div></div>"
        for l, v, c in items)
    st.markdown(f"<div class='statgrid'>{cells}</div>", unsafe_allow_html=True)


def stat_card_group(items):
    """關鍵數據：仿 iOS 系統風格，全部放進同一張卡片，一列三個，重要的排前面。
       items = [(label, value, color), ...]。"""
    cells = "".join(
        f"<div class='cell'><div class='l'>{l}</div>"
        f"<div class='v' style='color:{c}'>{v}</div></div>"
        for l, v, c in items)
    st.markdown(f"<div class='statcardwrap'><div class='grid3'>{cells}</div></div>",
                unsafe_allow_html=True)


def sec(title):
    st.markdown(f"<div class='sec'>{title}</div>", unsafe_allow_html=True)


def stock_row(symbol, sub, price, day_pct, emoji="", weight=None):
    """券商/股票 App 風格的一列（持股與追蹤清單共用）：
       左：LOGO(可含佔比圓環)＋代號＋副標；右：現價＋單日漲跌%。整列可點開詳細。
       weight：佔比%（0-100），有給就畫成圓環包住 LOGO。"""
    lg = mk.logo_url(symbol)
    if weight is not None:
        deg = max(0, min(360, weight / 100 * 360))
        d0, d1 = max(0, deg - 3), min(360, deg + 3)
        logo = (f"<div style='width:42px;height:42px;flex:0 0 auto;border-radius:50%;"
                f"background:conic-gradient(#1a1a1a 0deg,#1a1a1a {d0:.0f}deg,"
                f"#e2e0da {d1:.0f}deg,#e2e0da 360deg);padding:4px'>"
                f"<div style='width:100%;height:100%;border-radius:50%;"
                f"background:#d9d7cc url(\"{lg}\") center/72% no-repeat'></div></div>")
    else:
        logo = (f"<div style='width:36px;height:36px;flex:0 0 auto;border-radius:9px;"
                f"border:1px solid #c3c1b3;background:#d9d7cc url(\"{lg}\") "
                f"center/78% no-repeat'></div>")
    dc = color_of(day_pct)
    arrow = "▲" if (day_pct or 0) >= 0 else "▼"
    return (f"<a href='?sel={symbol}' target='_self' class='hlink'><div class='hitem'>"
            f"<div style='display:flex;align-items:center;gap:11px;min-width:0'>{logo}"
            f"<div style='min-width:0'><div class='nm'>{emoji}{symbol}</div>"
            f"<div class='sub' style='overflow:hidden;text-overflow:ellipsis;"
            f"white-space:nowrap'>{sub}</div></div></div>"
            f"<div style='text-align:right;white-space:nowrap'>"
            f"<div style='font-size:1.18rem;font-weight:800;color:var(--ink)'>{usd_only(price)}</div>"
            f"<span class='chip' style='color:{dc};background:{dc}1c'>"
            f"{arrow} {pct(day_pct)}</span></div></div></a>")


def apple_chart(hist):
    """Apple 股票 App 風格：折線 + 區域填色，依區間漲跌變色。"""
    if hist.empty or not HAS_PLOTLY:
        if not hist.empty:
            st.line_chart(hist["Close"])
        return
    close = hist["Close"].dropna()
    up = close.iloc[-1] >= close.iloc[0]
    color = GREEN if up else RED
    fillc = "rgba(47,158,68,0.10)" if up else "rgba(224,49,49,0.10)"
    fig = go.Figure(go.Scatter(
        x=close.index, y=close, mode="lines",
        line=dict(color=color, width=2),
        fill="tozeroy", fillcolor=fillc,
        hovertemplate="%{y:.2f}<extra></extra>"))
    lo, hi = float(close.min()), float(close.max())
    pad = (hi - lo) * 0.12 or 1
    fig.update_layout(height=260, margin=dict(l=0, r=0, t=6, b=0),
                      showlegend=False, plot_bgcolor="white", paper_bgcolor="white")
    fig.update_xaxes(showgrid=False)
    fig.update_yaxes(showgrid=True, gridcolor="#eef1f4", side="right",
                     range=[lo - pad, hi + pad])
    st.plotly_chart(fig, use_container_width=True)


def enrich_holdings(hold):
    """為每筆持股補上即時報價與計算欄位（用輕量快抓＋平行抓取，加快載入）。"""
    recs = hold.to_dict("records")
    if not recs:
        return []
    with ThreadPoolExecutor(max_workers=min(10, len(recs))) as ex:
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
            "sector": mk.SECTOR_ZH.get(q["sector"], q["sector"] or "其他/未分類"),
            "name": q["name"],
        })
    return rows


# ------------------------------------------------------------------
# 側邊欄 / 導覽
# ------------------------------------------------------------------
cfg = load_config()
if "selected" not in st.session_state:
    st.session_state.selected = None

# 底部分頁列的頁籤定義（key, emoji, 短標, 完整頁名）
NAV = [("home", "🏠", "總覽", "🏠 總覽"),
       ("hold", "📦", "持股", "📦 我的持股"),
       ("watch", "👀", "追蹤", "👀 追蹤清單"),
       ("stats", "📊", "統計", "📊 統計報表"),
       ("brief", "📰", "簡報", "📰 每日簡報")]
NAV_MAP = {k: full for k, _, _, full in NAV}
navkey = st.query_params.get("nav", "home")
if navkey not in NAV_MAP:
    navkey = "home"
page = NAV_MAP[navkey]

# 幣別狀態（按鈕小小地放在每頁標題旁邊，見 cur_button()）
RATE = mk.get_usdtwd()
CUR_USD = (cfg.get("cur", "USD") == "USD") or not RATE

# 底部固定分頁列（手機 App 風格，只顯示 icon）
_nav_html = "".join(
    f"<a href='?nav={k}' target='_self' class='navlink{' active' if k == navkey else ''}' "
    f"title='{lab}'>"
    f"<div class='ic'>{ic}</div></a>"
    for k, ic, lab, _ in NAV)
st.markdown(f"<div class='bottomnav'>{_nav_html}</div>", unsafe_allow_html=True)

usdtwd = RATE            # 相容舊變數名（賣出換算等）


def twd_note(usd):       # 單一幣別模式下不再附加，保留避免呼叫端出錯
    return ""


def twd_html(usd):
    return ""


# ==================================================================
# 個股詳細頁 (從持股/追蹤卡片點進來)
# ==================================================================
def render_detail(symbol, position=None):
    q = mk.get_quote(symbol)
    with st.container(key="backnav"):
        if st.button("←", key="back_detail"):
            st.session_state.selected = None
            st.query_params.clear()
            st.query_params["nav"] = "hold"
            st.rerun()
    lg = mk.logo_url(symbol)
    logo_html = (f"<span style='display:inline-block;width:40px;height:40px;"
                 f"vertical-align:middle;margin-right:12px;border-radius:9px;"
                 f"border:1px solid #c3c1b3;background:#d9d7cc url(\"{lg}\") "
                 f"center/78% no-repeat'></span>")
    st.markdown(f"<h1 style='margin:0'>{logo_html}{symbol} · {q['name']}</h1>",
                unsafe_allow_html=True)
    st.markdown(f"<div style='color:#6b7280;margin:4px 0 2px'>🏢 "
                f"{mk.biz_zh(symbol, q['industry'])}　·　"
                f"{mk.SECTOR_ZH.get(q['sector'], q['sector'] or '未分類')}</div>",
                unsafe_allow_html=True)

    # 現價 + 盤前盤後（大字、緊湊一行）
    dc = color_of(q["change_pct"])
    state = q.get("market_state", "")
    state_txt = {"REGULAR": "🟢 盤中", "PRE": "🌅 盤前", "POST": "🌙 盤後",
                 "POSTPOST": "🌙 盤後", "PREPRE": "🌅 盤前",
                 "CLOSED": "🔴 收盤"}.get(state, state or "")
    extra = ""
    if q.get("pre_price"):
        extra = f"　🌅 盤前 &#36;{q['pre_price']:,.2f}（{pct(q['pre_pct'])}）"
    if q.get("post_price"):
        extra = f"　🌙 盤後 &#36;{q['post_price']:,.2f}（{pct(q['post_pct'])}）"
    disp_state = "" if extra else state_txt   # 有盤前/盤後就不重複顯示狀態
    st.markdown(
        f"<span style='font-size:2.1rem;font-weight:800'>&#36;{q['price']:,.2f}</span>　"
        f"<span style='color:{dc};font-size:1.2rem;font-weight:700'>{pct(q['change_pct'])}</span>"
        f"　<span style='color:#8a94a6'>{disp_state}</span>"
        f"<span style='color:#8a94a6;font-size:.9rem'>{extra}</span>",
        unsafe_allow_html=True)

    # RSI 用日線計算（我的部位判斷要用）
    daily = mk.get_chart(symbol, period="6mo")
    rsi_val = mk.rsi(daily["Close"]) if not daily.empty else None

    if position:
        sec("💼 我的部位")
        shares = position.get("shares", 0) or 0
        avg = position.get("avg_cost", 0) or 0
        mv = shares * q["price"]
        cost = shares * avg
        pl = mv - cost
        plpct = (pl / cost * 100) if cost else 0
        pc = color_of(pl)
        st.markdown(
            f"<div class='posblock' style='background:{pc}14;border-left:6px solid {pc}'>"
            f"<span style='color:{pc};font-size:1.5rem;font-weight:800'>"
            f"{mh(pl, sign=True)}（{plpct:+.1f}%）</span></div>",
            unsafe_allow_html=True)
        stat_grid([
            ("持有股數", f"{shares:g}", GREY),
            ("平均成本/股", usd_only(avg), GREY),
            ("投入成本", mh(cost), GREY),
            ("目前市值", mh(mv), GREY),
        ])

        # 📈 投資成果：未實現 + 已實現 + 累積股息 = 總報酬（仿 Holdary）
        _h = load_history()
        _sh = _h[_h["symbol"] == symbol] if not _h.empty else pd.DataFrame()
        realized = float(_sh[_sh["type"] != "配息"]["pl_usd"].sum()) if len(_sh) else 0.0
        divs = float(_sh[_sh["type"] == "配息"]["pl_usd"].sum()) if len(_sh) else 0.0
        total_ret = pl + realized + divs
        sec("📈 投資成果（總報酬）")
        stat_grid([
            ("未實現損益", mh(pl, sign=True), color_of(pl)),
            ("已實現損益", mh(realized, sign=True), color_of(realized)),
            ("累積股息", mh(divs), GREEN if divs > 0 else GREY),
            ("總報酬", mh(total_ret, sign=True), color_of(total_ret)),
        ])

        verdict = an.analyze_holding(q, shares, avg, position.get("stop_price"), rsi_val)
        dca = an.is_dca(position.get("note"))
        sec("🎯 停損 / 目標價（每股，美金）")
        stat_grid([
            ("🛑 建議停損", f"&#36;{verdict['suggest_stop']:,.2f}", RED),
            ("成本 +10%", f"&#36;{avg*1.10:,.2f}", "#2f9e44"),
            ("成本 +20% 🎯", f"&#36;{verdict['cost_t20']:,.2f}", "#1b7a34"),
            ("現價 +20%", f"&#36;{verdict['t20']:,.2f}", GREEN),
        ])
        # +20% 提醒（定期定額不提醒了結）
        if dca:
            st.caption("📈 這是定期定額標的，長期持有為主，不需急著獲利了結。")
        elif plpct >= 20:
            st.markdown(
                f"<div class='posblock' style='background:#2f9e4418;border-left:6px solid {GREEN}'>"
                f"🎯 <b style='color:{GREEN}'>已達 +{plpct:.0f}%！</b> "
                f"可以看看要不要獲利了結一部分囉。</div>", unsafe_allow_html=True)
        elif avg:
            gap = (avg * 1.20 - q["price"]) / q["price"] * 100
            st.caption(f"距『成本 +20%』賣點（&#36;{avg*1.20:,.2f}）還差約 {gap:.1f}%")

        # 判斷：與卡片用同一套 analyze_light → 保證一致
        sec("🧭 該續抱還是賣出？")
        lv = an.analyze_light(q["price"], q.get("ma50", 0), q.get("ma200", 0),
                              plpct, position.get("stop_price"), dca)
        st.markdown(f"<span class='badge' style='background:{lv['color']}22;"
                    f"color:{lv['color']}'>{lv['emoji']} {lv['label']}</span>",
                    unsafe_allow_html=True)
        for reason in lv["reasons"]:
            st.markdown(f"<div style='font-size:.88rem;margin:2px 0'>{esc(reason)}</div>",
                        unsafe_allow_html=True)
        st.caption("※ 機械式規則計算，非投資建議。")

    # 走勢圖（Apple 股票 App 風格，含當天）
    sec("📈 走勢圖")
    rng = seg(["當天", "1週", "1月", "3月", "6月", "1年"], "1月", key="seg_range")
    pi = {"當天": ("1d", "5m"), "1週": ("5d", "30m"), "1月": ("1mo", "1d"),
          "3月": ("3mo", "1d"), "6月": ("6mo", "1d"), "1年": ("1y", "1d")}[rng]
    hist = mk.get_chart(symbol, period=pi[0], interval=pi[1])
    if hist.empty:
        st.info("暫時抓不到走勢資料，稍後重整。")
    else:
        apple_chart(hist)

    # 關鍵數據（仿 iOS 系統風格：一張卡片，一列三個、重要的放前面）
    sec("🔑 關鍵數據")
    mcap = q["market_cap"]
    tgt_up = bool(q["target_mean"] and q["target_mean"] > q["price"])
    stat_card_group([
        ("分析師", f"{usd_only(q['target_mean']) if q['target_mean'] else '—'} · "
         f"{an.REC_ZH.get(q['recommend'], '—')}", GREEN if tgt_up else GREY),
        ("52週高/低", f"{usd_only(q['wk52_high'])} / {usd_only(q['wk52_low'])}", GREY),
        ("今日高/低", f"{usd_only(q['day_high'])} / {usd_only(q['day_low'])}", GREY),
        ("本益比", f"{q['pe']:.1f}" if q["pe"] else "—", GREY),
        ("市值", f"&#36;{mcap/1e9:,.0f}B" if mcap else "—", GREY),
        ("50/200日均", f"{usd_only(q['ma50'])} / {usd_only(q['ma200'])}", GREY),
        ("殖利率", f"{q['div_yield']:.2f}%" if q["div_yield"] else "無配息", GREY),
        ("每股股利", usd_only(q["div_rate"]) if q["div_rate"] else "—", GREY),
    ])

    # 重要日期（緊湊一格）
    sec("📅 重要日期")
    stat_grid([
        ("下次財報日", str(q["earnings_date"]) if q["earnings_date"] else "—",
         "#e8590c" if q["earnings_date"] else GREY),
        ("除息日", str(q["ex_div_date"]) if q["ex_div_date"] else "無", GREY),
        ("配息日", str(q["div_date"]) if q["div_date"] else "無", GREY),
    ])

    # 新聞：只抓標題，翻成中文，不用點進去也能秒懂
    sec("📰 相關新聞")
    news = mk.get_news(symbol, limit=4)
    if not news:
        st.caption("暫無新聞。")
    else:
        rows = []
        for n in news:
            meta = " · ".join(x for x in [n.get("provider", ""), n.get("pub", "")] if x)
            body = f"<div class='nrow-t'>{esc(n['title'])}</div><div class='nrow-m'>{esc(meta)}</div>"
            rows.append(f"<a href='{n['link']}' target='_blank' class='nrow'>{body}</a>"
                        if n["link"] else f"<div class='nrow'>{body}</div>")
        st.markdown("".join(rows), unsafe_allow_html=True)


def render_trend(hold):
    """資產走勢頁：日/月/年 → 投資組合歷史市值折線 + 變化長條（仿 Holdary）。"""
    with st.container(key="backnav"):
        if st.button("←", key="back_trend"):
            st.query_params.clear()
            st.rerun()
    st.markdown("# 📈 資產走勢")
    if hold.empty:
        st.info("先新增持股才有走勢可看。")
        return
    gran = seg(["日", "月", "年"], "日", key="seg_gran")
    period, interval, resample = {"日": ("1mo", "1d", None),
                                  "月": ("1y", "1d", "ME"),
                                  "年": ("5y", "1mo", "YE")}[gran]
    ht = tuple((r["symbol"], float(r["shares"] or 0)) for _, r in hold.iterrows())
    with st.spinner("計算歷史市值中…（約 10-20 秒）"):
        s = mk.portfolio_value_series(ht, period, interval)
    if s.empty or len(s) < 2:
        st.info("暫時抓不到足夠的歷史資料，稍後再試。")
        return
    if resample:
        s = s.resample(resample).last().dropna()
    change = s.diff().dropna()
    cur = float(s.iloc[-1])
    delta = float(s.iloc[-1] - s.iloc[0])
    pctchg = delta / s.iloc[0] * 100 if s.iloc[0] else 0

    m = st.columns(2)
    m[0].metric("目前市值", fmt_money(cur))
    m[1].metric(f"{gran}走勢變化", fmt_money(delta, sign=True), pct(pctchg))

    if HAS_PLOTLY:
        up = delta >= 0
        line_c = GREEN if up else RED
        fig = go.Figure(go.Scatter(x=s.index, y=s.values, mode="lines",
                                   line=dict(color=line_c, width=2.5),
                                   fill="tozeroy",
                                   fillcolor="rgba(74,154,108,0.10)" if up
                                   else "rgba(194,102,97,0.10)"))
        lo, hi = float(s.min()), float(s.max())
        pad = (hi - lo) * 0.12 or 1
        fig.update_layout(height=280, margin=dict(l=0, r=0, t=6, b=0), showlegend=False,
                          plot_bgcolor="white", paper_bgcolor="white")
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(showgrid=True, gridcolor="#eef1f4", side="right",
                         range=[lo - pad, hi + pad])
        sec("每期市值走勢")
        st.plotly_chart(fig, use_container_width=True)

        sec(f"每{gran}變化")
        colors = [GREEN if v >= 0 else RED for v in change.values]
        bar = go.Figure(go.Bar(x=change.index, y=change.values, marker_color=colors))
        bar.update_layout(height=220, margin=dict(l=0, r=0, t=6, b=0),
                          plot_bgcolor="white", paper_bgcolor="white")
        bar.update_xaxes(showgrid=False)
        bar.update_yaxes(showgrid=True, gridcolor="#eef1f4", side="right")
        st.plotly_chart(bar, use_container_width=True)
    else:
        st.line_chart(s)
    st.caption("※ 以目前持股股數 × 歷史股價回推，僅供參考；未計入期間買賣變動。")


def render_cash(cfg):
    """點「可用資金」卡片 → 設定可用資金頁。"""
    with st.container(key="backnav"):
        if st.button("←", key="back_cash"):
            st.query_params.clear()
            st.rerun()
    st.markdown("# 💵 設定可用資金")
    cash_in = st.number_input("可用資金（USD，可買入的現金）",
                              min_value=0.0, step=100.0, format="%.2f",
                              value=float(cfg.get("cash_usd") or 0))
    if st.button("儲存", type="primary", use_container_width=True):
        cfg["cash_usd"] = cash_in
        save_config(cfg)
        st.success("已儲存！")
        st.rerun()


# ==================================================================
# 頁面路由
# ==================================================================
hold = load_holdings()

# --- 點擊單日損益卡（?trend=1）→ 資產走勢頁 ---
if st.query_params.get("trend"):
    render_trend(hold)
    st.stop()

# --- 點擊可用資金卡片（?cash=1）→ 設定可用資金頁 ---
if st.query_params.get("cash"):
    render_cash(cfg)
    st.stop()

# --- 點擊持倉列（?sel=代號）→ 開啟個股詳細頁 ---
_sel = st.query_params.get("sel")
if _sel:
    st.session_state.selected = _sel   # 不在此清除 query param，改由返回時清

# --- 若有選取個股，優先顯示詳細頁 ---
if st.session_state.selected:
    sym = st.session_state.selected
    pos = None
    match = hold[hold["symbol"] == sym]
    if not match.empty:
        pos = match.iloc[0].to_dict()
    render_detail(sym, pos)
    st.stop()


# ------------------------------------------------------------------
# 🏠 總覽
# ------------------------------------------------------------------
if page == "🏠 總覽":
    page_header("🏠 投資總覽")
    if hold.empty:
        st.info("還沒有持股資料。請到 **📦 我的持股** 新增你目前持有的股票"
                "（只需填代號、股數、平均成本）。")
    else:
        with st.spinner("抓取即時報價中…"):
            rows = enrich_holdings(hold)
        total_mv = sum(r["market_value"] for r in rows)
        total_cost = sum(r["cost"] for r in rows)
        total_pl = total_mv - total_cost
        day_pl = sum((r["price"] - r["q"]["prev_close"]) * (r["shares"] or 0)
                     for r in rows if r["q"]["prev_close"])
        plpct = (total_pl / total_cost * 100) if total_cost else 0

        cash = float(cfg.get("cash_usd") or 0)
        assets = total_mv + cash

        # 淨資產：純文字放最上面，不要底色/邊框
        hero = (f"<div class='hero-plain'>"
                f"<div class='wl'>資產總額 · 持股＋現金</div>"
                f"<div class='wb'>{mh(assets)}</div>"
                f"<div class='ws'>持股 {mh(total_mv)}</div></div>")
        st.markdown(f"<a href='?trend=1' target='_self' style='text-decoration:none;"
                    f"color:inherit;display:block'>{hero}</a>", unsafe_allow_html=True)

        # 兩張等大小卡：今日損益、未實現損益（不可點）
        def wcard(label, big, sub, vcolor):
            return (f"<div class='wcard sm'><div class='wl'>{label}</div>"
                    f"<div class='wb' style='color:{vcolor}'>{big}</div>"
                    f"<div class='ws'>{sub}</div></div>")

        small_cards = [
            wcard("今日損益", mh(day_pl, sign=True), "與昨日相比", color_of(day_pl)),
            wcard("未實現損益", mh(total_pl, sign=True), pct(plpct), color_of(total_pl)),
        ]
        st.markdown(f"<div class='wrow'>{''.join(small_cards)}</div>", unsafe_allow_html=True)

        # 可用資金：細長條，點進去可以設定
        cash_strip = (f"<div class='cashstrip'><span class='l'>💵 可用資金</span>"
                      f"<span class='v'>{mh(cash)}</span><span class='arrow'>›</span></div>")
        st.markdown(f"<a href='?cash=1' target='_self' "
                    f"style='text-decoration:none;color:inherit'>{cash_strip}</a>",
                    unsafe_allow_html=True)
        st.caption("👉 **點資產總額看資產走勢**　·　**點可用資金設定金額**")

        # 📊 資產配置橫條（依個股）— 整個包成一張卡片
        if total_mv:
            sec("📊 資產配置")
            # 彩虹配色（不含紫色）：紅橙黃綠藍靛，其餘用中性色補位
            palette = ["#d9564a", "#dd8a3d", "#d9b83f", "#5a9e52", "#3aa89e",
                       "#4a8fc9", "#3f6fae", "#9a9a4a", "#a8734a", "#8f8a7a"]
            order = sorted(rows, key=lambda r: -r["market_value"])
            items = [(r["symbol"], r["market_value"]) for r in order[:8]]
            if order[8:]:
                items.append(("其他", sum(r["market_value"] for r in order[8:])))
            if cash > 0:
                items.append(("現金", cash))
            base = sum(v for _, v in items) or 1
            segs = "".join(
                f"<span style='width:{v/base*100:.2f}%;"
                f"background:{palette[i % len(palette)]}'></span>"
                for i, (n, v) in enumerate(items))
            legend_html = "".join(
                f"<div class='legend'><span><span class='dot' "
                f"style='background:{palette[i % len(palette)]}'></span>{n}</span>"
                f"<span><b>{mh(v)}</b>　<span style='color:#8a8983'>"
                f"{v/base*100:.1f}%</span></span></div>"
                for i, (n, v) in enumerate(items))
            st.markdown(f"<div class='alloccard'><div class='allocbar'>{segs}</div>"
                        f"{legend_html}</div>", unsafe_allow_html=True)

        # 🎯 已達 +20%，可考慮獲利了結（定期定額標的不列入）
        winners = sorted([r for r in rows if r["pl_pct"] >= 20
                          and not an.is_dca(r.get("note"))], key=lambda r: -r["pl_pct"])
        if winners:
            sec("🎯 已達 +20%，可以看看要不要獲利了結")
            for r in winners:
                st.markdown(
                    f"<div class='posblock' style='background:#2f9e4415;border-left:5px solid {GREEN}'>"
                    f"<b>{r['symbol']}</b> <span style='color:#6b7280'>{r['name'][:16]}</span>　"
                    f"<span style='color:{GREEN};font-weight:800'>+{r['pl_pct']:.0f}%"
                    f"（{mh(r['pl'], sign=True)}）</span>"
                    f"　<span style='color:#6b7280'>現價 {usd_only(r['price'])}</span></div>",
                    unsafe_allow_html=True)

        # 🚦 需要注意
        sec("🚦 需要注意")
        alerts = []
        for r in rows:
            v = an.analyze_light(r["price"], r["q"].get("ma50", 0),
                                 r["q"].get("ma200", 0), r["pl_pct"], r.get("stop_price"))
            if v["label"] == "考慮停損":
                alerts.append((RED, f"🔴 <b>{r['symbol']}</b> 考慮停損（{r['pl_pct']:+.1f}%，"
                                     f"{mh(r['pl'], sign=True)}）"))
            elif v["label"] == "偏弱觀察":
                alerts.append((ORANGE, f"🟠 <b>{r['symbol']}</b> 走勢偏弱，可考慮減碼"
                                       f"（{r['pl_pct']:+.1f}%，{mh(r['pl'], sign=True)}）"))
            if abs(r["day_pct"] or 0) >= 5:
                dd = "大漲" if r["day_pct"] > 0 else "大跌"
                cc = GREEN if r["day_pct"] > 0 else ORANGE
                day_amt = (r["price"] - r["q"]["prev_close"]) * (r["shares"] or 0) \
                    if r["q"].get("prev_close") else None
                amt_txt = f"，{mh(day_amt, sign=True)}" if day_amt is not None else ""
                alerts.append((cc, f"📢 <b>{r['symbol']}</b> 今日{dd} {r['day_pct']:+.1f}%{amt_txt}"))
        if not alerts:
            st.success("✅ 目前沒有需要特別注意的持股，投資組合穩定。")
        for cc, msg in alerts:
            st.markdown(f"<div class='posblock' style='background:{cc}17;"
                        f"border-left:5px solid {cc};color:var(--ink)'>{msg}</div>",
                        unsafe_allow_html=True)


# ------------------------------------------------------------------
# 📦 我的持股 (卡片)
# ------------------------------------------------------------------
elif page == "📦 我的持股":
    _th_extra = page_header("📦 我的持股", n_extra=1)
    with _th_extra[0]:
        with st.container(key="addtx"):
            with st.expander("+"):
                st.caption("先選類型 → 選/填股票 → 填細節。會自動更新持股、已實現損益，並記進交易筆記。")
                ttype = seg(["🟢 買進", "🔴 賣出", "💵 配息"], "🟢 買進", key="seg_ttype")
                held_syms = hold["symbol"].tolist()
                _hist = load_history()
                allsym = sorted(set(held_syms + (_hist["symbol"].tolist()
                                                 if not _hist.empty else [])))

                def _append_history(rec):
                    h = load_history()
                    h = (pd.concat([h, pd.DataFrame([rec])], ignore_index=True)
                         if not h.empty else pd.DataFrame([rec]))
                    h.to_csv(HISTORY_FILE, index=False, encoding="utf-8-sig")

                if "買進" in ttype:
                    with st.form("buy_form", clear_on_submit=True):
                        s = st.text_input("股票代號（如 NVDA）").upper().strip()
                        c = st.columns(3)
                        sh = c[0].number_input("買進股數", min_value=0.0, step=1.0, format="%.5f")
                        px = c[1].number_input("買進價 (USD)", min_value=0.0, step=0.01, format="%.4f")
                        dt = c[2].date_input("買進日期", value=date.today())
                        c2 = st.columns(2)
                        fee = c2[0].number_input("手續費 (USD，選填)", min_value=0.0, step=0.01, format="%.2f")
                        stop = c2[1].number_input("停損價 (USD，選填)", min_value=0.0, step=0.01, format="%.2f")
                        note = st.text_input("備註（選填，如：定期定額）")
                        if st.form_submit_button("🟢 確認買進", type="primary"):
                            if s and sh > 0 and px > 0:
                                hh = hold.copy()
                                if s in hh["symbol"].values:
                                    o = hh[hh["symbol"] == s].iloc[0]
                                    osh = float(o["shares"] or 0)
                                    oav = float(o["avg_cost"] or 0)
                                    nsh = osh + sh
                                    nav = (osh * oav + sh * px + fee) / nsh if nsh else px
                                    hh.loc[hh["symbol"] == s, "shares"] = nsh
                                    hh.loc[hh["symbol"] == s, "avg_cost"] = round(nav, 4)
                                    if stop:
                                        hh.loc[hh["symbol"] == s, "stop_price"] = stop
                                    if note:
                                        hh.loc[hh["symbol"] == s, "note"] = note
                                else:
                                    hh = pd.concat([hh, pd.DataFrame([{
                                        "symbol": s, "shares": sh,
                                        "avg_cost": round((sh * px + fee) / sh, 4),
                                        "stop_price": stop or None, "note": note}])], ignore_index=True)
                                save_holdings(hh)
                                q = mk.get_quote(s)
                                qtr = (dt.month - 1) // 3 + 1
                                _append_history({"date": str(dt), "symbol": s, "name": q["name"],
                                                 "type": "買進", "shares": sh, "price": px,
                                                 "pl_pct": 0, "pl_usd": 0, "pl_twd": 0, "fee": fee,
                                                 "tax": 0, "year": dt.year, "quarter": qtr,
                                                 "yq": f"{dt.year}Q{qtr}",
                                                 "cost_usd": round(sh * px + fee, 2), "income_usd": 0})
                                st.success(f"✅ 已買進 {s} {sh:g} 股，持股與平均成本已更新！")
                                st.rerun()
                            else:
                                st.error("請填代號、股數、買進價。")

                elif "賣出" in ttype:
                    if not held_syms:
                        st.info("目前沒有持股可賣。")
                    else:
                        with st.form("sell_form", clear_on_submit=True):
                            s = st.selectbox("賣出哪一檔", held_syms)
                            row = hold[hold["symbol"] == s].iloc[0]
                            held = float(row["shares"] or 0)
                            avg = float(row["avg_cost"] or 0)
                            st.caption(f"目前持有 {held:g} 股，平均成本 ${avg:,.4f}")
                            c = st.columns(3)
                            sh = c[0].number_input("賣出股數", min_value=0.0, max_value=held,
                                                   value=held, step=1.0, format="%.5f")
                            px = c[1].number_input("賣出價 (USD)", min_value=0.0, step=0.01, format="%.4f")
                            dt = c[2].date_input("賣出日期", value=date.today())
                            c2 = st.columns(2)
                            fee = c2[0].number_input("手續費 (USD，選填)", min_value=0.0,
                                                     step=0.01, format="%.2f")
                            tax = c2[1].number_input("交易稅 (USD，選填)", min_value=0.0,
                                                     step=0.01, format="%.2f")
                            if st.form_submit_button("🔴 確認賣出", type="primary"):
                                if sh > 0 and px > 0:
                                    income = sh * px
                                    cost = sh * avg
                                    pl = income - cost - fee - tax
                                    plpct = pl / cost if cost else 0
                                    q = mk.get_quote(s)
                                    qtr = (dt.month - 1) // 3 + 1
                                    _append_history({"date": str(dt), "symbol": s, "name": q["name"],
                                                     "type": "賣出", "shares": sh, "price": px,
                                                     "pl_pct": round(plpct, 6), "pl_usd": round(pl, 2),
                                                     "pl_twd": round(pl * (usdtwd or 0), 2),
                                                     "fee": fee, "tax": tax, "year": dt.year,
                                                     "quarter": qtr, "yq": f"{dt.year}Q{qtr}",
                                                     "cost_usd": round(cost, 2),
                                                     "income_usd": round(income, 2)})
                                    hh = hold.copy()
                                    left = held - sh
                                    if left <= 1e-9:
                                        hh = hh[hh["symbol"] != s]
                                    else:
                                        hh.loc[hh["symbol"] == s, "shares"] = left
                                    save_holdings(hh)
                                    st.success(f"✅ 已賣出 {s} {sh:g} 股，實現損益 "
                                               f"${pl:+,.2f}（{plpct*100:+.1f}%）！")
                                    st.rerun()
                                else:
                                    st.error("請填賣出股數與價格。")

                else:  # 配息
                    with st.form("div_form", clear_on_submit=True):
                        dsym = (st.selectbox("哪一檔", allsym) if allsym
                                else st.text_input("代號").upper().strip())
                        c = st.columns(2)
                        damt = c[0].number_input("股息金額 (USD)", min_value=0.0,
                                                 step=0.01, format="%.2f")
                        ddt = c[1].date_input("配息日期", value=date.today())
                        if st.form_submit_button("💵 記錄配息", type="primary"):
                            if dsym and damt > 0:
                                q = mk.get_quote(dsym)
                                qq = (ddt.month - 1) // 3 + 1
                                _append_history({"date": str(ddt), "symbol": dsym, "name": q["name"],
                                                 "type": "配息", "shares": 0, "price": 0, "pl_pct": 0,
                                                 "pl_usd": round(damt, 2),
                                                 "pl_twd": round(damt * (usdtwd or 0), 2),
                                                 "fee": 0, "tax": 0, "year": ddt.year, "quarter": qq,
                                                 "yq": f"{ddt.year}Q{qq}", "cost_usd": 0,
                                                 "income_usd": round(damt, 2)})
                                st.success(f"✅ 已記錄 {dsym} 配息 ${damt:,.2f}！")
                                st.rerun()
                            else:
                                st.error("請填代號與金額。")

    if hold.empty:
        st.info("還沒有持股。點右上角「➕」買進第一筆持股。")
    else:
        with st.spinner("抓取即時報價中…"):
            rows = enrich_holdings(hold)
        total_mv = sum(r["market_value"] for r in rows) or 1
        sortby = seg(["市值", "代號 A→Z", "單日漲跌"], "市值", key="seg_sort")
        if sortby == "市值":
            rows = sorted(rows, key=lambda r: -r["market_value"])
        elif sortby == "代號 A→Z":
            rows = sorted(rows, key=lambda r: r["symbol"])
        else:
            rows = sorted(rows, key=lambda r: (r["day_pct"] or 0))
        # 股票 App 風格清單：現價＋單日漲跌（手機也能並排、整列可點）
        html = ["<div style='display:flex;justify-content:space-between;color:#8a8983;"
                f"font-size:.76rem;padding:0 4px 6px'><span>持倉 · {len(rows)} 檔</span>"
                "<span>現價　·　單日漲跌</span></div>"]
        for r in rows:
            dca = an.is_dca(r.get("note"))
            vl = an.analyze_light(r["price"], r["q"].get("ma50", 0), r["q"].get("ma200", 0),
                                  r["pl_pct"], r.get("stop_price"), dca)
            wpct = r["market_value"] / total_mv * 100
            html.append(stock_row(r["symbol"], f"{r['shares']:g} 股 · 佔比 {wpct:.1f}%",
                                  r["price"], r["day_pct"], emoji=vl["emoji"] + " ",
                                  weight=wpct))
        st.markdown("".join(html), unsafe_allow_html=True)
        st.caption("👆 點任一列看個股詳細（走勢圖、盤前盤後、財報、建議）")


# ------------------------------------------------------------------
# 👀 追蹤清單
# ------------------------------------------------------------------
elif page == "👀 追蹤清單":
    _wh_extra = page_header("👀 追蹤清單", n_extra=1)
    with _wh_extra[0]:
        with st.container(key="addtx"):
            with st.expander("+"):
                with st.form("quick_watch", clear_on_submit=True):
                    ws = st.text_input("代號").upper().strip()
                    wtb = st.number_input("目標買價（選填）", min_value=0.0, step=0.01, format="%.2f")
                    wnote = st.text_input("備註（選填）")
                    if st.form_submit_button("➕ 加入", type="primary"):
                        if ws:
                            nw = load_watch().copy()
                            if ws not in nw["symbol"].values:
                                nw = pd.concat([nw, pd.DataFrame([{
                                    "symbol": ws, "target_buy": (wtb or None),
                                    "note": wnote}])], ignore_index=True)
                                save_watch(nw)
                                st.success(f"已加入 {ws}！")
                                st.rerun()
                            else:
                                st.info(f"{ws} 已在清單。")
                        else:
                            st.error("請填代號。")

    watch = load_watch()
    if watch.empty:
        st.info("追蹤清單是空的。點右上角「➕」加入。")
    else:
        with st.spinner("抓取即時報價中…"):
            html = ["<div style='display:flex;justify-content:space-between;color:#8a8983;"
                    f"font-size:.76rem;padding:0 4px 6px'><span>觀察 · {len(watch)} 檔</span>"
                    "<span>現價　·　單日漲跌</span></div>"]
            for _, w in watch.iterrows():
                q = mk.get_light(w["symbol"])
                tb = w.get("target_buy")
                v = an.analyze_watch(q, tb if pd.notna(tb) else None, None)
                sub = v["label"] + (f" · 目標 &#36;{tb:,.2f}" if pd.notna(tb) else "")
                html.append(stock_row(w["symbol"], sub, q["price"],
                                      q["change_pct"], emoji=v["emoji"] + " "))
        st.markdown("".join(html), unsafe_allow_html=True)
        st.caption("👆 點任一列看個股詳細（走勢圖、盤前盤後、財報、建議）")


# ------------------------------------------------------------------
# 📊 統計報表
# ------------------------------------------------------------------
elif page == "📊 統計報表":
    page_header("📊 統計報表")
    histdf = load_history()
    if histdf.empty:
        st.info("尚無歷史交易資料。到「📦 我的持股」的「💰 新增交易」新增一筆賣出或配息紀錄。")
    else:
        d = pd.to_datetime(histdf["date"], errors="coerce")
        dmin = d.min()
        dmax = d.max()

        # 📅 選擇區間（預設 + 自訂）
        sec("📅 選擇區間")
        today = date.today()
        period = seg(["全部", "今年", "近 90 天", "自訂"], "全部", key="seg_period")
        if period == "全部":
            start = dmin.date() if pd.notna(dmin) else date(2025, 1, 1)
            end = dmax.date() if pd.notna(dmax) else today
        elif period == "今年":
            start, end = date(today.year, 1, 1), today
        elif period == "近 90 天":
            start = date.fromordinal(today.toordinal() - 90)
            end = today
        else:
            cc = st.columns(2)
            start = cc[0].date_input("開始",
                                     value=dmin.date() if pd.notna(dmin) else date(2025, 1, 1))
            end = cc[1].date_input("結束", value=today)
        rng = histdf[(d.dt.date >= start) & (d.dt.date <= end)]
        rpl = rng["pl_usd"].sum()
        rcost = rng["cost_usd"].sum() if "cost_usd" in rng else 0

        # 統計摘要：全部合併成一張卡片（區間損益＋報酬率合併同一行）
        rpl_cc = color_of(rpl)
        rpct = rpl / rcost * 100 if rcost else None
        total_pl_all = histdf["pl_usd"].sum()
        summary_html = (
            f"<div class='statsummary'>"
            f"<div class='row'><div>"
            f"<div class='l'>區間已實現損益</div>"
            f"<div class='v' style='color:{rpl_cc}'>{mh(rpl, sign=True)}"
            f"{f'（{pct(rpct)}）' if rpct is not None else ''}</div>"
            f"<div class='s'>{period}　·　{len(rng)} 筆交易</div>"
            f"</div></div>"
            f"<div class='row'><div>"
            f"<div class='l'>累計已實現損益</div>"
            f"<div class='v' style='color:{color_of(total_pl_all)}'>{mh(total_pl_all, sign=True)}</div>"
            f"<div class='s'>全部歷史</div>"
            f"</div></div></div>")
        st.markdown(summary_html, unsafe_allow_html=True)

        # 💳 交易明細（卡片式，仿券商 App：成本/現價對照＋損益 chip；預設顯示 10 筆）
        sec(f"💳 交易明細（{len(rng)} 筆）")
        det_all = rng.sort_values("date", ascending=False) if "date" in rng else rng
        if "tx_show" not in st.session_state:
            st.session_state.tx_show = {}
        show_n = st.session_state.tx_show.get(period, 10)
        det = det_all.head(show_n)
        buy_syms = sorted(set(str(s) for s in det.loc[det["type"] == "買進", "symbol"]))
        if buy_syms:
            with ThreadPoolExecutor(max_workers=min(10, len(buy_syms))) as ex:
                live_prices = dict(zip(buy_syms, ex.map(
                    lambda s: mk.get_light(s)["price"], buy_syms)))
        else:
            live_prices = {}

        cards_html = []
        for _, t in det.iterrows():
            sym = str(t["symbol"])
            name = str(t.get("name") or sym)
            plv = t["pl_usd"]
            cclr = color_of(plv)
            lg = mk.logo_url(sym)
            logo = (f"<div style='width:36px;height:36px;flex:0 0 auto;border-radius:8px;"
                    f"border:1px solid #c3c1b3;background:#d9d7cc url(\"{lg}\") "
                    f"center/78% no-repeat'></div>")
            sym_badge = (f"<span style='background:var(--card2);color:var(--sub);"
                         f"font-size:.72rem;font-weight:700;padding:2px 7px;"
                         f"border-radius:6px;margin-right:6px'>{sym}</span>")
            plpct = (t["pl_pct"] * 100) if pd.notna(t.get("pl_pct")) else 0
            ttype = str(t.get("type", "賣出"))
            tag_cc = {"買進": RED, "配息": ORANGE}.get(ttype, GREEN)
            tag = f"<span style='font-weight:700;color:{tag_cc}'>{ttype}</span>"
            date_txt = str(t["date"])[:10]
            head = (f"<div style='display:flex;justify-content:space-between;"
                    f"align-items:flex-start'>"
                    f"<div style='display:flex;align-items:center;gap:10px'>{logo}"
                    f"<div><div class='nm'>{tag}　<span class='sub'>{date_txt}</span></div>"
                    f"<div class='sub' style='margin-top:2px'>{sym_badge}{esc(name)}</div>"
                    f"</div></div>")
            if ttype == "配息":
                cards_html.append(
                    head + f"<div style='text-align:right;color:{GREEN};font-weight:800'>"
                    f"{mh(plv, sign=True)}</div></div>")
            elif ttype == "買進":
                live = live_prices.get(sym)
                foot_l = f"成本 {usd_only(t['price'])}"
                if live:
                    gain = (live - t["price"]) * (t["shares"] or 0)
                    diffpct = (live - t["price"]) / t["price"] * 100 if t["price"] else 0
                    gc = color_of(gain)
                    arrow = "▲" if gain >= 0 else "▼"
                    foot_l += f"　現價 {usd_only(live)}"
                    chip = (f"<span class='chip' style='color:{gc};background:{gc}1c'>"
                            f"{arrow} {mh(gain, sign=True)}（{diffpct:+.1f}%）</span>")
                else:
                    chip = ""
                cards_html.append(
                    head + f"<div style='text-align:right;font-weight:800;"
                    f"font-size:1.05rem'>{t['shares']:g} 股</div></div>"
                    f"<div style='display:flex;justify-content:space-between;align-items:center;"
                    f"margin-top:8px;padding-top:8px;border-top:1px solid var(--line)'>"
                    f"<span class='sub'>{foot_l}</span>{chip}</div>")
            else:
                fee_tax = t.get("fee", 0) + t.get("tax", 0)
                ex_txt = f"（費稅 {usd_only(fee_tax)}）" if fee_tax else ""
                chip = (f"<span class='chip' style='color:{cclr};background:{cclr}1c'>"
                        f"{mh(plv, sign=True)}（{plpct:+.1f}%）</span>")
                cards_html.append(
                    head + f"<div style='text-align:right;font-weight:800;"
                    f"font-size:1.05rem'>{t['shares']:g} 股</div></div>"
                    f"<div style='display:flex;justify-content:space-between;align-items:center;"
                    f"margin-top:8px;padding-top:8px;border-top:1px solid var(--line)'>"
                    f"<span class='sub'>@ {usd_only(t['price'])}{ex_txt}</span>{chip}</div>")
            tcls = {"配息": "div", "買進": "buy"}.get(ttype, "sell")
            cards_html[-1] = f"<div class='tcard {tcls}' style='display:block'>{cards_html[-1]}</div>"
        st.markdown("".join(cards_html) or "<i>此區間沒有交易。</i>", unsafe_allow_html=True)
        if show_n < len(det_all):
            if st.button(f"查看更多（還有 {len(det_all) - show_n} 筆）",
                         use_container_width=True, key="tx_more"):
                st.session_state.tx_show[period] = show_n + 10
                st.rerun()

        # 🏆 個股損益排行（卡片列）
        sec("🏆 個股損益排行（全部歷史）")
        rank = (histdf.groupby("symbol", dropna=False)["pl_usd"].sum()
                .reset_index().sort_values("pl_usd", ascending=False))
        rank_html = []
        for _, rr in rank.iterrows():
            sym = str(rr["symbol"])
            plv = rr["pl_usd"]
            cclr = color_of(plv)
            lg = mk.logo_url(sym)
            logo = (f"<div style='width:30px;height:30px;flex:0 0 auto;border-radius:7px;"
                    f"border:1px solid #c3c1b3;background:#d9d7cc url(\"{lg}\") "
                    f"center/78% no-repeat'></div>")
            rank_html.append(
                f"<div class='hitem'><div style='display:flex;align-items:center;gap:10px'>{logo}"
                f"<b>{sym}</b></div>"
                f"<b style='color:{cclr}'>{mh(plv, sign=True)}</b></div>")
        st.markdown("".join(rank_html), unsafe_allow_html=True)


# ------------------------------------------------------------------
# 📰 每日簡報
# ------------------------------------------------------------------
elif page == "📰 每日簡報":
    page_header("📰 每日投資簡報")
    st.caption("每天自動幫你盤點三件事：① 美股大盤走勢＋新聞　② 你的持股大幅漲跌＋原因＋買賣建議　"
               "③ 值得關注的股票。完全免費、免金鑰。")

    if hold.empty:
        st.info("先到 **📦 我的持股** 新增持股，才有東西可以分析。")
    else:
        if st.button("✨ 產生今日簡報", type="primary"):
            with st.spinner("整理大盤、你的持股與相關新聞中…（約 10-20 秒）"):
                rows = enrich_holdings(hold)
                watch_syms = load_watch()["symbol"].tolist()
                text = an.generate_briefing(rows, usdtwd, watch_syms)
            cfg["last_briefing"] = text
            cfg["last_briefing_at"] = str(date.today())
            save_config(cfg)
            st.markdown(text, unsafe_allow_html=True)
        elif cfg.get("last_briefing"):
            st.caption(f"上次更新：{cfg.get('last_briefing_at','')}")
            st.markdown(cfg["last_briefing"], unsafe_allow_html=True)
        else:
            st.info("按「✨ 產生今日簡報」看今天的完整盤點。")

    st.divider()
    st.markdown("#### ⏰ 每天自動更新")
    st.caption("已設定 Windows 排程，每天早上 8:00 自動更新，打開 app 就看得到最新的。")

st.divider()
if st.button("🔄 更新", use_container_width=True):
    st.cache_data.clear()
    st.rerun()
st.caption("資料來源：Yahoo Finance（延遲行情）。本工具僅供個人記帳與參考，不構成投資建議。")
