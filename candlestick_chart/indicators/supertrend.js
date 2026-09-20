/* ════════════════════════════════════════════════════════════
   indicators/supertrend.js
   Supertrend (ATR period 10, factor 3) — price-pane overlay.

   This file only owns the indicator itself (the line + the
   support/resistance shading). The buy/sell crossover strategy
   built on top of it — signal detection, chart markers, and the
   trade P&L table — lives separately under strategies/, since
   it's a distinct concern: you can show the Supertrend line
   without the strategy active, or vice versa.

   Provides:
     calculateATR(data, period)
     calculateSupertrend(data, atrPeriod, factor)
     attachSupertrend(data)
     drawSupertrendOverlay(...)
     legendRowsSupertrend(candle)

   Depends on : candlestick-data.js (global: enabledIndicators),
                candlestick-legend.js (_legendIndRow)
   Consumed by: candlestick-data.js (attachIndicators),
                candlestick-draw.js (drawPriceSection),
                candlestick-legend.js (renderChartLegend),
                strategies/supertrend-strategy.js (reads
                  candle.supertrendTrend, SUPERTREND_COLORS)

   NOTE: in the original single-file version, Supertrend was
   calculated and shown in the hover legend, but the draw call
   was never wired into drawPriceSection() — so the line never
   actually rendered on the chart. That's fixed here: enabling
   "Supertrend" in the indicators modal now draws it too.
   ════════════════════════════════════════════════════════════ */

// Supertrend has no colour picker of its own, so up/down simply follow
// the global gain/loss palette (shared/chart-theme.js resolves --gain /
// --loss; the literals below are the fallback when it isn't loaded).
// Getters rather than fixed strings: the palette can change mid-session
// and these objects are captured by reference in several draw paths.
const _stTheme = window.DSEChartTheme;
const SUPERTREND_COLORS = {
  get up()   { return _stTheme ? _stTheme.gain('#10b981') : '#10b981'; },
  get down() { return _stTheme ? _stTheme.loss('#ef4444') : '#ef4444'; },
};
const SUPERTREND_FILL = {
  get up()   { return _stTheme ? _stTheme.alpha(_stTheme.gain('#10b981'), 0.12) : 'rgba(16,185,129,0.12)'; },
  get down() { return _stTheme ? _stTheme.alpha(_stTheme.loss('#ef4444'), 0.12) : 'rgba(239,68,68,0.12)'; },
};

