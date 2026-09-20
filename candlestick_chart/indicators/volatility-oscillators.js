/* ════════════════════════════════════════════════════════════
   indicators/volatility-oscillators.js
   Volatility sub-pane indicators, built on the generic sub-pane
   framework (indicators/subpane-framework.js): Bollinger Band
   Width, ATR, Standard Deviation, Historical Volatility, Chaikin
   Volatility, Ulcer Index, Relative Volatility Index.

   Depends on : indicators/ma.js (calculateSMA, calculateEMA,
                calculateSMASafe), indicators/bollinger-bands.js
                (calculateBollingerBands), indicators/supertrend.js
                (calculateATR)
   Consumed by: indicator-instances.js (INDICATOR_DEFS entries)
   ════════════════════════════════════════════════════════════ */

// ─── Bollinger Band Width ─────────────────────────────────────────
function calculateBBWidth(prices, period = 20, stdDevMult = 2) {
  const bb = calculateBollingerBands(prices, period, stdDevMult);
  return bb.upper.map((u, i) => (u != null && bb.middle[i]) ? ((u - bb.lower[i]) / bb.middle[i]) * 100 : null);
}

// ─── Standard Deviation ────────────────────────────────────────────
function calculateStdDev(prices, period = 20) {
  const sma = calculateSMA(prices, period);
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (prices[j] - sma[i]) ** 2;
    return Math.sqrt(sumSq / period);
  });
}

// ─── Historical Volatility (annualized stdev of log returns, %) ──
function calculateHistoricalVolatility(prices, period = 10, annualFactor = 252) {
  const logReturns = prices.map((v, i) => (i === 0 || prices[i - 1] <= 0 || v <= 0) ? null : Math.log(v / prices[i - 1]));
  const n = prices.length;
  const hv = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const slice = logReturns.slice(i - period + 1, i + 1);
    if (slice.some(v => v == null)) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    hv[i] = Math.sqrt(variance) * Math.sqrt(annualFactor) * 100;
  }
  return hv;
}

// ─── Chaikin Volatility (% change of EMA(High-Low) over N bars) ──
function calculateChaikinVolatility(data, emaPeriod = 10, rocPeriod = 10) {
  const hl = data.map(c => c.High - c.Low);
  const emaHL = calculateEMA(hl, emaPeriod);
  return emaHL.map((v, i) => {
    const prevIdx = i - rocPeriod;
    if (prevIdx < 0 || !emaHL[prevIdx]) return null;
    return ((v - emaHL[prevIdx]) / emaHL[prevIdx]) * 100;
  });
}

// ─── Ulcer Index (RMS of drawdown-from-N-bar-high, %) ─────────────
function calculateUlcerIndex(prices, period = 14) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    let maxClose = -Infinity;
    for (let j = i - period + 1; j <= i; j++) maxClose = Math.max(maxClose, prices[j]);
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const dd = ((prices[j] - maxClose) / maxClose) * 100;
      sumSq += dd * dd;
    }
    return Math.sqrt(sumSq / period);
  });
}

// ─── Relative Volatility Index — RSI-style smoothing applied to
//     Standard Deviation instead of price (distinct from the
//     momentum "Relative Vigor Index", same RVI acronym) ─────────
function calculateRVIVolatility(prices, stdDevPeriod = 10, smoothPeriod = 14) {
  const stdDev = calculateStdDev(prices, stdDevPeriod);
  const n = prices.length;
  const upStd = new Array(n).fill(null);
  const downStd = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    if (stdDev[i] == null) continue;
    if (prices[i] > prices[i - 1])      { upStd[i] = stdDev[i]; downStd[i] = 0; }
    else if (prices[i] < prices[i - 1]) { upStd[i] = 0; downStd[i] = stdDev[i]; }
    else                                 { upStd[i] = 0; downStd[i] = 0; }
  }
  const upAvg = calculateSMASafe(upStd, smoothPeriod);
  const downAvg = calculateSMASafe(downStd, smoothPeriod);
  return prices.map((_, i) => {
    if (upAvg[i] == null || downAvg[i] == null) return null;
    const total = upAvg[i] + downAvg[i];
    return total === 0 ? 50 : (upAvg[i] / total) * 100;
  });
}
