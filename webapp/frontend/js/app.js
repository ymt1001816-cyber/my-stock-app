// 我的美股投資中心 —— 前端主程式（純 vanilla JS，無框架）
const GREEN = "#18a558";
const RED = "#e0405a";
const GREY = "#6b7280";
const ORANGE = "#d9822b";

const NAV = [
  { key: "home", ic: "🏠", label: "總覽" },
  { key: "hold", ic: "📦", label: "持股" },
  { key: "watch", ic: "👀", label: "追蹤" },
  { key: "stats", ic: "📊", label: "統計" },
  { key: "brief", ic: "📰", label: "簡報" },
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

// 股票 logo：用真正的 <img>（可以 lazy-load、抓不到圖時 onerror 直接移除，
// 露出底下 wrapper 的中性底色，不會出現「圖片壞掉」的破圖示）。
function logoImg(symbol, size, radius, url) {
  url = url || `https://financialmodelingprep.com/image-stock/${symbol}.png`;
  return `<img src="${url}" alt="" loading="lazy" decoding="async"
    style="width:78%;height:78%;object-fit:contain;display:block;margin:11% auto"
    onerror="this.remove()">`;
}
function logoWrap(symbol, size, radius, extraStyle = "", url) {
  return `<div style="width:${size}px;height:${size}px;flex:0 0 auto;border-radius:${radius}px;
    background:var(--logo-bg);border:1px solid var(--logo-border);overflow:hidden;${extraStyle}">
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
function skeletonList(n = 6) {
  return skeletonRows(n);
}
function skeletonCards() {
  return skeletonBlock(100, "margin-bottom:12px") + skeletonRows(5);
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
  const links = NAV.map(n => `<a class="navlink${n.key === activeKey ? " active" : ""}"
    href="?nav=${n.key}"><div class="ic">${n.ic}</div></a>`).join("");
  return `<div class="bottomnav">${links}</div>`;
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
// ------------------------------------------------------------------
async function renderHome() {
  const app = document.getElementById("app");
  app.innerHTML = renderHeader("🏠 投資總覽") + `<div id="homeBody">${skeletonHome()}</div>` + renderBottomNav("home");
  bindHeaderEvents();

  const s = await api("/summary");
  const body = document.getElementById("homeBody");

  if (s.empty) {
    body.innerHTML = `<p>還沒有持股資料。請到 <b>📦 我的持股</b> 新增你目前持有的股票（只需填代號、股數、平均成本）。</p>` + renderFooter();
    return;
  }

  const hero = `<a href="?nav=home&trend=1" class="hero-link" style="text-decoration:none;color:inherit;display:block">
    <div class="hero-plain">
      <div class="wl"><span>資產總額 · 持股＋現金</span><span class="arrow">›</span></div>
      <div class="wb">${mh(s.assets_usd)}</div>
      <div class="ws">持股 ${mh(s.total_mv_usd)}</div>
    </div></a>`;

  const wcard = (label, big, sub, vcolor) => `<div class="wcard sm">
    <div class="wl">${label}</div>
    <div class="wb" style="color:${vcolor}">${big}</div>
    <div class="ws">${sub}</div></div>`;
  const smallCards = `<div class="wrow">
    ${wcard("今日損益", mh(s.day_pl_usd, true), "與昨日相比", colorOf(s.day_pl_usd))}
    ${wcard("未實現損益", mh(s.total_pl_usd, true), pctStr(s.pl_pct), colorOf(s.total_pl_usd))}
  </div>`;

  const cashStrip = `<a href="?nav=home&cash=1" class="cashstrip">
    <span class="l">💵 可用資金</span><span class="v">${mh(s.cash_usd)}</span><span class="arrow">›</span></a>`;

  let allocHtml = "";
  if (s.total_mv_usd) {
    const bar = s.allocation.map(a => `<span style="width:${a.pct.toFixed(2)}%;background:${a.color}"></span>`).join("");
    const legend = s.allocation.map(a => `<div class="legend"><span><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>
      <span><b>${mh(a.value_usd)}</b>　<span style="color:#6b7280">${a.pct.toFixed(1)}%</span></span></div>`).join("");
    allocHtml = sec("📊 資產配置") + `<div class="alloccard"><div class="allocbar">${bar}</div>${legend}</div>`;
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
      const cc = a.kind === "day_up" ? GREEN : ORANGE;
      const dd = a.kind === "day_up" ? "大漲" : "大跌";
      const amtTxt = a.day_amt_usd !== null && a.day_amt_usd !== undefined ? `，${mh(a.day_amt_usd, true)}` : "";
      return `<div class="posblock" style="background:${cc}17;border-left:5px solid ${cc};color:var(--ink)">
        📢 <b>${esc(a.symbol)}</b> 今日${dd} ${a.day_pct >= 0 ? "+" : ""}${a.day_pct.toFixed(1)}%${amtTxt}</div>`;
    }).join("");
  }

  body.innerHTML = hero + smallCards + cashStrip +
    `<div class="hint">👉 <b>點資產總額看資產走勢</b>　·　<b>點可用資金設定金額</b></div>` +
    allocHtml + winnersHtml + alertsHtml + renderFooter();
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

// ------------------------------------------------------------------
// 📦 我的持股：清單頁
// ------------------------------------------------------------------
let holdData = null;
let holdSort = "mv";
let symbolsCache = null;
let addOpen = false;
let addType = "買進";

async function loadSymbols() {
  if (!symbolsCache) symbolsCache = (await api("/symbols")).symbols;
  return symbolsCache;
}

function stockRowHtml(r, navKey = "hold") {
  const sub = r._sub !== undefined ? r._sub :
    `${r.shares % 1 === 0 ? r.shares : r.shares.toFixed(5)} 股 · 佔比 ${r.weight_pct.toFixed(1)}%`;
  // 持股列表看的是「賺賠多少」，不是當天股價；追蹤清單沒有成本，才顯示現價/當日漲跌。
  const hasPl = r.pl_usd !== undefined;
  const plColor = colorOf(hasPl ? r.pl_usd : r.day_pct);
  const right = hasPl
    ? `<div class="nm" style="color:${plColor}">${mh(r.pl_usd, true)}</div>
       <div class="chip" style="background:${plColor}17;color:${plColor}">${pctStr(r.pl_pct)}</div>`
    : `<div class="nm">${usdOnly(r.price_usd)}</div>
       <div class="chip" style="background:${plColor}17;color:${plColor}">${pctStr(r.day_pct)}</div>`;
  return `<a class="hlink" href="?nav=${navKey}&sym=${encodeURIComponent(r.symbol)}">
    <div class="hitem">
      <div class="hitem-left">
        <div class="hitem-logo">${logoImg(r.symbol)}</div>
        <div class="hitem-name">
          <div class="nm">${r.emoji} ${esc(r.symbol)}</div>
          <div class="sub">${esc(sub)}</div>
        </div>
      </div>
      <div class="hitem-right">
        ${right}
      </div>
    </div>
  </a>`;
}

function renderAddForm() {
  const held = (holdData && holdData.rows) || [];
  const syms = symbolsCache || held.map(r => r.symbol);
  const typeSeg = segGroup("addtype", [
    { key: "買進", label: "🟢 買進" }, { key: "賣出", label: "🔴 賣出" }, { key: "配息", label: "💵 配息" },
  ], addType);

  let body = "";
  if (addType === "買進") {
    body = `<div class="form-field"><label>股票代號（如 NVDA）</label><input type="text" id="f_buy_symbol" style="text-transform:uppercase"></div>
      <div class="form-row">
        <div class="form-field"><label>買進股數</label><input type="number" id="f_buy_shares" min="0" step="any"></div>
        <div class="form-field"><label>買進價 (USD)</label><input type="number" id="f_buy_price" min="0" step="any"></div>
      </div>
      <div class="form-field"><label>買進日期</label><input type="date" id="f_buy_date" value="${todayStr()}"></div>
      <div class="form-row">
        <div class="form-field"><label>手續費 (USD，選填)</label><input type="number" id="f_buy_fee" min="0" step="any" value="0"></div>
        <div class="form-field"><label>停損價 (USD，選填)</label><input type="number" id="f_buy_stop" min="0" step="any"></div>
      </div>
      <div class="form-field"><label>備註（選填，如：定期定額）</label><input type="text" id="f_buy_note"></div>
      <button type="button" class="btn-submit" data-seg-btn="submit" data-value="buy">🟢 確認買進</button>
      <div id="addFormMsg"></div>`;
  } else if (addType === "賣出") {
    if (!held.length) {
      body = `<p class="form-hint">目前沒有持股可賣。</p>`;
    } else {
      const opts = held.map(r => `<option value="${esc(r.symbol)}">${esc(r.symbol)}</option>`).join("");
      const first = held[0];
      body = `<div class="form-field"><label>賣出哪一檔</label>
          <select id="f_sell_symbol">${opts}</select></div>
        <p class="form-hint" id="f_sell_caption">目前持有 ${first.shares} 股，平均成本 $${(first.avg_cost_usd || 0).toFixed(4)}</p>
        <div class="form-row">
          <div class="form-field"><label>賣出股數</label><input type="number" id="f_sell_shares" min="0" step="any" value="${first.shares}"></div>
          <div class="form-field"><label>賣出價 (USD)</label><input type="number" id="f_sell_price" min="0" step="any"></div>
        </div>
        <div class="form-field"><label>賣出日期</label><input type="date" id="f_sell_date" value="${todayStr()}"></div>
        <div class="form-row">
          <div class="form-field"><label>手續費 (USD，選填)</label><input type="number" id="f_sell_fee" min="0" step="any" value="0"></div>
          <div class="form-field"><label>交易稅 (USD，選填)</label><input type="number" id="f_sell_tax" min="0" step="any" value="0"></div>
        </div>
        <button type="button" class="btn-submit" data-seg-btn="submit" data-value="sell">🔴 確認賣出</button>
        <div id="addFormMsg"></div>`;
    }
  } else {
    const opts = syms.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    body = `<div class="form-field"><label>哪一檔</label>
        ${syms.length ? `<select id="f_div_symbol">${opts}</select>` : `<input type="text" id="f_div_symbol" style="text-transform:uppercase">`}</div>
      <div class="form-row">
        <div class="form-field"><label>股息金額 (USD)</label><input type="number" id="f_div_amount" min="0" step="any"></div>
        <div class="form-field"><label>配息日期</label><input type="date" id="f_div_date" value="${todayStr()}"></div>
      </div>
      <button type="button" class="btn-submit" data-seg-btn="submit" data-value="dividend">💵 記錄配息</button>
      <div id="addFormMsg"></div>`;
  }
  return `<p class="form-hint">先選類型 → 選/填股票 → 填細節。會自動更新持股、已實現損益，並記進交易筆記。</p>
    ${typeSeg}${body}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rerenderAddPanel() {
  const panel = document.getElementById("addTxPanel");
  if (panel) panel.innerHTML = renderAddForm();
  bindSellCaption();
}

function bindSellCaption() {
  const sel = document.getElementById("f_sell_symbol");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const r = holdData.rows.find(x => x.symbol === sel.value);
    if (!r) return;
    document.getElementById("f_sell_caption").textContent =
      `目前持有 ${r.shares} 股，平均成本 $${(r.avg_cost_usd || 0).toFixed(4)}`;
    document.getElementById("f_sell_shares").value = r.shares;
    document.getElementById("f_sell_shares").max = r.shares;
  });
}

