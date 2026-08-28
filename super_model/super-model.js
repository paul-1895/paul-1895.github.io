'use strict';

import { initTheme, toggleTheme } from '../theme/theme.js';

const API = '';

const state = {
  buy: [], sell: [], names: {}, sectors: {}, categories: {},
  asOf: null, dataAsOfDate: null, universeScanned: 0, threshold: 20,
  backtest: null, tracking: null, weights: null,
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
  }[key] || key;
}

function cardHtml(item) {
  const strong = item.label.startsWith('Strong');
  const badgeMod = item.direction === 'buy' ? (strong ? 'sm-badge--strong-buy' : 'sm-badge--buy')
                                             : (strong ? 'sm-badge--strong-sell' : 'sm-badge--sell');
  const name = state.names[item.code] || '';
  const sector = state.sectors[item.code] || '';
  return `
    <div class="sm-card sm-card--${item.direction}" data-code="${item.code}" data-direction="${item.direction}" tabindex="0" role="button">
      <div class="sm-card-top">
        <div class="sm-card-id">
          <span class="sm-card-code">${item.code}</span>
          ${name ? `<span class="sm-card-name">${name}</span>` : ''}
        </div>
        <span class="sm-badge ${badgeMod}">${item.label}</span>
      </div>
      ${sector ? `<div class="sm-card-sector">${sector}</div>` : ''}
      <div class="sm-stat-row">
        <div class="sm-stat">
          <span class="sm-stat-label">Entry</span>
          <span class="sm-stat-value">${fmtMoney(item.entry)}</span>
        </div>
        <div class="sm-stat">
          <span class="sm-stat-label">Stoploss</span>
          <span class="sm-stat-value sm-neg">${fmtMoney(item.stoploss)}</span>
        </div>
        <div class="sm-stat">
          <span class="sm-stat-label">Target</span>
          <span class="sm-stat-value sm-pos">${fmtMoney(item.target)}</span>
        </div>
      </div>
      <div class="sm-card-foot">
        <span>R:R ${item.riskReward != null ? `1:${item.riskReward}` : '—'}</span>
        <span>${item.signals.length} signal${item.signals.length === 1 ? '' : 's'}</span>
      </div>
    </div>`;
}

function renderGrid(direction) {
  const all = state[direction];
  const list = filteredList(direction);
  const grid = document.getElementById(`sm-${direction}-grid`);
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
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = list.map(cardHtml).join('');
  grid.querySelectorAll('.sm-card').forEach(card => {
    card.addEventListener('click', () => openSuperModelModal(card.dataset.direction, card.dataset.code));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSuperModelModal(card.dataset.direction, card.dataset.code); }
    });
  });
}

