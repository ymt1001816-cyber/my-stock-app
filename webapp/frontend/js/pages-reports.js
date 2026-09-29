// ==================================================================
// 統計報表 / 交易復盤 / 每日簡報 / 資產走勢 / 可用資金 / 功能介紹 / 行事曆 / 台股
// 這個檔案由 app.js 拆分而來（原本 2584 行、124KB 的單一檔案）。
// 載入順序：chart.js → core.js → pages-portfolio.js → pages-reports.js → app.js
// ==================================================================

// 📊 統計報表
// ------------------------------------------------------------------
let statsPeriod = "all";
let statsShowN = {};
let monthlyShowN = 5;      // 逐月表格一次顯示幾列
let rankShowN = { gain: 5, loss: 5 };   // 個股損益排行：賺／賠各顯示幾檔
let statsCache = {};

function txCardHtml(t) {
  const logo = logoWrap(t.symbol, 36, 8);
  // history.csv 裡有 92/159 筆的 name 就等於 symbol（買進時 Yahoo 回不到公司名），
  // 照原本的寫法會印成「ARM ARM」。名稱跟代號一樣就只留代號。
  const nameTxt = String(t.name || "").trim();
  const showName = nameTxt && nameTxt.toUpperCase() !== t.symbol.toUpperCase();
  const symBadge = `<span style="background:var(--card2);color:var(--sub);font-size:.72rem;
    font-weight:700;padding:2px 7px;border-radius:6px">${esc(t.symbol)}</span>`;
  const tagColor = { "買進": RED, "配息": ORANGE }[t.type] || GREEN;
  const tag = `<span style="font-weight:700;color:${tagColor}">${esc(t.type)}</span>`;
  const head = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
    <div style="display:flex;align-items:center;gap:10px;min-width:0">${logo}
      <div style="min-width:0"><div class="nm">${tag}　<span class="sub">${t.date}</span></div>
      <div class="sub" style="margin-top:3px;display:flex;align-items:center;gap:6px;min-width:0">
        ${symBadge}${showName ? `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nameTxt)}</span>` : ""}
      </div></div></div>`;

  const cls = { "配息": "div", "買進": "buy" }[t.type] || "sell";
  const shareTxt = t.shares % 1 === 0 ? t.shares : t.shares.toFixed(5);
  let right, footL, chip;

  if (t.type === "配息") {
    // 配息本來沒有 footer，卡片比買進／賣出矮一截，排成格線時高低參差。
    // 補一行說明讓三種版型結構一致。
    right = `<div style="text-align:right;font-weight:800;font-size:1.05rem;color:${GREEN};white-space:nowrap">${mh(t.pl_usd, true)}</div>`;
    footL = "股利入帳";
    chip = "";
  } else if (t.type === "買進") {
    right = `<div style="text-align:right;font-weight:800;font-size:1.05rem;white-space:nowrap">${shareTxt} 股</div>`;
    footL = `成本 ${usdOnly(t.price_usd)}`;
    chip = "";
    if (t.live_price_usd) {
      const gain = (t.live_price_usd - t.price_usd) * t.shares;
      const diffPct = t.price_usd ? (t.live_price_usd - t.price_usd) / t.price_usd * 100 : 0;
      const gc = colorOf(gain);
      footL += `　現價 ${usdOnly(t.live_price_usd)}`;
      chip = `<span class="chip" style="color:${gc};background:${gc}1c">${gain >= 0 ? "▲" : "▼"} ${mh(gain, true)}（${diffPct >= 0 ? "+" : ""}${diffPct.toFixed(1)}%）</span>`;
    }
  } else {
    const feeTax = t.fee + t.tax;
    const cc = colorOf(t.pl_usd);
    right = `<div style="text-align:right;font-weight:800;font-size:1.05rem;white-space:nowrap">${shareTxt} 股</div>`;
    footL = `@ ${usdOnly(t.price_usd)}${feeTax ? `（費稅 ${usdOnly(feeTax)}）` : ""}`;
    chip = `<span class="chip" style="color:${cc};background:${cc}1c">${mh(t.pl_usd, true)}（${t.pl_pct >= 0 ? "+" : ""}${t.pl_pct.toFixed(1)}%）</span>`;
  }

  return `<div class="tcard ${cls}" style="display:block">${head}${right}</div>
    <div class="tx-foot"><span class="sub">${footL}</span>${chip}</div></div>`;
}

async function loadStats(period) {
  if (!statsCache[period]) statsCache[period] = await api(`/stats?period=${period}`);
  return statsCache[period];
}

function rerenderStatsBody() {
  const body = document.getElementById("statsRest");
  const s = statsCache[statsPeriod];
  if (!s || !body) return;
  const periodLabel = { all: "全部", month: "當月", ytd: "今年", "90d": "近 90 天", custom: "自訂" }[statsPeriod];
  // 報酬率原本塞在副標裡，變成「當月　·　40 筆交易　·　報酬率 +16.13%」一長串。
  // 三格區間時每格只有 345px，三件事擠一行根本讀不出來。改成數值旁邊的 chip，
  // 跟 App 其他地方顯示百分比的做法一致，也更好掃。
  const rpctChip = s.range_pl_pct === null ? "" :
    (c => `<span class="chip" style="background:${c}17;color:${c};margin-left:8px;vertical-align:middle">`
        + `${s.range_pl_pct >= 0 ? "+" : ""}${s.range_pl_pct.toFixed(2)}%</span>`)(colorOf(s.range_pl_pct));
  // 勝率：選「全部」時上面兩格會是同一個數字（區間＝全部歷史），兩張大卡顯示
  // 一樣的值很浪費。中間補一格勝率，任何區間都有資訊量。
  const sells = s.transactions.filter(t => t.type === "賣出");
  const wins = sells.filter(t => t.pl_usd > 0).length;
  const winRate = sells.length ? (wins / sells.length * 100) : null;
  const winCell = winRate === null ? "" : `
    <div class="row"><div>
      <div class="l">勝率</div>
      <div class="v" style="color:${winRate >= 50 ? GREEN : RED}">${winRate.toFixed(0)}%</div>
      <div class="s">${wins} 賺　·　${sells.length - wins} 賠（共 ${sells.length} 筆賣出）</div>
    </div></div>`;
  // 選「全部」時，「區間已實現損益」與「累計已實現損益」本來就是同一個數字，
  // 原本兩格都印出來，等於同一個值寫兩次 —— 這是這一區看起來又擠又怪的主因。
  // 全部區間時只留兩格（已實現損益＋勝率），格子自然變寬、也不再重複。
  const isAll = statsPeriod === "all";
  const totalCell = isAll ? "" : `
    <div class="row"><div>
      <div class="l">累計已實現損益</div>
      <div class="v" style="color:${colorOf(s.total_pl_all_usd)}">${mh(s.total_pl_all_usd, true)}</div>
      <div class="s">全部歷史</div>
    </div></div>`;
  const summary = `<div class="statsummary">
    <div class="row"><div>
      <div class="l">${isAll ? "已實現損益" : `${periodLabel}已實現損益`}</div>
      <div class="v" style="color:${colorOf(s.range_pl_usd)}">${mh(s.range_pl_usd, true)}${rpctChip}</div>
            <div class="s">${s.range_count} 筆交易</div>
    </div></div>
    ${winCell}
    ${totalCell}</div>`;

  // 逐月已實現損益：看「每個月各賺多少」的節奏，不跟著上面的區間篩選跑。
  const m = s.monthly || [];
  let monthlyHtml = "";
  if (m.length) {
    const yr = String(new Date().getFullYear());
    const thisYear = m.filter(x => x.ym.startsWith(yr));
    const yrPl = thisYear.reduce((a, x) => a + x.pl_usd, 0);
    const yrDiv = thisYear.reduce((a, x) => a + x.div_usd, 0);
    const yrCost = thisYear.reduce((a, x) => a + x.cost_usd, 0);
    const yrPct = yrCost ? ` （${yrPl >= 0 ? "+" : ""}${(yrPl / yrCost * 100).toFixed(2)}%）` : "";
    // 表格預設只列最近 5 個月 —— 14 個月一次全攤開太長，統計頁一進來就被
    // 表格佔掉一整屏。上面的長條圖維持顯示全部月份，趨勢不受影響。
    const all = m.slice().reverse();
    const mShowN = monthlyShowN || 5;
    const rows = all.slice(0, mShowN).map(x => {
      const pct = x.pl_pct === null ? "—" : `${x.pl_pct >= 0 ? "+" : ""}${x.pl_pct.toFixed(2)}%`;
      return `<tr>
        <td>${esc(x.ym)}</td>
        <td class="n">${x.sell_count}</td>
        <td class="n" style="color:${colorOf(x.pl_usd)};font-weight:800">${mh(x.pl_usd, true)}</td>
        <td class="n" style="color:${colorOf(x.pl_usd)}">${pct}</td>
        <td class="n">${x.div_usd ? mh(x.div_usd) : "—"}</td>
      </tr>`;
    }).join("");
    monthlyHtml = sec("📅 逐月已實現損益") +
      `<div class="mcard">
         <div class="myear">${yr} 年累計
           <b style="color:${colorOf(yrPl)}">${mh(yrPl, true)}${yrPct}</b>
           ${yrDiv ? `<span class="sub">　配息 ${mh(yrDiv)}</span>` : ""}
         </div>
         <div class="plotly-chart-wrap" id="monthlyChart"></div>
         <div class="mtable-wrap"><table class="mtable">
           <thead><tr><th>月份</th><th class="n">賣出</th><th class="n">已實現</th>
             <th class="n">報酬率</th><th class="n">配息</th></tr></thead>
           <tbody>${rows}</tbody>
         </table></div>
         ${all.length > mShowN
           ? `<button type="button" class="btn-more" data-seg-btn="monthly-more" data-value="1">
                顯示更多（還有 ${all.length - mShowN} 個月）</button>`
           : (all.length > 5
             ? `<button type="button" class="btn-more" data-seg-btn="monthly-less" data-value="1">收合</button>`
             : "")}
       </div>`;
  }

  const showN = statsShowN[statsPeriod] || 10;
  const shown = s.transactions.slice(0, showN);
  const txHtml = shown.length
    ? `<div class="cardgrid">${shown.map(txCardHtml).join("")}</div>`
    : "<i>此區間沒有交易。</i>";
  const moreBtn = showN < s.transactions.length
    ? `<button type="button" class="btn-more" data-seg-btn="stats-more" data-value="1">查看更多（還有 ${s.transactions.length - showN} 筆）</button>`
    : "";

  // 從沒賣過的股票在「損益排行」裡一律是 0，排在中間把正負兩端隔開，純粹是雜訊。
  // 原本 35 檔一次全排出來（12 列），而且賺的賠的長得一模一樣、只有數字顏色不同，
  // 要掃過整片才知道哪些是賠的。改成賺／賠兩區分開，各自預設只列 5 檔。
  const ranked = s.ranking.filter(r => Math.abs(r.pl_usd) >= 0.005);
  const zeroN = s.ranking.length - ranked.length;
  const gainers = ranked.filter(r => r.pl_usd > 0).sort((a, b) => b.pl_usd - a.pl_usd);
  const losers  = ranked.filter(r => r.pl_usd < 0).sort((a, b) => a.pl_usd - b.pl_usd);

  const rankRow = r => `<div class="hitem rank-row ${r.pl_usd >= 0 ? "up" : "down"}">
    <div style="display:flex;align-items:center;gap:10px;min-width:0">
      ${logoWrap(r.symbol, 30, 7)}<b>${esc(r.symbol)}</b></div>
    <b style="color:${colorOf(r.pl_usd)};white-space:nowrap">${mh(r.pl_usd, true)}</b></div>`;

  const rankBlock = (list, label, key, showN) => {
    if (!list.length) return "";
    const shown = list.slice(0, showN);
    const more = list.length - shown.length;
    return `<div class="ranklabel">${label}<span>${list.length} 檔</span></div>` +
      `<div class="cardgrid">${shown.map(rankRow).join("")}</div>` +
      (more > 0
        ? `<button type="button" class="btn-more" data-seg-btn="${key}" data-value="1">顯示更多（還有 ${more} 檔）</button>`
        : (showN > 5 ? `<button type="button" class="btn-more" data-seg-btn="${key}-less" data-value="1">收合</button>` : ""));
  };

  const rankHtml =
    rankBlock(gainers, "📈 賺錢的", "rank-gain", rankShowN.gain) +
    rankBlock(losers,  "📉 賠錢的", "rank-loss", rankShowN.loss) +
    (zeroN ? `<p class="hint">（另有 ${zeroN} 檔尚未賣出過，沒有已實現損益）</p>` : "");

  // 復盤是另一個角度（單筆交易的成敗），跟這一頁的「區間彙總」不一樣，
  // 放成獨立子頁，這裡只留一條入口，不讓統計頁再長下去。
  const reviewStrip = `<a href="?nav=stats&review=1" class="cashstrip">
    <span class="l">🔍 交易復盤</span>
    <span class="v">最賺／最賠的單筆、報酬率分布、逐年勝率</span>
    <span class="arrow">›</span></a>`;

  body.innerHTML = summary + reviewStrip + monthlyHtml +
    sec(`💳 交易明細（${s.range_count} 筆）`) + txHtml + moreBtn +
    sec("🏆 個股損益排行（全部歷史）") + rankHtml + renderFooter();

  const mc = document.getElementById("monthlyChart");
  if (mc && m.length) {
    // 後端只回「有賣出的月份」，中間沒交易的月份整個不見。等距畫成長條圖等於
    // 在騙人 —— 2025-05 跟 2025-10 會並排在一起，看起來像連續兩個月。這裡把
    // 空月份補成 0 補回去，X 軸才是真的時間軸。沒賣出的月份已實現損益本來就是 0。
    const filled = [];
    const [y0, m0] = m[0].ym.split("-").map(Number);
    const [y1, m1] = m[m.length - 1].ym.split("-").map(Number);
    const have = new Map(m.map(x => [x.ym, x.pl_usd]));
    for (let k = y0 * 12 + (m0 - 1); k <= y1 * 12 + (m1 - 1); k++) {
      const ym = `${Math.floor(k / 12)}-${String(k % 12 + 1).padStart(2, "0")}`;
      filled.push({ t: ym, v: have.get(ym) || 0 });
    }
    drawBarChart(mc, filled, {
      posColor: GREEN, negColor: RED, moneyFmt: v => mh(v),
      labelFmt: ym => `${ym.slice(0, 4)} 年 ${+ym.slice(5)} 月`,
      // 年份換掉的那格標年份、其餘只標月份。不能用「月份==01」來判斷 ——
      // 一月完全沒交易的年份（例如 2026）就會整年找不到年份標記。
      tickFmt: (ym, i) => (i === 0 || ym.slice(0, 4) !== filled[i - 1].t.slice(0, 4)
        ? ym.slice(0, 4) : `${+ym.slice(5)}月`),
    });
  }
}

onSeg("rank-gain", () => { rankShowN.gain += 6; rerenderStatsBody(); });
onSeg("rank-gain-less", () => { rankShowN.gain = 5; rerenderStatsBody(); });
onSeg("rank-loss", () => { rankShowN.loss += 6; rerenderStatsBody(); });
onSeg("rank-loss-less", () => { rankShowN.loss = 5; rerenderStatsBody(); });
onSeg("monthly-more", () => { monthlyShowN += 6; rerenderStatsBody(); });
onSeg("monthly-less", () => { monthlyShowN = 5; rerenderStatsBody(); });
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
    body.innerHTML = emptyState("📊", "尚無歷史交易資料",
      "到「📦 我的持股」新增一筆賣出或配息紀錄。") + renderFooter();
    return;
  }
  body.innerHTML = sec("🔎 選擇區間") + segGroup("period", [
    { key: "month", label: "當月" }, { key: "90d", label: "近 90 天" },
    { key: "ytd", label: "今年" }, { key: "all", label: "全部" },
  ], statsPeriod) + `<div id="statsRest"></div>`;
  rerenderStatsBody();
}

// ------------------------------------------------------------------
// 頁尾：每頁共用的說明文字
// ------------------------------------------------------------------
// 拿掉了原本的「🔄 更新」按鈕：資料已經有背景排程每 10 分鐘自動保持新鮮，
// 這顆按鈕唯一的效果只是把剛預熱好的快取整個清空，點下去反而讓 App 變慢。
// 空白頁（還沒有資料時）統一用大 icon + 標題 + 提示文字，取代原本乾乾一行純文字。
function emptyState(icon, title, hint) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    ${hint ? `<div class="empty-state-hint">${hint}</div>` : ""}
  </div>`;
}

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
  app.innerHTML = subHeader("📈 資產走勢") +
    `<div id="trendBody">${skeletonWithHint(240, "計算歷史市值中…（約 10-20 秒）")}</div>` +
    renderBottomNav("home");
  document.getElementById("backBtn").addEventListener("click", () => goBack("?nav=home"));

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
  sec("💹 每期市值走勢") + `<div class="plotly-chart-wrap" id="trendChart"></div>` +
  sec(`📊 每${trendGran}變化`) + `<div class="plotly-chart-wrap" id="trendBarChart"></div>` +
  `<p class="hint">※ 以目前持股股數 × 歷史股價回推，僅供參考；未計入期間買賣變動。</p>` + renderFooter();

  const up = t.delta_usd >= 0;
  drawLineChart(document.getElementById("trendChart"), t.series, {
    color: up ? GREEN : RED,
    fillColor: up ? "rgba(74,154,108,0.10)" : "rgba(194,102,97,0.10)",
    moneyFmt: v => mh(v),
  });
  drawBarChart(document.getElementById("trendBarChart"), t.changes, {
    posColor: GREEN, negColor: RED, moneyFmt: v => mh(v),
    tickFmt: ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()}`; },
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
  app.innerHTML = subHeader("💵 設定可用資金") +
    `<div class="form-field" style="margin-top:14px">
      <label>可用資金（USD，可買入的現金）</label>
      <input type="number" id="f_cash" min="0" step="100" value="${state.cash}">
    </div>
    <button type="button" class="btn-submit" data-seg-btn="save-cash" data-value="1">儲存</button>
    <div id="cashMsg"></div>` + renderBottomNav("home");
  document.getElementById("backBtn").addEventListener("click", () => goBack("?nav=home"));
}

onSeg("save-cash", async () => {
  const val = parseFloat(document.getElementById("f_cash").value || 0);
  await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cash_usd: val }) });
  document.getElementById("cashMsg").innerHTML = `<div class="form-success">已儲存！</div>`;
});

// ------------------------------------------------------------------
// ℹ️ 功能介紹（整理全部功能給自己/朋友試用時快速瀏覽，不是給一般使用者的正式導覽）
// ------------------------------------------------------------------
const ABOUT_SECTIONS = [
  { ic: "🏠", title: "投資總覽", desc: "淨資產（持股＋現金）、今日／未實現損益、資產配置圓餅圖、需要注意的警示——停損、走勢偏弱、單日大漲跌、單一持股佔比過高。" },
  { ic: "📦", title: "我的持股", desc: "買進／賣出／配息紀錄，自動算加權平均成本、已實現損益；每列旁邊有近一個月走勢 sparkline，不用點進去就看得出趨勢。" },
  { ic: "🔎", title: "個股詳細頁", desc: "即時報價、盤前盤後、走勢圖（當天～1年）、相關新聞；RSI／MACD／成交量技術訊號、分析師目標價與評等、機械式「續抱還是賣出」判斷；左右滑動可以切到清單裡的上一檔／下一檔。" },
  { ic: "👀", title: "追蹤清單", desc: "設定目標買價，機械式判斷「值不值得買」；拖曳排序、左滑移除。" },
  { ic: "📊", title: "統計報表", desc: "依區間（當月／近90天／今年／全部／自訂）看已實現損益、逐筆交易明細、個股損益排行。" },
  { ic: "📰", title: "每日簡報", desc: "一鍵產生：大盤指數＋新聞、持股大幅漲跌原因、追蹤清單重點、組合摘要（含今日損益）。" },
  { ic: "📅", title: "股利／財報行事曆", desc: "彙總持股＋追蹤清單所有股票的財報／除息／配息日期，即將到來的優先顯示，一個月內的過去事件淡化顯示。" },
  { ic: "📈", title: "資產走勢", desc: "日／月／年三種粒度的歷史資產走勢圖，用目前股數回推歷史市值（僅供參考）。" },
  { ic: "💵", title: "現金管理與幣別切換", desc: "記錄可動用現金，畫面隨時可以在 USD／TWD 間切換顯示。" },
];

async function renderAbout() {
  const app = document.getElementById("app");
  const cards = ABOUT_SECTIONS.map(s => `<div class="tcard" style="display:block">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="font-size:1.3rem">${s.ic}</span><b style="font-size:1rem">${esc(s.title)}</b>
    </div>
    <div class="sub" style="line-height:1.5">${esc(s.desc)}</div>
  </div>`).join("");
  app.innerHTML = subHeader("ℹ️ 功能介紹") +
    `<p class="hint" style="margin:8px 2px 16px">這個 App 目前有這些功能，逛一輪就知道能幫你做什麼。</p>
    ${cards}
    <p class="hint" style="text-align:center;margin-top:16px">※ 所有判斷都是機械式規則計算，不構成投資建議。</p>` +
    renderBottomNav("home");
  document.getElementById("backBtn").addEventListener("click", () => goBack("?nav=home"));
}

// ------------------------------------------------------------------
// 📅 股利／財報行事曆（持股＋追蹤清單彙總，依日期排序）
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 🔍 交易復盤：只看賣出，那才是結算過的一筆
// ------------------------------------------------------------------
let reviewData = null;

function reviewRow(r, rank) {
  const c = colorOf(r.pl_usd);
  return `<div class="posblock" style="border-left:5px solid ${c}">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <span style="min-width:0"><b>${esc(r.symbol)}</b>
        <span class="sub">　${esc(r.date)}</span></span>
      <span style="text-align:right;white-space:nowrap">
        <b style="color:${c}">${mh(r.pl_usd, true)}</b>
        <span class="chip" style="background:${c}17;color:${c};margin-left:6px">${pctStr(r.pl_pct)}</span>
      </span>
    </div>
  </div>`;
}

async function renderReview() {
  const app = document.getElementById("app");
  app.innerHTML = subHeader("🔍 交易復盤") +
    `<div id="reviewBody">${skeletonList()}</div>` + renderBottomNav("stats");
  document.getElementById("backBtn").addEventListener("click", () => goBack("?nav=stats"));

  if (!reviewData) reviewData = await api("/review");
  const d = reviewData;
  const body = document.getElementById("reviewBody");
  if (d.empty) {
    body.innerHTML = emptyState("🔍", "還沒有賣出紀錄",
      "賣出之後才有結算過的損益可以復盤。") + renderFooter();
    return;
  }

  const o = d.overall;
  // 盈虧比跟勝率是兩件事：勝率低但盈虧比高一樣會賺，反過來也成立。
  // 兩個一起看才知道賺錢是靠「常常對」還是靠「對的時候賺很大」。
  // 五個指標排成同一列。原本拆成「3 張 + 2 張」兩排，但 .statgrid.cols-3 在桌面版
  // 有 max-width:580px（那是為了個股詳細頁的小卡設的），three 張會擠在左邊、
  // 右邊空一大塊，跟下面滿寬的兩張並排看起來很不整齊。
  const head = statGrid([
    ["勝率", `${o.win_rate}%`, o.win_rate >= 50 ? GREEN : RED],
    ["盈虧比", o.profit_factor === null ? "—" : `${o.profit_factor}`, o.profit_factor >= 1 ? GREEN : RED],
    ["已結算", `${o.count} 筆`, GREY],
    // 平均獲利與平均虧損本來就是一對，併成一格。5 格在 1024 寬會排成
    // 「4 + 1」，第二列孤零零一格；4 格則兩個寬度都剛好一列排滿。
    ["平均每筆", `<span style="color:${GREEN}">${mh(o.avg_win, true)}</span>`
      + ` <span style="color:var(--sub);font-weight:600">/</span> `
      + `<span style="color:${RED}">${mh(o.avg_loss, true)}</span>`, GREY],
  ]) + `<p class="hint">盈虧比＝總獲利 ÷ 總虧損。大於 1 代表賺的比賠的多，
        跟勝率是兩回事 —— 勝率低但盈虧比高一樣能賺錢，反過來也成立。</p>`;

  const avg = "";

  // 報酬率分布：用橫條長度表示筆數，不畫圖表，純 CSS 寬度，沒有動畫
  const maxN = Math.max(...d.distribution.map(x => x.count), 1);
  const dist = `<div class="mcard" style="padding:14px 16px">` +
    d.distribution.map(x => {
      const neg = x.label.startsWith("<") || x.label.startsWith("-");
      const c = x.count === 0 ? "var(--line)" : (neg ? RED : GREEN);
      return `<div style="display:flex;align-items:center;gap:10px;margin:5px 0">
        <span class="sub" style="flex:0 0 76px;text-align:right">${esc(x.label)}</span>
        <span style="flex:1 1 auto;height:14px;background:var(--card2);border-radius:99px;overflow:hidden">
          <span style="display:block;height:100%;width:${x.count / maxN * 100}%;background:${c};border-radius:99px"></span>
        </span>
        <span class="sub" style="flex:0 0 34px">${x.count}</span>
      </div>`;
    }).join("") + `</div>`;

  const years = `<div class="mtable-wrap"><table class="mtable">
    <thead><tr><th>年度</th><th class="n">筆數</th><th class="n">勝率</th><th class="n">已實現</th></tr></thead>
    <tbody>${d.by_year.map(y => `<tr>
      <td>${esc(y.year)}</td><td class="n">${y.count}</td>
      <td class="n" style="color:${y.win_rate >= 50 ? GREEN : RED};font-weight:800">${y.win_rate}%</td>
      <td class="n" style="color:${colorOf(y.pl_usd)};font-weight:800">${mh(y.pl_usd, true)}</td>
    </tr>`).join("")}</tbody></table></div>`;

  body.innerHTML =
    head + avg +
    sec("🏅 最賺的 5 筆") + `<div class="cardgrid">${d.best.map(reviewRow).join("")}</div>` +
    sec("🩹 最賠的 5 筆") + `<div class="cardgrid">${d.worst.map(reviewRow).join("")}</div>` +
    sec("📐 報酬率分布") + dist +
    sec("📆 逐年表現") + years +
    `<p class="hint">只統計「賣出」—— 買進還沒有結果，配息不是一次買賣的成敗。</p>` +
    renderFooter();
}

async function renderCalendar() {
  const app = document.getElementById("app");
  app.innerHTML = subHeader("📅 股利／財報行事曆") +
    `<div id="calBody">${skeletonList()}</div>` + renderBottomNav("home");
  document.getElementById("backBtn").addEventListener("click", () => goBack("?nav=home"));

  const c = await api("/calendar");
  const body = document.getElementById("calBody");
  if (c.empty) {
    body.innerHTML = emptyState("📅", "查不到財報／除息／配息日期",
      "持股與追蹤清單目前都沒有可以顯示的日期資料。") + renderFooter();
    return;
  }
  const eventRow = (e, upcoming) => {
    const tagColor = e.kind === "held" ? GREEN : GREY;
    return `<div class="posblock" style="border-left:5px solid ${upcoming ? tagColor : "var(--line)"};
      ${upcoming ? "" : "opacity:.6"}">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <span><b>${esc(e.symbol)}</b> <span style="color:#6b7280">${esc(e.label)}</span></span>
        <span style="color:${upcoming ? "var(--ink)" : "#6b7280"};font-weight:${upcoming ? 800 : 400}">${esc(e.date)}</span>
      </div>
      <div style="color:#6b7280;font-size:.85rem">${esc(e.name)}　·　${e.kind === "held" ? "持股中" : "追蹤清單"}</div>
    </div>`;
  };
  // 使用者比較在乎「快來了」的事件，已經過去的只是留個一個月內的參考，
  // 分成兩段、即將到來的排前面用全彩強調，過去的淡化縮到後面。
  const upcoming = c.events.filter(e => e.date >= c.today);
  const past = c.events.filter(e => e.date < c.today).reverse();
  let html = `<p class="hint">今天：${esc(c.today)}　·　🟢 持股中　⚪ 追蹤清單</p>`;
  html += sec(`🔜 即將到來（${upcoming.length}）`);
  html += upcoming.length
    ? `<div class="cardgrid">${upcoming.map(e => eventRow(e, true)).join("")}</div>`
    : `<p class="hint">近期沒有排定的財報／除息／配息日期。</p>`;
  if (past.length) {
    html += sec(`🕓 一個月內已發生（${past.length}）`);
    html += `<div class="cardgrid">${past.map(e => eventRow(e, false)).join("")}</div>`;
  }
  body.innerHTML = html + renderFooter();
}

// ------------------------------------------------------------------
// 🇹🇼 台股（獨立於美股持股，報價本身是台幣，不套用匯率換算）
// ------------------------------------------------------------------
let twData = null;
let twHistData = null;
let twOpen = false;
let twEditSymbol = null;

function twMoney(v, sign = false) {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const neg = v < 0 ? "-" : (sign && v > 0 ? "+" : "");
  return `${neg}NT$${s}`;
}

async function renderTwHoldings() {
  const app = document.getElementById("app");
  const addBtn = `<button class="btn-circle-glass" id="twAddBtn">+</button>`;
  app.innerHTML = renderHeader("🇹🇼 台股", addBtn) +
    `<p class="hint">獨立記錄台股/ETF 持倉，報價本身就是台幣，不會套用美金匯率換算。</p>
     <div id="twBody">${skeletonList()}</div>` + renderBottomNav("tw") +
    sheetMarkup("twPanel", "twBackdrop");
  bindHeaderEvents();
  document.getElementById("twAddBtn").addEventListener("click", () => {
    twEditSymbol = null;
    twOpen = !twOpen;
    toggleSheet("twPanel", "twBackdrop", twOpen);
    if (twOpen) rerenderTwPanel();
  });
  document.getElementById("twBackdrop").addEventListener("click", () => {
    twOpen = false;
    toggleSheet("twPanel", "twBackdrop", false);
  });

  await loadTwData();
  rerenderTwBody();
}

async function loadTwData(force = false) {
  if (force || !twData) {
    [twData, twHistData] = await Promise.all([api("/tw/holdings"), api("/tw/history")]);
  }
}

function rerenderTwBody(animate = false) {
  const body = document.getElementById("twBody");
  if (!body) return;

  let html;
  if (twData.empty) {
    html = emptyState("🇹🇼", "還沒有台股持股", "點右上角「➕」新增第一檔。");
  } else {
    const rows = twData.rows;
    const plColor = colorOfTw(twData.total_pl);
    const inclColor = colorOfTw(twData.total_pl_incl_div);
    const summary = `<div class="wcard sm" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:.86rem;color:var(--sub)">
        <span>總市值</span><span>${twMoney(twData.total_market_value)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.86rem;color:var(--sub);margin-top:4px">
        <span>總成本</span><span>${twMoney(twData.total_cost)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <span style="font-weight:700">未實現損益</span>
        <span style="font-weight:800;color:${plColor}">${twMoney(twData.total_pl, true)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:.86rem;color:var(--sub);margin-top:4px">
        <span>損益（含息）</span><span style="color:${inclColor}">${twMoney(twData.total_pl_incl_div, true)}</span>
      </div>
    </div>`;
    html = summary +
      `<div style="display:flex;justify-content:space-between;color:#6b7280;font-size:.76rem;padding:0 4px 6px">
        <span>持倉 · ${rows.length} 檔</span><span>損益金額　·　報酬率</span></div>` +
      `<div class="cardgrid">${rows.map((r, i) => twRowHtml(r, i, animate)).join("")}</div>` +
      `<p class="hint">👆 點任一列可編輯或移除</p>`;
  }

  html += `<hr style="margin:20px 0 12px"><h4>📜 已實現損益</h4>`;
  if (twHistData.empty) {
    html += `<p class="hint">還沒有台股已賣出的紀錄。</p>`;
  } else {
    const hColor = colorOfTw(twHistData.total_pl);
    html += `<div style="display:flex;justify-content:space-between;margin-bottom:8px">
      <span style="font-weight:700">合計已實現損益</span>
      <span style="font-weight:800;color:${hColor}">${twMoney(twHistData.total_pl, true)}</span>
    </div>`;
    html += `<div class="cardgrid">${twHistData.rows.map(twHistRowHtml).join("")}</div>`;
  }
  body.innerHTML = html + renderFooter();
}

function twHistRowHtml(r) {
  const plColor = colorOfTw(r.pl);
  const priceInfo = r.buy_price && r.sell_price
    ? `NT$${r.buy_price.toFixed(2)} → NT$${r.sell_price.toFixed(2)}　·　` : "";
  return `<div class="posblock" style="margin-bottom:8px">
    <div style="display:flex;justify-content:space-between;gap:8px">
      <span><b>${esc(r.name)}</b> <span style="color:var(--sub);font-size:.85em">${esc(r.symbol)}</span></span>
      <span style="font-weight:800;color:${plColor}">${twMoney(r.pl, true)}（${pctStr(r.pl_pct)}）</span>
    </div>
    <div style="color:var(--sub);font-size:.85rem">${esc(r.date)}　·　${priceInfo}${r.shares % 1 === 0 ? r.shares : r.shares.toFixed(2)} 股</div>
  </div>`;
}

function twRowHtml(r, idx = 0, animate = false) {
  const plColor = colorOfTw(r.pl);
  const delay = Math.min(idx * 28, 300);
  const enterCls = animate ? " row-enter" : "";
  const enterStyle = animate ? ` style="animation-delay:${delay}ms"` : "";
  return `<a class="hlink${enterCls}"${enterStyle} href="javascript:void(0)" data-tw-edit="${esc(r.symbol)}">
    <div class="hitem">
      <div class="hitem-left">
        <div class="hitem-name">
          <div class="nm">${esc(r.name)} <span style="color:var(--sub);font-weight:400;font-size:.82em">${esc(r.symbol)}</span></div>
          <div class="sub">${r.shares % 1 === 0 ? r.shares : r.shares.toFixed(2)} 股 · 均價 NT$${r.avg_cost.toFixed(2)}</div>
        </div>
      </div>
      <div class="hitem-right">
        <div class="nm" style="color:${plColor}">${twMoney(r.pl, true)}</div>
        <div class="chip" style="background:${plColor}17;color:${plColor}">${pctStr(r.pl_pct)}</div>
      </div>
    </div>
  </a>`;
}

document.addEventListener("click", e => {
  const el = e.target.closest("[data-tw-edit]");
  if (!el) return;
  twEditSymbol = el.dataset.twEdit;
  twOpen = true;
  toggleSheet("twPanel", "twBackdrop", true);
  rerenderTwPanel();
});

function rerenderTwPanel() {
  const panel = document.getElementById("twPanel");
  if (panel) panel.innerHTML = renderTwForm();
}

function renderTwForm() {
  const editing = !!twEditSymbol;
  const r = editing ? twData.rows.find(x => x.symbol === twEditSymbol) : null;
  return `<div class="sheet-handle"></div>
    <p class="form-hint">${editing ? "編輯" : "新增"}台股持股：直接填目前的總股數與均價（覆蓋式，不是逐筆買賣紀錄）。</p>
    <div class="form-field"><label>代號（如 006208）</label>
      <input type="text" id="f_tw_symbol" style="text-transform:uppercase" value="${editing ? esc(r.symbol) : ""}" ${editing ? "disabled" : ""}></div>
    <div class="form-field"><label>名稱</label><input type="text" id="f_tw_name" value="${editing ? esc(r.name) : ""}"></div>
    <div class="form-row">
      <div class="form-field"><label>總股數</label><input type="number" id="f_tw_shares" min="0" step="any" value="${editing ? r.shares : ""}"></div>
      <div class="form-field"><label>均價 (NT$)</label><input type="number" id="f_tw_avg" min="0" step="any" value="${editing ? r.avg_cost : ""}"></div>
    </div>
    <div class="form-field"><label>累積配息 (NT$，選填)</label><input type="number" id="f_tw_div" min="0" step="any" value="${editing ? r.accum_div : 0}"></div>
    <button type="button" class="btn-submit" data-seg-btn="tw-submit" data-value="save">💾 儲存</button>
    ${editing ? `<button type="button" class="btn-submit" style="background:${RED};margin-top:8px" data-seg-btn="tw-submit" data-value="delete">🗑 移除此檔</button>` : ""}
    <div id="twFormMsg"></div>`;
}

async function submitTw(action) {
  const msgEl = document.getElementById("twFormMsg");
  msgEl.innerHTML = "";
  try {
    let j;
    if (action === "delete") {
      const res = await fetch(`/api/tw/holdings/${encodeURIComponent(twEditSymbol)}`, { method: "DELETE" });
      j = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(j, "移除失敗"));
    } else {
      const payload = {
        symbol: (twEditSymbol || document.getElementById("f_tw_symbol").value).toUpperCase().trim(),
        name: document.getElementById("f_tw_name").value.trim(),
        shares: parseFloat(document.getElementById("f_tw_shares").value || 0),
        avg_cost: parseFloat(document.getElementById("f_tw_avg").value || 0),
        accum_div: parseFloat(document.getElementById("f_tw_div").value || 0),
      };
      const res = await fetch("/api/tw/holdings", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      j = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(j, "送出失敗"));
    }
    msgEl.innerHTML = `<div class="form-success">✅ ${esc(j.message)}</div>`;
    await loadTwData(true);
    setTimeout(() => {
      twOpen = false;
      toggleSheet("twPanel", "twBackdrop", false);
      rerenderTwBody();
    }, 700);
  } catch (err) {
    msgEl.innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
  }
}

onSeg("tw-submit", val => submitTw(val));

// ------------------------------------------------------------------
