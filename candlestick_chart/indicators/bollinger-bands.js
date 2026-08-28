/* ════════════════════════════════════════════════════════════
   indicators/bollinger-bands.js
   Bollinger Bands (20, 2) — price-pane overlay.

   Provides:
     calculateBollingerBands(prices, period, multiplier)
     attachBollingerBands(data)
     drawBollingerBandsOverlay(...)
     legendRowsBollinger(candle)

   Depends on : candlestick-data.js (global: enabledIndicators),
                indicators/ma.js (calculateSMA),
                candlestick-legend.js (_legendIndRow, _legendFmtPrice)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawPriceSection),
                candlestick-legend.js (renderChartLegend)
   ════════════════════════════════════════════════════════════ */

const BB_COLOR = '#00D4FF';

// ─── Math ──────────────────────────────────────────────────────
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  const sma   = calculateSMA(prices, period);
  const upper = new Array(prices.length).fill(null);
  const lower = new Array(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    const slice    = prices.slice(i - period + 1, i + 1);
    const mean     = sma[i];
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    const stdDev   = Math.sqrt(variance);
    upper[i] = mean + multiplier * stdDev;
    lower[i] = mean - multiplier * stdDev;
  }
  return { upper, middle: sma, lower };
}

// ─── Attach to candle data ─────────────────────────────────────
function attachBollingerBands(data) {
  const closes = data.map(c => c.Close);
  const bb     = calculateBollingerBands(closes);
  data.forEach((candle, i) => {
    candle.bbUpper  = bb.upper[i];
    candle.bbMiddle = bb.middle[i];
    candle.bbLower  = bb.lower[i];
  });
}

// ─── Drawing (price-pane overlay) ───────────────────────────────
function drawBollingerBandsOverlay(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0          = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  const upperPts = [], lowerPts = [];
  visibleData.forEach((candle, idx) => {
    if (candle.bbUpper == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    upperPts.push({ x, y: toY(candle.bbUpper) });
    lowerPts.push({ x, y: toY(candle.bbLower) });
  });
  if (upperPts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(upperPts[0].x, upperPts[0].y);
  upperPts.forEach(p => ctx.lineTo(p.x, p.y));
  for (let i = lowerPts.length - 1; i >= 0; i--) ctx.lineTo(lowerPts[i].x, lowerPts[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,212,255,0.15)';
  ctx.fill();

  ctx.strokeStyle = BB_COLOR;
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  ctx.beginPath();
  upperPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.beginPath();
  lowerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  let first = true;
  visibleData.forEach((candle, idx) => {
    if (candle.bbMiddle == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(candle.bbMiddle);
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsBollinger(candle) {
  if (!enabledIndicators.includes('Bollinger Bands')) return '';
  return _legendIndRow('BB 20 2', [
    { val: _legendFmtPrice(candle.bbUpper),  color: BB_COLOR },
    { val: _legendFmtPrice(candle.bbMiddle), color: BB_COLOR },
    { val: _legendFmtPrice(candle.bbLower),  color: BB_COLOR },
  ]);
}