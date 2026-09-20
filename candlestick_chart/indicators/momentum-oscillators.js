/* ════════════════════════════════════════════════════════════
   indicators/momentum-oscillators.js
   Momentum-oscillator sub-pane indicators, built on the generic
   sub-pane framework (indicators/subpane-framework.js).

   Starts with Stochastic — the proof case for that framework.
   The remaining momentum oscillators from the TradingView
   reference list (Stochastic RSI, Williams %R, CCI, ROC, ...)
   are added the same way in a later pass.

   Provides:
     calculateStochastic(data, kPeriod, kSmooth, dPeriod)

   Depends on : indicators/ma.js (calculateSMASafe)
   Consumed by: indicator-instances.js (INDICATOR_DEFS.Stochastic)
   ════════════════════════════════════════════════════════════ */

function calculateStochastic(data, kPeriod = 14, kSmooth = 1, dPeriod = 3) {
  const n = data.length;
  const rawK = new Array(n).fill(null);
  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hi = Math.max(hi, data[j].High);
      lo = Math.min(lo, data[j].Low);
    }
    rawK[i] = hi === lo ? 50 : ((data[i].Close - lo) / (hi - lo)) * 100;
  }
  const k = kSmooth > 1 ? calculateSMASafe(rawK, kSmooth) : rawK;
  const d = calculateSMASafe(k, dPeriod);
  return { k, d };
}

// ─── Stochastic RSI — Stochastic formula applied to RSI, not price ──
function calculateStochasticRSI(data, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const closes = data.map(c => c.Close);
  const rsi = calculateRSI(closes, rsiPeriod);
  const n = data.length;
  const rawK = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (rsi[i] == null || i - stochPeriod + 1 < 0) continue;
    let lo = Infinity, hi = -Infinity, ok = true;
    for (let j = i - stochPeriod + 1; j <= i; j++) {
      if (rsi[j] == null) { ok = false; break; }
      lo = Math.min(lo, rsi[j]); hi = Math.max(hi, rsi[j]);
    }
    if (!ok) continue;
    rawK[i] = hi === lo ? 50 : ((rsi[i] - lo) / (hi - lo)) * 100;
  }
  const k = calculateSMASafe(rawK, kSmooth);
  const d = calculateSMASafe(k, dPeriod);
  return { k, d };
}

// ─── Williams %R ──────────────────────────────────────────────────
function calculateWilliamsR(data, period = 14) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hi = Math.max(hi, data[j].High); lo = Math.min(lo, data[j].Low); }
    return hi === lo ? -50 : ((hi - data[i].Close) / (hi - lo)) * -100;
  });
}

// ─── CCI (Commodity Channel Index) ───────────────────────────────
function calculateCCI(data, period = 20) {
  const tp = data.map(c => (c.High + c.Low + c.Close) / 3);
  const sma = calculateSMA(tp, period);
  return tp.map((v, i) => {
    if (i < period - 1) return null;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - sma[i]);
    meanDev /= period;
    return meanDev === 0 ? 0 : (v - sma[i]) / (0.015 * meanDev);
  });
}

// ─── ROC (Rate of Change, %) ──────────────────────────────────────
function calculateROC(prices, period = 9) {
  return prices.map((_, i) => (i < period || prices[i - period] === 0) ? null : ((prices[i] - prices[i - period]) / prices[i - period]) * 100);
}

// ─── Momentum (raw price difference) ──────────────────────────────
function calculateMomentum(prices, period = 10) {
  return prices.map((_, i) => i < period ? null : prices[i] - prices[i - period]);
}

// ─── Awesome Oscillator: SMA(5) - SMA(34) of the bar midpoint ────
function calculateAwesomeOscillator(data) {
  const mid = data.map(c => (c.High + c.Low) / 2);
  const sma5 = calculateSMA(mid, 5);
  const sma34 = calculateSMA(mid, 34);
  return mid.map((_, i) => (sma5[i] != null && sma34[i] != null) ? sma5[i] - sma34[i] : null);
}

// ─── Accelerator Oscillator: AO - SMA(5) of AO ───────────────────
function calculateAcceleratorOscillator(data) {
  const ao = calculateAwesomeOscillator(data);
  const smaAo = calculateSMASafe(ao, 5);
  return ao.map((v, i) => (v != null && smaAo[i] != null) ? v - smaAo[i] : null);
}

// ─── Ultimate Oscillator ──────────────────────────────────────────
function calculateUltimateOscillator(data, p1 = 7, p2 = 14, p3 = 28) {
  const n = data.length;
  const bp = new Array(n).fill(null);
  const tr = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const priorClose = data[i - 1].Close;
    const lo = Math.min(data[i].Low, priorClose);
    const hi = Math.max(data[i].High, priorClose);
    bp[i] = data[i].Close - lo;
    tr[i] = hi - lo;
  }
  function avgRatio(period) {
    return data.map((_, i) => {
      if (i < period) return null;
      let bpSum = 0, trSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        if (bp[j] == null) return null;
        bpSum += bp[j]; trSum += tr[j];
      }
      return trSum === 0 ? 0 : bpSum / trSum;
    });
  }
  const avg1 = avgRatio(p1), avg2 = avgRatio(p2), avg3 = avgRatio(p3);
  return data.map((_, i) => {
    if (avg1[i] == null || avg2[i] == null || avg3[i] == null) return null;
    return 100 * (4 * avg1[i] + 2 * avg2[i] + avg3[i]) / 7;
  });
}

