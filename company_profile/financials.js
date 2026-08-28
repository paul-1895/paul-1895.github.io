/**
 * financials.js
 * -------------
 * Self-contained module for the "Company Financials" manual-entry section.
 * Loaded by company.html via <script src="financials.js" defer></script>
 *
 * Depends on:
 *  - financials.css  (styling)
 *  - window.COMPANY_CODE being set before DOMContentLoaded fires
 *    (company.html sets it in populateProfile())
 */

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════════════════════ */
const FIN_API = '/api/financials';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const YEARS    = Array.from({ length: 50 }, (_, i) => 2001 + i); // 2001-2050

/* ═══════════════════════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════════════════════ */
let finData = { eps: [], dividend: [], nocfps: [], revenue: [], nav: [] };
let companyCode = null;

/* ═══════════════════════════════════════════════════════════════════════════
   INIT  — called after company code is known
═══════════════════════════════════════════════════════════════════════════ */
async function initFinancials(code) {
  companyCode = code.toUpperCase();
  buildUI();
  await fetchAndRender();
}

/* ═══════════════════════════════════════════════════════════════════════════
   FETCH
═══════════════════════════════════════════════════════════════════════════ */
async function fetchAndRender() {
  try {
    const res  = await fetch(`${FIN_API}/${companyCode}`);
    finData    = await res.json();
  } catch {
    finData = { eps: [], dividend: [], nocfps: [], revenue: [], nav: [] };
  }
  renderAllTables();
  if (window.renderFinancialsChart) window.renderFinancialsChart(finData.eps, 'eps');
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUILD UI  (called once)
═══════════════════════════════════════════════════════════════════════════ */
function buildUI() {
  const root = document.getElementById('financials-section');
  if (!root) return;

  root.innerHTML = `
<div class="fin-wrapper">
  <div class="fin-header">
    <span class="fin-title-icon">📊</span>
    <h2 class="fin-title">Company Financials</h2>
    <span class="fin-subtitle">Manually entered data — stored locally</span>
  </div>

  <div class="fin-tabs" role="tablist">
    ${buildTabButtons()}
  </div>

  <div class="fin-panels">
    ${buildEpsPanel()}
    ${buildDividendPanel()}
    ${buildNocfpsPanel()}
    ${buildRevenuePanel()}
    ${buildNavPanel()}
  </div>
</div>`;

  // Inject EPS modal into body after innerHTML is set so DOM is ready
  if (!document.getElementById('eps-table-modal')) {
    const modal = document.createElement('div');
    modal.id = 'eps-table-modal';
    modal.className = 'eps-modal-backdrop';
    modal.innerHTML = `
      <div class="eps-modal">
        <div class="eps-modal-hd">
          <span class="eps-modal-title">EPS DATA</span>
          <button class="eps-modal-close" id="eps-modal-close-btn">&#x2715;</button>
        </div>
        <div class="eps-modal-body">
          <div class="fin-table-wrap" id="table-eps"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
    document.getElementById('eps-modal-close-btn').addEventListener('click', () => modal.classList.remove('open'));
  }

  // Wire up three-dots button (exists in DOM now)
  const dotsBtn = root.querySelector('.fin-dots-btn');
  if (dotsBtn) {
    dotsBtn.addEventListener('click', () => document.getElementById('eps-table-modal').classList.add('open'));
  }

  // Tab switching
  root.querySelectorAll('.fin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Form submissions
  root.querySelector('#form-eps').addEventListener('submit',      e => submitQuarterly(e, 'eps'));
  root.querySelector('#form-dividend').addEventListener('submit', e => submitDividend(e));
  root.querySelector('#form-nocfps').addEventListener('submit',   e => submitQuarterly(e, 'nocfps'));
  root.querySelector('#form-revenue').addEventListener('submit',  e => submitQuarterly(e, 'revenue'));
  root.querySelector('#form-nav').addEventListener('submit',      e => submitQuarterly(e, 'nav'));

  switchTab('eps');
}

/* ── Tab helpers ─────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'eps',      label: 'EPS' },
  { id: 'dividend', label: 'Dividend' },
  { id: 'nocfps',   label: 'NOCFPS' },
  { id: 'revenue',  label: 'Revenue' },
  { id: 'nav',      label: 'NAV' },
];

function buildTabButtons() {
  return TABS.map(t =>
    `<button class="fin-tab-btn" data-tab="${t.id}" role="tab" aria-selected="false">${t.label}</button>`
  ).join('');
}

function switchTab(tabId) {
  document.querySelectorAll('.fin-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabId);
    b.setAttribute('aria-selected', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.fin-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === tabId);
  });
}

/* ── Year <select> HTML ──────────────────────────────────────────────────── */
function yearOptions(selectedYear) {
  const current = selectedYear || new Date().getFullYear();
  return YEARS.map(y => `<option value="${y}"${y === current ? ' selected' : ''}>${y}</option>`).join('');
}

/* ── Quarter <select> HTML ───────────────────────────────────────────────── */
function quarterOptions() {
  return QUARTERS.map(q => `<option value="${q}">${q}</option>`).join('');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PANEL BUILDERS
═══════════════════════════════════════════════════════════════════════════ */
function quarterlyFormHTML(id, label, unit = '') {
  return `
<form id="form-${id}" class="fin-form" novalidate>
  <div class="fin-form-row">
    <div class="fin-field">
      <label class="fin-label">${label}${unit ? ` <span class="fin-unit">${unit}</span>` : ''}</label>
      <input class="fin-input" type="number" step="0.01" name="value"
             placeholder="0.00" required />
    </div>
    <div class="fin-field fin-field-sm">
      <label class="fin-label">Quarter</label>
      <select class="fin-select" name="quarter">${quarterOptions()}</select>
    </div>
    <div class="fin-field fin-field-sm">
      <label class="fin-label">Year</label>
      <select class="fin-select" name="year">${yearOptions()}</select>
    </div>
    <div class="fin-field fin-field-btn">
      <label class="fin-label">&nbsp;</label>
      <button class="fin-btn fin-btn-add" type="submit">+ Add</button>
    </div>
  </div>
  <div class="fin-feedback" id="fb-${id}"></div>
</form>`;
}

function buildEpsPanel() {
  return `
<div class="fin-panel" data-panel="eps">
  <p class="fin-desc">Earnings Per Share — decimal value per quarter/year.</p>
  ${quarterlyFormHTML('eps', 'EPS Value', 'BDT')}
  <div class="fin-chart-wrap">
    <button class="fin-dots-btn" title="View EPS data table">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
      </svg>
    </button>
    <div id="fin-chart-container" style="padding: 16px 0 8px;"></div>
  </div>
</div>`;
}

function buildDividendPanel() {
  return `
<div class="fin-panel" data-panel="dividend">
  <p class="fin-desc">Cash and stock dividends declared for a given year.</p>
  <form id="form-dividend" class="fin-form" novalidate>
    <div class="fin-form-row">
      <div class="fin-field">
        <label class="fin-label">Cash Dividend <span class="fin-unit">%</span></label>
        <input class="fin-input" type="number" step="0.01" name="cashDividend"
               placeholder="0.00" required />
      </div>
      <div class="fin-field">
        <label class="fin-label">Stock Dividend <span class="fin-unit">%</span></label>
        <input class="fin-input" type="number" step="0.01" name="stockDividend"
               placeholder="0.00" required />
      </div>
      <div class="fin-field fin-field-sm">
        <label class="fin-label">Year</label>
        <select class="fin-select" name="year">${yearOptions()}</select>
      </div>
      <div class="fin-field fin-field-btn">
        <label class="fin-label">&nbsp;</label>
        <button class="fin-btn fin-btn-add" type="submit">+ Add</button>
      </div>
    </div>
    <div class="fin-feedback" id="fb-dividend"></div>
  </form>
  <div class="fin-table-wrap" id="table-dividend"></div>
</div>`;
}

function buildNocfpsPanel() {
  return `
<div class="fin-panel" data-panel="nocfps">
  <p class="fin-desc">Net Operating Cash Flow Per Share — decimal value per quarter/year.</p>
  ${quarterlyFormHTML('nocfps', 'NOCFPS Value', 'BDT')}
  <div class="fin-table-wrap" id="table-nocfps"></div>
</div>`;
}

function buildRevenuePanel() {
  return `
<div class="fin-panel" data-panel="revenue">
  <p class="fin-desc">Revenue — decimal value per quarter/year.</p>
  ${quarterlyFormHTML('revenue', 'Revenue Value', 'BDT')}
  <div class="fin-table-wrap" id="table-revenue"></div>
</div>`;
}

function buildNavPanel() {
  return `
<div class="fin-panel" data-panel="nav">
  <p class="fin-desc">Net Asset Value Per Share — decimal value per quarter/year.</p>
  ${quarterlyFormHTML('nav', 'NAV Value', 'BDT')}
  <div class="fin-table-wrap" id="table-nav"></div>
</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENDER TABLES
═══════════════════════════════════════════════════════════════════════════ */
function renderAllTables() {
  renderQuarterlyTable('eps',     ['Quarter', 'Year', 'EPS (BDT)', ''], e => [e.quarter, e.year, e.value.toFixed(2)]);
  renderDividendTable();
  renderQuarterlyTable('nocfps',  ['Quarter', 'Year', 'NOCFPS (BDT)', ''], e => [e.quarter, e.year, e.value.toFixed(2)]);
  renderQuarterlyTable('revenue', ['Quarter', 'Year', 'Revenue (BDT)', ''], e => [e.quarter, e.year, e.value.toFixed(2)]);
  renderQuarterlyTable('nav',     ['Quarter', 'Year', 'NAV (BDT)', ''], e => [e.quarter, e.year, e.value.toFixed(2)]);
}

function renderQuarterlyTable(type, headers, rowFn) {
  const wrap = document.getElementById(`table-${type}`);
  if (!wrap) return;
  const rows = [...(finData[type] || [])].sort((a, b) => b.year - a.year || QUARTERS.indexOf(b.quarter) - QUARTERS.indexOf(a.quarter));

  if (!rows.length) {
    wrap.innerHTML = '<p class="fin-empty">No entries yet. Use the form above to add data.</p>';
    return;
  }

  wrap.innerHTML = `
<table class="fin-table">
  <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>
    ${rows.map(e => {
      const cells = rowFn(e);
      return `<tr>
        ${cells.map(c => `<td>${c}</td>`).join('')}
        <td><button class="fin-btn fin-btn-del"
            onclick="deleteEntry('${type}','${e.quarter || ''}',${e.year})">✕</button></td>
      </tr>`;
    }).join('')}
  </tbody>
</table>`;
}

function renderDividendTable() {
  const wrap = document.getElementById('table-dividend');
  if (!wrap) return;
  const rows = [...(finData.dividend || [])].sort((a, b) => b.year - a.year);

  if (!rows.length) {
    wrap.innerHTML = '<p class="fin-empty">No entries yet. Use the form above to add data.</p>';
    return;
  }

  wrap.innerHTML = `
<table class="fin-table">
  <thead><tr><th>Year</th><th>Cash Div (%)</th><th>Stock Div (%)</th><th></th></tr></thead>
  <tbody>
    ${rows.map(e => `
      <tr>
        <td>${e.year}</td>
        <td>${e.cashDividend.toFixed(2)}%</td>
        <td>${e.stockDividend.toFixed(2)}%</td>
        <td><button class="fin-btn fin-btn-del"
            onclick="deleteEntry('dividend','',${e.year})">✕</button></td>
      </tr>`).join('')}
  </tbody>
</table>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORM SUBMIT HANDLERS
═══════════════════════════════════════════════════════════════════════════ */
async function submitQuarterly(e, type) {
  e.preventDefault();
  const form = e.target;
  const body = {
    value:   parseFloat(form.value.value),
    quarter: form.quarter.value,
    year:    parseInt(form.year.value, 10),
  };
  if (isNaN(body.value)) { showFeedback(type, 'Please enter a valid number.', 'error'); return; }
  await postEntry(type, body);
  form.reset();
  // Restore year select to current year after reset
  form.year.value = new Date().getFullYear();
}

async function submitDividend(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    cashDividend:  parseFloat(form.cashDividend.value),
    stockDividend: parseFloat(form.stockDividend.value),
    year:          parseInt(form.year.value, 10),
  };
  if (isNaN(body.cashDividend) || isNaN(body.stockDividend)) {
    showFeedback('dividend', 'Please enter valid numbers for both dividend fields.', 'error');
    return;
  }
  await postEntry('dividend', body);
  form.reset();
  form.year.value = new Date().getFullYear();
}

async function postEntry(type, body) {
  try {
    const res  = await fetch(`${FIN_API}/${companyCode}/${type}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Server error');
    finData = json.data;
    renderAllTables();
    if (window.renderFinancialsChart) window.renderFinancialsChart(finData.eps, 'eps');
    showFeedback(type, 'Saved successfully!', 'success');
  } catch (err) {
    showFeedback(type, `Error: ${err.message}`, 'error');
  }
}

// Exposed globally so inline onclick can call it
window.deleteEntry = async function(type, quarter, year) {
  if (!confirm(`Delete this ${type} entry (${quarter ? quarter + ' ' : ''}${year})?`)) return;
  try {
    const res  = await fetch(`${FIN_API}/${companyCode}/${type}`, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ quarter, year }),
    });
    const json = await res.json();
    finData = json.data;
    renderAllTables();
  } catch (err) {
    alert(`Failed to delete: ${err.message}`);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   FEEDBACK
═══════════════════════════════════════════════════════════════════════════ */
function showFeedback(type, msg, kind) {
  const el = document.getElementById(`fb-${type}`);
  if (!el) return;
  el.textContent = msg;
  el.className   = `fin-feedback fin-feedback-${kind}`;
  setTimeout(() => { el.textContent = ''; el.className = 'fin-feedback'; }, 3500);
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-INIT
   company.html calls window.initFinancials(code) from populateProfile()
═══════════════════════════════════════════════════════════════════════════ */
window.initFinancials = initFinancials;