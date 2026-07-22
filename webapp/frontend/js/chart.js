// 淺色/深色模式的格線、座標文字、十字準線顏色不一樣，畫布是純手畫的，
// 沒辦法用 CSS 變數，只能在畫的當下自己判斷一次系統主題。
function chartTheme() {
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f2941f";
  return dark
    ? { grid: "rgba(255,255,255,.10)", axisText: "#9aa1ac", crosshair: "rgba(255,255,255,.28)", dotStroke: "#1c1e22", hoverBar: accent }
    : { grid: "#eef1f4", axisText: "#6b7280", crosshair: "rgba(30,30,32,.25)", dotStroke: "#fff", hoverBar: accent };
}

// 輕量走勢圖：純 canvas 畫線，不用任何圖表庫。
// 需求：拿掉縮放/拖曳功能，改成點/觸碰一下就顯示對應日期與數值。
function drawLineChart(container, points, { color, fillColor, moneyFmt }) {
  container.innerHTML = "";
  if (!points || points.length < 2) {
    container.innerHTML = `<div class="loading">暫時抓不到走勢資料，稍後重整。</div>`;
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.style.display = "none";
  container.style.position = "relative";
  container.appendChild(canvas);
  container.appendChild(tooltip);

  const cssW = container.clientWidth || 320;
  const cssH = 260;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const values = points.map(p => p.v);
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;

  const padL = 4, padR = 46, padT = 8, padB = 8;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  const xAt = i => padL + (i / (points.length - 1)) * plotW;
  const yAt = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;

  function paint(hoverIdx) {
    const theme = chartTheme();
    ctx.clearRect(0, 0, cssW, cssH);

    // y 軸網格線（右側刻度，跟原本 Plotly 版一致）
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.font = "11px -apple-system,'Segoe UI',sans-serif";
    ctx.fillStyle = theme.axisText;
    ctx.textAlign = "left";
    const gridN = 4;
    for (let g = 0; g <= gridN; g++) {
      const v = lo + (hi - lo) * (g / gridN);
      const y = yAt(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
      ctx.fillText(moneyFmt ? moneyFmt(v) : v.toFixed(2), cssW - padR + 6, y + 3);
    }

    // 面積填色
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(points[0].v));
    points.forEach((p, i) => ctx.lineTo(xAt(i), yAt(p.v)));
    ctx.lineTo(xAt(points.length - 1), padT + plotH);
    ctx.lineTo(xAt(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // 折線
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (hoverIdx !== null && hoverIdx !== undefined) {
      const x = xAt(hoverIdx), y = yAt(points[hoverIdx].v);
      ctx.beginPath();
      ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
      ctx.strokeStyle = theme.crosshair;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = theme.dotStroke; ctx.stroke();
    }
  }
  paint(null);

  function nearestIdx(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, (x - padL) / plotW));
    return Math.round(ratio * (points.length - 1));
  }

  function showTip(clientX, clientY) {
    const idx = nearestIdx(clientX);
    paint(idx);
    const p = points[idx];
    const d = new Date(p.t);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    tooltip.innerHTML = `<b>${dateStr}</b><br>${moneyFmt ? moneyFmt(p.v) : p.v.toFixed(2)}`;
    tooltip.style.display = "block";
    const rect = container.getBoundingClientRect();
    let left = xAt(idx) + 10;
    if (left + 110 > rect.width) left = xAt(idx) - 118;
    tooltip.style.left = left + "px";
    tooltip.style.top = "6px";
  }

  function hideTip() {
    paint(null);
    tooltip.style.display = "none";
  }

  canvas.addEventListener("touchstart", e => { showTip(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  canvas.addEventListener("touchmove", e => { showTip(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", () => setTimeout(hideTip, 800), { passive: true });
  canvas.addEventListener("mousemove", e => showTip(e.clientX, e.clientY));
  canvas.addEventListener("mouseleave", hideTip);
}

// 輕量長條圖：同樣不用圖表庫，拿掉縮放，點/觸碰顯示數值。
function drawBarChart(container, points, { posColor, negColor, moneyFmt }) {
  container.innerHTML = "";
  if (!points || points.length < 1) {
    container.innerHTML = `<div class="loading">暫時抓不到資料。</div>`;
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.style.display = "none";
  container.style.position = "relative";
  container.appendChild(canvas);
  container.appendChild(tooltip);

  const cssW = container.clientWidth || 320;
  const cssH = 220;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const values = points.map(p => p.v);
  let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;

  const padL = 4, padR = 46, padT = 8, padB = 8;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  const n = points.length;
  const slot = plotW / n;
  const barW = Math.max(2, slot * 0.6);
  const yAt = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  const zeroY = yAt(0);

  function paint(hoverIdx) {
    const theme = chartTheme();
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.font = "11px -apple-system,'Segoe UI',sans-serif";
    ctx.fillStyle = theme.axisText;
    for (let g = 0; g <= 4; g++) {
      const v = lo + (hi - lo) * (g / 4);
      const y = yAt(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
      ctx.fillText(moneyFmt ? moneyFmt(v) : v.toFixed(0), cssW - padR + 6, y + 3);
    }
    points.forEach((p, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const y = yAt(p.v);
      const top = Math.min(y, zeroY), h = Math.abs(y - zeroY) || 1;
      ctx.fillStyle = i === hoverIdx ? theme.hoverBar : (p.v >= 0 ? posColor : negColor);
      ctx.fillRect(x, top, barW, h);
    });
  }
  paint(null);

  function nearestIdx(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const idx = Math.floor((x - padL) / slot);
    return Math.min(n - 1, Math.max(0, idx));
  }

  function showTip(clientX) {
    const idx = nearestIdx(clientX);
    paint(idx);
    const p = points[idx];
    const d = new Date(p.t);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    tooltip.innerHTML = `<b>${dateStr}</b><br>${moneyFmt ? moneyFmt(p.v) : p.v.toFixed(2)}`;
    tooltip.style.display = "block";
    const rect = container.getBoundingClientRect();
    let left = padL + slot * idx + 10;
    if (left + 110 > rect.width) left = padL + slot * idx - 118;
    tooltip.style.left = left + "px";
    tooltip.style.top = "6px";
  }
  function hideTip() { paint(null); tooltip.style.display = "none"; }

  canvas.addEventListener("touchstart", e => showTip(e.touches[0].clientX), { passive: true });
  canvas.addEventListener("touchmove", e => { showTip(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", () => setTimeout(hideTip, 800), { passive: true });
  canvas.addEventListener("mousemove", e => showTip(e.clientX));
  canvas.addEventListener("mouseleave", hideTip);
}
