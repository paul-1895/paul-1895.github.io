'use strict';

import { initTheme, toggleTheme } from '../theme/theme.js';

const API = '';
const SUPER_MODEL_URL = '/super_model/super-model.html';
const AUTO_REFRESH_MS = 60_000;

const state = { names: {}, sectors: {}, suggestions: null, tracking: null, backtest: null, openTrades: null };
let refreshTimer = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

// Every API string is interpolated through this — company names carry "&".
const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const fmtMoney = v => isNum(v) ? `৳${v.toFixed(2)}` : '—';
const fmtPct = (v, dp = 2) => isNum(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%` : '—';
const fmtPlainPct = (v, dp = 1) => isNum(v) ? `${v.toFixed(dp)}%` : '—';
const fmtNum = (v, dp = 1) => isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: dp }) : '—';
const fmtInt = v => isNum(v) ? v.toLocaleString('en-US') : '—';
const pctFrom = (from, to) => (isNum(from) && isNum(to) && from !== 0) ? (to / from - 1) * 100 : null;
const tone = v => !isNum(v) || v === 0 ? '' : v > 0 ? 'xb-pos' : 'xb-neg';

const companyName = (code, given) => given || state.names[code] || '';
const sectorOf = (code, given) => given || state.sectors[code] || '';

async function getJSON(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function showError(el, what, err) {
  el.innerHTML = `<div class="xb-error">Couldn't load ${esc(what)} — ${esc(err && err.message ? err.message : err)}</div>`;
}

const statCell = (label, value, sub = '', cls = '', subCls = '') => `
  <div class="xb-statcell ${cls}">
    <span class="xb-statlabel">${esc(label)}</span>
    <span class="xb-statnum">${value}</span>
    ${sub ? `<span class="xb-statsub ${subCls}">${sub}</span>` : ''}
  </div>`;

// Plain-language names for the gates reported in declined.byGate. Keys match
// what routes/explorer-beta/scan.js actually tallies: engine.js's
// describeGates() row keys (the entry-gate predicates), plus the three the
// scan attributes itself before falling back to a gate row — 'sector' (the
// Bank refusal), 'index' (the DSEX regime gate, which describeGates has no
// row for), 'excluded' (FASFIN / the Sammilito merger banks) — and 'plan'
// for anything else planTrade declined (the max-risk veto, S/R headroom).
const GATE_LABELS = {
  index: 'DSEX regime', sector: 'Sector rule', excluded: 'Excluded ticker', plan: 'Trade plan',
  candleMatch: 'Candle direction', volumeUp: 'Volume confirmation', minRunUp: 'Momentum floor',
  maxRunUp: 'Extension limit', maxWick: 'Wick ceiling', maxWickSell: 'Wick ceiling (sell)',
  minSupportWick: 'Defended lows', minWick: 'Wick floor', extended: 'Stretched-entry wick',
  entryAboveLow: 'Distance from base', weeklyCandle: 'Weekly candle', weeklyVolumeUp: 'Weekly volume',
  deadTape: 'Live tape', trendMatch: 'Trend match', indexTrend: 'Index trend', minPrice: 'Price floor',
  srProximity: 'S/R proximity',
};
const gateLabel = key => GATE_LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

const SIGNAL_LABELS = {
  macd: 'MACD crossover', 'hilega-milega': 'Hilega-Milega', 'liquidity-sweep': 'Liquidity sweep',
  minervini: 'Minervini trend template', sma50: '50-day SMA', supertrend: 'Supertrend',
  'sr-proximity': 'Support/Resistance', seasonality: 'Seasonality', valuation: 'DDM valuation',
  'heikin-ashi': 'Heikin-Ashi', 'breakout-retest': 'Breakout & retest', rsi: 'RSI(14)',
  marubozu: 'Marubozu', 'pin-bar': 'Hammer / shooting star', 'doji-reversal': 'Dragonfly / gravestone doji',
  harami: 'Harami', 'volume-surge': 'Volume surge', 'order-block': 'Order block retest',
  engulfing: 'Engulfing', 'morning-star': 'Morning / evening star',
};
const signalLabel = key => SIGNAL_LABELS[key] || key;
const patternText = p => `${p.direction > 0 ? 'bullish' : p.direction < 0 ? 'bearish' : 'neutral'} ${signalLabel(p.key)}`;

// ─── Banner + stat strip ─────────────────────────────────────────────────────

