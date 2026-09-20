import { initTheme, toggleTheme } from '../theme/theme.js';

initTheme();
document.getElementById('theme-toggle-btn').addEventListener('click', () => toggleTheme());

/* ════════════════════════════════════════════════════════════
   scenario-lab.js
   Picks a portfolio + a scenario (historical window or a flat
   hypothetical shock), sends the holdings to
   /api/scenario-lab/run, and renders the impact.
   ════════════════════════════════════════════════════════════ */

'use strict';

let portfolios = [];
let liveLtp = {};       // code -> last traded price, from /api/stocks
let presets = [];
let scenarioType = 'historical';
let selectedPresetId = null;

const $ = id => document.getElementById(id);

function fmtMoney(n) {
  const v = Number(n) || 0;
  return '৳' + v.toLocaleString('en-BD', { maximumFractionDigits: 0 });
}
function fmtPct(n) {
  const v = Number(n) || 0;
  return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
}
function cls(n) { return n > 0 ? 'sl-pos' : n < 0 ? 'sl-neg' : ''; }
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── LOAD ─────────────────────────────────────────────────────── */
async function loadPortfolios() {
  try {
    const res = await fetch('/api/portfolios');
    const data = await res.json();
    portfolios = data.portfolios || [];
  } catch (e) {
    console.error('[scenario-lab] failed to load portfolios', e);
    portfolios = [];
  }
  const sel = $('sl-portfolio');
  sel.innerHTML = portfolios.length
    ? portfolios.map(p => `<option value="${p.id}">${escHtml(p.name)}${p.broker ? ' · ' + escHtml(p.broker) : ''}</option>`).join('')
    : `<option value="">No portfolios found</option>`;
}

async function loadLiveLtp() {
  try {
    const res = await fetch('/api/stocks');
    const data = await res.json();
    (data.stocks || []).forEach(s => { if (s.code && s.ltp) liveLtp[s.code] = s.ltp; });
  } catch (e) {
    console.warn('[scenario-lab] live prices unavailable, will fall back to stored mktPrice', e);
  }
}

async function loadPresets() {
  try {
    const res = await fetch('/api/scenario-lab/presets');
    const data = await res.json();
    presets = data.presets || [];
    if (data.dataRange) {
      $('sl-data-range').textContent = data.dataRange.to;
    }
  } catch (e) {
    console.error('[scenario-lab] failed to load presets', e);
    presets = [];
  }
  renderPresetPills();
  if (presets.length) selectPreset(presets[presets.length - 1].id); // default: most recent episode
}

function renderPresetPills() {
  const wrap = $('sl-presets');
  if (presets.length === 0) {
    wrap.innerHTML = `<span class="sl-field-note">No drawdown of 6%+ detected in the stored price history yet.</span>`;
    return;
  }
  wrap.innerHTML = presets.map(p => `<button type="button" class="sl-pill" data-preset-id="${p.id}">${escHtml(p.label)}</button>`).join('');
  wrap.querySelectorAll('.sl-pill').forEach(btn => {
    btn.addEventListener('click', () => selectPreset(btn.dataset.presetId));
  });
}

function selectPreset(id) {
  const preset = presets.find(p => p.id === id);
  if (!preset) return;
  selectedPresetId = id;
  $('sl-start-date').value = preset.startDate;
  $('sl-end-date').value = preset.endDate;
  document.querySelectorAll('#sl-presets .sl-pill').forEach(b => b.classList.toggle('active', b.dataset.presetId === id));
}