async function submitTransaction(kind) {
  const msgEl = document.getElementById("addFormMsg");
  msgEl.innerHTML = "";
  try {
    let payload, path;
    if (kind === "buy") {
      path = "/transactions/buy";
      payload = {
        symbol: document.getElementById("f_buy_symbol").value.toUpperCase().trim(),
        shares: parseFloat(document.getElementById("f_buy_shares").value || 0),
        price: parseFloat(document.getElementById("f_buy_price").value || 0),
        date: document.getElementById("f_buy_date").value,
        fee: parseFloat(document.getElementById("f_buy_fee").value || 0),
        stop_price: parseFloat(document.getElementById("f_buy_stop").value || 0) || null,
        note: document.getElementById("f_buy_note").value,
      };
    } else if (kind === "sell") {
      path = "/transactions/sell";
      payload = {
        symbol: document.getElementById("f_sell_symbol").value,
        shares: parseFloat(document.getElementById("f_sell_shares").value || 0),
        price: parseFloat(document.getElementById("f_sell_price").value || 0),
        date: document.getElementById("f_sell_date").value,
        fee: parseFloat(document.getElementById("f_sell_fee").value || 0),
        tax: parseFloat(document.getElementById("f_sell_tax").value || 0),
      };
    } else {
      path = "/transactions/dividend";
      payload = {
        symbol: document.getElementById("f_div_symbol").value.toUpperCase().trim(),
        amount: parseFloat(document.getElementById("f_div_amount").value || 0),
        date: document.getElementById("f_div_date").value,
      };
    }
    const res = await fetch(`/api${path}`, { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (!res.ok) throw new Error(apiErrorMessage(j, "送出失敗"));
    msgEl.innerHTML = `<div class="form-success">✅ ${esc(j.message)}</div>`;
    addOpen = false;
    await loadHoldData(true);
    rerenderHoldBody();
  } catch (err) {
    msgEl.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}

onSeg("addtype", val => { addType = val; rerenderAddPanel(); });
onSeg("holdsort", val => { holdSort = val; rerenderHoldBody(); });
onSeg("submit", val => submitTransaction(val));

async function loadHoldData(force = false) {
  if (force || !holdData) {
    holdData = await api("/holdings");
    await loadSymbols();
  }
}

function rerenderHoldBody() {
  const body = document.getElementById("holdBody");
  if (!body) return;
  if (holdData.empty) {
    body.innerHTML = `<p>還沒有持股。點右上角「➕」買進第一筆持股。</p>` + renderFooter();
    return;
  }
  const rows = [...holdData.rows];
  if (holdSort === "symbol") rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  else if (holdSort === "day_pct") rows.sort((a, b) => (a.day_pct || 0) - (b.day_pct || 0));
  else rows.sort((a, b) => b.market_value_usd - a.market_value_usd);

  body.innerHTML = segGroup("holdsort", [
    { key: "mv", label: "市值" }, { key: "symbol", label: "代號 A→Z" }, { key: "day_pct", label: "單日漲跌" },
  ], holdSort) +
  `<div style="display:flex;justify-content:space-between;color:#6b7280;font-size:.76rem;padding:0 4px 6px">
    <span>持倉 · ${rows.length} 檔</span><span>損益金額　·　報酬率</span></div>` +
  rows.map(r => stockRowHtml(r)).join("") +
  `<p class="hint">👆 點任一列看個股詳細（走勢圖、盤前盤後、財報、建議）</p>` + renderFooter();
  const panel = document.getElementById("addTxPanel");
  if (panel) panel.innerHTML = renderAddForm();
  bindSellCaption();
}

async function renderHoldList() {
  const app = document.getElementById("app");
  const addBtn = `<div class="popover-wrap">
    <button class="btn-circle-glass" id="addTxBtn">+</button>
    <div class="popover-panel${addOpen ? " open" : ""}" id="addTxPanel"></div>
  </div>`;
  app.innerHTML = renderHeader("📦 我的持股", addBtn) +
    `<div id="holdBody">${skeletonList()}</div>` + renderBottomNav("hold");
  bindHeaderEvents();
  document.getElementById("addTxBtn").addEventListener("click", () => {
    addOpen = !addOpen;
    document.getElementById("addTxPanel").classList.toggle("open", addOpen);
    if (addOpen) rerenderAddPanel();
  });

  await loadHoldData();
  rerenderHoldBody();
}

// ------------------------------------------------------------------
// 📦 個股詳細頁
// ------------------------------------------------------------------
let detailRange = "1mo";
let detailCache = null;

async function renderDetail(symbol, fromNav = "hold") {
  const app = document.getElementById("app");
  app.innerHTML = `<button class="btn-back" id="backBtn">←</button>
    <div id="detailBody">${skeletonDetail()}</div>` + renderBottomNav(fromNav);
  document.getElementById("backBtn").addEventListener("click", () => navigateTo(`?nav=${fromNav}`));

  const d = await api(`/holdings/${encodeURIComponent(symbol)}`);
  detailCache = d;
  const body = document.getElementById("detailBody");

  const dc = colorOf(d.change_pct);
  const stateTxt = { REGULAR: "🟢 盤中", PRE: "🌅 盤前", POST: "🌙 盤後", CLOSED: "🔴 收盤" }[d.market_state] || "";
  let extra = "";
  if (d.pre_price_usd) extra = `　🌅 盤前 ${usdOnly(d.pre_price_usd)}（${pctStr(d.pre_pct)}）`;
  if (d.post_price_usd) extra = `　🌙 盤後 ${usdOnly(d.post_price_usd)}（${pctStr(d.post_pct)}）`;
  const dispState = extra ? "" : stateTxt;

  let html = `<h1 style="margin:0">${logoWrap(d.symbol, 40, 9,
      "display:inline-block;vertical-align:middle;margin-right:12px", d.logo_url)}${esc(d.symbol)} · ${esc(d.name)}</h1>
    <div style="color:#6b7280;margin:4px 0 2px">🏢 ${esc(d.biz)}　·　${esc(d.sector)}</div>
    <div><span style="font-size:2.1rem;font-weight:800">${usdOnly(d.price_usd)}</span>
      <span style="color:${dc};font-size:1.2rem;font-weight:700">${pctStr(d.change_pct)}</span>
      　<span style="color:#8a94a6">${dispState}</span>
      <span style="color:#8a94a6;font-size:.9rem">${extra}</span></div>`;

  if (d.position) {
    const p = d.position;
    const pc = colorOf(p.pl_usd);
    html += sec("💼 我的部位") +
      `<div class="posblock" style="background:${pc}14;border-left:6px solid ${pc}">
        <span style="color:${pc};font-size:1.5rem;font-weight:800">${mh(p.pl_usd, true)}（${p.pl_pct >= 0 ? "+" : ""}${p.pl_pct.toFixed(1)}%）</span></div>` +
      statGrid([
        ["持有股數", p.shares % 1 === 0 ? p.shares : p.shares.toFixed(5), GREY],
        ["平均成本/股", usdOnly(p.avg_cost), GREY],
        ["投入成本", mh(p.cost_usd), GREY],
        ["目前市值", mh(p.market_value_usd), GREY],
      ]);

    html += sec("📈 投資成果（總報酬）") + statGrid([
      ["未實現損益", mh(p.pl_usd, true), colorOf(p.pl_usd)],
      ["已實現損益", mh(p.realized_pl_usd, true), colorOf(p.realized_pl_usd)],
      ["累積股息", mh(p.dividends_usd), p.dividends_usd > 0 ? GREEN : GREY],
      ["總報酬", mh(p.total_return_usd, true), colorOf(p.total_return_usd)],
    ]);

    const v = p.verdict;
    html += sec("🎯 停損 / 目標價（每股，美金）") + statGrid([
      ["🛑 建議停損", usdOnly(v.suggest_stop), RED],
      ["成本 +10%", usdOnly(p.avg_cost * 1.10), "#2f9e44"],
      ["成本 +20% 🎯", usdOnly(v.cost_t20), "#1b7a34"],
      ["現價 +20%", usdOnly(v.t20), GREEN],
    ]);
    if (p.dca) {
      html += `<p class="hint">📈 這是定期定額標的，長期持有為主，不需急著獲利了結。</p>`;
    } else if (p.pl_pct >= 20) {
      html += `<div class="posblock" style="background:#2f9e4418;border-left:6px solid ${GREEN}">
        🎯 <b style="color:${GREEN}">已達 +${p.pl_pct.toFixed(0)}%！</b> 可以看看要不要獲利了結一部分囉。</div>`;
    } else if (p.avg_cost) {
      const gap = (p.avg_cost * 1.20 - d.price_usd) / d.price_usd * 100;
      html += `<p class="hint">距『成本 +20%』賣點（${usdOnly(p.avg_cost * 1.20)}）還差約 ${gap.toFixed(1)}%</p>`;
    }

    const lt = p.light;
    html += sec("🧭 該續抱還是賣出？") +
      `<span class="badge" style="background:${lt.color}22;color:${lt.color}">${lt.emoji} ${esc(lt.label)}</span>` +
      lt.reasons.map(r => `<div style="font-size:.88rem;margin:2px 0">${esc(r)}</div>`).join("") +
      `<p class="hint">※ 機械式規則計算，非投資建議。</p>`;
  }

  html += sec("📈 走勢圖") + segGroup("range", [
    { key: "1d", label: "當天" }, { key: "5d", label: "1週" }, { key: "1mo", label: "1月" },
    { key: "3mo", label: "3月" }, { key: "6mo", label: "6月" }, { key: "1y", label: "1年" },
  ], detailRange) + `<div class="plotly-chart-wrap" id="chartWrap">${skeletonBlock(260)}</div>`;

  const ks = d.key_stats;
  html += sec("🔑 關鍵數據") + statCardGroup([
    [`分析師`, `${ks.target_mean_usd ? usdOnly(ks.target_mean_usd) : "—"} · ${esc(ks.recommend)}`,
      ks.target_mean_usd && ks.target_mean_usd > d.price_usd ? GREEN : GREY],
    ["52週高/低", `${usdOnly(ks.wk52_high_usd)} / ${usdOnly(ks.wk52_low_usd)}`, GREY],
    ["今日高/低", `${usdOnly(ks.day_high_usd)} / ${usdOnly(ks.day_low_usd)}`, GREY],
    ["本益比", ks.pe ? ks.pe.toFixed(1) : "—", GREY],
    ["市值", ks.market_cap ? `$${(ks.market_cap / 1e9).toLocaleString("en-US", { maximumFractionDigits: 0 })}B` : "—", GREY],
    ["50/200日均", `${usdOnly(ks.ma50_usd)} / ${usdOnly(ks.ma200_usd)}`, GREY],
    ["殖利率", ks.div_yield_pct ? `${ks.div_yield_pct.toFixed(2)}%` : "無配息", GREY],
    ["每股股利", ks.div_rate_usd ? usdOnly(ks.div_rate_usd) : "—", GREY],
  ]);

  html += sec("📅 重要日期") + statGrid([
    ["下次財報日", d.dates.earnings_date || "—", d.dates.earnings_date ? "#e8590c" : GREY],
    ["除息日", d.dates.ex_div_date || "無", GREY],
    ["配息日", d.dates.div_date || "無", GREY],
  ]);

  html += sec("📰 相關新聞");
  if (!d.news.length) {
    html += `<p class="hint">暫無新聞。</p>`;
  } else {
    html += d.news.map(n => {
      const meta = [n.provider, n.pub].filter(Boolean).join(" · ");
      const inner = `<div class="nrow-t">${esc(n.title)}</div><div class="nrow-m">${esc(meta)}</div>`;
      return n.link ? `<a href="${n.link}" target="_blank" class="nrow">${inner}</a>` : `<div class="nrow">${inner}</div>`;
    }).join("");
  }

  body.innerHTML = html + renderFooter();
  onSeg("range", async val => {
    detailRange = val;
    document.querySelectorAll('[data-seg-btn="range"]').forEach(b =>
      b.classList.toggle("active", b.dataset.value === val));
    await loadChart(symbol);
  });
  await loadChart(symbol);
}

function statGrid(items) {
  return `<div class="statgrid">${items.map(([l, v, c]) =>
    `<div class="statcell"><div class="l">${esc(l)}</div><div class="v" style="color:${c}">${v}</div></div>`).join("")}</div>`;
}
function statCardGroup(items) {
  return `<div class="statcardwrap"><div class="grid3">${items.map(([l, v, c]) =>
    `<div class="cell"><div class="l">${esc(l)}</div><div class="v" style="color:${c}">${v}</div></div>`).join("")}</div></div>`;
}

async function loadChart(symbol) {
  const wrap = document.getElementById("chartWrap");
  wrap.innerHTML = skeletonBlock(260);
  const { points } = await api(`/chart/${encodeURIComponent(symbol)}?range=${detailRange}`);
  const up = points.length > 1 ? points[points.length - 1].v >= points[0].v : true;
  drawLineChart(wrap, points, {
    color: up ? GREEN : RED,
    fillColor: up ? "rgba(74,154,108,0.10)" : "rgba(194,102,97,0.10)",
    moneyFmt: v => usdOnly(v),
  });
}

// ------------------------------------------------------------------
// 👀 追蹤清單
// ------------------------------------------------------------------
let watchOpen = false;

function renderWatchForm() {
  return `<p class="form-hint">先填代號 → 選填目標買價／備註。</p>
    <div class="form-field"><label>代號</label><input type="text" id="f_watch_symbol" style="text-transform:uppercase"></div>
    <div class="form-field"><label>目標買價（選填）</label><input type="number" id="f_watch_target" min="0" step="any"></div>
    <div class="form-field"><label>備註（選填）</label><input type="text" id="f_watch_note"></div>
    <button type="button" class="btn-submit" data-seg-btn="submit" data-value="watch">➕ 加入</button>
    <div id="watchFormMsg"></div>`;
}

async function submitWatch() {
  const msgEl = document.getElementById("watchFormMsg");
  msgEl.innerHTML = "";
  try {
    const payload = {
      symbol: document.getElementById("f_watch_symbol").value.toUpperCase().trim(),
      target_buy: parseFloat(document.getElementById("f_watch_target").value || 0) || null,
      note: document.getElementById("f_watch_note").value,
    };
    const res = await fetch("/api/watchlist", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (!res.ok) throw new Error(apiErrorMessage(j, "送出失敗"));
    if (j.ok === false) {
      msgEl.innerHTML = `<div class="form-error">${esc(j.message)}</div>`;
      return;
    }
    msgEl.innerHTML = `<div class="form-success">✅ ${esc(j.message)}</div>`;
    watchOpen = false;
    watchData = null;
    await loadWatchData();
    rerenderWatchBody();
  } catch (err) {
    msgEl.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}
onSeg("submit", val => { if (val === "watch") submitWatch(); });

let watchData = null;
async function loadWatchData() {
  if (!watchData) watchData = await api("/watchlist");
}

function rerenderWatchBody() {
  const body = document.getElementById("watchBody");
  if (!body) return;
  if (watchData.empty) {
    body.innerHTML = `<p>追蹤清單是空的。點右上角「➕」加入。</p>` + renderFooter();
    return;
  }
  body.innerHTML =
    `<div style="display:flex;justify-content:space-between;color:#6b7280;font-size:.76rem;padding:0 4px 6px">
      <span>觀察 · ${watchData.rows.length} 檔</span><span>現價　·　單日漲跌</span></div>` +
    watchData.rows.map(watchRowHtml).join("") +
    `<p class="hint">👆 點看詳細　·　👈 左滑到底移除　·　長按拖曳排序</p>` + renderFooter();
}

function watchRowHtml(w) {
  const sub = w.label + (w.target_buy_usd !== null ? ` · 目標 ${usdOnly(w.target_buy_usd)}` : "");
  const row = stockRowHtml({ symbol: w.symbol, shares: null, weight_pct: null, price_usd: w.price_usd,
    day_pct: w.day_pct, emoji: w.emoji, _sub: sub }, "watch");
  return `<div class="watch-row-wrap" data-symbol="${esc(w.symbol)}">
    <div class="watch-row-delete-bg">🗑 移除</div>
    <div class="watch-row-content">${row}</div>
  </div>`;
}

async function deleteWatchSymbol(symbol) {
  try {
    const res = await fetch(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok) throw new Error(apiErrorMessage(j, "移除失敗"));
    watchData = null;
    await loadWatchData();
    rerenderWatchBody();
  } catch (err) {
    alert(err.message);
  }
}

async function saveWatchOrder(order) {
  if (watchData && watchData.rows) {
    const map = new Map(watchData.rows.map(r => [r.symbol, r]));
    watchData.rows = order.map(s => map.get(s)).filter(Boolean);
  }
  try {
    const res = await fetch("/api/watchlist/reorder", { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: order }) });
    if (!res.ok) throw new Error("順序儲存失敗");
  } catch (err) {
    console.error(err);
  }
}

// 追蹤清單一列的手勢統一在這裡處理，兩種手勢共用同一組 touch 事件才不會互相打架：
//   · 快速左右滑＝往左滑到底刪除（原本就有）
//   · 按住不放（長按）＝進入拖曳排序模式，上下移動可調整順序
// 跟左右換頁的手勢也是同一組 touch 事件，所以這裡偵測到是在 .watch-row-wrap 上
// 開始拖曳時，要蓋掉全域換頁那組手勢（見 bindSwipeNav 的排除清單）。
const LONG_PRESS_MS = 420;
let suppressWatchTapNav = false;
function bindWatchGestures() {
  let wrap = null, content = null;
  let startX = 0, startY = 0, dx = 0, width = 1, grabOffset = 0;
  let mode = "idle"; // idle | deciding | swipe | reorder
  let pressTimer = null;

  function cleanup() {
    clearTimeout(pressTimer);
    if (content) content.classList.remove("dragging");
    if (wrap) { wrap.classList.remove("reordering"); wrap.style.zIndex = ""; }
    wrap = content = null; mode = "idle";
  }

  function enterReorderMode() {
    const r = wrap.getBoundingClientRect();
    grabOffset = startY - (r.top + r.height / 2);
    wrap.classList.add("reordering");
    wrap.style.zIndex = "50";
    suppressWatchTapNav = true;
    if (navigator.vibrate) navigator.vibrate(12);
  }

  document.addEventListener("touchstart", e => {
    const w = e.target.closest(".watch-row-wrap");
    if (!w) { cleanup(); return; }
    wrap = w; content = w.querySelector(".watch-row-content");
    const t = e.touches[0];
    startX = t.clientX; startY = t.clientY; dx = 0;
    width = w.getBoundingClientRect().width;
    mode = "deciding";
    content.classList.add("dragging");
    pressTimer = setTimeout(() => {
      if (mode === "deciding") { mode = "reorder"; enterReorderMode(); }
    }, LONG_PRESS_MS);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!wrap) return;
    const t = e.touches[0];
    const rawDx = t.clientX - startX, rawDy = t.clientY - startY;

    if (mode === "deciding") {
      if (Math.abs(rawDx) < 8 && Math.abs(rawDy) < 8) return;
      clearTimeout(pressTimer);
      if (Math.abs(rawDx) > Math.abs(rawDy) * 1.3) { mode = "swipe"; }
      else { cleanup(); return; }
    }

    if (mode === "swipe") {
      dx = Math.max(0, -rawDx);
      content.style.transform = `translateX(${-dx}px)`;
      e.preventDefault();
      return;
    }

    if (mode === "reorder") {
      e.preventDefault();
      const parent = wrap.parentElement;
      const draggedCenter = t.clientY - grabOffset;
      wrap.style.transform = "none";
      const natural = wrap.getBoundingClientRect();
      wrap.style.transform = `translateY(${draggedCenter - (natural.top + natural.height / 2)}px)`;

      const list = [...parent.children];
      const idx = list.indexOf(wrap);
      const prev = list[idx - 1];
      if (prev) {
        const pr = prev.getBoundingClientRect();
        if (draggedCenter < pr.top + pr.height * 0.5) parent.insertBefore(wrap, prev);
      }
      const next = list[idx + 1];
      if (next) {
        const nr = next.getBoundingClientRect();
        if (draggedCenter > nr.top + nr.height * 0.5) parent.insertBefore(wrap, next.nextSibling);
      }
    }
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!wrap) return;
    if (mode === "swipe") {
      content.classList.remove("dragging");
      const symbol = wrap.dataset.symbol;
      if (dx > width * 0.65) {
        content.style.transform = `translateX(${-width}px)`;
        content.style.opacity = "0";
        setTimeout(() => deleteWatchSymbol(symbol), 180);
      } else {
        content.style.transform = "translateX(0)";
      }
      wrap = content = null; mode = "idle";
      return;
    }
    if (mode === "reorder") {
      const parent = wrap.parentElement;
      const order = [...parent.querySelectorAll(".watch-row-wrap")].map(el => el.dataset.symbol);
      wrap.style.transition = "transform .22s var(--bounce)";
      wrap.style.transform = "none";
      wrap.classList.remove("reordering");
      const w = wrap;
      setTimeout(() => { w.style.transition = ""; w.style.zIndex = ""; }, 230);
      wrap = content = null; mode = "idle";
      saveWatchOrder(order);
      return;
    }
    cleanup();
  }, { passive: true });
}
bindWatchGestures();

async function renderWatchList() {
  const app = document.getElementById("app");
  const addBtn = `<div class="popover-wrap">
    <button class="btn-circle-glass" id="addWatchBtn">+</button>
    <div class="popover-panel${watchOpen ? " open" : ""}" id="addWatchPanel"></div>
  </div>`;
  app.innerHTML = renderHeader("👀 追蹤清單", addBtn) +
    `<div id="watchBody">${skeletonList()}</div>` + renderBottomNav("watch");
  bindHeaderEvents();
  document.getElementById("addWatchBtn").addEventListener("click", () => {
    watchOpen = !watchOpen;
    const panel = document.getElementById("addWatchPanel");
    panel.classList.toggle("open", watchOpen);
    if (watchOpen) panel.innerHTML = renderWatchForm();
  });

  await loadWatchData();
  rerenderWatchBody();
}

// ------------------------------------------------------------------
// 📊 統計報表
// ------------------------------------------------------------------
let statsPeriod = "all";
let statsShowN = {};
let statsCache = {};

function txCardHtml(t) {
  const logo = logoWrap(t.symbol, 36, 8);
  const symBadge = `<span style="background:var(--card2);color:var(--sub);font-size:.72rem;
    font-weight:700;padding:2px 7px;border-radius:6px;margin-right:6px">${esc(t.symbol)}</span>`;
  const tagColor = { "買進": RED, "配息": ORANGE }[t.type] || GREEN;
  const tag = `<span style="font-weight:700;color:${tagColor}">${esc(t.type)}</span>`;
  const head = `<div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="display:flex;align-items:center;gap:10px">${logo}
      <div><div class="nm">${tag}　<span class="sub">${t.date}</span></div>
      <div class="sub" style="margin-top:2px">${symBadge}${esc(t.name)}</div></div></div>`;

  const cls = { "配息": "div", "買進": "buy" }[t.type] || "sell";
  let body;
  if (t.type === "配息") {
    body = `${head}<div style="text-align:right;color:${GREEN};font-weight:800">${mh(t.pl_usd, true)}</div></div>`;
  } else if (t.type === "買進") {
    let footL = `成本 ${usdOnly(t.price_usd)}`;
    let chip = "";
    if (t.live_price_usd) {
      const gain = (t.live_price_usd - t.price_usd) * t.shares;
      const diffPct = t.price_usd ? (t.live_price_usd - t.price_usd) / t.price_usd * 100 : 0;
      const gc = colorOf(gain);
      const arrow = gain >= 0 ? "▲" : "▼";
      footL += `　現價 ${usdOnly(t.live_price_usd)}`;
      chip = `<span class="chip" style="color:${gc};background:${gc}1c">${arrow} ${mh(gain, true)}（${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%）</span>`;
    }
    body = `${head}<div style="text-align:right;font-weight:800;font-size:1.05rem">${t.shares % 1 === 0 ? t.shares : t.shares.toFixed(5)} 股</div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
        <span class="sub">${footL}</span>${chip}</div>`;
  } else {
    const feeTax = t.fee + t.tax;
    const exTxt = feeTax ? `（費稅 ${usdOnly(feeTax)}）` : "";
    const cc = colorOf(t.pl_usd);
    const chip = `<span class="chip" style="color:${cc};background:${cc}1c">${mh(t.pl_usd, true)}（${t.pl_pct >= 0 ? "+" : ""}${t.pl_pct.toFixed(1)}%）</span>`;
    body = `${head}<div style="text-align:right;font-weight:800;font-size:1.05rem">${t.shares % 1 === 0 ? t.shares : t.shares.toFixed(5)} 股</div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
        <span class="sub">@ ${usdOnly(t.price_usd)}${exTxt}</span>${chip}</div>`;
  }
  return `<div class="tcard ${cls}" style="display:block">${body}</div>`;
}

async function loadStats(period) {
  if (!statsCache[period]) statsCache[period] = await api(`/stats?period=${period}`);
  return statsCache[period];
}

function rerenderStatsBody() {
  const body = document.getElementById("statsRest");
  const s = statsCache[statsPeriod];
  if (!s || !body) return;
  const periodLabel = { all: "全部", ytd: "今年", "90d": "近 90 天", custom: "自訂" }[statsPeriod];
  const rpct = s.range_pl_pct !== null ? `（${s.range_pl_pct >= 0 ? "+" : ""}${s.range_pl_pct.toFixed(2)}%）` : "";
  const summary = `<div class="statsummary">
    <div class="row"><div>
      <div class="l">區間已實現損益</div>
      <div class="v" style="color:${colorOf(s.range_pl_usd)}">${mh(s.range_pl_usd, true)}${rpct}</div>
      <div class="s">${periodLabel}　·　${s.range_count} 筆交易</div>
    </div></div>
    <div class="row"><div>
      <div class="l">累計已實現損益</div>
      <div class="v" style="color:${colorOf(s.total_pl_all_usd)}">${mh(s.total_pl_all_usd, true)}</div>
      <div class="s">全部歷史</div>
    </div></div></div>`;

  const showN = statsShowN[statsPeriod] || 10;
  const shown = s.transactions.slice(0, showN);
  const txHtml = shown.length ? shown.map(txCardHtml).join("") : "<i>此區間沒有交易。</i>";
  const moreBtn = showN < s.transactions.length
    ? `<button type="button" class="btn-submit" data-seg-btn="stats-more" data-value="1">查看更多（還有 ${s.transactions.length - showN} 筆）</button>`
    : "";

  const rankHtml = s.ranking.map(r => `<div class="hitem"><div style="display:flex;align-items:center;gap:10px">
    ${logoWrap(r.symbol, 30, 7)}
    <b>${esc(r.symbol)}</b></div><b style="color:${colorOf(r.pl_usd)}">${mh(r.pl_usd, true)}</b></div>`).join("");

  body.innerHTML = summary +
    sec(`💳 交易明細（${s.range_count} 筆）`) + txHtml + moreBtn +
    sec("🏆 個股損益排行（全部歷史）") + rankHtml + renderFooter();
}

onSeg("stats-more", () => {
  statsShowN[statsPeriod] = (statsShowN[statsPeriod] || 10) + 10;
  rerenderStatsBody();
});
onSeg("period", async val => {
  statsPeriod = val;
  document.querySelectorAll('[data-seg-btn="period"]').forEach(b => b.classList.toggle("active", b.dataset.value === val));
  const rest = document.getElementById("statsRest");
  if (rest) rest.innerHTML = skeletonCards();
  await loadStats(val);
  rerenderStatsBody();
});

async function renderStats() {
  const app = document.getElementById("app");
  app.innerHTML = renderHeader("📊 統計報表") +
    `<div id="statsBody">${skeletonCards()}</div>` + renderBottomNav("stats");
  bindHeaderEvents();

  const s0 = await loadStats("all");
  const body = document.getElementById("statsBody");
  if (s0.empty) {
    body.innerHTML = `<p>尚無歷史交易資料。到「📦 我的持股」新增一筆賣出或配息紀錄。</p>` + renderFooter();
    return;
  }
  body.innerHTML = sec("📅 選擇區間") + segGroup("period", [
    { key: "all", label: "全部" }, { key: "ytd", label: "今年" }, { key: "90d", label: "近 90 天" },
  ], statsPeriod) + `<div id="statsRest"></div>`;
  rerenderStatsBody();
}

// ------------------------------------------------------------------
// 頁尾：每頁共用的說明文字
// ------------------------------------------------------------------
// 拿掉了原本的「🔄 更新」按鈕：資料已經有背景排程每 10 分鐘自動保持新鮮，
// 這顆按鈕唯一的效果只是把剛預熱好的快取整個清空，點下去反而讓 App 變慢。
function renderFooter() {
  return `<hr style="margin:22px 0 14px">
    <p class="hint" style="text-align:center;margin-top:10px">
      資料來源：Yahoo Finance（延遲行情，每 10 分鐘自動更新）。本工具僅供個人記帳與參考，不構成投資建議。</p>`;
}

// ------------------------------------------------------------------
// 📰 每日簡報
// ------------------------------------------------------------------
async function renderBrief() {
  const app = document.getElementById("app");
  app.innerHTML = renderHeader("📰 每日投資簡報") +
    `<p class="hint">每天自動幫你盤點三件事：① 美股大盤走勢＋新聞　② 你的持股大幅漲跌＋原因＋買賣建議
      ③ 值得關注的股票。完全免費、免金鑰。</p>
     <div id="briefBody">${skeletonCards()}</div>` + renderBottomNav("brief");
  bindHeaderEvents();

  const body = document.getElementById("briefBody");
  const b = await api("/briefing");
  renderBriefBody(b);

  async function renderBriefBody(data) {
    let inner = `<button type="button" class="btn-submit" data-seg-btn="gen-brief" data-value="1">✨ 產生今日簡報</button>`;
    if (data.html) {
      inner += `<p class="hint">上次更新：${esc(data.last_at || "")}</p>${data.html}`;
    } else {
      inner += `<p class="hint" style="margin-top:10px">按「✨ 產生今日簡報」看今天的完整盤點。</p>`;
    }
    inner += `<hr style="margin:22px 0 14px">
      <h4>⏰ 每天自動更新</h4>
      <p class="hint">已設定 Windows 排程，每天早上 8:00 自動更新，打開 app 就看得到最新的。</p>` + renderFooter();
    body.innerHTML = inner;
  }

  onSeg("gen-brief", async () => {
    body.innerHTML = skeletonWithHint(220, "整理大盤、你的持股與相關新聞中…（約 10-20 秒）");
    try {
      const data = await fetch("/api/briefing/generate", { method: "POST" }).then(r => {
        if (!r.ok) return r.json().then(j => { throw new Error(apiErrorMessage(j, "產生失敗")); });
        return r.json();
      });
      renderBriefBody(data);
    } catch (err) {
      body.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
    }
  });
}

// ------------------------------------------------------------------
// 📈 資產走勢（點淨資產進去）
// ------------------------------------------------------------------
let trendGran = "日";

async function renderTrend() {
  const app = document.getElementById("app");
  app.innerHTML = `<button class="btn-back" id="backBtn">←</button>
    <h1>📈 資產走勢</h1>
    <div id="trendBody">${skeletonWithHint(240, "計算歷史市值中…（約 10-20 秒）")}</div>` +
    renderBottomNav("home");
  document.getElementById("backBtn").addEventListener("click", () => navigateTo("?nav=home"));

  await loadTrendBody();
}

async function loadTrendBody() {
  const body = document.getElementById("trendBody");
  const t = await api(`/trend?gran=${encodeURIComponent(trendGran)}`);
  if (t.empty) {
    body.innerHTML =
      segGroup("trendgran", [{ key: "日", label: "日" }, { key: "月", label: "月" }, { key: "年", label: "年" }], trendGran) +
      `<p>暫時抓不到足夠的歷史資料，稍後再試。</p>` + renderFooter();
    return;
  }
  body.innerHTML = segGroup("trendgran", [
    { key: "日", label: "日" }, { key: "月", label: "月" }, { key: "年", label: "年" },
  ], trendGran) +
  `<div style="display:flex;gap:10px;margin:6px 0 14px">
    <div class="statcell" style="flex:1"><div class="l">目前市值</div><div class="v">${mh(t.cur_value_usd)}</div></div>
    <div class="statcell" style="flex:1"><div class="l">${esc(trendGran)}走勢變化</div>
      <div class="v" style="color:${colorOf(t.delta_usd)}">${mh(t.delta_usd, true)}　${pctStr(t.delta_pct)}</div></div>
  </div>` +
  sec("每期市值走勢") + `<div class="plotly-chart-wrap" id="trendChart"></div>` +
  sec(`每${trendGran}變化`) + `<div class="plotly-chart-wrap" id="trendBarChart"></div>` +
  `<p class="hint">※ 以目前持股股數 × 歷史股價回推，僅供參考；未計入期間買賣變動。</p>` + renderFooter();

  const up = t.delta_usd >= 0;
  drawLineChart(document.getElementById("trendChart"), t.series, {
    color: up ? GREEN : RED,
    fillColor: up ? "rgba(74,154,108,0.10)" : "rgba(194,102,97,0.10)",
    moneyFmt: v => mh(v),
  });
  drawBarChart(document.getElementById("trendBarChart"), t.changes, {
    posColor: GREEN, negColor: RED, moneyFmt: v => mh(v),
  });
}

onSeg("trendgran", async val => {
  trendGran = val;
  document.querySelectorAll('[data-seg-btn="trendgran"]').forEach(b => b.classList.toggle("active", b.dataset.value === val));
  document.getElementById("trendBody").innerHTML = skeletonWithHint(240, "計算歷史市值中…（約 10-20 秒）");
  await loadTrendBody();
});

// ------------------------------------------------------------------
// 💵 設定可用資金
// ------------------------------------------------------------------
async function renderCash() {
  const app = document.getElementById("app");
  app.innerHTML = `<button class="btn-back" id="backBtn">←</button>
    <h1>💵 設定可用資金</h1>
    <div class="form-field" style="margin-top:14px">
      <label>可用資金（USD，可買入的現金）</label>
      <input type="number" id="f_cash" min="0" step="100" value="${state.cash}">
    </div>
    <button type="button" class="btn-submit" data-seg-btn="save-cash" data-value="1">儲存</button>
    <div id="cashMsg"></div>` + renderBottomNav("home");
  document.getElementById("backBtn").addEventListener("click", () => navigateTo("?nav=home"));
}

onSeg("save-cash", async () => {
  const val = parseFloat(document.getElementById("f_cash").value || 0);
  await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cash_usd: val }) });
  document.getElementById("cashMsg").innerHTML = `<div class="form-success">已儲存！</div>`;
});