function renderBanner() {
  const s = state.suggestions;
  const noteEl = $('xb-banner-note');
  if (!s) {
    noteEl.innerHTML = `<span class="xb-neg">The beta notice could not be loaded.</span>`;
    return;
  }
  noteEl.textContent = s.note || 'Explorer Beta is a beta stream with a frozen rule set.';
  $('xb-banner-frozen').textContent = `Engine frozen ${s.frozenOn || ''} · rules are locked — this page only gains features`;
}

function renderStrip() {
  const s = state.suggestions, idx = s && s.index, gate = idx && idx.gate;
  const tr = state.tracking && state.tracking.summary;
  const bt = state.backtest, btBuy = bt && bt.buy;
  const declinedTotal = s && s.declined ? s.declined.total : null;
  const declinedTop = s && s.declined && s.declined.byGate
    ? Object.entries(s.declined.byGate).sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([k, n]) => `${esc(gateLabel(k))} ${n}`).join(' · ')
    : '';

  const tiles = [];
  if (idx) {
    const blocked = !!(gate && gate.buyBlocked);
    tiles.push(statCell('Market gate · DSEX RSI(14)', fmtNum(idx.rsi14, 1),
      blocked ? 'Buys blocked' : 'Buys allowed', blocked ? 'xb-statcell--blocked' : 'xb-statcell--allowed',
      blocked ? 'xb-neg' : 'xb-pos'));
  } else {
    tiles.push(statCell('Market gate', '—', s ? 'no index data' : 'unavailable'));
  }
  tiles.push(statCell('Prices through', s ? esc(s.dataAsOfDate || '—') : '—',
    s ? `${fmtInt(s.universeScanned)} stocks scanned` : 'unavailable'));
  tiles.push(statCell("Today's setups", s ? String(s.buy.length) : '—',
    s ? `score ≥ ${esc(s.threshold)}` : 'unavailable'));
  tiles.push(isNum(declinedTotal)
    ? `<div class="xb-statcell xb-statcell--clickable" id="xb-declined-card" tabindex="0" role="button"
           aria-haspopup="dialog" aria-label="Declined by gates — view full breakdown">
         <span class="xb-statlabel">Declined by gates</span>
         <span class="xb-statnum">${declinedTotal}</span>
         <span class="xb-statsub">${declinedTop || 'none reached the gates'}</span>
       </div>`
    : statCell('Declined by gates', '—', s ? 'none reached the gates' : 'unavailable'));
  tiles.push(statCell('Forward record', tr ? `${fmtInt(tr.total)} tracked` : '—',
    tr ? (isNum(tr.winRate) ? `${fmtPlainPct(tr.winRate)} win rate` : 'no resolved trades yet') : 'unavailable'));
  tiles.push(statCell('Launch backtest', btBuy ? `<span class="${tone(btBuy.avgPnlNet)}">${fmtPct(btBuy.avgPnlNet)}</span>` : '—',
    btBuy ? `net/trade · ${fmtPlainPct(btBuy.winRateNet)} win · ${esc(bt.periodFrom)}–${esc(bt.periodTo)}` : 'unavailable',
    'xb-statcell--hero'));

  $('xb-strip').innerHTML = tiles.join('');
}

