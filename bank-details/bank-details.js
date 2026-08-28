/* ================================================================
   bank-details.js  —  Yearly Bank Details Spreadsheet
   Columns = years, in whatever order the user last left them (drag
   the ⠿ handle on a column header, in Edit mode, to reorder).
   Rows = fixed 25 bank metrics.
   ================================================================ */
'use strict';

const API = '/api/bank-details-grid';

/* ── Fixed row definitions ──────────────────────────────────── */
// Defined in /shared/bank-rows.js so the candlestick sidebar can label the
// same cells this page writes. See the header there.
const BANK_ROWS = window.BANK_ROWS;

/* ── Icons + per-row metadata ──────────────────────────────────
   One small set of reusable 24x24 line-icon paths (stroke=currentColor),
   coloured per row so the icon badge's colour comes from wherever it's
   placed rather than needing 25 hand-tinted variants. */
const ICON_SVG = {
  bank:     '<path d="M3 21h18M4 21V9l8-5 8 5v12M9 21v-6h6v6"/>',
  branch:   '<path d="M4 21h16M6 21V11l6-4 6 4v10M10 21v-5h4v5"/>',
  atm:      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6M7 17h4"/>',
  card:     '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  people:   '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M10 20c0-2.2 1-4.2 2.6-5.5A6 6 0 0122 20"/>',
  person:   '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  alert:    '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  money:    '<path d="M12 3c-1.5 2-4 2.5-4 5.5 0 2.5 1.8 4.5 4 4.5s4-2 4-4.5C16 5.5 13.5 5 12 3z"/><path d="M4 12c0 5 3.6 9 8 9s8-4 8-9"/>',
  coins:    '<ellipse cx="8" cy="8" rx="6" ry="3"/><path d="M2 8v4c0 1.7 2.7 3 6 3s6-1.3 6-3V8"/><ellipse cx="16" cy="14" rx="6" ry="3"/><path d="M10 14v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4"/>',
  bars:     '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  pie:      '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/>',
  trend:    '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  hash:     '<path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/>',
  wave:     '<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
  shield:   '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/>',
  star:     '<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.8 5.8 21l1.4-7L2 9.3l7-.8L12 2z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.7 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.7-3.5-9S9.5 5.5 12 3z"/>',
  percent:  '<circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M18 6 6 18"/>',
};
function ICON(name, size) {
  const d = ICON_SVG[name] || ICON_SVG.hash;
  return `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

const ROW_META = {
  branches:        { icon: 'bank',     color: '#1a5cff' },
  sub_branches:    { icon: 'branch',   color: '#6366f1' },
  atms:            { icon: 'atm',      color: '#0d9488' },
  debit_cards:     { icon: 'card',     color: '#0891b2' },
  credit_cards:    { icon: 'card',     color: '#0284c7' },
  agents:          { icon: 'people',   color: '#db2777' },
  npl:             { icon: 'alert',    color: '#d97706' },
  employees:       { icon: 'person',   color: '#7c3aed' },
  total_deposit:   { icon: 'money',    color: '#ea580c' },
  paid_up_capital: { icon: 'coins',    color: '#c2410c' },
  auth_capital:    { icon: 'bars',     color: '#f59e0b' },
  casa_ratio:      { icon: 'pie',      color: '#3b82f6' },
  roa:             { icon: 'trend',    color: '#16a34a' },
  roe:             { icon: 'trend',    color: '#15803d' },
  pe:              { icon: 'hash',     color: '#64748b' },
  eps:             { icon: 'coins',    color: '#22c55e' },
  nocfps:          { icon: 'wave',     color: '#0d9488' },
  profit:          { icon: 'trend',    color: '#059669' },
  lt_rating:       { icon: 'shield',   color: '#4f46e5' },
  st_rating:       { icon: 'shield',   color: '#6366f1' },
  app_rating:      { icon: 'star',     color: '#eab308' },
  app_downloads:   { icon: 'download', color: '#2563eb' },
  fd_rate:         { icon: 'percent',  color: '#d97706' },
  customers:       { icon: 'people',   color: '#9333ea' },
  remittance:      { icon: 'globe',    color: '#0891b2' },
};

const KPI_METRICS = [
  { key: 'branches',      label: 'Total Branches'  },
  { key: 'atms',          label: 'Total ATMs'      },
  { key: 'employees',     label: 'Total Employees' },
  { key: 'total_deposit', label: 'Total Deposit'   },
];

const INSIGHT_METRICS = [
  { key: 'branches',  title: 'Branches Growth',  noun: 'branches'  },
  { key: 'atms',       title: 'ATM Expansion',    noun: 'ATMs'      },
  { key: 'employees', title: 'Workforce Growth', noun: 'employees' },
  { key: 'agents',    title: 'Agent Network',    noun: 'agents'    },
];

const YEAR_HEADER_COLORS = ['#1a5cff', '#16a34a', '#7c3aed', '#ea580c', '#0891b2', '#db2777'];

/* ── State ─────────────────────────────────────────────────── */
// cells stored as: cells[rowKey][colId] = value
let state = {
  columns: [],   // [{ id, label }]  label = year e.g. "2024"
  cells:   {},   // { rowKey: { colId: value } }
};
let editMode  = false;
let stockCode = '';
let saveTimer = null;
let dirty     = false; // true only while an edit hasn't been persisted yet

/* ── Boot ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  stockCode    = (params.get('code') || '').toUpperCase();

  const codeEl   = document.getElementById('bd-code');
  const backEl   = document.getElementById('bd-back-link');
  const chartsEl = document.getElementById('bd-view-charts');
  if (codeEl) codeEl.textContent = stockCode || '—';
  if (backEl) backEl.href = `/company_profile/company.html?code=${encodeURIComponent(stockCode)}`;
  if (chartsEl) chartsEl.href = `/candlestick_chart/candlestick.html?code=${encodeURIComponent(stockCode)}`;
  document.title = `${stockCode} Bank Details — DSE`;

  await load();
  document.getElementById('bd-toggle-mode').addEventListener('click', toggleMode);
});

/* ── API ────────────────────────────────────────────────────── */
async function load() {
  setLoading(true);
  try {
    const res = await fetch(`${API}/${stockCode}`);
    if (res.ok) {
      const d = await res.json();
      state.columns = d.columns || [];
      state.cells   = d.cells   || {};
    } else {
      toast('Failed to load saved data', 'error');
    }
  } catch {
    toast('Failed to load saved data', 'error');
  }
  setLoading(false);
  render();
}

async function persist() {
  try {
    await fetch(`${API}/${stockCode}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(state),
    });
    dirty = false;
    toast('Saved', 'success');
  } catch { toast('Save failed', 'error'); }
}

function deferSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
}

// Flush an edit that hasn't been persisted yet when the user navigates away.
// Guarded on `dirty` so a page that was only ever viewed (e.g. a tab left open
// from an earlier session) can't blindly resave its stale in-memory state
// over data that has since changed on the server.
window.addEventListener('pagehide', () => {
  if (!dirty) return;
  clearTimeout(saveTimer);
  dirty = false;
  try {
    fetch(`${API}/${stockCode}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      keepalive: true,
    });
  } catch { /* best effort */ }
});

/* ── Mode toggle ─────────────────────────────────────────────── */
function toggleMode() {
  editMode = !editMode;
  const btn    = document.getElementById('bd-toggle-mode');
  const badge  = document.getElementById('bd-mode-badge');
  const addBtn = document.getElementById('bd-add-col');
  if (editMode) {
    btn.innerHTML      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>Done Editing`;
    btn.className      = 'fund-btn fund-btn--edit-active';
    badge.textContent  = 'EDIT';
    badge.className    = 'fund-mode-badge fund-mode-badge--edit';
    if (addBtn) addBtn.style.display = 'inline-flex';
  } else {
    btn.innerHTML      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Edit Data`;
    btn.className      = 'fund-btn fund-btn--primary';
    badge.textContent  = 'VIEW';
    badge.className    = 'fund-mode-badge fund-mode-badge--view';
    if (addBtn) addBtn.style.display = 'none';
  }
  render();
}

/* ── Column ops ─────────────────────────────────────────────── */
// Column order is manual now (drag the ⠿ handle to reorder) — nothing
// re-sorts it automatically. A new column defaults to a year older than
// whatever's currently on screen and joins at the far left, matching the
// "fill in the archive backwards" workflow described on suggestPrevYear().
function addColumn() {
  const id    = 'c' + Date.now();
  const label = suggestPrevYear();
  state.columns = [{ id, label }, ...state.columns];
  render();
  deferSave();
}

function deleteColumn(id) {
  state.columns = state.columns.filter(c => c.id !== id);
  BANK_ROWS.forEach(r => {
    if (state.cells[r.key]) delete state.cells[r.key][id];
  });
  render();
  deferSave();
}

function onColLabelChange(id, val) {
  const col = state.columns.find(c => c.id === id);
  if (col) col.label = val;
  deferSave();
}

/* ── Column drag-to-reorder ─────────────────────────────────── */
let _dragColId      = null;
let _dragOverBefore = true;

function _clearDragVisuals() {
  document.querySelectorAll('.fund-col-th').forEach(el => {
    el.classList.remove('bd-col-dragging', 'bd-col-drop-before', 'bd-col-drop-after');
  });
}

function onColDragStart(e, id) {
  if (!editMode) { e.preventDefault(); return; }
  _dragColId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id); // required by Firefox to allow the drag
  const th = e.currentTarget.closest('th');
  if (th) th.classList.add('bd-col-dragging');
}

function onColDragOver(e, id) {
  if (!editMode || !_dragColId) return;
  e.preventDefault(); // required to allow a drop
  e.dataTransfer.dropEffect = 'move';
  if (id === _dragColId) return;

  const th     = e.currentTarget;
  const rect   = th.getBoundingClientRect();
  const before = (e.clientX - rect.left) < rect.width / 2;
  _dragOverBefore = before;

  document.querySelectorAll('.fund-col-th').forEach(el => {
    if (el !== th) el.classList.remove('bd-col-drop-before', 'bd-col-drop-after');
  });
  th.classList.toggle('bd-col-drop-before', before);
  th.classList.toggle('bd-col-drop-after', !before);
}

function onColDrop(e, id) {
  if (!editMode || !_dragColId) return;
  e.preventDefault();
  const fromId = _dragColId;
  const before = _dragOverBefore;
  _clearDragVisuals();
  _dragColId = null;
  if (fromId === id) return;

  const cols    = state.columns.slice();
  const fromIdx = cols.findIndex(c => c.id === fromId);
  if (fromIdx === -1) return;
  const [moved] = cols.splice(fromIdx, 1);
  let toIdx = cols.findIndex(c => c.id === id);
  if (toIdx === -1) {
    cols.push(moved);
  } else {
    if (!before) toIdx += 1;
    cols.splice(toIdx, 0, moved);
  }

  const prevRects = _flipCapture();
  state.columns = cols;
  render();
  _flipPlay(prevRects);
  deferSave();
}

function onColDragEnd() {
  _dragColId = null;
  _clearDragVisuals();
}

// ── FLIP animation (First/Last/Invert/Play) ────────────────────
// Reordering re-renders the whole table (innerHTML swap), so there's no
// single DOM node that "moves" — instead we record each column's on-screen
// left edge before the swap, let the re-render jump everything straight to
// its new position, then invert that jump with a transform and let it
// transition back to zero. Runs on the header + every body cell in a moved
// column so the whole column slides as one visual unit, not just its header.
function _flipCapture() {
  const rects = new Map();
  document.querySelectorAll('[data-col-id]').forEach(el => {
    const id = el.getAttribute('data-col-id');
    if (!rects.has(id)) rects.set(id, el.getBoundingClientRect().left);
  });
  return rects;
}

function _flipPlay(prevRects) {
  const byId = new Map();
  document.querySelectorAll('[data-col-id]').forEach(el => {
    const id = el.getAttribute('data-col-id');
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(el);
  });

  const toAnimate = [];
  byId.forEach((els, id) => {
    if (!prevRects.has(id)) return;
    const dx = prevRects.get(id) - els[0].getBoundingClientRect().left;
    if (Math.abs(dx) < 1) return;
    els.forEach(el => {
      el.style.transition = 'none';
      el.style.transform   = `translateX(${dx}px)`;
      toAnimate.push(el);
    });
  });
  if (!toAnimate.length) return;

  // Force layout so the "Invert" jump above is committed before we relax it
  // back to zero on the next frame — otherwise the browser coalesces both
  // style writes and nothing appears to animate at all.
  void toAnimate[0].offsetWidth;

  requestAnimationFrame(() => {
    toAnimate.forEach(el => {
      el.style.transition = 'transform 220ms ease';
      el.style.transform   = '';
    });
    setTimeout(() => {
      toAnimate.forEach(el => { el.style.transition = ''; el.style.transform = ''; });
    }, 260);
  });
}

/* ── Column resize ──────────────────────────────────────────── */
const COL_MIN_WIDTH = 90;
const COL_MAX_WIDTH = 420;

function onColResizeStart(e, id) {
  e.preventDefault();
  e.stopPropagation(); // keep this from ever being read as a reorder drag
  const col = state.columns.find(c => c.id === id);
  const th  = e.currentTarget.closest('th');
  if (!col || !th) return;

  const startWidth  = th.getBoundingClientRect().width;
  const startX      = e.clientX;
  const resizer     = e.currentTarget;
  resizer.classList.add('bd-col-resizing');
  th.classList.add('bd-col-th-resizing');

  // Without suppressing selection, a fast drag reads as a native text-select
  // gesture over the table instead of a resize — the column barely moves and
  // the header/cell labels highlight blue instead. Same fix this app already
  // uses for the candlestick page's column resizers (tv-sidebar.js).
  document.body.style.cursor     = 'col-resize';
  document.body.style.userSelect = 'none';

  const tip = document.createElement('div');
  tip.className = 'bd-col-resize-tip';
  document.body.appendChild(tip);

  // Read the header's bottom edge ONCE, before the drag starts — it can't
  // move during a horizontal-only resize. Re-reading it from inside onMove
  // (right after writing th.style.width on the very same element) forced a
  // synchronous layout on every single pointermove: write, then read, then
  // write again next tick — classic layout-thrashing, and the visible cause
  // of the flicker while dragging.
  const tipTop = th.getBoundingClientRect().bottom + 6;
  tip.style.top = tipTop + 'px';

  function positionTip(px, w) {
    tip.textContent = w + 'px';
    tip.style.left = px + 'px';
  }
  positionTip(e.clientX, Math.round(startWidth));

  let moved   = false;
  let pending = null;   // latest clientX awaiting a paint
  let raf     = null;
  function applyWidth(clientX) {
    const w = Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, Math.round(startWidth + (clientX - startX))));
    th.style.width = th.style.minWidth = th.style.maxWidth = w + 'px';
    positionTip(clientX, w);
  }
  function onMove(ev) {
    moved = true;
    pending = ev.clientX;
    // Coalesce a fast run of pointermove events into one DOM write per
    // frame instead of one per event — the other half of the flicker fix.
    if (raf == null) {
      raf = requestAnimationFrame(() => {
        raf = null;
        applyWidth(pending);
      });
    }
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
    // The rAF coalescing above can leave the last pointermove's position
    // un-applied for up to one frame — apply it now so release always
    // commits the width to exactly where the pointer let go.
    if (moved) applyWidth(pending);
    resizer.classList.remove('bd-col-resizing');
    th.classList.remove('bd-col-th-resizing');
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    tip.remove();
    // A plain click (e.g. the two taps of a double-click) never fires
    // onMove, so th.style.width is still whatever it was before this
    // gesture — parseInt('') is NaN. Only commit a width if something
    // actually moved.
    if (moved) {
      col.width = parseInt(th.style.width, 10);
      deferSave();
    }
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// Double-click a column border to snap that column back to the default width.
function onColResizeReset(e, id) {
  e.preventDefault();
  e.stopPropagation();
  const col = state.columns.find(c => c.id === id);
  const th  = e.currentTarget.closest('th');
  if (!col || !th) return;
  col.width = null;
  th.style.width = th.style.minWidth = th.style.maxWidth = '';
  deferSave();
}

/* ── Cell ops ────────────────────────────────────────────────── */
function onCellChange(rowKey, colId, val) {
  if (!state.cells[rowKey]) state.cells[rowKey] = {};
  state.cells[rowKey][colId] = val;
  deferSave();
  // KPI cards / insights / this row's sparkline live outside the table's
  // focused input, so they can refresh on every keystroke without stealing
  // focus the way a full render() would. The rest of the table (headers,
  // other rows) only rebuilds on structural changes (add/delete/reorder
  // column, mode toggle) — see render().
  renderKpiCards();
  renderInsights();
  const sparkTd = document.querySelector(`[data-spark-row="${rowKey}"]`);
  if (sparkTd) sparkTd.innerHTML = sparklineSvg(rowKey);
}

/* ── Derived data: per-row time series, KPI cards, insights, sparklines ──
   Columns are user-ordered (drag-to-reorder), not guaranteed sorted by
   year, so "latest"/"prior" here are always derived by parsing each
   column's label as a year and sorting — never by array position. */
function getRowSeries(rowKey) {
  const cellsForRow = state.cells[rowKey] || {};
  const pts = [];
  state.columns.forEach(col => {
    const year = parseInt(col.label, 10);
    if (!Number.isFinite(year)) return;
    const raw = cellsForRow[col.id];
    if (raw === undefined || raw === null || raw === '') return;
    const num = Number(raw);
    if (!Number.isFinite(num)) return; // text-hint rows (ratings, etc.) aren't chartable
    pts.push({ year, value: num });
  });
  pts.sort((a, b) => a.year - b.year);
  return pts;
}

function latestAndPrior(rowKey) {
  const pts = getRowSeries(rowKey);
  if (!pts.length) return { latest: null, prior: null };
  return {
    latest: pts[pts.length - 1],
    prior:  pts.length > 1 ? pts[pts.length - 2] : null,
  };
}

function pctChange(latest, prior) {
  if (!latest || !prior || prior.value === 0) return null;
  return ((latest.value - prior.value) / Math.abs(prior.value)) * 100;
}

function sparklineSvg(rowKey) {
  const pts = getRowSeries(rowKey);
  const W = 90, H = 28, PAD = 4;
  if (pts.length < 2) {
    return `<svg class="bd-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      <line x1="${PAD}" y1="${H / 2}" x2="${W - PAD}" y2="${H / 2}" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="3,3"/>
    </svg>`;
  }
  const values = pts.map(p => p.value);
  const min    = Math.min(...values), max = Math.max(...values);
  const span   = (max - min) || 1;
  const stepX  = (W - PAD * 2) / (pts.length - 1);
  const coords = pts.map((p, i) => [
    PAD + i * stepX,
    H - PAD - ((p.value - min) / span) * (H - PAD * 2),
  ]);
  const color  = values[values.length - 1] >= values[0] ? 'var(--gain)' : 'var(--loss)';
  const points = coords.map(c => c.join(',')).join(' ');
  const dots   = coords.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${color}"/>`).join('');
  return `<svg class="bd-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
  </svg>`;
}

function renderKpiCards() {
  const wrap = document.getElementById('bd-kpi-row');
  if (!wrap) return;
  wrap.innerHTML = KPI_METRICS.map(k => {
    const row       = BANK_ROWS.find(r => r.key === k.key);
    const meta      = ROW_META[k.key];
    const { latest, prior } = latestAndPrior(k.key);
    const valueText = latest ? formatDisplay(String(latest.value), row.hint) : '—';

    let deltaHtml = '';
    if (latest && prior) {
      const pct = pctChange(latest, prior);
      deltaHtml = pct == null
        ? `<span class="bd-kpi-delta bd-kpi-delta-none">— vs ${prior.year}</span>`
        : `<span class="bd-kpi-delta ${pct >= 0 ? 'bd-kpi-up' : 'bd-kpi-down'}">${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(2)}% vs ${prior.year}</span>`;
    } else if (latest) {
      deltaHtml = `<span class="bd-kpi-delta bd-kpi-delta-none">No prior year to compare</span>`;
    }

    return `
    <div class="bd-kpi-card">
      <div class="bd-kpi-icon" style="background:${meta.color}22;color:${meta.color}">${ICON(meta.icon, 21)}</div>
      <div class="bd-kpi-body">
        <div class="bd-kpi-label">${esc(k.label)}${latest ? ` (${latest.year})` : ''}</div>
        <div class="bd-kpi-value">${esc(valueText)}</div>
        ${deltaHtml}
      </div>
    </div>`;
  }).join('');
}

function renderInsights() {
  const body = document.getElementById('bd-insights-body');
  const asof = document.getElementById('bd-insights-asof');
  if (!body) return;

  const cards = INSIGHT_METRICS.map(m => {
    const { latest, prior } = latestAndPrior(m.key);
    const pct = pctChange(latest, prior);
    if (pct == null) return null;
    const up  = pct >= 0;
    const mag = Math.abs(pct);
    let sentence;
    if (mag < 1) {
      sentence = `Roughly flat ${m.noun} count between ${prior.year} and ${latest.year}.`;
    } else if (up) {
      sentence = mag < 5
        ? `Slight growth in ${m.noun}, up ${mag.toFixed(1)}% from ${prior.year} to ${latest.year}.`
        : `${mag.toFixed(1)}% increase in total ${m.noun} from ${prior.year} to ${latest.year}.`;
    } else {
      sentence = mag < 5
        ? `Slight decrease in number of ${m.noun} in ${latest.year}.`
        : `${mag.toFixed(1)}% decline in ${m.noun} from ${prior.year} to ${latest.year}.`;
    }
    return { title: m.title, sentence, up, icon: ROW_META[m.key].icon };
  }).filter(Boolean);

  body.innerHTML = cards.length
    ? cards.map(c => `
      <div class="bd-insight-card">
        <div class="bd-insight-icon ${c.up ? 'bd-insight-up' : 'bd-insight-down'}">${ICON(c.icon, 15)}</div>
        <div>
          <div class="bd-insight-title">${esc(c.title)}</div>
          <div class="bd-insight-text">${esc(c.sentence)}</div>
        </div>
      </div>`).join('')
    : `<div class="bd-insight-empty">Add at least two years of data for the same metric to see trend insights here.</div>`;

  if (asof) {
    const years = state.columns.map(c => parseInt(c.label, 10)).filter(Number.isFinite);
    asof.textContent = years.length ? `FY ${Math.max(...years)}` : '—';
  }
}

function updateVerifiedBadge() {
  const badge   = document.getElementById('bd-verified');
  if (!badge) return;
  const hasData = Object.values(state.cells).some(colMap =>
    Object.values(colMap || {}).some(v => v !== '' && v != null));
  badge.style.display = hasData ? 'inline-flex' : 'none';
}

/* ── Render ──────────────────────────────────────────────────── */
function setLoading(on) {
  const el = document.getElementById('bd-content');
  if (!el || !on) return;
  el.innerHTML = `<div class="fund-table-wrap">
    <div class="fund-empty">
      <div class="fund-skeleton" style="width:40%;height:12px;margin-bottom:10px"></div>
      <div class="fund-skeleton" style="width:60%"></div>
    </div>
  </div>`;
}

function render() {
  const el = document.getElementById('bd-content');
  if (!el) return;
  const em = editMode;

  const colHeaders = state.columns.map((col, i) => {
    const w = col.width ? `width:${col.width}px;min-width:${col.width}px;max-width:${col.width}px` : '';
    const yearColor = YEAR_HEADER_COLORS[i % YEAR_HEADER_COLORS.length];
    return `
    <th class="fund-col-th"
        data-col-id="${col.id}"
        style="${w}"
        ondragover="onColDragOver(event,'${col.id}')"
        ondrop="onColDrop(event,'${col.id}')"
        ondragend="onColDragEnd()">
      <div class="fund-th-inner">
        ${em ? `<span class="bd-col-drag-handle" draggable="true" ondragstart="onColDragStart(event,'${col.id}')" title="Drag to reorder">
          <svg viewBox="0 0 12 20" width="10" height="16" fill="currentColor">
            <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
            <circle cx="3" cy="10" r="1.5"/><circle cx="9" cy="10" r="1.5"/>
            <circle cx="3" cy="17" r="1.5"/><circle cx="9" cy="17" r="1.5"/>
          </svg>
        </span>` : ''}
        <input class="fund-qtr-input"
               style="color:${yearColor}"
               value="${esc(col.label)}"
               oninput="onColLabelChange('${col.id}',this.value)"
               title="Rename year"
               ${em ? '' : 'readonly'} />
        ${em ? `<button class="fund-th-del" onclick="deleteColumn('${col.id}')" title="Delete column">✕</button>` : ''}
      </div>
      <div class="bd-col-th-resizer" draggable="false"
           onpointerdown="onColResizeStart(event,'${col.id}')"
           ondblclick="onColResizeReset(event,'${col.id}')"
           title="Drag to resize column · double-click to reset"></div>
    </th>`;
  }).join('');

  const trendHeader = state.columns.length
    ? `<th class="fund-col-th bd-trend-th"><div class="fund-th-inner">TREND${state.columns.length > 1 ? ` (${esc(state.columns[0].label)}–${esc(state.columns[state.columns.length - 1].label)})` : ''}</div></th>`
    : '';

  const bodyRows = BANK_ROWS.map(row => {
    const meta = ROW_META[row.key] || { icon: 'hash', color: 'var(--text-muted)' };
    const unitTag = row.unit
      ? `<span class="bd-unit">${esc(row.unit)}</span>`
      : '';
    const hintTag = `<span class="bd-hint">${esc(row.hint)}</span>`;
    return `
    <tr class="fund-body-tr">
      <td class="bd-label-cell">
        <span class="bd-row-label-flex">
          <span class="bd-row-icon" style="background:${meta.color}1a;color:${meta.color}">${ICON(meta.icon, 15)}</span>
          <span class="bd-metric-label">${esc(row.label)}</span>
          ${unitTag}
          ${em ? hintTag : ''}
        </span>
      </td>
      ${state.columns.map(col => {
        const val = (state.cells[row.key] || {})[col.id] || '';
        const shown = em ? val : formatDisplay(val, row.hint);
        return `<td data-col-id="${col.id}">
          <input class="fund-cell"
                 type="text"
                 value="${esc(shown)}"
                 oninput="onCellChange('${row.key}','${col.id}',this.value)"
                 placeholder="${em ? row.hint : ''}"
                 ${em ? '' : 'readonly'} />
        </td>`;
      }).join('')}
      ${state.columns.length ? `<td class="bd-trend-td" data-spark-row="${row.key}">${sparklineSvg(row.key)}</td>` : ''}
    </tr>`;
  }).join('');

  const emptyMsg = !state.columns.length
    ? `<tr><td colspan="1"><div class="fund-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>
        </svg>
        No year columns yet. Switch to <strong>Edit mode</strong> and click <strong>+ Year</strong>.
       </div></td></tr>` : '';

  el.innerHTML = `
<div class="fund-table-wrap${em ? ' fund-edit-mode' : ''}" id="bd-table-wrap">
  <div class="fund-scroll">
    <table class="fund-table">
      <thead>
        <tr>
          <th class="bd-metric-th">
            <div class="fund-th-inner" style="justify-content:flex-start">
              <span style="color:var(--text-muted,#64748b);font-size:9px;letter-spacing:1px">METRIC</span>
            </div>
          </th>
          ${colHeaders}
          ${trendHeader}
        </tr>
      </thead>
      <tbody>${state.columns.length ? bodyRows : emptyMsg}</tbody>
    </table>
  </div>
  ${em ? `<div class="fund-toolbar" style="display:flex">
    <span class="fund-toolbar-hint">Drag a column's ⠿ handle to reorder it, or its right edge to resize</span>
  </div>` : ''}
</div>`;

  renderKpiCards();
  renderInsights();
  updateVerifiedBadge();
}

/* ── Helpers ─────────────────────────────────────────────────── */
// The grid gets filled in backwards — you have this year's report and work back
// through the archive — so a new column defaults to the year before the oldest
// one present, which the sort then places at the far left.
function suggestPrevYear() {
  const years = state.columns.map(c => parseInt(c.label, 10)).filter(Number.isFinite);
  if (!years.length) return String(new Date().getFullYear());
  return String(Math.min(...years) - 1);
}

function formatDisplay(val, hint) {
  if (val === '' || val == null) return '';
  if (hint === 'text') return val;
  const num = Number(val);
  if (!Number.isFinite(num)) return val;
  return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = 'success') {
  const wrap = document.getElementById('fund-toast-wrap');
  const el   = document.createElement('div');
  el.className   = `fund-toast fund-toast--${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

/* ── Globals ─────────────────────────────────────────────────── */
window.addColumn        = addColumn;
window.deleteColumn     = deleteColumn;
window.onColLabelChange = onColLabelChange;
window.onCellChange     = onCellChange;
window.onColDragStart   = onColDragStart;
window.onColDragOver    = onColDragOver;
window.onColDrop        = onColDrop;
window.onColDragEnd     = onColDragEnd;
window.onColResizeStart = onColResizeStart;
window.onColResizeReset = onColResizeReset;
