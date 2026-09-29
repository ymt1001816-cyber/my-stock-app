// ==================================================================
// 我的持股 / 個股詳細 / 追蹤清單
// 這個檔案由 app.js 拆分而來（原本 2584 行、124KB 的單一檔案）。
// 載入順序：chart.js → core.js → pages-portfolio.js → pages-reports.js → app.js
// ==================================================================

let holdData = null;
// 排序選擇存起來：電腦上常常來回切頁，每次都跳回預設很煩。
// 存錯值（例如舊版本留下的 key）也不會壞，下面排序是 if/else 鏈，最後一支是預設。
// allowed 一定要傳：存到不認得的值（改版後舊 key 還留著、或手動改過）時，
// 排序本身會安全地落到預設分支，但選單上會變成一顆按鈕都沒亮，看起來像壞了。
function loadPref(key, fallback, allowed) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch { return fallback; }
}
function savePref(key, val) {
  try { localStorage.setItem(key, val); } catch { /* 無痕模式會擋，忽略 */ }
}
let holdSort = loadPref("holdSort", "mv", ["mv", "pl_pct", "symbol", "day_pct"]);
let symbolsCache = null;
let addOpen = false;
let addType = "買進";

async function loadSymbols() {
  if (!symbolsCache) symbolsCache = (await api("/symbols")).symbols;
  return symbolsCache;
}

function stockRowHtml(r, navKey = "hold", idx = 0, animate = false) {
  // _subHtml：副標需要放粗體、顏色這類標記時用它（例如追蹤清單的「可進場」徽章）。
  // 它不會再經過 esc()，所以呼叫端必須自己把所有動態內容 esc 過才傳進來。
  // 三種情況：_subHtml（自訂 HTML）、_sub（自訂純文字）、都沒有才用持股的預設格式。
  // 少判斷 _subHtml 的話，追蹤清單會掉進預設分支去算 weight_pct.toFixed()，
  // 而它傳進來的 shares/weight_pct 是 null，整頁會直接壞掉。
  const sub = r._subHtml !== undefined ? "" : r._sub !== undefined ? r._sub :
    `${r.shares % 1 === 0 ? r.shares : r.shares.toFixed(5)} 股 · 佔比 ${r.weight_pct.toFixed(1)}%`;
  // 持股列表看的是「賺賠多少」，不是當天股價；追蹤清單沒有成本，才顯示現價/當日漲跌。
  const hasPl = r.pl_usd !== undefined;
  const plColor = colorOf(hasPl ? r.pl_usd : r.day_pct);
  const right = hasPl
    ? `<div class="nm" style="color:${plColor}">${mh(r.pl_usd, true)}</div>
       <div class="chip" style="background:${plColor}17;color:${plColor}">${pctStr(r.pl_pct)}</div>`
    : `<div class="nm">${usdOnly(r.price_usd)}</div>
       <div class="chip" style="background:${plColor}17;color:${plColor}">${pctStr(r.day_pct)}</div>`;
  const hasSpark = Array.isArray(r.spark) && r.spark.length > 1;
  const sparkColor = colorOf(r.spark && r.spark.length > 1 ? r.spark[r.spark.length - 1] - r.spark[0] : 0);
  const spark = hasSpark
    ? `<div class="hitem-spark"><canvas data-spark='${esc(JSON.stringify(r.spark))}' data-spark-color="${sparkColor}"></canvas></div>`
    : "";
  // 持股清單原本只顯示賺賠，完全看不到現價跟今日漲跌 —— 手機是沒空間，
  // 但桌面的卡片寬得多。這一欄永遠輸出，由 CSS 決定小螢幕隱藏、寬螢幕顯示。
  const dayColor = colorOf(r.day_pct);
  const mid = hasPl && r.price_usd !== undefined
    ? `<div class="hitem-mid">
         <div class="v">${usdOnly(r.price_usd)}</div>
         <div class="d" style="color:${dayColor}">${pctStr(r.day_pct)}</div>
       </div>`
    : "";
  // 一列一列淡入的動畫延遲，最多疊到 300ms 就好，清單很長也不會等太久才全部進場；
  // 只有真的剛進到這頁（animate=true）才加這個效果，重新排序/刷新不要重播。
  const delay = Math.min(idx * 28, 300);
  const enterCls = animate ? " row-enter" : "";
  const enterStyle = animate ? ` style="animation-delay:${delay}ms"` : "";
  // 左側細色條：22 檔一次排開時，用顏色掃比讀數字快得多。
  // 持股看累計賺賠，追蹤清單沒有成本、看當日漲跌。
  const toneVal = hasPl ? r.pl_usd : r.day_pct;
  const tone = !toneVal ? "" : (toneVal > 0 ? " tone-up" : " tone-down");
  return `<a class="hlink${enterCls}"${enterStyle} href="?nav=${navKey}&sym=${encodeURIComponent(r.symbol)}">
    <div class="hitem${tone}">
      <div class="hitem-left">
        <div class="hitem-logo">${logoImg(r.symbol)}</div>
        <div class="hitem-name">
          <div class="nm">${r.emoji} ${esc(r.symbol)}</div>
          <div class="sub">${r._subHtml !== undefined ? r._subHtml : esc(sub)}</div>
        </div>
      </div>
      ${mid}
      ${spark}
      <div class="hitem-right">
        ${right}
      </div>
    </div>
  </a>`;
}

