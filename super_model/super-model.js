'use strict';

import { initTheme, toggleTheme } from '../theme/theme.js';

const API = '';

const state = {
  buy: [], sell: [], names: {}, sectors: {}, categories: {},
  asOf: null, dataAsOfDate: null, universeScanned: 0, threshold: 25,
  backtest: null, backtest2y: null, backtestCapped: null, backtestCappedPct: null, backtestExplorer: null,
  tracking: null, weights: null,
};

// Read fresh off the controls on every apply — the DOM is the source of
// truth. state.buy/state.sell stay unfiltered and are never reassigned,
// so the card→modal lookup by code keeps working on a filtered view.
const filters = { q: '', category: '', sector: '', signal: '', strength: 'all' };

const filtersActive = () =>
  !!(filters.q || filters.category || filters.sector || filters.signal || filters.strength !== 'all');

function matchesFilters(item) {
  if (filters.strength === 'strong' && !item.label.startsWith('Strong')) return false;
  if (filters.category) {
    const cat = state.categories[item.code] || '';
    if (filters.category === 'none' ? cat !== '' : cat !== filters.category) return false;
  }
  if (filters.sector && (state.sectors[item.code] || '') !== filters.sector) return false;
  // Matches a signal that was detected, whether or not it scored.
  if (filters.signal && !item.signals.some(s => s.key === filters.signal)) return false;
  if (filters.q && !`${item.code} ${state.names[item.code] || ''}`.toLowerCase().includes(filters.q)) return false;
  return true;
}

const filteredList = direction => state[direction].filter(matchesFilters);

function fmtMoney(v) {
  return v == null ? '—' : `৳${v.toFixed(2)}`;
}

function signalLabel(key) {
  return {
    macd: 'MACD Crossover',
    'hilega-milega': 'Hilega-Milega',
    'liquidity-sweep': 'Liquidity Sweep',
    minervini: 'Minervini Trend Template',
    sma50: '50-day SMA',
    supertrend: 'Supertrend Strategy',
    'sr-proximity': 'Support/Resistance',
    seasonality: 'Seasonality',
    valuation: 'DDM Valuation',
    'heikin-ashi': 'Heikin-Ashi Conviction',
    'breakout-retest': 'Breakout & Retest',
    rsi: 'RSI(14) Overbought/Oversold',
    marubozu: 'Marubozu',
    'pin-bar': 'Hammer / Shooting Star',
    'doji-reversal': 'Dragonfly / Gravestone Doji',
    harami: 'Harami',
    'volume-surge': 'Volume Surge',
    'order-block': 'Order Block Retest',
    'ema-ribbon': 'EMA Ribbon (13/21/34/55)',
  }[key] || key;
}

function rowHtml(item) {
  const strong = item.label.startsWith('Strong');
  const badgeMod = item.direction === 'buy' ? (strong ? 'sm-badge--strong-buy' : 'sm-badge--buy')
                                             : (strong ? 'sm-badge--strong-sell' : 'sm-badge--sell');
  const name = state.names[item.code] || '';
  const sector = state.sectors[item.code] || '';
  return `
    <tr class="sm-row sm-row--${item.direction}" data-code="${item.code}" data-direction="${item.direction}" tabindex="0" role="button">
      <td class="sm-cell-id">
        <span class="sm-row-code">${item.code}</span>
        ${name ? `<span class="sm-row-name">${name}</span>` : ''}
        ${navRatioBadge(item)}
      </td>
      <td class="sm-cell-sector">${sector || '—'}</td>
      <td><span class="sm-badge ${badgeMod}">${item.label}</span></td>
      <td class="sm-cell-num">${fmtMoney(item.entry)}</td>
      <td class="sm-cell-num sm-neg">${fmtMoney(item.stoploss)}</td>
      <td class="sm-cell-num sm-pos">${fmtMoney(item.target)}</td>
      <td class="sm-cell-num">${item.riskReward != null ? `1:${item.riskReward}` : '—'}</td>
      <td class="sm-cell-num">${item.signals.length}</td>
    </tr>`;
}

// ─── Fund premium/discount flag ──────────────────────────────────────────────
// Closed-end funds carry `navRatio`: the fund's price divided by the marked-to
// -market value of its last DISCLOSED holdings, expressed as a percentile
// within that fund's own trailing year. High = price has pulled ahead of the
// portfolio. This is INFORMATION, not a filter — the model does not act on it
// (the measured sample is far too thin to gate on), it just makes visible
// when a fund suggestion is being made at a rich price.
function navRatioTone(p) {
  return p >= 80 ? 'premium' : p <= 20 ? 'discount' : 'neutral';
}
function navRatioBadge(item) {
  const r = item.navRatio;
  if (!r) return '';
  const tone = navRatioTone(r.percentile);
  const label = tone === 'premium' ? 'premium' : tone === 'discount' ? 'discount' : 'fair';
  return `<span class="sm-nav sm-nav--${tone}" title="Price vs disclosed holdings: ${r.percentile}th percentile of this fund's last year (${r.quarter} portfolio, ${r.holdings} holdings)">${label} p${r.percentile}</span>`;
}

function renderGrid(direction) {
  const all = state[direction];
  const list = filteredList(direction);
  const grid = document.getElementById(`sm-${direction}-grid`);
  const wrap = document.getElementById(`sm-${direction}-table-wrap`);
  const empty = document.getElementById(`sm-${direction}-empty`);
  const count = document.getElementById(`sm-${direction}-count`);

  // Keep the original copy so the unfiltered empty state can be restored.
  if (empty.dataset.msgDefault === undefined) empty.dataset.msgDefault = empty.textContent.trim();

  count.textContent = list.length === all.length ? `${all.length}` : `${list.length} of ${all.length}`;

  // A section emptied by filters is a different fact from one with no setups
  // at all, and the asymmetry between grids is itself information, so the
  // section stays visible either way. Set unconditionally so the message
  // can't be left stale on the hidden element after filters are cleared.
  empty.textContent = (all.length && filtersActive())
    ? `No ${direction === 'buy' ? 'Buy' : 'Sell'} suggestions match the current filters.`
    : empty.dataset.msgDefault;

  if (!list.length) {
    grid.innerHTML = '';
    wrap.style.display = 'none';
    empty.style.display = '';
    return;
  }
  wrap.style.display = '';
  empty.style.display = 'none';
  grid.innerHTML = list.map(rowHtml).join('');
  grid.querySelectorAll('.sm-row').forEach(row => {
    row.addEventListener('click', () => openSuperModelModal(row.dataset.direction, row.dataset.code));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSuperModelModal(row.dataset.direction, row.dataset.code); }
    });
  });
}

function renderMeta() {
  const el = document.getElementById('sm-meta-row');
  const asOf = state.asOf ? new Date(state.asOf).toLocaleString() : '—';
  const bar = state.dataAsOfDate ? ` · prices through ${state.dataAsOfDate}` : '';
  el.textContent = `Scanned ${state.universeScanned} stocks · conviction threshold ±${state.threshold}${bar} · generated ${asOf}`;
}

// The DSEX regime every scored trade is gated against (see DEFAULT_PLAN in
// routes/super-model-engine.js) — shown even on a day nothing is actually
// gated, so a thin Buy or Sell list has a visible explanation rather than
// looking like the model just found nothing.
function renderIndexContext() {
  const el = document.getElementById('sm-index-context');
  const ic = state.indexContext;
  el.className = 'sm-index-context';
  if (!ic) { el.textContent = ''; return; }

  const trendWord = ic.above50Sma ? 'above' : 'below';
  const candleWord = ic.bodyPct > 0.1 ? 'green' : ic.bodyPct < -0.1 ? 'red' : 'flat';
  const parts = [
    `<span>DSEX <strong>${Math.round(ic.close).toLocaleString()}</strong> as of ${ic.asOfDate}, ${trendWord} its 50-day SMA</span>`,
    `<span>index RSI(14) <strong>${ic.rsi14.toFixed(0)}</strong></span>`,
    `<span>latest candle ${candleWord} (${ic.bodyPct >= 0 ? '+' : ''}${ic.bodyPct.toFixed(2)}%)</span>`,
  ];
  if (ic.gate.buyBlocked) parts.push('<span class="sm-index-ctx-gatepill">New Buy setups filtered — index too weak</span>');
  if (ic.gate.sellBlocked) parts.push('<span class="sm-index-ctx-gatepill">New Sell setups filtered — index in a panic zone</span>');

  el.innerHTML = parts.join('');
  el.classList.toggle('is-buy-gated', !!ic.gate.buyBlocked);
  el.classList.toggle('is-sell-gated', !!ic.gate.sellBlocked);
}

