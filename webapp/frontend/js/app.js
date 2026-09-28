// ==================================================================
// 路由、手勢、啟動
// 這個檔案由 app.js 拆分而來（原本 2584 行、124KB 的單一檔案）。
// 載入順序：chart.js → core.js → pages-portfolio.js → pages-reports.js → app.js
// ==================================================================

// 尚未搬遷完成的頁面：先顯示佔位訊息
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 路由
// ------------------------------------------------------------------
let configLoaded = false;

// 第一頁畫完之後，趁使用者在看畫面的空檔，把其他頁的資料先抓回來放著。
// 每一頁本來就有各自的記憶體快取，預抓完之後點過去就是瞬間顯示，
// 不必再等一次往返 —— 線上版冷啟動時單支端點要 5~6 秒，差別非常明顯。
//
// 刻意「一支一支依序抓」而不是全部並行：後端在 Render 免費方案上資源很少，
// 一次打六支會拖慢使用者當下正在看的那一頁。每支之間留一點空檔同理。
// 全部失敗都吞掉 —— 這只是預熱，真正要用的時候各頁自己會再抓一次。
let prefetchStarted = false;
function prefetchOtherPages() {
  if (prefetchStarted) return;
  prefetchStarted = true;
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
  idle(async () => {
    const jobs = [
      () => loadSummary(),
      () => loadHoldData(),
      () => loadWatchData(),
      () => loadSymbols(),
      () => loadStats("all"),
      () => loadTwData(),
    ];
    for (const job of jobs) {
      try { await job(); } catch { /* 預熱失敗無所謂 */ }
      await new Promise(r => setTimeout(r, 250));
    }
  }, { timeout: 3000 });
}

// 换頁不用整頁重新載入：只換網址列＋重繪內容，省掉重新下載/解析整份 HTML/CSS/JS
// 跟每次都重抓一次 /api/config 的開銷，點哪裡都會快很多。
// 捲動位置一直沒人管，所以「點進去／返回」的位置是瀏覽器自己亂猜的：
//   · pushState 不會重設捲動 → 點進個股詳細頁時，會沿用清單頁的位置，
//     一進去就停在頁面中段，看起來像排版跑掉。
//   · 按返回時 popstate 立刻觸發，但內容是之後才非同步重繪的，瀏覽器的自動
//     還原抓到的是「舊頁面的高度」，還原到的位置自然是錯的。
//   · 兩頁高度差多少會決定它是沿用、被截斷還是歸零 —— 這就是為什麼「有些地方」
//     會跑、有些不會。
// 改成自己管：往前進一律回到最上面，按返回則回到離開那一頁時的位置。
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

// key 用完整網址；同一頁不同股票（?nav=hold&sym=VOO）各自記各自的。
const scrollMemo = new Map();

// 「←」返回鈕原本是用 navigateTo 前進到上一層，那在瀏覽器眼中是「往前一步」，
// 所以會捲到最上面 —— 但使用者按返回是想回到剛剛看的位置。
// 只要這個分頁裡確實有我們自己 push 過的紀錄，就走真正的 history.back()，
// 讓 popstate 去 scrollMemo 把位置還原；否則（例如直接貼網址進來）才退回原本的做法。
let pushedInApp = 0;
function goBack(fallbackUrl) {
  if (pushedInApp > 0) { pushedInApp--; history.back(); }
  else navigateTo(fallbackUrl);
}

function navigateTo(url) {
  pushedInApp++;
  scrollMemo.set(location.href, window.scrollY);   // 先記住現在這一頁停在哪
  history.pushState(null, "", url);
  // 等內容真的畫完才捲 —— 畫完前頁面還是舊的高度，先捲會被瀏覽器夾回去。
  renderThenPrefetch().then(() => window.scrollTo(0, 0));
}

window.addEventListener("popstate", () => {
  const back = scrollMemo.get(location.href) || 0;
  renderThenPrefetch().then(() => window.scrollTo(0, back));
});

async function render() {
  const nav = qs("nav", "home");
  if (!configLoaded) {
    const cfg = await api("/config");
    state.cur = cfg.cur; state.rate = cfg.rate; state.cash = cfg.cash_usd;
    configLoaded = true;
  }

  if (qs("trend", null)) return renderTrend();
  if (qs("cash", null)) return renderCash();
  if (qs("cal", null)) return renderCalendar();
  if (qs("review", null)) return renderReview();
  if (qs("about", null)) return renderAbout();
  const sym = qs("sym", null);
  if (sym) return renderDetail(sym, nav);
  if (nav === "home") return renderHome();
  if (nav === "hold") return renderHoldList();
  if (nav === "watch") return renderWatchList();
  if (nav === "stats") return renderStats();
  if (nav === "brief") return renderBrief();
  if (nav === "tw") return renderTwHoldings();
  return renderHome();
}

