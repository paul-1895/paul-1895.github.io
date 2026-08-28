/* ═══════════════════════════════════════════════════════════
   minervini.js  —  Minervini Trend Template study guide
   (minervini.html)

   NOTHING NUMERIC ON THIS PAGE IS TYPED INTO THE MARKUP. Every figure —
   the criteria list, the period scaling, today's pass counts, the
   backtest spreads and the caveats — is fetched from
   /api/minervini/signals, which serves them straight out of
   routes/minervini-engine.js and data/minervini/backtest-summary.json.

   That is deliberate and it is the same rule the Super Model guide
   follows. A hardcoded figure survives the re-run that invalidates it;
   a fetched one cannot. If the numbers here ever look wrong, re-run
   scripts/backtest-minervini.js and they will change here too.

   Falls back to the static backtest summary when the API is not up, so
   the page still renders its evidence section off a plain file server —
   just without today's live pass counts, which need the engine.

   Consumed by: minervini.html
   ═══════════════════════════════════════════════════════════ */
'use strict';

const MA_FAST = '#f57c00';
const MA_MID = '#22d3ee';
const MA_SLOW = '#8b95a8';
const PRICE = '#26a69a';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const f2 = v => (v == null ? '—' : Number(v).toFixed(2));
const n0 = v => (v == null ? '—' : Math.round(v).toLocaleString());
const signed = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}`);

const TF_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

// ─── Shape diagram: what a passing chart looks like ────────────
// Drawn from a generated price path plus real simple moving averages of it,
// so the stacking of the averages is a consequence of the prices rather than
// three lines placed by hand in a flattering order.
function smaSeries(prices, period) {
  const out = new Array(prices.length).fill(null);
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= period) sum -= prices[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function drawShapeDiagram() {
  const host = document.getElementById('mv-shape-fig');
  if (!host) return;

  // A base that declines, bottoms, then trends up — the "stage 2" shape the
  // template is trying to describe. Scaled-down periods (10/30/40) so the
  // relationship is visible in 220 bars instead of needing 200-bar averages.
  const n = 220;
  const prices = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const base = t < 0.35
      ? 100 - 26 * (t / 0.35)
      : 74 + 62 * ((t - 0.35) / 0.65) ** 1.25;
    prices.push(base + Math.sin(i / 6.5) * 2.1 + Math.sin(i / 2.3) * 0.9);
  }
  const fast = smaSeries(prices, 10);
  const mid = smaSeries(prices, 30);
  const slow = smaSeries(prices, 40);

  const w = 560, h = 240, padL = 8, padR = 74, padT = 10, padB = 10;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const all = prices.concat(fast, mid, slow).filter(v => v != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = (hi - lo) || 1;
  const x = i => padL + (plotW * i) / (n - 1);
  const y = v => padT + plotH * (1 - (v - lo) / span);

  const line = (series, color, width, dash) => {
    const pts = series.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${width}"
            stroke-linejoin="round" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''} />`;
  };

  const last = n - 1;
  const label = (v, text, color) => `<text x="${w - padR + 6}" y="${y(v) + 3}"
      class="cd-fig-label" fill="${color}">${esc(text)}</text>`;

  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img"
    class="cd-svg" preserveAspectRatio="xMidYMid meet">
    ${line(prices, PRICE, 1.5)}
    ${line(slow, MA_SLOW, 1.6)}
    ${line(mid, MA_MID, 1.6)}
    ${line(fast, MA_FAST, 1.6)}
    ${label(prices[last], 'price', PRICE)}
    ${label(fast[last], 'fast MA', MA_FAST)}
    ${label(mid[last], 'mid MA', MA_MID)}
    ${label(slow[last], 'slow MA', MA_SLOW)}
  </svg>`;
}

// ─── Data ──────────────────────────────────────────────────────
async function loadData() {
  // The API carries the engine's own criteria list, today's scan and the
  // backtest with its caveats. Preferred whenever the app is running.
  try {
    const res = await fetch('/api/minervini/signals');
    if (res.ok) return { ...(await res.json()), live: true };
  } catch { /* fall through to the static file */ }

  try {
    const res = await fetch('/data/minervini/backtest-summary.json');
    if (res.ok) return { backtest: await res.json(), live: false };
  } catch { /* nothing available */ }

  return null;
}

function renderCriteria(data) {
  const host = document.getElementById('mv-criteria');
  if (!host) return;
  const labels = data && data.criteria;
  if (!labels) {
    host.innerHTML = `<div class="cd-callout">Criteria list comes from the running app
      (<code>/api/minervini/signals</code>). Start the dev server to see it.</div>`;
    return;
  }

  // Plain-language gloss per criterion, keyed by position. The labels come
  // from the engine; only the "why" column is written here.
  const why = [
    'The baseline requirement — price has to be above its own longer-term averages before anything else counts.',
    'The medium-term average above the long-term one says the recent trend is stronger than the older one.',
    'A rising long-term average is the single strictest criterion: it needs sustained strength, not a bounce.',
    'Full stacking. The short average on top means every timescale agrees at once.',
    'Price above the short average keeps the most recent bars in line with the rest.',
    'Distance from the low filters out stocks that have merely stopped falling.',
    'Proximity to the high filters out stocks that ran and then broke down.',
  ];

  const params = data.params || {};
  const rows = labels.map((lbl, i) => {
    let detail = why[i] || '';
    if (i === 5 && params.lowPct != null) detail += ` Here: at least ${params.lowPct}% above it.`;
    if (i === 6 && params.highPct != null) detail += ` Here: within ${params.highPct}% of it.`;
    return `<tr>
      <td class="cd-t-name">${i + 1}</td>
      <td><b>${esc(lbl)}</b></td>
      <td class="cd-t-why">${esc(detail)}</td>
    </tr>`;
  }).join('');

  host.innerHTML = `
    <div class="cd-table-wrap">
      <table class="cd-table">
        <thead><tr><th>#</th><th>Criterion</th><th>What it is filtering for</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${params.minPassed != null ? `<div class="cd-callout" style="margin-top:16px">
      <b>A "pass" means all ${params.minPassed} of ${labels.length} hold at once</b>
      — this app publishes Minervini's own thresholds rather than a fitted variant, because
      training showed the fitted direction flips depending on where the history is split.
      Shipping the fitted version would present one episode as a rule.
    </div>` : ''}`;
}

