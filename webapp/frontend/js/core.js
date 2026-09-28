// ==================================================================
// 共用基礎：常數、格式化、logo、版面骨架、總覽頁、單選元件、快照工具
// 這個檔案由 app.js 拆分而來（原本 2584 行、124KB 的單一檔案）。
// 載入順序：chart.js → core.js → pages-portfolio.js → pages-reports.js → app.js
// ==================================================================

// 我的美股投資中心 —— 前端主程式（純 vanilla JS，無框架）
const GREEN = "#18a558";
const RED = "#e0405a";
const GREY = "#6b7280";
const ORANGE = "#d9822b";

// 底部導覽用同一套線條風格的 SVG icon（取代原本東拼西湊的 emoji），viewBox/線寬統一，
// 顏色跟粗細都交給 CSS（stroke="currentColor"），才能跟 .navlink.active 的強調色連動。
const ICON_SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const NAV_ICONS = {
  home: `<svg ${ICON_SVG_ATTRS}><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1V9.5"/></svg>`,
  hold: `<svg ${ICON_SVG_ATTRS}><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M3 13h18"/></svg>`,
  watch: `<svg ${ICON_SVG_ATTRS}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  stats: `<svg ${ICON_SVG_ATTRS}><path d="M5 20V10"/><path d="M12 20V4"/><path d="M19 20v-7"/></svg>`,
  brief: `<svg ${ICON_SVG_ATTRS}><path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M14 3.5V8h4"/><path d="M9 13h6M9 16h6"/></svg>`,
  tw: `<svg ${ICON_SVG_ATTRS}><path d="M6 21V3"/><path d="M6 4.5h12l-3 4 3 4H6"/></svg>`,
};

const NAV = [
  { key: "home", ic: NAV_ICONS.home, label: "總覽" },
  { key: "hold", ic: NAV_ICONS.hold, label: "持股" },
  { key: "watch", ic: NAV_ICONS.watch, label: "追蹤" },
  { key: "stats", ic: NAV_ICONS.stats, label: "統計" },
  { key: "brief", ic: NAV_ICONS.brief, label: "簡報" },
  { key: "tw", ic: NAV_ICONS.tw, label: "台股" },
];

const state = { cur: "USD", rate: 0, cash: 0 };

function qs(name, dflt) {
  const v = new URLSearchParams(location.search).get(name);
  return v === null ? dflt : v;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function colorOf(x) {
  if (x === null || x === undefined) return GREY;
  return x > 0 ? GREEN : (x < 0 ? RED : GREY);
}

// 台股慣例紅漲綠跌，跟美股（美股頁用 colorOf）相反，只有「台股」頁用這個。
function colorOfTw(x) {
  if (x === null || x === undefined) return GREY;
  return x > 0 ? RED : (x < 0 ? GREEN : GREY);
}

// 股票 logo：用真正的 <img>（可以 lazy-load、抓不到圖時 onerror 直接移除，
// 露出底下 wrapper 的中性底色，不會出現「圖片壞掉」的破圖示）。
// ------------------------------------------------------------------
// logo 亮度偵測
// 有些公司的 logo 是純白的（APP、CEG、MRVL 整張圖 100% 是白的，AMZN、AAPL、
// LITE、ALAB、CRWV、ASML 也大半是白的），放進白色圓圈裡會完全看不見。
// 載入後取樣像素算亮度，太亮的就把那一顆圓圈換成深色底。
//
// 重點：量測用的是另一個「探測用」Image 物件（帶 crossOrigin），畫面上顯示的
// 那張圖完全不加 crossOrigin。這樣萬一哪天 CDN 拿掉 CORS 標頭，最多是量不到
// 亮度、維持白底，而不會連 logo 都載不出來。
// ------------------------------------------------------------------
const LOGO_TONE = (() => {
  try { return JSON.parse(localStorage.getItem("logoTone") || "{}"); } catch { return {}; }
})();
let _toneCanvas = null;

// 有些公司在這個 CDN 上的 logo 是白的，但別家有深色版本可以換過去。
const altLogoUrl = s => `/api/logo/${encodeURIComponent(s)}.png?source=alt`;

function measureLogo(img) {
  try {
    if (!_toneCanvas) _toneCanvas = document.createElement("canvas");
    const n = 32;
    _toneCanvas.width = _toneCanvas.height = n;
    const ctx = _toneCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, n, n);
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    let total = 0, opaque = 0, visible = 0;
    for (let i = 0; i < d.length; i += 4) {
      total++;
      if (d[i + 3] < 40) continue;                       // 透明像素
      opaque++;
      // 「夠暗、放在白底上看得見」的像素。用平均亮度判斷是不行的：很多 logo 圖
      // 本身就帶白色背景（AAPL、ALAB、CRWV…），平均亮度會被白背景拉高，
      // 但裡面的 logo 其實是深色、看得一清二楚。要看的是深色像素夠不夠多。
      if (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] < 180) visible++;
    }
    if (!opaque) return null;
    return { trans: 1 - opaque / total, visible: visible / opaque };
  } catch {
    return null;   // 讀不到像素（跨網域被擋）就放棄，維持原樣
  }
}