// ------------------------------------------------------------------
// 尚未搬遷完成的頁面：先顯示佔位訊息
// ------------------------------------------------------------------
function renderPlaceholder(key, title) {
  const app = document.getElementById("app");
  app.innerHTML = renderHeader(title) +
    `<p style="color:var(--sub)">這頁還在搬遷中，敬請期待。現有功能請先用 Streamlit 版 App。</p>` +
    renderBottomNav(key);
  bindHeaderEvents();
}

// ------------------------------------------------------------------
// 路由
// ------------------------------------------------------------------
let configLoaded = false;

// 换頁不用整頁重新載入：只換網址列＋重繪內容，省掉重新下載/解析整份 HTML/CSS/JS
// 跟每次都重抓一次 /api/config 的開銷，點哪裡都會快很多。
function navigateTo(url) {
  history.pushState(null, "", url);
  render();
}

window.addEventListener("popstate", render);

async function render() {
  const nav = qs("nav", "home");
  if (!configLoaded) {
    const cfg = await api("/config");
    state.cur = cfg.cur; state.rate = cfg.rate; state.cash = cfg.cash_usd;
    configLoaded = true;
  }

  if (qs("trend", null)) return renderTrend();
  if (qs("cash", null)) return renderCash();
  const sym = qs("sym", null);
  if (sym) return renderDetail(sym, nav);
  if (nav === "home") return renderHome();
  if (nav === "hold") return renderHoldList();
  if (nav === "watch") return renderWatchList();
  if (nav === "stats") return renderStats();
  if (nav === "brief") return renderBrief();
  return renderHome();
}

