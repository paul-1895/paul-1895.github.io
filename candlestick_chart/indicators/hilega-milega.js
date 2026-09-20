/* ════════════════════════════════════════════════════════════
   indicators/hilega-milega.js
   Hilega-Milega: RSI(9) line, with a WMA(21) "strength" dotted
   overlay and an EMA(3) "price" line — own sub-pane below RSI/MACD.

   Provides:
     calculateWMA(prices, period)
     attachHilegaMilega(data)
     drawHMSection(...)
     legendRowsHilegaMilega(candle)

   Depends on : candlestick-data.js (global: enabledIndicators),
                indicators/rsi.js (calculateRSI),
                indicators/ma.js  (calculateEMA),
                candlestick-legend.js (_legendIndRow)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawChart),
                candlestick-legend.js (renderChartLegend)
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --sans / --mono tokens for
// canvas, falling back to the authored literal when that file isn't on
// the page. See candlestick-draw.js.
const _hmTheme = window.DSEChartTheme;
const _hmFont  = spec => (_hmTheme ? _hmTheme.font(spec) : spec);

const HM_COLORS = {
  line50:   '#4caf50',
  rsi:      '#26c6da',
  strength: '#f57c00',
  price:    '#1e88e5',
};

// ─── Math ──────────────────────────────────────────────────────
function calculateWMA(prices, period) {
  const result = new Array(prices.length).fill(null);
  const denom  = (period * (period + 1)) / 2;
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += prices[i - (period - 1 - j)] * (j + 1);
    }
    result[i] = sum / denom;
  }
  return result;
}

// ─── Attach to candle data ─────────────────────────────────────
function attachHilegaMilega(data) {
  const closes  = data.map(c => c.Close);
  const hmRsi   = calculateRSI(closes, 9);
  const hmWma21 = calculateWMA(hmRsi.map(v => v ?? 50), 21);
  const hmEma3  = calculateEMA(hmRsi.map(v => v ?? 50), 3);
  data.forEach((candle, i) => {
    candle.hmRsi   = hmRsi[i];
    candle.hmWma21 = hmWma21[i];
    candle.hmEma3  = hmEma3[i];
  });
}

// ─── Drawing (own sub-pane) ──────────────────────────────────────
function drawHMSection(ctx, visibleData, width, height, candleWidth, spacing, padding, startY) {
  const chartHeight = height - 20;
  const isLightMode = document.documentElement.classList.contains('light-mode');
  const textColor   = isLightMode ? 'rgba(0,0,0,0.6)'  : 'rgba(160,174,192,0.6)';
  const labelColor  = isLightMode ? 'rgba(0,0,0,0.7)'  : 'rgba(160,174,192,0.8)';
  const gridColor   = isLightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';

  // Right-axis drag-to-zoom (see paneVZoom in candlestick-data.js) — fixed
  // 0-100 range, so "zoom" stretches/compresses around the midpoint (50).
  const hmZoom = typeof paneVZoom !== 'undefined' ? (paneVZoom.hm || 1) : 1;
  const zLo = 50 - 50 / hmZoom, zHi = 50 + 50 / hmZoom;
  const toY = v => startY + chartHeight * (1 - (v - zLo) / (zHi - zLo));

  ctx.font      = _hmFont('9px "DM Sans", sans-serif');
  ctx.fillStyle = textColor;
  ctx.textAlign = 'right';

  [0, 30, 50, 70, 100].forEach(level => {
    const y = toY(level);
    ctx.strokeStyle = (level === 30 || level === 70)
      ? (isLightMode ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)')
      : gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left,          y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(String(level), padding.left - 10, y + 3);
  });

  const y50 = toY(50);
  ctx.strokeStyle = HM_COLORS.line50;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left,          y50);
  ctx.lineTo(width - padding.right, y50);
  ctx.stroke();

  const rsiPts = [];
  visibleData.forEach((candle, idx) => {
    if (candle.hmRsi == null) return;
    rsiPts.push({ x: padding.left + (idx + 0.5) * candleWidth, y: toY(candle.hmRsi), v: candle.hmRsi });
  });

  let i = 0;
  while (i < rsiPts.length) {
    const above = rsiPts[i].v > 50;
    let j = i;
    while (j < rsiPts.length && (rsiPts[j].v > 50) === above) j++;
    const seg = rsiPts.slice(i, j);
    if (seg.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(seg[0].x, y50);
      seg.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(seg[seg.length - 1].x, y50);
      ctx.closePath();
      ctx.fillStyle = above ? 'rgba(255,140,80,0.45)' : 'rgba(100,210,255,0.35)';
      ctx.fill();
    }
    i = j;
  }

  ctx.strokeStyle = HM_COLORS.rsi;
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  let started = false;
  visibleData.forEach((candle, idx) => {
    if (candle.hmRsi == null) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(candle.hmRsi);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const circleR = Math.max(1.5, Math.min(3, candleWidth * 0.25));
  ctx.fillStyle = HM_COLORS.strength;
  visibleData.forEach((candle, idx) => {
    if (candle.hmWma21 == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(candle.hmWma21);
    ctx.beginPath();
    ctx.arc(x, y, circleR, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = HM_COLORS.price;
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  started = false;
  visibleData.forEach((candle, idx) => {
    if (candle.hmEma3 == null) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(candle.hmEma3);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = labelColor;
  ctx.font      = _hmFont('bold 10px "DM Sans", sans-serif');
  ctx.textAlign = 'left';
  ctx.fillText('HILEGA-MILEGA', padding.left, startY + 15);

  const legendX = padding.left + 115;
  const items = [
    { col: HM_COLORS.line50,   lbl: 'Line-50',       circle: false },
    { col: HM_COLORS.rsi,      lbl: 'RSI(9)',         circle: false },
    { col: HM_COLORS.strength, lbl: 'Strength WMA21', circle: true  },
    { col: HM_COLORS.price,    lbl: 'Price EMA3',     circle: false },
  ];
  let lx = legendX;
  items.forEach(({ col, lbl, circle }) => {
    ctx.fillStyle = col;
    if (circle) {
      ctx.beginPath();
      ctx.arc(lx + 3, startY + 15, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(lx, startY + 13, 10, 2);
    }
    ctx.fillStyle = labelColor;
    ctx.font      = _hmFont('9px "DM Sans", sans-serif');
    ctx.textAlign = 'left';
    ctx.fillText(lbl, lx + 14, startY + 19);
    lx += ctx.measureText(lbl).width + 28;
  });
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsHilegaMilega(candle) {
  if (!enabledIndicators.includes('Hilega-Milega')) return '';
  const collapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes('Hilega-Milega');
  return _legendIndRow('Hilega-Milega 9 21 3', [
    { val: candle.hmRsi   != null ? candle.hmRsi.toFixed(2)   : null, color: HM_COLORS.rsi      },
    { val: candle.hmWma21 != null ? candle.hmWma21.toFixed(2) : null, color: HM_COLORS.strength },
    { val: candle.hmEma3  != null ? candle.hmEma3.toFixed(2)  : null, color: HM_COLORS.price    },
  ], { paneKey: 'Hilega-Milega', visible: !collapsed });
}