/* ── SCENARIO TYPE / SHOCK CONTROLS ──────────────────────────── */
function setScenarioType(type) {
  scenarioType = type;
  document.querySelectorAll('#sl-type-seg .sl-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  $('sl-panel-historical').style.display = type === 'historical' ? '' : 'none';
  $('sl-panel-hypothetical').style.display = type === 'hypothetical' ? '' : 'none';
}

function selectShockPreset(pct) {
  $('sl-shock-pct').value = pct;
  document.querySelectorAll('#sl-shock-presets .sl-pill').forEach(b => b.classList.toggle('active', b.dataset.pct === String(pct)));
}

/* ── RUN ──────────────────────────────────────────────────────── */
async function runScenario() {
  const pf = portfolios.find(p => p.id === $('sl-portfolio').value);
  if (!pf || !(pf.stocks || []).length) {
    alert('Pick a portfolio that has holdings in it.');
    return;
  }

  const holdings = pf.stocks.map(st => ({
    code: st.code,
    qty: Math.max(0, (Number(st.qty) || 0) - (Number(st.saleQty) || 0)),
    currentPrice: liveLtp[st.code] || Number(st.mktPrice) || 0,
  })).filter(h => h.qty > 0);

  if (holdings.length === 0) {
    alert('Every holding in this portfolio nets to zero shares — nothing to stress-test.');
    return;
  }

  let scenario;
  if (scenarioType === 'historical') {
    const startDate = $('sl-start-date').value;
    const endDate = $('sl-end-date').value;
    if (!startDate || !endDate) { alert('Pick a start and end date, or click a preset.'); return; }
    scenario = { type: 'historical', startDate, endDate };
  } else {
    const shockPct = parseFloat($('sl-shock-pct').value);
    if (isNaN(shockPct)) { alert('Enter a shock percentage.'); return; }
    scenario = { type: 'hypothetical', shockPct };
  }

  const btn = $('sl-run-btn');
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const res = await fetch('/api/scenario-lab/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings, scenario }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scenario run failed');
    renderResults(data);
  } catch (e) {
    alert('Could not run scenario: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Run Scenario';
  }
}

/* ── RENDER RESULTS ───────────────────────────────────────────── */
function renderResults(data) {
  $('sl-empty').style.display = 'none';
  $('sl-results').style.display = '';

  const s = data.summary;
  $('sl-kpis').innerHTML = `
    <div class="sl-kpi"><span class="sl-kpi-label">Current Value</span><span class="sl-kpi-value">${fmtMoney(s.totalCurrent)}</span></div>
    <div class="sl-kpi"><span class="sl-kpi-label">Shocked Value</span><span class="sl-kpi-value ${cls(s.totalImpact)}">${fmtMoney(s.totalShocked)}</span></div>
    <div class="sl-kpi"><span class="sl-kpi-label">Total Impact</span><span class="sl-kpi-value ${cls(s.totalImpact)}">${s.totalImpact >= 0 ? '+' : ''}${fmtMoney(s.totalImpact)}</span></div>
    <div class="sl-kpi"><span class="sl-kpi-label">Impact %</span><span class="sl-kpi-value ${cls(s.totalImpactPct)}">${fmtPct(s.totalImpactPct)}</span></div>
  `;

  $('sl-table-body').innerHTML = data.results.map(r => `
    <tr>
      <td>${escHtml(r.code)}${!r.dataAvailable ? ` <span class="sl-flag" title="${escHtml(r.note)}">†</span>` : ''}</td>
      <td>${r.qty.toLocaleString()}</td>
      <td>${fmtMoney(r.currentPrice)}</td>
      <td>${fmtMoney(r.currentValue)}</td>
      <td>${fmtMoney(r.shockedPrice)}</td>
      <td>${fmtMoney(r.shockedValue)}</td>
      <td class="${cls(r.pctChange)}">${fmtPct(r.pctChange)}</td>
      <td class="${cls(r.impact)}">${r.impact >= 0 ? '+' : ''}${fmtMoney(r.impact)}</td>
    </tr>
  `).join('');
}

/* ── BOOT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadPortfolios(), loadLiveLtp(), loadPresets()]);

  document.querySelectorAll('#sl-type-seg .sl-seg-btn').forEach(b => b.addEventListener('click', () => setScenarioType(b.dataset.type)));
  document.querySelectorAll('#sl-shock-presets .sl-pill').forEach(b => b.addEventListener('click', () => selectShockPreset(b.dataset.pct)));

  $('sl-start-date').addEventListener('change', () => { selectedPresetId = null; document.querySelectorAll('#sl-presets .sl-pill').forEach(b => b.classList.remove('active')); });
  $('sl-end-date').addEventListener('change', () => { selectedPresetId = null; document.querySelectorAll('#sl-presets .sl-pill').forEach(b => b.classList.remove('active')); });
  $('sl-shock-pct').addEventListener('input', () => document.querySelectorAll('#sl-shock-presets .sl-pill').forEach(b => b.classList.toggle('active', b.dataset.pct === $('sl-shock-pct').value)));

  $('sl-run-btn').addEventListener('click', runScenario);
});