// ok     = 有足夠深色像素，白底上本來就看得見，不動
// invert = 整張是白的、而且背景透明 → 反相就變成深色版本
//          （Google Finance 顯示的也是深色版，例如 AppLovin 是黑色三角形）
// alt    = 整張是白的、但圖片不透明（自帶白底）→ 反相會連背景一起翻黑變成
//          一塊黑方塊，只能改抓別家的深色版本
function classifyLogo(m) {
  if (!m) return null;
  if (m.visible >= 0.03) return "ok";
  return m.trans > 0.2 ? "invert" : "alt";
}

function applyLogoFix(img, circle, kind, symbol, origUrl) {
  if (kind === "invert") {
    circle.classList.add("logo-invert");
  } else if (kind === "alt" && !img.dataset.altTried) {
    img.dataset.altTried = "1";
    // 換源失敗（別家沒有這檔）就換回原本那張，不要變成空白
    img.onerror = () => { img.onerror = null; img.src = origUrl; };
    img.src = altLogoUrl(symbol);
  }
}

function onLogoLoad(img, symbol, url) {
  const ph = img.previousElementSibling;
  if (ph) ph.style.display = "none";
  img.style.opacity = 1;
  const circle = img.parentElement && img.parentElement.parentElement;
  if (!circle) return;
  const cached = LOGO_TONE[symbol];
  if (cached) { applyLogoFix(img, circle, cached, symbol, url); return; }
  // logo 現在走自家 /api/logo 代理，是同源的 —— 可以直接讀畫面上這張圖的像素。
  // 以前圖片來自第三方 CDN，canvas 會被污染，只好另外開一個帶 crossOrigin 的
  // Image 再抓一次，等於每顆 logo 都多打一次網路請求（一頁 25 顆就是 25 次）。
  const kind = classifyLogo(measureLogo(img));
  if (!kind) return;
  LOGO_TONE[symbol] = kind;
  try { localStorage.setItem("logoTone", JSON.stringify(LOGO_TONE)); } catch { /* 無痕模式會擋，忽略 */ }
  applyLogoFix(img, circle, kind, symbol, url);
}

function logoImg(symbol, size = 44, radius, url) {
  url = url || `/api/logo/${encodeURIComponent(symbol)}.png`;
  // logo 是打第三方 CDN，常常要等一下才會出現；先用代號字母當佔位，圖片載入完
  // 淡入蓋過去，感覺才不會像卡住，而不是空白格子晾在那邊。
  const initial = esc(String(symbol).slice(0, 2));
  const fs = Math.round(size * 0.32);
  // logo 內縮到約六成、置中留白，跟一般財經 App 的做法一致：圖示塞滿整個圓
  // 會讓清單看起來很擠，而且各家 logo 長寬比差很多，塞滿時大小會參差不齊。
  return `<span style="position:relative;display:flex;align-items:center;justify-content:center;
      width:100%;height:100%">
    <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
      font-size:${fs}px;font-weight:800;color:var(--sub)">${initial}</span>
    <img src="${url}" alt="" loading="lazy" decoding="async"
      style="position:relative;z-index:1;width:62%;height:62%;object-fit:contain;display:block;
        opacity:0;transition:opacity .25s"
      onload="onLogoLoad(this,'${esc(symbol)}','${url}')"
      onerror="this.remove()"></span>`;
}
function logoWrap(symbol, size, radius, extraStyle = "", url) {
  // logo 統一改圓形（不管呼叫端傳進來的 radius 是多少）
  return `<div style="width:${size}px;height:${size}px;flex:0 0 auto;border-radius:50%;
    background:var(--logo-bg);border:1px solid var(--logo-border);overflow:hidden;
    box-shadow:var(--logo-sh);${extraStyle}">
    ${logoImg(symbol, size, radius, url)}</div>`;
}

