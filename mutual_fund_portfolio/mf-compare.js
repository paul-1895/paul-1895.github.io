/**
 * mf-compare.js
 * Quarter-over-quarter comparison for a mutual fund portfolio.
 */

import { initTheme, toggleTheme } from '../theme/theme.js';

'use strict';

const API       = '/api';
const params    = new URLSearchParams(window.location.search);
const FUND_CODE = (params.get('code') || '').toUpperCase();
const FUND_NAME = params.get('name') || FUND_CODE;

let dataA = null;   // portfolio object for Quarter A
let dataB = null;   // portfolio object for Quarter B
let diffRows = [];  // computed diff array
let cmpFilter   = 'all';
let cmpChartMetric = 'reportMkt';

// Chart instances
let chartCost = null, chartMkt = null, chartSector = null, chartHoldings = null;

/* ── HELPERS ─────────────────────────────────────────────────── */
const fmt  = n => (n == null ? '—' : Math.abs(n) >= 1000
  ? n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : parseFloat(n).toFixed(2));
const fmtInt = n => n ? parseInt(n).toLocaleString('en-BD') : '—';
const esc    = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const SF     = "-apple-system,BlinkMacSystemFont,'Space Mono',monospace";

function toast(msg, type = 'info') {
  const w = document.getElementById('toast-wrap');
  const t = document.createElement('div');
  t.className = `mf-toast ${type}`;
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function setStatus(slot, msg, type) {
  const el = document.getElementById(`status-${slot}`);
  el.textContent = msg;
  el.className = `cmp-status ${type}`;
}

function labelFor(slot) {
  const y = document.getElementById(`${slot}-year`).value;
  const q = document.getElementById(`${slot}-quarter`).value;
  return `${y} ${q}`;
}

/* ── BOOT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  if (!FUND_CODE) { toast('No fund code in URL', 'error'); return; }

  initTheme();
  document.getElementById('theme-toggle-btn')
    .addEventListener('click', () => toggleTheme());

  document.getElementById('cmp-header-title').textContent =
    `${FUND_CODE} — Quarter Comparison`;
  document.getElementById('cmp-header-sub').textContent =
    (FUND_NAME || FUND_CODE) + ' · Mutual Fund Portfolio';
  document.getElementById('back-to-portfolio').href =
    `/mutual_fund_portfolio/mf-portfolio.html?code=${FUND_CODE}&name=${encodeURIComponent(FUND_NAME)}`;
  document.title = `${FUND_CODE} Compare — DSE`;

  // Populate year selects
  const cur = new Date().getFullYear();
  ['a-year', 'b-year'].forEach((id, i) => {
    const sel = document.getElementById(id);
    for (let y = cur + 1; y >= cur - 10; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      // A = current year, B = current year by default; user adjusts
      if (y === cur) o.selected = true;
      sel.appendChild(o);
    }
  });

  // Pre-fill from URL ?qA=2025-Q3
  const qA = params.get('qA');
  if (qA) {
    const [yr, qt] = qA.split('-');
    if (yr) document.getElementById('a-year').value    = yr;
    if (qt) document.getElementById('a-quarter').value = qt;
    // Default B to next quarter
    const quarters = ['Q1','Q2','Q3','Q4'];
    const qi = quarters.indexOf(qt);
    if (qi >= 0) {
      if (qi < 3) {
        document.getElementById('b-year').value    = yr;
        document.getElementById('b-quarter').value = quarters[qi + 1];
      } else {
        document.getElementById('b-year').value    = String(parseInt(yr) + 1);
        document.getElementById('b-quarter').value = 'Q1';
      }
    }
  }
});

/* ── LOAD A SINGLE QUARTER ───────────────────────────────────── */
window.loadQuarter = async function (slot) {
  const year    = document.getElementById(`${slot}-year`).value;
  const quarter = document.getElementById(`${slot}-quarter`).value;
  setStatus(slot, 'Loading…', 'load');
  try {
    const r = await fetch(`${API}/mf-portfolio/${FUND_CODE}/${year}/${quarter}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (slot === 'a') dataA = data; else dataB = data;
    const count = (data.holdings || []).length;
    setStatus(slot, `✓ Loaded — ${count} holdings`, 'ok');
  } catch (e) {
    if (slot === 'a') dataA = null; else dataB = null;
    setStatus(slot, `✗ ${e.message}`, 'err');
  }
};

/* ── RUN COMPARISON ──────────────────────────────────────────── */
window.runCompare = async function () {
  // Auto-load if not yet loaded
  if (!dataA) await loadQuarter('a');
  if (!dataB) await loadQuarter('b');
  if (!dataA || !dataB) {
    toast('Could not load one or both quarters.', 'error'); return;
  }

  // Build diff
  buildDiff();
  renderSummaryCards();
  renderCharts();
  renderDiffTable();

  document.getElementById('cmp-results').style.display = 'block';
  document.getElementById('cmp-empty').style.display   = 'none';
};

/* ── BUILD DIFF ──────────────────────────────────────────────── */
function buildDiff() {
  const mapA = {};
  const mapB = {};
  (dataA.holdings || []).forEach(h => { mapA[h.stockCode] = h; });
  (dataB.holdings || []).forEach(h => { mapB[h.stockCode] = h; });
  const codes = [...new Set([...Object.keys(mapA), ...Object.keys(mapB)])];

  diffRows = codes.map(code => {
    const a = mapA[code] || null;
    const b = mapB[code] || null;
    const sharesA  = a ? (a.shares     || 0) : 0;
    const sharesB  = b ? (b.shares     || 0) : 0;
    const mktA     = a ? (a.marketValue || 0) : 0;
    const mktB     = b ? (b.marketValue || 0) : 0;
    const sharesDiff = sharesB - sharesA;
    const mktDiff    = mktB - mktA;
    const mktPct     = mktA ? ((mktDiff / mktA) * 100) : null;

    let status;
    if (!a)                  status = 'new';
    else if (!b)             status = 'exited';
    else if (sharesB > sharesA) status = 'increased';
    else if (sharesB < sharesA) status = 'decreased';
    else                     status = 'unchanged';

    return {
      code,
      company:    (b || a)?.company    || '',
      sector:     (b || a)?.sector     || '',
      status,
      sharesA, sharesB, sharesDiff,
      mktA, mktB, mktDiff, mktPct,
    };
  }).sort((x, y) => {
    // Sort: new → exited → increased → decreased → unchanged, then by |mktDiff|
    const order = { new:0, exited:1, increased:2, decreased:3, unchanged:4 };
    if (order[x.status] !== order[y.status]) return order[x.status] - order[y.status];
    return Math.abs(y.mktDiff) - Math.abs(x.mktDiff);
  });
}

/* ── SUMMARY CARDS ───────────────────────────────────────────── */
function renderSummaryCards() {
  const hA = dataA.holdings || [];
  const hB = dataB.holdings || [];
  const totalCostA = hA.reduce((s, x) => s + (x.costValue    || 0), 0);
  const totalCostB = hB.reduce((s, x) => s + (x.costValue    || 0), 0);
  const totalMktA  = hA.reduce((s, x) => s + (x.marketValue  || 0), 0);
  const totalMktB  = hB.reduce((s, x) => s + (x.marketValue  || 0), 0);
  const lA = labelFor('a'), lB = labelFor('b');

  const stats = [
    { label: 'Holdings Count',   vA: hA.length,   vB: hB.length,   fmt: v => v },
    { label: 'Total Cost (M)',   vA: totalCostA,  vB: totalCostB,  fmt: fmt },
    { label: 'Report Mkt (M)',   vA: totalMktA,   vB: totalMktB,   fmt: fmt },
    { label: 'New Positions',    vA: '—', vB: diffRows.filter(r => r.status === 'new').length, fmt: v => v, noDelta: true },
    { label: 'Exited Positions', vA: '—', vB: diffRows.filter(r => r.status === 'exited').length, fmt: v => v, noDelta: true },
    { label: 'NAV / Unit',       vA: dataA.meta?.navPerUnit || null, vB: dataB.meta?.navPerUnit || null, fmt: v => v ? '৳ ' + fmt(v) : '—' },
  ];

  document.getElementById('cmp-summary-grid').innerHTML = stats.map(s => {
    const vA    = s.fmt(s.vA);
    const vB    = s.fmt(s.vB);
    const delta = (!s.noDelta && typeof s.vA === 'number' && typeof s.vB === 'number')
      ? s.vB - s.vA : null;
    const deltaStr = delta !== null
      ? `${delta >= 0 ? '+' : ''}${fmt(delta)}`
      : null;
    const deltaColor = delta === null ? '' : delta > 0 ? 'var(--gain)' : delta < 0 ? 'var(--loss)' : 'var(--text-muted)';

    return `<div class="cmp-sum-card">
      <div class="cmp-sum-lbl">${s.label}</div>
      <div class="cmp-sum-row">
        <span class="cmp-sum-tag tag-a">${lA}</span>
        <span class="cmp-sum-val">${vA}</span>
      </div>
      <div class="cmp-sum-row">
        <span class="cmp-sum-tag tag-b">${lB}</span>
        <span class="cmp-sum-val">${vB}</span>
      </div>
      ${deltaStr !== null ? `<div class="cmp-sum-delta" style="color:${deltaColor}">${deltaStr}</div>` : ''}
    </div>`;
  }).join('');
}

/* ── CHARTS ──────────────────────────────────────────────────── */
function renderCharts() {
  const lA = labelFor('a'), lB = labelFor('b');
  const hA = dataA.holdings || [];
  const hB = dataB.holdings || [];
  const totalCostA = hA.reduce((s, x) => s + (x.costValue   || 0), 0);
  const totalCostB = hB.reduce((s, x) => s + (x.costValue   || 0), 0);
  const totalMktA  = hA.reduce((s, x) => s + (x.marketValue || 0), 0);
  const totalMktB  = hB.reduce((s, x) => s + (x.marketValue || 0), 0);

  const ttOpts = {
    backgroundColor: '#161b24', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
    titleFont: { family: SF, size: 11 }, bodyFont: { family: SF, size: 12 },
  };
  const muted = '#4d6480';

  // ── Cost bar chart ──
  if (chartCost) chartCost.destroy();
  chartCost = new Chart(document.getElementById('chart-cost'), {
    type: 'bar',
    data: {
      labels: [lA, lB],
      datasets: [{ label: 'Total Cost (M)', data: [totalCostA, totalCostB],
        backgroundColor: ['rgba(99,102,241,.65)', 'rgba(244,114,182,.65)'],
        borderColor: ['#6366f1', '#f472b6'], borderWidth: 1, borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...ttOpts } },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, font: { family: SF, size: 13 } }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: muted, font: { family: SF, size: 13 }, callback: v => v + ' M' }, border: { color: 'rgba(255,255,255,.06)' } }
      }
    }
  });

  // ── Mkt bar chart ──
  if (chartMkt) chartMkt.destroy();
  chartMkt = new Chart(document.getElementById('chart-mkt'), {
    type: 'bar',
    data: {
      labels: [lA, lB],
      datasets: [{ label: 'Report Mkt (M)', data: [totalMktA, totalMktB],
        backgroundColor: ['rgba(99,102,241,.65)', 'rgba(244,114,182,.65)'],
        borderColor: ['#6366f1', '#f472b6'], borderWidth: 1, borderRadius: 4 }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...ttOpts } },
      scales: {
        x: { grid: { display: false }, ticks: { color: muted, font: { family: SF, size: 13 } }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: muted, font: { family: SF, size: 13 }, callback: v => v + ' M' }, border: { color: 'rgba(255,255,255,.06)' } }
      }
    }
  });

  // ── Sector comparison ──
  renderSectorChart(hA, hB, lA, lB, ttOpts, muted);

  // ── Holdings diff chart ──
  renderHoldingsChart(lA, lB, ttOpts, muted);
}

function renderSectorChart(hA, hB, lA, lB, ttOpts, muted) {
  const totalA = hA.reduce((s, x) => s + (x.marketValue || 0), 0);
  const totalB = hB.reduce((s, x) => s + (x.marketValue || 0), 0);

  const secMapA = {}, secMapB = {};
  hA.forEach(h => { const s = h.sector || 'OTHER'; secMapA[s] = (secMapA[s] || 0) + (h.marketValue || 0); });
  hB.forEach(h => { const s = h.sector || 'OTHER'; secMapB[s] = (secMapB[s] || 0) + (h.marketValue || 0); });
  const sectors = [...new Set([...Object.keys(secMapA), ...Object.keys(secMapB)])].sort();

  const pctA = sectors.map(s => totalA ? +((secMapA[s] || 0) / totalA * 100).toFixed(2) : 0);
  const pctB = sectors.map(s => totalB ? +((secMapB[s] || 0) / totalB * 100).toFixed(2) : 0);

  // Dynamic height for sectors
  const h = Math.max(320, sectors.length * 34 + 60);
  document.getElementById('chart-sector-cmp').parentElement.style.height = h + 'px';

  if (chartSector) chartSector.destroy();
  chartSector = new Chart(document.getElementById('chart-sector-cmp'), {
    type: 'bar',
    data: {
      labels: sectors,
      datasets: [
        { label: lA, data: pctA, backgroundColor: 'rgba(99,102,241,.65)',  borderColor: '#6366f1',  borderWidth: 1, borderRadius: 3 },
        { label: lB, data: pctB, backgroundColor: 'rgba(244,114,182,.65)', borderColor: '#f472b6', borderWidth: 1, borderRadius: 3 },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...ttOpts,
        callbacks: { label: ctx => `  ${ctx.dataset.label}: ${ctx.raw.toFixed(2)}%` }
      }},
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: muted, font: { family: SF, size: 13 }, callback: v => v + '%' }, border: { color: 'rgba(255,255,255,.06)' } },
        y: { grid: { display: false }, ticks: { color: '#c4b5fd', font: { family: SF, size: 13 } }, border: { display: false } }
      }
    }
  });
}

window.setCmpChartMetric = function (btn) {
  document.querySelectorAll('[onclick="setCmpChartMetric(this)"]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  cmpChartMetric = btn.dataset.metric;
  const lA = labelFor('a'), lB = labelFor('b');
  renderHoldingsChart(lA, lB,
    { backgroundColor: '#161b24', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
      titleFont: { family: SF, size: 11 }, bodyFont: { family: SF, size: 12 } },
    '#4d6480'
  );
};

function renderHoldingsChart(lA, lB, ttOpts, muted) {
  const isShares = cmpChartMetric === 'sharesDiff';
  const title    = isShares ? 'Shares Change (A→B)' : 'Report Mkt Value Change (M) (A→B)';
  document.getElementById('cmp-holdings-chart-title').textContent = title;

  // Only show stocks that changed
  const changed = diffRows.filter(r => r.status !== 'unchanged');
  const sorted  = [...changed].sort((a, b) =>
    Math.abs(isShares ? b.sharesDiff : b.mktDiff) - Math.abs(isShares ? a.sharesDiff : a.mktDiff)
  );

  const labels = sorted.map(r => r.code);
  const values = sorted.map(r => isShares ? r.sharesDiff : +r.mktDiff.toFixed(3));
  const barColors = values.map(v => v >= 0 ? 'rgba(0,230,118,.72)' : 'rgba(255,64,96,.72)');
  const borColors = values.map(v => v >= 0 ? '#00e676' : '#ff4060');

  const h = Math.max(300, sorted.length * 26 + 60);
  document.getElementById('holdings-chart-wrap').style.height = h + 'px';

  if (chartHoldings) chartHoldings.destroy();
  chartHoldings = new Chart(document.getElementById('chart-holdings-diff'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: title, data: values,
        backgroundColor: barColors, borderColor: borColors,
        borderWidth: 1, borderRadius: 3, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 280 },
      plugins: { legend: { display: false }, tooltip: { ...ttOpts,
        callbacks: {
          title: ctx => {
            const r = sorted[ctx[0].dataIndex];
            return `${r.code}${r.company ? ' — ' + r.company : ''}`;
          },
          label: ctx => {
            const r = sorted[ctx.dataIndex];
            const v = ctx.raw;
            const sign = v >= 0 ? '+' : '';
            const lines = [`  ${isShares ? 'Shares Δ: ' + sign + fmtInt(v) : 'Mkt Δ: ' + sign + fmt(v) + ' M'}`];
            lines.push(`  Status: ${r.status.toUpperCase()}`);
            lines.push(`  Mkt A: ৳${fmt(r.mktA)} M  →  B: ৳${fmt(r.mktB)} M`);
            return lines;
          }
        }
      }},
      scales: {
        x: { grid: { color: 'rgba(255,255,255,.05)' },
          ticks: { color: muted, font: { family: SF, size: 13 },
            callback: v => isShares ? fmtInt(v) : v + ' M' },
          border: { color: 'rgba(255,255,255,.06)' } },
        y: { grid: { display: false },
          ticks: { color: '#00f5c4', font: { family: SF, size: 12, weight: "700" } },
          border: { display: false } }
      }
    }
  });
}

/* ── DIFF TABLE ──────────────────────────────────────────────── */
window.setCmpFilter = function (btn) {
  document.querySelectorAll('.cmp-filter-btn[data-f]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  cmpFilter = btn.dataset.f;
  renderDiffTable();
};

function renderDiffTable() {
  const rows = cmpFilter === 'all' ? diffRows : diffRows.filter(r => r.status === cmpFilter);
  const tbody = document.getElementById('cmp-tbody');
  const tfoot = document.getElementById('cmp-tfoot');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:36px;color:var(--text-muted);font-family:var(--mono);font-size:11px">No holdings match this filter.</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  const statusBadge = s => `<span class="badge-${s}">${s.toUpperCase()}</span>`;
  const signed      = (v, suffix = '') => v === 0 ? '—' : (v > 0 ? `+${fmt(v)}${suffix}` : `${fmt(v)}${suffix}`);
  const signedInt   = v => v === 0 ? '—' : (v > 0 ? `+${fmtInt(v)}` : fmtInt(v));
  const signColor   = v => v > 0 ? 'color:var(--gain)' : v < 0 ? 'color:var(--loss)' : '';

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="code">${esc(r.code)}</td>
      <td style="color:var(--text-secondary);max-width:160px;overflow:hidden;text-overflow:ellipsis">${esc(r.company)}</td>
      <td><span class="sector-pill" style="font-size:9px">${esc(r.sector || '—')}</span></td>
      <td>${statusBadge(r.status)}</td>
      <td class="r">${r.sharesA ? fmtInt(r.sharesA) : '—'}</td>
      <td class="r">${r.sharesB ? fmtInt(r.sharesB) : '—'}</td>
      <td class="r" style="${signColor(r.sharesDiff)}">${signedInt(r.sharesDiff)}</td>
      <td class="r">${r.mktA ? '৳ ' + fmt(r.mktA) : '—'}</td>
      <td class="r">${r.mktB ? '৳ ' + fmt(r.mktB) : '—'}</td>
      <td class="r" style="${signColor(r.mktDiff)}">${signed(r.mktDiff, ' M')}</td>
      <td class="r" style="${signColor(r.mktDiff)}">
        ${r.mktPct !== null ? (r.mktPct >= 0 ? '+' : '') + r.mktPct.toFixed(2) + '%' : '—'}
      </td>
    </tr>`).join('');

  // ── Totals footer ──────────────────────────────────────────────
  const sumMktA    = rows.reduce((s, r) => s + r.mktA, 0);
  const sumMktB    = rows.reduce((s, r) => s + r.mktB, 0);
  const sumMktDiff = rows.reduce((s, r) => s + r.mktDiff, 0);
  const overallPct = sumMktA ? (sumMktDiff / sumMktA) * 100 : null;
  const dc = sumMktDiff > 0 ? 'var(--gain)' : sumMktDiff < 0 ? 'var(--loss)' : 'var(--text-muted)';

  tfoot.innerHTML = `<tr>
    <td colspan="4" style="color:var(--text-muted);letter-spacing:1.5px;text-transform:uppercase;font-size:10px">
      TOTAL &nbsp;<span style="font-weight:400;font-size:9px">(${rows.length} stock${rows.length !== 1 ? 's' : ''})</span>
    </td>
    <td class="r"></td>
    <td class="r"></td>
    <td class="r"></td>
    <td class="r" style="color:var(--text-primary)">৳ ${fmt(sumMktA)} M</td>
    <td class="r" style="color:var(--text-primary)">৳ ${fmt(sumMktB)} M</td>
    <td class="r" style="color:${dc}">${sumMktDiff >= 0 ? '+' : ''}${fmt(sumMktDiff)} M</td>
    <td class="r" style="color:${dc}">
      ${overallPct !== null ? (overallPct >= 0 ? '+' : '') + overallPct.toFixed(2) + '%' : '—'}
    </td>
  </tr>`;
}