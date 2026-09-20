/* ════════════════════════════════════════════════════════════
   indicators/trend-overlays-extra.js
   Additional price-pane overlay indicators: Parabolic SAR,
   Donchian Channels, Linear Regression (+ channel), Keltner
   Channels, ATR Bands, Volatility Stop, VWAP, Anchored VWAP,
   MA Ribbon, MA Cross.

   Registered as multi-instance overlays in INDICATOR_DEFS
   (indicator-instances.js) — this file only owns the math.

   Depends on : indicators/ma.js (calculateEMA), indicators/
                supertrend.js (calculateATR), indicator-instances.js
                (resolveSource)
   Consumed by: indicator-instances.js (INDICATOR_DEFS entries)
   ════════════════════════════════════════════════════════════ */

// ─── Parabolic SAR ───────────────────────────────────────────────
function calculateParabolicSAR(data, step = 0.02, maxStep = 0.2) {
  const n = data.length;
  const sar = new Array(n).fill(null);
  const trend = new Array(n).fill(null); // 1 = up, -1 = down
  if (n < 2) return { sar, trend };

  let isUp = data[1].Close >= data[0].Close;
  let af = step;
  let ep = isUp ? data[0].High : data[0].Low;
  let sarVal = isUp ? data[0].Low : data[0].High;
  sar[0] = sarVal;
  trend[0] = isUp ? 1 : -1;

  for (let i = 1; i < n; i++) {
    let nextSar = sarVal + af * (ep - sarVal);
    const prevLow  = data[i - 1].Low;
    const prevHigh = data[i - 1].High;
    const prev2Low  = i >= 2 ? data[i - 2].Low  : prevLow;
    const prev2High = i >= 2 ? data[i - 2].High : prevHigh;

    if (isUp) {
      nextSar = Math.min(nextSar, prevLow, prev2Low);
      if (data[i].Low < nextSar) {
        isUp = false; nextSar = ep; ep = data[i].Low; af = step;
      } else if (data[i].High > ep) {
        ep = data[i].High; af = Math.min(af + step, maxStep);
      }
    } else {
      nextSar = Math.max(nextSar, prevHigh, prev2High);
      if (data[i].High > nextSar) {
        isUp = true; nextSar = ep; ep = data[i].High; af = step;
      } else if (data[i].Low < ep) {
        ep = data[i].Low; af = Math.min(af + step, maxStep);
      }
    }
    sarVal = nextSar;
    sar[i] = sarVal;
    trend[i] = isUp ? 1 : -1;
  }
  return { sar, trend };
}

// ─── Donchian Channels ───────────────────────────────────────────
function calculateDonchianChannels(data, period = 20) {
  const n = data.length;
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const middle = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, data[j].High);
      lo = Math.min(lo, data[j].Low);
    }
    upper[i] = hi; lower[i] = lo; middle[i] = (hi + lo) / 2;
  }
  return { upper, middle, lower };
}

// ─── Linear Regression (+ channel) ───────────────────────────────
function calculateLinearRegression(prices, period = 100, channelMult = 2) {
  const n = prices.length;
  const line  = new Array(n).fill(null);
  const upper = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const xMean = (period - 1) / 2;
    const yMean = slice.reduce((a, b) => a + b, 0) / period;
    let num = 0, den = 0;
    for (let j = 0; j < period; j++) { num += (j - xMean) * (slice[j] - yMean); den += (j - xMean) ** 2; }
    const slope = den === 0 ? 0 : num / den;
    const intercept = yMean - slope * xMean;
    const forecast = intercept + slope * (period - 1);
    line[i] = forecast;
    const residuals = slice.map((v, j) => v - (intercept + slope * j));
    const stdErr = Math.sqrt(residuals.reduce((a, b) => a + b * b, 0) / period);
    upper[i] = forecast + channelMult * stdErr;
    lower[i] = forecast - channelMult * stdErr;
  }
  return { line, upper, lower };
}

// ─── Keltner Channels (EMA of source ± ATR multiple) ─────────────
function calculateKeltnerChannels(data, period = 20, atrPeriod = 10, multiplier = 2, source = 'Close') {
  const src = data.map(c => resolveSource(c, source));
  const middle = calculateEMA(src, period);
  const atr = calculateATR(data, atrPeriod);
  const upper = middle.map((m, i) => atr[i] != null ? m + multiplier * atr[i] : null);
  const lower = middle.map((m, i) => atr[i] != null ? m - multiplier * atr[i] : null);
  return { upper, middle, lower };
}

// ─── ATR Bands (source ± ATR multiple, no smoothing on the source) ──
function calculateATRBands(data, atrPeriod = 14, multiplier = 2.5, source = 'Close') {
  const src = data.map(c => resolveSource(c, source));
  const atr = calculateATR(data, atrPeriod);
  const upper = src.map((v, i) => atr[i] != null ? v + multiplier * atr[i] : null);
  const lower = src.map((v, i) => atr[i] != null ? v - multiplier * atr[i] : null);
  return { upper, lower };
}