// 骨架屏：等 API 資料回來之前先畫出跟真實內容差不多形狀的灰色色塊，
// 取代純文字「載入中」，感覺比較像原生 app 在讀資料，而不是卡住。
function skeletonBlock(height, extra = "") {
  return `<div class="skel skel-block" style="height:${height}px;${extra}"></div>`;
}
function skeletonRows(n) {
  return Array.from({ length: n }, () => `<div class="skel skel-row"></div>`).join("");
}
function skeletonHome() {
  return skeletonBlock(110, "margin-bottom:12px") +
    `<div style="display:flex;gap:9px;margin-bottom:8px">
      ${skeletonBlock(78, "flex:1 1 0")}${skeletonBlock(78, "flex:1 1 0")}
    </div>` +
    skeletonBlock(56, "margin-bottom:14px") + skeletonRows(4);
}
function skeletonDetail() {
  return skeletonBlock(90, "margin-bottom:16px") +
    skeletonBlock(140, "margin-bottom:16px") +
    skeletonBlock(260, "margin-bottom:16px") + skeletonRows(3);
}
// 線上版跑在 Render 免費方案，閒置一陣子就會休眠，下次開啟要等整台服務醒過來 ——
// 實測冷啟動時 /api/watchlist 等過 55 秒。這段時間畫面上只有骨架屏在掃，
// 很容易被當成當掉了。這行字延遲 6 秒才淡出（純 CSS），暖機後根本不會出現。
function skeletonWakeHint() {
  return `<div class="skel-hint">伺服器休眠中，正在喚醒…<br>
    免費方案第一次開啟約需 30～60 秒，之後就會很快。</div>`;
}
function skeletonList(n = 6) {
  return skeletonRows(n) + skeletonWakeHint();
}
function skeletonCards() {
  return skeletonBlock(100, "margin-bottom:12px") + skeletonRows(5) + skeletonWakeHint();
}
// 資產走勢、每日簡報這類需要跑 10-20 秒的運算，骨架屏之外還是保留明確的等待時間提示，
// 不然使用者會以為卡住了。
function skeletonWithHint(height, hint) {
  return skeletonBlock(height, "margin-bottom:10px") +
    `<div class="loading" style="padding-top:0">${hint}</div>`;
}

function pctStr(x) {
  return (x === null || x === undefined) ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
}

// 依目前幣別把美金金額格式化（跟舊版 app.py 的 mh() 邏輯一致）
function mh(usd, sign = false) {
  if (usd === null || usd === undefined) return "—";
  let v, prefix, dec;
  if (state.cur === "USD" || !state.rate) {
    v = usd; prefix = "$"; dec = 2;
  } else {
    v = usd * state.rate; prefix = "NT$"; dec = 0;
  }
  const s = v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const signed = sign && v >= 0 ? `+${s}` : s;
  return prefix + signed;
}

