/* ═══════════════════════════════════════════════════════════
   hilega-milega.js  —  "Hilega-Milega" study guide (hilega-milega.html)

   The diagrams are not drawn by hand. This file carries the SAME three
   calculations the indicator itself uses — calculateRSI, calculateWMA and
   calculateEMA, ported verbatim from candlestick_chart/indicators/ —
   runs them over a deterministic price series, and plots the result. So
   the crossovers shown are crossovers the real indicator produces, not
   an artist's impression of one, and the close-ups are genuine slices of
   the same computed series rather than separately invented shapes.

   Consumed by: hilega-milega.html
   ═══════════════════════════════════════════════════════════ */
'use strict';

// Colours copied from HM_COLORS in indicators/hilega-milega.js so the guide
// and the live pane cannot disagree about which line is which.
const HM = {
  line50:   '#4caf50',
  rsi:      '#26c6da',
  strength: '#f57c00',
  price:    '#1e88e5',
};
const GRID = 'rgba(140,150,170,0.22)';
const AXIS = 'rgba(140,150,170,0.75)';

// ─── The indicator's own maths, ported verbatim ────────────────
function calculateRSI(prices, period = 14) {
  const changes = prices.map((p, i) => (i === 0 ? 0 : p - prices[i - 1]));
  return prices.map((_, i) => {
    if (i < period) return null;
    const slice  = changes.slice(i - period + 1, i + 1);
    const gains  = slice.filter(c => c > 0).reduce((a, b) => a + b, 0);
    const losses = Math.abs(slice.filter(c => c < 0).reduce((a, b) => a + b, 0));
    const avgG   = gains / period;
    const avgL   = losses / period;
    const rs     = avgL === 0 ? 100 : avgG / avgL;
    return 100 - 100 / (1 + rs);
  });
}