// ─── Volatility Stop (ATR-trailing stop-and-reverse) ─────────────
function calculateVolatilityStop(data, atrPeriod = 20, factor = 2) {
  const atr = calculateATR(data, atrPeriod);
  const n = data.length;
  const stop  = new Array(n).fill(null);
  const trend = new Array(n).fill(null);
  let uptrend = true, maxPrice = 0, minPrice = 0, stopVal = null;

  for (let i = 0; i < n; i++) {
    if (atr[i] == null) continue;
    if (stopVal == null) {
      uptrend = true;
      maxPrice = data[i].High; minPrice = data[i].Low;
      stopVal = data[i].Low - factor * atr[i];
      stop[i] = stopVal; trend[i] = 1;
      continue;
    }
    if (uptrend) {
      maxPrice = Math.max(maxPrice, data[i].High);
      stopVal = Math.max(stopVal, maxPrice - factor * atr[i]);
      if (data[i].Close < stopVal) {
        uptrend = false; minPrice = data[i].Low; stopVal = minPrice + factor * atr[i];
      }
    } else {
      minPrice = Math.min(minPrice, data[i].Low);
      stopVal = Math.min(stopVal, minPrice + factor * atr[i]);
      if (data[i].Close > stopVal) {
        uptrend = true; maxPrice = data[i].High; stopVal = maxPrice - factor * atr[i];
      }
    }
    stop[i] = stopVal;
    trend[i] = uptrend ? 1 : -1;
  }
  return { stop, trend };
}

// ─── VWAP (periodic anchor reset) ─────────────────────────────────
function _vwapAnchorKey(dateStr, anchor) {
  const d = new Date(String(dateStr).replace(/\//g, '-') + 'T00:00:00Z');
  switch (anchor) {
    case 'Week': {
      const day  = d.getUTCDay();
      const diff = day === 0 ? 6 : day - 1; // days since Monday
      const monday = new Date(d.getTime());
      monday.setUTCDate(d.getUTCDate() - diff);
      return monday.toISOString().slice(0, 10);
    }
    case 'Month':   return `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    case 'Quarter': return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3)}`;
    case 'Year':    return `${d.getUTCFullYear()}`;
    case 'Session':
    default:        return d.toISOString().slice(0, 10);
  }
}

function calculateVWAP(data, anchor = 'Month') {
  const n = data.length;
  const vwap = new Array(n).fill(null);
  let cumPV = 0, cumV = 0, curKey = null;
  for (let i = 0; i < n; i++) {
    const key = _vwapAnchorKey(data[i].Date, anchor);
    if (key !== curKey) { curKey = key; cumPV = 0; cumV = 0; }
    const typical = (data[i].High + data[i].Low + data[i].Close) / 3;
    cumPV += typical * (data[i].Volume || 0);
    cumV  += (data[i].Volume || 0);
    vwap[i] = cumV === 0 ? typical : cumPV / cumV;
  }
  return vwap;
}

// ─── Anchored VWAP (cumulative from a user-chosen date) ──────────
function calculateAnchoredVWAP(data, anchorDate) {
  const n = data.length;
  const vwap = new Array(n).fill(null);
  const anchorTime = anchorDate ? new Date(String(anchorDate).replace(/\//g, '-') + 'T00:00:00Z').getTime() : null;
  let started = anchorTime == null || isNaN(anchorTime);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < n; i++) {
    if (!started) {
      const t = new Date(String(data[i].Date).replace(/\//g, '-') + 'T00:00:00Z').getTime();
      if (t >= anchorTime) started = true;
    }
    if (!started) continue;
    const typical = (data[i].High + data[i].Low + data[i].Close) / 3;
    cumPV += typical * (data[i].Volume || 0);
    cumV  += (data[i].Volume || 0);
    vwap[i] = cumV === 0 ? typical : cumPV / cumV;
  }
  return vwap;
}

// ─── MA Ribbon (N stacked MAs, fanned lengths) ───────────────────
function calculateMARibbon(data, source, maType, baseLength, step, count) {
  const src = data.map(c => resolveSource(c, source));
  const lines = [];
  for (let i = 0; i < count; i++) {
    const length = Math.max(1, Math.round(baseLength + i * step));
    const series = maType === 'EMA' ? calculateEMA(src, length)
                 : maType === 'WMA' ? calculateWMA(src, length)
                 : calculateSMA(src, length);
    lines.push(series);
  }
  return lines;
}

// ─── MA Cross (fast/slow + crossover markers) ────────────────────
function calculateMACross(data, source, maType, fastLength, slowLength) {
  const src = data.map(c => resolveSource(c, source));
  const calc = maType === 'EMA' ? calculateEMA : maType === 'WMA' ? calculateWMA : calculateSMA;
  const fast = calc(src, fastLength);
  const slow = calc(src, slowLength);
  const crossUp = new Array(data.length).fill(false);
  const crossDown = new Array(data.length).fill(false);
  for (let i = 1; i < data.length; i++) {
    if (fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null) continue;
    if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) crossUp[i] = true;
    if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) crossDown[i] = true;
  }
  return { fast, slow, crossUp, crossDown };
}
