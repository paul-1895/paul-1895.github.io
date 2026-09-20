import { initTheme, toggleTheme } from '../theme/theme.js';

/* ════════════════════════════════════════════════════════════
   macd-strategy1.js
   "MACD + 50 EMA — All Stocks" page.

   Reads the stored market-wide scan from /api/macd-strategy1/summary
   and renders it as a sortable, filterable table. The scan itself is
   computed and persisted server-side (routes/macd-strategy1.js) —
   nothing is backtested in the browser here, so opening the page is
   instant no matter how many symbols are listed.

   Depends on : theme/theme.js (shared light/dark toggle)
   ════════════════════════════════════════════════════════════ */

const API = '';

const state = {
  data: null,
  names: {},
  sectors: {},
  sort: { key: 'edge', dir: 'desc' },
  filter: 'all',
  q: '',
};

// ─── Helpers ────────────────────────────────────────────────
const fmtPct = (v, dp = 1) => (v == null || isNaN(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(dp) + '%');
const cls    = v => (v == null || isNaN(v) ? '' : v > 0 ? 'ms1-pos' : v < 0 ? 'ms1-neg' : '');

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function titleCase(s) {
  return String(s || '').replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

// ─── Columns ────────────────────────────────────────────────
// [label, key, numeric?, title]
const COLS = [
  ['Code',    'code',         false, 'Ticker — click to open its chart'],
  ['Sector',  'sector',       false, ''],
  ['Trades',  'trades',       true,  'Completed trades over the tested history'],
  ['Win %',   'winRate',      true,  'Share of completed trades that ended in profit, after commission'],
  ['Return',  'totalReturn',  true,  'Compounded return after commission, reinvesting the full balance each trade'],
  ['Buy&Hold','buyHoldPct',   true,  'Holding from the first tradeable bar to the end, charged the same commission once each way'],
  ['Edge',    'edge',         true,  'Return minus buy & hold. Positive means the strategy was worth the effort on this stock'],
  ['Avg R',   'avgR',         true,  'Average realised reward-to-risk per trade, before commission'],
  ['PF',      'profitFactor', true,  'Profit factor — gross profit ÷ gross loss. Above 1 means winners outweighed losers'],
  ['Max DD',  'maxDrawdown',  true,  'Deepest fall of the compounded balance from a previous peak'],
  ['Exits',   'hitTarget',    true,  'How each trade ended: target / stopped / bearish MACD cross'],
  ['Now',     'openPos',      false, 'Whether the strategy would be holding this stock right now'],
];

// ─── Data loading ───────────────────────────────────────────
async function loadNames() {
  try {
    const [n, s] = await Promise.all([
      fetch(`${API}/api/company-names`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API}/api/sectors`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);
    if (n && n.names) state.names = n.names;
    if (s) state.sectors = s;
  } catch (e) {}
}

async function loadSummary() {
  const res = await fetch(`${API}/api/macd-strategy1/summary`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function runScan(btn) {
  const original = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning all stocks…'; }
  try {
    const res = await fetch(`${API}/api/macd-strategy1/run`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    render();
  } catch (err) {
    alert(`Scan failed: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

// ─── Rendering ──────────────────────────────────────────────
function kpi(label, value, klass, title) {
  return `<div class="ms1-kpi"${title ? ` title="${escapeHtml(title)}"` : ''}>
    <span class="ms1-kpi-label">${escapeHtml(label)}</span>
    <span class="ms1-kpi-value ${klass || ''}">${value}</span>
  </div>`;
}

function renderKpis() {
  const o = state.data.overall;
  const beatPct = o.stocksWithTrades ? (o.beatBuyHold / o.stocksWithTrades) * 100 : null;
  const profPct = o.stocksWithTrades ? (o.profitable / o.stocksWithTrades) * 100 : null;

  document.getElementById('ms1-kpis').innerHTML = `
    ${kpi('Stocks with trades', o.stocksWithTrades, '', 'Symbols that produced at least one completed trade')}
    ${kpi('Total trades', o.totalTrades.toLocaleString())}
    ${kpi('Win rate', o.winRate == null ? '—' : o.winRate.toFixed(1) + '%',
      cls(o.winRate >= 50 ? 1 : -1), 'Across every trade on every stock, not the average of per-stock rates')}
    ${kpi('Median return / stock', fmtPct(o.medianReturnPerStock), cls(o.medianReturnPerStock),
      'The middle stock’s compounded return — less flattering than the mean, and harder for a few outliers to distort')}
    ${kpi('Avg return / stock', fmtPct(o.avgReturnPerStock), cls(o.avgReturnPerStock))}
    ${kpi('Avg buy & hold', fmtPct(o.avgBuyHoldPerStock), cls(o.avgBuyHoldPerStock),
      'What simply holding each stock over the same window would have returned')}
    ${kpi('Beat buy & hold', `${o.beatBuyHold}<span class="ms1-kpi-sub"> / ${o.stocksWithTrades}${beatPct == null ? '' : ` · ${beatPct.toFixed(0)}%`}</span>`,
      cls(beatPct != null && beatPct >= 50 ? 1 : -1))}
    ${kpi('Profitable', `${o.profitable}<span class="ms1-kpi-sub"> / ${o.stocksWithTrades}${profPct == null ? '' : ` · ${profPct.toFixed(0)}%`}</span>`,
      cls(profPct != null && profPct >= 50 ? 1 : -1))}
    ${kpi('Exits', `<span class="ms1-pos">${o.hitTarget}</span> / <span class="ms1-neg">${o.stopped}</span> / ${o.macdExit}`,
      '', 'Target / stopped out / bearish MACD cross')}
    ${kpi('Holding now', o.withOpenPosition, '', 'Stocks where the strategy would currently be in an open position')}
  `;
}

function renderHead() {
  document.getElementById('ms1-head').innerHTML = COLS.map(([label, key, num, title]) => {
    const on = state.sort.key === key;
    return `<th class="ms1-th${num ? ' ms1-num' : ''}${on ? ' ms1-th-active' : ''}" data-key="${key}"
      tabindex="0" role="button"${title ? ` title="${escapeHtml(title)}"` : ''}>${label}<span class="ms1-sort-mark">${
      on ? (state.sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span></th>`;
  }).join('');
}

function visibleRows() {
  let rows = state.data.rows.filter(r => r.trades > 0 || state.filter === 'all');

  if (state.filter === 'profitable') rows = rows.filter(r => r.totalReturn != null && r.totalReturn > 0);
  else if (state.filter === 'beat')  rows = rows.filter(r => r.edge != null && r.edge > 0);
  else if (state.filter === 'open')  rows = rows.filter(r => r.openPosition);

  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter(r =>
      r.code.toLowerCase().includes(q) ||
      String(state.names[r.code] || '').toLowerCase().includes(q) ||
      String(state.sectors[r.code] || '').toLowerCase().includes(q));
  }

  const { key, dir } = state.sort;
  const mul = dir === 'asc' ? 1 : -1;
  const valOf = r => {
    if (key === 'sector') return state.sectors[r.code] || '';
    if (key === 'openPos') return r.openPosition ? 1 : 0;
    return r[key];
  };
  return [...rows].sort((a, b) => {
    const av = valOf(a), bv = valOf(b);
    // Stocks with no value for the sorted column sink to the bottom either
    // way — flipping direction shouldn't promote "no data" to the top.
    if (av == null && bv == null) return a.code.localeCompare(b.code);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * mul || a.code.localeCompare(b.code);
    return (av - bv) * mul || a.code.localeCompare(b.code);
  });
}

function rowHtml(r) {
  const name = state.names[r.code] ? titleCase(state.names[r.code]) : '';
  const sector = state.sectors[r.code] || '—';
  const pf = r.profitFactor != null ? r.profitFactor.toFixed(2)
           : (r.losses === 0 && r.wins > 0 ? '∞' : '—');
  const open = r.openPosition;

  return `<tr>
    <td class="ms1-code-cell">
      <a class="ms1-code" href="/candlestick_chart/candlestick.html?code=${encodeURIComponent(r.code)}"
         title="${escapeHtml(name || r.code)}">${escapeHtml(r.code)}</a>
      ${name ? `<span class="ms1-name">${escapeHtml(name)}</span>` : ''}
    </td>
    <td class="ms1-sector">${escapeHtml(sector)}</td>
    <td class="ms1-num">${r.trades}</td>
    <td class="ms1-num ${cls(r.winRate == null ? null : r.winRate - 50)}">${r.winRate == null ? '—' : r.winRate.toFixed(0) + '%'}</td>
    <td class="ms1-num ms1-strong ${cls(r.totalReturn)}">${fmtPct(r.totalReturn)}</td>
    <td class="ms1-num ${cls(r.buyHoldPct)}">${fmtPct(r.buyHoldPct)}</td>
    <td class="ms1-num ms1-strong ${cls(r.edge)}">${fmtPct(r.edge)}</td>
    <td class="ms1-num ${cls(r.avgR)}">${r.avgR == null ? '—' : (r.avgR > 0 ? '+' : '') + r.avgR.toFixed(2)}</td>
    <td class="ms1-num ${r.profitFactor == null ? '' : cls(r.profitFactor - 1)}">${pf}</td>
    <td class="ms1-num ms1-neg">${r.maxDrawdown == null ? '—' : r.maxDrawdown.toFixed(1) + '%'}</td>
    <td class="ms1-num ms1-exits" title="${r.hitTarget} hit target · ${r.stopped} stopped out · ${r.macdExit} exited on a bearish MACD cross">
      <span class="ms1-pos">${r.hitTarget}</span><span class="ms1-sep">/</span><span class="ms1-neg">${r.stopped}</span><span class="ms1-sep">/</span><span>${r.macdExit}</span>
    </td>
    <td>${open
      ? `<span class="ms1-open" title="Bought ${escapeHtml(open.entryDate)} at ৳${open.entryPrice} · stop ৳${open.stop} · target ৳${open.target} · marked at ৳${open.markPrice}">HOLD <span class="${cls(open.pnlPct)}">${fmtPct(open.pnlPct)}</span></span>`
      : '<span class="ms1-flat">flat</span>'}</td>
  </tr>`;
}

function renderTable() {
  const rows = visibleRows();
  document.getElementById('ms1-body').innerHTML = rows.length
    ? rows.map(rowHtml).join('')
    : `<tr><td colspan="${COLS.length}" class="ms1-none">No stocks match these filters.</td></tr>`;

  const o = state.data.overall;
  document.getElementById('ms1-count-line').textContent =
    `Showing ${rows.length} of ${o.stocksWithData} stocks with usable history`;
}

function render() {
  const d = state.data;
  document.getElementById('ms1-loading').style.display = 'none';

  if (!d) {
    document.getElementById('ms1-empty').style.display = '';
    document.getElementById('ms1-content').style.display = 'none';
    return;
  }
  document.getElementById('ms1-empty').style.display = 'none';
  document.getElementById('ms1-content').style.display = '';

  document.getElementById('ms1-generated').textContent = fmtWhen(d.generatedAt);
  document.getElementById('ms1-count').textContent = d.overall.stocksWithData;

  // Keep the stated rules honest if the scan was run with non-default settings.
  const c = d.cfg || {};
  document.getElementById('ms1-rules').innerHTML =
    `<strong>Buy</strong> when MACD (${c.fast},${c.slow},${c.signal}) crosses above its signal line <em>and</em> the bar closes
     above the ${c.emaPeriod}-EMA → filled at the next bar's open. <strong>Stop</strong> = lowest low of the last
     ${c.stopLookback} bars. <strong>Target</strong> = ${c.targetR}× that risk. <strong>Exit</strong> on stop, target, or a
     bearish MACD cross — whichever comes first. Long only, daily candles, ${c.commissionPct}% commission each side.`;

  const skipped = d.skipped || [];
  document.getElementById('ms1-skipped').textContent = skipped.length
    ? `${skipped.length} symbol${skipped.length === 1 ? '' : 's'} skipped for having too little usable history: ${skipped.map(s => s.code).join(', ')}.`
    : '';

  renderKpis();
  renderHead();
  renderTable();
}

// ─── Wiring ─────────────────────────────────────────────────
function wire() {
  document.getElementById('theme-toggle-btn').addEventListener('click', () => toggleTheme());

  document.getElementById('ms1-run').addEventListener('click', e => runScan(e.currentTarget));
  document.getElementById('ms1-run-empty').addEventListener('click', e => runScan(e.currentTarget));

  let typing = null;
  document.getElementById('ms1-search').addEventListener('input', e => {
    const v = e.target.value;
    clearTimeout(typing);
    typing = setTimeout(() => { state.q = v.trim(); renderTable(); }, 180);
  });

  document.getElementById('ms1-filter').addEventListener('click', e => {
    const b = e.target.closest('.ms1-seg-btn');
    if (!b) return;
    b.parentElement.querySelectorAll('.ms1-seg-btn').forEach(x => x.classList.toggle('active', x === b));
    state.filter = b.dataset.filter;
    renderTable();
  });

  // Delegated so the header can re-render freely without rebinding.
  const sortBy = th => {
    const key = th.dataset.key;
    if (!key) return;
    // Re-clicking the active column flips it; a new column starts descending,
    // which is the useful default for returns, win rates and trade counts.
    state.sort.dir = state.sort.key === key && state.sort.dir === 'desc' ? 'asc' : 'desc';
    state.sort.key = key;
    renderHead();
    renderTable();
  };
  document.getElementById('ms1-head').addEventListener('click', e => {
    const th = e.target.closest('.ms1-th');
    if (th) sortBy(th);
  });
  document.getElementById('ms1-head').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('.ms1-th');
    if (th) { e.preventDefault(); sortBy(th); }
  });
}

// ─── Init ───────────────────────────────────────────────────
(async function init() {
  initTheme();
  wire();
  await loadNames();
  try {
    state.data = await loadSummary();
  } catch (err) {
    document.getElementById('ms1-loading').textContent = `Could not load the stored scan: ${err.message}`;
    return;
  }
  render();
})();