function renderMeta() {
  const el = document.getElementById('sm-meta-row');
  const asOf = state.asOf ? new Date(state.asOf).toLocaleString() : '—';
  const bar = state.dataAsOfDate ? ` · prices through ${state.dataAsOfDate}` : '';
  el.textContent = `Scanned ${state.universeScanned} stocks · conviction threshold ±${state.threshold}${bar} · generated ${asOf}`;
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

function wireFilters() {
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
function statBlock(items) {
  return `<div class="sm-statgrid">${items.map(([label, value, cls, metric]) => {
    const on = metric ? ` class="sm-statcell sm-statcell--clickable" data-metric="${metric}" tabindex="0" role="button"`
                      : ' class="sm-statcell"';
    return `<div${on}><span class="sm-statlabel">${label}</span><span class="sm-statnum ${cls || ''}">${value}</span></div>`;
  }).join('')}</div>`;
}

// ── Metric detail ──────────────────────────────────────────────────────────
const BT_SIDE_LABEL = { all: 'all simulated trades', buy: 'Buy-side trades', sell: 'Sell-side trades' };
const btSide = which => {
  const b = state.backtest || {};
  return which === 'buy' ? b.buy : which === 'sell' ? b.sell : b.overall;
};

function btTradeRows(s) {
  return [
    ['Trades simulated', num(s.n)],
    ['Reached target', num(s.targetPct, '%'), 'sm-pos'],
    ['Hit stoploss', num(s.stopPct, '%'), 'sm-neg'],
    ['Expired unresolved', num(s.expiredPct, '%')],
    ['Ended profitable', num(s.winRate, '%')],
    ['Average P&L', signed(s.avgPnl, '%'), posneg(s.avgPnl)],
    ['Median P&L', signed(s.medianPnl, '%'), posneg(s.medianPnl)],
    ['P&L std deviation', num(s.pnlStdev)],
    ['Avg days to target', num(s.avgBarsToTarget)],
    ['Avg days to stoploss', num(s.avgBarsToStop)],
    ['Avg days held overall', num(s.avgBarsHeld)],
  ];
}

/** Returns { title, value, cls, sub, what, how, rows, notes } or null. */
function metricDetail(key) {
  const b = state.backtest, t = state.tracking;
  // bt keys carry a side ("bt:buy:target"); live/win/sig keys don't
  // ("live:open"), so their field is the SECOND segment, not the third.
  const [kind, a, f] = key.split(':');

  if (kind === 'bt' && b) {
    const s = btSide(a);
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
      browser: { kind: 'bt', side: a, outcome: '' },
      notes: [m.overlap, m.lookahead].filter(Boolean) };

    if (f === 'target') return { ...base,
      title: 'Hit target', value: num(s.targetPct, '%'), cls: 'sm-pos',
      sub: `of ${scope} reached their target first`,
      what: 'The share of simulated trades where price touched the target level before the stoploss.',
      how: 'Each trade walks forward one day at a time from the signal bar; the first level the day\'s high-low range touches decides the outcome.',
      notes: [m.sameBar].filter(Boolean) };

    if (f === 'stop') return { ...base,
      title: 'Hit stoploss', value: num(s.stopPct, '%'), cls: 'sm-neg',
      sub: `of ${scope} were stopped out first`,
      what: 'The share of simulated trades where price touched the stoploss before the target.',
      how: 'A stop rate above the target rate is not automatically a losing system — targets sit further away than stops, so each win is larger than each loss. The average P&L is the figure that settles it.',
      notes: [m.sameBar].filter(Boolean) };

    if (f === 'pnl') return { ...base,
      title: 'Average P&L', value: signed(s.avgPnl, '%'), cls: posneg(s.avgPnl),
      sub: `mean result per trade across ${scope}`,
      what: 'The average percentage gain or loss per simulated trade, exiting at whichever level was hit — or at the closing price if the holding window ran out.',
      how: `Compare it against the median (${signed(s.medianPnl, '%')}): a mean well above the median means a few large winners carry the result, with most trades doing worse than the average suggests.`,
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
    const rows = [
      ['Tracked in total', num(t.total)],
      ['Still open', num(t.open)],
      ['Resolved', num(t.closed)],
      ['Reached target', num(t.target), 'sm-pos'],
      ['Hit stoploss', num(t.stoploss), 'sm-neg'],
      ['Expired unresolved', num(t.expired)],
      ['Target rate', num(t.targetRate, '%'), 'sm-pos'],
      ['Stoploss rate', num(t.stoplossRate, '%'), 'sm-neg'],
      ['Profitable', num(t.winRate, '%')],
      ['Average P&L', signed(t.avgPnlPct, '%'), posneg(t.avgPnlPct)],
      ['Avg days to target', num(t.avgDaysToTarget)],
      ['Avg days to stoploss', num(t.avgDaysToStoploss)],
    ];
    const HOW_TRACK = 'Every suggestion this page shows is written to a store the first time it appears. Open ones are re-checked against later prices whenever the scan actually re-runs — results are cached for 10 minutes, so a refresh inside that window re-checks nothing, and if nobody opens the page for a week nothing resolves until someone does. A suggestion closes on the first completed daily bar whose range touches either level, and the exit is booked at that level exactly, with no allowance for a gap opening past it.';
    const D = {
      total: ['Tracked suggestions', num(t.total), '', 'suggestions recorded since tracking began',
        'The number of distinct suggestions logged. A stock is recorded once per direction while that suggestion stays open, so a name repeating day after day is not counted again.'],
      open: ['Still open', num(t.open), '', 'awaiting a target or stoploss',
        `Suggestions that have not yet touched either level. They stay open until one is hit or the holding window runs out.${t.stale ? ` A further ${t.stale} are marked stale — the stock's price history ends before the suggestion date, so their outcome can never be determined and they are excluded from every rate below.` : ''}`],
      closed: ['Resolved', num(t.closed), '', 'suggestions that have finished',
        'Suggestions that reached their target, hit their stoploss, or ran out the holding window. Only these count toward the rates below.'],
      target: ['Reached target', num(t.target), 'sm-pos', 'suggestions that hit their target first',
        'Suggestions where the price touched the target level before the stoploss.'],
      stoploss: ['Hit stoploss', num(t.stoploss), 'sm-neg', 'suggestions stopped out first',
        'Suggestions where the price touched the stoploss level before the target.'],
      targetRate: ['Target rate', num(t.targetRate, '%'), 'sm-pos', 'of resolved suggestions reached target',
        'Share of finished suggestions that reached their target. Measured only against resolved ones, so open suggestions do not flatter or drag it.'],
      stoplossRate: ['Stoploss rate', num(t.stoplossRate, '%'), 'sm-neg', 'of resolved suggestions were stopped out',
        'Share of finished suggestions that hit their stoploss first.'],
      winRate: ['Profitable', num(t.winRate, '%'), '', 'of resolved suggestions ended in profit',
        'Includes suggestions that expired at a profit without reaching the target, so it runs a little above the target rate.'],
      pnl: ['Average P&L', signed(t.avgPnlPct, '%'), posneg(t.avgPnlPct), 'mean result per resolved suggestion',
        'Average percentage gain or loss across finished suggestions. Those that reached a level exit at that level; those that expired exit at the closing price of the final bar of the holding window.'],
      daysTarget: ['Avg days to target', num(t.avgDaysToTarget), '', 'trading days, target reached',
        'How long suggestions that reached their target took to get there.'],
      daysStop: ['Avg days to stoploss', num(t.avgDaysToStoploss), '', 'trading days, stopped out',
        'How long suggestions that were stopped out took to get there.'],
    }[a];
    if (!D) return null;
    // Every live card opens onto the suggestion list itself, pre-filtered to
    // the subset that number describes — the same "don't just show a number,
    // let it be checked" idea the backtest's trade browser already applies.
    const LIVE_OUTCOME = {
      total: '', open: 'open', closed: '', target: 'target', stoploss: 'stoploss',
      targetRate: 'target', stoplossRate: 'stoploss', winRate: '', pnl: '',
      daysTarget: 'target', daysStop: 'stoploss',
    };
    return {
      title: D[0], value: D[1], cls: D[2], sub: D[3], what: D[4], how: HOW_TRACK, rows,
      browser: { kind: 'live', side: 'all', outcome: LIVE_OUTCOME[a] || '' },
      notes: t.closed === 0
        ? ['Nothing has resolved yet, so the rates above are still empty. They fill in as prices print on the days after each suggestion was issued.']
        : ['This is a forward record: unlike the backtest, none of it was chosen with hindsight. It is also a much smaller sample, so read it as early evidence rather than a verdict.'],
    };
  }

  if (kind === 'win' && b) {
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
    ${d.browser ? `<div class="an-section"><div class="an-h3">${d.browser.kind === 'live' ? 'Every tracked suggestion' : 'Every simulated trade'}</div><div id="sm-trades"></div></div>` : ''}
    ${d.rows && d.rows.length ? `<div class="an-section"><div class="an-h3">Full breakdown</div>
      <ul class="sm-info-rows">${d.rows.map(([k, v, c]) =>
        `<li><span class="sm-info-k">${k}</span><span class="sm-info-v ${c || ''}">${v}</span></li>`).join('')}</ul></div>` : ''}
    ${(d.notes || []).map(n => `<p class="an-note an-note-muted">${n}</p>`).join('')}`;
  const modal = document.getElementById('sm-info-modal');
  modal.classList.toggle('sm-info-wide', !!d.browser);
  if (d.browser) mountTradeBrowser(d.browser.kind, d.browser.side, d.browser.outcome);
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

// ── Trade browser ──────────────────────────────────────────────────────────
// Two data sources share this one browser UI:
//   'bt'   — simulated backtest trades. Filtering/sorting/paging happen
//            server-side (see /trades): the full list is over a megabyte.
//   'live' — real tracked suggestions (see /tracking). Small enough to fetch
//            once and filter/sort/page in the browser.
const tradeView = { kind: 'bt', side: 'all', outcome: '', q: '', sort: 'date', dir: 'desc', limit: 100, offset: 0 };

const OUTCOME_CLS = { target: 'sm-pos', stoploss: 'sm-neg', expired: '', open: '', stale: '' };

function tradeRowHtml(t) {
  return `
    <tr>
      <td class="sm-mono">${t.date}</td>
      <td class="sm-mono sm-trade-code">${t.code}</td>
      <td><span class="sm-trade-side sm-trade-side--${t.direction}">${t.direction === 'buy' ? 'Buy' : 'Sell'}</span></td>
      <td class="sm-mono ${posneg(t.score)}" title="${(t.signals || []).join('  ')}">${signed(t.score)}</td>
      <td class="sm-mono">${t.entry}</td>
      <td class="sm-mono sm-neg">${t.stoploss}</td>
      <td class="sm-mono sm-pos">${t.target}</td>
      <td class="sm-mono">${t.riskReward != null ? `1:${t.riskReward}` : '—'}</td>
      <td><span class="sm-trade-outcome ${OUTCOME_CLS[t.outcome] || ''}">${t.outcome}</span></td>
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

const BT_OUTCOME_OPTS = [['', 'Any outcome'], ['target', 'Target'], ['stoploss', 'Stopped'], ['expired', 'Expired']];
const LIVE_OUTCOME_OPTS = [['', 'Any status'], ['open', 'Open'], ['target', 'Target'], ['stoploss', 'Stopped'], ['expired', 'Expired']];

function mountTradeBrowser(kind, side, outcome = '') {
  Object.assign(tradeView, {
    kind, side: side === 'all' ? 'all' : (side || 'all'), outcome, q: '', sort: 'date', dir: 'desc', offset: 0,
  });
  const root = document.getElementById('sm-trades');
  if (!root) return;

  const outcomeOpts = kind === 'live' ? LIVE_OUTCOME_OPTS : BT_OUTCOME_OPTS;
  const cols = tradeCols(kind);

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
      <input type="search" id="sm-trade-q" class="sm-trade-search" placeholder="Filter by code…"
             autocomplete="off" spellcheck="false" />
    </div>
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

  refreshTrades();
}

// ── Live suggestion list ────────────────────────────────────────────────────
// Small enough (real suggestions accumulate slowly) to fetch whole and
// filter/sort/page client-side, unlike the multi-megabyte backtest file.
let liveTradesPromise = null;
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
      .catch(err => { liveTradesPromise = null; throw err; }); // let a later retry re-fetch
  }
  return liveTradesPromise;
}

function filterSortLive(all, view) {
  let list = all;
  if (view.side !== 'all') list = list.filter(t => t.direction === view.side);
  if (view.outcome) list = list.filter(t => t.outcome === view.outcome);
  if (view.q) {
    const needle = view.q.toLowerCase();
    list = list.filter(t => t.code.toLowerCase().includes(needle));
  }
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
    if (tradeView.q) p.set('q', tradeView.q);

    try {
      const res = await fetch(`${API}/api/super-model/trades?${p}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      console.error('[super-model] trade list failed:', err);
      body.innerHTML = '';
      foot.innerHTML = `<span class="sm-neg">Could not load the trade list (${err.message}). Generate it with
        <code>node scripts/generate-backtest-summary.js</code>.</span>`;
      statsEl.textContent = '';
      return;
    }
  }

  const rows = data.trades.map(tradeRowHtml).join('');
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

// One delegated listener for every clickable metric in the evidence panel,
// so the panes can re-render freely without rebinding.
function wireEvidenceDetails() {
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

function renderBacktestPane() {
  const el = document.getElementById('sm-pane-backtest');
  const b = state.backtest;
  if (!b || !b.overall) {
    el.innerHTML = `<p class="sm-note">No backtest summary available. Generate it with
      <code>node scripts/generate-backtest-summary.js</code>.</p>`;
    return;
  }
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
  // shown alongside the partition rather than instead of it.
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
  el.innerHTML = `
    <p class="sm-note">Simulated over ${num(b.stocks)} stocks, holding at most ${num(b.maxHoldBars)} bars.
      These are <strong>historical simulations</strong>, not real trades.
      ${cov ? `The archive runs ${num(b.periodFrom)} to ${num(b.periodTo)}, but the full universe only
        begins around ${num(cov.universeStart)} — ${num(cov.preUniverseTrades)} trades predate that and come
        from just ${num(cov.preUniverseStocks)} stocks, so this is effectively a ~19-month test.` : ''}</p>
    <p class="sm-hint">Tap any figure below for what it measures and how it was calculated.</p>
    ${statBlock([
      ['Simulated trades', num(b.overall.n), '', 'bt:all:n'],
      ['Hit target', num(b.overall.targetPct, '%'), 'sm-pos', 'bt:all:target'],
      ['Hit stoploss', num(b.overall.stopPct, '%'), 'sm-neg', 'bt:all:stop'],
      ['Avg P&amp;L', signed(b.overall.avgPnl, '%'), posneg(b.overall.avgPnl), 'bt:all:pnl'],
      ['Avg days held', num(b.overall.avgBarsHeld), '', 'bt:all:days'],
    ])}
    <div class="sm-split">
      <div><h4>Buy side</h4>${statBlock([
        ['Trades', num(b.buy && b.buy.n), '', 'bt:buy:n'],
        ['Target', num(b.buy && b.buy.targetPct, '%'), 'sm-pos', 'bt:buy:target'],
        ['Avg P&amp;L', signed(b.buy && b.buy.avgPnl, '%'), posneg(b.buy && b.buy.avgPnl), 'bt:buy:pnl'],
        ['Days to target', num(b.buy && b.buy.avgBarsToTarget), '', 'bt:buy:daysToTarget'],
      ])}</div>
      <div><h4>Sell side <span class="sm-warn">underperformed</span></h4>${statBlock([
        ['Trades', num(b.sell && b.sell.n), '', 'bt:sell:n'],
        ['Target', num(b.sell && b.sell.targetPct, '%'), '', 'bt:sell:target'],
        ['Avg P&amp;L', signed(b.sell && b.sell.avgPnl, '%'), posneg(b.sell && b.sell.avgPnl), 'bt:sell:pnl'],
        ['Days to target', num(b.sell && b.sell.avgBarsToTarget), '', 'bt:sell:daysToTarget'],
      ])}</div>
    </div>
    ${periodHtml}
    <h4>Per test window</h4>
    <div class="sm-tablewrap"><table class="sm-table">
      <thead><tr><th>Window</th><th>Stocks</th><th>Market 20d</th><th>Rank edge</th><th>Trades</th><th>Avg P&amp;L</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="sm-note sm-note-muted">"Rank edge" is how much the top-scoring 10% of stock-days beat the market
      average over the next 20 bars. A window marked <span class="sm-warn">thin</span> covers too few stocks to
      say anything about the market and is excluded from the period counts above.</p>
    <h4>Limitations</h4>
    <ul class="sm-caveats">${(b.caveats || []).map(c => `<li>${c}</li>`).join('')}</ul>`;
}

function renderLivePane() {
  const el = document.getElementById('sm-pane-live');
  const t = state.tracking;
  if (!t || !t.total) {
    el.innerHTML = `<p class="sm-note">No suggestions tracked yet. Every suggestion shown on this page is recorded
      and checked against later prices — this fills in as time passes.</p>`;
    return;
  }
  const pending = t.closed === 0;
  el.innerHTML = `
    <p class="sm-note">Real forward record of suggestions this page has issued, resolved against actual prices.
      Unlike the backtest, nothing here was chosen with hindsight.</p>
    <p class="sm-hint">Tap any figure below for what it measures and how it was calculated.</p>
    ${statBlock([
      ['Tracked', num(t.total), '', 'live:total'],
      ['Still open', num(t.open), '', 'live:open'],
      ['Resolved', num(t.closed), '', 'live:closed'],
      ['Hit target', num(t.target), 'sm-pos', 'live:target'],
      ['Hit stoploss', num(t.stoploss), 'sm-neg', 'live:stoploss'],
    ])}
    ${pending ? `<p class="sm-note sm-note-muted">All ${t.open} suggestions are still open — none has had time to reach
        its target or stoploss yet. Outcome rates and timings appear here once they resolve.</p>`
      : statBlock([
        ['Target rate', num(t.targetRate, '%'), 'sm-pos', 'live:targetRate'],
        ['Stoploss rate', num(t.stoplossRate, '%'), 'sm-neg', 'live:stoplossRate'],
        ['Profitable', num(t.winRate, '%'), '', 'live:winRate'],
        ['Avg P&amp;L', signed(t.avgPnlPct, '%'), posneg(t.avgPnlPct), 'live:pnl'],
        ['Avg days to target', num(t.avgDaysToTarget), '', 'live:daysTarget'],
        ['Avg days to stoploss', num(t.avgDaysToStoploss), '', 'live:daysStop'],
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

// ── Modal ──────────────────────────────────────────────────────────────────
// The verdict bar spans the full score range this weight set can produce,
// not a fixed ±100 — the model's maximum is well short of 100, so a fixed
// scale would park even the strongest signal near the middle of the bar.
function maxAbsScore() {
  const all = [...state.buy, ...state.sell].map(s => Math.abs(s.score));
  return Math.max(1, ...all);
}

function verdictModClass(direction, label) {
  const strong = label.startsWith('Strong');
  return direction === 'buy'
    ? (strong ? 'an-verdict--bullish' : 'an-verdict--bullish-mild')
    : (strong ? 'an-verdict--bearish' : 'an-verdict--bearish-mild');
}
function markerModClass(direction, label) {
  const strong = label.startsWith('Strong');
  return direction === 'buy'
    ? (strong ? 'an-verdict-bar-marker--bullish' : 'an-verdict-bar-marker--bullish-mild')
    : (strong ? 'an-verdict-bar-marker--bearish' : 'an-verdict-bar-marker--bearish-mild');
}

window.openSuperModelModal = function (direction, code) {
  const item = state[direction].find(s => s.code === code);
  if (!item) return;
  const name = state.names[code];
  document.getElementById('sm-modal-title').textContent = name ? `${code} — ${name}` : code;

  const tradeReasoning = item.reasoning[item.reasoning.length - 2]; // entry/exit sentence (second-to-last)
  const disclaimer = item.reasoning[item.reasoning.length - 1];

  const rowFor = s => `
    <li class="an-signal-row ${s.scored ? '' : 'sm-sig-unscored'}">
      <span class="an-dot ${s.scored ? (s.direction > 0 ? 'an-dot-bull' : 'an-dot-bear') : 'an-dot-neu'}"></span>
      <div class="an-signal-text">
        <span class="an-signal-label">${signalLabel(s.key)}
          <span class="an-verdict-tally">${s.scored ? (s.contribution > 0 ? '+' : '') + s.contribution : 'not scored'}</span></span>
        <span class="an-signal-detail">${s.reason}</span>
        ${s.note ? `<span class="an-signal-detail sm-sig-note">${s.note}</span>` : ''}
      </div>
    </li>`;
  const scoredSigs = item.signals.filter(s => s.scored);
  const otherSigs = item.signals.filter(s => !s.scored);
  const signalRows = scoredSigs.map(rowFor).join('');

  document.getElementById('sm-modal-body').innerHTML = `
    <div class="an-verdict ${verdictModClass(direction, item.label)}">
      <div class="an-verdict-top">
        <span class="an-verdict-label">${item.label}</span>
        <span class="an-verdict-score">${item.score > 0 ? '+' : ''}${item.score}</span>
      </div>
      <div class="an-verdict-bar">
        <div class="an-verdict-bar-zero"></div>
        <div class="an-verdict-bar-marker ${markerModClass(direction, item.label)}" style="left: calc(50% + ${(item.score / maxAbsScore()) * 50}%)"></div>
      </div>
      <div class="an-verdict-tally">${item.signals.length} contributing signal${item.signals.length === 1 ? '' : 's'}</div>
    </div>

    <div class="an-section">
      <div class="an-h3">Trade Plan</div>
      <div class="sm-stat-row sm-stat-row--modal">
        <div class="sm-stat">
          <span class="sm-stat-label">Entry</span>
          <span class="sm-stat-value">${fmtMoney(item.entry)}</span>
        </div>
        <div class="sm-stat">
          <span class="sm-stat-label">Stoploss</span>
          <span class="sm-stat-value sm-neg">${fmtMoney(item.stoploss)}</span>
        </div>
        <div class="sm-stat">
          <span class="sm-stat-label">Target</span>
          <span class="sm-stat-value sm-pos">${fmtMoney(item.target)}</span>
        </div>
        <div class="sm-stat">
          <span class="sm-stat-label">Risk:Reward</span>
          <span class="sm-stat-value">${item.riskReward != null ? `1:${item.riskReward}` : '—'}</span>
        </div>
      </div>
      <p class="an-note">${tradeReasoning}</p>
    </div>

    <div class="an-section">
      <div class="an-h3">Scored signals <span class="an-h3-badge">${scoredSigs.length}</span></div>
      <ul class="an-signal-list">${signalRows}</ul>
    </div>

    ${otherSigs.length ? `
    <div class="an-section">
      <div class="an-h3">Also detected <span class="an-h3-badge">${otherSigs.length}</span></div>
      <p class="an-note an-note-muted">These fired but had no consistent edge in backtesting, so they carry no weight.</p>
      <ul class="an-signal-list">${otherSigs.map(rowFor).join('')}</ul>
    </div>` : ''}

    <p class="an-note an-note-muted">${disclaimer}</p>
  `;

  const modal = document.getElementById('sm-modal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

window.closeSuperModelModal = function () {
  document.getElementById('sm-modal').style.display = 'none';
  document.body.style.overflow = '';
};

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  window.closeSuperModelModal();
  window.closeSuperModelInfo();
});

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
  state.tracking = suggestions.tracking;
  state.weights = suggestions.weights;
  state.signalMeta = suggestions.signalMeta;

  if (namesRes && namesRes.ok) {
    const namesData = await namesRes.json();
    state.names = namesData.names || {};
  }
  if (sectorsRes && sectorsRes.ok) {
    state.sectors = await sectorsRes.json();
  }

  renderMeta();
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
loadSuperModel().catch(err => {
  console.error('[super-model] load failed:', err);
  document.getElementById('sm-meta-row').textContent = 'Failed to load suggestions — is the server running?';
});
