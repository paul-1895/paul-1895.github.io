/* ═══════════════════════════════════════════════════════════
   macd-ema.js  —  "MACD + 50 EMA" study guide (macd-ema.html)

   Same approach as hilega-milega.js: the maths here is ported verbatim
   from the app's own indicator/strategy code (indicators/macd.js,
   indicators/ma.js, candlestick_chart/macd-backtest.js) rather than
   reimplemented, so every diagram shows what the real indicator and the
   real "MACD + 50 EMA" strategy actually do — not an artist's impression.

   Two separate signals get covered, and the guide is careful not to
   blur them:
     1. Plain MACD crossover  — routes/screener-technicals.js, no trend
        filter, no risk management, just "line crossed signal".
     2. "MACD + 50 EMA" strategy (macdS1) — routes/macd-strategy1.js /
        candlestick_chart/macd-backtest.js: crossover + close above the
        50-EMA + a stop/target bracket. This is the one with a real,
        already-computed, market-wide backtest (data/macd-strategy1.json)
        cited in the evidence section — a genuinely unflattering result,
        reported the same way hilega-milega.html reports its own weight
        of zero.

   Consumed by: macd-ema.html
   ═══════════════════════════════════════════════════════════ */
'use strict';

const MC = {
  price:   '#1e88e5',
  ema:     '#f57c00',
  macd:    '#26c6da',
  signal:  '#ef5350',
  histUp:  '#26a69a',
  histDn:  '#ef5350',
};
const GRID = 'rgba(140,150,170,0.22)';
const AXIS = 'rgba(140,150,170,0.75)';

// ─── The indicator's own maths, ported verbatim ────────────────
// From candlestick_chart/indicators/ma.js — no null-padding warmup, seeds
// with prices[0], exactly as the live chart's EMA behaves.
function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  const result = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// From candlestick_chart/indicators/macd.js's calculateMACD(), fast/slow/
// signal defaults 12/26/9 — the same defaults the live chart ships with.
function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
  const emaFast    = calculateEMA(prices, fast);
  const emaSlow    = calculateEMA(prices, slow);
  const macdLine   = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signal);
  const histogram  = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

// ─── A deterministic price series ──────────────────────────────
// Same reasoning as hilega-milega.js: seeded so numbers quoted beside a
// diagram never drift from the picture. Needs more bars than that guide's
// 130 — a 50-period EMA wants real room to warm up before its filter
// means anything.
const SERIES_SEED = 20260809;
const N = 200;

function priceSeries(n) {
  let s = SERIES_SEED;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    // A slow multi-month wave (creates trending vs. range-bound stretches,
    // which is what makes the 50-EMA filter actually reject some crosses)
    // plus a faster ripple plus noise — same chop-over-sines lesson as the
    // hilega-milega generator: pure sines under-oscillate.
    const drift = Math.sin(i / 42) * 0.16;
    p = Math.max(20, p + drift + Math.sin(i / 9) * 0.45 + (rnd() - 0.5) * 2.3);
    out.push(p);
  }
  return out;
}

const PRICES      = priceSeries(N);
const EMA50        = calculateEMA(PRICES, 50);
const { macdLine: MACD_LINE, signalLine: SIGNAL_LINE, histogram: HIST } = calculateMACD(PRICES);

// Every MACD-line/signal-line crossover — the same test detectMacdCrossover()
// in routes/screener-technicals.js applies, and the same trigger the
// macdS1 strategy uses before checking the 50-EMA filter.
function findCrossovers(macd, signal, from = 0, to = macd.length) {
  const out = [];
  for (let i = Math.max(1, from); i < to; i++) {
    const cur = macd[i] - signal[i];
    const prv = macd[i - 1] - signal[i - 1];
    if (prv <= 0 && cur > 0) out.push({ i, direction: 'bullish' });
    else if (prv >= 0 && cur < 0) out.push({ i, direction: 'bearish' });
  }
  return out;
}
const CROSSES = findCrossovers(MACD_LINE, SIGNAL_LINE);