// 個股詳細／資產走勢／可用資金這些「子頁面」不是分頁輪播的一員，左右滑不該跳去
// 相鄰分頁（例如追蹤清單點進個股詳細，往前滑卻跑去持股，因為持股剛好是追蹤清單
// 分頁順序上的前一個）。子頁面上滑動只做一件事：往右滑＝返回上一頁，往左滑沒有意義。
function subPageBackTarget() {
  const sym = qs("sym", null);
  if (sym) return `?nav=${qs("nav", "hold")}`;
  if (qs("trend", null) || qs("cash", null)) return "?nav=home";
  return null;
}

// 左右滑動換頁：手指移動時畫面就即時跟著滑（有阻尼），放開後再決定是換頁還是彈回原位，
// 不是像之前那樣放開才觸發，滑動的當下要看得到回饋。
function bindSwipeNav() {
  const app = document.getElementById("app");
  let sx = 0, sy = 0, dx = 0, active = true, deciding = true, dragging = false;

  document.addEventListener("touchstart", e => {
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; dx = 0;
    active = !e.target.closest(".js-plotly-plot, .plotly-chart-wrap, .watch-row-wrap");
    deciding = true; dragging = false;
    app.style.transition = "none";
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!active) return;
    const t = e.touches[0];
    const rawDx = t.clientX - sx, rawDy = t.clientY - sy;
    if (deciding) {
      if (Math.abs(rawDx) < 10 && Math.abs(rawDy) < 10) return;
      dragging = Math.abs(rawDx) > Math.abs(rawDy) * 1.3;
      deciding = false;
      if (!dragging) return; // 判定是上下滾動，交還給瀏覽器原生捲動
    }
    if (!dragging) return;
    dx = rawDx;
    const backTarget = subPageBackTarget();
    let damp;
    if (backTarget) {
      damp = dx > 0 ? 0.85 : 0.35; // 子頁面：往右（返回）正常跟手，往左沒地方去所以加阻尼
    } else {
      const order = NAV.map(n => n.key);
      const i = Math.max(0, order.indexOf(qs("nav", "home")));
      const atStart = i === 0 && dx > 0, atEnd = i === order.length - 1 && dx < 0;
      damp = (atStart || atEnd) ? 0.35 : 0.85; // 到頭尾兩端加阻尼，感覺像撞到底
    }
    app.style.transform = `translateX(${dx * damp}px)`;
    app.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / 700));
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!dragging) { deciding = true; return; }
    dragging = false; deciding = true;
    const backTarget = subPageBackTarget();
    if (backTarget) {
      if (dx > 70) finishSwipeTo(backTarget, "right");
      else snapBack(app);
      return;
    }
    const order = NAV.map(n => n.key);
    let i = order.indexOf(qs("nav", "home"));
    if (i < 0) i = 0;
    const next = dx < 0 ? i + 1 : i - 1;
    if (Math.abs(dx) > 70 && next >= 0 && next < order.length) {
      finishSwipeTo(`?nav=${order[next]}`, dx < 0 ? "left" : "right");
    } else {
      snapBack(app);
    }
  }, { passive: true });
}

