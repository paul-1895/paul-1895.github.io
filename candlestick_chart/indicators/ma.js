/* ════════════════════════════════════════════════════════════
   indicators/ma.js
   Moving Averages overlay: SMA20, SMA50, SMA200, EMA200.
   Toggled individually via the MA pills in the toolbar
   (activeMA state lives in candlestick-data.js).

   Provides:
     calculateSMA(prices, period)  — generic, also used by
                                      indicators/bollinger-bands.js
     calculateEMA(prices, period)  — generic, also used by
                                      indicators/macd.js and
                                      indicators/hilega-milega.js
     attachMA(data)                — writes sma20/sma50/sma200/ema200
     drawMAOverlays(...)           — draws all active MA lines
     legendRowsMA(candle)          — hover-legend rows

   Depends on : candlestick-data.js (global: activeMA),
                candlestick-legend.js (_legendIndRow, _legendFmtPrice)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawPriceSection),
                candlestick-legend.js (renderChartLegend)
   ════════════════════════════════════════════════════════════ */

const MA_COLORS = {
  sma20:  '#FFD700',
  sma50:  '#2E7FF6',
  sma200: '#FF6B6B',
  ema200: '#C77DFF',
};

// ─── Math ──────────────────────────────────────────────────────
function calculateSMA(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    return prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function calculateEMA(prices, period) {
  const k      = 2 / (period + 1);
  const result = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// ─── Attach to candle data ─────────────────────────────────────
function attachMA(data) {
  const closes = data.map(c => c.Close);
  const sma20  = calculateSMA(closes, 20);
  const sma50  = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);
  const ema200 = calculateEMA(closes, 200);
  data.forEach((candle, i) => {
    candle.sma20  = sma20[i];
    candle.sma50  = sma50[i];
    candle.sma200 = sma200[i];
    candle.ema200 = ema200[i];
  });
}

// ─── Drawing (price-pane overlay) ───────────────────────────────
function drawMA(ctx, visibleData, maKey, width, height, candleWidth, spacing, padding, color, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0          = padding.top;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  ctx.beginPath();
  let first = true;
  visibleData.forEach((candle, idx) => {
    const ma = candle[maKey];
    if (ma == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = y0 + chartHeight * (1 - (ma - minPrice) / (maxPrice - minPrice));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
}

function drawMAOverlays(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice) {
  if (activeMA[20])    drawMA(ctx, visibleData, 'sma20',  width, height, candleWidth, spacing, padding, MA_COLORS.sma20,  minPrice, maxPrice);
  if (activeMA[50])    drawMA(ctx, visibleData, 'sma50',  width, height, candleWidth, spacing, padding, MA_COLORS.sma50,  minPrice, maxPrice);
  if (activeMA[200])   drawMA(ctx, visibleData, 'sma200', width, height, candleWidth, spacing, padding, MA_COLORS.sma200, minPrice, maxPrice);
  if (activeMA.ema200) drawMA(ctx, visibleData, 'ema200', width, height, candleWidth, spacing, padding, MA_COLORS.ema200, minPrice, maxPrice);
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsMA(candle) {
  let html = '';
  if (activeMA[20])
    html += _legendIndRow('MA 20', [{ val: _legendFmtPrice(candle.sma20), color: MA_COLORS.sma20 }]);
  if (activeMA[50])
    html += _legendIndRow('MA 50', [{ val: _legendFmtPrice(candle.sma50), color: MA_COLORS.sma50 }]);
  if (activeMA[200])
    html += _legendIndRow('MA 200', [{ val: _legendFmtPrice(candle.sma200), color: MA_COLORS.sma200 }]);
  if (activeMA.ema200)
    html += _legendIndRow('EMA 200', [{ val: _legendFmtPrice(candle.ema200), color: MA_COLORS.ema200 }]);
  return html;
}