// ─── Renderers ───────────────────────────────────────────────
// MACD-only pane: line, signal, histogram, zero line. Centred on 0 rather
// than hilega-milega's 0-100 RSI scale, so the y-mapping is symmetric
// around whatever the slice's own peak magnitude is.
function macdSVG(from, to, opts = {}) {
  const w = opts.w ?? 460, h = opts.h ?? 150;
  const padL = 34, padR = 10, padT = 10, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const S = opts.series || { macd: MACD_LINE, signal: SIGNAL_LINE, hist: HIST };

  const idx = [];
  for (let i = from; i < to; i++) idx.push(i);
  const vals = idx.flatMap(k => [S.macd[k], S.signal[k], S.hist[k]]).filter(v => v != null);
  const peak = Math.max(0.5, ...vals.map(Math.abs));
  const x = k => padL + (plotW * (k - from)) / Math.max(1, to - from - 1);
  const y = v => padT + plotH * (1 - (v + peak) / (2 * peak));
  const barW = Math.max(1.5, plotW / Math.max(1, to - from) - 2);

  const zero = `<line x1="${padL}" y1="${y(0)}" x2="${w - padR}" y2="${y(0)}" stroke="${AXIS}" stroke-width="1" opacity="0.7"/>
    <text x="${padL - 6}" y="${y(0) + 3}" text-anchor="end" class="cd-fig-label">0</text>`;

  const bars = idx.filter(k => S.hist[k] != null).map(k => {
    const barY = S.hist[k] >= 0 ? y(S.hist[k]) : y(0);
    const barH = Math.abs(y(S.hist[k]) - y(0));
    return `<rect x="${x(k) - barW / 2}" y="${barY}" width="${barW}" height="${Math.max(0.6, barH)}"
                  fill="${S.hist[k] >= 0 ? MC.histUp : MC.histDn}" opacity="0.55"/>`;
  }).join('');

  const line = (arr, col, wid) => {
    const pts = idx.filter(k => arr[k] != null).map(k => `${x(k)},${y(arr[k])}`);
    return pts.length < 2 ? '' : `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}"
      stroke-width="${wid}" stroke-linejoin="round" stroke-linecap="round"/>`;
  };

  const ring = (k, strong) => `
    <line x1="${x(k)}" y1="${padT}" x2="${x(k)}" y2="${h - padB}" stroke="${AXIS}" stroke-width="1"
          stroke-dasharray="3 3" opacity="${strong ? 0.8 : 0.45}"/>
    <circle cx="${x(k)}" cy="${y(S.macd[k])}" r="${strong ? 4.5 : 3}" fill="none" stroke="${AXIS}"
            stroke-width="${strong ? 1.6 : 1.2}"/>`;
  const marker = opts.marker != null ? ring(opts.marker, true)
    : (opts.markers || []).filter(k => k >= from && k < to).map(k => ring(k, false)).join('');

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="cd-svg">
    ${zero}${bars}
    ${line(S.signal, MC.signal, 1.4)}
    ${line(S.macd, MC.macd, 1.7)}
    ${marker}
  </svg>`;
}

// Price + 50-EMA pane: illustrates the trend filter in isolation. Shading
// marks stretches where price sits above (filter open) vs below (filter
// blocks new longs) the EMA.
function priceEmaSVG(from, to, opts = {}) {
  const w = opts.w ?? 460, h = opts.h ?? 150;
  const padL = 34, padR = 10, padT = 10, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const S = opts.series || { price: PRICES, ema: EMA50 };

  const idx = [];
  for (let i = from; i < to; i++) idx.push(i);
  const vals = idx.flatMap(k => [S.price[k], S.ema[k]]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || 1;
  const x = k => padL + (plotW * (k - from)) / Math.max(1, to - from - 1);
  const y = v => padT + plotH * (1 - (v - lo + pad) / (hi - lo + pad * 2));

  const bands = [];
  let s = 0;
  while (s < idx.length) {
    const above = S.price[idx[s]] >= S.ema[idx[s]];
    let e = s;
    while (e < idx.length && (S.price[idx[e]] >= S.ema[idx[e]]) === above) e++;
    const seg = idx.slice(s, e);
    if (seg.length >= 2) {
      const top = seg.map(k => `${x(k)},${y(S.price[k])}`).join(' ');
      const bot = seg.slice().reverse().map(k => `${x(k)},${y(S.ema[k])}`).join(' ');
      bands.push(`<polygon points="${top} ${bot}" fill="${above ? 'rgba(38,166,154,0.18)' : 'rgba(239,83,80,0.18)'}"/>`);
    }
    s = e;
  }

  const line = (arr, col, wid, dash) => {
    const pts = idx.map(k => `${x(k)},${y(arr[k])}`);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="${wid}"
      stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  };

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="cd-svg">
    ${bands.join('')}
    ${line(S.ema, MC.ema, 1.6, '4 3')}
    ${line(S.price, MC.price, 1.7)}
  </svg>`;
}

// ─── Render helpers ────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const f2 = v => (v == null ? '—' : v.toFixed(2));