function renderTimeframes(data) {
  const host = document.getElementById('mv-timeframes');
  if (!host) return;
  const cfg = data && data.timeframeConfig;
  if (!cfg) {
    host.innerHTML = `<div class="cd-callout">Timeframe configuration comes from the running
      app. Start the dev server to see it.</div>`;
    return;
  }
  const rows = Object.entries(cfg).map(([tf, c]) => `
    <tr>
      <td class="cd-t-name">${esc(TF_LABEL[tf] || tf)}</td>
      <td class="cd-num">${c.fast} / ${c.mid} / ${c.slow}</td>
      <td class="cd-num">${c.slope}</td>
      <td class="cd-num">${c.window}</td>
      <td class="cd-num">${c.minBars}</td>
    </tr>`).join('');
  host.innerHTML = `
    <div class="cd-table-wrap">
      <table class="cd-table">
        <thead><tr>
          <th>Bars</th><th>Fast / mid / slow MA</th><th>Slope lookback</th>
          <th>52-week window</th><th>Minimum bars</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderToday(data) {
  const host = document.getElementById('mv-today');
  if (!host) return;
  if (!data || !data.live || !data.counts) {
    host.innerHTML = `<div class="cd-callout">Today's scan needs the running app
      (<code>/api/minervini/signals</code>). The evidence below still loads from the static
      backtest file.</div>`;
    return;
  }

  const c = data.counts;
  const scanned = data.universeScanned;
  const pct = v => (scanned ? ((100 * v) / scanned).toFixed(1) : '—');
  const top = (data.stocks || [])[0];

  let example = '';
  if (top && top.timeframes && top.timeframes.daily) {
    const d = top.timeframes.daily;
    const labels = data.criteria || [];
    const checks = (d.checks || []).map((ok, i) => `
      <tr>
        <td class="cd-t-name">${ok ? '✓' : '✗'}</td>
        <td class="${ok ? '' : 'cd-t-why'}">${esc(labels[i] || `Criterion ${i + 1}`)}</td>
      </tr>`).join('');
    example = `
      <h3 style="font-family:var(--mono);font-size:14px;margin:26px 0 8px">
        Top-ranked passing stock right now — ${esc(top.code)}</h3>
      <div class="cd-metrics">
        <span>Date <b>${esc(d.date)}</b></span>
        <span>Price <b>৳${f2(d.price)}</b></span>
        <span>Fast MA <b>${f2(d.fast)}</b></span>
        <span>Mid MA <b>${f2(d.mid)}</b></span>
        <span>Slow MA <b>${f2(d.slow)}</b></span>
        <span>Above 52w low <b>${f1(d.pctAboveLow)}%</b></span>
        <span>Below 52w high <b>${f1(d.pctBelowHigh)}%</b></span>
        <span>Timeframes passing <b>${top.passCount} of 3</b></span>
      </div>
      <div class="cd-table-wrap" style="margin-top:10px">
        <table class="cd-table">
          <thead><tr><th></th><th>Criterion, evaluated on today's daily bar</th></tr></thead>
          <tbody>${checks}</tbody>
        </table>
      </div>
      <div class="cd-callout" style="margin-top:14px">
        This is whatever the engine ranks first today — not a pick, not a recommendation, and
        not chosen for how it looks. Reload tomorrow and it may be a different stock. The
        <a href="#evidence">evidence section</a> is the part that says whether any of this
        predicts anything.
      </div>`;
  }

  host.innerHTML = `
    <div class="cd-metrics">
      <span>Universe scanned <b>${n0(scanned)}</b></span>
      <span>Pass on daily <b>${n0(c.daily)}</b> (${pct(c.daily)}%)</span>
      <span>Pass on weekly <b>${n0(c.weekly)}</b> (${pct(c.weekly)}%)</span>
      <span>Pass on monthly <b>${n0(c.monthly)}</b> (${pct(c.monthly)}%)</span>
      <span>Pass somewhere <b>${n0(c.any)}</b></span>
      <span>Pass on all three <b>${n0(c.all)}</b></span>
    </div>
    ${example}`;
}

function renderEvidence(data) {
  const host = document.getElementById('mv-evidence');
  if (!host) return;
  const bt = data && data.backtest;
  if (!bt || !bt.timeframes) {
    host.innerHTML = `<div class="cd-callout">Couldn't load the backtest summary. It lives at
      <code>data/minervini/backtest-summary.json</code> — reproduce it with
      <code>node scripts/backtest-minervini.js</code>.</div>`;
    return;
  }

  const rows = Object.entries(bt.timeframes).map(([tf, t]) => {
    const h = t.headline || t.full;
    if (!h) return '';
    const bad = h.spread < 0;
    return `<tr>
      <td class="cd-t-name">${esc(TF_LABEL[tf] || tf)}</td>
      <td class="cd-num">${n0(t.stocks)}</td>
      <td class="cd-num">${n0(h.passObs)}</td>
      <td class="cd-num">${f1(h.passRate)}%</td>
      <td class="cd-num">${signed(h.meanPass)}%</td>
      <td class="cd-num">${signed(h.meanFail)}%</td>
      <td class="cd-num"><b class="${bad ? 'cd-bad' : 'cd-good'}">${signed(h.spread)} pp</b></td>
    </tr>`;
  }).join('');

  const daily = bt.timeframes.daily;
  const es = daily && daily.edgeSummary;
  const periodNote = es ? `
    <div class="cd-callout cd-warn" style="margin-top:18px">
      <b>The average is one episode, not a pattern.</b> Split into two-month periods, the daily
      spread was positive in <b>${es.positive} of ${es.periodsMeasured}</b> of them, ranging from
      <b>${signed(es.min)}</b> to <b>${signed(es.max)}</b>. A single period
      (<b>${esc(es.dominantPeriod)}</b>, at <b>${signed(es.dominantSpread)}</b>) drags the mean from
      <b>${signed(es.meanExcludingDominant)}</b> to <b>${signed(es.mean)}</b> on its own. Drop that
      one window and the result is indistinguishable from nothing.
    </div>` : '';

  const method = bt.method ? `
    <div class="cd-callout" style="margin-top:16px">
      <b>How this was measured.</b> ${esc(bt.method.measures)} ${esc(bt.method.lookahead)}
      ${esc(bt.method.noTradePlan)}
    </div>` : '';

  host.innerHTML = `
    <div class="cd-table-wrap">
      <table class="cd-table">
        <thead><tr>
          <th>Bars</th><th>Stocks</th><th>Passing observations</th><th>Pass rate</th>
          <th>Mean forward return, passing</th><th>…not passing</th><th>Spread</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${periodNote}
    ${method}`;

  const stamp = document.getElementById('mv-generated');
  if (stamp && bt.generatedAt) {
    const d = new Date(bt.generatedAt);
    const dl = bt.timeframes.daily;
    stamp.innerHTML = `Backtest generated <b>${d.toLocaleDateString(undefined,
      { day: 'numeric', month: 'short', year: 'numeric' })}</b>`
      + (dl ? ` over ${esc(dl.dateFrom)} → ${esc(dl.dateTo)}, ${n0(dl.observations)} evaluated bars.` : '.');
  }
}

function renderVerdict(data) {
  const host = document.getElementById('mv-verdict');
  if (!host) return;
  const ev = data && data.evidence;
  if (!ev) {
    host.innerHTML = `<div class="cd-callout">The plain-language verdict is served by the
      running app alongside the backtest.</div>`;
    return;
  }
  const detail = (ev.detail || []).map(d => `<li>${esc(d)}</li>`).join('');
  host.innerHTML = `
    <div class="cd-callout cd-warn">
      <b>${esc(ev.headline)}</b>
    </div>
    <ul class="cd-lead" style="margin-top:16px;padding-left:20px">${detail}</ul>
    ${ev.verdict ? `<div class="cd-callout"><b>Verdict.</b> ${esc(ev.verdict)}</div>` : ''}`;
}

function renderCaveats(data) {
  const host = document.getElementById('mv-caveats');
  if (!host) return;
  const caveats = data && data.backtest && data.backtest.caveats;
  if (!caveats || !caveats.length) {
    host.innerHTML = `<div class="cd-callout">Caveats are served by the running app with the
      backtest, so they cannot drift away from the run that produced them.</div>`;
    return;
  }
  host.innerHTML = `<div class="cd-honest">${
    caveats.map((c, i) => `
      <div class="cd-honest-item">
        <h4>Caveat ${i + 1}</h4>
        <p>${esc(c)}</p>
      </div>`).join('')
  }</div>`;
}

// ─── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  drawShapeDiagram();

  const data = await loadData();
  renderCriteria(data);
  renderTimeframes(data);
  renderToday(data);
  renderEvidence(data);
  renderVerdict(data);
  renderCaveats(data);

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
