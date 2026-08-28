/* ═══════════════════════════════════════════════════════════
   bollinger-bands.js  —  Bollinger Bands study guide (bollinger-bands.html)

   Same ported-verbatim approach as the other guides — this file carries
   the exact calculateSMA/calculateBollingerBands this app's chart uses
   from indicators/ma.js and indicators/bollinger-bands.js.

   The honest difference from hilega-milega.js and macd-ema.js: there is
   no screener pattern, no Super Model signal, and no backtest for
   Bollinger Bands anywhere in this codebase — confirmed by grepping
   screener/screener.js, routes/screener-technicals.js, routes/super-model*.js
   (zero matches, all three). It exists here purely as a chart overlay,
   plus one line of descriptive flavor text in the demo_trade practice
   game. This guide says that plainly rather than implying evidence that
   doesn't exist — there is no "what the backtest found" section here
   because nothing was ever run.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const BB = {
  price:  '#1e88e5',
  band:   '#00d4ff',
  middle: '#f57c00',
};

// ─── The indicator's own maths, ported verbatim ────────────────
// From candlestick_chart/indicators/ma.js.
function calculateSMA(prices, period) {
  return prices.map((_, i) => {
    if (i < period - 1) return null;
    return prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

// From candlestick_chart/indicators/bollinger-bands.js's calculateBollingerBands() —
// note the population variance (divide by period, not period-1).
function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  const sma   = calculateSMA(prices, period);
  const upper = new Array(prices.length).fill(null);
  const lower = new Array(prices.length).fill(null);
  for (let i = period - 1; i < prices.length; i++) {
    const slice    = prices.slice(i - period + 1, i + 1);
    const mean     = sma[i];
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    const stdDev   = Math.sqrt(variance);
    upper[i] = mean + multiplier * stdDev;
    lower[i] = mean - multiplier * stdDev;
  }
  return { upper, middle: sma, lower };
}

// ─── A deterministic price series ──────────────────────────────
// Same reasoning as the other two guides: seeded so the anatomy diagram
// never drifts from the numbers quoted beside it. Tuned for a visible
// squeeze-then-expansion stretch, since that's the one Bollinger concept
// worth actually seeing rather than just describing.
const SERIES_SEED = 20260810;
const N = 140;

function priceSeries(n) {
  let s = SERIES_SEED;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    // Volatility itself ramps up mid-series (a "squeeze" in the first
    // third, an expansion after) rather than staying constant, which a
    // flat-noise generator wouldn't show at all.
    const vol = i < 50 ? 0.5 : i < 75 ? 0.5 + (i - 50) * 0.08 : 2.5;
    p = Math.max(20, p + Math.sin(i / 14) * 0.3 + (rnd() - 0.5) * vol);
    out.push(p);
  }
  return out;
}

const PRICES = priceSeries(N);
const BANDS  = calculateBollingerBands(PRICES);

// ─── Renderer ──────────────────────────────────────────────────
function bbSVG(from, to, opts = {}) {
  const w = opts.w ?? 460, h = opts.h ?? 190;
  const padL = 36, padR = 10, padT = 10, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const S = opts.series || { price: PRICES, upper: BANDS.upper, middle: BANDS.middle, lower: BANDS.lower };

  const idx = [];
  for (let i = from; i < to; i++) idx.push(i);
  const vals = idx.flatMap(k => [S.price[k], S.upper[k], S.lower[k]]).filter(v => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1;
  const x = k => padL + (plotW * (k - from)) / Math.max(1, to - from - 1);
  const y = v => padT + plotH * (1 - (v - lo + pad) / (hi - lo + pad * 2));

  const band = (() => {
    const upPts = idx.filter(k => S.upper[k] != null).map(k => `${x(k)},${y(S.upper[k])}`);
    const dnPts = idx.filter(k => S.lower[k] != null).map(k => `${x(k)},${y(S.lower[k])}`).reverse();
    if (upPts.length < 2) return '';
    return `<polygon points="${upPts.join(' ')} ${dnPts.join(' ')}" fill="${BB.band}" opacity="0.12"/>`;
  })();

  const line = (arr, col, wid, dash) => {
    const pts = idx.filter(k => arr[k] != null).map(k => `${x(k)},${y(arr[k])}`);
    return pts.length < 2 ? '' : `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}"
      stroke-width="${wid}" stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  };

  const markerLine = opts.marker != null ? `
    <line x1="${x(opts.marker)}" y1="${padT}" x2="${x(opts.marker)}" y2="${h - padB}"
          stroke="rgba(140,150,170,0.75)" stroke-width="1" stroke-dasharray="3 3"/>
    <circle cx="${x(opts.marker)}" cy="${y(S.price[opts.marker])}" r="4" fill="none"
            stroke="rgba(140,150,170,0.9)" stroke-width="1.6"/>` : '';

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="cd-svg">
    ${band}
    ${line(S.upper, BB.band, 1.3, '2 3')}
    ${line(S.lower, BB.band, 1.3, '2 3')}
    ${line(S.middle, BB.middle, 1.2, '4 3')}
    ${line(S.price, BB.price, 1.8)}
    ${markerLine}
  </svg>`;
}

// ─── Real DSE stock ─────────────────────────────────────────────
// Lighter than the other two guides' real-examples sections — there's no
// signal to hunt for, just a genuine chart to show. One stock is enough
// to make the point honestly; padding this out with more wouldn't add
// evidence, because there's no claim being tested.
const REAL_STOCK_CODE  = 'RENATA';
const REAL_HISTORY_BARS = 140;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtRealDate(d) {
  const [y, m, day] = String(d).split('/');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${day} ${months[mi]} ${y}` : d;
}
const f2 = v => (v == null ? '—' : v.toFixed(2));

async function loadRealExample() {
  const container = document.getElementById('bb-real-example');
  if (!container) return;
  try {
    const res = await fetch(`/historical_prices/json_files/${REAL_STOCK_CODE}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const raw = await res.json();
    const rows = raw
      .filter(r => r.Open > 0 && r.High > 0 && r.Low > 0 && r.Close > 0)
      .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0))
      .slice(-REAL_HISTORY_BARS);
    const closes = rows.map(r => r.Close);
    const dates  = rows.map(r => r.Date);
    const bands  = calculateBollingerBands(closes);

    // Most recent bar where price actually touched a band — a real,
    // findable instance rather than an asserted one.
    let touchIdx = -1;
    for (let i = rows.length - 1; i >= 20; i--) {
      if (bands.upper[i] == null) continue;
      if (closes[i] >= bands.upper[i] || closes[i] <= bands.lower[i]) { touchIdx = i; break; }
    }
    const from = Math.max(0, (touchIdx >= 0 ? touchIdx : rows.length - 1) - 45);
    const to   = rows.length;
    const series = { price: closes, upper: bands.upper, middle: bands.middle, lower: bands.lower };

    const touchNote = touchIdx >= 0
      ? `On ${esc(fmtRealDate(dates[touchIdx]))}, ${REAL_STOCK_CODE}'s close (<b>${f2(closes[touchIdx])}</b>) sat
         ${closes[touchIdx] >= bands.upper[touchIdx] ? `at or above its upper band (<b>${f2(bands.upper[touchIdx])}</b>)`
                                                       : `at or below its lower band (<b>${f2(bands.lower[touchIdx])}</b>)`} —
         the most recent such touch in this window, found by scanning the data, not asserted.`
      : `No band touch found in this stock's recent history — the price has stayed inside its own
         volatility envelope.`;

    container.innerHTML = `
      <article class="cd-card">
        <div class="cd-card-fig">${bbSVG(from, to, { w: 340, h: 175, marker: touchIdx >= 0 ? touchIdx : undefined, series })}</div>
        <div class="cd-card-body">
          <header class="cd-card-head">
            <h3>${REAL_STOCK_CODE}</h3>
            <span class="cd-chip cd-chip--real">Real stock</span>
          </header>
          <p class="cd-what"><span class="cd-lbl">What this shows</span> ${touchNote}</p>
          <p class="cd-read"><span class="cd-lbl">What it does <i>not</i> show</span>
            A band touch on its own is not a signal this app detects, scores, or has tested — see
            <a href="#detected">what this app actually does with it</a>. This card exists to show
            real bands on a real chart, not to claim anything about what happens next.</p>
        </div>
      </article>`;
  } catch {
    container.innerHTML = `<div class="cd-callout">Couldn't load real price data for this section
      right now (needs this app's own dev server serving /historical_prices/). The diagram above
      is unaffected.</div>`;
  }
}

// The tightest the bands ever get in the series, found by measuring every
// bar rather than assumed from how the generator's volatility ramp was
// written — the ramp's timing and the trailing 20-bar window it feeds
// don't line up in an obvious way, so the real minimum lands a bit later
// than a hand-picked window would guess. Same "counted from the data"
// principle hilega-milega.js uses for its whipsaw figure.
function tightestSqueeze(bands) {
  let idx = 19, min = Infinity;
  for (let i = 19; i < bands.upper.length; i++) {
    const w = bands.upper[i] - bands.lower[i];
    if (w < min) { min = w; idx = i; }
  }
  return idx;
}

// ─── Boot ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const full = document.getElementById('bb-full');
  if (full) full.innerHTML = bbSVG(19, N, { w: 720, h: 210 });

  const squeeze = document.getElementById('bb-squeeze');
  if (squeeze) {
    const pinch = tightestSqueeze(BANDS);
    squeeze.innerHTML = bbSVG(Math.max(19, pinch - 20), Math.min(N, pinch + 30), { w: 640, h: 190, marker: pinch });
  }

  loadRealExample();

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
