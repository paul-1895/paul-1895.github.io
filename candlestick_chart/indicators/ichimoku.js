/* ════════════════════════════════════════════════════════════
   indicators/ichimoku.js
   Ichimoku Cloud (Tenkan 9, Kijun 26, Senkou B 52, displaced 26)
   — price-pane overlay.

   Provides:
     calculateIchimoku(data, tenkanPeriod, kijunPeriod, senkouBPeriod)
     attachIchimoku(data)
     drawIchimokuCloudOverlay(...)
     legendRowsIchimoku(candle)

   Depends on : candlestick-data.js (global: enabledIndicators),
                candlestick-legend.js (_legendIndRow, _legendFmtPrice)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawPriceSection),
                candlestick-legend.js (renderChartLegend)
   ════════════════════════════════════════════════════════════ */

const ICHIMOKU_SHIFT = 26;

const ICHIMOKU_COLORS = {
  senkouA: '#26a69a',
  senkouB: '#ef5350',
  tenkan:  '#2196F3',
  kijun:   '#FF5722',
  chikou:  '#ab47bc',
};

const ICHIMOKU_BULL_FILL = 'rgba(38,166,154,0.16)';
const ICHIMOKU_BEAR_FILL = 'rgba(239,83,80,0.16)';

// ─── Math ──────────────────────────────────────────────────────
function calculateIchimoku(data, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
  const highs = data.map(c => c.High);
  const lows  = data.map(c => c.Low);
  const midpoint = period => highs.map((_, i) => {
    if (i < period - 1) return null;
    const hSlice = highs.slice(i - period + 1, i + 1);
    const lSlice = lows.slice(i - period + 1, i + 1);
    return (Math.max(...hSlice) + Math.min(...lSlice)) / 2;
  });
  const tenkan  = midpoint(tenkanPeriod);
  const kijun   = midpoint(kijunPeriod);
  const senkouB = midpoint(senkouBPeriod);
  const senkouA = tenkan.map((t, i) =>
    (t != null && kijun[i] != null) ? (t + kijun[i]) / 2 : null
  );
  const chikou = data.map(c => c.Close);
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

// ─── Attach to candle data ─────────────────────────────────────
function attachIchimoku(data) {
  const ichimoku = calculateIchimoku(data);
  data.forEach((candle, i) => {
    candle.tenkan  = ichimoku.tenkan[i];
    candle.kijun   = ichimoku.kijun[i];
    candle.senkouA = ichimoku.senkouA[i];
    candle.senkouB = ichimoku.senkouB[i];
    candle.chikou  = ichimoku.chikou[i];
  });
}

// ─── Drawing (price-pane overlay) ───────────────────────────────
function drawIchimokuCloudOverlay(ctx, visibleData, displayData, startIdx, width, height, candleWidth, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0  = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  const slots = visibleData.length + ICHIMOKU_SHIFT;
  const pts = [];
  for (let i = 0; i < slots; i++) {
    const src = displayData[startIdx + i - ICHIMOKU_SHIFT];
    pts.push({
      x: padding.left + (i + 0.5) * candleWidth,
      a: (src && src.senkouA != null) ? toY(src.senkouA) : null,
      b: (src && src.senkouB != null) ? toY(src.senkouB) : null,
    });
  }

  let i = 0;
  while (i < pts.length) {
    if (pts[i].a == null || pts[i].b == null) { i++; continue; }
    const bullish = pts[i].a <= pts[i].b;
    let j = i;
    while (j < pts.length && pts[j].a != null && pts[j].b != null && (pts[j].a <= pts[j].b) === bullish) j++;
    const seg = pts.slice(i, j);
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].a);
    seg.forEach(p => ctx.lineTo(p.x, p.a));
    for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].b);
    ctx.closePath();
    ctx.fillStyle = bullish ? ICHIMOKU_BULL_FILL : ICHIMOKU_BEAR_FILL;
    ctx.fill();
    i = j;
  }

  _strokeIchimokuPixels(ctx, pts, 'a', ICHIMOKU_COLORS.senkouA);
  _strokeIchimokuPixels(ctx, pts, 'b', ICHIMOKU_COLORS.senkouB);
  _strokeIchimokuSeries(ctx, visibleData, 'tenkan', candleWidth, padding, toY, ICHIMOKU_COLORS.tenkan, 1.5);
  _strokeIchimokuSeries(ctx, visibleData, 'kijun',  candleWidth, padding, toY, ICHIMOKU_COLORS.kijun,  1.5);

  ctx.strokeStyle = ICHIMOKU_COLORS.chikou;
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  let started = false;
  visibleData.forEach((candle, idx) => {
    const src = displayData[startIdx + idx + ICHIMOKU_SHIFT];
    if (!src) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(src.Close);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function _strokeIchimokuPixels(ctx, pts, key, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  let started = false;
  pts.forEach(p => {
    if (p[key] == null) { started = false; return; }
    if (!started) { ctx.moveTo(p.x, p[key]); started = true; } else ctx.lineTo(p.x, p[key]);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function _strokeIchimokuSeries(ctx, visibleData, key, candleWidth, padding, toY, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth;
  ctx.beginPath();
  let started = false;
  visibleData.forEach((candle, idx) => {
    const v = candle[key];
    if (v == null) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsIchimoku(candle) {
  if (!enabledIndicators.includes('Ichimoku Cloud')) return '';
  return _legendIndRow('Ichimoku 9 26 52 26', [
    { val: _legendFmtPrice(candle.tenkan),  color: ICHIMOKU_COLORS.tenkan },
    { val: _legendFmtPrice(candle.kijun),   color: ICHIMOKU_COLORS.kijun },
    { val: _legendFmtPrice(candle.senkouA), color: ICHIMOKU_COLORS.senkouA },
    { val: _legendFmtPrice(candle.senkouB), color: ICHIMOKU_COLORS.senkouB },
  ]);
}