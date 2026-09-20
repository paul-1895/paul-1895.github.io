/* ════════════════════════════════════════════════════════════
   indicators/moving-averages-extra.js
   Additional moving-average-family overlays: WMA, HMA, DEMA,
   TEMA, KAMA, ALMA, VWMA, MA Ribbon, MA Cross.

   Each is registered as a multi-instance price-pane overlay in
   INDICATOR_DEFS (indicator-instances.js) — this file only owns
   the math (calculateX) plus the small drawing helpers that
   don't already exist there (ribbon fan, cross markers).

   Provides:
     calculateWMA, calculateHMA, calculateDEMA, calculateTEMA,
     calculateKAMA, calculateALMA, calculateVWMA

   Depends on : indicators/ma.js (calculateEMA, reused by
                DEMA/TEMA), candlestick-data.js
   Consumed by: indicator-instances.js (INDICATOR_DEFS entries)
   ════════════════════════════════════════════════════════════ */

// ─── Math ──────────────────────────────────────────────────────

// Linearly-weighted moving average — most recent bar weighted
// heaviest. Tolerates leading `null`s in `prices` (any window that
// contains one resolves to null), so it doubles as the second pass
// of Hull MA, whose input series is itself null until its own warm-up.
function calculateWMA(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    let weightedSum = 0, weightSum = 0, hasNull = false;
    for (let j = 0; j < period; j++) {
      const v = prices[i - j];
      if (v == null) { hasNull = true; break; }
      const weight = period - j;
      weightedSum += v * weight;
      weightSum += weight;
    }
    return hasNull ? null : weightedSum / weightSum;
  });
}

// Hull MA: WMA(2*WMA(n/2) - WMA(n), sqrt(n)) — reduces lag vs a plain WMA.
function calculateHMA(prices, period) {
  const halfPeriod = Math.max(1, Math.round(period / 2));
  const sqrtPeriod = Math.max(1, Math.round(Math.sqrt(period)));
  const wmaHalf = calculateWMA(prices, halfPeriod);
  const wmaFull = calculateWMA(prices, period);
  const diff = prices.map((_, i) =>
    (wmaHalf[i] != null && wmaFull[i] != null) ? 2 * wmaHalf[i] - wmaFull[i] : null
  );
  return calculateWMA(diff, sqrtPeriod);
}

// Double EMA: 2*EMA(n) - EMA(EMA(n)) — less lag than a plain EMA.
function calculateDEMA(prices, period) {
  const ema1 = calculateEMA(prices, period);
  const ema2 = calculateEMA(ema1, period);
  return prices.map((_, i) => 2 * ema1[i] - ema2[i]);
}

// Triple EMA: 3*EMA1 - 3*EMA2 + EMA3.
function calculateTEMA(prices, period) {
  const ema1 = calculateEMA(prices, period);
  const ema2 = calculateEMA(ema1, period);
  const ema3 = calculateEMA(ema2, period);
  return prices.map((_, i) => 3 * ema1[i] - 3 * ema2[i] + ema3[i]);
}

// Kaufman Adaptive MA — smoothing constant adapts to the efficiency
// ratio (net change / sum of absolute bar-to-bar changes) so it
// tracks fast in trends and flattens out in chop.
function calculateKAMA(prices, period = 10, fastEnd = 2, slowEnd = 30) {
  const n = prices.length;
  const kama = new Array(n).fill(null);
  if (n <= period) return kama;
  const fastSC = 2 / (fastEnd + 1);
  const slowSC = 2 / (slowEnd + 1);
  kama[period] = prices[period];
  for (let i = period + 1; i < n; i++) {
    const change = Math.abs(prices[i] - prices[i - period]);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) volatility += Math.abs(prices[j] - prices[j - 1]);
    const er = volatility === 0 ? 0 : change / volatility;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    kama[i] = kama[i - 1] + sc * (prices[i] - kama[i - 1]);
  }
  return kama;
}

// Arnaud Legoux MA — Gaussian-weighted window shifted toward the
// recent end by `offset` (0-1), smoothed by `sigma`.
function calculateALMA(prices, period = 9, offset = 0.85, sigma = 6) {
  const m = offset * (period - 1);
  const s = period / sigma;
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    let wtSum = 0, sum = 0;
    for (let j = 0; j < period; j++) {
      const w = Math.exp(-((j - m) ** 2) / (2 * s * s));
      sum += prices[i - period + 1 + j] * w;
      wtSum += w;
    }
    return wtSum === 0 ? null : sum / wtSum;
  });
}

// Volume Weighted MA — needs candle objects (Volume), not a bare
// price array, so it resolves its own source per bar via resolveSource
// (indicator-instances.js) rather than going through getSourceSeries first.
function calculateVWMA(data, period = 20, source = 'Close') {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let pvSum = 0, vSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const price = resolveSource(data[j], source);
      pvSum += price * (data[j].Volume || 0);
      vSum += (data[j].Volume || 0);
    }
    return vSum === 0 ? null : pvSum / vSum;
  });
}
