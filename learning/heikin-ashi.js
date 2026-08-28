/* ═══════════════════════════════════════════════════════════
   heikin-ashi.js  —  Heikin-Ashi study guide (heikin-ashi.html)

   Same ported-verbatim approach as the other guides: the transform below
   is candlestick_chart/candlestick-data.js's calculateHeikinAshi(), copied
   field-for-field (Open/High/Low/Close, same averaging, same first-bar
   special case). The anatomy diagrams run this over hand-built OHLC runs
   chosen to sit clearly in one regime (strong up, strong down, chop) —
   picked the same way candles.js picks its samples, not left to chance.
   ═══════════════════════════════════════════════════════════ */
'use strict';

const UP   = '#26a69a';
const DOWN = '#ef5350';
const NEUTRAL = '#8b95a8';

// ─── Ported verbatim from candlestick_chart/candlestick-data.js ──────
function calculateHeikinAshi(data) {
  const ha = [];
  for (let i = 0; i < data.length; i++) {
    const c       = data[i];
    const haClose = (c.Open + c.High + c.Low + c.Close) / 4;
    const haOpen  = i === 0
      ? (c.Open + c.Close) / 2
      : (ha[i - 1].Open + ha[i - 1].Close) / 2;
    const haHigh  = Math.max(c.High, haOpen, haClose);
    const haLow   = Math.min(c.Low,  haOpen, haClose);
    ha.push({ ...c, Open: haOpen, High: haHigh, Low: haLow, Close: haClose });
  }
  return ha;
}

// ─── SVG candle renderer (same drawing logic as candles.js's candleSVG,
// rewritten locally so this guide doesn't depend on another page's script) ──
function candleSVG(candles, opts = {}) {
  const w   = opts.w   ?? (candles.length * 40 + 24);
  const h   = opts.h   ?? 140;
  const pad = opts.pad ?? 14;
  const lo  = Math.min(...candles.map(c => c.Low));
  const hi  = Math.max(...candles.map(c => c.High));
  const span = (hi - lo) || 1;
  const top = hi + span * 0.08, bot = lo - span * 0.08;
  const y = v => pad + (h - pad * 2) * (1 - (v - bot) / ((top - bot) || 1));
  const slot = (w - pad * 2) / candles.length;
  const bodyW = Math.min(20, slot * 0.55);

  const parts = candles.map((c, i) => {
    const cx = pad + slot * (i + 0.5);
    const rising = c.Close >= c.Open;
    const col = rising ? UP : DOWN;
    const yO = y(c.Open), yC = y(c.Close);
    const bodyTop = Math.min(yO, yC);
    const bodyH = Math.max(1.5, Math.abs(yC - yO));
    return `
      <line x1="${cx}" y1="${y(c.High)}" x2="${cx}" y2="${y(c.Low)}" stroke="${col}" stroke-width="1.5" />
      <rect x="${cx - bodyW / 2}" y="${bodyTop}" width="${bodyW}" height="${bodyH}" fill="${col}" stroke="${col}" stroke-width="1.5" rx="0.5" />`;
  }).join('');

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" class="cd-svg">${parts}</svg>`;
}

function ohlc(Open, High, Low, Close) { return { Open, High, Low, Close }; }

// ─── Three hand-built regimes — each constructed, not sampled, so it
// unambiguously shows the thing it's labelled as ──────────────────────
const REGIMES = {
  uptrend: [
    ohlc(100, 103, 99, 102), ohlc(102, 106, 101.5, 105), ohlc(104.5, 108.5, 104, 108),
    ohlc(107.5, 111.5, 106.8, 111), ohlc(110.5, 115, 110, 114.5), ohlc(114, 118.5, 113.5, 118),
    ohlc(117.5, 122, 117, 121.5), ohlc(121, 125.5, 120.5, 125),
  ],
  downtrend: [
    ohlc(125, 126, 121.5, 122.5), ohlc(122.5, 123.5, 118.5, 119.5), ohlc(119.5, 120.5, 115, 116),
    ohlc(116, 117, 111.5, 112.5), ohlc(112.5, 113.5, 108, 109), ohlc(109, 110, 104.5, 105.5),
    ohlc(105.5, 106.5, 101, 102), ohlc(102, 103, 97.5, 98.5),
  ],
  chop: [
    ohlc(100, 102.5, 98.5, 101), ohlc(101, 103, 99.5, 100), ohlc(100, 102, 97.8, 101.5),
    ohlc(101.5, 103.5, 99.5, 100.2), ohlc(100.2, 102.2, 98, 101.8), ohlc(101.8, 103.8, 99.8, 100.1),
    ohlc(100.1, 102.1, 97.9, 101.6), ohlc(101.6, 103.6, 99.6, 100.4),
  ],
};