// ─── Relative Vigor Index (momentum "RVI") ────────────────────────
function calculateRVIVigor(data, period = 10) {
  const n = data.length;
  const num = new Array(n).fill(null);
  const den = new Array(n).fill(null);
  for (let i = 3; i < n; i++) {
    const c0 = data[i].Close - data[i].Open, c1 = data[i - 1].Close - data[i - 1].Open;
    const c2 = data[i - 2].Close - data[i - 2].Open, c3 = data[i - 3].Close - data[i - 3].Open;
    const r0 = data[i].High - data[i].Low, r1 = data[i - 1].High - data[i - 1].Low;
    const r2 = data[i - 2].High - data[i - 2].Low, r3 = data[i - 3].High - data[i - 3].Low;
    num[i] = (c0 + 2 * c1 + 2 * c2 + c3) / 6;
    den[i] = (r0 + 2 * r1 + 2 * r2 + r3) / 6;
  }
  const numSma = calculateSMASafe(num, period);
  const denSma = calculateSMASafe(den, period);
  const rvi = numSma.map((v, i) => (v != null && denSma[i]) ? v / denSma[i] : null);
  const signal = new Array(n).fill(null);
  for (let i = 3; i < n; i++) {
    if ([0, 1, 2, 3].some(k => rvi[i - k] == null)) continue;
    signal[i] = (rvi[i] + 2 * rvi[i - 1] + 2 * rvi[i - 2] + rvi[i - 3]) / 6;
  }
  return { rvi, signal };
}

// ─── Connors RSI: RSI(close) + RSI(streak) + PercentRank(1-day ROC) ─
function calculateConnorsRSI(data, rsiPeriod = 3, streakPeriod = 2, rankPeriod = 100) {
  const closes = data.map(c => c.Close);
  const n = closes.length;
  const rsiClose = calculateRSI(closes, rsiPeriod);

  const streak = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (closes[i] > closes[i - 1]) streak[i] = streak[i - 1] > 0 ? streak[i - 1] + 1 : 1;
    else if (closes[i] < closes[i - 1]) streak[i] = streak[i - 1] < 0 ? streak[i - 1] - 1 : -1;
    else streak[i] = 0;
  }
  const rsiStreak = calculateRSI(streak, streakPeriod);

  const roc1 = closes.map((v, i) => (i === 0 || closes[i - 1] === 0) ? null : (v - closes[i - 1]) / closes[i - 1]);
  const percentRank = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (roc1[i] == null) continue;
    const start = Math.max(1, i - rankPeriod + 1);
    const windowVals = roc1.slice(start, i + 1).filter(v => v != null);
    if (!windowVals.length) continue;
    const countBelow = windowVals.filter(v => v < roc1[i]).length;
    percentRank[i] = (countBelow / windowVals.length) * 100;
  }

  return closes.map((_, i) => (rsiClose[i] == null || rsiStreak[i] == null || percentRank[i] == null)
    ? null : (rsiClose[i] + rsiStreak[i] + percentRank[i]) / 3);
}

// ─── CMO (Chande Momentum Oscillator) ─────────────────────────────
function calculateCMO(prices, period = 9) {
  return prices.map((_, i) => {
    if (i < period) return null;
    let sumUp = 0, sumDown = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = prices[j] - prices[j - 1];
      if (diff > 0) sumUp += diff; else sumDown -= diff;
    }
    return (sumUp + sumDown) === 0 ? 0 : ((sumUp - sumDown) / (sumUp + sumDown)) * 100;
  });
}

// ─── Fisher Transform ──────────────────────────────────────────────
function calculateFisherTransform(data, period = 9) {
  const n = data.length;
  const mid = data.map(c => (c.High + c.Low) / 2);
  const value = new Array(n).fill(0);
  const fish = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i < period - 1) continue;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hi = Math.max(hi, mid[j]); lo = Math.min(lo, mid[j]); }
    const raw = hi === lo ? 0 : ((mid[i] - lo) / (hi - lo)) * 2 - 1;
    const prevValue = i > 0 ? value[i - 1] : 0;
    value[i] = Math.max(-0.999, Math.min(0.999, 0.33 * raw + 0.67 * prevValue));
    const prevFish = (i > 0 && fish[i - 1] != null) ? fish[i - 1] : 0;
    fish[i] = 0.5 * Math.log((1 + value[i]) / (1 - value[i])) + 0.5 * prevFish;
  }
  const signal = new Array(n).fill(null);
  for (let i = 1; i < n; i++) signal[i] = fish[i - 1];
  return { fish, signal };
}

// ─── DPO (Detrended Price Oscillator) ─────────────────────────────
function calculateDPO(prices, period = 20) {
  const sma = calculateSMA(prices, period);
  const shift = Math.floor(period / 2) + 1;
  return prices.map((v, i) => {
    const idx = i - shift;
    if (idx < 0 || sma[idx] == null) return null;
    return v - sma[idx];
  });
}

// ─── PPO (Percentage Price Oscillator) — MACD expressed as a % ───
function calculatePPO(prices, fast = 12, slow = 26, signal = 9) {
  const emaFast = calculateEMA(prices, fast);
  const emaSlow = calculateEMA(prices, slow);
  const ppoLine = emaFast.map((v, i) => emaSlow[i] ? ((v - emaSlow[i]) / emaSlow[i]) * 100 : 0);
  const signalLine = calculateEMA(ppoLine, signal);
  const histogram = ppoLine.map((v, i) => v - signalLine[i]);
  return { ppoLine, signalLine, histogram };
}
