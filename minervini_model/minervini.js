'use strict';

import { initTheme, toggleTheme } from '../theme/theme.js';

const API = '';
const TFS = ['daily', 'weekly', 'monthly'];
const TF_SHORT = { daily: 'D', weekly: 'W', monthly: 'M' };

const state = {
  stocks: [], names: {}, sectors: {},
  criteria: [], params: null, counts: null, tfConfig: null,
  evidence: null, universeScanned: 0, asOf: null,
  runs: [], backtest: null,
  // which timeframe the spread-by-period chart and table are showing
  periodTf: 'daily',
};
const filters = { q: '', tf: 'any', sector: '' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, s = '') => (v == null ? '—' : `${v}${s}`);
const signed = (v, s = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${s}`);
const posneg = v => (v == null ? '' : v > 0 ? 'mv-pos' : v < 0 ? 'mv-neg' : '');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ── Filtering ──────────────────────────────────────────────────────────────
function matches(row) {
  if (filters.tf === 'all') { if (row.passCount < TFS.length) return false; }
  else if (filters.tf !== 'any') { const t = row.timeframes[filters.tf]; if (!t || !t.isPass) return false; }
  if (filters.sector && (state.sectors[row.code] || '') !== filters.sector) return false;
  if (filters.q && !`${row.code} ${state.names[row.code] || ''}`.toLowerCase().includes(filters.q)) return false;
  return true;
}

// ── Cards ──────────────────────────────────────────────────────────────────
function cardHtml(row) {
  const d = row.timeframes.daily;
  const badges = TFS.map(tf => {
    const t = row.timeframes[tf];
    const cls = !t ? 'mv-tf--na' : t.isPass ? 'mv-tf--pass' : 'mv-tf--fail';
    const title = !t ? `${tf}: not enough history` : `${tf}: ${t.passed}/${t.total} criteria`;
    return `<span class="mv-tf ${cls}" title="${esc(title)}">${TF_SHORT[tf]}<span class="mv-tf-n">${t ? t.passed : '–'}</span></span>`;
  }).join('');

  return `
    <div class="mv-card" data-code="${esc(row.code)}" tabindex="0" role="button">
      <div class="mv-card-top">
        <div class="mv-card-id">
          <span class="mv-card-code">${esc(row.code)}</span>
          <span class="mv-card-name">${esc(state.names[row.code] || '')}</span>
        </div>
        <div class="mv-tfs">${badges}</div>
      </div>
      <div class="mv-card-sector">${esc(state.sectors[row.code] || '')}</div>
      ${d ? `
        <div class="mv-stat-row">
          <div class="mv-stat"><span class="mv-stat-label">Price</span><span class="mv-stat-value">৳${d.price.toFixed(2)}</span></div>
          <div class="mv-stat"><span class="mv-stat-label">Above 52w low</span><span class="mv-stat-value mv-pos">+${d.pctAboveLow}%</span></div>
          <div class="mv-stat"><span class="mv-stat-label">Below 52w high</span><span class="mv-stat-value">${d.pctBelowHigh}%</span></div>
        </div>` : ''}
      <div class="mv-card-foot">
        <span>${row.passCount} of ${TFS.length} timeframe${row.passCount === 1 ? '' : 's'}</span>
        <span>${d ? d.date : ''}</span>
      </div>
    </div>`;
}

function renderGrid() {
  const list = state.stocks.filter(matches);
  const grid = document.getElementById('mv-grid');
  const empty = document.getElementById('mv-empty');
  grid.innerHTML = list.map(cardHtml).join('');
  empty.style.display = list.length ? 'none' : '';
  document.getElementById('mv-count').textContent =
    list.length === state.stocks.length
      ? `${state.stocks.length} passing the template`
      : `Showing ${list.length} of ${state.stocks.length}`;
  grid.querySelectorAll('.mv-card').forEach(c => {
    const open = () => window.openMvModal(c.dataset.code);
    c.addEventListener('click', open);
    c.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

// ── Evidence (what the backtest did and didn't show) ───────────────────────
function renderEvidence() {
  const e = state.evidence;
  const el = document.getElementById('mv-evidence');
  if (!e) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="mv-ev-head">
      <span class="mv-ev-flag">Backtest result</span>
      <strong>${esc(e.headline)}</strong>
    </div>
    <ul class="mv-ev-list">${(e.detail || []).map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    <p class="mv-ev-verdict">${esc(e.verdict)}</p>`;
}