// Full gate-decline breakdown behind the "Declined by gates" stat tile — the
// strip only has room for the top two gates, this shows all of them.
function openDeclinedModal() {
  const s = state.suggestions, declined = s && s.declined;
  if (!declined) return;

  const byGate = Object.entries(declined.byGate || {}).sort((a, b) => b[1] - a[1]);
  const blocked = !!(s.index && s.index.gate && s.index.gate.buyBlocked);
  const rows = byGate.length
    ? `<div class="xb-gate-chips">${byGate.map(([k, n]) => `<span class="xb-chip">${esc(gateLabel(k))}<b>${n}</b></span>`).join('')}</div>`
    : `<p class="xb-note xb-note-muted">No conviction candidate (score ≥ ${esc(s.threshold)}) reached the gates.</p>`;

  const candidates = [...(declined.candidates || [])].sort((a, b) => b.score - a.score);
  const candidateTable = candidates.length ? `
    <div class="xb-table-wrap"><table class="xb-table">
      <thead><tr>
        <th scope="col">Code</th><th scope="col">Sector</th><th scope="col" class="xb-th-num">Score</th><th scope="col">Declined at</th>
      </tr></thead>
      <tbody>${candidates.map(c => `
        <tr>
          <td><div class="xb-cell-id">
            <span class="xb-row-code">${esc(c.code)}</span>
            <span class="xb-row-name">${esc(companyName(c.code))}</span>
          </div></td>
          <td class="xb-cell-sector">${esc(sectorOf(c.code, c.sector)) || '—'}</td>
          <td class="xb-cell-num">${fmtNum(c.score, 1)}</td>
          <td class="xb-declined-gate-cell">
            <strong>${esc(gateLabel(c.gate))}</strong>
            ${c.measured ? `<div class="xb-cell-sector">${esc(c.measured)}${c.rule ? ` · ${esc(c.rule)}` : ''}</div>` : ''}
          </td>
        </tr>`).join('')}</tbody>
    </table></div>` : '';

  const modal = document.createElement('div');
  modal.className = 'modal xb-declined-modal';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="xb-declined-modal-title">
      <div class="modal-header">
        <h2 id="xb-declined-modal-title">Declined by gates</h2>
        <button type="button" class="modal-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body xb-declined-modal-body">
        <p class="xb-note">${declined.total} conviction candidate${declined.total === 1 ? '' : 's'}
          reached the gates${s.dataAsOfDate ? ` as of ${esc(s.dataAsOfDate)}` : ''} and ${declined.total === 1 ? 'was' : 'were'}
          declined, counted by the first gate each failed:</p>
        ${rows}
        ${blocked ? `<p class="xb-note xb-note-muted">The DSEX regime gate is currently blocking buys market-wide, so most candidates never got past that before their own setup was even considered.</p>` : ''}
        ${candidateTable}
      </div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  modal.querySelector('.modal-overlay').addEventListener('click', close);
  modal.querySelector('.modal-close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  modal.querySelector('.modal-close').focus();
}

// ─── Today's setups ──────────────────────────────────────────────────────────

function renderSetups() {
  const s = state.suggestions;
  const host = $('xb-setups');
  const buys = s.buy || [];
  $('xb-setups-count').textContent = `${buys.length} · prices through ${s.dataAsOfDate || '—'}`;

  if (!buys.length) { host.innerHTML = emptySetupsCard(s); return; }

  const rows = buys.map((b, i) => {
    const stopPct = pctFrom(b.entry, b.stoploss), tgtPct = pctFrom(b.entry, b.target);
    const locks = b.plan && Array.isArray(b.plan.profitLocks) ? b.plan.profitLocks.length : 0;
    const strong = /^strong/i.test(b.label || '');
    return `
      <tr class="xb-row" data-idx="${i}" tabindex="0" role="button" aria-expanded="false" aria-controls="xb-setup-detail-${i}">
        <td><div class="xb-cell-id">
          <span class="xb-row-code"><span class="xb-row-caret" aria-hidden="true">▸</span>${esc(b.code)}</span>
          <span class="xb-row-name">${esc(companyName(b.code))}</span>
        </div></td>
        <td class="xb-cell-sector">${esc(sectorOf(b.code, b.sector)) || '—'}</td>
        <td><span class="xb-chip xb-chip--buy ${strong ? 'xb-chip--strong' : ''}">${esc(b.label)}</span></td>
        <td class="xb-cell-num">${fmtMoney(b.entry)}</td>
        <td class="xb-cell-num">${fmtMoney(b.stoploss)}<small>${fmtPct(stopPct)}</small></td>
        <td class="xb-cell-num">${fmtMoney(b.target)}<small>${fmtPct(tgtPct)}</small></td>
        <td class="xb-cell-num">${isNum(b.riskReward) ? `1:${b.riskReward.toFixed(1)}` : '—'}</td>
        <td class="xb-cell-num">T+${esc(b.settleBars ?? '—')}</td>
        <td class="xb-cell-num">${locks}</td>
      </tr>
      <tr class="xb-detail" id="xb-setup-detail-${i}" hidden><td colspan="9">${setupDetail(b)}</td></tr>`;
  }).join('');

  host.innerHTML = `
    <div class="xb-table-wrap"><table class="xb-table">
      <thead><tr>
        <th scope="col">Code</th><th scope="col">Sector</th><th scope="col">Label</th>
        <th scope="col" class="xb-th-num">Entry</th><th scope="col" class="xb-th-num">Stop</th><th scope="col" class="xb-th-num">Target</th>
        <th scope="col" class="xb-th-num">R:R</th><th scope="col" class="xb-th-num">Settle</th><th scope="col" class="xb-th-num">Locks</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

  // One delegated handler: click or Enter/Space on a row toggles its detail row.
  const toggle = row => {
    const detail = $(row.getAttribute('aria-controls'));
    const open = row.getAttribute('aria-expanded') === 'true';
    row.setAttribute('aria-expanded', String(!open));
    detail.hidden = open;
  };
  const tbody = host.querySelector('tbody');
  tbody.addEventListener('click', e => { const row = e.target.closest('.xb-row'); if (row) toggle(row); });
  tbody.addEventListener('keydown', e => {
    const row = e.target.closest('.xb-row');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(row); }
  });
}

function setupDetail(b) {
  const reasoning = Array.isArray(b.reasoning) ? b.reasoning : [];
  const sentence = reasoning.length >= 2 ? reasoning[reasoning.length - 2] : '';
  const rules = Array.isArray(b.managementRules) ? b.managementRules : [];
  const checks = Array.isArray(b.checks) ? b.checks : [];
  const scored = (b.signals || []).filter(sg => sg.scored);

  const gateRows = checks.map(c => `
    <tr class="${c.applies === false ? 'xb-gate-na' : ''}">
      <td>${esc(c.label || c.key)}</td>
      <td class="xb-mono">${esc(c.measured ?? '—')}</td>
      <td>${esc(c.rule || '')}</td>
      <td class="xb-tick ${c.applies === false ? '' : c.pass ? 'xb-pos' : 'xb-neg'}">${c.applies === false ? 'n/a' : c.pass ? '✓' : '✗'}</td>
    </tr>`).join('');

  return `<div class="xb-detail-body">
    ${sentence ? `<div><h3>Entry &amp; exit</h3><p>${esc(sentence)}</p></div>` : ''}
    ${rules.length ? `<div><h3>Management rules</h3><ol>${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>` : ''}
    ${gateRows ? `<div><h3>Gates cleared</h3><table class="xb-gates">
        <thead><tr><th scope="col">Gate</th><th scope="col">Measured</th><th scope="col">Rule</th><th scope="col"><span class="xb-sr-only">Pass/fail</span></th></tr></thead><tbody>${gateRows}</tbody></table></div>` : ''}
    ${scored.length ? `<div><h3>Scored signals · score ${fmtNum(b.score, 1)}</h3><ul>${scored.map(sg => `
        <li><span class="xb-sig-key">${esc(signalLabel(sg.key))}</span><span class="xb-sig-contrib">+${fmtNum(sg.contribution, 1)}</span>
            ${sg.reason ? ` — ${esc(sg.reason)}` : ''}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

// The empty state has to say WHY: the index regime and the first-gate breakdown.
function emptySetupsCard(s) {
  const idx = s.index, gate = idx && idx.gate, blocked = !!(gate && gate.buyBlocked);
  const declined = s.declined || { total: 0, byGate: {} };
  const byGate = Object.entries(declined.byGate || {}).sort((a, b) => b[1] - a[1]);

  let gateLine;
  if (!idx) {
    gateLine = `<p><strong>Market gate:</strong> no DSEX data was available to test the index regime, so the index gate could not be evaluated.</p>`;
  } else {
    const rsi = fmtNum(idx.rsi14, 1);
    const pos = idx.above50Sma ? 'above' : 'below';
    gateLine = `<p><strong>Market gate ${blocked ? '— buys blocked' : '— open'}:</strong>
      DSEX RSI(14) is <strong>${rsi}</strong> as of ${esc(idx.asOfDate)}, close ${fmtNum(idx.close, 1)} sits ${pos} its 50-day SMA
      (${fmtNum(idx.sma50, 1)}). Rule: <span class="xb-rule">${esc(gate ? gate.rule : '—')}</span>.
      ${blocked ? 'While this holds, every candidate is refused before its own setup is even considered.' : 'The index regime is not what stopped today’s candidates.'}</p>`;
  }

  const declinedBlock = declined.total > 0
    ? `<p><strong>${declined.total}</strong> conviction candidate${declined.total === 1 ? '' : 's'} reached the gates today and ${declined.total === 1 ? 'was' : 'were'} declined, counted by the first gate each failed:</p>
       <div class="xb-gate-chips">${byGate.map(([k, n]) => `<span class="xb-chip">${esc(gateLabel(k))}<b>${n}</b></span>`).join('')}</div>`
    : `<p>No conviction candidate (score ≥ ${esc(s.threshold)}) reached the gates today.</p>`;

  return `<div class="xb-empty-card ${blocked ? '' : 'xb-empty-card--open'}">
    <h3 class="xb-empty-title">No setups pass today</h3>
    ${gateLine}
    ${declinedBlock}
    <p class="xb-empty-vow">Explorer Beta never relaxes its gates to produce a list. When nothing passes, the honest answer is an empty table.</p>
  </div>`;
}

// ─── Open trades ─────────────────────────────────────────────────────────────

const ACTIONS = {
  HOLD:              { label: 'Hold',                     cls: 'xb-action--hold'  },
  TAKE_PROFIT:       { label: 'Take profit',              cls: 'xb-action--gain'  },
  LOCK_HIT:          { label: 'Lock hit — sell',          cls: 'xb-action--gain'  },
  STOP_IF_CLOSE:     { label: 'Stop if close below',      cls: 'xb-action--loss'  },
  SR_BREAK_IF_CLOSE: { label: 'Support break if close',   cls: 'xb-action--warn'  },
  FROZEN:            { label: 'Frozen · settlement',      cls: 'xb-action--muted' },
};
const OUTCOMES = { stoploss: 'stop-loss', target: 'target', expired: 'holding window expired' };
const STATUS_GROUPS = [
  ['managed', 'Managed — live instruction'],
  ['plan-exited', 'Plan-exited — outside the plan'],
  ['unsupported', 'Outside the rules'],
];

async function loadOpenTrades() {
  const btn = $('xb-refresh-btn'), label = $('xb-refresh-label');
  btn.disabled = true; label.textContent = 'Refreshing…';
  try {
    state.openTrades = await getJSON('/api/explorer-beta/open-trades');
    renderOpenTrades();
  } catch (err) {
    showError($('xb-trades'), 'open trades', err);
    $('xb-market-line').textContent = '';
  } finally {
    btn.disabled = false; label.textContent = 'Refresh';
  }
}

function renderOpenTrades() {
  const o = state.openTrades;
  const trades = o.trades || [];
  const m = o.market || {};

  $('xb-trades-count').textContent = `${trades.length} open position${trades.length === 1 ? '' : 's'}`;
  $('xb-trades-note').textContent = o.note || '';
  $('xb-market-line').innerHTML = [
    `Dhaka <strong>${esc(m.dhakaTime || '—')}</strong>`,
    `<span class="${m.open ? 'xb-pos' : ''}">${m.open ? 'market open' : 'market closed'}</span>`,
    m.quotesLive ? `<span class="xb-badge xb-badge--live">quotes live</span>` : `<span class="xb-badge">last-session quotes</span>`,
    m.quoteError ? `<span class="xb-neg">quote error: ${esc(m.quoteError)}</span>` : '',
    m.open ? `auto-refresh every ${AUTO_REFRESH_MS / 1000} s` : '',
  ].filter(Boolean).join(' · ');

  const host = $('xb-trades');
  if (!trades.length) { host.innerHTML = `<div class="xb-empty">No open positions on the Trades page.</div>`; }
  else {
    host.innerHTML = STATUS_GROUPS.map(([status, title]) => {
      const group = trades.filter(t => t.status === status);
      if (!group.length) return '';
      return `<h3 class="xb-subhd">${esc(title)} (${group.length})</h3>
              <div class="xb-cards">${group.map(tradeCard).join('')}</div>`;
    }).join('');
  }
  scheduleAutoRefresh(!!m.open);
}

// Auto-refresh only while the session is open; a closed market has nothing new to show.
function scheduleAutoRefresh(marketOpen) {
  clearInterval(refreshTimer);
  refreshTimer = marketOpen ? setInterval(loadOpenTrades, AUTO_REFRESH_MS) : null;
}

function tradeCard(t) {
  const name = companyName(t.code, t.name), sector = sectorOf(t.code, t.sector);
  const a = t.assessment;
  const act = a && ACTIONS[a.action];
  const head = `
    <header class="xb-trade-hd">
      <div class="xb-trade-id">
        <span class="xb-code">${esc(t.code)}</span>
        ${name ? `<span class="xb-name">${esc(name)}</span>` : ''}
        ${sector ? `<span class="xb-sector">${esc(sector)}</span>` : ''}
      </div>
      ${act ? `<span class="xb-action ${act.cls}" title="${esc(a.action)}">${esc(act.label)}</span>`
            : t.status === 'plan-exited' ? `<span class="xb-action xb-action--muted">No instruction</span>`
            : `<span class="xb-action xb-action--muted">Unsupported</span>`}
    </header>
    <div class="xb-trade-meta">
      <b>${esc((t.side || '').toUpperCase())}</b> · ${fmtInt(t.unit)} units · entered ${esc(t.entryDate || '—')} @ <b>${fmtMoney(t.entryPrice)}</b>
      ${isNum(t.barsHeld) ? ` · ${t.barsHeld} bar${t.barsHeld === 1 ? '' : 's'} held` : ''}
      ${t.settleBars ? ` · T+${esc(t.settleBars)}${t.settled === false ? ' (not yet settled)' : ''}` : ''}
    </div>`;

  let body;
  if (t.status === 'unsupported') {
    body = `<p class="xb-reason">${esc(t.reason || 'Outside Explorer Beta’s rules.')}</p>`;
  } else if (t.status === 'plan-exited') {
    const px = t.planExit || {};
    // The engine reports a ratcheted profit-lock exit as outcome "stoploss" too;
    // a stop that booked a gain is a locked profit, so say so.
    const outcome = px.outcome === 'stoploss' && px.pnlPct > 0 ? 'profit-lock stop' : (OUTCOMES[px.outcome] || px.outcome || '—');
    body = `${quoteBlock(t)}
      <div class="xb-planexit">Explorer Beta would have closed this on <b>${esc(px.exitDate || '—')}</b> at
        <b>${fmtMoney(px.exitPrice)}</b> (<b class="${tone(px.pnlPct)}">${fmtPct(px.pnlPct)}</b>, ${esc(outcome)})
        — the position is now outside the plan; it carries no further instruction.</div>`;
  } else {
    body = `${quoteBlock(t)}
      ${a && a.headline ? `<p class="xb-headline">${esc(a.headline)}</p>` : ''}
      ${a && Array.isArray(a.details) && a.details.length ? `<ul class="xb-details">${a.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      ${levelsRow(t)}
      ${candlesLine(t.candles)}`;
  }

  const rules = Array.isArray(t.managementRules) && t.managementRules.length
    ? `<details class="xb-rules"><summary>Rules</summary><ol>${t.managementRules.map(r => `<li>${esc(r)}</li>`).join('')}</ol></details>`
    : '';

  return `<article class="xb-trade xb-trade--${esc(t.status)}" data-trade-id="${esc(t.id)}">${head}${body}${rules}</article>`;
}

function quoteBlock(t) {
  const q = t.quote;
  if (!q) return `<div class="xb-trade-quote"><span class="xb-price">—</span><span class="xb-pnl"><small>P&amp;L</small>—</span></div>`;
  const badge = q.live
    ? `<span class="xb-badge xb-badge--live">live</span>`
    : `<span class="xb-badge">last session · ${esc(q.asOfDate || '—')}</span>`;
  return `<div class="xb-trade-quote">
    <span class="xb-price">${fmtMoney(q.ltp)} ${badge} <span class="xb-chg ${tone(q.changePct)}">${fmtPct(q.changePct)}</span></span>
    <span class="xb-pnl ${tone(t.pnlPct)}"><small>P&amp;L</small>${fmtPct(t.pnlPct)}</span>
  </div>`;
}

// Stop / lock / target / support-break, each with its distance from the current price.
function levelsRow(t) {
  const a = t.assessment || {}, st = t.state || {}, ltp = a.ltp ?? (t.quote && t.quote.ltp);
  const dist = (level, given) => isNum(given) ? given : pctFrom(ltp, level);
  const cell = (lbl, level, d, tag = '') => `
    <div class="xb-level">
      <span class="xb-level-lbl">${lbl}</span>
      <span class="xb-level-val">${fmtMoney(level)}</span>
      ${isNum(level) ? `<span class="xb-level-dist">${fmtPct(d)} vs price</span>` : ''}
      ${tag ? `<span class="xb-level-tag">${tag}</span>` : ''}
    </div>`;
  const stopNow = a.stopNow ?? st.effectiveStop;
  const lock = a.lockStop ?? st.lockStop;
  const binding = a.lockBinding ?? st.lockBinding;
  return `<div class="xb-levels">
    ${cell('Stop now', stopNow, dist(stopNow, a.distToStopPct))}
    ${cell('Lock', lock, dist(lock), isNum(lock) && binding ? 'binding' : '')}
    ${cell('Target', a.target ?? (t.plan && t.plan.target), dist(a.target ?? (t.plan && t.plan.target), a.distToTargetPct))}
    ${cell('Support break', a.srBreakExitLevel ?? (t.plan && t.plan.srBreakExitLevel), dist(a.srBreakExitLevel ?? (t.plan && t.plan.srBreakExitLevel)))}
  </div>`;
}

function candlesLine(c) {
  if (!c) return '';
  const list = pats => pats && pats.length
    ? pats.map(p => `<span class="xb-pattern" title="${esc(p.reason || '')}">${esc(patternText(p))}</span>`).join(', ')
    : 'no pattern';
  const last = c.lastCompleted ? `<b>Candles</b> · last completed ${esc(c.lastCompleted.date)}: ${list(c.lastCompleted.patterns)}` : '<b>Candles</b> · —';
  const live = c.live ? ` · live ${esc(c.live.date)} (provisional): ${list(c.live.patterns)}` : '';
  const caveat = c.live ? `<span class="xb-caveat">live candle open approximated by yesterday's close</span>` : '';
  return `<div class="xb-candles">${last}${live}${caveat}</div>`;
}

// ─── Forward record ──────────────────────────────────────────────────────────

const STATUS_LABELS = { open: 'Open', target: 'Target hit', stoploss: 'Stopped', expired: 'Expired', stale: 'Stale' };

function renderTracking() {
  const tr = state.tracking, sm = tr.summary || {}, list = tr.suggestions || [];
  $('xb-record-count').textContent = `${fmtInt(sm.total)} issued · max hold ${fmtInt(tr.maxHoldBars)} bars`;

  const tiles = [
    statCell('Tracked', fmtInt(sm.total)),
    statCell('Open', fmtInt(sm.open)),
    statCell('Resolved', fmtInt(sm.closed)),
    statCell('Hit target', fmtInt(sm.target)),
    statCell('Stopped', fmtInt(sm.stoploss), isNum(sm.lockedStops) ? `of which locked profits ${fmtInt(sm.lockedStops)}` : ''),
    statCell('Expired', fmtInt(sm.expired), `${fmtInt(tr.maxHoldBars)}-bar holding window`),
    statCell('Win rate', fmtPlainPct(sm.winRate), isNum(sm.winRate) ? '' : 'needs resolved trades'),
    statCell('Avg P&L', `<span class="${tone(sm.avgPnlPct)}">${fmtPct(sm.avgPnlPct)}</span>`, isNum(sm.avgDaysHeld) ? `avg ${fmtNum(sm.avgDaysHeld, 1)} days held` : '', 'xb-statcell--hero'),
  ].join('');

  const table = list.length ? `
    <div class="xb-table-wrap"><table class="xb-table">
      <thead><tr>
        <th scope="col">Issued</th><th scope="col">Code</th><th scope="col">Label</th>
        <th scope="col" class="xb-th-num">Entry</th><th scope="col" class="xb-th-num">Stop</th><th scope="col" class="xb-th-num">Target</th>
        <th scope="col">Status</th><th scope="col">Exit</th><th scope="col" class="xb-th-num">P&amp;L</th>
      </tr></thead>
      <tbody>${list.map(r => `
        <tr>
          <td class="xb-cell-num" style="text-align:left">${esc(r.issuedDate)}</td>
          <td><div class="xb-cell-id"><span class="xb-row-code">${esc(r.code)}</span><span class="xb-row-name">${esc(companyName(r.code))}</span></div></td>
          <td><span class="xb-chip xb-chip--buy ${/^strong/i.test(r.label || '') ? 'xb-chip--strong' : ''}">${esc(r.label)}</span></td>
          <td class="xb-cell-num">${fmtMoney(r.entry)}</td>
          <td class="xb-cell-num">${fmtMoney(r.stoploss)}</td>
          <td class="xb-cell-num">${fmtMoney(r.target)}</td>
          <td><span class="xb-chip ${r.status === 'target' ? 'xb-chip--buy' : r.status === 'stoploss' ? 'xb-chip--loss' : ''}">${esc(STATUS_LABELS[r.status] || r.status)}</span></td>
          <td class="xb-cell-num" style="text-align:left">${r.exitDate ? `${esc(r.exitDate)} @ ${fmtMoney(r.exitPrice)}` : '—'}</td>
          <td class="xb-cell-num ${tone(r.pnlPct)}">${fmtPct(r.pnlPct)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`
    : `<div class="xb-empty">No suggestions issued yet — the record starts the first day a setup passes every gate.</div>`;

  $('xb-record').innerHTML = `<div class="xb-statgrid">${tiles}</div>${table}`;
}

// ─── Launch evidence ─────────────────────────────────────────────────────────

function renderBacktest() {
  const bt = state.backtest, b = bt.buy || {};
  $('xb-evidence-count').textContent = `Explorer 2-year backtest · ${bt.periodFrom || '—'} – ${bt.periodTo || '—'}`;

  const tiles = [
    statCell('Trades', fmtInt(b.n)),
    statCell('Win rate (net)', fmtPlainPct(b.winRateNet)),
    statCell('Avg P&L (net)', `<span class="${tone(b.avgPnlNet)}">${fmtPct(b.avgPnlNet)}</span>`, isNum(b.costPct) ? `after ${fmtPlainPct(b.costPct)} round-trip cost` : '', 'xb-statcell--hero'),
    statCell('Hit target', fmtPlainPct(b.targetPct)),
    statCell('Stopped at a loss', fmtPlainPct(b.lossStopPct)),
    statCell('P&L stdev', fmtPlainPct(b.pnlStdev)),
    statCell('Avg bars held', fmtNum(b.avgBarsHeld, 1)),
    statCell('Period', `<span class="xb-statnum--sm">${esc(bt.periodFrom || '—')}<br>${esc(bt.periodTo || '—')}</span>`, `${fmtInt(bt.stocks)} stocks`),
  ].join('');

  const extra = Array.isArray(bt.caveats) && bt.caveats.length
    ? `<ul class="xb-caveat-list">${bt.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '';

  $('xb-evidence').innerHTML = `
    <div class="xb-statgrid">${tiles}</div>
    <p class="xb-caveat"><strong>Read these numbers as an upper bound.</strong> Every rule in this set was selected
      in-sample — after seeing the same two years it is scored on — and several of them (the 5% stop cap, the
      1:2.5 / 12% target caps, the profit-lock ladder) are risk preferences rather than measured edge. The backtested
      return is concentrated in a handful of thin financial names where the fills it assumes may not have been
      available. The forward record above is the only figure that can confirm or refute this; until it is large
      enough to compare, the backtest is the ceiling, not the expectation.</p>
    ${extra}
    <a class="xb-evidence-link" href="${SUPER_MODEL_URL}">Full Explorer backtest, trade list and portfolio simulation → Super Model</a>`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  initTheme();
  $('theme-toggle-btn').addEventListener('click', () => toggleTheme());
  $('xb-refresh-btn').addEventListener('click', loadOpenTrades);
  $('xb-strip').addEventListener('click', e => { if (e.target.closest('#xb-declined-card')) openDeclinedModal(); });
  $('xb-strip').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('#xb-declined-card')) { e.preventDefault(); openDeclinedModal(); }
  });

  // Fetch everything at once, but render each section on its own so one
  // failing endpoint leaves the rest of the page standing.
  const [names, sectors, suggestions, tracking, backtest, openTrades] = await Promise.allSettled([
    getJSON('/api/company-names'),
    getJSON('/api/sectors'),
    getJSON('/api/explorer-beta/suggestions'),
    getJSON('/api/explorer-beta/tracking'),
    getJSON('/api/explorer-beta/backtest'),
    getJSON('/api/explorer-beta/open-trades'),
  ]);
  if (names.status === 'fulfilled') state.names = names.value.names || {};
  if (sectors.status === 'fulfilled') state.sectors = sectors.value || {};
  if (suggestions.status === 'fulfilled') state.suggestions = suggestions.value;
  if (tracking.status === 'fulfilled') state.tracking = tracking.value;
  if (backtest.status === 'fulfilled') state.backtest = backtest.value;
  if (openTrades.status === 'fulfilled') state.openTrades = openTrades.value;

  renderBanner();
  renderStrip();

  const sections = [
    [suggestions, "today's setups", 'xb-setups', renderSetups],
    [openTrades, 'open trades', 'xb-trades', renderOpenTrades],
    [tracking, 'the forward record', 'xb-record', renderTracking],
    [backtest, 'the launch backtest', 'xb-evidence', renderBacktest],
  ];
  for (const [result, what, hostId, render] of sections) {
    if (result.status !== 'fulfilled') { showError($(hostId), what, result.reason); continue; }
    try { render(); } catch (err) { showError($(hostId), what, err); }
  }
}

boot();