function usdOnly(x) {
  return (x === null || x === undefined) ? "—" : `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function api(path, opts) {
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// 後端錯誤有兩種格式：自己寫的 HTTPException（detail 是字串），
// 或欄位驗證失敗（detail 是一堆 {loc, msg} 物件），統一整理成一行好讀的訊息。
function apiErrorMessage(j, fallback) {
  const d = j && j.detail;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    return d.map(e => `${e.loc ? e.loc[e.loc.length - 1] : ""}: ${e.msg}`).join("；");
  }
  return fallback;
}

function sec(title) {
  return `<div class="sec">${title}</div>`;
}

// ------------------------------------------------------------------
// 版面骨架：標題列 + 底部分頁列
// ------------------------------------------------------------------
function renderHeader(title, extraHtml = "") {
  return `<div class="pageheader">
    <div class="title-slot"><h1>${esc(title)}</h1></div>
    <div class="extra-slot">
      <button class="btn-pill" id="curBtn">${state.cur}</button>
      ${extraHtml}
    </div>
  </div>`;
}

function renderBottomNav(activeKey) {
  // 手機是底部橫條（只有 icon），桌面在 CSS 裡改成左側側邊欄、這時才把文字標籤顯示出來。
  // 快捷鍵 1～6 做了卻沒人知道。數字不放進畫面（看起來很雜），改用原生 title
  // 提示：滑鼠停在上面才出現，手機不受影響。
  const links = NAV.map((n, i) => `<a class="navlink${n.key === activeKey ? " active" : ""}"
    href="?nav=${n.key}" title="${n.label}（按 ${i + 1}）"><div class="ic">${n.ic}</div><div class="navlabel">${n.label}</div></a>`).join("");
  return `<div class="bottomnav"><div class="navbrand">📊 投資中心</div>${links}</div>`;
}

// 子頁（走勢、行事曆、可用資金、功能介紹）的頁首：返回鈕跟標題排在同一行。
// 原本是上下兩個 block，在電腦上白白吃掉一整列高度。
function subHeader(title) {
  return `<div class="subheader"><button class="btn-back" id="backBtn">←</button><h1>${title}</h1></div>`;
}

function bindHeaderEvents() {
  const btn = document.getElementById("curBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const next = state.cur === "USD" ? "TWD" : "USD";
    await api("/config", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cur: next }) });
    state.cur = next;
    render();
  });
}

// ------------------------------------------------------------------
// 總覽頁
// 首頁的 /summary 原本每次進到總覽都重抓一次。線上版暖機後是 0.17 秒還好，
// 冷啟動時要 5.8 秒 —— 而且背景預抓也會因此完全沒有意義。
// 加一個 60 秒的短期快取：來回切頁是瞬間，但價格不會舊到有誤導性。
// 下拉刷新與交易寫入後會帶 force=true 強制重抓。
let summaryCache = null, summaryAt = 0;
const SUMMARY_TTL_MS = 60000;
async function loadSummary(force = false) {
  if (!force && summaryCache && Date.now() - summaryAt < SUMMARY_TTL_MS) return summaryCache;
  summaryCache = await api("/summary");
  summaryAt = Date.now();
  saveSnap("summary", summaryCache);
  return summaryCache;
}

// ------------------------------------------------------------------
async function renderHome() {
  const app = document.getElementById("app");
  const aboutBtn = `<a href="?nav=home&about=1" class="btn-back" style="text-decoration:none;margin-bottom:0">ℹ️</a>`;
  app.innerHTML = renderHeader("🏠 投資總覽", aboutBtn) + `<div id="homeBody">${skeletonHome()}</div>` + renderBottomNav("home");
  bindHeaderEvents();

  // 冷啟動時 /api/summary 要 6 秒（服務還睡著的話再加 50 秒）。有上次的快照
  // 就先把畫面填起來，標明是快照並正在更新，不要讓使用者對著骨架屏發呆。
  if (!summaryCache) {
    const snap = loadSnap("summary");
    if (snap) renderHomeBody(snap.data, snap.at);
  }

  const s = await loadSummary();
  renderHomeBody(s, null);
}

// staleAt 有值時，在最上面加一條「這是幾點的快照」提示。
function renderHomeBody(s, staleAt) {
  const body = document.getElementById("homeBody");
  if (!body) return;
  const bar = staleAt ? staleBanner(staleAt) : "";

  if (s.empty) {
    body.innerHTML = bar + emptyState("📊", "還沒有持股資料",
      "到「📦 我的持股」新增你目前持有的股票，只需要代號、股數、平均成本。") + renderFooter();
    return;
  }

  const hero = `<a href="?nav=home&trend=1" class="hero-link" style="text-decoration:none;color:inherit;display:block">
    <div class="hero-card">
      <div class="wl"><span>資產總額 · 持股＋現金</span><span class="arrow">›</span></div>
      <div class="wb">${mh(s.assets_usd)}</div>
      <div class="ws">持股 ${mh(s.total_mv_usd)}</div>
    </div></a>`;

  const wcard = (label, big, sub, vcolor) => `<div class="wcard sm">
    <div class="wl">${label}</div>
    <div class="wb" style="color:${vcolor}">${big}</div>
    <div class="ws">${sub}</div></div>`;
  // 首頁原本只有「今日」跟「未實現」，看不到真正落袋的錢。補上今年已實現損益
  // （含配息），點下去直接到統計頁看逐月明細。
  const ytd = (s.ytd_realized_usd || 0) + (s.ytd_div_usd || 0);
  const mtdTxt = s.mtd_realized_usd ? `本月 ${mh(s.mtd_realized_usd, true)}` : "本月尚未實現";
  const smallCards = `<div class="wrow">
    ${wcard("今日損益", mh(s.day_pl_usd, true), "與昨日相比", colorOf(s.day_pl_usd))}
    ${wcard("未實現損益", mh(s.total_pl_usd, true), pctStr(s.pl_pct), colorOf(s.total_pl_usd))}
    <a href="?nav=stats">${wcard(`${s.year} 已實現`, mh(ytd, true), mtdTxt, colorOf(ytd))}</a>
  </div>`;

  const cashStrip = `<a href="?nav=home&cash=1" class="cashstrip">
    <span class="l">💵 可用資金</span><span class="v">${mh(s.cash_usd)}</span><span class="arrow">›</span></a>`;

  const calStrip = `<a href="?nav=home&cal=1" class="cashstrip">
    <span class="l">📅 股利／財報行事曆</span><span class="arrow">›</span></a>`;

  let allocHtml = "";
  if (s.total_mv_usd) {
    const legend = s.allocation.map(a => `<div class="legend">
      <span class="legend-name"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>
      <span class="legend-amt">${mh(a.value_usd)}</span>
      <span class="legend-pct">${a.pct.toFixed(1)}%</span></div>`).join("");
    allocHtml = sec("📊 資產配置") + `<div class="alloccard">
      <div class="alloc-donut-row">
        <div class="alloc-donut-wrap"><canvas id="allocDonut"></canvas></div>
        <div class="alloc-legend-col">${legend}</div>
      </div></div>`;
  }

  let winnersHtml = "";
  if (s.winners.length) {
    winnersHtml = sec("🎯 已達 +20%，可以看看要不要獲利了結") + s.winners.map(r => `
      <div class="posblock" style="background:#2f9e4415;border-left:5px solid ${GREEN}">
        <b>${esc(r.symbol)}</b> <span style="color:#6b7280">${esc(r.name)}</span>
        <span style="color:${GREEN};font-weight:800">+${r.pl_pct.toFixed(0)}%（${mh(r.pl_usd, true)}）</span>
        　<span style="color:#6b7280">現價 ${usdOnly(r.price_usd)}</span>
      </div>`).join("");
  }

  let alertsHtml = sec("🚦 需要注意");
  if (!s.alerts.length) {
    alertsHtml += `<div class="posblock" style="background:#2f9e4415;border-left:5px solid ${GREEN}">✅ 目前沒有需要特別注意的持股，投資組合穩定。</div>`;
  } else {
    alertsHtml += s.alerts.map(a => {
      if (a.kind === "stop") return `<div class="posblock" style="background:${RED}17;border-left:5px solid ${RED};color:var(--ink)">
        🔴 <b>${esc(a.symbol)}</b> 考慮停損（${a.pl_pct >= 0 ? "+" : ""}${a.pl_pct.toFixed(1)}%，${mh(a.pl_usd, true)}）</div>`;
      if (a.kind === "weak") return `<div class="posblock" style="background:${ORANGE}17;border-left:5px solid ${ORANGE};color:var(--ink)">
        🟠 <b>${esc(a.symbol)}</b> 走勢偏弱，可考慮減碼（${a.pl_pct >= 0 ? "+" : ""}${a.pl_pct.toFixed(1)}%，${mh(a.pl_usd, true)}）</div>`;
      if (a.kind === "concentration") return `<div class="posblock" style="background:${ORANGE}17;border-left:5px solid ${ORANGE};color:var(--ink)">
        ⚖️ <b>${esc(a.symbol)}</b> 佔持股市值 ${a.weight_pct.toFixed(1)}%，集中度偏高，留意風險分散</div>`;
      const cc = a.kind === "day_up" ? GREEN : ORANGE;
      const dd = a.kind === "day_up" ? "大漲" : "大跌";
      const amtTxt = a.day_amt_usd !== null && a.day_amt_usd !== undefined ? `，${mh(a.day_amt_usd, true)}` : "";
      return `<div class="posblock" style="background:${cc}17;border-left:5px solid ${cc};color:var(--ink)">
        📢 <b>${esc(a.symbol)}</b> 今日${dd} ${a.day_pct >= 0 ? "+" : ""}${a.day_pct.toFixed(1)}%${amtTxt}</div>`;
    }).join("");
  }

  // .home-top / .home-cols 在手機上是 display:contents（等於不存在，排版跟以前一模一樣），
  // 桌面版才變成格線容器：上方數字卡並排、下方「資產配置」與「提醒」左右兩欄。
  body.innerHTML = bar +
    `<div class="home-top">${hero}${smallCards}${cashStrip}${calStrip}` +
    `<div class="hint">👉 <b>點資產總額看資產走勢</b>　·　<b>點可用資金設定金額</b></div></div>` +
    `<div class="home-cols"><div class="home-col">${allocHtml}</div>` +
    `<div class="home-col">${winnersHtml}${alertsHtml}</div></div>` + renderFooter();

  if (s.total_mv_usd) {
    const donutCanvas = document.getElementById("allocDonut");
    if (donutCanvas) drawDonutChart(donutCanvas, s.allocation.map(a => ({ value: a.value_usd, color: a.color })));
  }
}

// ------------------------------------------------------------------
// 共用小工具：按鈕式單選（取代 Streamlit 的 segmented_control）
// ------------------------------------------------------------------
const segHandlers = {};
function segGroup(name, options, active) {
  return `<div class="seg-group" data-seg="${name}">${options.map(o =>
    `<button type="button" class="seg-btn${o.key === active ? " active" : ""}"
      data-seg-btn="${name}" data-value="${esc(o.key)}">${esc(o.label)}</button>`).join("")}</div>`;
}
function onSeg(name, cb) { segHandlers[name] = cb; }
document.addEventListener("click", e => {
  const btn = e.target.closest("[data-seg-btn]");
  if (btn && segHandlers[btn.dataset.segBtn]) segHandlers[btn.dataset.segBtn](btn.dataset.value);
});

// 按鈕/可點擊列按下去要有彈出的動態感：不要只靠 CSS :active（手機上很多瀏覽器
// :active 觸不觸發、觸發得夠不夠久很不穩定，常常整個感覺不到），改成用 pointerdown
// 直接強制觸發一個 keyframe 動畫，不管滑鼠點擊還是手機觸控都會是同一個效果。
// watch-row-content 故意不放進來：那個元素同時被滑動刪除/拖曳排序的手勢邏輯直接控制
// transform，動畫效果會跟手勢衝突、閃一下很奇怪。
const POP_SELECTOR = "button, .seg-btn, .navlink, .btn-pill, .btn-back, .btn-circle-glass, " +
  ".cashstrip, .hlink, .btn-submit";
document.addEventListener("pointerdown", e => {
  const el = e.target.closest(POP_SELECTOR);
  if (!el) return;
  el.classList.remove("pop-anim");
  void el.offsetWidth; // 強制 reflow，同一個元素連續快速點擊也能重新觸發動畫
  el.classList.add("pop-anim");
}, { passive: true });
document.addEventListener("animationend", e => {
  if (e.animationName === "btn-pop") e.target.classList.remove("pop-anim");
});

// 共用小工具：從底部滑出的表單（新增交易／加入追蹤都用這個），統一開關邏輯，
// 確保狀態變數（addOpen/watchOpen）跟畫面上的開關永遠一致。
function toggleSheet(panelId, backdropId, open) {
  const panel = document.getElementById(panelId), backdrop = document.getElementById(backdropId);
  if (panel) panel.classList.toggle("open", open);
  if (backdrop) backdrop.classList.toggle("open", open);
}
function sheetMarkup(panelId, backdropId) {
  return `<div class="sheet-backdrop" id="${backdropId}"></div><div class="sheet-panel" id="${panelId}"></div>`;
}

// ------------------------------------------------------------------

// 線上版跑在 Render 免費方案，閒置就休眠，實測喚醒整台服務要 50 秒以上，
// 醒來之後快取是空的，/api/summary 與 /api/watchlist 各還要再 6 秒。
// 這段期間畫面上只有骨架屏，等於盯著空白發呆一分鐘。
//
// 改成：把上一次成功拿到的資料存一份在 localStorage，下次開啟先把它畫出來，
// 並明確標示「這是幾點幾分的快照，正在更新」，新資料一到就整批換掉。
// 只是把等待期填上內容，不改變任何計算 —— 顯示的仍然是真實存在過的數字。
const SNAP_PREFIX = "snap:";
const SNAP_MAX_AGE_MS = 24 * 3600 * 1000;   // 超過一天的快照就不要拿出來了

function saveSnap(key, data) {
  try { localStorage.setItem(SNAP_PREFIX + key, JSON.stringify({ at: Date.now(), data })); }
  catch { /* 容量滿或無痕模式，忽略 */ }
}
function loadSnap(key) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || !o.data || Date.now() - o.at > SNAP_MAX_AGE_MS) return null;
    return o;
  } catch { return null; }
}
function snapAgeText(at) {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.round(min / 60);
  return hr < 24 ? `${hr} 小時前` : "超過一天前";
}
function staleBanner(at) {
  return `<div class="stalebar">上次看到的資料（${snapAgeText(at)}）　·　正在更新…</div>`;
}

