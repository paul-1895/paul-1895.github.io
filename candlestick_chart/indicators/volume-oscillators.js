/* ════════════════════════════════════════════════════════════
   indicators/volume-oscillators.js
   Volume sub-pane indicators, built on the generic sub-pane
   framework (indicators/subpane-framework.js): OBV, Accumulation/
   Distribution, Chaikin Money Flow, Money Flow Index, Volume
   Oscillator, Ease of Movement, Force Index, Klinger Oscillator,
   NVI, PVI, PVT, Relative Volume (RVOL).

   Depends on : indicators/ma.js (calculateSMA, calculateEMA, calculateSMASafe)
   Consumed by: indicator-instances.js (INDICATOR_DEFS entries)
   ════════════════════════════════════════════════════════════ */

// ─── On-Balance Volume ─────────────────────────────────────────
function calculateOBV(data) {
  const n = data.length;
  const obv = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    if (data[i].Close > data[i - 1].Close) obv[i] = obv[i - 1] + (data[i].Volume || 0);
    else if (data[i].Close < data[i - 1].Close) obv[i] = obv[i - 1] - (data[i].Volume || 0);
    else obv[i] = obv[i - 1];
  }
  return obv;
}

// ─── Accumulation/Distribution ────────────────────────────────────
function calculateAD(data) {
  const n = data.length;
  const ad = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const h = data[i].High, l = data[i].Low, c = data[i].Close, v = data[i].Volume || 0;
    const mfm = (h === l) ? 0 : ((c - l) - (h - c)) / (h - l);
    ad[i] = (i === 0 ? 0 : ad[i - 1]) + mfm * v;
  }
  return ad;
}

// ─── Chaikin Money Flow ────────────────────────────────────────────
function calculateCMF(data, period = 20) {
  const mfv = data.map(c => {
    const h = c.High, l = c.Low, close = c.Close, v = c.Volume || 0;
    const mfm = (h === l) ? 0 : ((close - l) - (h - close)) / (h - l);
    return mfm * v;
  });
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sumMfv = 0, sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) { sumMfv += mfv[j]; sumVol += (data[j].Volume || 0); }
    return sumVol === 0 ? 0 : sumMfv / sumVol;
  });
}

// ─── Money Flow Index (RSI applied to volume-weighted typical price) ──
function calculateMFI(data, period = 14) {
  const n = data.length;
  const tp = data.map(c => (c.High + c.Low + c.Close) / 3);
  const rawMF = tp.map((v, i) => v * (data[i].Volume || 0));
  const mfi = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let posMF = 0, negMF = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) posMF += rawMF[j];
      else if (tp[j] < tp[j - 1]) negMF += rawMF[j];
    }
    if (negMF === 0) { mfi[i] = posMF === 0 ? 50 : 100; continue; }
    mfi[i] = 100 - (100 / (1 + posMF / negMF));
  }
  return mfi;
}

// ─── Volume Oscillator (% diff between fast/slow EMA of volume) ──
function calculateVolumeOscillator(data, fastLength = 5, slowLength = 20) {
  const vol = data.map(c => c.Volume || 0);
  const fast = calculateEMA(vol, fastLength);
  const slow = calculateEMA(vol, slowLength);
  return fast.map((v, i) => slow[i] ? ((v - slow[i]) / slow[i]) * 100 : null);
}

// ─── Ease of Movement ──────────────────────────────────────────────
function calculateEOM(data, period = 14, volDivisor = 10000) {
  const n = data.length;
  const raw = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const midMove = ((data[i].High + data[i].Low) / 2) - ((data[i - 1].High + data[i - 1].Low) / 2);
    const boxRatio = ((data[i].Volume || 0) / volDivisor) / (data[i].High - data[i].Low || 1);
    raw[i] = boxRatio === 0 ? 0 : midMove / boxRatio;
  }
  return calculateSMASafe(raw, period);
}

// ─── Force Index (Elder's Force Index) ────────────────────────────
function calculateForceIndex(data, period = 13) {
  const n = data.length;
  const raw = new Array(n).fill(0);
  for (let i = 1; i < n; i++) raw[i] = (data[i].Close - data[i - 1].Close) * (data[i].Volume || 0);
  return calculateEMA(raw, period);
}

// ─── Klinger Volume Oscillator ─────────────────────────────────────
function calculateKlinger(data, fastPeriod = 34, slowPeriod = 55, signalPeriod = 13) {
  const n = data.length;
  const trend = new Array(n).fill(1);
  const dm = data.map(c => c.High - c.Low);
  const cm = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const hlc = data[i].High + data[i].Low + data[i].Close;
    const prevHlc = data[i - 1].High + data[i - 1].Low + data[i - 1].Close;
    trend[i] = hlc > prevHlc ? 1 : -1;
    cm[i] = (trend[i] === trend[i - 1] ? cm[i - 1] : dm[i - 1] + dm[i]) + dm[i];
  }
  const vf = data.map((c, i) => {
    if (i === 0) return 0;
    const ratio = cm[i] !== 0 ? Math.abs(2 * (dm[i] / cm[i]) - 1) : 1;
    return (c.Volume || 0) * trend[i] * ratio * 100;
  });
  const emaFast = calculateEMA(vf, fastPeriod);
  const emaSlow = calculateEMA(vf, slowPeriod);
  const kvo = emaFast.map((v, i) => v - emaSlow[i]);
  const signal = calculateEMA(kvo, signalPeriod);
  return { kvo, signal };
}

// ─── Negative / Positive Volume Index ──────────────────────────────
function calculateNVI(data) {
  const n = data.length;
  const nvi = new Array(n).fill(1000);
  for (let i = 1; i < n; i++) {
    if ((data[i].Volume || 0) < (data[i - 1].Volume || 0)) {
      const pct = data[i - 1].Close ? (data[i].Close - data[i - 1].Close) / data[i - 1].Close : 0;
      nvi[i] = nvi[i - 1] * (1 + pct);
    } else {
      nvi[i] = nvi[i - 1];
    }
  }
  return nvi;
}

function calculatePVI(data) {
  const n = data.length;
  const pvi = new Array(n).fill(1000);
  for (let i = 1; i < n; i++) {
    if ((data[i].Volume || 0) > (data[i - 1].Volume || 0)) {
      const pct = data[i - 1].Close ? (data[i].Close - data[i - 1].Close) / data[i - 1].Close : 0;
      pvi[i] = pvi[i - 1] * (1 + pct);
    } else {
      pvi[i] = pvi[i - 1];
    }
  }
  return pvi;
}

// ─── Price Volume Trend ────────────────────────────────────────────
function calculatePVT(data) {
  const n = data.length;
  const pvt = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const pct = data[i - 1].Close ? (data[i].Close - data[i - 1].Close) / data[i - 1].Close : 0;
    pvt[i] = pvt[i - 1] + pct * (data[i].Volume || 0);
  }
  return pvt;
}

// ─── Relative Volume (current volume vs. its own N-bar average) ──
function calculateRVOL(data, period = 20) {
  const vol = data.map(c => c.Volume || 0);
  const avgVol = calculateSMA(vol, period);
  return vol.map((v, i) => avgVol[i] ? v / avgVol[i] : null);
}
