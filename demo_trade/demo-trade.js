'use strict';

/* Theme is handled by the shared module, wired up in demo-trade.html. */

/* ────────────────────────────────────────────────────────────
   TREND PREDICTION QUIZ
   Shows a window of real historical daily candles for a random
   stock, hides its identity and the next 10 trading days, and
   asks the player to call the direction (Up / Down / Sideways).
   Everything is real price history sliced from /api/history —
   nothing here is fabricated or simulated.
──────────────────────────────────────────────────────────── */
const VISIBLE_CANDLES = 60;   // trading days shown before the guess
const FUTURE_CANDLES = 10;    // trading days revealed after the guess
const SIDEWAYS_BAND_PCT = 2;  // |% change| below this counts as "Sideways"
const STATS_KEY = 'dse_demo_trade_stats_v1';

let stockCodes = [];
let currentRound = null; // { code, visibleData, futureData, cutoffClose, futureClose, pctChange, outcome }
let hasGuessed = false;
let selectedDirection = null; // 'up' | 'down' | 'sideways' — chosen but not yet wagered on

// A wrong guess costs the same points a correct guess at that confidence
// would have won — a real wager, not just a bonus for correct answers.
const CONFIDENCE_POINTS = { low: 1, medium: 2, high: 3 };

function loadStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY));
    if (raw && typeof raw === 'object') {
      return { correct: raw.correct || 0, total: raw.total || 0, streak: raw.streak || 0, bestStreak: raw.bestStreak || 0, points: raw.points || 0 };
    }
  } catch { /* ignore */ }
  return { correct: 0, total: 0, streak: 0, bestStreak: 0, points: 0 };
}