// 每個 render 分支都是 return，所以預抓不能寫在 render() 裡面 —— 寫在前面會在
// 當前頁面還在等資料時就開始搶連線（線上冷啟動時特別明顯），寫在後面則永遠跑不到。
// 包一層：先把當前頁面畫完，再開始預抓。
async function renderThenPrefetch() {
  try { await render(); } finally { prefetchOtherPages(); }
}

// 個股詳細／資產走勢／可用資金這些「子頁面」不是分頁輪播的一員，左右滑不該跳去
// 相鄰分頁（例如追蹤清單點進個股詳細，往前滑卻跑去持股，因為持股剛好是追蹤清單
// 分頁順序上的前一個）。子頁面上滑動只做一件事：往右滑＝返回上一頁，往左滑沒有意義。
function subPageBackTarget() {
  const sym = qs("sym", null);
  if (sym) return `?nav=${qs("nav", "hold")}`;
  if (qs("review", null)) return "?nav=stats";
  if (qs("trend", null) || qs("cash", null) || qs("cal", null) || qs("about", null)) return "?nav=home";
  return null;
}

// 個股詳細頁左右滑動：切到清單（持股／追蹤清單，看是從哪裡點進來的）裡的上一檔／下一檔股票。
// 清單順序沿用目前畫面上看到的順序（holdData/watchData 都是進清單頁時就抓好、照顯示順序存的）。
// 滑到清單開頭再往右滑，就回上一頁的清單；找不到清單快取（例如重新整理後直接落在詳細頁）
// 就退回「滑動只能返回上一頁」的舊行為，交給 subPageBackTarget 處理。
function detailSwipeTargets() {
  const sym = qs("sym", null);
  if (!sym) return null;
  const navKey = qs("nav", "home");
  const cache = navKey === "watch" ? watchData : holdData;
  const list = (cache && !cache.empty) ? cache.rows.map(r => r.symbol) : [];
  const idx = list.indexOf(sym.toUpperCase());
  if (idx === -1) return null;
  return {
    right: idx > 0 ? `?nav=${navKey}&sym=${encodeURIComponent(list[idx - 1])}` : `?nav=${navKey}`,
    left: idx < list.length - 1 ? `?nav=${navKey}&sym=${encodeURIComponent(list[idx + 1])}` : null,
  };
}

function _symFromUrl(url) {
  const m = /[?&]sym=([^&]+)/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : null;
}

// 個股詳細頁一進來，就順便把左右滑得到的上一檔／下一檔背景先抓好，使用者真的滑過去時
// 直接吃現成的，感覺不到等待；沒真的滑過去也沒關係，資料頂多沒用到，不影響其他功能。
const detailPrefetchCache = new Map(); // symbol -> {dataPromise, chartPromise}

function prefetchDetail(symbol) {
  if (!symbol || detailPrefetchCache.has(symbol)) return;
  const dataPromise = api(`/holdings/${encodeURIComponent(symbol)}`);
  const chartPromise = api(`/chart/${encodeURIComponent(symbol)}?range=1mo`);
  // 使用者最後沒真的滑過去，這兩個 promise 就沒人 await——先接一個空 catch，
  // 純粹只是不要讓瀏覽器主控台跳 unhandled rejection，不影響之後真的用到時能不能收到結果。
  dataPromise.catch(() => {});
  chartPromise.catch(() => {});
  detailPrefetchCache.set(symbol, { dataPromise, chartPromise });
}

function prefetchNeighbors() {
  const t = detailSwipeTargets();
  if (!t) return;
  prefetchDetail(_symFromUrl(t.left));
  prefetchDetail(_symFromUrl(t.right));
}

// 滑動中先讓使用者看到「放開會切到哪一檔」：清單資料本來就在本機（holdData/watchData），
// 不用等網路就能顯示代號＋現價。目標是回清單（沒有 sym）就顯示「回清單」。
function swipePeekLabel(url, navKey) {
  const sym = _symFromUrl(url);
  if (!sym) return `<span class="sym">↩ 回清單</span>`;
  const cache = navKey === "watch" ? watchData : holdData;
  const row = cache && !cache.empty ? cache.rows.find(r => r.symbol === sym) : null;
  const priceTxt = row && row.price_usd !== undefined && row.price_usd !== null ? usdOnly(row.price_usd) : "";
  return `<span class="sym">${esc(sym)}</span>${priceTxt ? `<span class="px">${esc(priceTxt)}</span>` : ""}`;
}

function showSwipePeek(side, html, strength) {
  let el = document.getElementById("swipePeek");
  if (!el) {
    el = document.createElement("div");
    el.id = "swipePeek";
    el.className = "swipe-peek";
    document.body.appendChild(el);
  }
  el.className = `swipe-peek ${side}`;
  el.style.opacity = String(Math.min(1, strength));
  el.innerHTML = `<span class="arrow">${side === "left" ? "→" : "←"}</span>${html}`;
}