// 畫面上所有 stockRowHtml 產生的 sparkline canvas 一次補畫（innerHTML 塞進去的 <canvas>
// 是空的，要另外抓 data-spark 屬性用真正的 canvas API 畫線）。
function paintSparklines(root) {
  (root || document).querySelectorAll("canvas[data-spark]").forEach(canvas => {
    if (canvas.dataset.painted) return;
    canvas.dataset.painted = "1";
    const values = JSON.parse(canvas.dataset.spark);
    drawSparkline(canvas, values, canvas.dataset.sparkColor);
  });
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
  return `<div class="sheet-handle"></div>
    <p class="form-hint">先選類型 → 選/填股票 → 填細節。會自動更新持股、已實現損益，並記進交易筆記。</p>
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
    // 買/賣/配息都會連動改可用資金，把快取的 state.cash 一起更新，
    // 不然剛送出交易後馬上點「編輯可用資金」看到的還是交易前的舊數字。
    // 這兩個 API 互不依賴，一起打不要排隊，不然關閉表單會多等一趟網路來回。
    // 買／賣／配息都會改到總資產、已實現損益與交易明細，這兩頁的快取一併失效，
    // 不然切過去看到的還是交易前的數字。
    summaryCache = null;
    statsCache = {};
    const [cfg] = await Promise.all([api("/config"), loadHoldData(true)]);
    state.cash = cfg.cash_usd;
    // 先讓成功訊息留在表單上一下子，再關閉並刷新列表，不然訊息會被 rerenderHoldBody
    // 重畫表單的動作瞬間蓋掉，使用者完全看不到剛剛送出成功。
    setTimeout(() => {
      addOpen = false;
      toggleSheet("addTxPanel", "addTxBackdrop", false);
      rerenderHoldBody();
    }, 700);
  } catch (err) {
    msgEl.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}

onSeg("addtype", val => { addType = val; rerenderAddPanel(); });
onSeg("holdsort", val => { holdSort = val; savePref("holdSort", val); rerenderHoldBody(); });
onSeg("submit", val => submitTransaction(val));

async function loadHoldData(force = false) {
  if (force || !holdData) {
    const [hd] = await Promise.all([api("/holdings"), loadSymbols()]);
    holdData = hd;
    saveSnap("holdings", hd);
  }
}

function rerenderHoldBody(animate = false) {
  const body = document.getElementById("holdBody");
  if (!body) return;
  if (holdData.empty) {
    body.innerHTML = emptyState("📦", "還沒有持股",
      "點右上角「➕」買進第一筆持股。") + renderFooter();
    return;
  }
  const rows = [...holdData.rows];
  if (holdSort === "symbol") rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  else if (holdSort === "day_pct") rows.sort((a, b) => (a.day_pct || 0) - (b.day_pct || 0));
  // 報酬率由高到低：想看「哪幾檔最會賺／賠最慘」時，比市值排序直接得多
  else if (holdSort === "pl_pct") rows.sort((a, b) => (b.pl_pct || 0) - (a.pl_pct || 0));
  else rows.sort((a, b) => b.market_value_usd - a.market_value_usd);

  body.innerHTML = segGroup("holdsort", [
    { key: "mv", label: "市值" }, { key: "pl_pct", label: "報酬率" },
    { key: "symbol", label: "代號 A→Z" }, { key: "day_pct", label: "單日漲跌" },
  ], holdSort) +
  `<div style="display:flex;justify-content:space-between;color:#6b7280;font-size:.76rem;padding:0 4px 6px">
    <span>持倉 · ${rows.length} 檔</span><span>損益金額　·　報酬率</span></div>` +
  `<div class="cardgrid">${rows.map((r, i) => stockRowHtml(r, "hold", i, animate)).join("")}</div>` +
  `<p class="hint">👆 點任一列看個股詳細（走勢圖、盤前盤後、財報、建議）</p>` + renderFooter();
  const panel = document.getElementById("addTxPanel");
  if (panel) panel.innerHTML = renderAddForm();
  bindSellCaption();
  paintSparklines(body);
}

async function renderHoldList() {
  const app = document.getElementById("app");
  const addBtn = `<button class="btn-circle-glass" id="addTxBtn">+</button>`;
  app.innerHTML = renderHeader("📦 我的持股", addBtn) +
    `<div id="holdBody">${skeletonList()}</div>` + renderBottomNav("hold") +
    sheetMarkup("addTxPanel", "addTxBackdrop");
  bindHeaderEvents();
  document.getElementById("addTxBtn").addEventListener("click", () => {
    addOpen = !addOpen;
    toggleSheet("addTxPanel", "addTxBackdrop", addOpen);
    if (addOpen) rerenderAddPanel();
  });
  document.getElementById("addTxBackdrop").addEventListener("click", () => {
    addOpen = false;
    toggleSheet("addTxPanel", "addTxBackdrop", false);
  });

  // 同首頁：先畫上次的快照，再等真正的資料。rerenderHoldBody 讀的是模組變數，
  // 所以暫時指派過去畫完再還原，讓下面的 loadHoldData 真的會去抓。
  if (!holdData) {
    const snap = loadSnap("holdings");
    if (snap) {
      holdData = snap.data;
      rerenderHoldBody(true);
      const b = document.getElementById("holdBody");
      if (b) b.insertAdjacentHTML("afterbegin", staleBanner(snap.at));
      holdData = null;
    }
  }

  await loadHoldData();
  rerenderHoldBody(true);
}

// ------------------------------------------------------------------
// 📦 個股詳細頁
// ------------------------------------------------------------------
let detailRange = "1mo";
let detailCache = null;

async function renderDetail(symbol, fromNav = "hold") {
  symbol = symbol.toUpperCase();
  const app = document.getElementById("app");
  app.innerHTML = `<button class="btn-back" id="backBtn">←</button>
    <div id="detailBody">${skeletonDetail()}</div>` + renderBottomNav(fromNav);
  document.getElementById("backBtn").addEventListener("click", () => goBack(`?nav=${fromNav}`));

  // 上一頁點進來前如果已經背景預抓過這檔（滑動切換的上一/下一檔常常就是），直接吃現成的，
  // 不用再重新打一次一樣的 API；沒預抓到才照原本方式現抓。
  const pre = detailRange === "1mo" ? detailPrefetchCache.get(symbol) : null;
  if (pre) detailPrefetchCache.delete(symbol);
  // 主要資料跟預設區間的走勢圖是兩個獨立的 API，同時發出去、不要一個等完才發下一個，
  // 不然點進個股頁的等待時間會是兩份疊加起來。
  const chartPromise = pre ? pre.chartPromise : api(`/chart/${encodeURIComponent(symbol)}?range=${detailRange}`);
  const d = pre ? await pre.dataPromise : await api(`/holdings/${encodeURIComponent(symbol)}`);
  detailCache = d;
  const body = document.getElementById("detailBody");

  const dc = colorOf(d.change_pct);
  const stateTxt = { REGULAR: "🟢 盤中", PRE: "🌅 盤前", POST: "🌙 盤後", CLOSED: "🔴 收盤" }[d.market_state] || "";
  let extra = "";
  if (d.pre_price_usd) extra = `　🌅 盤前 ${usdOnly(d.pre_price_usd)}（${pctStr(d.pre_pct)}）`;
  if (d.post_price_usd) extra = `　🌙 盤後 ${usdOnly(d.post_price_usd)}（${pctStr(d.post_pct)}）`;
  const dispState = extra ? "" : stateTxt;

  let html = `<div class="detail-hero">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      ${logoWrap(d.symbol, 44, 10, "flex:0 0 auto", d.logo_url)}
      <div style="min-width:0">
        <div style="font-weight:800;font-size:1.25rem">${esc(d.symbol)}</div>
        <div style="color:var(--sub);font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</div>
      </div>
    </div>
    <div style="color:var(--sub);font-size:.84rem;margin-bottom:10px">🏢 ${esc(d.biz)}　·　${esc(d.sector)}</div>
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span class="detail-hero-price">${usdOnly(d.price_usd)}</span>
      <span style="color:${dc};font-size:1.2rem;font-weight:700">${pctStr(d.change_pct)}</span>
    </div>
    ${dispState || extra ? `<div style="color:var(--sub);font-size:.86rem;margin-top:4px">${dispState}${extra}</div>` : ""}
  </div>`;

  // 兩個設定列（持股的停損價、追蹤清單的目標買價）統一放在同一區，不要各自
  // 開一個 🎯 區塊 —— 同時持有又在追蹤清單裡的股票（例如 VOO）會出現兩個標題，
  // 而且「目標買價」還排在「我的部位」之上，優先順序是反的。
  let targetBar = "";
  if (d.watch && d.watch.in_list) {
    const tb = d.watch.target_buy_usd;
    const suggest = (d.price_usd * 0.9).toFixed(2);
    targetBar = `<div class="stopbar">
        <div class="l">🎯 目標買價</div>
        <div class="v" id="tbNow">${tb ? usdOnly(tb) : "<span class='sub'>尚未設定</span>"}</div>
        <input type="number" id="tbInput" min="0" step="any" placeholder="${suggest}"
               value="${tb || ""}" aria-label="目標買價">
        <button type="button" class="btn-pill" id="tbSave">儲存</button>
        ${tb ? `<button type="button" class="btn-pill" id="tbClear">清除</button>` : ""}
        <div class="msg" id="tbMsg">跌到這個價位，追蹤清單就會提示可以進場（留白＝現價 -10%）</div>
      </div>`;
  }

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
    const sp = p.stop_price;
    html += `<div class="stopbar">
      <div class="l">🛑 我的停損價</div>
      <div class="v" id="spNow">${sp ? usdOnly(sp) : "<span class='sub'>尚未設定</span>"}</div>
      <input type="number" id="spInput" min="0" step="any" placeholder="${v.suggest_stop}"
             value="${sp || ""}" aria-label="停損價">
      <button type="button" class="btn-pill" id="spSave">儲存</button>
      ${sp ? `<button type="button" class="btn-pill" id="spClear">清除</button>` : ""}
      <div class="msg" id="spMsg">跌破這個價位，總覽頁會跳出提醒（留白＝建議值 ${usdOnly(v.suggest_stop)}）</div>
    </div>` + targetBar;
    targetBar = "";                 // 已經接在停損列後面了，後面不要再放一次
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

    if (p.rsi !== null || p.macd || p.vol_ratio !== null) {
      const rsiTxt = p.rsi !== null
        ? `${p.rsi.toFixed(0)}${p.rsi >= 75 ? "（過熱）" : p.rsi <= 30 ? "（超賣）" : ""}` : "—";
      const rsiColor = p.rsi !== null && p.rsi >= 75 ? ORANGE : p.rsi !== null && p.rsi <= 30 ? "#1971c2" : GREY;
      let macdTxt = "—", macdColor = GREY;
      if (p.macd) {
        const crossedUp = p.macd.prev_hist <= 0 && p.macd.hist > 0;
        const crossedDown = p.macd.prev_hist >= 0 && p.macd.hist < 0;
        if (crossedUp) { macdTxt = "黃金交叉"; macdColor = "#1971c2"; }
        else if (crossedDown) { macdTxt = "死亡交叉"; macdColor = ORANGE; }
        else { macdTxt = p.macd.hist > 0 ? "偏多" : "偏空"; macdColor = p.macd.hist > 0 ? GREEN : ORANGE; }
      }
      const volTxt = p.vol_ratio !== null ? `${p.vol_ratio.toFixed(1)}倍均量` : "—";
      const volColor = p.vol_ratio !== null && p.vol_ratio >= 2 ? ORANGE : GREY;
      html += sec("📡 更多技術訊號") + statGrid([
        ["RSI (14)", rsiTxt, rsiColor],
        ["MACD", macdTxt, macdColor],
        ["成交量", volTxt, volColor],
      ]);
    }
  }

  if (targetBar) html += sec("🎯 我的目標買價") + targetBar;

  html += sec("📈 走勢圖") + segGroup("range", [
    { key: "1d", label: "當天" }, { key: "5d", label: "1週" }, { key: "1mo", label: "1月" },
    { key: "3mo", label: "3月" }, { key: "6mo", label: "6月" }, { key: "1y", label: "1年" },
  ], detailRange) + `<div class="plotly-chart-wrap" id="chartWrap">${skeletonBlock(260)}</div>`;

  const ks = d.key_stats;
  html += sec("🔑 關鍵數據") + statCardGroup([
    [`分析師`, `${ks.target_mean_usd ? usdOnly(ks.target_mean_usd) : "—"}<br>${esc(ks.recommend)}`,
      ks.target_mean_usd && ks.target_mean_usd > d.price_usd ? GREEN : GREY],
    ["52週高/低", `${usdOnly(ks.wk52_high_usd)} / ${usdOnly(ks.wk52_low_usd)}`, GREY],
    ["今日高/低", `${usdOnly(ks.day_high_usd)} / ${usdOnly(ks.day_low_usd)}`, GREY],
    ["本益比", ks.pe ? ks.pe.toFixed(1) : "—", GREY],
    ["市值", ks.market_cap ? `$${(ks.market_cap / 1e9).toLocaleString("en-US", { maximumFractionDigits: 0 })}B` : "—", GREY],
    ["Beta（波動度）", ks.beta ? `${ks.beta.toFixed(2)}${ks.beta > 1 ? "（波動大於大盤）" : "（波動小於大盤）"}` : "—", GREY],
    ["50/200日均", `${usdOnly(ks.ma50_usd)} / ${usdOnly(ks.ma200_usd)}`, GREY],
    // 殖利率與每股股利本來是兩格，但講的是同一件事，拆開反而要左右看兩次。
    // 併成一格之後總數從 9 變 8，格線剛好排滿（4 欄 × 2 列），不會再空出半列。
    ["殖利率", ks.div_yield_pct
      ? `${ks.div_yield_pct.toFixed(2)}%${ks.div_rate_usd ? `<br><span style="font-weight:600;color:var(--sub)">年配 ${usdOnly(ks.div_rate_usd)}</span>` : ""}`
      : "無配息", GREY],
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
  bindDetailSettings(symbol);
  onSeg("range", async val => {
    detailRange = val;
    document.querySelectorAll('[data-seg-btn="range"]').forEach(b =>
      b.classList.toggle("active", b.dataset.value === val));
    await loadChart(symbol);
  });
  // 預設區間的走勢圖一開始就跟主要資料同時發出去了，這裡直接吃那個 promise 的結果，
  // 不要再重新打一次 /chart（不然就白平行了）。
  const { points } = await chartPromise;
  drawChartPoints(points);
  prefetchNeighbors();
}

// 個股頁的價格設定列（持股的停損價、追蹤清單的目標買價）。兩者流程一樣：
// 輸入 → PATCH → 就地更新畫面，不整頁重畫（重畫會把走勢圖跟新聞整批重抓一次）。
function bindSettingBar({ ids, path, field, setKey, clearKey, label, onDone }) {
  const save = document.getElementById(ids.save);
  if (!save) return;
  const input = document.getElementById(ids.input);
  const msg = document.getElementById(ids.msg);
  const now = document.getElementById(ids.now);

  const send = async (payload, okText) => {
    msg.className = "msg";
    msg.textContent = "儲存中…";
    try {
      const r = await api(path, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const val = r[field];
      now.innerHTML = val ? usdOnly(val) : "<span class='sub'>尚未設定</span>";
      input.value = val || "";
      msg.className = "msg ok";
      msg.textContent = okText;
      // 「清除」鈕是依初始狀態畫出來的，第一次設定完要自己補上去；
      // 清掉之後也要收回，不然會出現「清除一個尚未設定的值」這種怪按鈕。
      syncClearBtn(!!val);
      if (onDone) onDone();
    } catch (e) {
      msg.className = "msg err";
      msg.textContent = "儲存失敗，請再試一次。";
    }
  };

  save.addEventListener("click", () => {
    // 留白＝沿用 placeholder 上的建議值，省得使用者自己抄一次
    const val = parseFloat(input.value.trim() || input.placeholder);
    if (!(val > 0)) {
      msg.className = "msg err";
      msg.textContent = "請輸入大於 0 的價格。";
      return;
    }
    send({ [setKey]: val }, `已設定${label} ${usdOnly(val)}`);
  });

  const onClear = () => send({ [clearKey]: true }, `已清除${label}`);

  function syncClearBtn(shouldExist) {
    const existing = document.getElementById(ids.clear);
    if (shouldExist && !existing) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-pill";
      btn.id = ids.clear;
      btn.textContent = "清除";
      btn.addEventListener("click", onClear);
      save.insertAdjacentElement("afterend", btn);
    } else if (!shouldExist && existing) {
      existing.remove();
    }
  }

  const initial = document.getElementById(ids.clear);
  if (initial) initial.addEventListener("click", onClear);
}

function bindDetailSettings(symbol) {
  const sym = encodeURIComponent(symbol);
  bindSettingBar({
    ids: { save: "spSave", clear: "spClear", input: "spInput", msg: "spMsg", now: "spNow" },
    path: `/holdings/${sym}`, field: "stop_price",
    setKey: "stop_price", clearKey: "clear_stop", label: "停損價",
    onDone: () => { holdData = null; summaryCache = null; },        // 持股清單的判斷會變，下次進去要重抓
  });
  bindSettingBar({
    ids: { save: "tbSave", clear: "tbClear", input: "tbInput", msg: "tbMsg", now: "tbNow" },
    path: `/watchlist/${sym}`, field: "target_buy",
    setKey: "target_buy", clearKey: "clear_target", label: "目標買價",
    onDone: () => { watchData = null; },       // 追蹤清單的判斷也會變
  });
}

function statGrid(items) {
  // 3 張（或 3 的倍數）就排成 3 欄一次排滿，不然會變成「上面兩張、下面孤零零一張」。
  const cols = items.length % 3 === 0 ? 3 : 2;
  return `<div class="statgrid cols-${cols}">${items.map(([l, v, c]) =>
    `<div class="statcell"><div class="l">${esc(l)}</div><div class="v" style="color:${c}">${v}</div></div>`).join("")}</div>`;
}
function statCardGroup(items) {
  return `<div class="statcardwrap"><div class="grid3">${items.map(([l, v, c]) =>
    `<div class="cell"><div class="l">${esc(l)}</div><div class="v" style="color:${c}">${v}</div></div>`).join("")}</div></div>`;
}

function drawChartPoints(points) {
  const wrap = document.getElementById("chartWrap");
  const up = points.length > 1 ? points[points.length - 1].v >= points[0].v : true;
  drawLineChart(wrap, points, {
    color: up ? GREEN : RED,
    fillColor: up ? "rgba(74,154,108,0.10)" : "rgba(194,102,97,0.10)",
    moneyFmt: v => usdOnly(v),
  });
}

async function loadChart(symbol) {
  const wrap = document.getElementById("chartWrap");
  wrap.innerHTML = skeletonBlock(260);
  const { points } = await api(`/chart/${encodeURIComponent(symbol)}?range=${detailRange}`);
  drawChartPoints(points);
}

// ------------------------------------------------------------------
// 👀 追蹤清單
// ------------------------------------------------------------------
let watchOpen = false;

function renderWatchForm() {
  return `<div class="sheet-handle"></div>
    <p class="form-hint">先填代號 → 選填目標買價／備註。</p>
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
    watchData = null;
    await loadWatchData();
    rerenderWatchBody();
    setTimeout(() => {
      watchOpen = false;
      toggleSheet("addWatchPanel", "addWatchBackdrop", false);
    }, 700);
  } catch (err) {
    msgEl.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}