function saveStats() {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

let stats = loadStats();

function renderStats() {
  document.getElementById('dt-score').textContent = `${stats.correct}/${stats.total}`;
  document.getElementById('dt-accuracy').textContent = stats.total ? `${Math.round(stats.correct / stats.total * 100)}%` : '—';
  document.getElementById('dt-streak').textContent = stats.streak;
  document.getElementById('dt-best-streak').textContent = stats.bestStreak;
  const pointsEl = document.getElementById('dt-points');
  pointsEl.textContent = stats.points > 0 ? `+${stats.points}` : String(stats.points);
  pointsEl.className = 'dt-score-value' + (stats.points > 0 ? ' dt-points-positive' : stats.points < 0 ? ' dt-points-negative' : '');
}

async function fetchStockCodes() {
  const res = await fetch('/api/sectors');
  if (!res.ok) throw new Error('Failed to load stock list');
  const map = await res.json();
  return Object.keys(map);
}

async function fetchHistory(code) {
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const { data } = await res.json();
    if (!Array.isArray(data)) return null;
    const records = data
      .map(r => ({
        date: new Date(String(r.Date).replace(/\//g, '-')),
        open: parseFloat(r.Open), high: parseFloat(r.High), low: parseFloat(r.Low), close: parseFloat(r.Close)
      }))
      .filter(r => !isNaN(r.date.getTime()) && [r.open, r.high, r.low, r.close].every(v => !isNaN(v) && v > 0))
      .sort((a, b) => a.date - b.date);
    return records;
  } catch {
    return null;
  }
}

/* ── INDICATORS ──────────────────────────────────────────────
   Computed only from the visible (pre-cutoff) closes — never from
   the hidden future window, so they can't leak the answer. A
   random 1-2 are picked each round from this pool. ──────────── */
const INDICATOR_POOL = [
  { key: 'sma20', label: 'SMA (20)',                kind: 'overlay',    color: '#facc15' },
  { key: 'ema20', label: 'EMA (20)',                kind: 'overlay',    color: '#22d3ee' },
  { key: 'bb20',  label: 'Bollinger Bands (20, 2σ)', kind: 'band',       color: '#a78bfa' },
  { key: 'rsi14', label: 'RSI (14)',                kind: 'oscillator', color: '#f472b6' },
];

function pickRandomIndicators() {
  const pool = INDICATOR_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const count = 1 + Math.floor(Math.random() * 2); // 1 or 2 indicators per round
  return pool.slice(0, count);
}

function computeSMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeEMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < closes.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += closes[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = closes[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function computeBollinger(closes, period, mult) {
  const mid = computeSMA(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - mid[i]) ** 2;
    const stdev = Math.sqrt(sumSq / period);
    upper[i] = mid[i] + mult * stdev;
    lower[i] = mid[i] - mult * stdev;
  }
  return { mid, upper, lower };
}

// Standard Wilder RSI: seed avg gain/loss from the first `period` diffs,
// then smooth.
function computeRSI(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function computeIndicatorSeries(chosenIndicators, closes) {
  const series = {};
  chosenIndicators.forEach(ind => {
    if (ind.key === 'sma20') series.sma20 = computeSMA(closes, 20);
    if (ind.key === 'ema20') series.ema20 = computeEMA(closes, 20);
    if (ind.key === 'bb20') series.bb20 = computeBollinger(closes, 20, 2);
    if (ind.key === 'rsi14') series.rsi14 = computeRSI(closes, 14);
  });
  return series;
}

function cutoffIndicatorValues(chosenIndicators, series, lastIdx) {
  const v = {};
  chosenIndicators.forEach(ind => {
    if (ind.key === 'sma20') v.sma20 = series.sma20[lastIdx];
    if (ind.key === 'ema20') v.ema20 = series.ema20[lastIdx];
    if (ind.key === 'bb20') { v.bbUpper = series.bb20.upper[lastIdx]; v.bbLower = series.bb20.lower[lastIdx]; v.bbMid = series.bb20.mid[lastIdx]; }
    if (ind.key === 'rsi14') v.rsi14 = series.rsi14[lastIdx];
  });
  return v;
}

function renderIndicatorLegend(chosenIndicators) {
  const el = document.getElementById('dt-indicator-legend');
  el.innerHTML = chosenIndicators.map(ind =>
    `<span class="dt-legend-chip"><span class="dt-legend-dot" style="background:${ind.color}"></span>${ind.label}</span>`
  ).join('');
}

// Plain-language read of the indicators at the cutoff, followed by what
// actually happened — a probabilistic hint, not a claim that indicators
// predict the outcome.
function buildExplanation(round) {
  const v = round.cutoffIndicatorVals;
  const cutoff = round.cutoffClose;
  const sentences = [];

  if (v.sma20 != null) {
    const rel = cutoff > v.sma20 ? 'above' : cutoff < v.sma20 ? 'below' : 'at';
    sentences.push(`Price was ${rel} its 20-day SMA (${v.sma20.toFixed(2)})${rel !== 'at' ? ` — commonly read as ${rel === 'above' ? 'bullish' : 'bearish'}` : ''}.`);
  }
  if (v.ema20 != null) {
    const rel = cutoff > v.ema20 ? 'above' : cutoff < v.ema20 ? 'below' : 'at';
    sentences.push(`It was ${rel} its 20-day EMA (${v.ema20.toFixed(2)}) too.`);
  }
  if (v.bbUpper != null) {
    let note;
    if (cutoff >= v.bbUpper) note = 'at or above its upper Bollinger Band — often read as overbought/stretched';
    else if (cutoff <= v.bbLower) note = 'at or below its lower Bollinger Band — often read as oversold/stretched';
    else note = 'within its Bollinger Bands — no extreme reading';
    sentences.push(`Price was ${note}.`);
  }
  if (v.rsi14 != null) {
    const r = v.rsi14;
    const read = r >= 70 ? 'overbought territory (≥70)' : r <= 30 ? 'oversold territory (≤30)' : 'a neutral zone';
    sentences.push(`RSI(14) read ${r.toFixed(1)} — ${read}.`);
  }

  const dirWord = round.outcome === 'up' ? 'rose' : round.outcome === 'down' ? 'fell' : 'stayed roughly flat (within ±2%)';
  const magnitude = round.outcome !== 'sideways' ? ` ${Math.abs(round.pctChange).toFixed(2)}%` : '';
  sentences.push(`It actually ${dirWord}${magnitude} over the next ${FUTURE_CANDLES} trading days. Indicators are probabilistic hints, not guarantees — real markets don't always follow the textbook.`);

  return sentences.join(' ');
}

async function startRound() {
  hasGuessed = false;
  selectedDirection = null;
  currentRound = null;
  document.getElementById('dt-result').style.display = 'none';
  document.getElementById('dt-guess-row').style.display = 'flex';
  document.getElementById('dt-confidence-row').style.display = 'none';
  document.querySelectorAll('.dt-guess-btn').forEach(b => { b.disabled = false; b.classList.remove('selected'); });
  document.querySelectorAll('.dt-conf-btn').forEach(b => b.disabled = false);
  document.getElementById('dt-quiz-sub').textContent = 'Loading a chart…';
  document.getElementById('dt-indicator-legend').innerHTML = '';

  try {
    if (!stockCodes.length) stockCodes = await fetchStockCodes();
  } catch {
    document.getElementById('dt-quiz-sub').textContent = 'Could not load the stock list — is the server running?';
    return;
  }

  const needed = VISIBLE_CANDLES + FUTURE_CANDLES;
  let records = null, code = null, attempts = 0;
  while (attempts < 20 && (!records || records.length < needed)) {
    code = stockCodes[Math.floor(Math.random() * stockCodes.length)];
    records = await fetchHistory(code);
    attempts++;
  }
  if (!records || records.length < needed) {
    document.getElementById('dt-quiz-sub').textContent = 'Could not find a stock with enough price history — click Next Round to retry.';
    return;
  }

  const maxStart = records.length - needed;
  const startIdx = Math.floor(Math.random() * (maxStart + 1));
  const visibleData = records.slice(startIdx, startIdx + VISIBLE_CANDLES);
  const futureData = records.slice(startIdx + VISIBLE_CANDLES, startIdx + VISIBLE_CANDLES + FUTURE_CANDLES);
  const cutoffClose = visibleData[visibleData.length - 1].close;
  const futureClose = futureData[futureData.length - 1].close;
  const pctChange = (futureClose - cutoffClose) / cutoffClose * 100;
  let outcome;
  if (pctChange > SIDEWAYS_BAND_PCT) outcome = 'up';
  else if (pctChange < -SIDEWAYS_BAND_PCT) outcome = 'down';
  else outcome = 'sideways';

  const chosenIndicators = pickRandomIndicators();
  const indicatorSeries = computeIndicatorSeries(chosenIndicators, visibleData.map(d => d.close));
  const cutoffIndicatorVals = cutoffIndicatorValues(chosenIndicators, indicatorSeries, visibleData.length - 1);

  currentRound = { code, visibleData, futureData, cutoffClose, futureClose, pctChange, outcome, chosenIndicators, indicatorSeries, cutoffIndicatorVals };
  document.getElementById('dt-quiz-sub').textContent =
    `${VISIBLE_CANDLES} trading days of a real DSE stock (identity hidden) — where does the price go over the NEXT ${FUTURE_CANDLES} trading days?`;
  renderIndicatorLegend(chosenIndicators);
  drawChart(visibleData, null, chosenIndicators, indicatorSeries);
}

function themeColor(varName, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

// Draws `visibleData` alone during the guess phase, or `visibleData` +
// `futureData` (with a dashed divider marking the cutoff) once revealed.
// `chosenIndicators`/`indicatorSeries` are always computed from visibleData
// only, and are only ever drawn across the visible portion of the chart —
// they never extend into the revealed future, so they can't leak the answer.
function drawChart(visibleData, futureData, chosenIndicators, indicatorSeries) {
  chosenIndicators = chosenIndicators || [];
  indicatorSeries = indicatorSeries || {};
  const canvas = document.getElementById('dt-canvas');
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const width = wrap.clientWidth;
  const height = wrap.clientHeight;
  if (!width || !height) return;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const gain = themeColor('--gain', '#26a69a');
  const loss = themeColor('--loss', '#ef5350');
  const border = themeColor('--border', '#333333');
  const textMuted = themeColor('--text-muted', '#888888');
  const accent = themeColor('--accent', '#1a5cff');

  const hasRSI = chosenIndicators.some(ind => ind.key === 'rsi14');
  const padding = { top: 16, right: 58, bottom: 22, left: 8 };
  const rsiPaneH = hasRSI ? 64 : 0;
  const rsiGap = hasRSI ? 14 : 0;

  const allData = futureData ? visibleData.concat(futureData) : visibleData;
  const highs = allData.map(d => d.high), lows = allData.map(d => d.low);
  let maxPrice = Math.max(...highs), minPrice = Math.min(...lows);
  // Widen the price range so overlay lines/bands never get clipped.
  chosenIndicators.forEach(ind => {
    if (ind.key === 'sma20') indicatorSeries.sma20.forEach(v => { if (v != null) { maxPrice = Math.max(maxPrice, v); minPrice = Math.min(minPrice, v); } });
    if (ind.key === 'ema20') indicatorSeries.ema20.forEach(v => { if (v != null) { maxPrice = Math.max(maxPrice, v); minPrice = Math.min(minPrice, v); } });
    if (ind.key === 'bb20') {
      indicatorSeries.bb20.upper.forEach(v => { if (v != null) maxPrice = Math.max(maxPrice, v); });
      indicatorSeries.bb20.lower.forEach(v => { if (v != null) minPrice = Math.min(minPrice, v); });
    }
  });
  const priceRange = (maxPrice - minPrice) || 1;
  const plotW = width - padding.left - padding.right;
  const priceH = height - padding.top - padding.bottom - rsiPaneH - rsiGap;

  const totalCandles = allData.length;
  const candleSlot = plotW / totalCandles;
  const candleW = Math.max(1, candleSlot * 0.6);

  const yFor = price => padding.top + (1 - (price - minPrice) / priceRange) * priceH;
  const xFor = i => padding.left + i * candleSlot + candleSlot / 2;

  // gridlines + price axis labels
  ctx.font = '10px "DM Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const gridLines = 5;
  for (let i = 0; i <= gridLines; i++) {
    const price = minPrice + (priceRange * i / gridLines);
    const y = yFor(price);
    ctx.strokeStyle = border;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = textMuted;
    ctx.fillText(price.toFixed(2), width - padding.right + 6, y);
  }

  // divider between the guess window and the revealed future
  if (futureData && futureData.length) {
    const dividerX = padding.left + visibleData.length * candleSlot;
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(dividerX, padding.top);
    ctx.lineTo(dividerX, height - padding.bottom - rsiPaneH - rsiGap);
    ctx.stroke();
    ctx.restore();
  }

  // candles
  allData.forEach((d, i) => {
    const x = xFor(i);
    const isUp = d.close >= d.open;
    const color = isUp ? gain : loss;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, yFor(d.high));
    ctx.lineTo(x, yFor(d.low));
    ctx.stroke();
    const yOpen = yFor(d.open), yClose = yFor(d.close);
    const bodyTop = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  });

  // overlay indicators — drawn only across the visible window's indices
  function drawOverlayLine(series, color, alpha, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (dash) ctx.setLineDash(dash);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < visibleData.length; i++) {
      const v = series[i];
      if (v == null) continue;
      const x = xFor(i), y = yFor(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
  chosenIndicators.forEach(ind => {
    if (ind.key === 'sma20') drawOverlayLine(indicatorSeries.sma20, ind.color);
    if (ind.key === 'ema20') drawOverlayLine(indicatorSeries.ema20, ind.color);
    if (ind.key === 'bb20') {
      drawOverlayLine(indicatorSeries.bb20.upper, ind.color, 0.85);
      drawOverlayLine(indicatorSeries.bb20.lower, ind.color, 0.85);
      drawOverlayLine(indicatorSeries.bb20.mid, ind.color, 0.45, [3, 3]);
    }
  });

  // x-axis labels: masked "Day N" pre-guess, real dates once revealed
  const xAxisY = hasRSI ? padding.top + priceH : height - padding.bottom;
  ctx.fillStyle = textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelEvery = Math.max(1, Math.ceil(totalCandles / 6));
  allData.forEach((d, i) => {
    if (i % labelEvery !== 0) return;
    const label = futureData ? d.date.toISOString().slice(5, 10) : `D${i + 1}`;
    ctx.fillText(label, xFor(i), (hasRSI ? height - padding.bottom : xAxisY) + 6);
  });

  // RSI sub-pane
  if (hasRSI) {
    const rsiTop = padding.top + priceH + rsiGap;
    const rsiSeries = indicatorSeries.rsi14;
    const yForRSI = v => rsiTop + (1 - v / 100) * rsiPaneH;

    ctx.font = '9px "DM Sans", sans-serif';
    [30, 70].forEach(level => {
      const y = yForRSI(level);
      ctx.save();
      ctx.strokeStyle = border;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = textMuted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(level), width - padding.right + 6, y);
    });

    ctx.save();
    ctx.strokeStyle = '#f472b6';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < visibleData.length; i++) {
      const v = rsiSeries[i];
      if (v == null) continue;
      const x = xFor(i), y = yForRSI(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('RSI (14)', padding.left, rsiTop - 2);
  }
}

function submitGuess(guess, confidence) {
  if (hasGuessed || !currentRound) return;
  hasGuessed = true;
  document.querySelectorAll('.dt-guess-btn').forEach(b => b.disabled = true);
  document.querySelectorAll('.dt-conf-btn').forEach(b => b.disabled = true);

  const correct = guess === currentRound.outcome;
  const wager = CONFIDENCE_POINTS[confidence] || 0;
  const pointsDelta = correct ? wager : -wager;

  stats.total++;
  stats.points += pointsDelta;
  if (correct) {
    stats.correct++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  } else {
    stats.streak = 0;
  }
  saveStats();
  renderStats();

  drawChart(currentRound.visibleData, currentRound.futureData, currentRound.chosenIndicators, currentRound.indicatorSeries);

  const banner = document.getElementById('dt-result-banner');
  banner.textContent = correct ? '✓ Correct!' : '✗ Wrong';
  banner.className = 'dt-result-banner ' + (correct ? 'dt-result-correct' : 'dt-result-wrong');

  const label = v => v === 'up' ? 'Up' : v === 'down' ? 'Down' : 'Sideways';
  const confLabel = confidence.charAt(0).toUpperCase() + confidence.slice(1);
  const sign = currentRound.pctChange >= 0 ? '+' : '';
  const pointsSign = pointsDelta >= 0 ? '+' : '';
  document.getElementById('dt-result-detail').textContent =
    `${currentRound.code} moved ${label(currentRound.outcome)} (${sign}${currentRound.pctChange.toFixed(2)}%) over the next ${FUTURE_CANDLES} trading days — you guessed ${label(guess)} with ${confLabel} confidence: ${pointsSign}${pointsDelta} point${Math.abs(pointsDelta) === 1 ? '' : 's'}.`;
  document.getElementById('dt-explanation').textContent = buildExplanation(currentRound);

  document.getElementById('dt-result').style.display = 'block';
  document.getElementById('dt-guess-row').style.display = 'none';
  document.getElementById('dt-confidence-row').style.display = 'none';
}

// Clicking a direction doesn't submit — it selects a direction and reveals
// the confidence row. The actual wager (and reveal) happens on confidence click.
document.querySelectorAll('.dt-guess-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (hasGuessed || !currentRound) return;
    selectedDirection = btn.dataset.guess;
    document.querySelectorAll('.dt-guess-btn').forEach(b => b.classList.toggle('selected', b === btn));
    const label = selectedDirection === 'up' ? 'Up' : selectedDirection === 'down' ? 'Down' : 'Sideways';
    document.getElementById('dt-confidence-direction').textContent = label;
    document.getElementById('dt-confidence-row').style.display = 'block';
  });
});
document.querySelectorAll('.dt-conf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!selectedDirection) return;
    submitGuess(selectedDirection, btn.dataset.confidence);
  });
});
document.getElementById('dt-next-btn').addEventListener('click', startRound);
document.getElementById('dt-reset-btn').addEventListener('click', () => {
  stats = { correct: 0, total: 0, streak: 0, bestStreak: 0, points: 0 };
  saveStats();
  renderStats();
});
window.addEventListener('resize', () => {
  if (!currentRound) return;
  drawChart(currentRound.visibleData, hasGuessed ? currentRound.futureData : null, currentRound.chosenIndicators, currentRound.indicatorSeries);
});

renderStats();
startRound();