function calculateWMA(prices, period) {
  const result = new Array(prices.length).fill(null);
  const denom  = (period * (period + 1)) / 2;
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += prices[i - (period - 1 - j)] * (j + 1);
    result[i] = sum / denom;
  }
  return result;
}

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  const out = [];
  let prev = null;
  prices.forEach((p, i) => {
    if (p == null) { out.push(null); return; }
    prev = prev == null ? p : p * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

// ─── A deterministic price series ──────────────────────────────
// A slow cycle plus bar-to-bar chop, seeded so it is identical on every load —
// otherwise the numbers quoted beside each diagram would drift away from the
// picture they describe.
//
// The chop is the important half. An earlier version used pure sines, which
// produce long unbroken runs of up days; RSI then pins itself at 0 and 100 and
// crosses its average only twice in 130 bars. Real prices alternate, and RSI
// only oscillates when they do.
//
// CALIBRATED against the archive: over the last 130 bars of 57 real DSE stocks,
// RSI(9) had a median low of 10, a median high of 97, and a median 11 bullish /
// 10 bearish crossings of its WMA(21). These constants reproduce 12 / 100 and
// 11 / 11 — so the pane below behaves like the ones on the chart page, rather
// than like a tidied-up illustration of one.
const SERIES_SEED  = 20260808;
const CYCLE_AMP    = 0.7;
const CYCLE_LEN    = 18;
const NOISE_AMP    = 3.0;

function priceSeries(n) {
  // Plain LCG — reproducibility is the only requirement here.
  let s = SERIES_SEED;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  let p = 100;
  for (let i = 0; i < n; i++) {
    p = Math.max(20, p + Math.sin(i / CYCLE_LEN) * CYCLE_AMP + (rnd() - 0.5) * NOISE_AMP);
    out.push(p);
  }
  return out;
}

const N = 130;
const PRICES = priceSeries(N);
const RSI9   = calculateRSI(PRICES, 9);
// WMA and EMA are taken OF THE RSI, not of price — the nulls during RSI's
// own warm-up are filled with 50 exactly as attachHilegaMilega() does.
const WMA21  = calculateWMA(RSI9.map(v => v ?? 50), 21);
const EMA3   = calculateEMA(RSI9.map(v => v ?? 50), 3);

// Every bar where RSI(9) crosses its WMA(21) — the same test
// detectHmCrossover() in routes/screener-technicals.js applies.
function crossovers() {
  const out = [];
  for (let i = 1; i < N; i++) {
    if (RSI9[i] == null || RSI9[i - 1] == null || WMA21[i] == null || WMA21[i - 1] == null) continue;
    const cur = RSI9[i] - WMA21[i];
    const prv = RSI9[i - 1] - WMA21[i - 1];
    if (prv <= 0 && cur > 0) out.push({ i, direction: 'bullish' });
    else if (prv >= 0 && cur < 0) out.push({ i, direction: 'bearish' });
  }
  return out;
}
const CROSSES = crossovers();

// ─── Renderer ──────────────────────────────────────────────────
/**
 * Plot a slice of the computed series as the indicator's own pane:
 * shaded 50-zones, the RSI(9) line, WMA(21) as dots, EMA(3) as a line.
 *
 * @param from,to  slice bounds into the precomputed arrays
 * @param opts     {w,h,showEma,showWma,marker,labels}
 */
function hmSVG(from, to, opts = {}) {
  const w = opts.w ?? 460;
  const h = opts.h ?? 170;
  const padL = 26, padR = 10, padT = 10, padB = 14;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  // Defaults to the synthetic series so every existing call site (the
  // anatomy/zones/whipsaw figures, the synthetic cross cards) is unchanged —
  // real-stock cards pass their own computed {RSI9,WMA21,EMA3} instead.
  const { RSI9: rsi, WMA21: wma, EMA3: ema } = opts.series || { RSI9, WMA21, EMA3 };

  const idx = [];
  for (let i = from; i < to; i++) idx.push(i);
  const x = k => padL + (plotW * (k - from)) / Math.max(1, to - from - 1);
  const y = v => padT + plotH * (1 - v / 100);

  // Gridlines + axis labels at the levels the real pane draws.
  const grid = [0, 30, 50, 70, 100].map(lv => `
    <line x1="${padL}" y1="${y(lv)}" x2="${w - padR}" y2="${y(lv)}"
          stroke="${lv === 50 ? HM.line50 : GRID}" stroke-width="1"
          ${lv === 50 ? '' : 'stroke-dasharray="2 3"'} opacity="${lv === 50 ? 0.9 : 1}" />
    <text x="${padL - 5}" y="${y(lv) + 3}" text-anchor="end" class="cd-fig-label">${lv}</text>`).join('');

  // Shaded zones above / below 50, the same fills the live pane paints.
  const bands = [];
  let s = 0;
  while (s < idx.length) {
    const above = (rsi[idx[s]] ?? 50) > 50;
    let e = s;
    while (e < idx.length && ((rsi[idx[e]] ?? 50) > 50) === above) e++;
    const seg = idx.slice(s, e);
    if (seg.length >= 2) {
      const pts = seg.map(k => `${x(k)},${y(rsi[k] ?? 50)}`).join(' ');
      bands.push(`<polygon points="${x(seg[0])},${y(50)} ${pts} ${x(seg[seg.length - 1])},${y(50)}"
            fill="${above ? 'rgba(255,140,80,0.42)' : 'rgba(100,210,255,0.32)'}" />`);
    }
    s = e;
  }

  const line = (arr, col, wid) => {
    const pts = idx.filter(k => arr[k] != null).map(k => `${x(k)},${y(arr[k])}`);
    return pts.length < 2 ? '' :
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}"
                 stroke-width="${wid}" stroke-linejoin="round" stroke-linecap="round" />`;
  };

  const dots = opts.showWma === false ? '' : idx
    .filter(k => wma[k] != null && (to - from < 60 || (k - from) % 2 === 0))
    .map(k => `<circle cx="${x(k)}" cy="${y(wma[k])}" r="${to - from < 60 ? 2.2 : 1.6}"
                       fill="${HM.strength}" />`).join('');

  // Ring + drop-line on each bar where a cross happens. `marker` is the single
  // highlighted case; `markers` tags every crossing in the slice, which is how
  // the whipsaw figure shows density rather than one event.
  const ring = (k, strong) => `
    <line x1="${x(k)}" y1="${padT}" x2="${x(k)}" y2="${h - padB}"
          stroke="${AXIS}" stroke-width="1" stroke-dasharray="3 3" opacity="${strong ? 0.8 : 0.45}" />
    <circle cx="${x(k)}" cy="${y(rsi[k])}" r="${strong ? 4.5 : 3}"
            fill="none" stroke="${AXIS}" stroke-width="${strong ? 1.6 : 1.2}" />`;
  const marker = opts.marker != null ? ring(opts.marker, true)
    : (opts.markers || []).filter(k => k >= from && k < to).map(k => ring(k, false)).join('');

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="cd-svg">
    ${grid}${bands.join('')}
    ${opts.showEma === false ? '' : line(ema, HM.price, 1.2)}
    ${line(rsi, HM.rsi, 1.6)}
    ${dots}${marker}
  </svg>`;
}

// ─── Render ────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const f2 = v => (v == null ? '—' : v.toFixed(2));

function crossCard(c) {
  const bull = c.direction === 'bullish';
  const from = Math.max(0, c.i - 16), to = Math.min(N, c.i + 12);
  return `
    <article class="cd-card">
      <div class="cd-card-fig">${hmSVG(from, to, { w: 340, h: 165, marker: c.i })}</div>
      <div class="cd-card-body">
        <header class="cd-card-head">
          <h3>${bull ? 'Buy crossover' : 'Sell crossover'}</h3>
          <span class="cd-chip">${bull ? '▲ Bullish' : '▼ Bearish'}</span>
        </header>
        <p class="cd-what"><span class="cd-lbl">What happened</span>
          RSI(9) closed ${bull ? 'above' : 'below'} its own WMA(21) on this bar,
          having been ${bull ? 'below' : 'above'} it on the one before.</p>
        <div class="cd-metrics">
          <span>prev <b>${f2(RSI9[c.i - 1])}</b> vs <b>${f2(WMA21[c.i - 1])}</b></span>
          <span>now <b>${f2(RSI9[c.i])}</b> vs <b>${f2(WMA21[c.i])}</b></span>
          <span>gap <b>${(RSI9[c.i] - WMA21[c.i]) > 0 ? '+' : ''}${f2(RSI9[c.i] - WMA21[c.i])}</b></span>
        </div>
        <p class="cd-read"><span class="cd-lbl">How to read it</span>
          ${bull
            ? 'The fast line has pulled above its own slow average — momentum is improving relative to its recent norm. Note this says nothing about price direction on its own; the RSI can cross up while price is still falling.'
            : 'The fast line has dropped below its own slow average. Momentum is cooling relative to its recent norm — again, a statement about the oscillator, not a forecast of price.'}</p>
      </div>
    </article>`;
}

// ─── Real DSE stocks ───────────────────────────────────────────
// Same three calculations, same crossover test, run over real daily closes
// fetched from this app's own /historical_prices archive instead of the
// generated series above. The synthetic series exists so the anatomy
// diagrams stay stable as the archive grows (see the "Reading it honestly"
// section) — these are the opposite: genuine bars, genuine dates, genuine
// tickers, picked programmatically rather than hand-selected.
const REAL_STOCK_CODES = ['BRACBANK', 'GP', 'RENATA', 'BEXIMCO', 'BATBC', 'ACI'];
const REAL_FWD_BARS     = 5; // trading days forward used to score "did it follow through"
const REAL_HISTORY_BARS = 160;

async function fetchRealSeries(code) {
  const res = await fetch(`/historical_prices/json_files/${code}.json`);
  if (!res.ok) throw new Error(`fetch failed for ${code}: ${res.status}`);
  const raw = await res.json();
  // Newest-first on disk; sort ascending. Halted/no-trade sessions are
  // recorded with O/H/L/V all 0 and only Close carried over — a price can
  // never be <= 0, so this is the same defensive filter trade-analysis.js
  // uses against the same archive.
  const rows = raw
    .filter(r => r.Open > 0 && r.High > 0 && r.Low > 0 && r.Close > 0)
    .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0))
    .slice(-REAL_HISTORY_BARS);

  const closes = rows.map(r => r.Close);
  const dates  = rows.map(r => r.Date);
  const rsi    = calculateRSI(closes, 9);
  const wma    = calculateWMA(rsi.map(v => v ?? 50), 21);
  const ema    = calculateEMA(rsi.map(v => v ?? 50), 3);
  return { code, dates, closes, N: rows.length, series: { RSI9: rsi, WMA21: wma, EMA3: ema } };
}

