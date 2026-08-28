/* ================================================================
   financials-chart.js  —  Bar chart for financials tabs
   No dependencies. Reads CSS variables for theme-aware colours.

   Usage (call from financials.js after rendering the table):
     window.renderFinancialsChart(records, tabKey)

   records: array of objects — whatever shape financials.js stores.
     Looks for .value, then .eps, .amount, .nav fields in that order.
   tabKey: 'eps' | 'dividend' | 'nocfps' | 'revenue' | 'nav'
   ================================================================ */

'use strict';

const FIN_CHART_META = {
  eps:      { label: 'EPS',      unit: 'BDT' },
  dividend: { label: 'Dividend', unit: 'BDT' },
  nocfps:   { label: 'NOCFPS',  unit: 'BDT' },
  revenue:  { label: 'Revenue',  unit: 'BDT' },
  nav:      { label: 'NAV',      unit: 'BDT' },
};

/* ----------------------------------------------------------------
   Public API
---------------------------------------------------------------- */
window.renderFinancialsChart = function (records, tabKey) {
  const container = document.getElementById('fin-chart-container');
  if (!container) return;

  if (!records || records.length < 2) {
    container.innerHTML = '';
    return;
  }

  // Sort oldest→newest: ascending year, then Q1→Q4 within each year
  const QORDER = { Q1:0, Q2:1, Q3:2, Q4:3 };
  const data   = [...records].sort((a, b) =>
    (a.year - b.year) || ((QORDER[a.quarter] ?? 0) - (QORDER[b.quarter] ?? 0)));
  const meta   = FIN_CHART_META[tabKey] || { label: tabKey.toUpperCase(), unit: '' };
  const labels = data.map(r => r.quarter ? `${r.quarter} ${r.year}` : String(r.year));
  const values = data.map(r => parseFloat(r.value ?? r.eps ?? r.amount ?? r.nav ?? 0));

  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;display:block;';
    container.innerHTML = '';
    container.appendChild(canvas);
  }
  canvas._fin = { labels, values, meta };
  _drawFinChart(canvas, labels, values, meta);
};

/* ----------------------------------------------------------------
   Canvas 2D drawing
---------------------------------------------------------------- */
function _drawFinChart(canvas, labels, values, meta) {
  const cv  = p => getComputedStyle(document.documentElement).getPropertyValue(p).trim();
  const DPR = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth || 700;
  const H   = Math.max(200, Math.min(300, W * 0.34));

  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);
  ctx.clearRect(0, 0, W, H);

  const colGain  = cv('--gain')         || '#22c55e';
  const colLoss  = cv('--loss')         || '#ef4444';
  const colText  = cv('--text-primary') || '#e2e8f0';
  const colMuted = cv('--text-muted')   || '#64748b';
  const colGrid  = cv('--border')       || '#334155';

  const PAD  = { top: 26, right: 16, bottom: 54, left: 52 };
  const cW   = W - PAD.left - PAD.right;
  const cH   = H - PAD.top  - PAD.bottom;

  const minV  = Math.min(...values);
  const maxV  = Math.max(...values);
  const span  = maxV - minV || 1;
  const yMin  = minV >= 0 ? 0 : minV - span * 0.08;
  const yMax  = maxV + span * 0.10;
  const ySpan = yMax - yMin;
  const yPx   = v => PAD.top + cH - ((v - yMin) / ySpan) * cH;
  const zeroY = yPx(0);

  // Grid + Y labels
  ctx.strokeStyle = colGrid;  ctx.lineWidth = 0.5;
  ctx.font = '10px monospace'; ctx.fillStyle = colMuted;
  ctx.textAlign = 'right';    ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (ySpan / 4) * i;
    const y = yPx(v);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
    ctx.fillText(v.toFixed(2), PAD.left - 5, y);
  }

  // Bars
  const n  = values.length;
  const gp = Math.max(2, cW * 0.012);
  const bW = (cW - gp * (n + 1)) / n;

  values.forEach((v, i) => {
    const x     = PAD.left + gp + i * (bW + gp);
    const isPos = v >= 0;
    const top   = isPos ? yPx(v) : zeroY;
    const bH    = Math.max(1, Math.abs(yPx(v) - zeroY));

    ctx.fillStyle = isPos ? colGain : colLoss;
    ctx.globalAlpha = 0.82;
    _rr(ctx, x, top, bW, bH, Math.min(3, bW * 0.15)); ctx.fill();
    ctx.globalAlpha = 1;

    // Value label
    if (bW >= 18) {
      ctx.fillStyle = colText;
      ctx.font = `${Math.min(10, bW * 0.26)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = isPos ? 'bottom' : 'top';
      ctx.fillText(v.toFixed(2), x + bW / 2, isPos ? top - 2 : top + bH + 2);
    }

    // X-axis label (rotate when crowded)
    ctx.save();
    ctx.fillStyle = colMuted;
    ctx.font = `${Math.min(10, Math.max(8, bW * 0.28 + 4))}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lx = x + bW / 2, ly = H - PAD.bottom + 6;
    if (n > 12) {
      ctx.translate(lx, ly); ctx.rotate(-Math.PI / 4); ctx.fillText(labels[i], 0, 0);
    } else {
      ctx.fillText(labels[i], lx, ly);
    }
    ctx.restore();
  });

  // Zero line when chart has negatives
  if (yMin < 0) {
    ctx.strokeStyle = colMuted; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.left, zeroY); ctx.lineTo(PAD.left + cW, zeroY); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Title
  ctx.fillStyle = colMuted; ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';   ctx.textBaseline = 'top';
  ctx.fillText(`${meta.label} (${meta.unit})`, PAD.left, 7);
}

function _rr(ctx, x, y, w, h, r) {
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// Redraw on resize (debounced 120 ms)
let _fcrTimer;
window.addEventListener('resize', () => {
  clearTimeout(_fcrTimer);
  _fcrTimer = setTimeout(() => {
    const c = document.querySelector('#fin-chart-container canvas');
    if (c && c._fin) _drawFinChart(c, c._fin.labels, c._fin.values, c._fin.meta);
  }, 120);
});