function crossCard(c) {
  const bull = c.direction === 'bullish';
  const from = Math.max(0, c.i - 18), to = Math.min(N, c.i + 14);
  const aboveEma = PRICES[c.i] > EMA50[c.i];
  return `
    <article class="cd-card">
      <div class="cd-card-fig">${macdSVG(from, to, { w: 340, h: 155, marker: c.i })}</div>
      <div class="cd-card-body">
        <header class="cd-card-head">
          <h3>${bull ? 'Bullish cross' : 'Bearish cross'}</h3>
          <span class="cd-chip">${bull ? '▲ MACD up' : '▼ MACD down'}</span>
          <span class="cd-chip ${aboveEma ? 'cd-chip--real' : 'cd-chip--warn'}">${aboveEma ? 'Above 50-EMA' : 'Below 50-EMA'}</span>
        </header>
        <p class="cd-what"><span class="cd-lbl">What happened</span>
          The MACD line closed ${bull ? 'above' : 'below'} its signal line on this bar. Price was
          ${aboveEma ? 'above' : 'below'} its 50-EMA at the time, so the "MACD + 50 EMA" strategy
          would ${bull && aboveEma ? 'have taken this as a real entry trigger' : bull ? 'have rejected this — the trend filter blocks new longs below the EMA' : 'treat this as an exit trigger for any open long'}.</p>
        <div class="cd-metrics">
          <span>MACD <b>${f2(MACD_LINE[c.i])}</b></span>
          <span>Signal <b>${f2(SIGNAL_LINE[c.i])}</b></span>
          <span>Price vs 50-EMA <b class="${aboveEma ? 'cd-good' : 'cd-bad'}">${(PRICES[c.i] - EMA50[c.i]) > 0 ? '+' : ''}${f2(PRICES[c.i] - EMA50[c.i])}</b></span>
        </div>
        <p class="cd-read"><span class="cd-lbl">How to read it</span>
          ${bull
            ? 'The fast momentum line has pulled above its own signal — improving short-term momentum. On its own that is the plain crossover the Screener\'s "MACD Bullish Cross" list reports; the 50-EMA check is what turns it into the stricter "MACD + 50 EMA" strategy signal.'
            : 'Momentum has turned down relative to its own recent trigger line. For an open long taken on an earlier bullish signal, this is the strategy\'s exit rule — sell at the next bar\'s open, regardless of stop or target.'}</p>
      </div>
    </article>`;
}

// ─── Real DSE stocks ───────────────────────────────────────────
// Same real-data approach as hilega-milega.js's "Real DSE examples" —
// genuine daily closes, genuine tickers, the trigger picked programmatically
// by forward return rather than hand-picked for a flattering result.
const REAL_STOCK_CODES = ['BRACBANK', 'GP', 'RENATA', 'BEXIMCO', 'BATBC', 'ACI'];
const REAL_FWD_BARS     = 10; // MACD trades run longer than an RSI/WMA flip; give it more room
const REAL_HISTORY_BARS = 220; // extra room for the 50-EMA's own warm-up

async function fetchRealSeries(code) {
  const res = await fetch(`/historical_prices/json_files/${code}.json`);
  if (!res.ok) throw new Error(`fetch failed for ${code}: ${res.status}`);
  const raw = await res.json();
  const rows = raw
    .filter(r => r.Open > 0 && r.High > 0 && r.Low > 0 && r.Close > 0)
    .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0))
    .slice(-REAL_HISTORY_BARS);

  const closes = rows.map(r => r.Close);
  const dates  = rows.map(r => r.Date);
  const ema50  = calculateEMA(closes, 50);
  const { macdLine, signalLine, histogram } = calculateMACD(closes);
  return { code, dates, closes, N: rows.length, series: { macd: macdLine, signal: signalLine, hist: histogram, ema: ema50, price: closes } };
}

function realCrossCard(e) {
  const bull   = e.direction === 'bullish';
  const from   = Math.max(0, e.i - 18), to = Math.min(e.N, e.i + 14);
  const worked = bull ? e.fwdReturnPct > 0 : e.fwdReturnPct < 0;
  return `
    <article class="cd-card">
      <div class="cd-card-fig">${macdSVG(from, to, { w: 340, h: 155, marker: e.i, series: e.series })}</div>
      <div class="cd-card-body">
        <header class="cd-card-head">
          <h3>${esc(e.code)}</h3>
          <span class="cd-chip cd-chip--real">Real stock</span>
          <span class="cd-chip">${bull ? '▲ Bullish' : '▼ Bearish'}</span>
          <span class="cd-chip ${e.filterOpen ? 'cd-chip--real' : 'cd-chip--warn'}">${e.filterOpen ? 'Cleared 50-EMA filter' : 'Blocked by 50-EMA filter'}</span>
        </header>
        <p class="cd-what"><span class="cd-lbl">What happened</span>
          On ${esc(fmtRealDate(e.date))}, ${esc(e.code)}'s MACD line crossed ${bull ? 'above' : 'below'}
          its signal line${bull ? (e.filterOpen ? ', with price already above its 50-EMA — a valid strategy entry.' : ', but price was below its 50-EMA — the filter would have rejected this one.') : '.'}</p>
        <div class="cd-metrics">
          <span>MACD <b>${f2(e.series.macd[e.i])}</b></span>
          <span>Signal <b>${f2(e.series.signal[e.i])}</b></span>
          <span>${REAL_FWD_BARS}-day fwd return
            <b class="${worked ? 'cd-good' : 'cd-bad'}">${e.fwdReturnPct > 0 ? '+' : ''}${e.fwdReturnPct.toFixed(1)}%</b></span>
        </div>
        <p class="cd-read"><span class="cd-lbl">How it played out</span>
          Price ${e.fwdReturnPct > 0 ? 'rose' : e.fwdReturnPct < 0 ? 'fell' : 'was flat'}
          ${Math.abs(e.fwdReturnPct).toFixed(1)}% over the ${REAL_FWD_BARS} sessions after this cross —
          picked programmatically as the largest same-direction move among this sample, not
          cherry-picked. This is one signal on one stock; see
          <a href="#evidence">what running the full strategy on all 392 stocks actually found</a>
          before drawing a conclusion from it.</p>
      </div>
    </article>`;
}

