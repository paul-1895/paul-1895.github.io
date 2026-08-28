/* ════════════════════════════════════════════════════════════
   indicators/rsi.js
   RSI (14) — own sub-pane below the volume pane.

   Provides:
     calculateRSI(prices, period)  — generic, also used by
                                      indicators/hilega-milega.js (period 9)
     attachRSI(data)
     drawRSISection(...)
     legendRowsRSI(candle)

   Depends on : candlestick-data.js (global: enabledIndicators),
                candlestick-legend.js (_legendIndRow)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawChart),
                candlestick-legend.js (renderChartLegend),
                indicators/hilega-milega.js
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --sans / --mono tokens for
// canvas, falling back to the authored literal when that file isn't on
// the page. See candlestick-draw.js.
const _rsiTheme = window.DSEChartTheme;
const _rsiFont  = spec => (_rsiTheme ? _rsiTheme.font(spec) : spec);

const RSI_COLOR = '#D77FFF';

// ─── Math ──────────────────────────────────────────────────────
function calculateRSI(prices, period = 14) {
  const changes = prices.map((p, i) => (i === 0 ? 0 : p - prices[i - 1]));
  return prices.map((_, i) => {
    if (i < period) return null;
    const slice  = changes.slice(i - period + 1, i + 1);
    const gains  = slice.filter(c => c > 0).reduce((a, b) => a + b, 0);
    const losses = Math.abs(slice.filter(c => c < 0).reduce((a, b) => a + b, 0));
    const avgG   = gains  / period;
    const avgL   = losses / period;
    const rs     = avgL === 0 ? 100 : avgG / avgL;
    return 100 - 100 / (1 + rs);
  });
}

// ─── Attach to candle data ─────────────────────────────────────
function attachRSI(data) {
  const closes = data.map(c => c.Close);
  const rsi    = calculateRSI(closes);
  data.forEach((candle, i) => { candle.rsi = rsi[i]; });
}

// ─── Drawing (own sub-pane) ──────────────────────────────────────
function drawRSISection(ctx, visibleData, width, height, candleWidth, spacing, padding, startY) {
  const chartHeight = height - 20;
  const isLightMode = document.documentElement.classList.contains('light-mode');
  const textColor   = isLightMode ? 'rgba(0,0,0,0.6)'  : 'rgba(160,174,192,0.6)';
  const labelColor  = isLightMode ? 'rgba(0,0,0,0.7)'  : 'rgba(160,174,192,0.8)';

  // Right-axis drag-to-zoom (see paneVZoom in candlestick-data.js) — RSI is
  // conventionally shown 0-100, so "zoom" stretches/compresses that fixed
  // range around its own midpoint (50) rather than around the data's range.
  const rsiZoom = typeof paneVZoom !== 'undefined' ? (paneVZoom.rsi || 1) : 1;
  const zLo = 50 - 50 / rsiZoom, zHi = 50 + 50 / rsiZoom;
  const toY = level => startY + chartHeight * (1 - (level - zLo) / (zHi - zLo));

  ctx.fillStyle = labelColor;
  ctx.font      = _rsiFont('bold 10px "DM Sans", sans-serif');
  ctx.textAlign = 'right';
  ctx.fillText('RSI', width - padding.right - 10, startY + 15);

  ctx.font      = _rsiFont('9px "DM Sans", sans-serif');
  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';

  [0, 30, 50, 70, 100].forEach(level => {
    const y = toY(level);
    ctx.strokeStyle = level === 30 || level === 70
      ? 'rgba(255,255,255,0.10)'
      : isLightMode ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left,          y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(String(level), width - padding.right + 10, y + 3);
  });

  const ob70 = toY(70);
  ctx.fillStyle = 'rgba(239,68,68,0.08)';
  ctx.fillRect(padding.left, startY, width - padding.left - padding.right, ob70 - startY);

  const os30 = toY(30);
  ctx.fillStyle = 'rgba(16,185,129,0.08)';
  ctx.fillRect(padding.left, os30, width - padding.left - padding.right, startY + chartHeight - os30);

  ctx.strokeStyle = RSI_COLOR;
  ctx.lineWidth   = 1;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  ctx.beginPath();
  visibleData.forEach((candle, idx) => {
    if (candle.rsi == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(candle.rsi);
    idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;

  // ── Latest value, tagged on the right axis ────────────────────
  // Same rounded pill the price pane uses for last-price (_drawAxisTag), in
  // the line's own colour so it reads as belonging to this pane rather than
  // to the price above it. Deliberately not the inline end-of-line label MACD
  // uses: RSI is a single line against a fixed 0-100 scale, so the axis is
  // where the eye already goes to read its level.
  const lastRsi = _lastNonNull(visibleData, 'rsi');
  if (lastRsi != null) {
    // Clamped to the pane: the right-axis drag-zoom can push the current
    // reading outside the visible band, and a tag drawn past the pane edge
    // would land in a neighbouring pane.
    const y = Math.max(startY + 9, Math.min(startY + chartHeight - 9, toY(lastRsi)));
    _drawAxisTag(ctx, width - padding.right + 2, y, lastRsi.toFixed(2), RSI_COLOR, '#1a0b2e', 'left');
  }
}

// Latest bar carrying a value for `key`. The last visible candle can be null
// during the indicator's warm-up (RSI needs `period` bars), and on a short
// zoomed-in window that would otherwise leave the pane untagged.
function _lastNonNull(visibleData, key) {
  for (let i = visibleData.length - 1; i >= 0; i--) {
    if (visibleData[i][key] != null) return visibleData[i][key];
  }
  return null;
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsRSI(candle) {
  if (!enabledIndicators.includes('RSI')) return '';
  const collapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes('RSI');
  return _legendIndRow('RSI 14', [
    { val: candle.rsi != null ? candle.rsi.toFixed(2) : null, color: RSI_COLOR },
  ], { paneKey: 'RSI', visible: !collapsed });
}