// ─── Math ──────────────────────────────────────────────────────
function calculateATR(data, period = 14) {
  const tr = [];
  for (let i = 0; i < data.length; i++) {
    const h = data[i].High;
    const l = data[i].Low;
    const c = i === 0 ? data[i].Close : data[i - 1].Close;

    const tr1 = h - l;
    const tr2 = Math.abs(h - c);
    const tr3 = Math.abs(l - c);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  const atr = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
  atr[period - 1] = sum / period;

  for (let i = period; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calculateSupertrend(data, atrPeriod = 10, factor = 3) {
  const atr = calculateATR(data, atrPeriod);
  const hl2 = data.map(c => (c.High + c.Low) / 2);

  const finalUB    = new Array(data.length);
  const finalLB    = new Array(data.length);
  const supertrend = new Array(data.length);
  const trend      = new Array(data.length);

  for (let i = 0; i < data.length; i++) {
    if (atr[i] == null) {
      supertrend[i] = null;
      trend[i] = null;
      continue;
    }

    const basicUB = hl2[i] + factor * atr[i];
    const basicLB = hl2[i] - factor * atr[i];

    // The first row with a valid ATR is the real seed point — NOT i === 0.
    // With a 10-period ATR, atr[0..8] are null (continue, above), so the
    // first row to reach this point is i === 9. finalUB[i-1]/finalLB[i-1]
    // are still undefined at that point, so seed here instead of comparing
    // against them (comparisons against undefined are always false, which
    // would otherwise leave finalUB/finalLB — and therefore supertrend —
    // stuck at undefined for every subsequent candle).
    const isFirstValid = finalUB[i - 1] === undefined;

    if (isFirstValid) {
      finalUB[i] = basicUB;
      finalLB[i] = basicLB;
    } else {
      finalUB[i] = basicUB < finalUB[i - 1] || data[i - 1].Close > finalUB[i - 1] ? basicUB : finalUB[i - 1];
      finalLB[i] = basicLB > finalLB[i - 1] || data[i - 1].Close < finalLB[i - 1] ? basicLB : finalLB[i - 1];
    }

    if (isFirstValid) {
      trend[i] = 1; // assume uptrend initially
      supertrend[i] = finalLB[i];
    } else {
      if (trend[i - 1] === 1) {
        trend[i] = data[i].Close <= finalLB[i] ? -1 : 1;
      } else {
        trend[i] = data[i].Close >= finalUB[i] ? 1 : -1;
      }
      supertrend[i] = trend[i] === 1 ? finalLB[i] : finalUB[i];
    }
  }

  return { supertrend, trend, atr };
}

// ─── Attach to candle data ─────────────────────────────────────
function attachSupertrend(data) {
  const result = calculateSupertrend(data, 10, 3);
  data.forEach((candle, i) => {
    candle.supertrend      = result.supertrend[i];
    candle.supertrendTrend = result.trend[i];
  });
}

// ─── Drawing (price-pane overlay) ───────────────────────────────
function drawSupertrendOverlay(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0  = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  // ── Shaded zone between the line and price ──────────────────────
  // In an uptrend the line sits below price and acts as support, so
  // the zone is filled up to each candle's Low. In a downtrend the
  // line sits above price as resistance, filled down to each High.
  let i = 0;
  while (i < visibleData.length) {
    const candle = visibleData[i];
    if (candle.supertrend == null) { i++; continue; }

    const trend = candle.supertrendTrend;
    let j = i;
    while (j < visibleData.length && visibleData[j].supertrend != null && visibleData[j].supertrendTrend === trend) j++;

    const linePts  = [];
    const pricePts = [];
    for (let k = i; k < j; k++) {
      const c = visibleData[k];
      const x = padding.left + (k + 0.5) * candleWidth;
      linePts.push({ x, y: toY(c.supertrend) });
      pricePts.push({ x, y: trend === 1 ? toY(c.Low) : toY(c.High) });
    }

    ctx.beginPath();
    ctx.moveTo(linePts[0].x, linePts[0].y);
    linePts.forEach(p => ctx.lineTo(p.x, p.y));
    for (let k = pricePts.length - 1; k >= 0; k--) ctx.lineTo(pricePts[k].x, pricePts[k].y);
    ctx.closePath();
    ctx.fillStyle = trend === 1 ? SUPERTREND_FILL.up : SUPERTREND_FILL.down;
    ctx.fill();

    i = j;
  }

  // ── The Supertrend line itself ──────────────────────────────────
  ctx.lineWidth = 1.5;
  ctx.lineCap   = 'round';
  ctx.lineJoin  = 'round';

  // Draw one continuous segment per trend run, so the color
  // flips cleanly at each trend change instead of blending.
  i = 0;
  while (i < visibleData.length) {
    const candle = visibleData[i];
    if (candle.supertrend == null) { i++; continue; }

    const trend = candle.supertrendTrend;
    ctx.strokeStyle = trend === 1 ? SUPERTREND_COLORS.up : SUPERTREND_COLORS.down;

    let j = i;
    while (j < visibleData.length && visibleData[j].supertrend != null && visibleData[j].supertrendTrend === trend) j++;

    ctx.beginPath();
    for (let k = i; k < j; k++) {
      const c = visibleData[k];
      const x = padding.left + (k + 0.5) * candleWidth;
      const y = toY(c.supertrend);
      if (k === i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    i = j;
  }
}

// ─── Legend ─────────────────────────────────────────────────────
function legendRowsSupertrend(candle) {
  if (!enabledIndicators.includes('Supertrend')) return '';
  const color = candle.supertrendTrend === 1 ? SUPERTREND_COLORS.up : SUPERTREND_COLORS.down;
  const trendLabel = candle.supertrendTrend === 1 ? 'UP' : 'DOWN';
  return _legendIndRow('Supertrend 10 3', [
    { val: candle.supertrend != null ? candle.supertrend.toFixed(2) : null, color },
    { val: trendLabel, color },
  ]);
}