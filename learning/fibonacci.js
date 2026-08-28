/* ═══════════════════════════════════════════════════════════
   fibonacci.js  —  Fibonacci retracement/extension study guide
   (fibonacci.html)

   Unlike hilega-milega.js / macd-ema.js / bollinger-bands.js, there is no
   indicator maths to port here — Fibonacci tools in this app compute
   nothing automatically. Confirmed by an exhaustive grep of the codebase:
   the only real code is the manual drawing-tool renderer in
   candlestick_chart/tv-drawing-tools.js, which turns two or three
   USER CLICKS into a set of horizontal price levels. This file ports
   that exact ratio math (fibLevels(), the retracement/extension price
   formulas) verbatim, same as the other guides port their indicator
   maths — but there is no automatic swing detection anywhere, so the
   "worked example" below picks the highest high and lowest low over a
   fixed recent window on a real stock and says so plainly, rather than
   implying the app found or detected that swing itself.

   Consumed by: fibonacci.html
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ─── The drawing tool's own ratio math, ported verbatim ────────
// From candlestick_chart/tv-drawing-tools.js's fibLevels() and the
// fibretracement/fibextension render cases.
function fibLevels(kind) {
  if (kind === 'retracement') return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  return [0, 0.382, 0.618, 1, 1.272, 1.618, 2]; // extension / channel / trend-based extension
}
function retracementPrice(p1, p2, ratio) { return p1 + (p2 - p1) * ratio; }
function extensionPrice(p1, p2, p3, ratio) { return p3 + (p2 - p1) * ratio; }

const FIB_COLOR = '#00d4ff';
const PRICE_COLOR = '#1e88e5';
const AXIS = 'rgba(140,150,170,0.85)';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const f2 = v => (v == null ? '—' : v.toFixed(2));
function fmtRealDate(d) {
  const [y, m, day] = String(d).split('/');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${day} ${months[mi]} ${y}` : d;
}

// ─── Retracement diagram (price line + horizontal fib levels) ──
function retracementSVG(prices, hiIdx, loIdx, opts = {}) {
  const w = opts.w ?? 460, h = opts.h ?? 260;
  const padL = 12, padR = 78, padT = 10, padB = 14;
  const plotW = w - padL - padR, plotH = h - padT - padB;

  const from = 0, to = prices.length;
  const p1 = prices[hiIdx], p2 = prices[loIdx]; // p1 = swing high, p2 = swing low (retracing UP from a low back toward a high reads more intuitively, but this app's own tool just takes click order — shown here high-to-low to match the "pullback after a rally" framing in the prose)
  const lo = Math.min(p1, p2), hi = Math.max(p1, p2);
  const pad = (hi - lo) * 0.15 || 1;
  const x = i => padL + (plotW * (i - from)) / Math.max(1, to - from - 1);
  const y = v => padT + plotH * (1 - (v - lo + pad) / (hi - lo + pad * 2));

  const pricePts = prices.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  const levels = fibLevels('retracement').map(ratio => {
    const price = retracementPrice(p1, p2, ratio);
    const yy = y(price);
    return `
      <line x1="${padL}" y1="${yy}" x2="${w - padR + 6}" y2="${yy}" stroke="${FIB_COLOR}"
            stroke-width="1" opacity="${ratio === 0 || ratio === 1 ? 0.9 : 0.55}"
            ${ratio === 0 || ratio === 1 ? '' : 'stroke-dasharray="4 3"'} />
      <text x="${w - padR + 10}" y="${yy + 3}" class="cd-fig-label">${(ratio * 100).toFixed(1)}% ${price.toFixed(2)}</text>`;
  }).join('');

  const swingDots = `
    <circle cx="${x(hiIdx)}" cy="${y(p1)}" r="4" fill="none" stroke="${AXIS}" stroke-width="1.6"/>
    <circle cx="${x(loIdx)}" cy="${y(p2)}" r="4" fill="none" stroke="${AXIS}" stroke-width="1.6"/>`;

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="cd-svg">
    ${levels}
    <polyline points="${pricePts}" fill="none" stroke="${PRICE_COLOR}" stroke-width="1.8"
              stroke-linejoin="round" stroke-linecap="round"/>
    ${swingDots}
  </svg>`;
}

// ─── Real DSE stock — a chosen, not detected, swing ─────────────
const REAL_STOCK_CODE   = 'GP';
const REAL_HISTORY_BARS = 60; // one working "swing" window — see the honesty section for why this is a choice, not a detection

async function loadWorkedExample() {
  const container = document.getElementById('fib-worked-example');
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

    let hiIdx = 0, loIdx = 0;
    closes.forEach((v, i) => { if (v > closes[hiIdx]) hiIdx = i; if (v < closes[loIdx]) loIdx = i; });

    const p1 = closes[hiIdx], p2 = closes[loIdx];
    const rows7 = fibLevels('retracement').map(ratio =>
      `<tr><td class="cd-t-name">${(ratio * 100).toFixed(1)}%</td>
           <td>${f2(retracementPrice(p1, p2, ratio))}</td></tr>`).join('');

    container.innerHTML = `
      <div class="cd-anatomy-fig">${retracementSVG(closes, hiIdx, loIdx, { w: 460, h: 260 })}</div>
      <div class="cd-card-body">
        <p class="cd-what"><span class="cd-lbl">The swing used</span>
          The highest and lowest closes in ${esc(REAL_STOCK_CODE)}'s last ${REAL_HISTORY_BARS}
          sessions: a high of <b>${f2(p1)}</b> on ${esc(fmtRealDate(dates[hiIdx]))}, a low of
          <b>${f2(p2)}</b> on ${esc(fmtRealDate(dates[loIdx]))}. This is <b>one choice</b> of
          swing points among many a trader could have drawn — not a swing this app detected or
          recommends, just the simplest defensible pick for a worked example. See
          <a href="#honest">why that distinction matters</a>.</p>
        <div class="cd-table-wrap">
          <table class="cd-table">
            <thead><tr><th>Level</th><th>Price</th></tr></thead>
            <tbody>${rows7}</tbody>
          </table>
        </div>
      </div>`;
  } catch {
    container.innerHTML = `<div class="cd-callout">Couldn't load real price data for this section
      right now (needs this app's own dev server serving /historical_prices/).</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadWorkedExample();

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