onSeg("submit", val => { if (val === "watch") submitWatch(); });

let watchData = null;
// 追蹤清單預設維持使用者自己拖出來的順序；選了其他排序時，拖曳排序會暫時停用，
// 不然拖完存回去的順序跟畫面上看到的不一樣，會很莫名其妙。
let watchSort = loadPref("watchSort", "custom", ["custom", "gap", "day_pct", "symbol"]);
onSeg("watchsort", val => { watchSort = val; savePref("watchSort", val); rerenderWatchBody(); });

// 現價距離目標買價還有多遠。負數＝已經跌到目標價以下。
// 沒設目標價回 null，排序時一律排到最後面。
function targetGap(w) {
  if (w.target_buy_usd === null || w.target_buy_usd === undefined) return null;
  if (!w.price_usd || !w.target_buy_usd) return null;
  return (w.price_usd - w.target_buy_usd) / w.target_buy_usd;
}

async function loadWatchData() {
  if (!watchData) { watchData = await api("/watchlist"); saveSnap("watchlist", watchData); }
}

function rerenderWatchBody(animate = false) {
  const body = document.getElementById("watchBody");
  if (!body) return;
  if (watchData.empty) {
    body.innerHTML = emptyState("👀", "追蹤清單是空的",
      "點右上角「➕」加入想觀察的股票。") + renderFooter();
    return;
  }
  const rows = [...watchData.rows];
  if (watchSort === "symbol") rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
  else if (watchSort === "day_pct") rows.sort((a, b) => (a.day_pct || 0) - (b.day_pct || 0));
  else if (watchSort === "gap") rows.sort((a, b) => {
    const ga = targetGap(a), gb = targetGap(b);
    if (ga === null && gb === null) return 0;
    if (ga === null) return 1;        // 沒設目標價的排最後
    if (gb === null) return -1;
    return ga - gb;                   // 離目標價最近（或已跌破）的排前面
  });

  const withTarget = rows.filter(w => targetGap(w) !== null).length;
  const reached = rows.filter(w => { const g = targetGap(w); return g !== null && g <= 0; }).length;
  const left = `觀察 · ${rows.length} 檔` +
    (reached ? ` · <b style="color:${GREEN}">🎯 ${reached} 檔到價</b>` : "");
  const canDrag = watchSort === "custom";

  body.innerHTML = segGroup("watchsort", [
    { key: "custom", label: "自訂順序" }, { key: "gap", label: "距目標價" },
    { key: "day_pct", label: "單日漲跌" }, { key: "symbol", label: "代號 A→Z" },
  ], watchSort) +
    `<div style="display:flex;justify-content:space-between;color:#6b7280;font-size:.76rem;padding:0 4px 6px">
      <span>${left}</span><span>現價　·　單日漲跌</span></div>` +
    `<div class="cardgrid">${rows.map((w, i) => watchRowHtml(w, i, animate)).join("")}</div>` +
    `<p class="hint">👆 點看詳細　·　👈 左滑到底移除` +
      (canDrag ? "　·　長按拖曳排序" : "　·　切回「自訂順序」才能拖曳") +
      (withTarget ? "" : "　·　進個股頁可設目標買價") + `</p>` + renderFooter();
  paintSparklines(body);
}