function renderMeta() {
  const c = state.counts || {};
  const asOf = state.asOf ? new Date(state.asOf).toLocaleString() : '—';
  document.getElementById('mv-meta-row').textContent =
    `Scanned ${state.universeScanned} stocks · passing now: ${c.daily || 0} daily, ${c.weekly || 0} weekly, ` +
    `${c.monthly || 0} monthly · ${c.all || 0} on all three · generated ${asOf}`;
}

// ── Backtest pane ──────────────────────────────────────────────────────────
// A 4th element makes a cell open the detail panel explaining the number.
function statBlock(items) {
  return `<div class="mv-statgrid">${items.map(([label, value, cls, metric]) => {
    const on = metric ? ` class="mv-statcell mv-statcell--clickable" data-metric="${metric}" tabindex="0" role="button"`
                      : ' class="mv-statcell"';
    return `<div${on}><span class="mv-statlabel">${label}</span><span class="mv-statnum ${cls || ''}">${value}</span></div>`;
  }).join('')}</div>`;
}

const tf = name => (state.backtest && state.backtest.timeframes) ? state.backtest.timeframes[name] : null;

function periodChart(name) {
  const t = tf(name);
  if (!t) return '';
  const bars = (t.edgeByPeriod || []).filter(p => p.representative && p.spread != null);
  if (!bars.length) return '';
  const maxAbs = Math.max(1, ...bars.map(p => Math.abs(p.spread)));
  const s = t.edgeSummary;
  return `
    <p class="mv-note">Each bar is one two-month stretch: how much passing stocks beat the rest over the
      following ${t.horizon} bars.
      ${s ? `Positive in <strong>${s.positive} of ${s.periodsMeasured}</strong> periods — median ${signed(s.median)},
        ranging ${signed(s.min)} to ${signed(s.max)}.` : ''}</p>
    <div class="mv-periods">${bars.map(p => `
      <div class="mv-period" title="${esc(p.period)}: ${signed(p.spread)} (${p.passObs} passing bars from ${p.passStocks} stocks)">
        <div class="mv-period-track">
          <div class="mv-period-bar ${p.spread > 0 ? 'mv-period-bar--pos' : 'mv-period-bar--neg'}"
               style="height:${Math.max(3, (Math.abs(p.spread) / maxAbs) * 50)}%"></div>
        </div>
        <span class="mv-period-val ${posneg(p.spread)}">${signed(p.spread)}</span>
        <span class="mv-period-lbl">${esc(p.period.replace('20', ''))}</span>
      </div>`).join('')}</div>
    ${s && s.meanExcludingDominant != null ? `
      <p class="mv-note mv-note-muted">The average across these periods is ${signed(s.mean)}. Excluding
        ${esc(s.dominantPeriod)} alone — the single largest period, at ${signed(s.dominantSpread)} — it is
        ${signed(s.meanExcludingDominant)}. A result that moves that far when one period is dropped is an
        episode, not a property of the rule.</p>` : ''}`;
}

function periodTable(name) {
  const t = tf(name);
  if (!t) return '';
  // Periods before the archive covers a real cross-section are dropped rather
  // than listed: there are dozens of them, each holding one or two stocks, and
  // a table of two-stock "periods" reads as evidence when it is the opposite.
  // The count of what was dropped is printed instead.
  const minStocks = (state.backtest && state.backtest.minPeriodStocks) || 50;
  const all = t.edgeByPeriod || [];
  const shown = all.filter(p => p.stocks >= minStocks);
  const hidden = all.length - shown.length;
  const rows = shown.map(p => `
    <tr class="mv-row-clickable ${p.representative ? '' : 'mv-row-thin'}" data-metric="per:${name}:${p.period}" tabindex="0" role="button">
      <td class="mv-mono">${esc(p.period)}${p.representative ? '' : ' <span class="mv-warn">thin</span>'}</td>
      <td class="mv-mono">${num(p.passObs)}</td>
      <td class="mv-mono">${num(p.passStocks)}</td>
      <td class="mv-mono">${num(p.meanPass, '%')}</td>
      <td class="mv-mono">${num(p.meanFail, '%')}</td>
      <td class="mv-mono ${posneg(p.spread)}">${signed(p.spread)}</td>
      <td class="mv-mono ${posneg(p.superModelRankEdge)}">${signed(p.superModelRankEdge)}</td>
    </tr>`).join('');
  return `
    <div class="mv-tablewrap"><table class="mv-table">
      <thead><tr><th>Period</th><th>Passing bars</th><th>Stocks</th><th>When passing</th><th>When not</th>
        <th>Gap</th><th>Super Model</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="mv-note mv-note-muted">A period marked <span class="mv-warn">thin</span> had too few stocks, or too few
      of them passing, to measure anything, and is excluded from every count above.
      ${hidden ? `A further <strong>${hidden}</strong> earlier periods are not listed at all — before
        ${esc(t.universeStart)} the archive holds only ${num(t.coverage.preUniverseStocks)} stocks, so those
        periods describe individual names rather than the market.` : ''}
      The last column is the Super Model's ranking edge over the same two months — it is shown because the two are
      not independent: that model scores a Minervini pass negatively, so a period where passing stocks slumped is by
      construction one where it ranks well.</p>`;
}

