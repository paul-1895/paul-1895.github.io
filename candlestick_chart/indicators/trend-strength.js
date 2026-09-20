/* ════════════════════════════════════════════════════════════
   indicators/trend-strength.js
   Trend-strength sub-pane indicators, built on the generic
   sub-pane framework (indicators/subpane-framework.js): ADX/DMI,
   Aroon, Vortex, TRIX, KST, Mass Index, Linear Regression Slope,
   Chande Forecast Oscillator.

   Depends on : indicators/ma.js (calculateEMA, calculateSMASafe),
                indicators/momentum-oscillators.js (calculateROC),
                indicators/trend-overlays-extra.js (calculateLinearRegression)
   Consumed by: indicator-instances.js (INDICATOR_DEFS entries)
   ════════════════════════════════════════════════════════════ */

// ─── ADX / DMI ─────────────────────────────────────────────────
function calculateADXDMI(data, period = 14) {
  const n = data.length;
  const plusDM = new Array(n).fill(0);
  const minusDM = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const upMove = data[i].High - data[i - 1].High;
    const downMove = data[i - 1].Low - data[i].Low;
    plusDM[i]  = (upMove > downMove && upMove > 0) ? upMove : 0;
    minusDM[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    const h = data[i].High, l = data[i].Low, c = data[i - 1].Close;
    tr[i] = Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
  }
  // Wilder's smoothing (running sum minus its own average, plus new value).
  function wilderSmooth(arr) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i] || 0;
    out[period] = sum;
    for (let i = period + 1; i < arr.length; i++) out[i] = out[i - 1] - (out[i - 1] / period) + arr[i];
    return out;
  }
  const trS = wilderSmooth(tr), plusDMS = wilderSmooth(plusDM), minusDMS = wilderSmooth(minusDM);
  const plusDI  = trS.map((v, i) => (v && plusDMS[i] != null)  ? (plusDMS[i] / v) * 100  : null);
  const minusDI = trS.map((v, i) => (v && minusDMS[i] != null) ? (minusDMS[i] / v) * 100 : null);
  const dx = plusDI.map((p, i) => (p != null && minusDI[i] != null && (p + minusDI[i]) !== 0)
    ? (Math.abs(p - minusDI[i]) / (p + minusDI[i])) * 100 : null);
  const adx = calculateSMASafe(dx, period);
  return { plusDI, minusDI, adx };
}

// ─── Aroon ─────────────────────────────────────────────────────
function calculateAroon(data, period = 14) {
  const n = data.length;
  const up = new Array(n).fill(null);
  const down = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let hiIdx = 0, loIdx = 0, hi = -Infinity, lo = Infinity;
    for (let j = 0; j <= period; j++) {
      const idx = i - period + j;
      if (data[idx].High >= hi) { hi = data[idx].High; hiIdx = j; }
      if (data[idx].Low <= lo)  { lo = data[idx].Low;  loIdx = j; }
    }
    up[i]   = (hiIdx / period) * 100;
    down[i] = (loIdx / period) * 100;
  }
  return { up, down };
}

// ─── Vortex ────────────────────────────────────────────────────
function calculateVortex(data, period = 14) {
  const n = data.length;
  const vmPlus = new Array(n).fill(0);
  const vmMinus = new Array(n).fill(0);
  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    vmPlus[i]  = Math.abs(data[i].High - data[i - 1].Low);
    vmMinus[i] = Math.abs(data[i].Low  - data[i - 1].High);
    const h = data[i].High, l = data[i].Low, c = data[i - 1].Close;
    tr[i] = Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
  }
  const viPlus = new Array(n).fill(null);
  const viMinus = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let sumVmP = 0, sumVmM = 0, sumTr = 0;
    for (let j = i - period + 1; j <= i; j++) { sumVmP += vmPlus[j]; sumVmM += vmMinus[j]; sumTr += tr[j]; }
    viPlus[i]  = sumTr === 0 ? null : sumVmP / sumTr;
    viMinus[i] = sumTr === 0 ? null : sumVmM / sumTr;
  }
  return { viPlus, viMinus };
}

// ─── TRIX (rate of change of a triple-smoothed EMA) ──────────────
function calculateTRIX(prices, period = 15) {
  const ema1 = calculateEMA(prices, period);
  const ema2 = calculateEMA(ema1, period);
  const ema3 = calculateEMA(ema2, period);
  return ema3.map((v, i) => (i === 0 || !ema3[i - 1]) ? null : ((v - ema3[i - 1]) / ema3[i - 1]) * 100);
}

// ─── KST (Know Sure Thing) ────────────────────────────────────────
function calculateKST(prices, r1 = 10, r2 = 15, r3 = 20, r4 = 30, smaLen = 10, signalPeriod = 9) {
  const roc1 = calculateROC(prices, r1), roc2 = calculateROC(prices, r2);
  const roc3 = calculateROC(prices, r3), roc4 = calculateROC(prices, r4);
  const s1 = calculateSMASafe(roc1, smaLen), s2 = calculateSMASafe(roc2, smaLen);
  const s3 = calculateSMASafe(roc3, smaLen), s4 = calculateSMASafe(roc4, Math.round(smaLen * 1.5));
  const kst = prices.map((_, i) => {
    if (s1[i] == null || s2[i] == null || s3[i] == null || s4[i] == null) return null;
    return s1[i] * 1 + s2[i] * 2 + s3[i] * 3 + s4[i] * 4;
  });
  const signal = calculateSMASafe(kst, signalPeriod);
  return { kst, signal };
}

// ─── Mass Index ────────────────────────────────────────────────
function calculateMassIndex(data, period = 9, sumPeriod = 25) {
  const n = data.length;
  const hl = data.map(c => c.High - c.Low);
  const ema1 = calculateEMA(hl, period);
  const ema2 = calculateEMA(ema1, period);
  const ratio = ema1.map((v, i) => ema2[i] ? v / ema2[i] : null);
  const massIndex = new Array(n).fill(null);
  for (let i = sumPeriod - 1; i < n; i++) {
    let sum = 0, ok = true;
    for (let j = i - sumPeriod + 1; j <= i; j++) { if (ratio[j] == null) { ok = false; break; } sum += ratio[j]; }
    massIndex[i] = ok ? sum : null;
  }
  return massIndex;
}

// ─── Linear Regression Slope ──────────────────────────────────────
function calculateLinRegSlope(prices, period = 14) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    const slice = prices.slice(i - period + 1, i + 1);
    const xMean = (period - 1) / 2;
    const yMean = slice.reduce((a, b) => a + b, 0) / period;
    let num = 0, den = 0;
    for (let j = 0; j < period; j++) { num += (j - xMean) * (slice[j] - yMean); den += (j - xMean) ** 2; }
    return den === 0 ? 0 : num / den;
  });
}

// ─── Chande Forecast Oscillator ───────────────────────────────────
// % difference between price and the linear-regression forecast for that
// same bar — reuses calculateLinearRegression's `line` (trend-overlays-extra.js);
// the channel multiplier is irrelevant here so it's passed as 0.
function calculateChandeForecastOscillator(prices, period = 14) {
  const lr = calculateLinearRegression(prices, period, 0);
  return prices.map((v, i) => (lr.line[i] != null && v !== 0) ? ((v - lr.line[i]) / v) * 100 : null);
}