function renderRegimeCard(containerId, key, label, blurb) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const raw = REGIMES[key];
  const ha  = calculateHeikinAshi(raw);
  el.innerHTML = `
    <article class="cd-card">
      <div class="cd-card-body">
        <header class="cd-card-head"><h3>${label}</h3><span class="cd-chip">${key === 'chop' ? 'Indecision' : 'Trend'}</span></header>
        <div class="cd-anatomy" style="margin-bottom:12px">
          <div class="cd-anatomy-notes" style="flex-direction:row;gap:24px;flex-wrap:wrap">
            <div>
              <div class="cd-fig-label" style="margin-bottom:6px;font-size:10px;color:var(--text-muted)">RAW CANDLES</div>
              ${candleSVG(raw, { w: 300, h: 130 })}
            </div>
            <div>
              <div class="cd-fig-label" style="margin-bottom:6px;font-size:10px;color:var(--text-muted)">HEIKIN-ASHI</div>
              ${candleSVG(ha, { w: 300, h: 130 })}
            </div>
          </div>
        </div>
        <p class="cd-what">${blurb}</p>
      </div>
    </article>`;
}

// ─── Real DSE stock — same lighter treatment as bollinger-bands.js: one
// genuine chart, no signal being hunted for ─────────────────────────────
const REAL_STOCK_CODE = 'SQURPHARMA';
const REAL_BARS = 60;

async function loadRealExample() {
  const container = document.getElementById('ha-real-example');
  if (!container) return;
  try {
    const res = await fetch(`/historical_prices/json_files/${REAL_STOCK_CODE}.json`);
    if (!res.ok) throw new Error(String(res.status));
    const raw = await res.json();
    const rows = raw
      .filter(r => r.Open > 0 && r.High > 0 && r.Low > 0 && r.Close > 0)
      .sort((a, b) => (a.Date < b.Date ? -1 : a.Date > b.Date ? 1 : 0))
      .slice(-REAL_BARS);
    const ha = calculateHeikinAshi(rows);
    container.innerHTML = `
      <article class="cd-card cd-grid--wide">
        <div class="cd-card-body">
          <header class="cd-card-head"><h3>${REAL_STOCK_CODE}</h3><span class="cd-chip cd-chip--real">Real stock, last ${rows.length} bars</span></header>
          <div class="cd-anatomy" style="margin-bottom:12px">
            <div class="cd-anatomy-notes" style="flex-direction:row;gap:24px;flex-wrap:wrap">
              <div>
                <div class="cd-fig-label" style="margin-bottom:6px;font-size:10px;color:var(--text-muted)">RAW CANDLES</div>
                ${candleSVG(rows, { w: 460, h: 160 })}
              </div>
              <div>
                <div class="cd-fig-label" style="margin-bottom:6px;font-size:10px;color:var(--text-muted)">HEIKIN-ASHI</div>
                ${candleSVG(ha, { w: 460, h: 160 })}
              </div>
            </div>
          </div>
          <p class="cd-what">Same underlying prices, same axis — the right-hand panel is nothing but
          the left one run through the exact formula above. Notice how many raw candles with visible
          opposite wicks turn into HA candles with none: that's the smoothing, not a different
          dataset.</p>
        </div>
      </article>`;
  } catch {
    container.innerHTML = `<div class="cd-callout">Couldn't load real price data for this section
      right now (needs this app's own dev server serving /historical_prices/). The diagrams above
      are unaffected.</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderRegimeCard('ha-uptrend', 'uptrend', 'Strong uptrend',
    'Raw candles here already close near their highs, but several still show a small lower wick. On the Heikin-Ashi side those wicks disappear on most bars and bodies run long and green with little to no lower shadow — the classic "stay in the trade" read.');
  renderRegimeCard('ha-downtrend', 'downtrend', 'Strong downtrend',
    'Mirror image of the uptrend case: HA bodies run long and red with little to no upper shadow. The point isn’t that HA predicts the move — it’s already happening in the raw data — it’s that HA makes the fact that it’s still intact easier to read at a glance.');
  renderRegimeCard('ha-chop', 'chop', 'Choppy / indecisive',
    'Raw candles alternate direction with real bodies each time. HA candles here get small bodies with wicks on both sides — the visual cue traders read as "stand aside," even though the raw data never printed a doji at all.');
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