function watchRowHtml(w, idx = 0, animate = false) {
  const gap = targetGap(w);
  // score >= 3 是「可考慮進場」。清單上要一眼看得出現在哪幾檔可以下手，
  // 所以除了標籤之外，再把最關鍵的理由寫在後面 —— 光一句「可考慮進場」
  // 看不出憑什麼，總得知道是因為便宜、趨勢好、還是分析師看好。
  const canBuy = (w.score || 0) >= 3;
  // 理由要壓在一行內 —— 副標換行會讓「可進場」那幾列變成 106px、其他 80px，
  // 排成格線高低不齊很難看。所以只取最關鍵的一個，而且再縮短一次用字。
  const SHORTEN = [
    [/^分析師：/, "分析師看好"], [/^多頭排列.*/, "多頭排列"],
    [/^距目標價\s*([+\-\d]+%).*/, "空間 $1"], [/^RSI\s*(\d+).*/, "RSI $1 偏低"],
    [/^已跌到你的目標買價.*/, "已到目標買價"],
  ];
  const why = (w.reasons || [])
    .filter(r => r.startsWith("🟢") || r.startsWith("🔵"))   // 只留正面訊號
    .map(r => { let t = r.slice(2).trim();
      for (const [re, to] of SHORTEN) if (re.test(t)) return t.replace(re, to);
      return t.split("，")[0]; })
    .slice(0, 1).join("");
  const badge = canBuy
    // 這裡不要用 class="sub" —— 它會跟外層的 .sub 一起吃到 overflow:hidden，
    // 內聯元素加了 overflow 行為會變怪，徽章跟理由會被拆成兩行。
    ? `<b style="color:${GREEN}">可進場</b>${why ? `<span style="color:var(--sub)"> · ${esc(why)}</span>` : ""}`
    : esc(w.label);
  const sub = badge + (gap === null ? "" :
    gap <= 0 ? ` · 🎯 到價 ${usdOnly(w.target_buy_usd)}`
             : ` · 目標 ${usdOnly(w.target_buy_usd)}，差 ${(gap * 100).toFixed(1)}%`);
  const row = stockRowHtml({ symbol: w.symbol, shares: null, weight_pct: null, price_usd: w.price_usd,
    day_pct: w.day_pct, emoji: w.emoji, spark: w.spark, _subHtml: sub }, "watch", idx, animate);
  return `<div class="watch-row-wrap${canBuy ? " can-buy" : ""}" data-symbol="${esc(w.symbol)}">
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
  // 拖曳排序時用「初始位置 + 已交換幾格」算目前應該在的位置，不要每次 touchmove
  // 都呼叫 getBoundingClientRect（那個會強制觸發同步 layout，手指一直動、
  // 一直逼瀏覽器重新排版，長按拖曳排序才會感覺卡卡的）。
  let reorderRowH = 0, reorderTop0 = 0, reorderOffsetIdx = 0;

  function cleanup() {
    clearTimeout(pressTimer);
    if (content) content.classList.remove("dragging");
    if (wrap) {
      wrap.classList.remove("reordering", "swiping");
      wrap.style.zIndex = "";
    }
    wrap = content = null; mode = "idle";
  }

  function enterReorderMode() {
    const r = wrap.getBoundingClientRect();
    grabOffset = startY - (r.top + r.height / 2);
    reorderRowH = r.height;
    reorderTop0 = r.top;
    reorderOffsetIdx = 0;
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
    if (watchSort === "custom") pressTimer = setTimeout(() => {
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
      // 紅色「移除」底層平常是隱藏的（見 .watch-row-delete-bg）：它鋪在整列
      // 底下，列進場時內容是淡入的，紅底就會先整片透出來，看起來像閃一下紅光。
      // 真的開始左滑才顯示。
      if (Math.abs(rawDx) > Math.abs(rawDy) * 1.3) {
        mode = "swipe";
        wrap.classList.add("swiping");
      }
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
      const naturalTop = reorderTop0 + reorderOffsetIdx * reorderRowH;
      wrap.style.transform = `translateY(${draggedCenter - (naturalTop + reorderRowH / 2)}px)`;

      const list = [...parent.children];
      const idx = list.indexOf(wrap);
      const prev = list[idx - 1];
      if (prev && draggedCenter < naturalTop - reorderRowH * 0.5) {
        parent.insertBefore(wrap, prev);
        reorderOffsetIdx -= 1;
      }
      const next = list[idx + 1];
      if (next && draggedCenter > naturalTop + reorderRowH * 1.5) {
        parent.insertBefore(wrap, next.nextSibling);
        reorderOffsetIdx += 1;
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
  const addBtn = `<button class="btn-circle-glass" id="addWatchBtn">+</button>`;
  app.innerHTML = renderHeader("👀 追蹤清單", addBtn) +
    `<div id="watchBody">${skeletonList()}</div>` + renderBottomNav("watch") +
    sheetMarkup("addWatchPanel", "addWatchBackdrop");
  bindHeaderEvents();
  document.getElementById("addWatchBtn").addEventListener("click", () => {
    watchOpen = !watchOpen;
    toggleSheet("addWatchPanel", "addWatchBackdrop", watchOpen);
    if (watchOpen) document.getElementById("addWatchPanel").innerHTML = renderWatchForm();
  });
  document.getElementById("addWatchBackdrop").addEventListener("click", () => {
    watchOpen = false;
    toggleSheet("addWatchPanel", "addWatchBackdrop", false);
  });

  if (!watchData) {
    const snap = loadSnap("watchlist");
    if (snap) {
      watchData = snap.data;
      rerenderWatchBody(true);
      const b = document.getElementById("watchBody");
      if (b) b.insertAdjacentHTML("afterbegin", staleBanner(snap.at));
      watchData = null;
    }
  }

  await loadWatchData();
  rerenderWatchBody(true);
}

// ------------------------------------------------------------------