// Identical test to crossovers() above (and to detectHmCrossover() server-side).
function findRealCrossovers(s) {
  const { RSI9: rsi, WMA21: wma } = s.series;
  const out = [];
  for (let i = 1; i < s.N; i++) {
    if (rsi[i] == null || rsi[i - 1] == null || wma[i] == null || wma[i - 1] == null) continue;
    const cur = rsi[i] - wma[i];
    const prv = rsi[i - 1] - wma[i - 1];
    if (prv <= 0 && cur > 0) out.push({ i, direction: 'bullish' });
    else if (prv >= 0 && cur < 0) out.push({ i, direction: 'bearish' });
  }
  return out;
}

function fmtRealDate(d) {
  // Stored as 'YYYY/MM/DD'.
  const [y, m, day] = String(d).split('/');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${day} ${months[mi]} ${y}` : d;
}

function realCrossCard(e) {
  const bull      = e.direction === 'bullish';
  const { RSI9: rsi, WMA21: wma } = e.series;
  const from      = Math.max(0, e.i - 16), to = Math.min(e.N, e.i + 12);
  const worked    = bull ? e.fwdReturnPct > 0 : e.fwdReturnPct < 0;
  return `
    <article class="cd-card">
      <div class="cd-card-fig">${hmSVG(from, to, { w: 340, h: 165, marker: e.i, series: e.series })}</div>
      <div class="cd-card-body">
        <header class="cd-card-head">
          <h3>${esc(e.code)}</h3>
          <span class="cd-chip cd-chip--real">Real stock</span>
          <span class="cd-chip">${bull ? '▲ Bullish' : '▼ Bearish'}</span>
        </header>
        <p class="cd-what"><span class="cd-lbl">What happened</span>
          On ${esc(fmtRealDate(e.date))}, RSI(9) closed ${bull ? 'above' : 'below'} its own
          WMA(21) on ${esc(e.code)}'s daily chart, having been ${bull ? 'below' : 'above'} it
          the session before.</p>
        <div class="cd-metrics">
          <span>RSI <b>${f2(rsi[e.i])}</b></span>
          <span>WMA <b>${f2(wma[e.i])}</b></span>
          <span>${REAL_FWD_BARS}-day fwd return
            <b class="${worked ? 'cd-good' : 'cd-bad'}">${e.fwdReturnPct > 0 ? '+' : ''}${e.fwdReturnPct.toFixed(1)}%</b></span>
        </div>
        <p class="cd-read"><span class="cd-lbl">How it played out</span>
          Price ${e.fwdReturnPct > 0 ? 'rose' : e.fwdReturnPct < 0 ? 'fell' : 'was flat'}
          ${Math.abs(e.fwdReturnPct).toFixed(1)}% over the ${REAL_FWD_BARS} sessions after this cross —
          this is ${worked ? 'one instance the direction agreed with' : 'one instance the direction went against'},
          picked programmatically as the largest same-direction move among this sample's crossings,
          not cherry-picked for a good story. One instance is not a track record; see
          <a href="#evidence">what the actual backtest found</a> before drawing a conclusion from it.</p>
      </div>
    </article>`;
}

function realWhipsawCard(w) {
  const { RSI9: rsi, WMA21: wma } = w.series;
  const from = Math.max(0, w.a.i - 6), to = Math.min(w.N, w.b.i + 8);
  return `
    <article class="cd-card">
      <div class="cd-card-fig">${hmSVG(from, to, { w: 340, h: 165, markers: [w.a.i, w.b.i], series: w.series })}</div>
      <div class="cd-card-body">
        <header class="cd-card-head">
          <h3>${esc(w.code)}</h3>
          <span class="cd-chip cd-chip--real">Real stock</span>
          <span class="cd-chip cd-chip--warn">Whipsaw</span>
        </header>
        <p class="cd-what"><span class="cd-lbl">What happened</span>
          A ${w.a.direction} crossover on ${esc(fmtRealDate(w.a.date))} reversed into a
          ${w.b.direction} crossover just ${w.gap} session${w.gap === 1 ? '' : 's'} later, on
          ${esc(fmtRealDate(w.b.date))} — the same failure mode as the synthetic
          <a href="#honest">example above</a>, found in a real chart rather than illustrated.</p>
        <div class="cd-metrics">
          <span>first cross <b>${f2(rsi[w.a.i])}</b> vs <b>${f2(wma[w.a.i])}</b></span>
          <span>reversed <b>${f2(rsi[w.b.i])}</b> vs <b>${f2(wma[w.b.i])}</b></span>
        </div>
        <p class="cd-read"><span class="cd-lbl">How to read it</span>
          Anyone who acted on the first signal would have been reversed out (or stopped) within
          the week by the second. This is not a rare stock-specific quirk — it is what the
          indicator does whenever RSI hovers near its own average, which is often.</p>
      </div>
    </article>`;
}

// Finds the tightest opposite-direction pair across every fetched stock —
// picked by smallest gap (the most whipsaw-like), not asserted.
function findRealWhipsaw(seriesList) {
  let best = null;
  seriesList.forEach(s => {
    const cs = findRealCrossovers(s);
    for (let k = 1; k < cs.length; k++) {
      if (cs[k].direction === cs[k - 1].direction) continue;
      const gap = cs[k].i - cs[k - 1].i;
      if (gap > 6) continue; // not a whipsaw if the reversal took weeks
      if (!best || gap < best.gap) {
        best = {
          code: s.code, series: s.series, N: s.N, gap,
          a: { ...cs[k - 1], date: s.dates[cs[k - 1].i] },
          b: { ...cs[k], date: s.dates[cs[k].i] },
        };
      }
    }
  });
  return best;
}

async function loadRealExamples() {
  const container = document.getElementById('hm-real-examples');
  if (!container) return;

  let seriesList;
  try {
    seriesList = (await Promise.allSettled(REAL_STOCK_CODES.map(fetchRealSeries)))
      .filter(r => r.status === 'fulfilled').map(r => r.value);
  } catch {
    seriesList = [];
  }
  if (!seriesList.length) {
    container.innerHTML = `<div class="cd-callout">Couldn't load real price data for this section
      right now (needs this app's own dev server serving /historical_prices/). The synthetic
      diagrams above are unaffected.</div>`;
    return;
  }

  // Keep the legibility filter used for the synthetic picks: a crossover
  // with RSI pinned at the floor/ceiling of the pane is hard to actually see.
  const legible = (s, i) => s.series.RSI9[i] >= 30 && s.series.RSI9[i] <= 75;

  const candidates = [];
  seriesList.forEach(s => {
    findRealCrossovers(s).forEach(c => {
      const j = c.i + REAL_FWD_BARS;
      if (j >= s.N) return;
      const fwdReturnPct = ((s.closes[j] - s.closes[c.i]) / s.closes[c.i]) * 100;
      candidates.push({ ...c, code: s.code, series: s.series, N: s.N, date: s.dates[c.i], fwdReturnPct, legible: legible(s, c.i) });
    });
  });

  const bestBull = candidates
    .filter(c => c.direction === 'bullish' && c.legible && c.fwdReturnPct > 0)
    .sort((a, b) => b.fwdReturnPct - a.fwdReturnPct)[0];
  const bestBear = candidates
    .filter(c => c.direction === 'bearish' && c.legible && c.fwdReturnPct < 0)
    .sort((a, b) => a.fwdReturnPct - b.fwdReturnPct)[0];
  const whipsaw = findRealWhipsaw(seriesList);

  const cards = [bestBull, bestBear].filter(Boolean).map(realCrossCard).concat(
    whipsaw ? [realWhipsawCard(whipsaw)] : []
  );

  container.innerHTML = cards.length
    ? cards.join('')
    : `<div class="cd-callout">No qualifying crossovers turned up in this sample of stocks today —
        rerun after prices update.</div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const full = document.getElementById('hm-full');
  if (full) full.innerHTML = hmSVG(30, N, { w: 720, h: 220 });

  // One of each direction. Preference is for a cross that happens with the RSI
  // mid-pane: the series has plenty of crossings down at RSI 20, but there the
  // two lines are squashed against the floor of the plot and the reader cannot
  // actually see the thing being described.
  const list = document.getElementById('hm-crosses');
  if (list) {
    const legible = c => RSI9[c.i] >= 35 && RSI9[c.i] <= 75;
    const pick = (dir) => CROSSES.filter(c => c.direction === dir && legible(c)).pop()
                       || CROSSES.filter(c => c.direction === dir).pop();
    list.innerHTML = [pick('bullish'), pick('bearish')].filter(Boolean).map(crossCard).join('');
  }

  // Whipsaw: the densest run of crossings in the series, marked all at once.
  // Counted from the data rather than asserted, so the prose cannot overstate it.
  const whip = document.getElementById('hm-whipsaw');
  if (whip) {
    const FROM = 74, TO = 106;
    const inRange = CROSSES.filter(c => c.i >= FROM && c.i < TO);
    whip.innerHTML = hmSVG(FROM, TO, { w: 660, h: 190, markers: inRange.map(c => c.i) });
    const n = document.getElementById('hm-whipcount');
    if (n) n.textContent = inRange.length;
    const b = document.getElementById('hm-whipbars');
    if (b) b.textContent = TO - FROM;
  }

  const zones = document.getElementById('hm-zones');
  if (zones) zones.innerHTML = hmSVG(30, 95, { w: 640, h: 190, showEma: false, showWma: false });

  const stat = document.getElementById('hm-crosscount');
  if (stat) stat.textContent = CROSSES.length;

  // Async and independent of everything above — a slow or failed fetch
  // shouldn't hold up (or break) the synthetic diagrams, which are all
  // computed locally and render instantly.
  loadRealExamples();

  // Scroll-spy for the sticky contents rail (same behaviour as candles.js).
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
