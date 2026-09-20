/* ════════════════════════════════════════════════════════════
   indicators/macd.js
   MACD (12, 26, 9) — own sub-pane below the volume pane.

   Provides:
     calculateMACD(prices)
     attachMACD(data)
     drawMACDSection(...)
     legendRowsMACD(candle)

   Depends on : candlestick-data.js (global: enabledIndicators),
                indicators/ma.js (calculateEMA),
                candlestick-legend.js (_legendIndRow)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawChart),
                candlestick-legend.js (renderChartLegend)
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --sans / --mono tokens for
// canvas, falling back to the authored literal when that file isn't on
// the page. See candlestick-draw.js.
const _mcdTheme = window.DSEChartTheme;
const _mcdFont  = spec => (_mcdTheme ? _mcdTheme.font(spec) : spec);

// ─── Persistent MACD parameters ───────────────────────────────
const MACD_DEFAULTS = {
  fastLength:    12,
  slowLength:    26,
  signalLength:  9,
  source:        'Close',
  macdColor:     '#FF9C00',
  signalColor:   '#0891B2',
  histUpColor:   '#10B981',
  histDownColor: '#EF4444',
  macdWidth:     2.5,
  signalWidth:   2.5,
  showMACD:      true,
  showSignal:    true,
  showHistogram: true,
  showZero:      true,
};

let macdParams = (function() {
  try {
    const saved = localStorage.getItem('macdParams');
    if (saved) return Object.assign({}, MACD_DEFAULTS, JSON.parse(saved));
  } catch(e) {}
  return Object.assign({}, MACD_DEFAULTS);
})();

function saveMACDParams() {
  try { localStorage.setItem('macdParams', JSON.stringify(macdParams)); } catch(e) {}
}

// Legacy colour object — kept so any code still referencing MACD_COLORS works
const MACD_COLORS = {
  get line()     { return macdParams.macdColor;     },
  get signal()   { return macdParams.signalColor;   },
  get histUp()   { return macdParams.histUpColor;   },
  get histDown() { return macdParams.histDownColor; },
};

// ─── Source helper ─────────────────────────────────────────────
function _macdResolveSource(candle, src) {
  switch (src) {
    case 'Open':  return candle.Open;
    case 'High':  return candle.High;
    case 'Low':   return candle.Low;
    case 'HL2':   return (candle.High + candle.Low) / 2;
    case 'HLC3':  return (candle.High + candle.Low + candle.Close) / 3;
    case 'OHLC4': return (candle.Open + candle.High + candle.Low + candle.Close) / 4;
    default:      return candle.Close;
  }
}

// ─── Math ──────────────────────────────────────────────────────
function calculateMACD(prices, fast, slow, signal) {
  fast   = fast   || macdParams.fastLength   || 12;
  slow   = slow   || macdParams.slowLength   || 26;
  signal = signal || macdParams.signalLength || 9;
  const emaFast   = calculateEMA(prices, fast);
  const emaSlow   = calculateEMA(prices, slow);
  const macdLine  = emaFast.map((v, i) => (v || 0) - (emaSlow[i] || 0));
  const signalLine= calculateEMA(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - (signalLine[i] || 0));
  return { macdLine, signalLine, histogram };
}

// ─── Attach to candle data ─────────────────────────────────────
function attachMACD(data) {
  const src  = macdParams.source || 'Close';
  const prices = data.map(c => _macdResolveSource(c, src));
  const macd = calculateMACD(prices);
  data.forEach((candle, i) => {
    candle.macdLine   = macd.macdLine[i];
    candle.signalLine = macd.signalLine[i];
    candle.histogram  = macd.histogram[i];
  });
}

// ─── Drawing (own sub-pane) ──────────────────────────────────────
function drawMACDSection(ctx, visibleData, width, height, candleWidth, spacing, padding, startY) {
  const p = macdParams;

  // ── Calculate proper scale range ──────────────────────────────
  let maxVal = 0, minVal = 0;
  visibleData.forEach(c => {
    if (p.showMACD      && c.macdLine   != null) { maxVal = Math.max(maxVal, c.macdLine);   minVal = Math.min(minVal, c.macdLine);   }
    if (p.showSignal    && c.signalLine != null) { maxVal = Math.max(maxVal, c.signalLine); minVal = Math.min(minVal, c.signalLine); }
    if (p.showHistogram && c.histogram  != null) { maxVal = Math.max(maxVal, c.histogram);  minVal = Math.min(minVal, c.histogram);  }
  });

  const range    = (maxVal - minVal) || 1;
  const padRange = range * 0.15;
  maxVal += padRange;
  minVal -= padRange;

  // Right-axis drag-to-zoom (see paneVZoom in candlestick-data.js) — zoom
  // around the pane's own midpoint, same pattern the price pane uses.
  const zoomCenter  = (maxVal + minVal) / 2;
  const zoomHalfSpan = ((maxVal - minVal) / 2) / (typeof paneVZoom !== 'undefined' ? (paneVZoom.macd || 1) : 1);
  maxVal = zoomCenter + zoomHalfSpan;
  minVal = zoomCenter - zoomHalfSpan;

  const chartHeight = height - 30;
  const isLightMode = document.documentElement.classList.contains('light-mode');
  const gridColor   = isLightMode ? 'rgba(0,0,0,0.08)'  : 'rgba(255,255,255,0.05)';
  const textColor   = isLightMode ? 'rgba(0,0,0,0.6)'   : 'rgba(160,174,192,0.6)';
  const labelColor  = isLightMode ? 'rgba(0,0,0,0.8)'   : 'rgba(160,174,192,0.95)';
  const valueToY    = v => startY + chartHeight * ((maxVal - v) / (maxVal - minVal));

  // ── Grid lines & Y-axis labels ────────────────────────────────
  ctx.font = _mcdFont('9px "DM Sans", sans-serif'); ctx.fillStyle = textColor; ctx.textAlign = 'left';
  ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const val = minVal + (maxVal - minVal) * (i / 4);
    const y   = valueToY(val);
    ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    ctx.fillText(val.toFixed(2), width - padding.right + 10, y + 3);
  }

  // ── Zero line ─────────────────────────────────────────────────
  if (p.showZero) {
    const zY = valueToY(0);
    ctx.strokeStyle = isLightMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padding.left, zY); ctx.lineTo(width - padding.right, zY); ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Indicator label ───────────────────────────────────────────
  ctx.font = _mcdFont('bold 10px "DM Sans", sans-serif'); ctx.fillStyle = labelColor; ctx.textAlign = 'right';
  ctx.fillText(`MACD ${p.fastLength},${p.slowLength},${p.signalLength}`, padding.left - 8, startY + 15);

  // ── Histogram bars ────────────────────────────────────────────
  if (p.showHistogram) {
    const zeroY = valueToY(0);
    visibleData.forEach((candle, idx) => {
      if (candle.histogram == null) return;
      const x    = padding.left + (idx + 0.5) * candleWidth;
      const histY= valueToY(candle.histogram);
      const barW = Math.max(1, spacing * 0.7);
      // Make bars slightly transparent versions of the configured colors
      const hex  = candle.histogram >= 0 ? p.histUpColor : p.histDownColor;
      const m    = hex.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
      ctx.fillStyle = m
        ? `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},0.4)`
        : (candle.histogram >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)');
      ctx.fillRect(x - barW / 2, Math.min(histY, zeroY), barW, Math.abs(zeroY - histY));
    });
  }

  // ── MACD line ─────────────────────────────────────────────────
  if (p.showMACD) {
    ctx.strokeStyle = p.macdColor; ctx.lineWidth = p.macdWidth || 2.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.95;
    ctx.beginPath();
    let started = false;
    visibleData.forEach((candle, idx) => {
      if (candle.macdLine == null) return;
      const x = padding.left + (idx + 0.5) * candleWidth;
      const y = valueToY(candle.macdLine);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  // ── Signal line ───────────────────────────────────────────────
  if (p.showSignal) {
    ctx.strokeStyle = p.signalColor; ctx.lineWidth = p.signalWidth || 2.5;
    ctx.setLineDash([5, 3]); ctx.globalAlpha = 0.95;
    ctx.beginPath();
    let started = false;
    visibleData.forEach((candle, idx) => {
      if (candle.signalLine == null) return;
      const x = padding.left + (idx + 0.5) * candleWidth;
      const y = valueToY(candle.signalLine);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // ── End-of-line value labels ──────────────────────────────────
  const lastIdx = visibleData.length - 1;
  if (lastIdx >= 0) {
    const candle = visibleData[lastIdx];
    const x = padding.left + (lastIdx + 0.5) * candleWidth;
    const labelX = Math.min(x + 8, width - padding.right - 40);
    ctx.font = _mcdFont('bold 10px "DM Sans", sans-serif'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (p.showMACD && candle.macdLine != null) {
      ctx.fillStyle = p.macdColor;
      ctx.fillText(candle.macdLine.toFixed(3), labelX, valueToY(candle.macdLine));
    }
    if (p.showSignal && candle.signalLine != null) {
      ctx.fillStyle = p.signalColor;
      ctx.fillText(candle.signalLine.toFixed(3), labelX, valueToY(candle.signalLine) + 14);
    }
  }
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsMACD(candle) {
  if (!enabledIndicators.includes('MACD')) return '';
  const p = macdParams;
  const parts = [];
  if (p.showMACD      && candle.macdLine   != null) parts.push({ val: candle.macdLine.toFixed(3),   color: p.macdColor });
  if (p.showSignal    && candle.signalLine != null) parts.push({ val: candle.signalLine.toFixed(3), color: p.signalColor });
  if (p.showHistogram && candle.histogram  != null) parts.push({ val: candle.histogram.toFixed(3),  color: candle.histogram >= 0 ? p.histUpColor : p.histDownColor });
  const collapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes('MACD');
  return _legendIndRow(`MACD ${p.fastLength} ${p.slowLength} ${p.signalLength}`, parts, { paneKey: 'MACD', visible: !collapsed });
}