// ── Sidebar ────────────────────────────────────────────────────────────────
// DSEX headline + sparkline for the market-summary card. The index file is
// served statically and stored NEWEST-first (see scripts/import-dsex-index.js),
// so it's reversed before use. Day change is real: last close vs the one
// before it. Fails quiet — the card falls back to the indexContext snapshot.
async function renderMarketCard() {
  const ic = state.indexContext;
  const priceEl = document.getElementById('sm-dsex-price');
  const asofEl = document.getElementById('sm-dsex-asof');
  if (ic) {
    priceEl.textContent = Math.round(ic.close).toLocaleString();
    asofEl.textContent = `as of ${ic.asOfDate}`;
  }
  try {
    const res = await fetch('/historical_prices/json_files/DSEX.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()).slice().reverse(); // newest-first on disk
    if (rows.length < 2) return;
    const closes = rows.map(r => r.Close);
    const last = closes[closes.length - 1], prev = closes[closes.length - 2];
    const diff = last - prev, pct = (diff / prev) * 100;
    priceEl.textContent = Math.round(last).toLocaleString();
    const chEl = document.getElementById('sm-dsex-change');
    chEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
    chEl.className = `sm-dsex-change ${diff > 0 ? 'sm-pos' : diff < 0 ? 'sm-neg' : ''}`;

    // Sparkline over the last ~90 sessions, normalised into the viewBox.
    const spark = closes.slice(-90);
    const lo = Math.min(...spark), hi = Math.max(...spark), span = hi - lo || 1;
    const W = 220, H = 56, PAD = 3;
    const pts = spark.map((v, i) => {
      const x = (i / (spark.length - 1)) * W;
      const y = PAD + (1 - (v - lo) / span) * (H - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    document.getElementById('sm-dsex-spark').innerHTML = `
      <polyline class="sm-spark-line ${diff >= 0 ? 'sm-spark-line--up' : 'sm-spark-line--down'}"
                points="${pts.join(' ')}" />`;
  } catch { /* headline from indexContext already shown */ }
}

// Compact suggestion list for the sidebar: every current pick, strongest
// first, both sides interleaved. Clicking one opens the full analysis.
function pickRow(item) {
  const name = state.names[item.code] || '';
  return `
    <div class="sm-pick" data-code="${item.code}" data-direction="${item.direction}" tabindex="0" role="button">
      <div class="sm-pick-id">
        <span class="sm-pick-code">${item.code}</span>
        ${name ? `<span class="sm-pick-name">${name}</span>` : ''}
      </div>
      <span class="sm-chip sm-chip--${item.direction}${item.label.startsWith('Strong') ? ' sm-chip--strong' : ''}">${item.label}</span>
    </div>`;
}

function wirePickRows(rootEl) {
  rootEl.querySelectorAll('.sm-pick').forEach(row => {
    const open = () => window.openSuperModelModal(row.dataset.direction, row.dataset.code);
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

function renderSidePicks() {
  const el = document.getElementById('sm-side-picks');
  const q = (document.getElementById('sm-side-search').value || '').trim().toLowerCase();
  let list = [...state.buy, ...state.sell].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  if (q) list = list.filter(s => `${s.code} ${state.names[s.code] || ''}`.toLowerCase().includes(q));
  const shown = list.slice(0, 12);
  el.innerHTML = shown.length
    ? shown.map(pickRow).join('') +
      (list.length > shown.length ? `<div class="sm-pick-more">+ ${list.length - shown.length} more in the Suggestions tab</div>` : '')
    : `<div class="sm-pick-more">${q ? 'No picks match that search.' : 'No suggestions right now.'}</div>`;
  wirePickRows(el);
}

function renderSideRecent() {
  const card = document.getElementById('sm-recent-card');
  const el = document.getElementById('sm-side-recent');
  // Only codes still present in today's suggestions can re-open an analysis.
  const rows = readRecent()
    .map(r => state[r.direction] && state[r.direction].find(s => s.code === r.code))
    .filter(Boolean);
  if (!rows.length) { card.style.display = 'none'; return; }
  card.style.display = '';
  el.innerHTML = rows.map(pickRow).join('');
  wirePickRows(el);
}

// ── Filters ────────────────────────────────────────────────────────────────
function applyFilters() {
  filters.q = document.getElementById('sm-filter-search').value.trim().toLowerCase();
  filters.category = document.getElementById('sm-filter-category').value;
  filters.sector = document.getElementById('sm-filter-sector').value;
  filters.signal = document.getElementById('sm-filter-signal').value;
  const seg = document.querySelector('#sm-filter-strength .sm-seg-btn.active');
  filters.strength = seg ? seg.dataset.strength : 'all';

  renderGrid('buy');
  renderGrid('sell');
  renderFilterCount();
}

function renderFilterCount() {
  const total = state.buy.length + state.sell.length;
  const shown = filteredList('buy').length + filteredList('sell').length;
  document.getElementById('sm-filter-count').textContent =
    shown === total ? `${total} suggestions` : `Showing ${shown} of ${total} suggestions`;
}

// Built with createElement rather than an innerHTML template: many sector
// and company names contain "&" (e.g. "Pharmaceuticals & Chemicals").
function addOption(select, value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  select.appendChild(o);
}

function populateFilterOptions() {
  const all = [...state.buy, ...state.sell];

  const secCount = {};
  all.forEach(s => { const v = state.sectors[s.code]; if (v) secCount[v] = (secCount[v] || 0) + 1; });
  const secSel = document.getElementById('sm-filter-sector');
  Object.keys(secCount).sort().forEach(sec => addOption(secSel, sec, `${sec} (${secCount[sec]})`));

  // A signal present on every card can't narrow anything, so it's dropped.
  // Deriving that from the counts keeps it correct as weights change,
  // rather than hardcoding today's always-on signals.
  const sigCount = {};
  all.forEach(s => new Set(s.signals.map(x => x.key))
    .forEach(k => { sigCount[k] = (sigCount[k] || 0) + 1; }));
  const sigSel = document.getElementById('sm-filter-signal');
  Object.entries(sigCount)
    .filter(([, n]) => n < all.length)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, n]) => addOption(sigSel, key, `${signalLabel(key)} (${n})`));
}

// loadSuperModel() (which calls this) re-runs every time a backtest run
// finishes — including one resumed from a poll started before this page
// load — so without this guard every completed run would add another set
// of listeners to these controls, compounding into duplicate applyFilters()
// calls (and duplicate re-renders) per keystroke/click as the session goes on.
let filtersWired = false;
function wireFilters() {
  if (filtersWired) return;
  filtersWired = true;
  document.getElementById('sm-filter-search').addEventListener('input', applyFilters);
  ['sm-filter-category', 'sm-filter-sector', 'sm-filter-signal'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));

  document.getElementById('sm-filter-strength').addEventListener('click', e => {
    const btn = e.target.closest('.sm-seg-btn');
    if (!btn) return;
    btn.parentElement.querySelectorAll('.sm-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    applyFilters();
  });

  document.getElementById('sm-filter-clear').addEventListener('click', () => {
    document.getElementById('sm-filter-search').value = '';
    ['sm-filter-category', 'sm-filter-sector', 'sm-filter-signal'].forEach(id =>
      { document.getElementById(id).value = ''; });
    document.querySelectorAll('#sm-filter-strength .sm-seg-btn').forEach((b, i) =>
      b.classList.toggle('active', i === 0));
    applyFilters();
  });
}

// ── Evidence panes ─────────────────────────────────────────────────────────
const num = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

const signed = (v, suffix = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`);
const posneg = v => (v == null ? '' : v > 0 ? 'sm-pos' : v < 0 ? 'sm-neg' : '');

// A 4th element makes the cell open a detail panel explaining the number.
// A 5th element is an extra class on the cell itself (see --hero).
function statBlock(items) {
  // Column count comes from the card count so every row fills the width
  // with no trailing hole: up to 6 cards sit in one full row, more split
  // into two balanced rows (8 -> 4+4). Narrow screens override to 2 cols.
  const cols = items.length <= 6 ? items.length : Math.ceil(items.length / 2);
  return `<div class="sm-statgrid" style="--sm-stat-cols:${cols}">${items.map(([label, value, cls, metric, cellCls]) => {
    const base = `sm-statcell${cellCls ? ` ${cellCls}` : ''}`;
    const on = metric ? ` class="${base} sm-statcell--clickable" data-metric="${metric}" tabindex="0" role="button"`
                      : ` class="${base}"`;
    return `<div${on}><span class="sm-statlabel">${label}</span><span class="sm-statnum ${cls || ''}">${value}</span></div>`;
  }).join('')}</div>`;
}

// ── Metric detail ──────────────────────────────────────────────────────────
const BT_SIDE_LABEL = { all: 'all simulated trades', buy: 'Buy-side trades', sell: 'Sell-side trades' };
const btSide = (b, which) => (which === 'buy' ? b.buy : which === 'sell' ? b.sell : b.overall);
const btDataFor = range => (range === '2y' ? state.backtest2y
  : range === 'capped' ? state.backtestCapped
  : range === 'cappedPct' ? state.backtestCappedPct
  : range === 'explorer' ? state.backtestExplorer
  : range === 'range' ? state.backtestRange
  : state.backtest);

function btTradeRows(s) {
  return [
    ['Trades simulated', num(s.n)],
    ['Reached target', num(s.targetPct, '%'), 'sm-pos'],
    // Mutually exclusive rows, not "of which": lossStopPct already excludes
    // the breakeven-or-better stops counted in the row below it.
    ['Stopped (loss)', num(s.lossStopPct, '%'), 'sm-neg'],
    ['Breakeven', num(s.breakevenPct, '%')],
    ['Expired unresolved', num(s.expiredPct, '%')],
    ['Ended profitable (gross)', num(s.winRate, '%')],
    ['Ended profitable (net)', num(s.winRateNet, '%')],
    ['Average P&L (gross)', signed(s.avgPnl, '%'), posneg(s.avgPnl)],
    ['Average P&L (net)', signed(s.avgPnlNet, '%'), posneg(s.avgPnlNet)],
    ['Median P&L (gross)', signed(s.medianPnl, '%'), posneg(s.medianPnl)],
    ['P&L std deviation', num(s.pnlStdev)],
    ['Avg days to target', num(s.avgBarsToTarget)],
    ['Avg days to stoploss', num(s.avgBarsToStop)],
    ['Avg days held overall', num(s.avgBarsHeld)],
  ];
}

// A rules list can run long enough (Explorer: 15 rows) that it reads as an
// undifferentiated wall rather than a structure. `section()` marks a row as
// a group header instead of a label:value pair — a sentinel key rather than
// a new field, so every existing rows-consumer (openSuperModelInfo, and any
// other kind that returns plain rows) keeps working without a branch.
const SM_SECTION = '§section';
const section = label => [SM_SECTION, label];

// Rule-set characteristics per backtest variant, for the ⓘ info modal on
// each write-up's header (metric key "variant:<range>"). The rows describe
// the GENERATOR CONFIG — fixed text, like the scope notes — while every
// measured number in the modal is read live from the loaded summary, per
// the project rule that figures are never hand-typed.
const BT_VARIANT_INFO = {
  full: {
    title: 'Full history — rule set',
    what: `The shipped plan, simulated over every bar of available price history. Entry at the signal price; stoploss at the nearest support/resistance level (or 1.5× ATR(14) when none is usable); target at the nearest opposing level, or a 2:1 reward:risk projection. No trade management after entry — the levels set on day one are the levels that decide the trade.`,
    how: `This is the baseline every other variant modifies. Its long span makes it the most statistically stable view — and the most sobering one: after commission it is roughly a wash, which is why the trailing 2-year read exists alongside it.`,
    rules: [],
  },
  '2y': {
    title: 'Last 2 years — rule set',
    what: `Exactly the same shipped plan as Full history, scored only over a rolling trailing 2-year window recomputed at each run. Same weights, same conviction threshold, same entry/stop/target construction — only the period differs.`,
    how: `Where the tradeable edge currently lives: recent regime, net-positive after commission. Compare against Full history to see how much of the result is period-dependent.`,
    rules: [],
  },
  capped: {
    title: 'Capped 1:2.5 — rule set',
    what: `The shipped plan with one change: any target further than 2.5× the risk distance is pulled in to exactly 1:2.5 reward:risk. Tested and REJECTED — the far targets it trims are where a disproportionate share of the edge lives.`,
    how: `Kept on the page as evidence, not as an option: the Model comparison table shows what capping actually did, rather than the page asserting it.`,
    rules: [['Target cap (reward:risk)', 'maximum 1:2.5']],
  },
  cappedPct: {
    title: 'Capped 12% — rule set',
    what: `The shipped plan with the target capped at a 12% price move from entry, regardless of reward:risk. Tested and REJECTED, more decisively than the 1:2.5 cap: the stop is untouched, so a volatile stock's stop can be wider than the capped target, flipping nearly half of trades below 1:1 risk:reward.`,
    how: `Kept on the page as evidence, not as an option — see the Model comparison table.`,
    rules: [['Target cap (price distance)', 'maximum 12% from entry']],
  },
  explorer: {
    title: 'Explorer — rule set',
    what: `The same signals as every other variant, but Explorer now filters entries AND changes how a trade is managed after entry. Six entry gates must all pass before a trade is taken: the signal day's own candle has to close green for a buy (red for a sell), that day has to trade more volume than the day before it, — on buys — its upper wick must be no longer than 40% of the day's range so a rally that got sold into doesn't count as confirmation, — also on buys — the stock must already be up at least 20% over the prior 30 trading days, and that same candle must leave a lower wick of at least 40% of its range, meaning the day's dip was bought back before the close. One more condition applies only to stretched entries: if the buy sits more than 20% above its own 20-day moving average, its upper wick may not exceed 20% of the day's range rather than the usual 40%. Both target caps then apply (whichever is tighter). A profit-lock ladder ratchets the stop up behind the price: at +2.1% the stop locks +2%, and so on up the rungs, plus a lock at every opposing S/R level as price crosses it. Against the position, a confirmed break of an adverse S/R level exits early instead of riding to the full stop — and the levels it watches include role-reversed ones, where a support broken before entry keeps acting as resistance (and vice versa). Trades whose only honest stop sits more than 30% from entry are refused outright, and every stop that survives is hard-capped at 5% from entry. The stop only ever tightens, never loosens.`,
    how: `The ladder's 0.1% gap between each trigger and its lock makes this behave like a laddered take-profit-on-pullback: most stopped trades exit at a locked profit, not a loss — use the Breakeven filter in the trade browser to see them separated. Trades resolve in a few bars, so the one-open-trade-per-stock slot recycles far more signals than the unmanaged variants. VERDICT — the buy side now clears its costs; the blended figure does not, and can't be traded anyway. Read the history in order, because the verdict has moved twice. The variant's earlier strong results (high win rate, low volatility, four-window robustness) were measured with two flattering assumptions: exits could happen the day after entry, and every stop filled exactly at its level. Enforcing DSE settlement (no selling before T+2, or T+3 for Z-category) and filling gapped stops at the open erased the edge — the tightly-spaced profit locks mostly fill at the next morning's open, not at the lock price. Two same-day entry gates were tested against this variant afterward. Candle confirmation IMPROVED the buy-side average in all four validation windows (it doesn't suffer the multi-day trend gates' whipsaw failure, since it reads only the signal day itself). Volume confirmation, stacked on top, improves the blended average in three of four windows but is a genuine 2-2 split on the buy side. The wick filter is the strongest entry result measured here — it beat the ungated config on the buy side in ALL FOUR windows, with a monotonic threshold sweep behind it, because it sharpens "the day closed green" into "the day closed green and held its gains". None of those three was enough on its own: the buy-side average improved but stayed under the 0.8% round-trip commission, because the ladder keeps capping every winner regardless of how good the entry was. The momentum floor is what finally cleared it, and the defended-lows filter compounded it. It began as the opposite question — whether to avoid buying what had already run 15% — and the answer was an emphatic no: that gate lost in all four windows at every threshold across three lookbacks, on mutual funds and on the broad market alike, because P&L rises monotonically with prior extension on this exchange. Inverted into a floor, and with settlement and gap fills still fully enforced, it is the first configuration in this model's history whose long book is net-positive after commission in ALL FOUR validation windows, and the capital-constrained portfolio replay moves from about -33% to +18% over the trailing two years at 15 concurrent positions with maximum drawdown cut from 38% to 11%. The defended-lows filter then came from an observation about a losing SHORT — an entry candle with a 51% lower wick on heavy volume that got stopped out. As a sell filter that fails outright (long-lower-wick shorts are the least-bad shorts, and blocking them wins only one window in four), but inverted onto the buy side it beat the ungated config in all four windows again (+0.50 / +0.38 / +2.26 / +2.75 net against +0.28 / +0.05 / +0.62 / +0.93), and the capital-constrained replay went from -1.7% to +36.1% at five concurrent positions with maximum drawdown cut from 23% to 12.6%. Two caveats worth carrying: its underlying bucket table is U-shaped rather than sloped, so the mechanism is less cleanly understood than the run-up effect, and the model now fires around a hundred times a year with average exposure of only 9-22%, meaning most capital sits in cash. The blended average stays negative because the sell book is untouched and hopeless — but DSE has no short mechanism, so judge this variant on its Buy figures. The lessons stand regardless: a management rule that only wins under idealized fills is an artifact, not an edge; entry filters that read a single bar survive where multi-day trend gates whipsaw; and the most valuable result here came from a hypothesis that failed cleanly enough to point at its own inverse. This rule set was frozen on 2026-09-06 as "Explorer Beta" — a locked clone with its own page and forward record (/explorer_beta/explorer-beta.html) — while the Explorer variant here keeps evolving.`,
    rules: [
      section('Entry filters — all must pass'),
      ['Candle', 'buy only if the signal day\'s candle closed green (Close ≥ Open); sell only if it closed red'],
      ['Volume', 'the signal day must trade more volume than the day before it'],
      ['Wick', 'buys only: skip it if the entry candle\'s upper wick is longer than 40% of that day\'s range (the rally was sold into)'],
      ['Momentum floor', 'buys only: the stock must ALREADY be up at least 20% over the prior 30 trading days — the inverse of the intuitive "don\'t chase" rule, and the single largest improvement measured on this variant'],
      ['Defended lows', 'buys only: the entry candle\'s LOWER wick must be at least 40% of that day\'s range — the dip was bought back. Note this is the opposite wick from the filter above it: one rejects a rally that was sold into, this one requires a dip that was defended'],
      ['Stretched entries', 'buys only: a long entered more than 20% above its own 20-day SMA is held to a tighter 20% upper-wick ceiling instead of the usual 40% — an entry far from its mean has less room to absorb a rejection'],
      section('Target & profit management'),
      ['Target cap (reward:risk)', 'maximum 1:2.5'],
      ['Target cap (price distance)', 'maximum 12% from entry — tighter cap wins'],
      ['Profit-lock ladder', '+2.1% locks +2 · 4.1→4 · 5.1→5 · 6.1→6 · 7.1→7 · 8.1→8 · 9.1→9 · 10.1→10 · 11.1→11 (no 3% rung)'],
      ['S/R profit locks', 'stop ratchets to each opposing S/R level as price crosses it'],
      section('Stop & exit management'),
      ['Adverse S/R-break exit', 'a daily close breaking a support (buy) / resistance (sell) between entry and stop exits at that close'],
      ['Role-reversed levels', 'the break exit also watches flipped levels — broken support acting as resistance and vice versa — while entry/stop/target placement ignores them'],
      ['Max-risk gate', 'trades whose stop is more than 30% from entry are refused outright'],
      ['Hard stop cap', 'every surviving stop is pulled in to at most 5% from entry — no trade can lose much beyond 5% plus gap risk, at a measured cost in whipsaw stopouts'],
      ['Stop behaviour', 'ratchet only — tightens, never loosens'],
    ],
  },
  psim: {
    title: 'Portfolio simulation — method',
    what: `Replays the 2-year shipped and Explorer trade streams through a simulated account: ৳1,000,000 starting capital, a hard cap on open positions, buy-only (DSE has no real short mechanism), 0.4% commission per side, equity marked to market daily from actual closes. Each new position is sized at equity ÷ max positions; when more signals fire than there are free slots, the highest conviction score wins.`,
    how: `This answers what the per-trade averages can't: those assume unlimited parallel capital. Here capital is finite, so most signals get skipped — the "skipped for capital" figure shows how binding that is. Honest limits: entries fill at the same close the signal is computed from, stops fill exactly at the stop (no gap-through), fractional shares, no market impact in thin names, and skipping a trade doesn't re-simulate what the model would have done with that slot. Those optimistic assumptions hit both plans identically, so the COMPARISON is the robust finding; the absolute returns are an upper bound.`,
    rules: [
      ['Starting capital', '৳1,000,000'],
      ['Direction', 'buy signals only — sell rows are theoretical on DSE'],
      ['Position size', 'equity ÷ max positions at entry, capped by available cash'],
      ['Slot contention', 'highest |score| first; a slot freed by a morning exit can fund a same-day signal'],
      ['Dust guard', 'entries under 1% of a full slot are skipped as cash-exhausted'],
      ['Commission', '0.4% per side (0.8% round trip — same figure as every net number on the page)'],
      ['Marking', 'daily close; last known close carries through halts'],
      ['Settlement', 'inherited from the trade stream: no exit before T+2 (T+3 for Z-category), gapped stops fill at the open'],
      ['End of data', 'open positions close at their last mark, like the backtest'],
      ['Benchmark', 'DSEX rebased to the same starting capital (no fees, perfect tracking)'],
    ],
  },
};

/** Returns { title, value, cls, sub, what, how, rows, notes } or null. */
function metricDetail(key) {
  const t = state.tracking;
  // bt keys carry a range and a side ("bt:full:buy:target" / "bt:2y:buy:target");
  // live/win/sig keys don't, so their field is the SECOND segment, not the third.
  const [kind, a, f] = key.split(':');

  if (kind === 'variant') {
    const v = BT_VARIANT_INFO[a];
    const b = btDataFor(a);
    if (!v) return null;
    if (!b || !b.overall) {
      return { title: v.title, value: '—', sub: 'no backtest data on disk yet for this variant',
        what: v.what, how: v.how, rows: v.rules, notes: [] };
    }
    return {
      title: v.title,
      value: signed(b.overall.avgPnlNet, '%'), cls: posneg(b.overall.avgPnlNet),
      sub: 'net average P&L per simulated trade under this rule set',
      what: v.what, how: v.how,
      // Scalar run facts read as a small stat-card grid (reusing statBlock,
      // the same card look the backtest tabs use) rather than as more rows
      // in the prose rule list below — the two are different kinds of
      // information (fixed context vs. what the rule set actually does).
      paramCards: [
        ['Conviction threshold', `±${num(b.threshold != null ? b.threshold : state.threshold)}`],
        ['Max holding window', `${num(b.maxHoldBars)} bars`],
        ['Commission (net figures)', num(b.overall.costPct, '%')],
        ['Simulated trades', num(b.overall.n)],
        ['Stocks covered', num(b.stocks)],
        ['Period', `${num(b.periodFrom)} → ${num(b.periodTo)}`],
      ],
      rows: v.rules,
      // The scope note is the generated, authoritative description of this
      // run — carried here so the modal and the write-up can't drift apart.
      notes: (b.caveats || []).slice(0, 1),
    };
  }

  if (kind === 'bt') {
    // Shadows the generic a/f above with the bt-specific 4-segment parse.
    const [, range, a, f] = key.split(':');
    const b = btDataFor(range);
    if (!b) return null;
    const s = btSide(b, a);
    if (!s) return null;
    const scope = BT_SIDE_LABEL[a];
    const m = b.method || {};
    const base = { rows: btTradeRows(s), notes: [] };

    if (f === 'n') return { ...base,
      title: 'Simulated trades', value: num(s.n), sub: `${scope} generated over the backtest`,
      what: `Every historical bar where the model's score crossed its conviction threshold produced one simulated trade, with the same entry, stoploss and target the page would have shown that day.`,
      how: `Signals are scored bar by bar using only data available at that bar. To stop one big move being counted many times over, a stock can hold only one open simulated trade at a time — a new signal is ignored until the previous trade closes.`,
      // Opens the full list rather than only the aggregate: a summary nobody
      // can drill into is a summary nobody can check.
      browser: { kind: 'bt', side: a, outcome: '', range },
      notes: [m.overlap, m.lookahead].filter(Boolean) };

    if (f === 'target') return { ...base,
      title: 'Hit target', value: num(s.targetPct, '%'), cls: 'sm-pos',
      sub: `of ${scope} reached their target first`,
      what: 'The share of simulated trades where price touched the target level before the stoploss.',
      how: 'Each trade walks forward one day at a time from the signal bar; the first level the day\'s high-low range touches decides the outcome.',
      notes: [m.sameBar].filter(Boolean) };

    if (f === 'stop') return { ...base,
      title: 'Stopped (loss)', value: num(s.lossStopPct, '%'), cls: 'sm-neg',
      sub: `of ${scope} were stopped out at a genuine loss`,
      what: 'The share of simulated trades where price touched the stoploss before the target, AND the exit was strictly below (buys) / above (sells) entry — a real loss, before costs. Stops that had been ratcheted to entry or better by a breakeven/profit-lock rule are excluded here and counted under Breakeven instead, so the two figures never double-count the same trade.',
      how: 'A loss-stop rate above the target rate is not automatically a losing system — targets sit further away than stops, so each win is larger than each loss. The average P&L is the figure that settles it.',
      notes: [m.sameBar].filter(Boolean) };

    if (f === 'breakeven') return { ...base,
      title: 'Breakeven', value: num(s.breakevenPct, '%'),
      sub: `of ${scope} exited on a raised stop, at entry or better`,
      what: 'The share of simulated trades whose stoploss had been ratcheted to the entry price or beyond — by a breakeven or profit-lock rule — before it was hit. The exit was flat or profitable before costs, not a genuine loss.',
      how: `Shown separately from Stopped (loss), not folded into it: Hit target (${num(s.targetPct, '%')}) + Stopped (loss) (${num(s.lossStopPct, '%')}) + Breakeven (${num(s.breakevenPct, '%')}) + Expired (${num(s.expiredPct, '%')}) accounts for all of ${scope}, with no trade counted twice. Under rule sets with no stop-raising rule this is 0% by definition. Note a trade that exits exactly at entry still pays the ${num(s.costPct, '%')} round-trip commission, so "breakeven" here is gross, not net.`,
      notes: [] };

    if (f === 'expired') {
      const x = b.expiryBreakdown;
      return { ...base,
        title: 'Expired unresolved', value: num(s.expiredPct, '%'),
        sub: `of ${scope} touched neither level in the holding window`,
        what: `Trades where price reached neither the target nor the stoploss within the ${num(b.maxHoldBars)}-bar holding window. They are closed at the last bar's price and their gain or loss still counts toward the P&L figures.`,
        how: `Every trade ends exactly one way, so Hit target (${num(s.targetPct, '%')}) + Stopped (loss) (${num(s.lossStopPct, '%')}) + Breakeven (${num(s.breakevenPct, '%')}) + Expired (${num(s.expiredPct, '%')}) accounts for all of ${scope}.`,
        notes: x ? [`Not every expired trade ran the full window: of ${num(x.expired)} expirations across the whole run, ${num(x.truncatedByDataEnd)} were opened near the end of a stock's price history and ran out of data first.`] : [] };
    }

    if (f === 'pnl') return { ...base,
      title: 'Average P&L (gross)', value: signed(s.avgPnl, '%'), cls: posneg(s.avgPnl),
      sub: `mean result per trade across ${scope}, before brokerage`,
      what: 'The average percentage gain or loss per simulated trade, exiting at whichever level was hit — or at the closing price if the holding window ran out. No commission is subtracted here.',
      how: `Compare it against the median (${signed(s.medianPnl, '%')}): a mean well above the median means a few large winners carry the result, with most trades doing worse than the average suggests. See the net figure (${signed(s.avgPnlNet, '%')}) for what brokerage leaves of it.`,
      notes: [] };

    if (f === 'pnlNet') return { ...base,
      title: 'Average P&L (net of commission)', value: signed(s.avgPnlNet, '%'), cls: posneg(s.avgPnlNet),
      sub: `mean result per trade across ${scope}, after a ${num(s.costPct)}% round-trip commission`,
      what: `Same calculation as the gross average, minus a ${num(s.costPct)}% round-trip brokerage cost (0.4% on entry, 0.4% on exit — this site's standard assumption) applied to every trade.`,
      how: `Gross averaged ${signed(s.avgPnl, '%')}. A trade that finishes between 0% and +${num(s.costPct)}% gross is actually a loss once the fee is paid, which is why the net win rate (${num(s.winRateNet, '%')}) can sit well below the gross one (${num(s.winRate, '%')}).`,
      notes: [] };

    if (f === 'days') {
      const x = b.expiryBreakdown;
      return { ...base,
        title: 'Average days held', value: num(s.avgBarsHeld),
        sub: `bars per trade across ${scope}`,
        what: 'How long a simulated trade stayed open before hitting a level or expiring.',
        how: `Trades that reached target took ${num(s.avgBarsToTarget)} bars on average; those stopped out took ${num(s.avgBarsToStop)}. Anything still unresolved after ${num(b.maxHoldBars)} bars is closed at the market price and counted as expired.`,
        notes: x ? [`Not every expired trade ran the full window: of ${num(x.expired)} expirations, ${num(x.truncatedByDataEnd)} were opened near the end of a stock's price history and ran out of data first, closing after a median of ${num(x.truncatedMedianBars)} bars.`,
          'A "bar" is a row in the cleaned price file. Duplicate consecutive candles are dropped before analysis, so a bar count can run slightly under the number of calendar trading sessions.'] : [] };
    }

    if (f === 'daysToTarget') return { ...base,
      title: 'Days to target', value: num(s.avgBarsToTarget),
      sub: `trading days, ${scope} that reached target`,
      what: 'Average number of trading days between the signal and the target being reached, counting only trades that got there.',
      how: `Trades stopped out resolved in ${num(s.avgBarsToStop)} days on average — losers usually resolve faster than winners, which is normal since stops sit closer to entry than targets.`,
      notes: [] };
  }

  if (kind === 'live' && t) {
    // When the Live Record pane has a filter active, explain the SAME
    // filtered set its tiles are showing — using the global aggregate here
    // would silently disagree with the number the user just clicked.
    const filterActive = liveFiltersActive();
    const lt = filterActive
      ? summariseLiveForPane(filterLiveByRange(liveTradesCache || [], liveFilters))
      : t;
    const rows = [
      ['Tracked in total', num(lt.total)],
      ['Still open', num(lt.open)],
      ['Resolved', num(lt.closed)],
      ['Reached target', num(lt.target), 'sm-pos'],
      ['Hit stoploss', num(lt.stoploss), 'sm-neg'],
      ['Expired unresolved', num(lt.expired)],
      ['Target rate', num(lt.targetRate, '%'), 'sm-pos'],
      ['Stoploss rate', num(lt.stoplossRate, '%'), 'sm-neg'],
      ['Profitable', num(lt.winRate, '%')],
      ['Average P&L', signed(lt.avgPnlPct, '%'), posneg(lt.avgPnlPct)],
      ['Avg days to target', num(lt.avgDaysToTarget)],
      ['Avg days to stoploss', num(lt.avgDaysToStoploss)],
    ];
    const HOW_TRACK = 'Every suggestion this page shows is written to a store the first time it appears. Open ones are re-checked against later prices whenever the scan actually re-runs — results are cached for 10 minutes, so a refresh inside that window re-checks nothing, and if nobody opens the page for a week nothing resolves until someone does. A suggestion closes on the first completed daily bar whose range touches either level, and the exit is booked at that level exactly, with no allowance for a gap opening past it.';
    const D = {
      total: ['Tracked suggestions', num(lt.total), '', 'suggestions recorded since tracking began',
        'The number of distinct suggestions logged. A stock is recorded once per direction while that suggestion stays open, so a name repeating day after day is not counted again.'],
      open: ['Still open', num(lt.open), '', 'awaiting a target or stoploss',
        `Suggestions that have not yet touched either level. They stay open until one is hit or the holding window runs out.${lt.stale ? ` A further ${lt.stale} are marked stale — the stock's price history ends before the suggestion date, so their outcome can never be determined and they are excluded from every rate below.` : ''}`],
      closed: ['Resolved', num(lt.closed), '', 'suggestions that have finished',
        'Suggestions that reached their target, hit their stoploss, or ran out the holding window. Only these count toward the rates below.'],
      target: ['Reached target', num(lt.target), 'sm-pos', 'suggestions that hit their target first',
        'Suggestions where the price touched the target level before the stoploss.'],
      stoploss: ['Hit stoploss', num(lt.stoploss), 'sm-neg', 'suggestions stopped out first',
        'Suggestions where the price touched the stoploss level before the target.'],
      targetRate: ['Target rate', num(lt.targetRate, '%'), 'sm-pos', 'of resolved suggestions reached target',
        'Share of finished suggestions that reached their target. Measured only against resolved ones, so open suggestions do not flatter or drag it.'],
      stoplossRate: ['Stoploss rate', num(lt.stoplossRate, '%'), 'sm-neg', 'of resolved suggestions were stopped out',
        'Share of finished suggestions that hit their stoploss first.'],
      winRate: ['Profitable', num(lt.winRate, '%'), '', 'of resolved suggestions ended in profit',
        'Includes suggestions that expired at a profit without reaching the target, so it runs a little above the target rate.'],
      pnl: ['Average P&L', signed(lt.avgPnlPct, '%'), posneg(lt.avgPnlPct), 'mean result per resolved suggestion',
        'Average percentage gain or loss across finished suggestions. Those that reached a level exit at that level; those that expired exit at the closing price of the final bar of the holding window.'],
      daysTarget: ['Avg days to target', num(lt.avgDaysToTarget), '', 'trading days, target reached',
        'How long suggestions that reached their target took to get there.'],
      daysStop: ['Avg days to stoploss', num(lt.avgDaysToStoploss), '', 'trading days, stopped out',
        'How long suggestions that were stopped out took to get there.'],
    }[a];
    if (!D) return null;
    // Every live card opens onto the suggestion list itself, pre-filtered to
    // the subset that number describes — the same "don't just show a number,
    // let it be checked" idea the backtest's trade browser already applies.
    // When the pane's own filter is active, it carries straight through
    // (see mountTradeBrowser), so the list shown matches the tile exactly.
    const LIVE_OUTCOME = {
      total: '', open: 'open', closed: '', target: 'target', stoploss: 'stoploss',
      targetRate: 'target', stoplossRate: 'stoploss', winRate: '', pnl: '',
      daysTarget: 'target', daysStop: 'stoploss',
    };
    return {
      title: D[0], value: D[1], cls: D[2], sub: D[3], what: D[4], how: HOW_TRACK, rows,
      browser: {
        kind: 'live',
        side: filterActive ? liveFilters.side : 'all',
        outcome: LIVE_OUTCOME[a] || '',
        from: filterActive ? liveFilters.from : '',
        to: filterActive ? liveFilters.to : '',
        lastN: filterActive ? liveFilters.lastN : '',
      },
      notes: [
        ...(filterActive ? ["These figures reflect the Live Record pane's active filter, not the full tracked history."] : []),
        ...(lt.closed === 0
          ? ['Nothing has resolved yet, so the rates above are still empty. They fill in as prices print on the days after each suggestion was issued.']
          : ['This is a forward record: unlike the backtest, none of it was chosen with hindsight. It is also a much smaller sample, so read it as early evidence rather than a verdict.']),
      ],
    };
  }

  if (kind === 'win') {
    // Per-window rows only ever exist for the full-history run (see
    // renderBacktestSection) — the 2-year run has no perWindow breakdown.
    const b = state.backtest;
    if (!b) return null;
    const w = (b.perWindow || [])[Number(a)];
    if (!w) return null;
    return {
      title: `Test window: ${w.window}`, value: signed(w.rankEdge), cls: posneg(w.rankEdge),
      sub: 'rank edge — top-scoring 10% versus the market, over 20 trading days',
      what: `One of four independent stretches of history the model was scored on separately. In this window the market itself returned ${num(w.baseline20d, '%')} over an average 20 trading days, and the top-scoring 10% of stocks beat that by ${signed(w.rankEdge)} percentage points.`,
      how: 'Splitting into separate windows is the guard against fitting noise. A weight set that only looks good over the whole history, or in one window, has probably been tuned to that particular stretch — which is exactly how several signals in this model were caught and dropped.',
      rows: [
        ['Market return (20d)', num(w.baseline20d, '%')],
        ['Rank edge vs market', signed(w.rankEdge), posneg(w.rankEdge)],
        ['Decile spread', num(w.decileSpread)],
        ['Trades simulated', num(w.trades)],
        ['Average P&L', signed(w.avgPnl, '%'), posneg(w.avgPnl)],
        ['Reached target', num(w.targetPct, '%'), 'sm-pos'],
        ['Hit stoploss', num(w.stopPct, '%'), 'sm-neg'],
      ],
      notes: w.rankEdge != null && w.rankEdge < 0
        ? ['Rank edge is negative here: in this window a high score did not identify outperformers. This is reported rather than hidden — it is the honest limit of the model.']
        : [],
    };
  }

  if (kind === 'sig') {
    const meta = (state.signalMeta || {})[a];
    if (!meta) return null;
    const w = (state.weights || {})[a] || 0;
    const rows = [['Weight in the score', w === 0 ? 'not scored' : signed(w), w === 0 ? '' : posneg(w)]];
    if (meta.edge) {
      rows.push(['Measured edge, earlier half', signed(meta.edge.early), posneg(meta.edge.early)]);
      rows.push(['Measured edge, later half', signed(meta.edge.late), posneg(meta.edge.late)]);
      rows.push(['Same sign in both halves', meta.edge.consistent ? 'yes' : 'no', meta.edge.consistent ? 'sm-pos' : 'sm-neg']);
    }
    return {
      title: meta.label, value: w === 0 ? 'Not scored' : signed(w), cls: w === 0 ? '' : posneg(w),
      sub: w === 0 ? 'detected and shown, but contributes nothing to the score' : 'points contributed to the composite score',
      what: meta.measures, how: meta.verdict, rows,
      notes: meta.edge
        ? ['"Measured edge" is the excess forward return when this signal fires, averaged over 10 and 20 trading days, in each half of the history split at 2025/10. A signal only earns weight if the sign holds in both halves — one that flips is indistinguishable from noise.']
        : [],
    };
  }
  return null;
}

window.openSuperModelInfo = function (key) {
  const d = metricDetail(key);
  if (!d) return;
  document.getElementById('sm-info-title').textContent = d.title;
  document.getElementById('sm-info-body').innerHTML = `
    <div class="sm-info-value ${d.cls || ''}">${d.value}</div>
    ${d.sub ? `<div class="sm-info-sub">${d.sub}</div>` : ''}
    ${d.what ? `<div class="an-section"><div class="an-h3">What it measures</div><p class="an-note">${d.what}</p></div>` : ''}
    ${d.how ? `<div class="an-section"><div class="an-h3">How it's calculated</div><p class="an-note">${d.how}</p></div>` : ''}
    ${d.browser ? `<div class="an-section"><div class="an-h3">${d.browser.kind === 'live'
      ? `Every tracked suggestion${d.browser.from || d.browser.to || d.browser.lastN || d.browser.side !== 'all' ? ' (filtered)' : ''}`
      : 'Every simulated trade'}</div><div id="sm-trades"></div></div>` : ''}
    ${d.paramCards ? `<div class="an-section"><div class="an-h3">Run parameters</div>${statBlock(d.paramCards)}</div>` : ''}
    ${d.rows && d.rows.length ? `<div class="an-section"><div class="an-h3">${d.paramCards ? 'Rule set' : 'Full breakdown'}</div>
      <ul class="sm-info-rows">${d.rows.map(([k, v, c]) => k === SM_SECTION
        ? `<li class="sm-info-section">${v}</li>`
        : `<li><span class="sm-info-k">${k}</span><span class="sm-info-v ${c || ''}">${v}</span></li>`).join('')}</ul></div>` : ''}
    ${(d.notes || []).map(n => `<p class="an-note an-note-muted">${n}</p>`).join('')}`;
  const modal = document.getElementById('sm-info-modal');
  modal.classList.toggle('sm-info-wide', !!d.browser);
  if (d.browser) mountTradeBrowser(d.browser.kind, d.browser.side, d.browser.outcome, d.browser);
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

// ── Trade browser ──────────────────────────────────────────────────────────
// Two data sources share this one browser UI:
//   'bt'   — simulated backtest trades. Filtering/sorting/paging happen
//            server-side (see /trades): the full list is over a megabyte.
//   'live' — real tracked suggestions (see /tracking). Small enough to fetch
//            once and filter/sort/page in the browser.
// from/to/lastN only apply to kind:'live' — carried over from the Live
// Record pane's own filters when a tile is clicked while one is active
// (see mountTradeBrowser); the 'bt' side never sets them. range only
// applies to kind:'bt' — 'full', '2y', 'capped', 'cappedPct' or 'explorer', selecting which backtest's trade
// file /trades reads from.
const tradeView = { kind: 'bt', side: 'all', outcome: '', category: '', sector: '', range: 'full', from: '', to: '', lastN: '', q: '', sort: 'date', dir: 'desc', limit: 100, offset: 0 };
// Currently-rendered trade rows, indexed exactly as the data-idx attribute
// on each <tr> — lets the delegated click handler recover the full trade
// object without round-tripping it through the DOM as a JSON attribute.
// Grows across "Load more" (append), reset on every fresh filter/sort.
let tradeRowsCache = [];

const TRADE_CATEGORY_OPTS = [['', 'Any category'], ['A', 'A'], ['B', 'B'], ['Z', 'Z'], ['none', 'Uncategorised']];

// Unlike category (a fixed A/B/Z set), sectors are an open list — built from
// whatever state.sectors (the same code->sector map the Suggestions filter
// and "By sector" breakdown use) actually contains at mount time.
function tradeSectorOptions() {
  const names = [...new Set(Object.values(state.sectors || {}))].filter(Boolean).sort();
  return [['', 'Any sector'], ...names.map(n => [n, n]), ['none', 'Unmapped']];
}

const OUTCOME_CLS = { target: 'sm-pos', stoploss: 'sm-neg', expired: '', open: '', stale: '', breakeven: '' };

// A stop ratcheted by a breakeven/profit-lock rule exits at or above entry
// (pnl >= 0 — exactly 0 for a plain breakeven stop, positive for a ladder
// rung), while a genuine unmoved stop is always strictly negative — same
// test the /trades route's `outcome=breakeven` filter uses. Shown as its
// own label so a filtered list doesn't read as a wall of "stoploss" rows
// that in fact lost nothing.
const displayOutcome = t => (t.outcome === 'stoploss' && t.pnlPct >= 0 ? 'breakeven' : t.outcome);

function tradeRowHtml(t, idx) {
  const outcome = displayOutcome(t);
  return `
    <tr class="sm-row-clickable" data-idx="${idx}" tabindex="0" role="button"
        aria-label="View chart for ${t.code} ${t.direction} on ${t.date}">
      <td class="sm-mono">${t.date}</td>
      <td class="sm-mono sm-trade-code">${t.code}</td>
      <td><span class="sm-trade-side sm-trade-side--${t.direction}">${t.direction === 'buy' ? 'Buy' : 'Sell'}</span></td>
      <td class="sm-mono ${posneg(t.score)}" title="${(t.signals || []).join('  ')}">${signed(t.score)}</td>
      <td class="sm-mono">${t.entry}</td>
      <td class="sm-mono sm-neg">${t.stoploss}</td>
      <td class="sm-mono sm-pos">${t.target}</td>
      <td class="sm-mono">${t.riskReward != null ? `1:${t.riskReward}` : '—'}</td>
      <td><span class="sm-trade-outcome ${OUTCOME_CLS[outcome] || ''}">${outcome}</span></td>
      <td class="sm-mono" title="${t.exitDate ? `exited ${t.exitDate}` : 'not yet resolved'}">${t.exitPrice != null ? t.exitPrice : '—'}</td>
      <td class="sm-mono">${t.barsHeld != null ? t.barsHeld : '—'}</td>
      <td class="sm-mono ${posneg(t.pnlPct)}">${signed(t.pnlPct, '%')}</td>
    </tr>`;
}

function tradeCols(kind) {
  return [
    [kind === 'live' ? 'Issued' : 'Signal date', 'date'], ['Code', 'code'], ['Side', 'direction'], ['Score', 'score'],
    ['Entry', 'entry'], ['Stop', null], ['Target', null], ['R:R', 'riskReward'],
    ['Outcome', 'outcome'], ['Exit', null], ['Bars', 'barsHeld'], ['P&amp;L', 'pnlPct'],
  ];
}

const BT_OUTCOME_OPTS = [['', 'Any outcome'], ['target', 'Target'], ['stoploss', 'Stopped'], ['breakeven', 'Breakeven'], ['expired', 'Expired']];
const LIVE_OUTCOME_OPTS = [['', 'Any status'], ['open', 'Open'], ['target', 'Target'], ['stoploss', 'Stopped'], ['expired', 'Expired']];

function mountTradeBrowser(kind, side, outcome = '', extra = {}) {
  Object.assign(tradeView, {
    kind, side: side === 'all' ? 'all' : (side || 'all'), outcome, category: '', sector: '', q: '', sort: 'date', dir: 'desc', offset: 0,
    range: extra.range || 'full',
    from: extra.from || '', to: extra.to || '', lastN: extra.lastN || '',
  });
  const root = document.getElementById('sm-trades');
  if (!root) return;

  const outcomeOpts = kind === 'live' ? LIVE_OUTCOME_OPTS : BT_OUTCOME_OPTS;
  const cols = tradeCols(kind);

  // This browser only exposes side/outcome/code controls — the date-range
  // and last-N filters carried over from the Live Record pane have no UI
  // here, so they're surfaced as a note (with a way to drop just that part)
  // rather than silently narrowing the list with no explanation.
  const inheritedBits = [
    tradeView.from && `from ${tradeView.from}`,
    tradeView.to && `to ${tradeView.to}`,
    tradeView.lastN && `last ${tradeView.lastN}`,
  ].filter(Boolean);

  root.innerHTML = `
    <div class="sm-trade-controls">
      <div class="sm-seg" id="sm-trade-side">
        ${[['all', 'All'], ['buy', 'Buy'], ['sell', 'Sell']].map(([v, l]) =>
          `<button type="button" class="sm-seg-btn ${tradeView.side === v ? 'active' : ''}" data-side="${v}">${l}</button>`).join('')}
      </div>
      <div class="sm-seg" id="sm-trade-outcome">
        ${outcomeOpts.map(([v, l]) =>
          `<button type="button" class="sm-seg-btn ${tradeView.outcome === v ? 'active' : ''}" data-outcome="${v}">${l}</button>`).join('')}
      </div>
      <select id="sm-trade-category" class="sm-trade-select" aria-label="Filter by category">
        ${TRADE_CATEGORY_OPTS.map(([v, l]) =>
          `<option value="${v}" ${tradeView.category === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select id="sm-trade-sector" class="sm-trade-select" aria-label="Filter by sector">
        ${tradeSectorOptions().map(([v, l]) =>
          `<option value="${v}" ${tradeView.sector === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input type="search" id="sm-trade-q" class="sm-trade-search" placeholder="Filter by code…"
             autocomplete="off" spellcheck="false" />
    </div>
    ${inheritedBits.length ? `<p class="sm-note sm-note-muted">Also carrying the Live Record pane's filter (${inheritedBits.join(', ')}).
      <button type="button" id="sm-trade-drop-inherited" class="sm-inline-link-btn">Drop it</button></p>` : ''}
    <div class="sm-trade-stats" id="sm-trade-stats"></div>
    <div class="sm-tablewrap sm-trade-scroll">
      <table class="sm-table sm-trade-table">
        <thead><tr>${cols.map(([label, key]) => key
          ? `<th class="sm-th-sort" data-sort="${key}" tabindex="0" role="button">${label}<span class="sm-sort-mark"></span></th>`
          : `<th>${label}</th>`).join('')}</tr></thead>
        <tbody id="sm-trade-body"></tbody>
      </table>
    </div>
    <div class="sm-trade-foot" id="sm-trade-foot"></div>`;

  root.querySelector('#sm-trade-side').addEventListener('click', e => {
    const b = e.target.closest('.sm-seg-btn'); if (!b) return;
    b.parentElement.querySelectorAll('.sm-seg-btn').forEach(x => x.classList.toggle('active', x === b));
    tradeView.side = b.dataset.side; refreshTrades();
  });
  root.querySelector('#sm-trade-outcome').addEventListener('click', e => {
    const b = e.target.closest('.sm-seg-btn'); if (!b) return;
    b.parentElement.querySelectorAll('.sm-seg-btn').forEach(x => x.classList.toggle('active', x === b));
    tradeView.outcome = b.dataset.outcome; refreshTrades();
  });
  root.querySelector('#sm-trade-category').addEventListener('change', e => {
    tradeView.category = e.target.value; refreshTrades();
  });
  root.querySelector('#sm-trade-sector').addEventListener('change', e => {
    tradeView.sector = e.target.value; refreshTrades();
  });
  const dropInherited = root.querySelector('#sm-trade-drop-inherited');
  if (dropInherited) dropInherited.addEventListener('click', () => mountTradeBrowser(tradeView.kind, tradeView.side, tradeView.outcome, { range: tradeView.range }));

  // Debounced so typing a code doesn't fire a request per keystroke.
  let typing = null;
  root.querySelector('#sm-trade-q').addEventListener('input', e => {
    clearTimeout(typing);
    const v = e.target.value;
    typing = setTimeout(() => { tradeView.q = v.trim(); refreshTrades(); }, 220);
  });

  const sortBy = th => {
    const key = th.dataset.sort;
    // Re-clicking the active column flips direction; a new column starts
    // descending, which is the useful default for dates, scores and P&L.
    tradeView.dir = tradeView.sort === key && tradeView.dir === 'desc' ? 'asc' : 'desc';
    tradeView.sort = key;
    refreshTrades();
  };
  root.querySelectorAll('.sm-th-sort').forEach(th => {
    th.addEventListener('click', () => sortBy(th));
    th.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(th); }
    });
  });

  // Delegated on the tbody itself, not individual rows — refreshTrades()
  // only ever swaps this element's innerHTML, never the element itself, so
  // one listener here survives every filter/sort/page refresh.
  const openRow = tr => {
    const t = tradeRowsCache[Number(tr.dataset.idx)];
    if (t) window.openTradeChartModal(t);
  };
  const tbody = root.querySelector('#sm-trade-body');
  tbody.addEventListener('click', e => { const tr = e.target.closest('tr[data-idx]'); if (tr) openRow(tr); });
  tbody.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-idx]');
    if (tr) { e.preventDefault(); openRow(tr); }
  });

  refreshTrades();
}

// ── Live suggestion list ────────────────────────────────────────────────────
// Small enough (real suggestions accumulate slowly) to fetch whole and
// filter/sort/page client-side, unlike the multi-megabyte backtest file.
let liveTradesPromise = null;
// Populated once the fetch above resolves — lets metricDetail() (synchronous,
// called straight from a click) read the same list renderLiveStatsBlock
// already awaited, without every caller having to go async.
let liveTradesCache = null;
function loadLiveTrades() {
  if (!liveTradesPromise) {
    liveTradesPromise = fetch(`${API}/api/super-model/tracking`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => (data.suggestions || []).map(t => ({
        date: t.issuedDate,
        code: t.code,
        direction: t.direction,
        score: t.score,
        entry: t.entry,
        stoploss: t.stoploss,
        target: t.target,
        riskReward: t.riskReward,
        outcome: t.status, // 'open' | 'target' | 'stoploss' | 'expired' | 'stale'
        exitDate: t.exitDate,
        exitPrice: t.exitPrice,
        barsHeld: t.barsHeld,
        pnlPct: t.pnlPct,
        signals: t.signalKeys || [],
      })))
      .then(list => { liveTradesCache = list; return list; })
      .catch(err => { liveTradesPromise = null; throw err; }); // let a later retry re-fetch
  }
  return liveTradesPromise;
}

function filterSortLive(all, view) {
  let list = all;
  if (view.side !== 'all') list = list.filter(t => t.direction === view.side);
  if (view.outcome) list = list.filter(t => t.outcome === view.outcome);
  // state.categories is the same code->A/B/Z map the Suggestions filter
  // uses, loaded client-side (see loadCategories) — no server round trip
  // needed for the live list, unlike the multi-megabyte 'bt' one.
  if (view.category) {
    list = view.category === 'none'
      ? list.filter(t => !state.categories[t.code])
      : list.filter(t => state.categories[t.code] === view.category);
  }
  // state.sectors is the same code->sector map the Suggestions sector
  // filter and "By sector" breakdown use.
  if (view.sector) {
    list = view.sector === 'none'
      ? list.filter(t => !state.sectors[t.code])
      : list.filter(t => state.sectors[t.code] === view.sector);
  }
  if (view.from) list = list.filter(t => t.date >= view.from);
  if (view.to) list = list.filter(t => t.date <= view.to);
  if (view.q) {
    const needle = view.q.toLowerCase();
    list = list.filter(t => t.code.toLowerCase().includes(needle));
  }
  // Same "last N of what already matched" semantics as filterLiveByRange —
  // applied before the display sort below, so lastN always means "most
  // recent by issue date", regardless of which column the table is sorted by.
  if (view.lastN) list = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, Number(view.lastN));
  const key = view.sort, dirMul = view.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // unresolved trades (nulls) sort last regardless of direction
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dirMul;
    return (av - bv) * dirMul;
  });
}

function summariseLive(list) {
  if (!list.length) return { n: 0 };
  const resolved = list.filter(t => t.pnlPct != null);
  const pnls = resolved.map(t => t.pnlPct).sort((a, b) => a - b);
  const held = resolved.map(t => t.barsHeld);
  const avg = arr => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null);
  const share = k => Math.round((list.filter(t => t.outcome === k).length / list.length) * 1000) / 10;
  return {
    n: list.length,
    targetPct: share('target'),
    stopPct: share('stoploss'),
    expiredPct: share('expired'),
    winRate: pnls.length ? Math.round((pnls.filter(p => p > 0).length / pnls.length) * 1000) / 10 : null,
    avgPnl: avg(pnls),
    medianPnl: pnls.length ? pnls[Math.floor(pnls.length / 2)] : null,
    bestPnl: pnls.length ? pnls[pnls.length - 1] : null,
    worstPnl: pnls.length ? pnls[0] : null,
    avgBarsHeld: avg(held),
    stocks: new Set(list.map(t => t.code)).size,
  };
}

// Shared by the Live-record summary pane and the trade browser: side +
// date range + "last N" (most recent by issue date, applied after the
// other filters so it means "last N matching trades", not "last N ever").
// Trade dates are 'YYYY/MM/DD'; <input type="date"> speaks 'YYYY-MM-DD',
// so callers pass from/to already in slash form (see dashToSlash below).
function filterLiveByRange(all, { side, from, to, lastN } = {}) {
  let list = all;
  if (side && side !== 'all') list = list.filter(t => t.direction === side);
  if (from) list = list.filter(t => t.date >= from);
  if (to) list = list.filter(t => t.date <= to);
  if (lastN) list = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, lastN);
  return list;
}

const dashToSlash = s => (s ? s.replace(/-/g, '/') : '');
const slashToDash = s => (s ? s.replace(/\//g, '-') : '');

// Same shape as state.tracking's server-computed aggregate, so the summary
// pane's stat tiles don't change layout when a filter narrows the list —
// only the numbers do.
function summariseLiveForPane(list) {
  const total = list.length;
  const open = list.filter(t => t.outcome === 'open').length;
  const resolved = list.filter(t => t.outcome !== 'open');
  const closed = resolved.length;
  const targetTrades = resolved.filter(t => t.outcome === 'target');
  const stoplossTrades = resolved.filter(t => t.outcome === 'stoploss');
  const expiredTrades = resolved.filter(t => t.outcome === 'expired');
  const pnls = resolved.map(t => t.pnlPct).filter(v => v != null);
  const avg = arr => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
  return {
    total, open, closed,
    target: targetTrades.length, stoploss: stoplossTrades.length, expired: expiredTrades.length,
    targetRate: pct(targetTrades.length, closed),
    stoplossRate: pct(stoplossTrades.length, closed),
    winRate: pnls.length ? pct(pnls.filter(p => p > 0).length, pnls.length) : null,
    avgPnlPct: avg(pnls),
    avgDaysToTarget: avg(targetTrades.map(t => t.barsHeld).filter(v => v != null)),
    avgDaysToStoploss: avg(stoplossTrades.map(t => t.barsHeld).filter(v => v != null)),
  };
}

async function refreshTrades(append = false) {
  const body = document.getElementById('sm-trade-body');
  const foot = document.getElementById('sm-trade-foot');
  const statsEl = document.getElementById('sm-trade-stats');
  if (!body) return;
  if (!append) { tradeView.offset = 0; foot.textContent = 'Loading…'; }

  let data;
  if (tradeView.kind === 'live') {
    try {
      const all = await loadLiveTrades();
      const filtered = filterSortLive(all, tradeView);
      const slice = filtered.slice(tradeView.offset, tradeView.offset + tradeView.limit);
      data = { trades: slice, stats: summariseLive(filtered), total: filtered.length, offset: tradeView.offset };
    } catch (err) {
      console.error('[super-model] live trade list failed:', err);
      body.innerHTML = '';
      foot.innerHTML = `<span class="sm-neg">Could not load the tracked suggestion list (${err.message}).</span>`;
      statsEl.textContent = '';
      return;
    }
  } else {
    const p = new URLSearchParams({ sort: tradeView.sort, dir: tradeView.dir, limit: tradeView.limit, offset: tradeView.offset });
    if (tradeView.side !== 'all') p.set('side', tradeView.side);
    if (tradeView.outcome) p.set('outcome', tradeView.outcome);
    if (tradeView.category) p.set('category', tradeView.category);
    if (tradeView.sector) p.set('sector', tradeView.sector);
    if (tradeView.q) p.set('q', tradeView.q);
    if (tradeView.range !== 'full') p.set('range', tradeView.range);

    try {
      const res = await fetch(`${API}/api/super-model/trades?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error('[super-model] trade list failed:', err);
      body.innerHTML = '';
      const genCmd = BT_SECTION_CFG[tradeView.range] ? BT_SECTION_CFG[tradeView.range].genCommand : 'node scripts/generate-backtest-summary.js';
      foot.innerHTML = `<span class="sm-neg">Could not load the trade list (${err.message}). Generate it with
        <code>${genCmd}</code>.</span>`;
      statsEl.textContent = '';
      return;
    }
  }

  const startIdx = append ? tradeRowsCache.length : 0;
  if (!append) tradeRowsCache = [];
  tradeRowsCache = tradeRowsCache.concat(data.trades);
  const rows = data.trades.map((t, i) => tradeRowHtml(t, startIdx + i)).join('');
  if (append) body.insertAdjacentHTML('beforeend', rows); else body.innerHTML = rows;

  const s = data.stats;
  const noun = tradeView.kind === 'live' ? 'suggestions' : 'trades';
  statsEl.innerHTML = !s.n ? `<span class="sm-note-muted">No ${noun} match these filters.</span>` : `
    <span><strong>${s.n.toLocaleString()}</strong> ${noun} · ${s.stocks} stocks</span>
    <span class="sm-pos">${s.targetPct}% target</span>
    <span class="sm-neg">${s.stopPct}% stopped</span>
    <span>${s.expiredPct}% expired</span>
    <span>avg <span class="${posneg(s.avgPnl)}">${signed(s.avgPnl, '%')}</span></span>
    <span>median <span class="${posneg(s.medianPnl)}">${signed(s.medianPnl, '%')}</span></span>
    <span>best <span class="sm-pos">${signed(s.bestPnl, '%')}</span> / worst <span class="sm-neg">${signed(s.worstPnl, '%')}</span></span>
    <span>${s.avgBarsHeld == null ? '—' : s.avgBarsHeld} bars avg</span>`;

  const shown = Math.min(data.offset + data.trades.length, data.total);
  foot.innerHTML = shown >= data.total
    ? `<span class="sm-note-muted">Showing all ${data.total.toLocaleString()} matching ${noun}.</span>`
    : `<button type="button" class="sm-trade-more" id="sm-trade-more">Load ${Math.min(tradeView.limit, data.total - shown)} more</button>
       <span class="sm-note-muted">Showing ${shown.toLocaleString()} of ${data.total.toLocaleString()}.</span>`;
  const more = document.getElementById('sm-trade-more');
  if (more) more.addEventListener('click', () => { tradeView.offset = shown; refreshTrades(true); });

  // Sort indicator lives on the header so the current order is visible
  // without inferring it from the rows.
  document.querySelectorAll('#sm-trades .sm-th-sort').forEach(th => {
    const on = th.dataset.sort === tradeView.sort;
    th.classList.toggle('sm-th-active', on);
    th.setAttribute('aria-sort', on ? (tradeView.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.querySelector('.sm-sort-mark').textContent = on ? (tradeView.dir === 'asc' ? ' ▲' : ' ▼') : '';
  });
}

window.closeSuperModelInfo = function () {
  document.getElementById('sm-info-modal').style.display = 'none';
  document.body.style.overflow = '';
};

// ── Trade footprint chart modal ─────────────────────────────────────────────
// Clicking any trade row (backtest browser, live record, or the browser
// embedded inside the metric-detail modal) opens the REAL candlestick chart
// page in an iframe, scrolled to that trade with its entry/stop/target/exit
// drawn on the price pane.
//
// Deliberately an iframe rather than a chart reimplemented here: the
// candlestick page is ~30 interdependent classic scripts sharing bare
// globals (chartData, zoomLevel, drawChart, per-indicator settings...), and
// it expects to own its DOM. Embedding it whole is what makes every real
// feature — all indicators, drawing tools, timeframes, replay, seasonals,
// pane resizing — work here exactly as it does on the chart page itself.
// The trade overlay lives on that side too (candlestick_chart/
// sm-trade-overlay.js), driven by the sm* URL params built below.
const CHART_OUTCOME_COLOR = { target: 'var(--gain)', breakeven: 'var(--gain)', stoploss: 'var(--loss)', expired: 'var(--text-muted)', open: 'var(--text-muted)', stale: 'var(--text-muted)' };

function tradeChartUrl(trade) {
  const p = new URLSearchParams({
    code: trade.code,
    embed: '1',
    smFocus: '1',
    smEntryDate: trade.date,
    smEntry: String(trade.entry),
    smSide: trade.direction,
    smOutcome: displayOutcome(trade),
  });
  if (trade.stoploss != null) p.set('smStop', String(trade.stoploss));
  if (trade.target != null) p.set('smTarget', String(trade.target));
  if (trade.exitDate) p.set('smExitDate', trade.exitDate);
  if (trade.exitPrice != null) p.set('smExitPrice', String(trade.exitPrice));
  return `/candlestick_chart/candlestick.html?${p}`;
}

// Trade rows persist each fired signal as a compact "sigKey:+/-" string;
// this maps those sigKeys back to the weight/meta keys the model pane uses,
// so the rationale below can cite the same labels, weights and validated
// edges the rest of the page shows.
const SIG_TO_WEIGHT_KEY = {
  macd: 'macd', 'hilega-milega': 'hm', 'liquidity-sweep': 'sweep',
  sma50: 'sma50', supertrend: 'supertrend', 'sr-proximity': 'srProximity',
  seasonality: 'seasonalityMax', valuation: 'valuationMax',
  minervini: 'minerviniPass', 'heikin-ashi': 'heikinAshi',
  'breakout-retest': 'breakoutRetest', rsi: 'rsi', marubozu: 'marubozu',
  'pin-bar': 'pinBar', 'doji-reversal': 'dojiReversal', harami: 'harami',
  'volume-surge': 'volumeSurge', 'order-block': 'orderBlock', 'ema-ribbon': 'emaRibbon',
};

// First couple of sentences of a signal's verdict — enough to say WHY it
// carries no weight without pasting the full validation essay into a cell.
// Splits only at sentence ends followed by a capital, so decimals like
// "+0.63" don't count as sentence boundaries.
function shortVerdict(verdict) {
  const sentences = String(verdict || '').split(/(?<=[.!?])\s+(?=[A-Z])/);
  return sentences.slice(0, 2).join(' ').trim();
}

// Highlighter-pen emphasis for the facts that decide a signal's fate: the
// measured figures, and the stock phrases the verdicts turn on. Phrases are
// matched case-insensitively; none of them contain digits, so the number
// pass below can't double-wrap them.
const HL_PHRASES = [
  'same sign in both halves', 'same sign both halves', 'same sign in both',
  'sign flips between regimes', 'the sign flips with the split', 'sign flips with the split',
  'changes sign depending on where the history is cut',
  'signature of noise rather than edge', 'indistinguishable from noise',
  'inverted from the textbook reading',
  'made the four-window blend worse', 'made the blended ranking worse',
  'too weak in the later half',
  'cannot be honestly backtested', 'a weight this process cannot honestly validate is not shipped',
  'no consistent edge in backtesting',
];
function markKeyPoints(text) {
  const raw = String(text);
  const lower = raw.toLowerCase();
  // Claim phrase ranges first (longest variants sit earlier in HL_PHRASES,
  // so "same sign in both halves" wins over its "same sign in both" prefix
  // instead of nesting a mark inside a mark), then build the output once.
  const taken = [];
  const overlaps = (a, b) => taken.some(([s, e]) => a < e && b > s);
  for (const p of HL_PHRASES) {
    const i = lower.indexOf(p);
    if (i !== -1 && !overlaps(i, i + p.length)) taken.push([i, i + p.length]);
  }
  taken.sort((a, b) => a[0] - b[0]);
  // Signed measured figures — single (+0.94) or paired (+0.94/+2.93) — only
  // in the unclaimed stretches between phrase marks.
  const nums = seg => seg.replace(/(?<![\w.])([+\-±]\d+(?:\.\d+)?%?(?:\s*\/\s*[+\-±]?\d+(?:\.\d+)?%?)?)/g,
    '<mark class="sm-hl sm-hl-num">$1</mark>');
  let out = '', pos = 0;
  for (const [s, e] of taken) {
    out += `${nums(raw.slice(pos, s))}<mark class="sm-hl">${raw.slice(s, e)}</mark>`;
    pos = e;
  }
  return out + nums(raw.slice(pos));
}

function tradeRationaleHtml(trade) {
  const weights = state.weights || {};
  const meta = state.signalMeta || {};
  const isBuy = trade.direction === 'buy';
  const sigs = (trade.signals || []).map(s => {
    const [key, d] = String(s).split(':');
    const wKey = SIG_TO_WEIGHT_KEY[key] || key;
    return { key, dir: d === '-' ? -1 : 1, wKey, w: weights[wKey] || 0, m: meta[wKey] };
  });
  if (!sigs.length && state.threshold == null) return '';

  const scored = sigs.filter(s => s.w !== 0);
  const unscored = sigs.filter(s => s.w === 0);

  // Weight column: honest about the two scaled signals (their day-of points
  // depend on the data, capped at the weight) and about Minervini, whose
  // recorded direction is the SCORED direction, not the structure's.
  const weightCell = s => {
    if (s.key === 'seasonality' || s.key === 'valuation') return `scaled, up to ±${Math.abs(s.w)}`;
    if (s.key === 'minervini') return signed(s.w);
    return signed(s.dir * s.w);
  };
  const weightCls = s => {
    if (s.key === 'minervini') return posneg(s.w);
    if (s.key === 'seasonality' || s.key === 'valuation') return posneg(s.dir);
    return posneg(s.dir * s.w);
  };

  const sigRow = s => {
    const label = signalLabel(s.key);
    const read = s.dir > 0 ? 'Bullish' : 'Bearish';
    const observed = s.m ? s.m.measures : '';
    const extra = s.w !== 0
      ? (s.m && s.m.edge ? `<div class="sm-sig-note">Validated edge: <mark class="sm-hl sm-hl-num">${signed(s.m.edge.early)} / ${signed(s.m.edge.late)}</mark> excess forward return in the earlier / later half of history — <mark class="sm-hl">same sign in both</mark>, which is what earned it a weight.</div>` : '')
      : (s.m ? `<div class="sm-sig-note">${markKeyPoints(shortVerdict(s.m.verdict))}</div>` : '');
    return `
      <tr class="${s.w !== 0 ? '' : 'sm-sig-unscored'}">
        <td><span class="an-dot ${s.w !== 0 ? (s.dir > 0 ? 'an-dot-bull' : 'an-dot-bear') : 'an-dot-neu'}"></span>${label}</td>
        <td>${read}</td>
        <td class="sm-mono ${s.w !== 0 ? weightCls(s) : ''}">${s.w !== 0 ? weightCell(s) : 'not scored'}</td>
        <td class="sm-ens-why">${observed}${extra}</td>
      </tr>`;
  };

  const name = (state.names || {})[trade.code];
  const stopPct = trade.stoploss != null ? ((Math.abs(trade.stoploss - trade.entry) / trade.entry) * 100).toFixed(1) : null;
  const targetPct = trade.target != null ? ((Math.abs(trade.target - trade.entry) / trade.entry) * 100).toFixed(1) : null;
  const maxHold = (state.backtest && state.backtest.maxHoldBars) || 60;
  const outcome = displayOutcome(trade);
  const outcomeSentence = {
    target: `the target was reached on ${trade.exitDate} at ৳${trade.exitPrice}, after ${trade.barsHeld} bar${trade.barsHeld === 1 ? '' : 's'}, for ${signed(trade.pnlPct, '%')}`,
    breakeven: `a ratcheted stop closed it on ${trade.exitDate} at ৳${trade.exitPrice} — at or above entry (${signed(trade.pnlPct, '%')}), so no capital was lost`,
    stoploss: `the stoploss was hit on ${trade.exitDate} at ৳${trade.exitPrice}, after ${trade.barsHeld} bar${trade.barsHeld === 1 ? '' : 's'}, for ${signed(trade.pnlPct, '%')}`,
    expired: `neither level was reached within ${maxHold} bars, so it expired on ${trade.exitDate} at ৳${trade.exitPrice} (${signed(trade.pnlPct, '%')})`,
    open: 'the trade is still open — neither the target nor the stop has been reached yet',
    stale: 'the suggestion went stale before it could resolve',
  }[outcome];

  return `
    <div class="sm-panel sm-why-panel">
      <div class="sm-panel-title">Why this entry was taken</div>

      <div class="an-h3">The trigger</div>
      <p class="an-note">On ${trade.date}, ${sigs.length} of the model's detectors fired on ${trade.code}${name ? ` (${name})` : ''} —
        ${scored.length} carrying validated weight${unscored.length ? `, ${unscored.length} detected for context only` : ''}.
        Their weighted sum came to <strong class="${posneg(trade.score)}">${signed(trade.score)}</strong>, which
        <mark class="sm-hl">${state.threshold != null ? `cleared the ±${state.threshold} conviction threshold` : 'cleared the conviction threshold'}</mark>
        on the ${isBuy ? 'bullish' : 'bearish'} side — computed with no discretion and no reading of the chart by eye.
        The model issued its "${trade.label || (isBuy ? 'Buy' : 'Sell')}" and the simulated entry filled at that day's close of ৳${trade.entry}.</p>

      <!-- Filled in by loadGateChecks() once the engine has re-scored this bar;
           stays empty if the request fails, since it explains the decision
           rather than being part of it. -->
      <div id="sm-gate-checks"></div>

      <div class="an-h3">The evidence, signal by signal</div>
      <div class="sm-tablewrap">
        <table class="sm-table sm-ens-table">
          <thead><tr><th>Signal</th><th>Read</th><th>Weight</th><th>What it observed, and why it counts</th></tr></thead>
          <tbody>
            ${scored.map(sigRow).join('')}
            ${unscored.map(sigRow).join('')}
          </tbody>
        </table>
      </div>
      ${unscored.length ? `<p class="sm-note sm-note-muted">Greyed rows fired on the day but carry no weight —
        each failed the model's cross-regime validation (or, for DDM valuation, cannot be honestly backtested),
        so they are shown as context and contribute nothing to the score.</p>` : ''}

      <div class="an-h3">The plan built at entry</div>
      <ul class="sm-chart-caption-list">
        <li><strong>Entry ৳${trade.entry}</strong> — the signal day's closing price. Backtests fill at this same close, so what you see here is what the model was actually graded on.</li>
        ${trade.stoploss != null ? `<li><strong>Stop ৳${trade.stoploss}</strong> (${stopPct}% ${isBuy ? 'below' : 'above'} entry) — placed at the nearest ${isBuy ? 'support' : 'resistance'} cluster ${isBuy ? 'below' : 'above'} price, falling back to an ATR(14)-scaled distance when no usable level sits nearby, and hard-capped so a single trade can never risk more than the plan allows.</li>` : ''}
        ${trade.target != null ? `<li><strong>Target ৳${trade.target}</strong> (${targetPct}% away) — the nearest opposing ${isBuy ? 'resistance' : 'support'} level when one offers enough reward, otherwise a fixed reward:risk projection${trade.riskReward != null ? `; either way this plan works out to <strong>1:${trade.riskReward}</strong>` : ''}.</li>` : ''}
        <li><strong>Exit rule</strong> — hold until the target or the stop is touched, or expire after ${maxHold} bars. One open simulated trade per stock at a time, so a single move is never double-counted.</li>
      </ul>
      ${outcomeSentence ? `<p class="an-note"><strong>How it ended:</strong> ${outcomeSentence}.</p>` : ''}
    </div>`;
}

// The gates the entry bar had to clear, as reported by the engine itself
// (/api/super-model/trade-checks -> describeGates). Deliberately NOT computed
// here: a second implementation in the browser is exactly how a page starts
// telling a different story from the model it describes.
function gateChecksHtml(checks) {
  if (!checks || !checks.length) return '';
  const blocking = checks.filter(c => c.pass !== null).length;
  const icon = c => (c.pass === true ? '<span class="sm-gate-ok">✓</span>'
    : c.pass === false ? '<span class="sm-gate-no">✕</span>'
    : '<span class="sm-gate-na">–</span>');
  return `
    <div class="an-h3">What the entry bar had to clear</div>
    <p class="an-note">Clearing the conviction threshold is necessary, not sufficient. Under this variant's plan
      <mark class="sm-hl">${blocking} structural read${blocking === 1 ? '' : 's'} of the entry candle and the price action around it</mark>
      also had to pass before a trade could be planned. Any single failure and the model would have stood aside,
      whatever the score said.</p>
    <div class="sm-tablewrap">
      <table class="sm-table sm-gate-table">
        <thead><tr><th></th><th>Check</th><th>What this bar measured</th><th>What the rule required</th></tr></thead>
        <tbody>
          ${checks.map(c => `
            <tr class="${c.pass === false ? 'sm-gate-row-fail' : c.pass === null ? 'sm-gate-row-na' : ''}">
              <td class="sm-gate-icon">${icon(c)}</td>
              <td>${c.label}</td>
              <td class="sm-mono">${c.measured != null ? c.measured : '—'}</td>
              <td class="sm-gate-rule">${c.rule != null ? c.rule : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${checks.some(c => c.pass === null) ? `<p class="an-note sm-gate-foot">A “–” marks a check that was active but had
      nothing measurable to read on this bar — a single-price day leaves no wick, and the first bar of a file has no
      prior volume to beat. Those cannot block a trade; see <code>zeroRangeFailsWickFloor</code> for the one case
      where that choice is configurable.</p>` : ''}`;
}

async function loadGateChecks(trade) {
  const host = document.getElementById('sm-gate-checks');
  if (!host) return;
  try {
    const p = new URLSearchParams({ code: trade.code, date: trade.date, direction: trade.direction });
    // Which plan gated this trade depends on which book the row came from.
    // Live suggestions carry no backtest plan, so they fall through to the
    // shipped default.
    if (tradeView.kind === 'bt' && tradeView.range && tradeView.range !== 'full') p.set('range', tradeView.range);
    const res = await fetch(`${API}/api/super-model/trade-checks?${p}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    host.innerHTML = gateChecksHtml(d.checks);
  } catch (err) {
    // Explanatory, not load-bearing — a failure here must not blank the modal.
    console.error('[super-model] gate checks unavailable:', err);
    host.innerHTML = '';
  }
}

window.openTradeChartModal = function (trade) {
  const modal = document.getElementById('sm-trade-chart-modal');
  const body = document.getElementById('sm-trade-chart-body');
  const outcome = displayOutcome(trade);
  document.getElementById('sm-trade-chart-title').textContent =
    `${trade.code} — ${trade.direction === 'buy' ? 'Buy' : 'Sell'} · ${trade.date}`;

  body.innerHTML = `
    <div class="sm-chart-summary">
      <span>Score <strong class="${posneg(trade.score)}">${signed(trade.score)}</strong></span>
      <span>Entry <strong>${num(trade.entry)}</strong></span>
      <span>Stop <strong class="sm-neg">${num(trade.stoploss)}</strong></span>
      <span>Target <strong class="sm-pos">${num(trade.target)}</strong></span>
      <span>R:R <strong>${trade.riskReward != null ? `1:${trade.riskReward}` : '—'}</strong></span>
      <span>Outcome <strong class="${OUTCOME_CLS[outcome] || ''}">${outcome}</strong></span>
      <span>Exit <strong>${trade.exitPrice != null ? num(trade.exitPrice) : '—'}</strong>${trade.exitDate ? ` (${trade.exitDate})` : ''}</span>
      <span>Bars held <strong>${num(trade.barsHeld)}</strong></span>
      <span>P&amp;L <strong class="${posneg(trade.pnlPct)}">${signed(trade.pnlPct, '%')}</strong></span>
      <a class="sm-chart-openlink" href="${tradeChartUrl(trade)}" target="_blank" rel="noopener">Open full chart ↗</a>
    </div>
    <div class="sm-trade-chart-frame">
      <iframe src="${tradeChartUrl(trade)}" title="Candlestick chart for ${trade.code}" loading="eager"></iframe>
    </div>
    ${tradeRationaleHtml(trade)}
    <div class="sm-chart-caption">
      <div class="an-h3">How to read this chart</div>
      <ul class="sm-chart-caption-list">
        <li>The full charting page, focused on this trade — every indicator, drawing tool and timeframe works here as it does on the chart page itself.</li>
        <li>Stop/target lines are the levels planned at entry. A profit-lock ladder or trailing rule (when the plan uses one) can ratchet the real stop tighter over the trade's life without that path being drawn here.</li>
        <li>The shaded band spans entry to exit.</li>
      </ul>
    </div>`;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  loadGateChecks(trade);
};

window.closeTradeChartModal = function () {
  document.getElementById('sm-trade-chart-modal').style.display = 'none';
  // Only drop the scroll lock if the OTHER modal isn't also open — closing
  // the chart opened from inside the metric-detail browser shouldn't unlock
  // background scroll while that modal is still up.
  const infoOpen = document.getElementById('sm-info-modal').style.display !== 'none';
  if (!infoOpen) document.body.style.overflow = '';
};

// One delegated listener for every clickable metric in the evidence panel,
// so the panes can re-render freely without rebinding. That only holds if
// this itself is bound once — loadSuperModel() (the caller) re-runs after
// every backtest completion, so without this guard each run would stack
// another listener on the same never-replaced panel, firing openSuperModelInfo
// (and its trade-browser fetch) once per accumulated listener on a single click.
let evidenceDetailsWired = false;
function wireEvidenceDetails() {
  if (evidenceDetailsWired) return;
  evidenceDetailsWired = true;
  const panel = document.getElementById('sm-evidence');
  const open = el => { const k = el && el.dataset.metric; if (k) window.openSuperModelInfo(k); };
  panel.addEventListener('click', e => open(e.target.closest('[data-metric]')));
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-metric]');
    if (!el) return;
    e.preventDefault();
    open(el);
  });
}

const BT_SECTION_CFG = {
  full: {
    bodyId: 'sm-backtest-body-full',
    genCommand: 'node scripts/generate-backtest-summary.js',
    emptyEta: 'this can take 15-20 minutes',
  },
  '2y': {
    bodyId: 'sm-backtest-body-2y',
    genCommand: 'node scripts/generate-backtest-summary-2y.js',
    emptyEta: 'a single-pass run, usually just a few minutes',
  },
  capped: {
    bodyId: 'sm-backtest-body-capped',
    genCommand: 'node scripts/generate-backtest-summary-2y-capped.js',
    emptyEta: 'a single-pass run, usually just a few minutes',
  },
  cappedPct: {
    bodyId: 'sm-backtest-body-capped-pct',
    genCommand: 'node scripts/generate-backtest-summary-2y-capped-pct.js',
    emptyEta: 'a single-pass run, usually just a few minutes',
  },
  explorer: {
    bodyId: 'sm-backtest-body-explorer',
    genCommand: 'node scripts/generate-backtest-summary-2y-explorer.js',
    emptyEta: 'a single-pass run, usually just a few minutes',
  },
  range: {
    bodyId: 'sm-backtest-body-range',
    genCommand: 'node scripts/generate-backtest-summary-range.js --from YYYY/MM/DD --to YYYY/MM/DD',
    emptyEta: 'a single-pass run, usually just a few minutes',
  },
};

// Renders one of the two independent backtest write-ups (full history /
// last 2 years) into its own container, keyed off state.backtest or
// state.backtest2y (see btDataFor). Metric keys carry the range
// ("bt:2y:buy:n") so a tile always opens the detail/trade-browser for the
// dataset it was actually drawn from — see metricDetail().
function renderBacktestSection(range) {
  const cfg = BT_SECTION_CFG[range];
  const el = document.getElementById(cfg.bodyId);
  if (!el) return;
  const b = btDataFor(range);
  const K = (side, field) => `bt:${range}:${side}:${field}`;

  if (!b || !b.overall) {
    el.innerHTML = `<p class="sm-note">No backtest summary available yet. Click "Run backtest" above
      (${cfg.emptyEta}), or generate it with <code>${cfg.genCommand}</code>.</p>`;
    return;
  }

  // The custom-range view can hold ANY variant over ANY bounds — say which,
  // or its numbers read as whatever the reader last assumed.
  const requestedLine = b.requestedRange
    ? `<p class="sm-note"><strong>Last run:</strong> ${b.requestedRange.label ||
        `${b.requestedRange.variantLabel || 'Shipped model'} over ${b.requestedRange.from || 'start'} to ${b.requestedRange.to || 'latest'}`}</p>`
    : '';

  const hasWindows = (b.perWindow || []).length > 0;
  const rows = (b.perWindow || []).map((w, i) => `
    <tr class="sm-row-clickable ${w.representative === false ? 'sm-row-thin' : ''}" data-metric="win:${i}" tabindex="0" role="button">
      <td>${w.window}${w.representative === false ? ' <span class="sm-warn">thin</span>' : ''}</td>
      <td class="sm-mono">${num(w.stocks)}</td>
      <td class="sm-mono">${num(w.baseline20d, '%')}</td>
      <td class="sm-mono ${posneg(w.rankEdge)}">${signed(w.rankEdge)}</td>
      <td class="sm-mono">${num(w.trades)}</td>
      <td class="sm-mono ${posneg(w.avgPnl)}">${signed(w.avgPnl, '%')}</td>
    </tr>`).join('');

  // Boundary choice can flatter a model, so the per-period distribution is
  // shown alongside the partition rather than instead of it. Empty for the
  // 2-year run (no buckets computed — see generate-backtest-summary-2y.js).
  const es = b.edgeSummary;
  const periodBars = (b.edgeByPeriod || []).filter(p => p.representative && p.rankEdge != null);
  const maxAbs = Math.max(1, ...periodBars.map(p => Math.abs(p.rankEdge)));
  const periodHtml = periodBars.length ? `
    <h4>Ranking edge by period</h4>
    <p class="sm-note">Each bar is one two-month stretch: how much the top-scoring 10% beat the market.
      ${es ? `Positive in <strong>${es.positive} of ${es.periodsMeasured}</strong> periods —
      median ${signed(es.median)}, ranging ${signed(es.min)} to ${signed(es.max)}.` : ''}</p>
    <div class="sm-periods">${periodBars.map(p => `
      <div class="sm-period" title="${p.period}: ${signed(p.rankEdge)} (${p.trades} trades, ${p.stocks} stocks)">
        <div class="sm-period-track">
          <div class="sm-period-bar ${p.rankEdge > 0 ? 'sm-period-bar--pos' : 'sm-period-bar--neg'}"
               style="height:${Math.max(3, (Math.abs(p.rankEdge) / maxAbs) * 50)}%"></div>
        </div>
        <span class="sm-period-val ${posneg(p.rankEdge)}">${signed(p.rankEdge)}</span>
        <span class="sm-period-lbl">${p.period.replace('20', '')}</span>
      </div>`).join('')}</div>
    <p class="sm-note sm-note-muted">A model that ranked reliably would be positive in most periods.
      This one is close to even, with a single strong period carrying much of the full-sample average.</p>` : '';

  const cov = b.coverage;
  // "All simulated" must read the true buy+sell blend. Newer summaries carry
  // it as `blended`; in older ones `overall` was itself the blend, so that is
  // the correct fallback. (In newer ones `overall` is the Buy-side headline,
  // which is why reading it here showed Buy figures under a blended label.)
  const bAll = b.blended || b.overall;
  el.innerHTML = `
    ${requestedLine}
    <p class="sm-note">Simulated over ${num(b.stocks)} stocks, holding at most ${num(b.maxHoldBars)} bars,
      covering ${num(b.periodFrom)} to ${num(b.periodTo)}. These are <strong>historical simulations</strong>, not real trades.
      ${cov ? ` The full universe only begins around ${num(cov.universeStart)} — ${num(cov.preUniverseTrades)} trades
        predate that and come from just ${num(cov.preUniverseStocks)} stocks.` : ''}</p>
    <p class="sm-hint">Tap any figure below for what it measures and how it was calculated.</p>
    <h4>Buy side</h4>
    <p class="sm-note sm-note-muted">DSE has no real short-selling, so this is the only side of the model you could actually trade. "Net" subtracts a ${num(b.buy && b.buy.costPct)}% round-trip commission.</p>
    ${statBlock([
      ['Trades', num(b.buy && b.buy.n), '', K('buy', 'n')],
      ['Hit target', num(b.buy && b.buy.targetPct, '%'), 'sm-pos', K('buy', 'target')],
      ['Stopped (loss)', num(b.buy && b.buy.lossStopPct, '%'), 'sm-neg', K('buy', 'stop')],
      ['Breakeven', num(b.buy && b.buy.breakevenPct, '%'), '', K('buy', 'breakeven')],
      ['Expired', num(b.buy && b.buy.expiredPct, '%'), '', K('buy', 'expired')],
      ['Avg P&amp;L (net)', signed(b.buy && b.buy.avgPnlNet, '%'), posneg(b.buy && b.buy.avgPnlNet), K('buy', 'pnlNet'), 'sm-statcell--hero'],
      ['Avg P&amp;L (gross)', signed(b.buy && b.buy.avgPnl, '%'), posneg(b.buy && b.buy.avgPnl), K('buy', 'pnl')],
      ['Avg days held', num(b.buy && b.buy.avgBarsHeld), '', K('buy', 'days')],
    ])}
    <h4>All simulated (buy + sell)</h4>
    <p class="sm-note sm-note-muted">Blended figure, kept for reference only — it mixes the tradeable Buy side above with a short position DSE does not support (see Limitations below).</p>
    ${statBlock([
      ['Simulated trades', num(bAll.n), '', K('all', 'n')],
      ['Hit target', num(bAll.targetPct, '%'), 'sm-pos', K('all', 'target')],
      ['Stopped (loss)', num(bAll.lossStopPct, '%'), 'sm-neg', K('all', 'stop')],
      ['Breakeven', num(bAll.breakevenPct, '%'), '', K('all', 'breakeven')],
      ['Expired', num(bAll.expiredPct, '%'), '', K('all', 'expired')],
      ['Avg P&amp;L (net)', signed(bAll.avgPnlNet, '%'), posneg(bAll.avgPnlNet), K('all', 'pnlNet'), 'sm-statcell--hero'],
      ['Avg P&amp;L (gross)', signed(bAll.avgPnl, '%'), posneg(bAll.avgPnl), K('all', 'pnl')],
      ['Avg days held', num(bAll.avgBarsHeld), '', K('all', 'days')],
    ])}
    <h4>Sell side <span class="sm-warn">underperformed, not executable on DSE</span></h4>
    ${statBlock([
      ['Trades', num(b.sell && b.sell.n), '', K('sell', 'n')],
      ['Hit target', num(b.sell && b.sell.targetPct, '%'), 'sm-pos', K('sell', 'target')],
      ['Stopped (loss)', num(b.sell && b.sell.lossStopPct, '%'), 'sm-neg', K('sell', 'stop')],
      ['Breakeven', num(b.sell && b.sell.breakevenPct, '%'), '', K('sell', 'breakeven')],
      ['Expired', num(b.sell && b.sell.expiredPct, '%'), '', K('sell', 'expired')],
      ['Avg P&amp;L (net)', signed(b.sell && b.sell.avgPnlNet, '%'), posneg(b.sell && b.sell.avgPnlNet), K('sell', 'pnlNet'), 'sm-statcell--hero'],
      ['Avg P&amp;L (gross)', signed(b.sell && b.sell.avgPnl, '%'), posneg(b.sell && b.sell.avgPnl), K('sell', 'pnl')],
      ['Avg days held', num(b.sell && b.sell.avgBarsHeld), '', K('sell', 'days')],
    ])}
    ${(periodHtml || hasWindows) ? `
    <details class="sm-acc">
      <summary>Robustness breakdown${hasWindows && periodBars.length ? ' — per period &amp; per window' : periodBars.length ? ' — per period' : ' — per window'}</summary>
      ${periodHtml}
      ${hasWindows ? `
      <h4>Per test window</h4>
      <div class="sm-tablewrap"><table class="sm-table">
        <thead><tr><th>Window</th><th>Stocks</th><th>Market 20d</th><th>Rank edge</th><th>Trades</th><th>Avg P&amp;L</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="sm-note sm-note-muted">"Rank edge" is how much the top-scoring 10% of stock-days beat the market
        average over the next 20 bars. A window marked <span class="sm-warn">thin</span> covers too few stocks to
        say anything about the market and is excluded from the period counts above.</p>` : ''}
    </details>` : ''}
    <details class="sm-acc" id="sm-sector-acc-${range}">
      <summary>By sector</summary>
      <div id="sm-sector-body-${range}"><p class="sm-note sm-note-muted">Loading…</p></div>
    </details>
    <details class="sm-acc">
      <summary>Limitations (${(b.caveats || []).length})</summary>
      <ul class="sm-caveats">${(b.caveats || []).map(c => `<li>${c}</li>`).join('')}</ul>
    </details>`;

  // Sector aggregates are fetched lazily on first open — five write-ups
  // eagerly fetching five variants' worth of grouping on page load would
  // be wasted work for an accordion most visits never expand.
  const acc = document.getElementById(`sm-sector-acc-${range}`);
  if (acc) acc.addEventListener('toggle', () => {
    if (acc.open && !acc.dataset.loaded) {
      acc.dataset.loaded = '1';
      renderSectorBreakdown(range);
    }
  });
}

// Sort state persists per range (switching variant tabs shouldn't reset a
// sort you just set on another one) but not across page loads — a fresh
// visit always starts on the same "biggest edge first" ordering the table
// shipped with.
const sectorSort = {};

// One row per sector, same shape as the chat-style summary: how broadly
// the variant's result holds up across the market rather than riding a
// single sector. Net P&L is the headline; gross rides in the hover title.
// Columns are click-to-sort; the ALL row always stays pinned at the top
// since it's a total, not a data point to rank among the sectors.
async function renderSectorBreakdown(range) {
  const el = document.getElementById(`sm-sector-body-${range}`);
  if (!el) return;
  let data;
  try {
    const res = await fetch(`${API}/api/super-model/trades/by-sector?range=${range}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    el.innerHTML = `<p class="sm-note sm-neg">Could not load the sector breakdown (${err.message}).</p>`;
    return;
  }
  const hasLocks = (data.sectors || []).some(s => s.lockedPct > 0);
  const COLS = [
    { key: 'sector', label: 'Sector', get: s => s.sector, type: 'text' },
    { key: 'n', label: 'Trades', get: s => s.n, type: 'num' },
    { key: 'stocks', label: 'Stocks', get: s => s.stocks, type: 'num' },
    { key: 'col3', label: hasLocks ? 'Locked' : 'Target', get: s => hasLocks ? s.lockedPct : s.targetPct, type: 'num' },
    { key: 'lossStopPct', label: hasLocks ? 'Loss stop' : 'Stopped', get: s => s.lossStopPct, type: 'num' },
    { key: 'winRate', label: 'Win', get: s => s.winRate, type: 'num' },
    { key: 'avgPnlNet', label: 'Avg P&L (net)', get: s => s.avgPnlNet, type: 'num' },
  ];
  if (!sectorSort[range]) sectorSort[range] = { key: 'avgPnlNet', dir: 'desc' };

  const row = (s, label, cls = '') => `
    <tr class="${cls}">
      <td>${label}</td>
      <td class="sm-mono">${num(s.n)}</td>
      <td class="sm-mono">${num(s.stocks)}</td>
      ${hasLocks
        ? `<td class="sm-mono sm-pos">${num(s.lockedPct, '%')}</td>
           <td class="sm-mono sm-neg">${num(s.lossStopPct, '%')}</td>`
        : `<td class="sm-mono sm-pos">${num(s.targetPct, '%')}</td>
           <td class="sm-mono sm-neg">${num(s.lossStopPct, '%')}</td>`}
      <td class="sm-mono">${num(s.winRate, '%')}</td>
      <td class="sm-mono ${posneg(s.avgPnlNet)}" title="gross ${signed(s.avgPnl, '%')}">${signed(s.avgPnlNet, '%')}</td>
    </tr>`;

  const draw = () => {
    const { key, dir } = sectorSort[range];
    const col = COLS.find(c => c.key === key);
    const sorted = [...(data.sectors || [])].sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const cmp = col.type === 'text' ? String(va).localeCompare(String(vb)) : (va - vb);
      return dir === 'asc' ? cmp : -cmp;
    });
    const arrow = c => c.key !== key ? '' : dir === 'asc' ? ' ▲' : ' ▼';
    el.innerHTML = `
      <div class="sm-tablewrap"><table class="sm-table">
        <thead><tr>${COLS.map(c =>
          `<th class="sm-sortable${c.key === key ? ' sm-sorted' : ''}" data-sort-key="${c.key}" tabindex="0" role="button"
            aria-label="Sort by ${c.label}">${c.label}${arrow(c)}</th>`).join('')}</tr></thead>
        <tbody>
          ${row(data.overall, 'ALL', 'sm-row-total')}
          ${sorted.map(s => row(s, s.sector)).join('')}
        </tbody>
      </table></div>
      <p class="sm-note sm-note-muted">Net subtracts the ${num(data.costPct, '%')} round-trip commission — hover a
        P&amp;L for the gross figure. Treat extreme sector averages with care: the theoretical Sell side can post
        outsized percentage losses on very low-priced stocks, which drags a small sector's whole average.</p>`;
    el.querySelectorAll('th.sm-sortable').forEach(th => {
      const sortByThis = () => {
        const k = th.dataset.sortKey;
        const cur = sectorSort[range];
        if (cur.key === k) cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
        else sectorSort[range] = { key: k, dir: COLS.find(c => c.key === k).type === 'text' ? 'asc' : 'desc' };
        draw();
      };
      th.addEventListener('click', sortByThis);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortByThis(); } });
    });
  };
  draw();
}

// One row per backtest variant, using the same state objects the write-ups
// render from. `range` keys into btDataFor; `bt` is the switcher/section id
// suffix (they differ for cappedPct, which predates the naming cleanup).
const BT_VARIANTS = [
  { range: 'full', bt: 'full', label: 'Full history', rejected: false },
  { range: '2y', bt: '2y', label: 'Last 2 years', rejected: false },
  { range: 'capped', bt: 'capped', label: 'Capped 1:2.5', rejected: true },
  { range: 'cappedPct', bt: 'capped-pct', label: 'Capped 12%', rejected: true },
  // Rejected once the simulation enforced real DSE mechanics (T+2/T+3
  // settlement, gapped stops fill at the open) — then un-rejected when the
  // momentum floor took the BUY book net-positive after commission in all
  // four validation windows with those same mechanics enforced. Flagged
  // clear on the tradeable side, per this page's convention of headlining
  // buys; the blended figure is still negative because the sell book is
  // untouched and unreachable. See the variant's info modal for the story.
  { range: 'explorer', bt: 'explorer', label: 'Explorer', rejected: false },
  { range: 'range', bt: 'range', label: 'Custom range', rejected: false },
];

// The comparison table is what actually replaces scrolling: the whole
// "would this variant have helped?" story in five rows, above the switcher.
// Net P&L is the headline (consistent with the site treating commission as
// decisive); gross rides along in the hover title.
function renderBtComparison() {
  const el = document.getElementById('sm-bt-compare');
  if (!el) return;
  const rows = BT_VARIANTS.map(v => {
    const b = btDataFor(v.range);
    const s = b && b.overall;
    if (!s) {
      return `<tr class="sm-row-clickable" data-bt="${v.bt}" tabindex="0" role="button">
        <td>${v.rejected ? '<span class="sm-reject-dot"></span>' : ''}${v.label}</td>
        <td class="sm-mono" colspan="4">not generated yet</td>
        <td></td></tr>`;
    }
    return `<tr class="sm-row-clickable" data-bt="${v.bt}" tabindex="0" role="button">
      <td>${v.rejected ? '<span class="sm-reject-dot"></span>' : ''}${v.label}</td>
      <td class="sm-mono">${num(s.n)}</td>
      <td class="sm-mono sm-pos">${num(s.targetPct, '%')}</td>
      <td class="sm-mono sm-neg">${num(s.stopPct, '%')}</td>
      <td class="sm-mono ${posneg(s.avgPnlNet)}" title="gross ${signed(s.avgPnl, '%')}">${signed(s.avgPnlNet, '%')}</td>
      <td>${v.rejected ? '<span class="sm-warn">rejected</span>' : ''}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `
    <h4 class="sm-compare-title">Model comparison</h4>
    <div class="sm-tablewrap"><table class="sm-table sm-compare-table">
      <thead><tr><th>Variant</th><th>Trades</th><th>Target</th><th>Stop</th><th>Avg P&amp;L (net)</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="sm-note sm-note-muted">All simulated trades (buy + sell), net of a round-trip commission —
      hover a P&amp;L for the gross figure. Click a row for that variant's full write-up below.</p>`;
  el.querySelectorAll('tr[data-bt]').forEach(tr => {
    const open = () => {
      const btn = document.querySelector(`.sm-bt-tab[data-bt="${tr.dataset.bt}"]`);
      if (btn) window.smShowBtSection(btn);
    };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

function renderBacktestPane() {
  renderBtComparison();
  renderBacktestSection('full');
  renderBacktestSection('2y');
  renderBacktestSection('capped');
  renderBacktestSection('cappedPct');
  renderBacktestSection('explorer');
  renderBacktestSection('range');
}

// Direction/date-range/last-N narrowing for the summary stat tiles — kept
// separate from `tradeView` (the trade-browser modal's own filters), since
// this drives the pane's stat block, not a paginated row list.
const liveFilters = { side: 'all', from: '', to: '', lastN: '' };
const liveFiltersActive = () => !!(liveFilters.side !== 'all' || liveFilters.from || liveFilters.to || liveFilters.lastN);

function renderLivePane() {
  const el = document.getElementById('sm-pane-live');
  const t = state.tracking;
  if (!t || !t.total) {
    el.innerHTML = `<p class="sm-note">No suggestions tracked yet. Every suggestion shown on this page is recorded
      and checked against later prices — this fills in as time passes.</p>`;
    return;
  }
  el.innerHTML = `
    <p class="sm-note">Real forward record of suggestions this page has issued, resolved against actual prices.
      Unlike the backtest, nothing here was chosen with hindsight.</p>
    <p class="sm-hint">Tap any figure below for what it measures and how it was calculated.</p>
    <div class="sm-filter-bar">
      <div class="sm-seg" id="sm-live-side">
        ${[['all', 'All'], ['buy', 'Long'], ['sell', 'Short']].map(([v, l]) =>
          `<button type="button" class="sm-seg-btn ${liveFilters.side === v ? 'active' : ''}" data-side="${v}">${l}</button>`).join('')}
      </div>
      <label class="sm-filter-label">From
        <input type="date" id="sm-live-from" class="sm-filter-search sm-date-input" value="${slashToDash(liveFilters.from)}" />
      </label>
      <label class="sm-filter-label">To
        <input type="date" id="sm-live-to" class="sm-filter-search sm-date-input" value="${slashToDash(liveFilters.to)}" />
      </label>
      <div class="filter-select-wrap">
        <select id="sm-live-lastn">
          ${[['', 'All trades'], ['25', 'Last 25'], ['50', 'Last 50'], ['100', 'Last 100'], ['200', 'Last 200']]
            .map(([v, l]) => `<option value="${v}" ${liveFilters.lastN === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <button type="button" id="sm-live-filter-clear" class="sm-filter-clear">Clear filters</button>
    </div>
    <div id="sm-live-stats"></div>`;

  el.querySelector('#sm-live-side').addEventListener('click', e => {
    const b = e.target.closest('.sm-seg-btn'); if (!b) return;
    b.parentElement.querySelectorAll('.sm-seg-btn').forEach(x => x.classList.toggle('active', x === b));
    liveFilters.side = b.dataset.side; renderLiveStatsBlock();
  });
  el.querySelector('#sm-live-from').addEventListener('change', e => {
    liveFilters.from = dashToSlash(e.target.value); renderLiveStatsBlock();
  });
  el.querySelector('#sm-live-to').addEventListener('change', e => {
    liveFilters.to = dashToSlash(e.target.value); renderLiveStatsBlock();
  });
  el.querySelector('#sm-live-lastn').addEventListener('change', e => {
    liveFilters.lastN = e.target.value; renderLiveStatsBlock();
  });
  el.querySelector('#sm-live-filter-clear').addEventListener('click', () => {
    Object.assign(liveFilters, { side: 'all', from: '', to: '', lastN: '' });
    renderLivePane(); // simplest way to reset every control's own displayed state
  });

  renderLiveStatsBlock();
}

async function renderLiveStatsBlock() {
  const target = document.getElementById('sm-live-stats');
  if (!target) return;
  const t = state.tracking;
  const active = liveFiltersActive();

  // Unfiltered: the server's own aggregate, no extra fetch needed — matches
  // the page's pre-filter behaviour exactly.
  let s;
  if (!active) {
    s = {
      total: t.total, open: t.open, closed: t.closed, target: t.target, stoploss: t.stoploss,
      targetRate: t.targetRate, stoplossRate: t.stoplossRate, winRate: t.winRate,
      avgPnlPct: t.avgPnlPct, avgDaysToTarget: t.avgDaysToTarget, avgDaysToStoploss: t.avgDaysToStoploss,
    };
  } else {
    target.innerHTML = '<p class="sm-note sm-note-muted">Loading…</p>';
    let all;
    try {
      all = await loadLiveTrades();
    } catch (err) {
      target.innerHTML = `<p class="sm-neg">Could not load the tracked suggestion list (${err.message}).</p>`;
      return;
    }
    s = summariseLiveForPane(filterLiveByRange(all, liveFilters));
  }

  if (!s.total) {
    target.innerHTML = '<p class="sm-note sm-note-muted">No tracked suggestions match these filters.</p>';
    return;
  }
  const pending = s.closed === 0;
  // Tiles stay clickable whether or not a filter is active — metricDetail()
  // re-reads liveFilters itself and carries the same filter into the trade
  // browser it opens (see mountTradeBrowser), so the detail always matches
  // what the tile shows.
  const metric = key => key;
  target.innerHTML = `
    ${statBlock([
      ['Tracked', num(s.total), '', metric('live:total')],
      ['Still open', num(s.open), '', metric('live:open')],
      ['Resolved', num(s.closed), '', metric('live:closed')],
      ['Hit target', num(s.target), 'sm-pos', metric('live:target')],
      ['Hit stoploss', num(s.stoploss), 'sm-neg', metric('live:stoploss')],
    ])}
    ${pending ? `<p class="sm-note sm-note-muted">All ${s.open} suggestions are still open — none has had time to reach
        its target or stoploss yet. Outcome rates and timings appear here once they resolve.</p>`
      : statBlock([
        ['Target rate', num(s.targetRate, '%'), 'sm-pos', metric('live:targetRate')],
        ['Stoploss rate', num(s.stoplossRate, '%'), 'sm-neg', metric('live:stoplossRate')],
        ['Profitable', num(s.winRate, '%'), '', metric('live:winRate')],
        ['Avg P&amp;L', signed(s.avgPnlPct, '%'), posneg(s.avgPnlPct), metric('live:pnl')],
        ['Avg days to target', num(s.avgDaysToTarget), '', metric('live:daysTarget')],
        ['Avg days to stoploss', num(s.avgDaysToStoploss), '', metric('live:daysStop')],
      ])}`;
}

function renderModelPane() {
  const el = document.getElementById('sm-pane-model');
  const w = state.weights || {};
  // Labels and rationale come from the API alongside the weights themselves,
  // so the explanation can't drift from the number it explains.
  const meta = state.signalMeta || {};
  const keys = Object.keys(meta);
  if (!keys.length) { el.innerHTML = '<p class="sm-note">Signal detail unavailable.</p>'; return; }

  const entries = keys.map(k => ({ k, w: w[k] || 0 }));
  const scored = entries.filter(e => e.w !== 0).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const unscored = entries.filter(e => e.w === 0);
  const row = e => `
    <li class="sm-row-clickable" data-metric="sig:${e.k}" tabindex="0" role="button">
      <span class="sm-wname">${meta[e.k].label}</span>
      <span class="sm-wval ${posneg(e.w)}">${e.w === 0 ? '0' : signed(e.w)}</span>
      <span class="sm-wwhy">${meta[e.k].verdict}</span>
    </li>`;

  el.innerHTML = `
    <p class="sm-note">Signals are only scored if they showed a consistent edge across independent slices of
      history. The rest are still detected and shown on each suggestion, but contribute nothing to the score.</p>
    <p class="sm-hint">Tap any signal for what it measures and the numbers behind its weight.</p>
    <h4>Scored</h4>
    <ul class="sm-weightlist">${scored.map(row).join('')}</ul>
    <h4>Detected but not scored</h4>
    <ul class="sm-weightlist sm-weightlist--muted">${unscored.map(row).join('')}</ul>`;
}

window.smShowPane = function (btn) {
  document.querySelectorAll('.sm-tab').forEach(b => b.classList.toggle('active', b === btn));
  const target = btn.dataset.pane;
  document.querySelectorAll('.sm-pane').forEach(p =>
    p.classList.toggle('active', p.id === `sm-pane-${target}`));
};

// The Backtest pane's own inner switcher — one write-up visible at a time
// (five stacked sections made the page unscrollably long). Deliberately a
// separate class from .sm-tab: smShowPane toggles EVERY .sm-tab, so sharing
// the class would clear this switcher's active state on outer tab changes.
window.smShowBtSection = function (btn) {
  document.querySelectorAll('.sm-bt-tab').forEach(b => b.classList.toggle('active', b === btn));
  const key = btn.dataset.bt;
  document.querySelectorAll('.sm-bt-section').forEach(s =>
    s.classList.toggle('active', s.id === `sm-bt-section-${key}`));
  if (key === 'psim') loadPortfolioSim(false);
};

// ── Portfolio simulation ───────────────────────────────────────────────────
// Lazy: the replay costs the server a couple of seconds cold, so it only
// runs when the tab is opened (and again on a slot-count change), never on
// page load.
let psimLoadedFor = null;

async function loadPortfolioSim(force) {
  const body = document.getElementById('sm-psim-body');
  if (!body) return;
  const active = document.querySelector('#sm-psim-positions .sm-seg-btn.active');
  const pos = parseInt(active ? active.dataset.pos : '10', 10);
  if (!force && psimLoadedFor === pos) return;
  body.innerHTML = '<p class="sm-note">Replaying both trade streams through a ৳1,000,000 account…</p>';
  try {
    const res = await fetch(`${API}/api/super-model/portfolio-sim?positions=${pos}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    psimLoadedFor = pos;
    renderPortfolioSim(d);
  } catch (e) {
    psimLoadedFor = null;
    body.innerHTML = `<p class="sm-note">Portfolio simulation failed: ${e.message}</p>`;
  }
}

const taka = v => (v == null ? '—' : '৳' + Math.round(v).toLocaleString('en-IN'));

function renderPortfolioSim(d) {
  const body = document.getElementById('sm-psim-body');
  const s = d.plans.shipped, x = d.plans.explorer;
  if (!s && !x) { body.innerHTML = '<p class="sm-note">No trade data on disk yet — run the 2-year backtests first.</p>'; return; }
  const cell = (v, cls = '') => `<td class="sm-mono ${cls}">${v}</td>`;
  const row = (label, fs, fx) => `<tr><td>${label}</td>${cell(...(s ? fs(s) : ['—'])) }${cell(...(x ? fx(x) : ['—']))}</tr>`;
  const both = f => [f, f];
  body.innerHTML = `
    <div class="sm-psim-chart" id="sm-psim-chart">${psimChartSvg(d)}</div>
    <div class="sm-psim-legend">
      <span class="sm-psim-key"><i style="background:#60a5fa"></i>Shipped</span>
      <span class="sm-psim-key"><i style="background:#4ade80"></i>Explorer</span>
      <span class="sm-psim-key"><i class="sm-psim-key-dash"></i>DSEX (rebased)</span>
    </div>
    <div class="sm-tablewrap"><table class="sm-table">
      <thead><tr><th></th><th>Shipped</th><th>Explorer</th></tr></thead>
      <tbody>
        ${row('Final equity', ...both(p => [taka(p.finalEquity), posneg(p.finalEquity - p.startCapital)]))}
        ${row('Total return', ...both(p => [signed(p.totalReturnPct, '%'), posneg(p.totalReturnPct)]))}
        ${row('CAGR', ...both(p => [signed(p.cagrPct, '%'), posneg(p.cagrPct)]))}
        ${row('Max drawdown', ...both(p => [num(p.maxDrawdownPct, '%'), 'sm-neg']))}
        ${row('Win rate (taken trades)', ...both(p => [num(p.winRatePct, '%')]))}
        ${row('Trades taken', ...both(p => [`${num(p.taken)} of ${num(p.signals)} signals`]))}
        ${row('Skipped — no free slot/cash', ...both(p => [num(p.skippedForCapital)]))}
        ${row('Average exposure', ...both(p => [num(p.avgExposurePct, '%')]))}
        ${row('Period', ...both(p => [`${p.periodFrom} → ${p.periodTo}`]))}
      </tbody>
    </table></div>
    ${psimReadingLine(d)}
    <details class="sm-acc">
      <summary>How the replay works</summary>
      <p class="sm-note">The simulated account starts with ${taka(d.startCapital)} and steps through every
        trading day of the 2-year window in order. Each day, three things happen in sequence:</p>
      <ol class="sm-note sm-psim-steps">
        <li><strong>Exits first.</strong> Any open position whose trade closed that day (target, stop,
          profit-lock or expiry — exactly as recorded in the backtest) is sold, and the proceeds land in
          cash immediately, so a slot freed in the morning can fund a new signal the same day. This
          mirrors how the per-stock trade slot behaves in the underlying backtest.</li>
        <li><strong>Mark to market.</strong> Every position still open is revalued at that day's actual
          close (the last known close carries through trading halts), giving the true daily equity the
          drawdown figure is measured on.</li>
        <li><strong>Entries last.</strong> Every buy signal dated that day queues up, strongest
          conviction score first. Each one is taken only if a position slot is free AND cash remains —
          sized at current equity ÷ max positions. Everything else is skipped and counted.</li>
      </ol>
      <p class="sm-note">Both sides pay 0.4% commission (0.8% per round trip — the same figure every net
        number on this page uses). Whatever is still open when the data ends is closed at its last mark,
        matching how the backtest itself treats end-of-data trades.</p>
    </details>
    <details class="sm-acc">
      <summary>How to read these numbers</summary>
      <p class="sm-note"><strong>The chart is log-scaled</strong> — equal vertical steps mean equal
        percentage moves. On a linear scale a line that tripled would visually flatten everything else;
        on a log scale a straight line means a steady compounding rate, and the gap between two lines
        reads directly as relative performance.</p>
      <p class="sm-note"><strong>"Skipped — no free slot/cash" is a feature, not an error.</strong> The
        per-trade tables above average every simulated trade, as if capital were unlimited. Here capital
        is finite, so most signals go untaken; the skipped count shows how binding the constraint was,
        and the strongest-signal-first rule means what does get taken is the model's best ideas. That
        selection is also why the win rate here can differ from the all-trades tables.</p>
      <p class="sm-note"><strong>Average exposure</strong> is how much of the account was actually
        invested on a typical day — the remainder sat in cash (commission-free but return-free). A plan
        with faster exits recycles the same cash through more trades, which is exactly the effect this
        simulation exists to price.</p>
      <p class="sm-note"><strong>Max drawdown</strong> is measured on daily marked-to-market equity, not
        just on realized exits — a paper loss mid-trade counts. It's the number that decides whether a
        strategy is livable, and it's invisible in per-trade averages.</p>
    </details>
    <details class="sm-acc">
      <summary>Limitations — why these returns are an upper bound</summary>
      <ul class="sm-note sm-psim-limits">
        <li><strong>Entry fills are optimistic:</strong> a trade "fills" at the same closing price its
          signal was computed from. Live, you'd enter at or after the next open, giving up some edge.</li>
        <li><strong>Gap risk is modeled at the open only:</strong> the underlying trades respect DSE
          settlement (no selling before T+2, or T+3 for Z-category) and fill a gapped stop at the open
          rather than the stop price — but an intraday collapse below the open still fills better than
          reality, and targets are conservatively filled at the target even when price gaps through.</li>
        <li><strong>Liquidity is assumed:</strong> fractional shares, no market impact, and full-size
          fills even in thin sub-৳1 names where a real order of this size would move the price.</li>
        <li><strong>Replay, not re-simulation:</strong> the trade stream was generated without capital
          limits, so skipping a trade here doesn't create the alternative trade the model might have
          found for that slot.</li>
        <li><strong>One path, one policy:</strong> strongest-score-first is a single, deterministic
          slot policy; different tie-breaks would produce somewhat different paths.</li>
      </ul>
      <p class="sm-note sm-note-muted">Every one of these assumptions applies identically to both plans
        and to the DSEX benchmark line's own idealization (no fees, perfect tracking). The robust
        conclusion is the comparison between the lines, not any line's absolute number.</p>
    </details>`;
}

// One dynamic sentence built from the data on screen — never hardcoded, so a
// regenerated backtest or a different slot count can't leave it stale.
function psimReadingLine(d) {
  const s = d.plans.shipped, x = d.plans.explorer;
  const idxEnd = d.index && d.index.length ? d.index[d.index.length - 1].equity : null;
  if (!s || !x) return '';
  return `<p class="sm-note"><strong>Reading this run:</strong> with at most ${d.positions} open positions,
    ${taka(d.startCapital)} became <strong>${taka(x.finalEquity)}</strong> following Explorer
    (${signed(x.totalReturnPct, '%')}, worst peak-to-trough dip ${num(x.maxDrawdownPct, '%')}) versus
    <strong>${taka(s.finalEquity)}</strong> following the shipped plan (${signed(s.totalReturnPct, '%')},
    drawdown ${num(s.maxDrawdownPct, '%')})${idxEnd != null ? `, while simply holding the DSEX index would
    have left <strong>${taka(idxEnd)}</strong>` : ''}. Explorer funded ${num(x.taken)} of its
    ${num(x.signals)} buy signals; the shipped plan funded ${num(s.taken)} of ${num(s.signals)}.</p>`;
}

// Log-scale equity chart: linear hides the shipped line entirely once the
// other series has tripled, and equal vertical distance = equal percentage
// move is the honest way to compare compounding paths anyway.
function psimChartSvg(d) {
  const series = [];
  if (d.plans.shipped) series.push({ color: '#60a5fa', dash: '', pts: d.plans.shipped.equityCurve });
  if (d.plans.explorer) series.push({ color: '#4ade80', dash: '', pts: d.plans.explorer.equityCurve });
  if (d.index) series.push({ color: '#9ca3af', dash: '4 4', pts: d.index });
  if (!series.length) return '';
  const dates = [...new Set(series.flatMap(sr => sr.pts.map(p => p.date)))].sort();
  const xi = new Map(dates.map((dt, i) => [dt, i]));
  const W = 640, H = 240, padL = 46, padR = 8, padT = 8, padB = 22;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  let lo = Infinity, hi = -Infinity;
  series.forEach(sr => sr.pts.forEach(p => { if (p.equity < lo) lo = p.equity; if (p.equity > hi) hi = p.equity; }));
  const yOf = v => padT + innerH - ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1)) * innerH;
  const xOf = dt => padL + (xi.get(dt) / Math.max(1, dates.length - 1)) * innerW;
  const ticks = [250000, 500000, 1000000, 2000000, 4000000, 8000000].filter(v => v >= lo * 0.95 && v <= hi * 1.05);
  const grid = ticks.map(v =>
    `<line x1="${padL}" y1="${yOf(v)}" x2="${W - padR}" y2="${yOf(v)}" class="sm-psim-grid"/>
     <text x="${padL - 6}" y="${yOf(v) + 3}" class="sm-psim-tick" text-anchor="end">${v >= 1000000 ? (v / 1000000) + 'M' : (v / 1000) + 'k'}</text>`).join('');
  const lines = series.map(sr =>
    `<polyline fill="none" stroke="${sr.color}" stroke-width="1.8" ${sr.dash ? `stroke-dasharray="${sr.dash}"` : ''}
       points="${sr.pts.map(p => `${xOf(p.date).toFixed(1)},${yOf(p.equity).toFixed(1)}`).join(' ')}"/>`).join('');
  const xLabels = `<text x="${padL}" y="${H - 6}" class="sm-psim-tick">${dates[0]}</text>
    <text x="${W - padR}" y="${H - 6}" class="sm-psim-tick" text-anchor="end">${dates[dates.length - 1]}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity curves">${grid}${lines}${xLabels}</svg>`;
}

(() => {
  const seg = document.getElementById('sm-psim-positions');
  if (!seg) return;
  seg.addEventListener('click', e => {
    const b = e.target.closest('.sm-seg-btn');
    if (!b) return;
    seg.querySelectorAll('.sm-seg-btn').forEach(el => el.classList.toggle('active', el === b));
    loadPortfolioSim(true);
  });
})();

// ── Modal ──────────────────────────────────────────────────────────────────
// The verdict bar spans the full score range this weight set can produce,
// not a fixed ±100 — the model's maximum is well short of 100, so a fixed
// scale would park even the strongest signal near the middle of the bar.
function maxAbsScore() {
  const all = [...state.buy, ...state.sell].map(s => Math.abs(s.score));
  return Math.max(1, ...all);
}



// ── Analysis pane ──────────────────────────────────────────────────────────
// Opening a suggestion renders its full breakdown into the Analysis tab (and
// the selected-stock strip above the tabs) rather than a modal — the same
// content, given the room a dashboard layout affords it. The function keeps
// its historical name because every row/keyboard binding calls it.
const RECENT_KEY = 'sm-recent-codes';

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function pushRecent(direction, code) {
  const list = readRecent().filter(r => r.code !== code);
  list.unshift({ direction, code });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5))); } catch { /* private mode */ }
}

function activatePane(name) {
  const btn = document.querySelector(`.sm-tab[data-pane="${name}"]`);
  if (btn) window.smShowPane(btn);
}

// Day change is computed from the stock's own price file (last two closes) —
// fetched per selection, never guessed. Fails quiet: the cell just stays "—".
async function fillDayChange(code) {
  const priceEl = document.getElementById('sm-current-price');
  const changeEl = document.getElementById('sm-current-change');
  try {
    const res = await fetch(`/historical_prices/json_files/${code}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!rows || rows.length < 2) return;
    // Ticker files are oldest-first; take the two most recent closes.
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    if (state.selected && state.selected.code !== code) return; // selection moved on
    const diff = last.Close - prev.Close;
    const pct = prev.Close ? (diff / prev.Close) * 100 : null;
    priceEl.textContent = `${fmtMoney(last.Close)}`;
    changeEl.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct == null ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'})`;
    changeEl.className = `sm-current-cell-value ${diff > 0 ? 'sm-pos' : diff < 0 ? 'sm-neg' : ''}`;
  } catch { /* leave the dashes */ }
}

function renderCurrentStrip(item) {
  const name = state.names[item.code];
  const sector = state.sectors[item.code] || '';
  const strip = document.getElementById('sm-current');
  strip.style.display = '';
  strip.classList.toggle('sm-current--sell', item.direction === 'sell');
  document.getElementById('sm-current-name').textContent = name ? `${name} (${item.code})` : item.code;
  document.getElementById('sm-current-chips').innerHTML = [
    sector ? `<span class="sm-chip">${sector}</span>` : '',
    `<span class="sm-chip sm-chip--${item.direction}${item.label.startsWith('Strong') ? ' sm-chip--strong' : ''}">${item.label}</span>`,
    state.categories[item.code] ? `<span class="sm-chip">Category ${state.categories[item.code]}</span>` : '',
  ].filter(Boolean).join('');
  document.getElementById('sm-current-price').textContent = fmtMoney(item.entry);
  document.getElementById('sm-current-change').textContent = '—';
  document.getElementById('sm-current-change').className = 'sm-current-cell-value';
  fillDayChange(item.code);
}

// Score gauge: |score| against the largest |score| any current suggestion
// reached on either side — the same live scale the verdict bar always used,
// labeled for what it is (relative conviction, not a probability).
function gaugeSvg(item) {
  const max = maxAbsScore();
  const frac = Math.max(0, Math.min(1, Math.abs(item.score) / max));
  const R = 54, CX = 70, CY = 66;
  const arc = (from, to, cls) => {
    const a0 = Math.PI * (1 - from), a1 = Math.PI * (1 - to);
    const x0 = CX + R * Math.cos(a0), y0 = CY - R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY - R * Math.sin(a1);
    return `<path class="${cls}" d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" />`;
  };
  return `
    <svg class="sm-gauge-svg" viewBox="0 0 140 78" aria-hidden="true">
      ${arc(0, 1, 'sm-gauge-track')}
      ${frac > 0.005 ? arc(0, frac, `sm-gauge-fill sm-gauge-fill--${item.direction}`) : ''}
    </svg>
    <div class="sm-gauge-value">${item.score > 0 ? '+' : ''}${item.score}</div>
    <div class="sm-gauge-sub">of ±${max} (strongest live score)</div>`;
}

// Trade-plan level bar: stop → entry → target laid out proportionally on the
// actual price axis. For a sell the target sits below entry; the bar simply
// spans min→max of the three levels either way.
function planRangeBar(item) {
  const lo = Math.min(item.stoploss, item.entry, item.target);
  const hi = Math.max(item.stoploss, item.entry, item.target);
  const span = hi - lo || 1;
  const pos = v => ((v - lo) / span) * 100;
  const mark = (v, cls, label) => `
    <div class="sm-plan-mark ${cls}" style="left:${pos(v).toFixed(1)}%">
      <span class="sm-plan-mark-tick"></span>
      <span class="sm-plan-mark-label">${label}<br>${fmtMoney(v)}</span>
    </div>`;
  return `
    <div class="sm-plan-bar">
      <div class="sm-plan-track"></div>
      ${mark(item.stoploss, 'sm-plan-mark--stop', 'Stop')}
      ${mark(item.entry, 'sm-plan-mark--entry', 'Entry')}
      ${mark(item.target, 'sm-plan-mark--target', 'Target')}
    </div>`;
}

function trendChips(item) {
  const word = t => (t === 1 ? 'Up' : t === -1 ? 'Down' : t === 0 ? 'Mixed' : 'n/a');
  const cls = t => (t === 1 ? 'sm-pos' : t === -1 ? 'sm-neg' : '');
  const rows = [];
  if (item.dailyTrend !== undefined) rows.push(['Daily EMA stack (50/150/200)', word(item.dailyTrend), cls(item.dailyTrend)]);
  if (item.weeklyTrend !== undefined) rows.push(['Weekly EMA stack (10/30/40w)', word(item.weeklyTrend), cls(item.weeklyTrend)]);
  if (item.navRatio) {
    const r = item.navRatio;
    const tone = navRatioTone(r.percentile);
    rows.push([`Price vs disclosed holdings (${r.quarter})`,
      `${r.percentile}th pct — ${tone === 'premium' ? 'premium' : tone === 'discount' ? 'discount' : 'fair'}`,
      tone === 'premium' ? 'sm-neg' : tone === 'discount' ? 'sm-pos' : '']);
  }
  const ic = state.indexContext;
  if (ic) {
    rows.push(['DSEX vs 50-day SMA', ic.above50Sma ? 'Above' : 'Below', ic.above50Sma ? 'sm-pos' : 'sm-neg']);
    rows.push(['DSEX RSI(14)', ic.rsi14.toFixed(0), ic.rsi14 >= 45 ? 'sm-pos' : 'sm-neg']);
  }
  if (!rows.length) return '';
  return `
    <div class="sm-panel">
      <div class="sm-panel-title">Trend context</div>
      ${rows.map(([k, v, c]) => `
        <div class="sm-trendrow">
          <span class="sm-trendrow-k">${k}</span>
          <span class="sm-trendrow-v ${c}">${v}</span>
        </div>`).join('')}
      <p class="sm-note sm-note-muted" style="margin:10px 0 0;">Informational — these reads did not earn a
        default veto once the index-regime gate shipped.</p>
    </div>`;
}

function renderAnalysisPane(item) {
  document.getElementById('sm-analysis-placeholder').style.display = 'none';

  const tradeReasoning = item.reasoning[item.reasoning.length - 2]; // entry/exit sentence (second-to-last)
  const disclaimer = item.reasoning[item.reasoning.length - 1];
  const scoredSigs = item.signals.filter(s => s.scored);
  const otherSigs = item.signals.filter(s => !s.scored);

  const sigRow = s => `
    <tr class="${s.scored ? '' : 'sm-sig-unscored'}">
      <td>
        <span class="an-dot ${s.scored ? (s.direction > 0 ? 'an-dot-bull' : 'an-dot-bear') : 'an-dot-neu'}"></span>
        ${signalLabel(s.key)}
      </td>
      <td>${s.direction > 0 ? 'Bullish' : 'Bearish'}</td>
      <td class="sm-mono ${s.scored ? posneg(s.contribution) : ''}">${s.scored ? signed(s.contribution) : 'not scored'}</td>
      <td class="sm-ens-why">${s.reason}${s.note ? `<div class="sm-sig-note">${s.note}</div>` : ''}</td>
    </tr>`;

  document.getElementById('sm-analysis-body').innerHTML = `
    <div class="sm-cards">
      <div class="sm-card sm-card--gauge">
        <div class="sm-card-label">Composite score</div>
        ${gaugeSvg(item)}
        <span class="sm-chip sm-chip--${item.direction}${item.label.startsWith('Strong') ? ' sm-chip--strong' : ''}">${item.label}</span>
      </div>
      <div class="sm-card">
        <div class="sm-card-label">Entry</div>
        <div class="sm-card-value">${fmtMoney(item.entry)}</div>
        <div class="sm-card-sub">latest close</div>
      </div>
      <div class="sm-card">
        <div class="sm-card-label">Stoploss</div>
        <div class="sm-card-value sm-neg">${fmtMoney(item.stoploss)}</div>
        <div class="sm-card-sub">${((Math.abs(item.stoploss - item.entry) / item.entry) * 100).toFixed(1)}% away</div>
      </div>
      <div class="sm-card">
        <div class="sm-card-label">Target</div>
        <div class="sm-card-value sm-pos">${fmtMoney(item.target)}</div>
        <div class="sm-card-sub">${((Math.abs(item.target - item.entry) / item.entry) * 100).toFixed(1)}% away</div>
      </div>
      <div class="sm-card">
        <div class="sm-card-label">Risk : Reward</div>
        <div class="sm-card-value">${item.riskReward != null ? `1:${item.riskReward}` : '—'}</div>
        <div class="sm-card-sub">${item.signals.length} signal${item.signals.length === 1 ? '' : 's'} detected</div>
      </div>
    </div>

    <div class="sm-panel">
      <div class="sm-panel-title">Trade plan</div>
      ${planRangeBar(item)}
      <p class="an-note" style="margin-top:18px;">${tradeReasoning}</p>
    </div>

    <div class="sm-analysis-cols">
      <div class="sm-panel">
        <div class="sm-panel-title">Signal ensemble
          <span class="an-h3-badge">${scoredSigs.length} scored${otherSigs.length ? ` · ${otherSigs.length} detected` : ''}</span>
        </div>
        <div class="sm-tablewrap">
          <table class="sm-table sm-ens-table">
            <thead><tr><th>Signal</th><th>Read</th><th>Contribution</th><th>Detail</th></tr></thead>
            <tbody>
              ${scoredSigs.map(sigRow).join('')}
              ${otherSigs.map(sigRow).join('')}
            </tbody>
          </table>
        </div>
        ${otherSigs.length ? `<p class="sm-note sm-note-muted" style="margin:10px 0 0;">Greyed signals fired but
          carry no weight in the score — each row's note says why it didn't earn one.</p>` : ''}
      </div>
      ${trendChips(item)}
    </div>

    <p class="an-note an-note-muted">${disclaimer}</p>`;
}

window.openSuperModelModal = function (direction, code) {
  const item = state[direction].find(s => s.code === code);
  if (!item) return;
  state.selected = { direction, code };
  pushRecent(direction, code);
  renderCurrentStrip(item);
  renderAnalysisPane(item);
  renderSideRecent();
  activatePane('analysis');
  document.getElementById('sm-current').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // Chart modal can stack on top of the info modal (opened from a row
  // inside its embedded trade browser) — close the topmost one first.
  if (document.getElementById('sm-trade-chart-modal').style.display !== 'none') {
    window.closeTradeChartModal();
  } else {
    window.closeSuperModelInfo();
  }
});

// ── Run backtest (routes/super-model.js: POST/GET /api/super-model/backtest/*
// and .../backtest/*-2y) ─────────────────────────────────────────────────
// Five independent runs share this code: the full-history one (~15-20
// minutes, 15 passes), the trailing-2-year one (a few minutes, single pass —
// see scripts/generate-backtest-summary-2y.js), and that same window under
// three plan overrides — the two rejected caps, maxTargetRR:2.5 alone
// (scripts/generate-backtest-summary-2y-capped.js) and maxTargetPct:12 alone
// (...-2y-capped-pct.js), and "Explorer", the managed rule set (both caps
// plus entry gates, profit-lock ladder and S/R-break exit; ...-2y-
// explorer.js). All spawn server-side and get polled for completion rather
// than waiting on one request — same pattern as the deep research report's
// Reload button (research/research.js) — keyed by `range` so starting one
// never disturbs another's button/status/polling.
const BT_RUN_CFG = {
  full: {
    btnId: 'sm-run-backtest-btn-full', metaId: 'sm-backtest-run-meta-full',
    runUrl: '/api/super-model/backtest/run', statusUrl: '/api/super-model/backtest/status',
    etaText: 'this can take 15-20 minutes',
  },
  '2y': {
    btnId: 'sm-run-backtest-btn-2y', metaId: 'sm-backtest-run-meta-2y',
    runUrl: '/api/super-model/backtest/run-2y', statusUrl: '/api/super-model/backtest/status-2y',
    etaText: 'a single-pass run, usually just a few minutes',
  },
  capped: {
    btnId: 'sm-run-backtest-btn-capped', metaId: 'sm-backtest-run-meta-capped',
    runUrl: '/api/super-model/backtest/run-capped', statusUrl: '/api/super-model/backtest/status-capped',
    etaText: 'a single-pass run, usually just a few minutes',
  },
  cappedPct: {
    btnId: 'sm-run-backtest-btn-capped-pct', metaId: 'sm-backtest-run-meta-capped-pct',
    runUrl: '/api/super-model/backtest/run-capped-pct', statusUrl: '/api/super-model/backtest/status-capped-pct',
    etaText: 'a single-pass run, usually just a few minutes',
  },
  explorer: {
    btnId: 'sm-run-backtest-btn-explorer', metaId: 'sm-backtest-run-meta-explorer',
    runUrl: '/api/super-model/backtest/run-explorer', statusUrl: '/api/super-model/backtest/status-explorer',
    etaText: 'a single-pass run, usually just a few minutes',
  },
  // The custom-range run POSTs the date bounds from the section's inputs —
  // see bodyForRun() in runSuperModelBacktest.
  range: {
    btnId: 'sm-run-backtest-btn-range', metaId: 'sm-backtest-run-meta-range',
    runUrl: '/api/super-model/backtest/run-range', statusUrl: '/api/super-model/backtest/status-range',
    etaText: 'a single-pass run, usually just a few minutes',
  },
};
const _btPolling = { full: false, '2y': false, capped: false, cappedPct: false, explorer: false, range: false };

function backtestProgressPct(status) {
  return status && status.totalSteps
    ? Math.round((status.step / status.totalSteps) * 100)
    : null;
}

function setBacktestButtonState(range, running, progress) {
  const btn = document.getElementById(BT_RUN_CFG[range].btnId);
  if (!btn) return;
  btn.disabled = running;
  btn.classList.toggle('sm-run-backtest-btn--spinning', running);
  const pct = backtestProgressPct(progress);
  // Drives the CSS left-fill (see .sm-run-backtest-btn--spinning) so the
  // button itself reads as a progress bar, not just a spinning glyph.
  btn.style.setProperty('--sm-bt-pct', running && pct != null ? `${pct}%` : '0%');
  const label = btn.querySelector('.sm-run-backtest-label');
  if (!label) return;
  if (!running) { label.textContent = 'Run backtest'; return; }
  label.textContent = pct != null ? `Running… ${pct}%` : 'Running…';
}

async function fetchBacktestStatus(range) {
  try {
    const res = await fetch(`${API}${BT_RUN_CFG[range].statusUrl}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) { return { state: 'idle' }; }
}

async function pollBacktestStatus(range) {
  if (_btPolling[range]) return;
  _btPolling[range] = true;
  const cfg = BT_RUN_CFG[range];
  setBacktestButtonState(range, true);
  const meta = document.getElementById(cfg.metaId);
  if (meta) meta.textContent = `Running backtest — ${cfg.etaText}.`;
  try {
    while (true) {
      // 5s, not longer: since the status file carries per-stock fractional
      // progress (see backtest-summary-lib.js), polling IS the refresh rate
      // of the percentage on the button. The endpoint just reads a tiny JSON.
      await new Promise(r => setTimeout(r, 5000));
      const status = await fetchBacktestStatus(range);
      if (status.state === 'running') {
        setBacktestButtonState(range, true, status);
        if (meta) {
          const pct = backtestProgressPct(status);
          // step can be fractional mid-pass (0.42 of 1) — say which pass is
          // running, not the raw fraction. Single-pass runs skip the step
          // wording entirely; the percentage says it all.
          const passNo = Math.min(status.totalSteps, Math.floor(status.step) + 1);
          meta.textContent = pct != null
            ? (status.totalSteps > 1
              ? `Running backtest — pass ${passNo} of ${status.totalSteps}, ${pct}% overall. ${cfg.etaText}.`
              : `Running backtest — ${pct}% of the universe scanned. ${cfg.etaText}.`)
            : `Running backtest — ${cfg.etaText}.`;
        }
        continue;
      }
      if (status.state === 'error') {
        if (meta) meta.textContent = `Last backtest run failed: ${status.error || 'unknown error'}`;
        break;
      }
      if (meta) meta.textContent = status.finishedAt ? `Backtest finished ${new Date(status.finishedAt).toLocaleString()}.` : '';
      break; // 'done' or 'idle'
    }
  } finally {
    _btPolling[range] = false;
    setBacktestButtonState(range, false);
    await loadSuperModel();
  }
}

// The custom-range run is the only one that carries request parameters:
// its date inputs POST through as {from, to} (empty = unbounded on that
// side; both empty = all available history).
function bodyForRun(range) {
  if (range !== 'range') return null;
  return {
    from: document.getElementById('sm-bt-range-from').value || null,
    to: document.getElementById('sm-bt-range-to').value || null,
    variant: document.getElementById('sm-bt-range-variant').value || 'shipped',
  };
}

async function runSuperModelBacktest(range) {
  const cfg = BT_RUN_CFG[range];
  setBacktestButtonState(range, true);
  const meta = document.getElementById(cfg.metaId);
  if (meta) meta.textContent = 'Starting…';
  try {
    const body = bodyForRun(range);
    const res = await fetch(`${API}${cfg.runUrl}`, {
      method: 'POST',
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (data.alreadyRunning && meta) meta.textContent = 'A backtest run is already in progress…';
    if (!res.ok || data.error) {
      if (meta) meta.textContent = data.error || `Could not start (HTTP ${res.status}).`;
      setBacktestButtonState(range, false);
      return;
    }
  } catch (e) {
    if (meta) meta.textContent = `Could not start: ${e.message}`;
    setBacktestButtonState(range, false);
    return;
  }
  pollBacktestStatus(range);
}
window.runSuperModelBacktest = runSuperModelBacktest;

// Preset buttons for the custom-range run: each just prefills the date
// inputs (editing a date afterwards clears the highlight — the inputs are
// the source of truth, the presets a shortcut to fill them).
function wireRangePresets() {
  const seg = document.getElementById('sm-bt-range-presets');
  if (!seg) return;
  const fromEl = document.getElementById('sm-bt-range-from');
  const toEl = document.getElementById('sm-bt-range-to');
  const clearActive = () => seg.querySelectorAll('.sm-seg-btn').forEach(b => b.classList.remove('active'));
  const apply = btn => {
    clearActive();
    btn.classList.add('active');
    if (btn.dataset.years === 'all') {
      fromEl.value = ''; toEl.value = '';
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() - Number(btn.dataset.years));
      fromEl.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      toEl.value = '';
    }
  };
  seg.addEventListener('click', e => {
    const btn = e.target.closest('.sm-seg-btn');
    if (btn) apply(btn);
  });
  [fromEl, toEl].forEach(el => el.addEventListener('input', clearActive));
  // The landing default — Explorer (selected in the markup) over the last
  // 5 years, dates prefilled so Run backtest works without any setup.
  const def = seg.querySelector('.sm-seg-btn[data-years="5"]');
  if (def) apply(def);
}

// ── Data loading ─────────────────────────────────────────────────────────
async function loadSuperModel() {
  const [suggestionsRes, namesRes, sectorsRes] = await Promise.all([
    fetch(`${API}/api/super-model/suggestions`),
    fetch(`${API}/api/company-names`).catch(() => null),
    fetch(`${API}/api/sectors`).catch(() => null),
  ]);

  const suggestions = await suggestionsRes.json();
  state.buy = suggestions.buy || [];
  state.sell = suggestions.sell || [];
  state.asOf = suggestions.asOf;
  state.dataAsOfDate = suggestions.dataAsOfDate;
  state.universeScanned = suggestions.universeScanned;
  state.threshold = suggestions.threshold;
  state.backtest = suggestions.backtest;
  state.backtest2y = suggestions.backtest2y;
  state.backtestCapped = suggestions.backtestCapped;
  state.backtestCappedPct = suggestions.backtestCappedPct;
  state.backtestExplorer = suggestions.backtestExplorer;
  state.backtestRange = suggestions.backtestRange;
  state.tracking = suggestions.tracking;
  state.weights = suggestions.weights;
  state.signalMeta = suggestions.signalMeta;
  state.indexContext = suggestions.indexContext;

  if (namesRes && namesRes.ok) {
    const namesData = await namesRes.json();
    state.names = namesData.names || {};
  }
  if (sectorsRes && sectorsRes.ok) {
    state.sectors = await sectorsRes.json();
  }

  renderMeta();
  renderIndexContext();
  renderMarketCard();
  renderSidePicks();
  renderSideRecent();
  renderBacktestPane();
  renderLivePane();
  renderModelPane();
  populateFilterOptions();
  wireFilters();
  wireEvidenceDetails();
  renderGrid('buy');
  renderGrid('sell');
  renderFilterCount();

  // DSE category (A/B/Z) lives only on /api/stocks, which live-scrapes and
  // can take ~2s cold. Fetching it here rather than in the Promise.all above
  // keeps that off the critical path; the Category select stays disabled
  // until the map arrives.
  loadCategories();
}

async function loadCategories() {
  try {
    const res = await fetch(`${API}/api/stocks`);
    if (!res.ok) return;
    const data = await res.json();
    (data.stocks || []).forEach(s => { if (s.code && s.category) state.categories[s.code] = s.category; });
    const sel = document.getElementById('sm-filter-category');
    if (Object.keys(state.categories).length) sel.disabled = false;
  } catch (err) {
    console.error('[super-model] category map failed to load:', err);
  }
}

initTheme();
document.getElementById('theme-toggle-btn').addEventListener('click', () => toggleTheme());
document.getElementById('sm-side-search').addEventListener('input', renderSidePicks);
wireRangePresets();
loadSuperModel().catch(err => {
  console.error('[super-model] load failed:', err);
  document.getElementById('sm-meta-row').textContent = 'Failed to load suggestions — is the server running?';
});

// A run started before this page load (or by another tab) should still show
// as in-progress rather than the button silently looking idle — checked
// independently for both ranges, since either can be running on its own.
['full', '2y', 'capped', 'cappedPct', 'explorer', 'range'].forEach(range => {
  fetchBacktestStatus(range).then(status => { if (status.state === 'running') pollBacktestStatus(range); });
});