function renderBacktestPane() {
  const el = document.getElementById('mv-pane-backtest');
  const b = state.backtest;
  const d = tf('daily');
  if (!b || !d) {
    el.innerHTML = `<p class="mv-note">No backtest summary available. Generate it with
      <code>node scripts/backtest-minervini.js</code>.</p>`;
    return;
  }

  const blocks = TFS.map(name => {
    const t = tf(name);
    if (!t) return '';
    const s = t.edgeSummary;
    return `<div><h4>${cap(name)} <span class="mv-sub">${t.horizon}-bar horizon</span>
      ${name === 'monthly' ? '<span class="mv-warn">indicative</span>' : ''}</h4>${statBlock([
      ['Pass rate', num(t.headline.passRate, '%'), '', `bt:${name}:passRate`],
      ['When passing', num(t.headline.meanPass, '%'), posneg(t.headline.meanPass), `bt:${name}:meanPass`],
      ['When not', num(t.headline.meanFail, '%'), posneg(t.headline.meanFail), `bt:${name}:meanFail`],
      ['Positive periods', s ? `${s.positive}/${s.periodsMeasured}` : '—', '', `bt:${name}:periods`],
    ])}</div>`;
  }).join('');

  const seg = TFS.map(name => `<button type="button" class="mv-seg-btn ${name === state.periodTf ? 'active' : ''}"
      data-ptf="${name}">${cap(name)}</button>`).join('');

  el.innerHTML = `
    <p class="mv-note">The Trend Template is a state, not a trade — there is no entry, stoploss or target to hit.
      So what is measured is the <strong>gap</strong>: the average forward return of bars that pass the template,
      minus the average of bars that do not, in percentage points. A positive gap means passing stocks went on to
      do better. Measured on ${num(d.stocks)} stocks over ${d.observations.toLocaleString()} evaluable daily bars.</p>
    <p class="mv-hint">Tap any figure below for what it measures and how it was calculated.</p>
    ${statBlock([
      ['Daily gap', signed(tf('daily') && tf('daily').headline.spread), posneg(tf('daily') && tf('daily').headline.spread), 'bt:daily:spread'],
      ['Weekly gap', signed(tf('weekly') && tf('weekly').headline.spread), posneg(tf('weekly') && tf('weekly').headline.spread), 'bt:weekly:spread'],
      ['Monthly gap', signed(tf('monthly') && tf('monthly').headline.spread), posneg(tf('monthly') && tf('monthly').headline.spread), 'bt:monthly:spread'],
      ['Stocks tested', num(d.stocks), '', 'bt:daily:stocks'],
      ['Measured from', esc(d.universeStart), '', 'bt:daily:coverage'],
    ])}
    <div class="mv-split">${blocks}</div>
    <h4>Gap by period
      <span class="mv-seg mv-seg--inline" id="mv-period-tf">${seg}</span></h4>
    <div id="mv-period-body">${periodChart(state.periodTf)}${periodTable(state.periodTf)}</div>
    <h4>Limitations</h4>
    <ul class="mv-caveats">${(b.caveats || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;

  el.querySelector('#mv-period-tf').addEventListener('click', e => {
    const btn = e.target.closest('.mv-seg-btn');
    if (!btn) return;
    state.periodTf = btn.dataset.ptf;
    btn.parentElement.querySelectorAll('.mv-seg-btn').forEach(x => x.classList.toggle('active', x === btn));
    document.getElementById('mv-period-body').innerHTML =
      periodChart(state.periodTf) + periodTable(state.periodTf);
  });
}

// ── "What's tested" pane ───────────────────────────────────────────────────
function renderRulePane() {
  const el = document.getElementById('mv-pane-rule');
  const p = state.params;
  const crit = state.criteria.map((c, i) =>
    `<li><span class="mv-critnum">${i + 1}</span><span>${esc(c)}</span></li>`).join('');

  const rows = TFS.map(name => {
    const cfg = state.tfConfig && state.tfConfig[name];
    const t = tf(name);
    if (!cfg) return '';
    return `<tr class="${t ? 'mv-row-clickable' : ''}" ${t ? `data-metric="bt:${name}:spread" tabindex="0" role="button"` : ''}>
      <td class="mv-mono">${cap(name)}</td>
      <td class="mv-mono">${cfg.fast} / ${cfg.mid} / ${cfg.slow}</td>
      <td class="mv-mono">${cfg.slope}</td>
      <td class="mv-mono">${cfg.window}</td>
      <td class="mv-mono">${cfg.horizons[0]}</td>
      <td class="mv-mono ${t ? posneg(t.headline.spread) : ''}">${t ? signed(t.headline.spread) : '—'}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <p class="mv-note">Mark Minervini's Trend Template: seven conditions that together describe a stock already in a
      confirmed uptrend. A stock passes only when all seven hold at once${p ? `, using ${p.lowPct}% above the
      52-week low and ${p.highPct}% below the high` : ''} — the textbook values, not the ones the grid search
      preferred.</p>
    <h4>The seven criteria</h4>
    <ul class="mv-critlist">${crit}</ul>
    <h4>Scaled to each timeframe</h4>
    <p class="mv-note">The template is defined in trading days. Applying it to weekly and monthly bars needs
      calendar-equivalent periods, so the averages are rescaled rather than reused.</p>
    <div class="mv-tablewrap"><table class="mv-table">
      <thead><tr><th>Timeframe</th><th>Averages</th><th>Slope lookback</th><th>52-week window</th>
        <th>Forward horizon</th><th>Gap</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="mv-note mv-note-muted">All periods are in bars of that timeframe. Monthly is the compromise: a true
      200-day average needs about ten months of bars, and only 4 of 391 stocks in this archive carry enough monthly
      history for a full-length template.</p>`;
}

// ── Training history ───────────────────────────────────────────────────────
function renderRuns() {
  const el = document.getElementById('mv-pane-runs');
  const intro = `
    <p class="mv-note">Training here is a grid search, not gradient descent — the template is a rule, so the open
      parts (how many criteria must hold, the distances from the 52-week low and high, and the direction of the
      signal) are fitted on a training period, then frozen and scored once on a period the search never saw.</p>
    <p class="mv-note">Every run records the exact composition of both datasets. Press <strong>Dataset</strong> on
      any row for its observation counts, stock counts and date ranges per timeframe. The raw records are on disk at
      <code>data/minervini/runs/&lt;runId&gt;.json</code> and served from
      <code>/api/minervini/runs/&lt;runId&gt;</code>; regenerate with <code>node scripts/train-minervini.js</code>.</p>`;
  if (!state.runs.length) {
    el.innerHTML = `${intro}<p class="mv-note mv-note-muted">No training runs recorded yet.</p>`;
    return;
  }
  const rows = state.runs.map(r => {
    const cells = TFS.map(tf => {
      const t = r.timeframes && r.timeframes[tf];
      if (!t) return '<td class="mv-mono">—</td>';
      const dir = t.direction > 0 ? 'pass = bullish' : 'pass = bearish';
      const held = t.directionHeld ? 'held' : 'flipped';
      return `<td class="mv-mono ${t.directionHeld ? '' : 'mv-neg'}">${dir}<br><span class="mv-sub">test ${t.testSpread > 0 ? '+' : ''}${t.testSpread} · ${held}</span></td>`;
    }).join('');
    const tf0 = r.timeframes && r.timeframes.daily;
    return `<tr>
      <td class="mv-mono">${esc(r.split)}</td>
      <td class="mv-mono">${tf0 ? `${tf0.trainObs.toLocaleString()} / ${tf0.testObs.toLocaleString()}` : '—'}</td>
      ${cells}
      <td><button class="mv-run-btn" data-run="${esc(r.runId)}">Dataset</button></td>
    </tr>`;
  }).join('');

  el.innerHTML = `${intro}
    <div class="mv-tablewrap"><table class="mv-table">
      <thead><tr><th>Split</th><th>Daily obs (train/test)</th><th>Daily</th><th>Weekly</th><th>Monthly</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="mv-note mv-note-muted">Direction is fitted on the training period, then checked once on the held-out
      period. "Flipped" means the relationship reversed out-of-sample — the reason the model is not published with a
      fitted direction.</p>`;

  el.querySelectorAll('.mv-run-btn').forEach(b =>
    b.addEventListener('click', () => window.openMvRun(b.dataset.run)));
}

// ── Metric detail ──────────────────────────────────────────────────────────
/** Rows shared by every per-timeframe detail panel. */
function tfRows(t) {
  const s = t.edgeSummary || {};
  return [
    ['Evaluable bars', t.observations.toLocaleString()],
    ['Bars passing the template', t.headline.passObs.toLocaleString()],
    ['Pass rate', num(t.headline.passRate, '%')],
    ['Return when passing', num(t.headline.meanPass, '%'), posneg(t.headline.meanPass)],
    ['Return when not passing', num(t.headline.meanFail, '%'), posneg(t.headline.meanFail)],
    ['Gap', signed(t.headline.spread), posneg(t.headline.spread)],
    ['Rose over the horizon, passing', num(t.headline.hitRatePass, '%')],
    ['Rose over the horizon, all bars', num(t.headline.hitRateAll, '%')],
    [`Gap over ${t.longHorizon.horizon} bars`, signed(t.longHorizon.spread), posneg(t.longHorizon.spread)],
    ['Periods positive', s.periodsMeasured ? `${s.positive} of ${s.periodsMeasured}` : '—'],
    ['Median period gap', signed(s.median), posneg(s.median)],
    ['Best / worst period', s.max != null ? `${signed(s.max)} / ${signed(s.min)}` : '—'],
    ['Average, excluding the largest period', signed(s.meanExcludingDominant), posneg(s.meanExcludingDominant)],
  ];
}

const EPISODE_NOTE = 'Read the period-by-period distribution rather than this single number. Observations overlap — consecutive bars share almost all of their forward window — so a five-figure observation count represents far fewer independent episodes than it appears to.';

/** Returns { title, value, cls, sub, what, how, rows, notes } or null. */
function metricDetail(key) {
  const b = state.backtest;
  if (!b) return null;
  const [kind, name, field] = key.split(':');
  const t = tf(name);
  if (!t) return null;

  if (kind === 'per') {
    // field is the period label itself ("2026/01-02"), not an index: the
    // table is filtered before rendering, so positions would not survive a
    // timeframe switch.
    const p = (t.edgeByPeriod || []).find(x => x.period === field);
    if (!p) return null;
    return {
      title: `${cap(name)} · ${p.period}`, value: signed(p.spread), cls: posneg(p.spread),
      sub: `gap over the following ${t.horizon} bars`,
      what: `In this two-month stretch, ${p.passObs} bars across ${p.passStocks} stocks passed the template. They went on to return ${num(p.meanPass, '%')} on average against ${num(p.meanFail, '%')} for bars that did not pass.`,
      how: p.representative
        ? 'Periods are fixed two-month buckets, chosen before looking at the results. Splitting this way is the guard against a single stretch of history carrying an average — which is exactly what happened here.'
        : `This period is marked thin: it covers ${p.stocks} stocks with only ${p.passStocks} of them passing, which is too few to measure a market-wide effect. It is shown for completeness and excluded from every average.`,
      rows: [
        ['Stocks with data', num(p.stocks)],
        ['Stocks passing', num(p.passStocks)],
        ['Bars evaluated', p.observations.toLocaleString()],
        ['Bars passing', num(p.passObs)],
        ['Return when passing', num(p.meanPass, '%'), posneg(p.meanPass)],
        ['Return when not passing', num(p.meanFail, '%'), posneg(p.meanFail)],
        ['All bars', num(p.baseline, '%'), posneg(p.baseline)],
        ['Gap', signed(p.spread), posneg(p.spread)],
        ['Super Model ranking edge', signed(p.superModelRankEdge), posneg(p.superModelRankEdge)],
      ],
      notes: p.superModelRankEdge != null
        ? ['The Super Model figure is not an independent confirmation. That model scores a Minervini pass negatively, so the two move together by construction.']
        : [],
    };
  }

  if (kind !== 'bt') return null;
  const base = { rows: tfRows(t), notes: [] };
  const scope = `${name} bars`;

  if (field === 'spread') return { ...base,
    title: `${cap(name)} gap`, value: signed(t.headline.spread), cls: posneg(t.headline.spread),
    sub: `percentage points, over the following ${t.horizon} ${name === 'daily' ? 'trading days' : 'bars'}`,
    what: `The average forward return of ${scope} that pass the template, minus the average of those that do not. Passing bars returned ${num(t.headline.meanPass, '%')}; the rest returned ${num(t.headline.meanFail, '%')}.`,
    how: 'A positive gap would mean passing stocks went on to do better, which is the textbook claim. The sign here is what the backtest was built to settle, and it is not stable: see the period breakdown below.',
    notes: [EPISODE_NOTE] };

  if (field === 'passRate') return { ...base,
    title: `${cap(name)} pass rate`, value: num(t.headline.passRate, '%'),
    sub: `of evaluable ${scope} passed all seven criteria`,
    what: `How often the template is satisfied at all. ${num(t.headline.passObs)} of ${t.coverage.observationsSinceUniverse.toLocaleString()} evaluable bars passed.`,
    how: 'A bar counts as evaluable only when all seven criteria can be decided — early bars, before the slow moving average and 52-week window exist, are refused rather than partially scored, which would bias this rate upward.',
    notes: [] };

  if (field === 'meanPass') return { ...base,
    title: `${cap(name)} return when passing`, value: num(t.headline.meanPass, '%'), cls: posneg(t.headline.meanPass),
    sub: `average over the following ${t.horizon} bars`,
    what: `What a stock did, on average, over the ${t.horizon} bars after passing the template.`,
    how: `On its own this number says little — the whole market returned ${num(t.headline.baseline, '%')} over the same horizon. The comparison against non-passing bars (${num(t.headline.meanFail, '%')}) is what carries information.`,
    notes: [] };

  if (field === 'meanFail') return { ...base,
    title: `${cap(name)} return when not passing`, value: num(t.headline.meanFail, '%'), cls: posneg(t.headline.meanFail),
    sub: `average over the following ${t.horizon} bars`,
    what: `The comparison group: every evaluable bar that failed at least one of the seven criteria.`,
    how: 'This is not a bearish set. It is most of the market most of the time, which is why it tracks the overall baseline closely.',
    notes: [] };

  if (field === 'periods') {
    const s = t.edgeSummary;
    if (!s) return null;
    return { ...base,
      title: `${cap(name)} — periods positive`, value: `${s.positive} of ${s.periodsMeasured}`,
      sub: 'two-month stretches where passing stocks did better',
      what: `The gap measured separately in each two-month period, rather than pooled. It ranges from ${signed(s.min)} to ${signed(s.max)}, with a median of ${signed(s.median)}.`,
      how: `The average across periods is ${signed(s.mean)}. Excluding ${s.dominantPeriod} alone — the single largest — it becomes ${signed(s.meanExcludingDominant)}. A rule whose average does not survive dropping one period out of ${s.periodsMeasured} is describing that period.`,
      notes: ['A rule with a real edge would be positive in most periods, not carried by one.'] };
  }

  if (field === 'stocks') return { ...base,
    title: 'Stocks tested', value: num(t.stocks),
    sub: `of ${num(t.stocks + t.stocksSkipped)} in the archive`,
    what: `Every stock with enough price history to evaluate the template on ${name} bars. ${num(t.stocksSkipped)} were skipped for insufficient history.`,
    how: `Daily needs ${state.tfConfig && state.tfConfig.daily ? state.tfConfig.daily.minBars : 221} bars before the first criterion can be decided, because of the 200-day average and the 52-week range.`,
    notes: [] };

  if (field === 'coverage') {
    const c = t.coverage;
    const years = Object.entries(c.obsByYear).sort();
    return { ...base,
      title: 'Measured from', value: c.universeStart,
      sub: 'the first period covering a real cross-section of the market',
      what: `The archive nominally reaches back to ${t.dateFrom}, but before ${c.universeStart} it holds only ${num(c.preUniverseStocks)} stocks. Those ${c.preUniverseObs.toLocaleString()} early bars are excluded from every headline figure.`,
      how: 'The cutoff is the first two-month period containing at least 50 stocks — chosen on data availability alone, before any result was computed.',
      rows: [
        ['Archive begins', t.dateFrom],
        ['Archive ends', t.dateTo],
        ['Usable from', c.universeStart],
        ['Bars before that', c.preUniverseObs.toLocaleString()],
        ['Stocks before that', num(c.preUniverseStocks)],
        ['Bars in the headline sample', c.observationsSinceUniverse.toLocaleString()],
        ...years.map(([y, n]) => [`Bars dated ${y}`, n.toLocaleString()]),
      ],
      notes: ['This makes it roughly a 14-month test, not a decade-long one.'] };
  }
  return null;
}

window.openMvInfo = function (key) {
  const d = metricDetail(key);
  if (!d) return;
  document.getElementById('mv-info-title').textContent = d.title;
  document.getElementById('mv-info-body').innerHTML = `
    <div class="mv-info-value ${d.cls || ''}">${d.value}</div>
    ${d.sub ? `<div class="mv-info-sub">${d.sub}</div>` : ''}
    ${d.what ? `<div class="an-section"><div class="an-h3">What it measures</div><p class="an-note">${d.what}</p></div>` : ''}
    ${d.how ? `<div class="an-section"><div class="an-h3">How to read it</div><p class="an-note">${d.how}</p></div>` : ''}
    ${d.rows && d.rows.length ? `<div class="an-section"><div class="an-h3">Full breakdown</div>
      <ul class="mv-info-rows">${d.rows.map(([k, v, c]) =>
        `<li><span class="mv-info-k">${k}</span><span class="mv-info-v ${c || ''}">${v}</span></li>`).join('')}</ul></div>` : ''}
    ${(d.notes || []).map(n => `<p class="an-note an-note-muted">${n}</p>`).join('')}`;
  document.getElementById('mv-info-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeMvInfo = function () {
  document.getElementById('mv-info-modal').style.display = 'none';
  document.body.style.overflow = '';
};

// One delegated listener for every clickable metric, so the panes can
// re-render freely (the period chart does, on every timeframe switch)
// without rebinding.
function wirePanelDetails() {
  const panel = document.getElementById('mv-panel');
  const open = el => { const k = el && el.dataset.metric; if (k) window.openMvInfo(k); };
  panel.addEventListener('click', e => open(e.target.closest('[data-metric]')));
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-metric]');
    if (!el) return;
    e.preventDefault();
    open(el);
  });
}

window.mvShowPane = function (btn) {
  document.querySelectorAll('.mv-tab').forEach(b => b.classList.toggle('active', b === btn));
  const target = btn.dataset.pane;
  document.querySelectorAll('.mv-pane').forEach(p => p.classList.toggle('active', p.id === `mv-pane-${target}`));
};

// ── Modals ─────────────────────────────────────────────────────────────────
function openPanel(title, body) {
  document.getElementById('mv-modal-title').textContent = title;
  document.getElementById('mv-modal-body').innerHTML = body;
  document.getElementById('mv-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

window.closeMvModal = function () {
  document.getElementById('mv-modal').style.display = 'none';
  document.body.style.overflow = '';
};

window.openMvModal = function (code) {
  const row = state.stocks.find(s => s.code === code);
  if (!row) return;
  const sections = TFS.map(tf => {
    const t = row.timeframes[tf];
    const cfg = state.tfConfig && state.tfConfig[tf];
    if (!t) return `<div class="an-section"><div class="an-h3">${tf}</div>
      <p class="an-note an-note-muted">Not enough price history to evaluate this timeframe.</p></div>`;
    const list = state.criteria.map((label, i) => `
      <li class="an-signal-row">
        <span class="an-dot ${t.checks[i] ? 'an-dot-bull' : 'an-dot-bear'}"></span>
        <div class="an-signal-text">
          <span class="an-signal-label">${esc(label)}</span>
          <span class="an-signal-detail">${t.checks[i] ? 'passes' : 'fails'}</span>
        </div>
      </li>`).join('');
    return `
      <div class="an-section">
        <div class="an-h3">${tf} <span class="an-h3-badge">${t.passed}/${t.total}</span>
          ${t.isPass ? '<span class="mv-tf mv-tf--pass">PASS</span>' : ''}</div>
        <p class="an-note an-note-muted">Averages ${cfg ? `${cfg.fast}/${cfg.mid}/${cfg.slow}` : ''} bars ·
          last bar ${esc(t.date)} · price ৳${t.price.toFixed(2)} ·
          ${t.pctAboveLow}% above the 52-week low, ${t.pctBelowHigh}% below the high</p>
        <ul class="an-signal-list">${list}</ul>
      </div>`;
  }).join('');

  openPanel(`${code} — ${state.names[code] || ''}`, `
    <p class="an-note">Minervini Trend Template, ${state.params ? `${state.params.minPassed}/7 criteria, at least
      ${state.params.lowPct}% above the 52-week low and within ${state.params.highPct}% of the high` : ''}.</p>
    ${sections}
    <p class="an-note an-note-muted">${esc(state.evidence ? state.evidence.verdict : '')}</p>`);
};

window.openMvRun = async function (runId) {
  openPanel('Loading…', '<p class="an-note">Fetching run…</p>');
  try {
    const res = await fetch(`${API}/api/minervini/runs/${encodeURIComponent(runId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const r = await res.json();
    const blocks = TFS.map(tf => {
      const x = r.results && r.results[tf];
      if (!x) return '';
      const d = x.dataset;
      return `
        <div class="an-section">
          <div class="an-h3">${tf}</div>
          <ul class="mv-kv">
            <li><span>Training set</span><span class="mv-mono">${d.train.observations.toLocaleString()} bars · ${d.train.stocks} stocks · ${esc(d.train.dateFrom)} → ${esc(d.train.dateTo)}</span></li>
            <li><span>Testing set</span><span class="mv-mono">${d.test.observations.toLocaleString()} bars · ${d.test.stocks} stocks · ${esc(d.test.dateFrom)} → ${esc(d.test.dateTo)}</span></li>
            <li><span>Stocks skipped</span><span class="mv-mono">${d.stocksSkipped} (insufficient history)</span></li>
            <li><span>Fitted parameters</span><span class="mv-mono">${x.params.minPassed}/7 · ≥${x.params.lowPct}% off low · ≤${x.params.highPct}% off high</span></li>
            <li><span>Fitted direction</span><span class="mv-mono">${x.params.direction > 0 ? 'pass = bullish' : 'pass = bearish'}</span></li>
            <li><span>Train spread</span><span class="mv-mono">${x.train.spread}</span></li>
            <li><span>Test spread</span><span class="mv-mono ${x.directionHeld ? '' : 'mv-neg'}">${x.test.spread} (${x.directionHeld ? 'direction held' : 'direction flipped'})</span></li>
            <li><span>Textbook 7/7 + 25/25</span><span class="mv-mono">${x.testTextbook.spread} on ${x.testTextbook.passCount.toLocaleString()} passes</span></li>
            <li><span>Grid points searched</span><span class="mv-mono">${x.gridSize}</span></li>
          </ul>
        </div>`;
    }).join('');
    openPanel(`Run ${r.split}`, `
      <p class="an-note">${esc(r.method.training)}</p>
      <p class="an-note an-note-muted">${esc(r.method.lookahead)}</p>
      ${blocks}
      <p class="an-note an-note-muted">${esc(r.method.monthlyCaveat)}</p>`);
  } catch (err) {
    openPanel('Run unavailable', `<p class="an-note">Could not load this run: ${esc(err.message)}</p>`);
  }
};

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  window.closeMvModal();
  window.closeMvInfo();
});