function fmtRealDate(d) {
  const [y, m, day] = String(d).split('/');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${day} ${months[mi]} ${y}` : d;
}

async function loadRealExamples() {
  const container = document.getElementById('macd-real-examples');
  if (!container) return;

  let seriesList;
  try {
    seriesList = (await Promise.allSettled(REAL_STOCK_CODES.map(fetchRealSeries)))
      .filter(r => r.status === 'fulfilled').map(r => r.value);
  } catch { seriesList = []; }
  if (!seriesList.length) {
    container.innerHTML = `<div class="cd-callout">Couldn't load real price data for this section
      right now (needs this app's own dev server serving /historical_prices/). The diagrams above
      are unaffected.</div>`;
    return;
  }

  const candidates = [];
  seriesList.forEach(s => {
    findCrossovers(s.series.macd, s.series.signal, 50, s.N).forEach(c => { // skip before EMA50 has warmed up
      const j = c.i + REAL_FWD_BARS;
      if (j >= s.N) return;
      const fwdReturnPct = ((s.closes[j] - s.closes[c.i]) / s.closes[c.i]) * 100;
      const filterOpen = s.closes[c.i] > s.series.ema[c.i];
      candidates.push({ ...c, code: s.code, series: s.series, N: s.N, date: s.dates[c.i], fwdReturnPct, filterOpen });
    });
  });

  // Capped at ±40%: a real ~65% single-stock move (a multi-day lower-circuit
  // crash, verified against the raw price file, not a data glitch) showed up
  // in this sample. Picking it as "the best example" would oversell what
  // this strategy typically catches — an extreme outlier isn't a
  // representative illustration, so it's excluded from the pick even though
  // it's genuine data.
  const REPRESENTATIVE_CAP = 40;
  const bestBull = candidates
    .filter(c => c.direction === 'bullish' && c.filterOpen && c.fwdReturnPct > 0 && c.fwdReturnPct <= REPRESENTATIVE_CAP)
    .sort((a, b) => b.fwdReturnPct - a.fwdReturnPct)[0];
  const bestBear = candidates
    .filter(c => c.direction === 'bearish' && c.fwdReturnPct < 0 && c.fwdReturnPct >= -REPRESENTATIVE_CAP)
    .sort((a, b) => a.fwdReturnPct - b.fwdReturnPct)[0];
  const rejected = candidates.find(c => c.direction === 'bullish' && !c.filterOpen);

  const cards = [bestBull, bestBear, rejected].filter(Boolean).map(realCrossCard);
  container.innerHTML = cards.length
    ? cards.join('')
    : `<div class="cd-callout">No qualifying crossovers turned up in this sample of stocks right
        now — rerun after prices update.</div>`;
}

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const full = document.getElementById('macd-full');
  if (full) full.innerHTML = macdSVG(40, N, { w: 720, h: 190, markers: CROSSES.map(c => c.i) });

  const trend = document.getElementById('macd-trend');
  if (trend) trend.innerHTML = priceEmaSVG(50, N, { w: 720, h: 190 });

  const list = document.getElementById('macd-crosses');
  if (list) {
    const legible = c => Math.abs(MACD_LINE[c.i]) < 8; // keep it inside the visible plot range
    const pick = dir => CROSSES.filter(c => c.direction === dir && legible(c)).pop()
                      || CROSSES.filter(c => c.direction === dir).pop();
    list.innerHTML = [pick('bullish'), pick('bearish')].filter(Boolean).map(crossCard).join('');
  }

  loadRealExamples();

  // Scroll-spy, identical to hilega-milega.js / candles.js.
  const links = [...document.querySelectorAll('.cd-toc a')];
  const targets = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if (targets.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    targets.forEach(t => io.observe(t));
  }
});