function hideSwipePeek() {
  const el = document.getElementById("swipePeek");
  if (el) el.style.opacity = "0";
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
    const swipeTargets = detailSwipeTargets();
    const backTarget = subPageBackTarget();
    let damp;
    if (swipeTargets) {
      const target = dx > 0 ? swipeTargets.right : swipeTargets.left;
      damp = target ? 0.85 : 0.35;
      if (target) {
        showSwipePeek(dx > 0 ? "left" : "right",
          swipePeekLabel(target, qs("nav", "home")), Math.abs(dx) / 100);
      } else {
        hideSwipePeek();
      }
    } else if (backTarget) {
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
    hideSwipePeek();
    const swipeTargets = detailSwipeTargets();
    if (swipeTargets) {
      if (dx > 70 && swipeTargets.right) { finishSwipeTo(swipeTargets.right, "right"); return; }
      if (dx < -70 && swipeTargets.left) { finishSwipeTo(swipeTargets.left, "left"); return; }
      snapBack(app);
      return;
    }
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

// 下拉刷新：在頁面最頂端往下拉，放開就重抓當前這頁的資料並重繪，
// 不像整顆快取清空鈕那樣拖累全站，只重抓看得到的這一頁。
async function pullToRefreshCurrentPage() {
  const nav = qs("nav", "home");
  if (nav === "home") summaryCache = null;   // 總覽也要吃到下拉刷新
  if (nav === "hold" && !qs("sym", null)) holdData = null;
  if (nav === "watch") watchData = null;
  if (nav === "stats") statsCache = {};
  if (nav === "tw") twData = null;
  return render();
}

function bindPullRefresh() {
  const EXCLUDE = ".js-plotly-plot, .plotly-chart-wrap, .watch-row-wrap";
  const THRESH = 72;
  let sx = 0, sy = 0, dy = 0, active = false, deciding = true, pulling = false, refreshing = false;
  let indicator = null;

  function ensureIndicator() {
    if (indicator) return indicator;
    indicator = document.createElement("div");
    indicator.className = "pull-indicator";
    indicator.innerHTML = `<span class="arrow">↓</span>`;
    document.body.appendChild(indicator);
    return indicator;
  }

  document.addEventListener("touchstart", e => {
    if (refreshing || e.target.closest(EXCLUDE)) { active = false; return; }
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; dy = 0;
    active = window.scrollY <= 2;
    deciding = true; pulling = false;
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!active || refreshing) return;
    const t = e.touches[0];
    const rawDx = t.clientX - sx, rawDy = t.clientY - sy;
    if (deciding) {
      if (Math.abs(rawDx) < 8 && Math.abs(rawDy) < 8) return;
      pulling = rawDy > 0 && rawDy > Math.abs(rawDx) * 1.3 && window.scrollY <= 2;
      deciding = false;
      if (!pulling) { active = false; return; }
    }
    dy = Math.max(0, rawDy);
    const el = ensureIndicator();
    const damped = Math.min(90, dy * 0.5);
    el.style.opacity = String(Math.min(1, damped / 36));
    el.style.transform = `translateY(${-60 + damped}px)`;
    el.querySelector(".arrow").style.transform = `rotate(${Math.min(180, (dy / THRESH) * 180)}deg)`;
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("touchend", async () => {
    if (!pulling) { active = false; return; }
    active = false; pulling = false;
    const el = ensureIndicator();
    if (dy > THRESH) {
      refreshing = true;
      el.classList.add("spinning");
      el.style.opacity = "1";
      el.style.transform = "translateY(15px)";
      el.querySelector(".arrow").style.transform = "";
      try {
        await pullToRefreshCurrentPage();
      } finally {
        refreshing = false;
        el.classList.remove("spinning");
        el.style.opacity = "0";
        el.style.transform = "translateY(-60px)";
      }
    } else {
      el.style.opacity = "0";
      el.style.transform = "translateY(-60px)";
    }
  }, { passive: true });
}

// 鍵盤操作：手機是滑的，電腦上用鍵盤切分頁快得多。
// 1–6 對應底下 NAV 的六個分頁，Esc 等於按左上角的返回鈕。
document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= NAV.length) {
    e.preventDefault();
    navigateTo(`?nav=${NAV[n - 1].key}`);
    return;
  }
  if (e.key === "Escape") {
    const back = document.getElementById("backBtn");
    if (back) { e.preventDefault(); back.click(); }
  }
});

// 捲動時在 <html> 掛上 is-scrolling，CSS 會據此停掉卡片的 hover 抬起效果。
// 停止捲動 120ms 後才拿掉 —— 太短會在慣性捲動的空檔閃一下，太長則是停下來
// 之後要等一拍才有反應。passive 讓捲動本身不被這個監聽器拖慢。
let scrollIdleTimer = null;
addEventListener("scroll", () => {
  const root = document.documentElement;
  if (!root.classList.contains("is-scrolling")) root.classList.add("is-scrolling");
  clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => root.classList.remove("is-scrolling"), 120);
}, { passive: true });

bindSwipeNav();
bindPullRefresh();
renderThenPrefetch();