function snapBack(app) {
  app.style.transition = "transform .3s var(--bounce), opacity .2s";
  app.style.transform = "translateX(0)";
  app.style.opacity = "1";
}

// 手指放開、確定要換頁：從目前拖曳的位置繼續滑出去，再換上下一頁滑進來。
function finishSwipeTo(url, dir) {
  const app = document.getElementById("app");
  const outX = dir === "left" ? "-100%" : "100%";
  app.style.transition = "transform .18s ease-in, opacity .18s ease-in";
  app.style.transform = `translateX(${outX})`;
  app.style.opacity = "0";
  setTimeout(() => {
    navigateTo(url);
    const inX = dir === "left" ? "100%" : "-100%";
    app.style.transition = "none";
    app.style.transform = `translateX(${inX})`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        app.style.transition = "transform .32s var(--bounce), opacity .24s";
        app.style.transform = "translateX(0)";
        app.style.opacity = "1";
      });
    });
  }, 180);
}

// 攔截站內連結（href 以 "?" 開頭的都是我們自己的分頁/詳細頁連結），
// 改用 SPA 換頁而不是整頁重新載入；外部連結（新聞等）不受影響照常開新分頁。
document.addEventListener("click", e => {
  if (suppressWatchTapNav) { suppressWatchTapNav = false; e.preventDefault(); e.stopPropagation(); return; }
  const a = e.target.closest("a");
  if (!a) return;
  const href = a.getAttribute("href");
  if (href && href.startsWith("?")) {
    e.preventDefault();
    navigateTo(href);
  }
});

bindSwipeNav();
render();
