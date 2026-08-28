/* ═══════════════════════════════════════════════════════════
   candles.js  —  "Different Candles" study guide (candles.html)

   Every diagram on the page is DRAWN FROM OHLC NUMBERS rather than
   hand-drawn as SVG paths. A hand-drawn hammer can be given a wick
   ratio no real candle would ever satisfy; one rendered from actual
   OHLC cannot lie about its own proportions, and the figures printed
   under each diagram are computed from the same numbers the shape is
   drawn from. Where a pattern has a threshold this app really tests
   (see screener/screener.js), the sample is chosen to sit clearly
   inside it.

   Consumed by: candles.html
   ═══════════════════════════════════════════════════════════ */
'use strict';

const UP   = '#26a69a';
const DOWN = '#ef5350';
const NEUTRAL = '#8b95a8';

// ─── Renderer ──────────────────────────────────────────────────
/**
 * Draw a row of candles as inline SVG, auto-scaled to the group's
 * own high/low so every candle in one diagram shares a price axis.
 *
 * @param candles [{o,h,l,c,label?,color?}]
 * @param opts    {w,h,pad,midline:{value,label}}
 *
 * `midline` draws a dashed reference level across the diagram. Piercing and
 * Dark Cloud Cover are *defined* by where the second candle closes relative to
 * the midpoint of the first one's body, so for those two the level is the
 * pattern — without it drawn, the picture is just two opposing candles.
 */