// ── Filters wiring ─────────────────────────────────────────────────────────
function applyFilters() {
  filters.q = document.getElementById('mv-search').value.trim().toLowerCase();
  filters.sector = document.getElementById('mv-sector').value;
  const seg = document.querySelector('#mv-filter-tf .mv-seg-btn.active');
  filters.tf = seg ? seg.dataset.tf : 'any';
  renderGrid();
}

function wire() {
  document.getElementById('mv-search').addEventListener('input', applyFilters);
  document.getElementById('mv-sector').addEventListener('change', applyFilters);
  document.getElementById('mv-filter-tf').addEventListener('click', e => {
    const b = e.target.closest('.mv-seg-btn');
    if (!b) return;
    b.parentElement.querySelectorAll('.mv-seg-btn').forEach(x => x.classList.toggle('active', x === b));
    applyFilters();
  });
  document.getElementById('mv-clear').addEventListener('click', () => {
    document.getElementById('mv-search').value = '';
    document.getElementById('mv-sector').value = '';
    document.querySelectorAll('#mv-filter-tf .mv-seg-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    applyFilters();
  });
}

function populateSectors() {
  const counts = {};
  state.stocks.forEach(s => { const v = state.sectors[s.code]; if (v) counts[v] = (counts[v] || 0) + 1; });
  const sel = document.getElementById('mv-sector');
  Object.keys(counts).sort().forEach(sec => {
    const o = document.createElement('option');
    o.value = sec; o.textContent = `${sec} (${counts[sec]})`;
    sel.appendChild(o);
  });
}

// ── Load ───────────────────────────────────────────────────────────────────
async function load() {
  const [sigRes, namesRes, secRes, runsRes] = await Promise.all([
    fetch(`${API}/api/minervini/signals`),
    fetch(`${API}/api/company-names`).catch(() => null),
    fetch(`${API}/api/sectors`).catch(() => null),
    fetch(`${API}/api/minervini/runs`).catch(() => null),
  ]);

  const sig = await sigRes.json();
  Object.assign(state, {
    stocks: sig.stocks || [], criteria: sig.criteria || [], params: sig.params,
    counts: sig.counts, tfConfig: sig.timeframeConfig, evidence: sig.evidence,
    universeScanned: sig.universeScanned, asOf: sig.asOf, backtest: sig.backtest,
  });
  if (namesRes && namesRes.ok) state.names = (await namesRes.json()).names || {};
  if (secRes && secRes.ok) state.sectors = await secRes.json();
  if (runsRes && runsRes.ok) state.runs = (await runsRes.json()).runs || [];

  renderEvidence();
  renderBacktestPane();
  renderRuns();
  renderRulePane();
  wirePanelDetails();
  renderMeta();
  populateSectors();
  wire();
  renderGrid();
}

initTheme();
document.getElementById('theme-toggle-btn').addEventListener('click', () => toggleTheme());
load().catch(err => {
  console.error('[minervini] load failed:', err);
  document.getElementById('mv-meta-row').textContent = 'Failed to load — is the server running?';
});