function candleSVG(candles, opts = {}) {
  const w   = opts.w   ?? (candles.length * 46 + 24);
  const h   = opts.h   ?? 150;
  const pad = opts.pad ?? 16;
  const lo  = Math.min(...candles.map(c => c.l));
  const hi  = Math.max(...candles.map(c => c.h));
  const span = (hi - lo) || 1;

  // 6% headroom so a marubozu's flat top doesn't sit flush on the frame.
  const top = hi + span * 0.06, bot = lo - span * 0.06;
  const y = v => pad + (h - pad * 2) * (1 - (v - bot) / ((top - bot) || 1));

  const slot = (w - pad * 2) / candles.length;
  const bodyW = Math.min(22, slot * 0.55);

  const parts = candles.map((c, i) => {
    const cx = pad + slot * (i + 0.5);
    const rising = c.c >= c.o;
    const col = c.color || (rising ? UP : DOWN);
    const yO = y(c.o), yC = y(c.c);
    const bodyTop = Math.min(yO, yC);
    // A doji's body is mathematically zero-height; floor it at 1.5px so the
    // open/close line stays visible instead of vanishing.
    const bodyH = Math.max(1.5, Math.abs(yC - yO));

    return `
      <line x1="${cx}" y1="${y(c.h)}" x2="${cx}" y2="${y(c.l)}"
            stroke="${col}" stroke-width="1.5" />
      <rect x="${cx - bodyW / 2}" y="${bodyTop}" width="${bodyW}" height="${bodyH}"
            fill="${c.hollow ? 'none' : col}" stroke="${col}" stroke-width="1.5" rx="0.5" />
      ${c.label ? `<text x="${cx}" y="${h - 3}" text-anchor="middle"
            class="cd-fig-label">${c.label}</text>` : ''}`;
  }).join('');

  // Drawn before the candles so they sit on top of the rule, not under it.
  const mid = opts.midline;
  const midline = mid ? `
      <line x1="${pad * 0.3}" y1="${y(mid.value)}" x2="${w - pad * 0.3}" y2="${y(mid.value)}"
            stroke="${NEUTRAL}" stroke-width="1" stroke-dasharray="3 3" opacity="0.8" />
      <text x="${w - pad * 0.3}" y="${y(mid.value) - 5}" text-anchor="end"
            class="cd-fig-label">${mid.label || '50%'}</text>` : '';

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"
               role="img" class="cd-svg">${midline}${parts}</svg>`;
}

// ─── Metrics, computed from the same OHLC the shape is drawn from ──
function metrics(c) {
  const range = c.h - c.l;
  const body  = Math.abs(c.c - c.o);
  const upper = c.h - Math.max(c.o, c.c);
  const lower = Math.min(c.o, c.c) - c.l;
  const pct = v => (range > 0 ? ((v / range) * 100).toFixed(0) : '0');
  return {
    range, body, upper, lower,
    bodyPct: pct(body), upperPct: pct(upper), lowerPct: pct(lower),
    wickToBody: body > 0 ? (Math.max(upper, lower) / body).toFixed(1) : '∞',
  };
}

// ─── The catalogue ─────────────────────────────────────────────
// `test` is the rule THIS app applies, quoted only where screener.js
// really implements it — the rest are described without pretending
// the codebase detects them.
const SINGLE = [
  {
    id: 'marubozu-bull',
    name: 'Bullish Marubozu',
    tag: 'Detected by this app',
    candles: [{ o: 100, h: 112.4, l: 99.6, c: 112 }],
    means: 'Opened at (or within a hair of) the low and closed at the high. Buyers held the bid from the first trade to the last and never let sellers take price back.',
    read: 'The strongest single-bar statement of demand there is. It often marks a breakout bar or the first leg of a trend. The risk is that it leaves no obvious stop level — the whole bar is the move.',
    test: 'body ÷ range ≥ 0.85, and BOTH wicks ≤ 5% of range, and close > open.',
  },
  {
    id: 'marubozu-bear',
    name: 'Bearish Marubozu',
    tag: 'Detected by this app',
    candles: [{ o: 112, h: 112.4, l: 99.6, c: 100 }],
    means: 'The mirror image: opened at the high, closed at the low, sellers in control throughout.',
    read: 'Reads as capitulation or aggressive distribution. On the DSE it frequently appears on circuit-breaker days, where the shape reflects a price limit rather than free two-way trade — worth checking before treating it as sentiment.',
    test: 'body ÷ range ≥ 0.85, and BOTH wicks ≤ 5% of range, and close < open.',
  },
  {
    id: 'hammer',
    name: 'Hammer',
    tag: 'Detected by this app',
    candles: [{ o: 104, h: 105, l: 96, c: 104.6 }],
    means: 'Price was driven well below the open and then bought all the way back before the close. The long lower wick is the record of a rejection.',
    read: 'Only meaningful AFTER a decline — the same shape in an uptrend is a Hanging Man and warns of the opposite. Context, not shape, decides which one you are looking at.',
    test: 'body ÷ range ≤ 0.35, lower wick ≥ 2× body, upper wick ≤ 10% of range.',
  },
  {
    id: 'shooting-star',
    name: 'Shooting Star',
    tag: 'Detected by this app',
    candles: [{ o: 100.4, h: 109, l: 100, c: 101 }],
    means: 'Buyers pushed price far above the open and lost every bit of it by the close. The long upper wick is supply appearing at higher prices.',
    read: 'Bearish after an advance. The app files this under "Bearish Hammer" — the geometry is a hammer flipped vertically, which is why the same threshold constants drive both.',
    test: 'body ÷ range ≤ 0.35, upper wick ≥ 2× body, lower wick ≤ 10% of range.',
  },
  {
    id: 'doji',
    name: 'Doji',
    candles: [{ o: 104, h: 109, l: 99, c: 104.1, color: NEUTRAL }],
    means: 'Open and close are effectively equal. Everything that happened during the session was undone by the end of it.',
    read: 'Indecision, not direction. A doji is a question, and the NEXT bar answers it. Alone it is one of the least actionable shapes on a chart — its value is almost entirely in where it appears.',
  },
  {
    id: 'dragonfly',
    name: 'Dragonfly Doji',
    candles: [{ o: 108.8, h: 109, l: 99, c: 109, color: NEUTRAL }],
    means: 'Open, high and close all sit together at the top; a long lower wick runs beneath. A total round-trip rejection of lower prices.',
    read: 'The most bullish member of the doji family, and close cousin to the hammer — the difference is only that the body has shrunk to nothing.',
  },
  {
    id: 'gravestone',
    name: 'Gravestone Doji',
    candles: [{ o: 99.2, h: 109, l: 99, c: 99, color: NEUTRAL }],
    means: 'Open, low and close together at the bottom, long upper wick above. Every attempt at a higher price was sold.',
    read: 'The bearish mirror of the dragonfly. After an extended run it is a clean visual record of supply overwhelming demand intraday.',
  },
  {
    id: 'spinning-top',
    name: 'Spinning Top',
    candles: [{ o: 103, h: 109, l: 99, c: 104.8, color: NEUTRAL }],
    means: 'A small body with meaningful wicks on BOTH sides. Price travelled in both directions and settled near where it started.',
    read: 'Like the doji, a balance signal — but with a real body, so slightly less stark. A cluster of these is how consolidation looks bar by bar.',
  },
];

const MULTI = [
  {
    id: 'engulfing-bull',
    name: 'Bullish Engulfing',
    candles: [
      { o: 106, h: 106.6, l: 101.4, c: 102, label: '1' },
      { o: 101.4, h: 108.4, l: 101, c: 107.6, label: '2' },
    ],
    means: 'A down bar, then an up bar whose body completely covers it — opening at or below the prior close and closing at or above the prior open.',
    read: 'The second bar says everyone who sold during the first one is now underwater. Strongest when the second bar carries visibly heavier volume; without that it is just a big green bar.',
  },
  {
    id: 'engulfing-bear',
    name: 'Bearish Engulfing',
    candles: [
      { o: 102, h: 106.6, l: 101.4, c: 106, label: '1' },
      { o: 106.6, h: 107, l: 100.6, c: 101, label: '2' },
    ],
    means: 'An up bar fully swallowed by the following down bar.',
    read: 'The classic distribution tell at the top of a run. Same volume caveat applies in reverse.',
  },
  {
    id: 'piercing',
    name: 'Piercing Pattern',
    // Candle 1 body runs 108 → 101, so its midpoint is 104.5. Candle 2 opens
    // below candle 1's low (a gap down) and closes at 105.4, clearly above it.
    candles: [
      { o: 108, h: 108.6, l: 100.4, c: 101, label: '1' },
      { o: 100, h: 106, l: 99.6, c: 105.4, label: '2' },
    ],
    svgOpts: { w: 156, midline: { value: 104.5, label: '50%' } },
    means: 'A down bar, then an up bar that opens LOWER still — usually gapping below the prior low — and then closes back above the midpoint of the first bar\'s body.',
    read: 'The half-way line is the whole pattern. A recovery that stalls below it is just a bounce; closing above it means buyers undid more than half of the previous session in one bar. Weaker than a Bullish Engulfing, which recovers the entire body rather than half of it.',
  },
  {
    id: 'dark-cloud',
    name: 'Dark Cloud Cover',
    // Mirror: candle 1 body 101 → 107, midpoint 104. Candle 2 opens above
    // candle 1's high and closes at 102.6, below the midpoint.
    candles: [
      { o: 101, h: 107.6, l: 100.4, c: 107, label: '1' },
      { o: 108, h: 108.4, l: 102, c: 102.6, label: '2' },
    ],
    svgOpts: { w: 156, midline: { value: 104, label: '50%' } },
    means: 'The bearish mirror: an up bar, then a bar that opens ABOVE the prior high and closes below the midpoint of the first bar\'s body.',
    read: 'The open above the high is what makes it meaningful — the session began with every buyer in profit and ended with more than half of them underwater. On the DSE, check the gap is a real trade and not a thin opening print before reading much into it.',
  },
  {
    id: 'harami',
    name: 'Harami',
    candles: [
      { o: 109, h: 109.6, l: 99.4, c: 100, label: '1' },
      { o: 102.4, h: 104.4, l: 101.6, c: 103.6, label: '2' },
    ],
    means: 'The opposite containment: a large bar, then a small one that sits entirely INSIDE the first bar\'s body. ("Harami" is Japanese for pregnant.)',
    read: 'Not a reversal so much as an abrupt stop. Momentum that was violent one bar ago has gone quiet. It calls for waiting, not acting.',
  },
  {
    id: 'morning-star',
    name: 'Morning Star',
    candles: [
      { o: 109, h: 109.4, l: 102.6, c: 103, label: '1' },
      { o: 101.6, h: 102.4, l: 100.6, c: 101.8, label: '2' },
      { o: 103, h: 108.6, l: 102.6, c: 108, label: '3' },
    ],
    means: 'Three bars: a strong decline, a small indecisive bar that gaps down, then a strong advance closing well into the first bar\'s body.',
    read: 'One of the more reliable classical reversals because it shows the full sequence — selling, exhaustion, then buying — rather than asking you to infer it from one bar.',
  },
  {
    id: 'evening-star',
    name: 'Evening Star',
    candles: [
      { o: 101, h: 107.4, l: 100.6, c: 107, label: '1' },
      { o: 108.2, h: 109.4, l: 107.6, c: 108.4, label: '2' },
      { o: 107, h: 107.4, l: 101.4, c: 102, label: '3' },
    ],
    means: 'The bearish mirror — advance, stall, then a decisive down bar closing deep into the first body.',
    read: 'Same logic inverted. The middle bar is the important one: it is where the trend stopped being a trend.',
  },
  {
    id: 'tweezer',
    name: 'Tweezer Bottom',
    candles: [
      { o: 107, h: 107.4, l: 100, c: 101, label: '1' },
      { o: 101.4, h: 106.6, l: 100.1, c: 106, label: '2' },
    ],
    means: 'Two consecutive bars printing almost exactly the same low.',
    read: 'A level tested twice and held twice. This is really a support story told in two bars — which is why it pairs naturally with the Screener\'s Support scan rather than standing alone.',
  },
];

const CHART_TYPES = [
  ['Candlestick', 'The default. Body = open→close, wicks = the full high/low range.', 'Everything below is a transformation of these same four numbers.'],
  ['Hollow', 'Body is filled or hollow depending on close vs PREVIOUS close, not vs open.', 'Separates "up day" from "up bar", which the standard candle conflates.'],
  ['Heikin-Ashi', 'Each bar is an average of the current and prior bar\'s OHLC.', 'Smooths noise and makes trends visually obvious — but prices shown are NOT real traded prices. Never read a stop level off it.'],
  ['Renko', 'Bricks of a fixed price size, drawn only when price moves that far. Time is discarded.', 'Strips out sideways chop entirely. The cost is that you lose all sense of how long a move took.'],
  ['Bar (OHLC)', 'A vertical range line with left tick = open, right tick = close.', 'Same information as a candle, far less ink. Easier to read at very high bar counts.'],
  ['Line / Area', 'Closing prices only, joined up.', 'Throws away three of the four numbers. Useful for shape and for long ranges where candles turn to mush.'],
];

// ─── Render ────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function patternCard(p, withMetrics) {
  const m = withMetrics ? metrics(p.candles[0]) : null;
  return `
    <article class="cd-card" id="${esc(p.id)}">
      <div class="cd-card-fig">${candleSVG(p.candles, p.svgOpts || {})}</div>
      <div class="cd-card-body">
        <header class="cd-card-head">
          <h3>${esc(p.name)}</h3>
          ${p.tag ? `<span class="cd-chip">${esc(p.tag)}</span>` : ''}
        </header>
        <p class="cd-what"><span class="cd-lbl">What it is</span>${esc(p.means)}</p>
        <p class="cd-read"><span class="cd-lbl">How to read it</span>${esc(p.read)}</p>
        ${m ? `<div class="cd-metrics">
          <span><b>${m.bodyPct}%</b> body</span>
          <span><b>${m.upperPct}%</b> upper wick</span>
          <span><b>${m.lowerPct}%</b> lower wick</span>
          ${/* Only for wick-dominant shapes. On a marubozu this ratio is a
                correct but useless "0.0×" — the body:range figure above is the
                one that defines it, and showing both invites reading the wrong
                one as the point of the pattern. */''}
          ${Number(m.bodyPct) < 50 ? `<span><b>${m.wickToBody}×</b> wick : body</span>` : ''}
        </div>` : ''}
        ${p.test ? `<p class="cd-test"><span class="cd-lbl">Rule this app applies</span><code>${esc(p.test)}</code></p>` : ''}
      </div>
    </article>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const single = document.getElementById('cd-single');
  const multi  = document.getElementById('cd-multi');
  const types  = document.getElementById('cd-types');
  const anat   = document.getElementById('cd-anatomy-fig');

  if (anat) {
    anat.innerHTML = candleSVG([
      { o: 102, h: 110, l: 98, c: 108 },
      { o: 108, h: 109.5, l: 100, c: 101 },
    ], { w: 190, h: 210, pad: 22 });
  }

  if (single) single.innerHTML = SINGLE.map(p => patternCard(p, true)).join('');
  if (multi)  multi.innerHTML  = MULTI.map(p => patternCard(p, false)).join('');

  if (types) {
    types.innerHTML = CHART_TYPES.map(([name, how, why]) => `
      <tr>
        <td class="cd-t-name">${esc(name)}</td>
        <td>${esc(how)}</td>
        <td class="cd-t-why">${esc(why)}</td>
      </tr>`).join('');
  }

  // Scroll-spy for the sticky contents rail.
  const links = [...document.querySelectorAll('.cd-toc a')];
  const targets = links
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (targets.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        links.forEach(a => a.classList.toggle(
          'active', a.getAttribute('href') === '#' + e.target.id));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    targets.forEach(t => io.observe(t));
  }
});
