/**
 * mf-portfolio.js
 * ─────────────────────────────────────────────────────────────
 * Frontend logic for the Mutual Fund quarterly portfolio page.
 * Uses the server API at /api/mf-portfolio/:code/...
 */

import { initTheme, toggleTheme } from '../theme/theme.js';

'use strict';

const API  = '/api';
const COLORS = [
  '#00f5c4','#6366f1','#f472b6','#facc15','#3b82f6',
  '#f97316','#22d47a','#a78bfa','#67e8f9','#fb923c',
  '#34d399','#818cf8','#f0a830','#e879f9','#38bdf8',
];

/* ── STATE ───────────────────────────────────────────────────── */
const params    = new URLSearchParams(window.location.search);
const FUND_CODE = (params.get('code') || '').toUpperCase();
const FUND_NAME = params.get('name') || FUND_CODE;

let portfolio   = null;   // current loaded quarter data
let allStocks   = [];     // live prices from /api/stocks
let stockSectors = {};    // code → sector from stock-sectors.json
let stockLogos   = {};    // code → logo URL from stock-logos.json
let chartSector  = null;
let chartTop10   = null;
let chartCostMkt = null;
//let chartHistory  = null;
let chartFundPrice = null;

/* ── BOOT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  if (!FUND_CODE) { toast('No fund code in URL', 'error'); return; }

  initTheme();
  document.getElementById('theme-toggle-btn')
    .addEventListener('click', () => toggleTheme());

  document.getElementById('fund-name-header').textContent = FUND_NAME || FUND_CODE;
  document.getElementById('fund-code-header').textContent = FUND_CODE + ' · Mutual Fund Portfolio';
  document.getElementById('back-to-company').href = `/company_profile/company.html?code=${FUND_CODE}`;
  document.title = `${FUND_CODE} MF Portfolio — DSE`;

  // Populate year select (current year ±5)
  const sel = document.getElementById('sel-year');
  const cur = new Date().getFullYear();
  for (let y = cur + 1; y >= cur - 10; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === cur) o.selected = true;
    sel.appendChild(o);
  }

  // Load stock sectors from static JSON (background)
  fetch('/data/stock-sectors.json')
    .then(r => r.json())
    .then(d => { stockSectors = d || {}; })
    .catch(() => {});

  fetch('/data/stock-logos.json')
    .then(r => r.json())
    .then(d => { stockLogos = d || {}; })
    .catch(() => {});

  // Load live prices and wait for them before loading portfolio
  try {
    const stockRes = await fetch(`${API}/stocks`);
    const stockData = await stockRes.json();
    allStocks = stockData.stocks || [];
  } catch (err) {
    console.warn('Failed to load live stocks:', err);
    allStocks = [];
  }

  // Default the year/quarter selectors to this fund's actual most recent
  // filed quarter (not just "current calendar year, Q1") — a fund's latest
  // data is often from an earlier year/quarter than today's date, so
  // hardcoding "this year" would silently show an empty/wrong quarter for
  // any fund not yet updated for the current year.
  try {
    const qRes = await fetch(`${API}/mf-portfolio/${FUND_CODE}/quarters`);
    const qData = await qRes.json();
    const latest = (qData.quarters || [])[0]; // already sorted newest-first
    if (latest) {
      const yearSel = document.getElementById('sel-year');
      if (![...yearSel.options].some(o => o.value === String(latest.year))) {
        const o = document.createElement('option');
        o.value = latest.year; o.textContent = latest.year;
        yearSel.appendChild(o);
      }
      yearSel.value = latest.year;
      document.getElementById('sel-quarter').value = latest.quarter;
    }
  } catch (err) {
    console.warn('Failed to load quarters list, defaulting to current year/Q1:', err);
  }

  // Now load portfolio - stock data will be available for LTP population
  await loadPortfolio();
});

/* ── LOAD PORTFOLIO ──────────────────────────────────────────── */
window.loadPortfolio = async function () {
  const year    = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  try {
    const r = await fetch(`${API}/mf-portfolio/${FUND_CODE}/${year}/${quarter}`);
    portfolio = await r.json();
    renderAllWithHistory();
    // Refresh LTP values after rendering (in case stock data arrived)
    refreshLTP();
    show('summary-row');
    show('charts-row');
    show('analysis-row');
    show('history-row');
    show('table-card');
    hide('mf-empty');
    document.getElementById('quarter-label').textContent = `${FUND_CODE} — ${year} ${quarter}`;
    document.getElementById('delete-quarter-btn').style.display =
      portfolio.holdings && portfolio.holdings.length ? 'inline-flex' : 'none';
  } catch (e) {
    toast('Failed to load: ' + e.message, 'error');
  }
};

/* ── REFRESH LTP VALUES ──────────────────────────────────────── */
function refreshLTP() {
  if (!portfolio || !allStocks.length) return;
  const priceMap = {};
  allStocks.forEach(s => { priceMap[s.code] = s.ltp || s.ycp || 0; });
  portfolio.holdings.forEach(h => {
    const ltp = priceMap[h.stockCode] || 0;
    h._ltp = ltp;
    // _liveMkt is purely LTP-based; null means LTP unavailable
    h._liveMkt = (ltp && h.shares) ? (ltp * h.shares) / 1_000_000 : null;
  });
  renderAll();
}

/* ── RENDER ALL ──────────────────────────────────────────────── */
function renderAll() {
  if (!portfolio) return;
  renderSummary();
  renderTable();
  renderCharts();
  renderAnalysis();
}

// Called once after portfolio loads — triggers both history charts
function renderAllWithHistory() {
  renderAll();
  loadAndRenderHistory();
  loadAndRenderFundPrice();
}

/* ── SUMMARY ─────────────────────────────────────────────────── */
function renderSummary() {
  const h = portfolio.holdings || [];
  const totalCost    = h.reduce((s, x) => s + (x.costValue   || 0), 0);
  const totalReportMkt = h.reduce((s, x) => s + (x.marketValue || 0), 0);
  const totalLiveMkt   = h.every(x => x._liveMkt != null)
    ? h.reduce((s, x) => s + (x._liveMkt || 0), 0)
    : null;
  // P&L uses live market value if available, otherwise report value
  const totalMktForPL = totalLiveMkt ?? totalReportMkt;
  const pl = totalMktForPL - totalCost;
  const meta = portfolio.meta || {};

  document.getElementById('s-holdings').textContent = h.length;
  document.getElementById('s-cost').textContent     = fmt(totalCost) + ' M';
  // Show live market value if available, else report value
  const mktEl = document.getElementById('s-mkt');
  mktEl.textContent = fmt(totalLiveMkt ?? totalReportMkt) + ' M';
  mktEl.title = totalLiveMkt != null
    ? `Report: ${fmt(totalReportMkt)} M | Live: ${fmt(totalLiveMkt)} M`
    : `Report value: ${fmt(totalReportMkt)} M`;
  const plEl = document.getElementById('s-pl');
  plEl.textContent = (pl >= 0 ? '+' : '') + fmt(pl) + ' M';
  plEl.className = 'mf-stat-val ' + (pl >= 0 ? 'gain' : 'loss');
  document.getElementById('s-nav').textContent  = meta.navPerUnit ? '৳ ' + fmt(meta.navPerUnit) : '—';
  document.getElementById('s-date').textContent = meta.date || '—';
}

/* ── TABLE ───────────────────────────────────────────────────── */
window.renderTable = function () {
  if (!portfolio) return;
  const q = (document.getElementById('holding-search').value || '').toLowerCase();
  const rows = (portfolio.holdings || []).filter(h =>
    !q || h.stockCode.toLowerCase().includes(q) ||
          (h.company || '').toLowerCase().includes(q) ||
          (h.sector  || '').toLowerCase().includes(q)
  );

  const totalMkt = (portfolio.holdings || [])
    .reduce((s, x) => s + (x._liveMkt ?? x.marketValue ?? 0), 0);
  // ^ uses live if available, report otherwise — for % of Total column

  const tbody = document.getElementById('holdings-tbody');

  // Group by sector for sub-totals
  const sectors = [...new Set(rows.map(r => r.sector || 'OTHER'))];

  let html = '';
  let grandCost = 0, grandReportMkt = 0, grandLiveMkt = 0;
  let grandLiveMktAvail = true; // false if any holding has no LTP

  sectors.forEach(sec => {
    const secRows = rows.filter(r => (r.sector || 'OTHER') === sec);
    let secCost = 0, secReportMkt = 0, secLiveMkt = 0, secShares = 0;
    let secLiveMktAvail = true;
    secRows.forEach((h, idx) => {
      const ltp        = h._ltp || 0;
      const reportMkt  = h.marketValue || 0;                          // stored in JSON
      const liveMkt    = h._liveMkt != null ? h._liveMkt : null;      // LTP × shares / 1M
      const avgBuy     = (h.shares && h.costValue) ? (h.costValue * 1_000_000) / h.shares : 0;
      // Appreciation always compared against stored cost value
      const apprec     = (liveMkt ?? reportMkt) - (h.costValue || 0);
      const pctChg     = h.costValue ? (apprec / h.costValue * 100) : 0;
      // Gap between Live Mkt and Quarterly Value
      const gap        = liveMkt != null ? (liveMkt - reportMkt) : null;
      const gapPct     = (liveMkt != null && reportMkt > 0) ? ((liveMkt - reportMkt) / reportMkt * 100) : 0;
      // % of total uses live mkt if available, else report mkt
      const mktForPct  = liveMkt ?? reportMkt;
      const pctTotal   = totalMkt ? (mktForPct / totalMkt * 100) : 0;
      secCost       += h.costValue || 0;
      secReportMkt  += reportMkt;
      if (liveMkt != null) secLiveMkt += liveMkt;
      else secLiveMktAvail = false;
      secShares += h.shares || 0;

      const gc = apprec >= 0 ? 'gain-text' : 'loss-text';
      const s  = apprec >= 0 ? '+' : '';
      const gapColor = gap != null ? (gap > 0 ? 'var(--gain)' : gap < 0 ? 'var(--loss)' : 'var(--text-secondary)') : 'var(--text-muted)';

      html += `<tr>
        <td data-col="sl" style="font-family:var(--mono);font-size:9px;color:var(--text-muted);text-align:center">${idx + 1}</td>
        <td data-col="sector">${idx === 0 ? `<span class="sector-pill">${esc(sec)}</span>` : ''}</td>
        <td data-col="company" style="color:var(--text-secondary)">
          <span style="display:flex;align-items:center;gap:8px">
            ${stockLogos[h.stockCode] ? `<img src="${esc(stockLogos[h.stockCode])}" alt="" style="width:18px;height:18px;border-radius:50%;object-fit:cover;flex-shrink:0;background:var(--bg-input);border:1px solid var(--border)" onerror="this.style.display='none'"/>` : ''}
            <span>${esc(h.company || h.stockCode)}</span>
          </span>
        </td>
        <td data-col="code" class="code-cell">${esc(h.stockCode)}</td>
        <td data-col="shares" class="num">${fmtInt(h.shares)}</td>
        <td data-col="costValue" class="num">৳ ${fmt(h.costValue)}</td>
        <td data-col="avgBuy" class="num" style="color:var(--text-secondary)">
          ${avgBuy ? '৳ ' + fmt2(avgBuy) : '—'}
        </td>
        <td data-col="reportMkt" class="num" style="color:var(--text-secondary)">
          ৳ ${fmt(reportMkt)}
        </td>
        <td data-col="ltp" class="num" style="color:${ltp ? 'var(--accent)' : 'var(--text-muted)'}">
          ${ltp ? '৳ ' + fmt2(ltp) : '—'}
        </td>
        <td data-col="liveMkt" class="num" style="color:${liveMkt != null ? (liveMkt > reportMkt ? 'var(--gain)' : liveMkt < reportMkt ? 'var(--loss)' : 'var(--text-secondary)') : 'var(--text-muted)'}; font-weight: ${liveMkt != null && liveMkt !== reportMkt ? '700' : 'normal'}">
          ${liveMkt != null ? '৳ ' + fmt(liveMkt) : '—'}
        </td>
        <td data-col="gap" class="num" style="color:${gapColor}; font-weight: ${gap != null && gap !== 0 ? '700' : 'normal'}">
          ${gap != null ? (gap >= 0 ? '+' : '') + '৳ ' + fmt(gap) : '—'}
        </td>
        <td data-col="gapPct" class="num" style="color:${gapColor}; font-weight: ${gap != null && gap !== 0 ? '700' : 'normal'}">
          ${gap != null ? (gapPct >= 0 ? '+' : '') + gapPct.toFixed(2) + '%' : '—'}
        </td>
        <td data-col="apprec" class="num ${gc}">${s}৳ ${fmt(apprec)}</td>
        <td data-col="pctChange" class="num ${gc}">${s}${pctChg.toFixed(2)}%</td>
        <td data-col="pctTotal" class="num">${pctTotal.toFixed(2)}%</td>
        <td data-col="actions" class="center">
          <div class="row-actions">
            <button class="mf-btn mf-btn-sm mf-btn-ghost" onclick="openEditModal('${h.id}')">Edit</button>
            <button class="mf-btn mf-btn-sm mf-btn-danger" onclick="confirmDelete('${h.id}','${esc(h.stockCode)}')">Del</button>
          </div>
        </td>
      </tr>`;
    });

    // Sector sub-total row
    grandCost       += secCost;
    grandReportMkt  += secReportMkt;
    if (secLiveMktAvail) grandLiveMkt += secLiveMkt;
    else grandLiveMktAvail = false;
    const secGap    = secLiveMktAvail ? (secLiveMkt - secReportMkt) : null;
    const secGapPct = (secLiveMktAvail && secReportMkt > 0) ? ((secLiveMkt - secReportMkt) / secReportMkt * 100) : 0;
    const secApprec = (secLiveMktAvail ? secLiveMkt : secReportMkt) - secCost;
    const secPct    = secCost ? (secApprec / secCost * 100) : 0;
    const sg = secApprec >= 0 ? 'gain-text' : 'loss-text';
    const secGapColor = secGap != null ? (secGap > 0 ? 'var(--gain)' : secGap < 0 ? 'var(--loss)' : 'var(--text-secondary)') : 'var(--text-muted)';
    html += `<tr style="background:rgba(0,0,0,.12)">
      <td data-col="sl"></td>
      <td data-col="sector" style="font-family:var(--mono);font-size:9px;color:var(--text-muted);padding:6px 14px;letter-spacing:1px;white-space:nowrap">SUB-TOTAL: ${esc(sec)}</td>
      <td data-col="company"></td>
      <td data-col="code"></td>
      <td data-col="shares" class="num" style="font-weight:700">${fmtInt(secShares)}</td>
      <td data-col="costValue" class="num" style="font-weight:700">৳ ${fmt(secCost)}</td>
      <td data-col="avgBuy"></td>
      <td data-col="reportMkt" class="num" style="font-weight:700">৳ ${fmt(secReportMkt)}</td>
      <td data-col="ltp"></td>
      <td data-col="liveMkt" class="num" style="font-weight:700;color:${secLiveMktAvail ? (secLiveMkt > secReportMkt ? 'var(--gain)' : secLiveMkt < secReportMkt ? 'var(--loss)' : 'var(--text-secondary)') : 'var(--text-muted)'}">
        ${secLiveMktAvail ? '৳ ' + fmt(secLiveMkt) : '—'}
      </td>
      <td data-col="gap" class="num" style="font-weight:700;color:${secGapColor}">
        ${secGap != null ? (secGap >= 0 ? '+' : '') + '৳ ' + fmt(secGap) : '—'}
      </td>
      <td data-col="gapPct" class="num" style="font-weight:700;color:${secGapColor}">
        ${secGap != null ? (secGapPct >= 0 ? '+' : '') + secGapPct.toFixed(2) + '%' : '—'}
      </td>
      <td data-col="apprec" class="num ${sg}" style="font-weight:700">${secApprec >= 0 ? '+' : ''}৳ ${fmt(secApprec)}</td>
      <td data-col="pctChange" class="num ${sg}" style="font-weight:700">${secApprec >= 0 ? '+' : ''}${secPct.toFixed(2)}%</td>
      <td data-col="pctTotal"></td>
      <td data-col="actions"></td>
    </tr>`;
  });

  tbody.innerHTML = html || '<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--text-muted);font-family:var(--mono);font-size:11px">No holdings found.</td></tr>';

  // Grand total footer
  const grandGap      = grandLiveMktAvail ? (grandLiveMkt - grandReportMkt) : null;
  const grandGapPct   = (grandLiveMktAvail && grandReportMkt > 0) ? ((grandLiveMkt - grandReportMkt) / grandReportMkt * 100) : 0;
  const grandApprec = (grandLiveMktAvail ? grandLiveMkt : grandReportMkt) - grandCost;
  const gp = grandCost ? (grandApprec / grandCost * 100) : 0;
  const gg = grandApprec >= 0 ? 'var(--gain)' : 'var(--loss)';
  const grandGapColor = grandGap != null ? (grandGap > 0 ? 'var(--gain)' : grandGap < 0 ? 'var(--loss)' : 'var(--text-secondary)') : 'var(--text-muted)';
  document.getElementById('holdings-tfoot').innerHTML = `<tr>
    <td data-col="sl"></td>
    <td data-col="sector" class="foot-lbl">GRAND TOTAL</td>
    <td data-col="company"></td>
    <td data-col="code"></td>
    <td data-col="shares"></td>
    <td data-col="costValue">৳ ${fmt(grandCost)}</td>
    <td data-col="avgBuy"></td>
    <td data-col="reportMkt">৳ ${fmt(grandReportMkt)}</td>
    <td data-col="ltp"></td>
    <td data-col="liveMkt" style="color:${grandLiveMktAvail ? (grandLiveMkt > grandReportMkt ? 'var(--gain)' : grandLiveMkt < grandReportMkt ? 'var(--loss)' : 'var(--text-secondary)') : 'var(--text-muted)'}">
      ${grandLiveMktAvail ? '৳ ' + fmt(grandLiveMkt) : '—'}
    </td>
    <td data-col="gap" style="color:${grandGapColor}">
      ${grandGap != null ? (grandGap >= 0 ? '+' : '') + '৳ ' + fmt(grandGap) : '—'}
    </td>
    <td data-col="gapPct" style="color:${grandGapColor}">
      ${grandGap != null ? (grandGapPct >= 0 ? '+' : '') + grandGapPct.toFixed(2) + '%' : '—'}
    </td>
    <td data-col="apprec" style="color:${gg}">${grandApprec >= 0 ? '+' : ''}৳ ${fmt(grandApprec)}</td>
    <td data-col="pctChange" style="color:${gg}">${grandApprec >= 0 ? '+' : ''}${gp.toFixed(2)}%</td>
    <td data-col="pctTotal"></td>
    <td data-col="actions"></td>
  </tr>`;
};

/* ── CHARTS ──────────────────────────────────────────────────── */
function renderCharts() {
  if (!portfolio) return;
  const h    = portfolio.holdings || [];
  const opts = { responsive: true, maintainAspectRatio: false };
  const safeFont = "'DM Sans', sans-serif";
  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#8fa3c0';

  // ── Sector Donut ──────────────────────────────────────────────
  const sectorMap = {};
  h.forEach(x => {
    const sec = x.sector || 'OTHER';
    sectorMap[sec] = (sectorMap[sec] || 0) + (x._liveMkt ?? x.marketValue ?? 0);
  });
  const sectorEntries = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);

  if (chartSector) chartSector.destroy();
  chartSector = new Chart(document.getElementById('chart-sector'), {
    type: 'doughnut',
    data: {
      labels: sectorEntries.map(([k]) => k),
      datasets: [{
        data: sectorEntries.map(([, v]) => parseFloat(v.toFixed(2))),
        backgroundColor: sectorEntries.map((_, i) => COLORS[i % COLORS.length] + 'cc'),
        borderColor:     sectorEntries.map((_, i) => COLORS[i % COLORS.length]),
        borderWidth: 1.5,
      }]
    },
    options: { ...opts,
      cutout: '60%',
      plugins: {
        legend: { position: 'right', labels: { color: textColor, font: { family: safeFont, size: 10 }, boxWidth: 10, padding: 8 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ৳${fmt(ctx.raw)}M (${(ctx.raw / sectorEntries.reduce((s,[,v])=>s+v,0)*100).toFixed(1)}%)` } }
      }
    }
  });

  // ── Top 10 Holdings Bar ───────────────────────────────────────
  const totalMkt = h.reduce((s, x) => s + (x._liveMkt ?? x.marketValue ?? 0), 0);
  const top10    = [...h].sort((a, b) => (b._liveMkt ?? b.marketValue ?? 0) - (a._liveMkt ?? a.marketValue ?? 0)).slice(0, 10);

  if (chartTop10) chartTop10.destroy();
  chartTop10 = new Chart(document.getElementById('chart-top10'), {
    type: 'bar',
    data: {
      labels: top10.map(x => x.stockCode),
      datasets: [{
        label: '% of Total Market Value',
        data: top10.map(x => totalMkt ? parseFloat(((x._liveMkt ?? x.marketValue ?? 0) / totalMkt * 100).toFixed(2)) : 0),
        backgroundColor: top10.map((_, i) => COLORS[i % COLORS.length] + 'bb'),
        borderColor:     top10.map((_, i) => COLORS[i % COLORS.length]),
        borderWidth: 1, borderRadius: 4,
      }]
    },
    options: { ...opts,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw}%` } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: safeFont, size: 10 } }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: textColor, font: { family: safeFont, size: 10 }, callback: v => v + '%' }, border: { color: 'rgba(255,255,255,.07)' } }
      }
    }
  });

  // ── Cost vs Market by Sector grouped bar ─────────────────────
  const costMap = {};
  h.forEach(x => {
    const sec = x.sector || 'OTHER';
    if (!costMap[sec]) costMap[sec] = { cost: 0, mkt: 0 };
    costMap[sec].cost += x.costValue || 0;
    costMap[sec].mkt  += x._liveMkt ?? x.marketValue ?? 0;
  });
  const sectorKeys = Object.keys(costMap);

  if (chartCostMkt) chartCostMkt.destroy();
  chartCostMkt = new Chart(document.getElementById('chart-costmkt'), {
    type: 'bar',
    data: {
      labels: sectorKeys,
      datasets: [
        { label: 'Buying Value (M)',  data: sectorKeys.map(k => parseFloat(costMap[k].cost.toFixed(2))), backgroundColor: 'rgba(99,102,241,.7)',  borderColor: '#6366f1', borderWidth: 1, borderRadius: 3 },
        { label: 'Market Value (M)', data: sectorKeys.map(k => parseFloat(costMap[k].mkt.toFixed(2))),  backgroundColor: 'rgba(0,245,196,.55)', borderColor: '#00f5c4', borderWidth: 1, borderRadius: 3 },
      ]
    },
    options: { ...opts,
      plugins: { legend: { labels: { color: textColor, font: { family: safeFont, size: 10 }, boxWidth: 10 } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: textColor, font: { family: safeFont, size: 9 }, maxRotation: 30 }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: textColor, font: { family: safeFont, size: 10 }, callback: v => '৳' + v }, border: { color: 'rgba(255,255,255,.07)' } }
      }
    }
  });
}

/* ── ANALYSIS: CONCENTRATION + GAINERS/LOSERS ──────────────────
   Uses only data already on hand (no new fields needed):
   - Concentration: top-5 % of market value, and a Herfindahl-
     Hirschman Index (HHI) computed from each holding's weight.
     HHI ranges 0–10,000; >1,500 is commonly read as "concentrated",
     >2,500 as "highly concentrated" — shown here as a simple gauge.
   - Gainers/Losers: ranks holdings by live % change vs cost
     (falls back to report market value if LTP isn't available).
   ──────────────────────────────────────────────────────────── */
function renderAnalysis() {
  if (!portfolio) return;
  const h = portfolio.holdings || [];
  const grid = document.getElementById('conc-grid');
  const gainersEl = document.getElementById('leaders-gainers');
  const losersEl  = document.getElementById('leaders-losers');
  if (!grid || !gainersEl || !losersEl) return;

  if (!h.length) {
    grid.innerHTML = '<div class="mf-leaders-empty">No holdings to analyze.</div>';
    gainersEl.innerHTML = '<div class="mf-leaders-empty">—</div>';
    losersEl.innerHTML  = '<div class="mf-leaders-empty">—</div>';
    return;
  }

  const totalMkt = h.reduce((s, x) => s + (x._liveMkt ?? x.marketValue ?? 0), 0);

  // ── Concentration ──
  const weighted = h
    .map(x => ({ code: x.stockCode, mkt: x._liveMkt ?? x.marketValue ?? 0 }))
    .sort((a, b) => b.mkt - a.mkt);
  const weights  = totalMkt ? weighted.map(x => x.mkt / totalMkt) : [];
  const top5Pct  = totalMkt
    ? (weighted.slice(0, 5).reduce((s, x) => s + x.mkt, 0) / totalMkt * 100)
    : 0;
  const top1Pct  = totalMkt && weighted.length ? (weighted[0].mkt / totalMkt * 100) : 0;
  const hhi      = weights.reduce((s, w) => s + (w * 100) * (w * 100), 0); // 0–10,000 scale

  const hhiLevel = hhi >= 2500 ? { label: 'Highly Concentrated', cls: 'warn' }
                 : hhi >= 1500 ? { label: 'Moderately Concentrated', cls: 'mid' }
                 : { label: 'Well Diversified', cls: '' };

  const concItems = [
    {
      lbl: 'Largest Single Holding', sub: weighted[0] ? weighted[0].code : '—',
      val: top1Pct.toFixed(1) + '%', pct: top1Pct, cls: top1Pct >= 20 ? 'warn' : top1Pct >= 10 ? 'mid' : ''
    },
    {
      lbl: 'Top 5 Holdings', sub: `${Math.min(5, weighted.length)} of ${h.length} stocks`,
      val: top5Pct.toFixed(1) + '%', pct: top5Pct, cls: top5Pct >= 60 ? 'warn' : top5Pct >= 40 ? 'mid' : ''
    },
    {
      lbl: 'Herfindahl Index (HHI)', sub: hhiLevel.label,
      val: Math.round(hhi).toLocaleString('en-BD'), pct: Math.min(100, hhi / 100), cls: hhiLevel.cls
    },
    {
      lbl: 'Sector Count', sub: 'distinct sectors held',
      val: new Set(h.map(x => x.sector || 'OTHER')).size, pct: null, cls: ''
    },
  ];

  grid.innerHTML = concItems.map(c => `
    <div class="mf-conc-item" style="flex-direction:column;align-items:stretch;gap:4px">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="mf-conc-lbl">${esc(c.lbl)}<small>${esc(c.sub)}</small></div>
        <div class="mf-conc-val">${c.val}</div>
      </div>
      ${c.pct !== null ? `<div class="mf-conc-bar-track"><div class="mf-conc-bar-fill ${c.cls}" style="width:${Math.min(100, c.pct)}%"></div></div>` : ''}
    </div>
  `).join('');

  // ── Gainers / Losers (by live % change vs cost) ──
  const ranked = h.map(x => {
    const liveMkt = x._liveMkt ?? x.marketValue ?? 0;
    const cost    = x.costValue || 0;
    const pctChg  = cost ? ((liveMkt - cost) / cost * 100) : null;
    return { code: x.stockCode, sector: x.sector || 'OTHER', pctChg, hasLtp: x._liveMkt != null };
  }).filter(x => x.pctChg !== null);

  const gainers = [...ranked].filter(x => x.pctChg > 0).sort((a, b) => b.pctChg - a.pctChg).slice(0, 5);
  const losers  = [...ranked].filter(x => x.pctChg < 0).sort((a, b) => a.pctChg - b.pctChg).slice(0, 5);

  const rowHtml = (r, cls) => `
    <div class="mf-leader-row">
      <span><span class="mf-leader-code">${esc(r.code)}</span><span class="mf-leader-sector">${esc(r.sector)}</span></span>
      <span class="mf-leader-pct ${cls}">${r.pctChg >= 0 ? '+' : ''}${r.pctChg.toFixed(2)}%</span>
    </div>`;

  gainersEl.innerHTML = gainers.length
    ? gainers.map(r => rowHtml(r, 'gain')).join('')
    : '<div class="mf-leaders-empty">No gainers this quarter.</div>';
  losersEl.innerHTML = losers.length
    ? losers.map(r => rowHtml(r, 'loss')).join('')
    : '<div class="mf-leaders-empty">No losers this quarter.</div>';
}

/* ── CSV EXPORT ──────────────────────────────────────────────── */
window.exportHoldingsCSV = function () {
  if (!portfolio || !(portfolio.holdings || []).length) { toast('Nothing to export.', 'error'); return; }
  const q = (document.getElementById('holding-search').value || '').toLowerCase();
  const rows = (portfolio.holdings || []).filter(h =>
    !q || h.stockCode.toLowerCase().includes(q) ||
          (h.company || '').toLowerCase().includes(q) ||
          (h.sector  || '').toLowerCase().includes(q)
  );

  const header = [
    'Sector','Company','Code','Shares','Buying Value (M)','Avg Buy (BDT)',
    'Quarterly Value (M)','LTP (BDT)','Live Mkt (M)','Gap (M)','Gap %',
    'Live Gain (M)','% Live Change','% of Total'
  ];

  const totalMkt = (portfolio.holdings || []).reduce((s, x) => s + (x._liveMkt ?? x.marketValue ?? 0), 0);

  const csvEsc = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = rows.map(h => {
    const ltp       = h._ltp || 0;
    const reportMkt = h.marketValue || 0;
    const liveMkt   = h._liveMkt != null ? h._liveMkt : null;
    const avgBuy    = (h.shares && h.costValue) ? (h.costValue * 1_000_000) / h.shares : 0;
    const apprec    = (liveMkt ?? reportMkt) - (h.costValue || 0);
    const pctChg    = h.costValue ? (apprec / h.costValue * 100) : 0;
    const gap       = liveMkt != null ? (liveMkt - reportMkt) : null;
    const gapPct    = (liveMkt != null && reportMkt > 0) ? ((liveMkt - reportMkt) / reportMkt * 100) : 0;
    const pctTotal  = totalMkt ? ((liveMkt ?? reportMkt) / totalMkt * 100) : 0;

    return [
      h.sector || '', h.company || h.stockCode, h.stockCode, h.shares || 0,
      fmt(h.costValue || 0), avgBuy ? fmt2(avgBuy) : '',
      fmt(reportMkt), ltp ? fmt2(ltp) : '',
      liveMkt != null ? fmt(liveMkt) : '', gap != null ? fmt(gap) : '',
      gap != null ? gapPct.toFixed(2) : '', fmt(apprec), pctChg.toFixed(2), pctTotal.toFixed(2)
    ].map(csvEsc).join(',');
  });

  const csv = [header.join(','), ...lines].join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const year = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${FUND_CODE}_${year}_${quarter}_holdings.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('CSV exported.', 'success');
};

/* ── ADD / EDIT HOLDING ──────────────────────────────────────── */
window.openAddModal = function () {
  clearHoldingForm();
  document.getElementById('modal-title').textContent = 'Add Holding';
  document.getElementById('holding-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('h-code-search').focus(), 60);
};

window.openEditModal = function (id) {
  const h = (portfolio.holdings || []).find(x => x.id === id);
  if (!h) return;
  document.getElementById('modal-title').textContent = 'Edit Holding';
  document.getElementById('h-id').value          = h.id;
  document.getElementById('h-code').value        = h.stockCode;
  document.getElementById('h-code-search').value = h.stockCode;
  document.getElementById('h-sector').value      = h.sector  || '';
  document.getElementById('h-shares').value      = h.shares  || '';
  document.getElementById('h-cost').value        = h.costValue   || '';
  document.getElementById('h-mkt').value         = h.marketValue || '';
  updatePreview();
  document.getElementById('holding-modal').classList.remove('hidden');
};

function clearHoldingForm() {
  ['h-id','h-code','h-code-search','h-sector','h-shares','h-cost','h-mkt'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('h-preview').textContent = '';
  document.getElementById('h-error').textContent   = '';
  closeStockDropdown();
}

/* ── STOCK PICKER ────────────────────────────────────────────── */
window.filterStockPicker = function () {
  const q   = document.getElementById('h-code-search').value.trim().toUpperCase();
  const dd  = document.getElementById('h-stock-dropdown');

  // Clear selected code when user types
  document.getElementById('h-code').value   = '';
  document.getElementById('h-sector').value = '';

  if (!q) { dd.classList.remove('open'); dd.innerHTML = ''; return; }

  const matches = allStocks
    .filter(s => s.code.includes(q) || (s.name && String(s.name).toUpperCase().includes(q)))
    .slice(0, 40);

  if (!matches.length) {
    dd.innerHTML = `<div class="mf-stock-option-empty">No stocks found for "${q}"</div>`;
    dd.classList.add('open');
    return;
  }

  dd.innerHTML = matches.map(s => {
    const sector = stockSectors[s.code] || '—';
    const logo   = stockLogos[s.code] || '';
    return `<div class="mf-stock-option" onclick="selectStock('${s.code}')">
      <span style="display:flex;align-items:center;gap:8px;min-width:0">
        ${logo ? `<img src="${esc(logo)}" alt="" class="mf-stock-option-logo" onerror="this.style.display='none'"/>` : ''}
        <span class="mf-stock-option-code">${esc(s.code)}</span>
      </span>
      <span class="mf-stock-option-sector">${esc(sector)}</span>
    </div>`;
  }).join('');
  dd.classList.add('open');
};

window.selectStock = function (code) {
  document.getElementById('h-code').value        = code;
  document.getElementById('h-code-search').value = code;
  document.getElementById('h-sector').value      = stockSectors[code] || '';
  closeStockDropdown();
  document.getElementById('h-shares').focus();
  updatePreview();
};

function closeStockDropdown() {
  const dd = document.getElementById('h-stock-dropdown');
  if (dd) { dd.classList.remove('open'); dd.innerHTML = ''; }
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.mf-stock-picker-wrap')) closeStockDropdown();
});

window.updatePreview = function () {
  const shares = parseFloat(document.getElementById('h-shares').value) || 0;
  const cost   = parseFloat(document.getElementById('h-cost').value)   || 0;
  const mkt    = parseFloat(document.getElementById('h-mkt').value)    || 0;
  const prev   = document.getElementById('h-preview');
  if (!shares && !cost) { prev.textContent = ''; return; }
  const apprec = mkt - cost;
  const pct    = cost ? (apprec / cost * 100).toFixed(2) : '0.00';
  const clr    = apprec >= 0 ? 'var(--gain)' : 'var(--loss)';
  prev.innerHTML = `Shares: ${fmtInt(shares)} &nbsp;·&nbsp; Cost: ৳${fmt(cost)}M &nbsp;·&nbsp; Market: ৳${fmt(mkt)}M &nbsp;·&nbsp; <span style="color:${clr}">${apprec >= 0 ? '+' : ''}৳${fmt(apprec)}M (${pct}%)</span>`;
};

window.saveHolding = async function () {
  const id      = document.getElementById('h-id').value;
  const code    = document.getElementById('h-code').value.trim().toUpperCase();
  const sector  = document.getElementById('h-sector').value.trim();
  const shares  = parseFloat(document.getElementById('h-shares').value);
  const cost    = parseFloat(document.getElementById('h-cost').value);
  const mkt     = parseFloat(document.getElementById('h-mkt').value);

  if (!code)        { document.getElementById('h-error').textContent = 'Please select a stock code.'; return; }
  if (isNaN(shares)){ document.getElementById('h-error').textContent = 'Shares required.'; return; }
  if (isNaN(cost))  { document.getElementById('h-error').textContent = 'Cost value required.'; return; }

  const year    = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  const body    = { stockCode: code, company: code, sector, shares, costValue: cost, marketValue: mkt || 0 };

  try {
    if (id) {
      await apiFetch(`/mf-portfolio/${FUND_CODE}/${year}/${quarter}/holdings/${id}`, 'PATCH', body);
      toast('Holding updated.', 'success');
    } else {
      await apiFetch(`/mf-portfolio/${FUND_CODE}/${year}/${quarter}/holdings`, 'POST', body);
      toast('Holding added!', 'success');
    }
    closeModal('holding-modal');
    await loadPortfolio();
  } catch (e) {
    document.getElementById('h-error').textContent = e.message;
  }
};

/* ── DELETE HOLDING ──────────────────────────────────────────── */
window.confirmDelete = function (id, code) {
  document.getElementById('confirm-title').textContent = 'Remove Holding';
  document.getElementById('confirm-msg').textContent   = `Remove ${code} from this portfolio? This cannot be undone.`;
  document.getElementById('confirm-ok').onclick = () => deleteHolding(id);
  document.getElementById('confirm-modal').classList.remove('hidden');
};

async function deleteHolding(id) {
  const year    = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  try {
    await apiFetch(`/mf-portfolio/${FUND_CODE}/${year}/${quarter}/holdings/${id}`, 'DELETE');
    closeModal('confirm-modal');
    toast('Holding removed.', 'info');
    await loadPortfolio();
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

/* ── DELETE QUARTER ──────────────────────────────────────────── */
window.deleteQuarter = function () {
  const year    = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  document.getElementById('confirm-title').textContent = 'Delete Quarter';
  document.getElementById('confirm-msg').textContent   = `Delete all data for ${FUND_CODE} ${year} ${quarter}?`;
  document.getElementById('confirm-ok').onclick = async () => {
    try {
      await apiFetch(`/mf-portfolio/${FUND_CODE}/${year}/${quarter}`, 'DELETE');
      closeModal('confirm-modal');
      toast('Quarter deleted.', 'info');
      portfolio = null;
      hide('summary-row'); hide('charts-row'); hide('analysis-row'); hide('table-card');
      show('mf-empty');
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  };
  document.getElementById('confirm-modal').classList.remove('hidden');
};

/* ── FUND META ───────────────────────────────────────────────── */
window.openMetaModal = function () {
  const meta = (portfolio && portfolio.meta) || {};
  document.getElementById('m-date').value  = meta.date        || '';
  document.getElementById('m-nav').value   = meta.navPerUnit  || '';
  document.getElementById('m-units').value = meta.totalUnits  || '';
  document.getElementById('m-error').textContent = '';
  document.getElementById('meta-modal').classList.remove('hidden');
};

window.saveMeta = async function () {
  const year    = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  const body    = {
    date:       document.getElementById('m-date').value,
    navPerUnit: parseFloat(document.getElementById('m-nav').value)   || 0,
    totalUnits: parseFloat(document.getElementById('m-units').value) || 0,
  };
  try {
    await apiFetch(`/mf-portfolio/${FUND_CODE}/${year}/${quarter}/meta`, 'POST', body);
    closeModal('meta-modal');
    toast('Fund meta saved.', 'success');
    await loadPortfolio();
  } catch (e) { document.getElementById('m-error').textContent = e.message; }
};

/* ── HELPERS ─────────────────────────────────────────────────── */
async function apiFetch(path, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
  return r.json();
}

window.closeModal = function (id) {
  document.getElementById(id).classList.add('hidden');
  // Restore scroll only if no other modal is open
  if (!document.querySelector('.mf-backdrop:not(.hidden)')) {
    document.body.style.overflow = '';
  }
};

document.querySelectorAll('.mf-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) bd.classList.add('hidden'); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.mf-backdrop').forEach(m => m.classList.add('hidden'));
});

function show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function esc(s)   { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n, d = 2)  { return isNaN(n) ? '0.00' : parseFloat(n).toLocaleString('en-BD', { minimumFractionDigits: d, maximumFractionDigits: d }); }
function fmt2(n) { return parseFloat(n).toLocaleString('en-BD', { minimumFractionDigits: 1, maximumFractionDigits: 2 }); }
function fmtInt(n) { return isNaN(n) ? '0' : parseInt(n).toLocaleString('en-BD'); }

function toast(msg, type = 'info') {
  const wrap = document.getElementById('toast-wrap');
  const el   = document.createElement('div');
  el.className = 'mf-toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
/* ── COLUMN PICKER ───────────────────────────────────────────── */
const MF_COLS = [
  { key: 'sl',         label: '#'                          },
  { key: 'sector',     label: 'Sector'                     },
  { key: 'company',    label: 'Company'                    },
  { key: 'code',       label: 'Code'                       },
  { key: 'shares',     label: 'Shares'                     },
  { key: 'costValue',  label: 'Buying Value (M)'           },
  { key: 'avgBuy',     label: 'Avg Buy Price'              },
  { key: 'reportMkt',  label: 'Quarterly Value (M)'        },
  { key: 'ltp',        label: 'LTP'                        },
  { key: 'liveMkt',    label: 'Live Mkt Value (M)'         },
  { key: 'gap',        label: 'Gap (M)'                    },
  { key: 'gapPct',     label: 'Gap %'                      },
  { key: 'apprec',     label: 'Live Gain (M)'              },
  { key: 'pctChange',  label: '% Live Change'              },
  { key: 'pctTotal',   label: '% of Total'                 },
  { key: 'actions',    label: 'Actions'                    },
];

// Load visibility from localStorage, default all visible
let mfColVis = {};
(function initMfColVis() {
  try {
    const saved = localStorage.getItem('mf-col-vis');
    mfColVis = saved ? JSON.parse(saved) : {};
  } catch {}
  MF_COLS.forEach(c => { if (mfColVis[c.key] === undefined) mfColVis[c.key] = true; });
})();

function saveMfColVis() {
  try { localStorage.setItem('mf-col-vis', JSON.stringify(mfColVis)); } catch {}
}

function applyMfColVis() {
  const table = document.getElementById('holdings-table');
  if (!table) return;
  MF_COLS.forEach(c => {
    table.classList.toggle(`mf-hide-${c.key}`, !mfColVis[c.key]);
  });
}

function buildMfColPicker() {
  const body = document.getElementById('mf-col-picker-body');
  if (!body) return;
  body.innerHTML = MF_COLS.map(c => `
    <div class="mf-col-picker-item${mfColVis[c.key] ? '' : ' col-hidden'}" data-key="${c.key}">
      <input type="checkbox" id="mfcol-${c.key}" ${mfColVis[c.key] ? 'checked' : ''}
             onchange="onMfColToggle('${c.key}', this.checked)" />
      <label for="mfcol-${c.key}">${c.label}</label>
    </div>
  `).join('');
  applyMfColVis();
}

window.onMfColToggle = function(key, visible) {
  mfColVis[key] = visible;
  saveMfColVis();
  const item = document.querySelector(`.mf-col-picker-item[data-key="${key}"]`);
  if (item) item.classList.toggle('col-hidden', !visible);
  applyMfColVis();
};

window.resetMfColVis = function() {
  MF_COLS.forEach(c => { mfColVis[c.key] = true; });
  saveMfColVis();
  document.querySelectorAll('.mf-col-picker-item').forEach(item => {
    item.classList.remove('col-hidden');
    const cb = item.querySelector('input');
    if (cb) cb.checked = true;
  });
  applyMfColVis();
};

window.toggleMfColPicker = function(e) {
  e.stopPropagation();
  document.getElementById('mf-col-picker-dropdown').classList.toggle('open');
};

// Close picker on outside click
document.addEventListener('click', e => {
  const wrap = document.getElementById('mf-col-picker-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('mf-col-picker-dropdown')?.classList.remove('open');
  }
});

// Close picker on Escape (already handled for modals above, but be explicit)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('mf-col-picker-dropdown')?.classList.remove('open');
  }
});

// Build picker once DOM is ready (DOMContentLoaded may already have fired)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildMfColPicker);
} else {
  buildMfColPicker();
}

// Re-apply visibility after each renderTable call so new rows respect it
const _origRenderTable = window.renderTable;
window.renderTable = function() {
  _origRenderTable();
  applyMfColVis();
};

// Ensure new col keys are added to CSS hide logic (injected at runtime)
(function addMissingHideRules() {
  const style = document.createElement('style');
  style.textContent = `
    .mf-hide-reportMkt [data-col="reportMkt"] { display: none; }
    .mf-hide-liveMkt   [data-col="liveMkt"]   { display: none; }
  `;
  document.head.appendChild(style);
})();
/* ── ALL HOLDINGS MODAL ──────────────────────────────────────── */
let ahChart    = null;
let ahMetric   = 'pctTotal';   // active metric key

window.setAhMetric = function (btn) {
  document.querySelectorAll('.ah-metric-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  ahMetric = btn.dataset.metric;
  renderAllHoldingsModal();
};

window.openAllHoldingsModal = function () {
  if (!portfolio) return;
  document.getElementById('ah-search').value = '';
  document.getElementById('all-holdings-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setTimeout(() => { renderAllHoldingsModal(); document.getElementById('ah-search').focus(); }, 60);
};

window.handleAllHoldingsBackdrop = function (e) {
  if (e.target === document.getElementById('all-holdings-modal')) closeModal('all-holdings-modal');
};

window.renderAllHoldingsModal = function () {
  if (!portfolio) return;
  const q        = (document.getElementById('ah-search').value || '').toLowerCase();
  const all      = [...(portfolio.holdings || [])];
  const totalMkt  = all.reduce((s, x) => s + (x._liveMkt ?? x.marketValue ?? 0), 0);
  const totalCost = all.reduce((s, x) => s + (x.costValue || 0), 0);
  const totalPL   = totalMkt - totalCost;

  // Build sector → color map ordered by total market value (matches donut chart)
  const sectorOrder = [...new Set(
    [...all]
      .sort((a, b) => (b._liveMkt ?? b.marketValue ?? 0) - (a._liveMkt ?? a.marketValue ?? 0))
      .map(h => h.sector || 'OTHER')
  )];
  const sectorColor = {};
  sectorOrder.forEach((s, i) => { sectorColor[s] = COLORS[i % COLORS.length]; });

  // Metric value
  function metricVal(h) {
    const liveMkt   = h._liveMkt ?? h.marketValue ?? 0;
    const reportMkt = h.marketValue ?? 0;
    const cost      = h.costValue || 0;
    switch (ahMetric) {
      case 'pctTotal':  return totalMkt ? (liveMkt / totalMkt * 100) : 0;
      case 'liveMkt':   return h._liveMkt != null ? h._liveMkt : (h.marketValue ?? 0);
      case 'reportMkt': return reportMkt;
      case 'pctChange': return cost ? ((liveMkt - cost) / cost * 100) : 0;
      default: return 0;
    }
  }

  // Filter + sort
  const filtered = (q
    ? all.filter(h =>
        (h.stockCode || '').toLowerCase().includes(q) ||
        (h.company   || '').toLowerCase().includes(q) ||
        (h.sector    || '').toLowerCase().includes(q))
    : all
  ).sort((a, b) => metricVal(b) - metricVal(a));

  // ── Summary strip ──────────────────────────────────────────────
  const sCount = document.getElementById('ah-s-count');
  const sCost  = document.getElementById('ah-s-cost');
  const sMkt   = document.getElementById('ah-s-mkt');
  const sPL    = document.getElementById('ah-s-pl');
  if (sCount) sCount.textContent = `${filtered.length} / ${all.length}`;
  if (sCost)  sCost.textContent  = '৳' + fmt(totalCost) + ' M';
  if (sMkt)   sMkt.textContent   = '৳' + fmt(totalMkt)  + ' M';
  if (sPL) {
    sPL.textContent = (totalPL >= 0 ? '+' : '') + '৳' + fmt(totalPL) + ' M';
    sPL.style.color = totalPL >= 0 ? 'var(--gain)' : 'var(--loss)';
  }

  // ── Count badge ────────────────────────────────────────────────
  document.getElementById('ah-count').textContent =
    `${filtered.length} of ${all.length} holdings`;

  // ── Sector legend ──────────────────────────────────────────────
  const legend = document.getElementById('ah-legend');
  if (legend) {
    const shownSectors = [...new Set(filtered.map(h => h.sector || 'OTHER'))];
    legend.innerHTML = shownSectors.map(s =>
      `<span class="ah-legend-item">
         <span class="ah-legend-dot" style="background:${sectorColor[s]}"></span>
         ${esc(s)}
       </span>`
    ).join('');
  }

  // ── Bar colors: by sector, or gain/loss for pctChange ─────────
  const barColors    = filtered.map(h => {
    if (ahMetric === 'pctChange') {
      return metricVal(h) >= 0 ? 'rgba(34,212,122,.72)' : 'rgba(255,64,96,.72)';
    }
    return (sectorColor[h.sector || 'OTHER']) + 'bb';
  });
  const borderColors = filtered.map(h => {
    if (ahMetric === 'pctChange') {
      return metricVal(h) >= 0 ? '#22d47a' : '#ff4060';
    }
    return sectorColor[h.sector || 'OTHER'];
  });

  // ── Dynamic chart height ───────────────────────────────────────
  const chartH = Math.max(320, filtered.length * 28 + 60);
  document.getElementById('ah-chart-wrap').style.height = chartH + 'px';

  const labels  = filtered.map(h => h.stockCode);
  const values  = filtered.map(h => parseFloat(metricVal(h).toFixed(3)));

  const metricLabels = {
    pctTotal:  '% of Total',
    liveMkt:   'Live Mkt (M)',
    reportMkt: 'Quarterly Value (M)',
    pctChange: '% Live Change',
  };
  const unitSuffix = (ahMetric === 'pctTotal' || ahMetric === 'pctChange') ? '%' : ' M';

  // Theme-aware chart colours
  const cs       = getComputedStyle(document.documentElement);
  const textColor = cs.getPropertyValue('--text-muted').trim()    || '#8a8d91';
  const yColor    = cs.getPropertyValue('--accent').trim()         || '#1877f2';
  const gridColor = cs.getPropertyValue('--border').trim()         || '#dadde1';
  const ttBg      = cs.getPropertyValue('--bg-card').trim()        || '#ffffff';
  const ttBorder  = cs.getPropertyValue('--border').trim()         || '#dadde1';
  const ttTitle   = cs.getPropertyValue('--text-primary').trim()   || '#050505';
  const ttBody    = cs.getPropertyValue('--text-secondary').trim() || '#65676b';
  const safeFont  = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  if (ahChart) { ahChart.destroy(); ahChart = null; }

  // ── Custom plugin: inline Avg Buy + LTP labels beside each bar ──
  const barLabelPlugin = {
    id: 'ahBarLabels',
    afterDatasetsDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      ctx.save();
      ctx.textBaseline = 'middle';

      chart.data.datasets[0].data.forEach((val, i) => {
        const h      = filtered[i];
        if (!h) return;
        const avgBuy = (h.shares && h.costValue)
          ? ((h.costValue * 1_000_000) / h.shares) : null;
        const ltp    = h._ltp || null;
        if (avgBuy == null && ltp == null) return;

        const yPos   = y.getPixelForValue(i);
        const xStart = x.getPixelForValue(val < 0 ? 0 : val) + 7;

        let xCursor = xStart;

        if (avgBuy != null) {
          // "Avg" label
          ctx.font = `500 10px ${safeFont}`;
          ctx.fillStyle = textColor;
          ctx.fillText('Avg ', xCursor, yPos);
          xCursor += ctx.measureText('Avg ').width;
          // value
          ctx.font = `700 10px ${safeFont}`;
          ctx.fillStyle = ttBody;
          const avgStr = '৳' + fmt2(avgBuy);
          ctx.fillText(avgStr, xCursor, yPos);
          xCursor += ctx.measureText(avgStr).width + 10;
        }

        if (ltp != null) {
          // separator dot
          if (avgBuy != null) {
            ctx.font = `400 10px ${safeFont}`;
            ctx.fillStyle = textColor;
            ctx.fillText('· ', xCursor, yPos);
            xCursor += ctx.measureText('· ').width;
          }
          // "LTP" label
          ctx.font = `500 10px ${safeFont}`;
          ctx.fillStyle = textColor;
          ctx.fillText('LTP ', xCursor, yPos);
          xCursor += ctx.measureText('LTP ').width;
          // value: red if LTP < avg buy, accent if above
          ctx.font = `700 10px ${safeFont}`;
          ctx.fillStyle = (avgBuy != null && ltp < avgBuy)
            ? cs.getPropertyValue('--loss').trim() || '#fa383e'
            : yColor;
          ctx.fillText('৳' + fmt2(ltp), xCursor, yPos);
        }
      });

      ctx.restore();
    }
  };

  ahChart = new Chart(document.getElementById('ah-chart'), {
    type: 'bar',
    plugins: [barLabelPlugin],
    data: {
      labels,
      datasets: [{
        label: metricLabels[ahMetric],
        data: values,
        backgroundColor: barColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 220 },
      layout: { padding: { right: 240 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ttBg,
          borderColor: ttBorder,
          borderWidth: 1,
          titleColor: ttTitle,
          bodyColor: ttBody,
          titleFont: { family: safeFont, size: 13, weight: '700' },
          bodyFont:  { family: safeFont, size: 12 },
          padding: 14,
          callbacks: {
            title: ctx => {
              const h    = filtered[ctx[0].dataIndex];
              const rank = ctx[0].dataIndex + 1;
              return `#${rank}  ${h.stockCode}${h.company ? '  ·  ' + h.company : ''}`;
            },
            label: ctx => {
              const h       = filtered[ctx.dataIndex];
              const v       = ctx.raw;
              const avgBuy  = (h.shares && h.costValue)
                ? ((h.costValue * 1_000_000) / h.shares) : null;
              const ltp     = h._ltp || null;
              const liveMkt = h._liveMkt ?? h.marketValue ?? 0;
              const cost    = h.costValue || 0;
              const pctChg  = cost ? ((liveMkt - cost) / cost * 100) : null;

              const lines = [
                `  ${metricLabels[ahMetric]}: ${v.toFixed(2)}${unitSuffix}`,
                `  Sector: ${h.sector || '—'}`,
                `  Shares: ${fmtInt(h.shares || 0)}`,
                avgBuy != null ? `  Avg Buy:  ৳${fmt2(avgBuy)}`   : `  Avg Buy:  —`,
                ltp    != null ? `  LTP:      ৳${fmt2(ltp)}`       : `  LTP:      —`,
              ];
              if (ahMetric !== 'reportMkt')
                lines.push(`  Quarterly Value: ৳${fmt(h.marketValue ?? 0)} M`);
              if (ahMetric !== 'liveMkt' && h._liveMkt != null)
                lines.push(`  Live Mkt: ৳${fmt(h._liveMkt)} M`);
              if (ahMetric !== 'pctChange' && pctChg !== null)
                lines.push(`  % Live Change: ${pctChg >= 0 ? '+' : ''}${pctChg.toFixed(2)}%`);
              return lines;
            },
          }
        }
      },
      scales: {
        x: {
          grid: { color: gridColor + '55' },
          ticks: { color: textColor, font: { family: safeFont, size: 11 }, callback: v => v + unitSuffix },
          border: { color: gridColor + '55' },
        },
        y: {
          grid: { display: false },
          ticks: { color: yColor, font: { family: safeFont, size: 11, weight: '700' } },
          border: { display: false },
        }
      }
    }
  });
};
/* ── COMPARE QUARTERS NAV ────────────────────────────────────── */
window.goToCompare = function () {
  const year    = document.getElementById('sel-year').value;
  const quarter = document.getElementById('sel-quarter').value;
  window.location.href =
    `/mutual_fund_portfolio/mf-compare.html?code=${encodeURIComponent(FUND_CODE)}&name=${encodeURIComponent(FUND_NAME)}&qA=${year}-${quarter}`;
};

/* ── COMBINED HISTORY CHART ─────────────────────────────────── */

let historyView  = 'ratio';      // 'portfolio' | 'fund' | 'ratio' | 'compare'
let historyRange = 'all';        // 'all' | '365' | 'ytd' | '180' | '90' | '30' | '7'

/** Switch between Portfolio Value / Fund Price / Ratio / Compare views. */
window.setHistoryView = function (btn) {
  document.querySelectorAll('.mf-history-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  historyView = btn.dataset.view;
  renderHistoryChart();
};

/** Change the shared time-range filter and re-render. */
window.setHistoryRange = function (btn) {
  document.querySelectorAll('[data-hrange]').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  historyRange = btn.dataset.hrange;
  renderHistoryChart();
};

/** Trim a date-sorted point list (each needs a `.date` "YYYY-MM-DD" field) to the active historyRange. */
function applyHistoryRangeFilter(points) {
  if (historyRange === 'all') return points;
  let cutoffStr;
  if (historyRange === 'ytd') {
    cutoffStr = new Date().getFullYear() + '-01-01';
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(historyRange, 10));
    cutoffStr = cutoff.toISOString().slice(0, 10);
  }
  return points.filter(p => p.date >= cutoffStr);
}

/* ── QUARTERLY-SNAPSHOT HELPERS ──────────────────────────────────
   A fund's holdings change every quarter, but its price history runs
   back years further than any single quarter's disclosure — so the
   history chart can't just apply "today's" (or whichever quarter is
   open in the picker) shares across the whole timeline. Instead it
   loads every quarter this fund has data for and, for each date,
   uses whichever quarter's holdings were actually in force then. */

/** Best-effort as-of date for a quarter when no explicit meta.date was recorded — the calendar quarter-end. */
function quarterEndDate(year, quarter) {
  const endMonth = { Q1: '03-31', Q2: '06-30', Q3: '09-30', Q4: '12-31' }[quarter] || '12-31';
  return `${year}-${endMonth}`;
}

/**
 * Fetch every quarter this fund has portfolio data for, sorted oldest→newest,
 * each stamped with the date its holdings became effective (the reported
 * as-of date if set, else the calendar quarter-end). Quarters with no
 * holdings recorded are dropped.
 */
async function loadAllQuarterSnapshots() {
  const qRes  = await fetch(`${API}/mf-portfolio/${FUND_CODE}/quarters`);
  const qData = await qRes.json();
  const quarters = qData.quarters || [];
  if (!quarters.length) return [];

  const fetched = await Promise.allSettled(
    quarters.map(q => fetch(`${API}/mf-portfolio/${FUND_CODE}/${q.year}/${q.quarter}`).then(r => r.json()))
  );

  return fetched
    .map((result, i) => {
      if (result.status !== 'fulfilled') return null;
      const data = result.value;
      if (!data || !Array.isArray(data.holdings) || !data.holdings.length) return null;
      const q = quarters[i];
      const effectiveDate = (data.meta && data.meta.date) || quarterEndDate(q.year, q.quarter);
      return { year: q.year, quarter: q.quarter, effectiveDate, holdings: data.holdings };
    })
    .filter(Boolean)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

/** The most recently-effective snapshot on or before `date`, or null if `date` predates every known snapshot. */
function snapshotForDate(snapshots, date) {
  let match = null;
  for (const snap of snapshots) {
    if (snap.effectiveDate <= date) match = snap; else break;
  }
  return match;
}

/* ── DATA LOADERS ────────────────────────────────────────────── */

/**
 * Rebuild the fund's whole portfolio-value history from EVERY quarter it
 * has holdings data for, not just whichever quarter is open in the picker
 * above — each date is priced using the shares that were actually in the
 * portfolio as of that date. Caches the result on portfolio._historyPoints.
 */
async function loadAndRenderHistory() {
  if (!portfolio) return;
  portfolio._historyPoints = null;
  portfolio._snapshots = null;

  setHistoryStatus('Loading price history…');

  try {
    const snapshots = await loadAllQuarterSnapshots();
    if (!snapshots.length) { setHistoryStatus('No quarterly holdings data found.'); return; }

    // Union of every stock this fund has EVER reported holding, across all
    // quarters — a late date needs prices for stocks bought since an early
    // snapshot, and an early date needs prices for stocks since sold, so no
    // single quarter's holding list covers the whole timeline on its own.
    const codeSet = new Set();
    snapshots.forEach(s => s.holdings.forEach(h => h.stockCode && codeSet.add(h.stockCode)));
    const codes = [...codeSet];

    const fetched = await Promise.allSettled(
      codes.map(code =>
        fetch('/historical_prices/json_files/' + encodeURIComponent(code) + '.json')
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );

    // Per-stock daily close, kept alongside the aggregate sum so the ratio
    // chart's hover tooltip can work out — for the hovered date vs the
    // previous plotted date — which holdings actually drove the portfolio
    // value up or down that day (real closes × real share counts, not a
    // guess from the aggregate move alone).
    const perStockCloseByDate = {};
    fetched.forEach((result, idx) => {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value)) return;
      const code = codes[idx];
      const closeByDate = (perStockCloseByDate[code] = {});
      result.value.forEach(row => {
        const date  = (row.Date || row.date || '').replace(/\//g, '-');
        if (!date || date.length !== 10) return;
        const close = parseFloat(
          row.Close != null ? row.Close :
          row.close != null ? row.close :
          row.YCP   != null ? row.YCP   :
          row.ycp   != null ? row.ycp   : 0
        );
        if (close) closeByDate[date] = close;
      });
    });

    const allDates = new Set();
    Object.values(perStockCloseByDate).forEach(closeByDate => {
      Object.keys(closeByDate).forEach(d => allDates.add(d));
    });

    const points = [...allDates]
      .sort()
      .map(date => {
        // No snapshot on or before this date yet → holdings at this point
        // in time are unknown, so the date is dropped rather than priced
        // with a quarter's shares that didn't apply yet.
        const snap = snapshotForDate(snapshots, date);
        if (!snap) return null;
        let sum = 0, count = 0;
        snap.holdings.forEach(h => {
          const close = perStockCloseByDate[h.stockCode] && perStockCloseByDate[h.stockCode][date];
          if (close == null || !h.shares) return;
          sum += (close * h.shares) / 1000000;
          count += 1;
        });
        if (!count) return null;
        return {
          date, value: parseFloat(sum.toFixed(4)),
          coverage: count, total: snap.holdings.length,
          quarter: snap.year + ' ' + snap.quarter,
        };
      })
      .filter(Boolean);

    if (!points.length) { setHistoryStatus('No historical price data found.'); return; }

    portfolio._historyPoints = points;
    portfolio._perStockCloseByDate = perStockCloseByDate;
    portfolio._snapshots = snapshots;
    const first = snapshots[0], last = snapshots[snapshots.length - 1];
    setHistoryStatus(
      points.length + ' days · ' + snapshots.length + ' quarter' + (snapshots.length > 1 ? 's' : '') +
      ' tracked (' + first.year + ' ' + first.quarter + ' → ' + last.year + ' ' + last.quarter + ')'
    );
    renderHistoryChart();
  } catch (err) {
    setHistoryStatus('Failed to load portfolio history.');
    console.error('[history]', err);
  }
}

/**
 * Fetch the MF fund's own historical JSON, cache on window._fundPricePoints.
 */
async function loadAndRenderFundPrice() {
  if (!FUND_CODE) return;

  // Update the fund tab label
  const tabBtn = document.getElementById('fund-tab-btn');
  if (tabBtn) tabBtn.textContent = FUND_CODE + ' Price';

  try {
    const res = await fetch('/historical_prices/json_files/' + encodeURIComponent(FUND_CODE) + '.json');
    if (!res.ok) { console.warn('[fund price] file not found for', FUND_CODE); return; }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return;

    const points = rows
      .map(row => {
        const date  = (row.Date || row.date || '').replace(/\//g, '-');
        const close = parseFloat(
          row.Close != null ? row.Close :
          row.close != null ? row.close :
          row.YCP   != null ? row.YCP   :
          row.ycp   != null ? row.ycp   : 0
        );
        return (date.length === 10 && close) ? { date, close } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));

    window._fundPricePoints = points;
    // Re-render if the user is already on fund or ratio view
    if (historyView === 'fund' || historyView === 'ratio' || historyView === 'compare') renderHistoryChart();
  } catch (err) {
    console.error('[fund price]', err);
  }
}

/**
 * For a given plotted date vs the previous plotted date, work out which
 * holdings pulled the portfolio's value up and which dragged it down —
 * real close-to-close price change × real share count for each holding,
 * so it reflects position size, not just which stock moved the most in %.
 * Returns null if either date is missing per-stock price coverage.
 */
function computeTopMovers(date, prevDate) {
  const byDate = portfolio && portfolio._perStockCloseByDate;
  const snapshots = portfolio && portfolio._snapshots;
  if (!byDate || !snapshots || !prevDate) return null;

  const snap = snapshotForDate(snapshots, date);
  if (!snap) return null;

  const moves = snap.holdings.map(h => {
    const closes = byDate[h.stockCode];
    if (!closes) return null;
    const today = closes[date];
    const prev  = closes[prevDate];
    if (today == null || prev == null || !h.shares) return null;
    const priceDiff = today - prev;
    const valueDiff = (priceDiff * h.shares) / 1000000; // M BDT — same unit as portfolio value
    const pctDiff = prev ? (priceDiff / prev * 100) : null;
    return { stockCode: h.stockCode, valueDiff, pctDiff };
  }).filter(Boolean);

  if (!moves.length) return null;

  const gainers  = moves.filter(m => m.valueDiff > 0).sort((a, b) => b.valueDiff - a.valueDiff).slice(0, 3);
  const laggards = moves.filter(m => m.valueDiff < 0).sort((a, b) => a.valueDiff - b.valueDiff).slice(0, 3);
  return { gainers, laggards };
}

/**
 * Custom HTML tooltip for the combined history chart (Chart.js `external`
 * callback) — replaces the default plain-text tooltip with real visual
 * hierarchy: a big date-stamped headline value, a colored delta pill, and
 * wrapped mover chips instead of one long comma-separated line.
 */
function renderHistoryTooltip(context, data) {
  const el = document.getElementById('mf-history-tooltip');
  if (!el) return;
  const { chart, tooltip } = context;
  const { points, values, label, yFmt, historyView, FUND_CODE, portfolio } = data;

  if (!tooltip || tooltip.opacity === 0) { el.style.opacity = 0; return; }

  const dp = tooltip.dataPoints && tooltip.dataPoints[0];
  const idx = dp && dp.dataIndex;
  const pt  = idx != null ? points[idx] : null;
  if (!pt) { el.style.opacity = 0; return; }

  const v    = values[idx];
  const prev = idx > 0 ? values[idx - 1] : null;
  const diff = prev != null ? (v - prev) : null;
  const pct  = (prev && prev !== 0) ? ((v - prev) / prev * 100) : null;
  const up   = diff != null ? diff >= 0 : null;

  let dateStr = pt.date;
  try {
    dateStr = new Date(pt.date + 'T00:00:00')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {}

  let html = '<div class="mf-htt-date">' + esc(dateStr) + '</div>';
  html += '<div class="mf-htt-main">';
  html +=   '<div class="mf-htt-label">' + esc(label) + '</div>';
  html +=   '<div class="mf-htt-value">' + yFmt(v) + '</div>';
  if (diff != null) {
    const sign = up ? '+' : '';
    html += '<div class="mf-htt-delta ' + (up ? 'up' : 'down') + '">' +
      (up ? '▲' : '▼') + ' ' + sign + yFmt(diff) +
      ' (' + sign + (pct != null ? pct.toFixed(2) : '—') + '%)</div>';
  }
  html += '</div>';

  if (historyView === 'ratio' && pt.portVal != null) {
    html += '<div class="mf-htt-divider"></div>';
    html += '<div class="mf-htt-row"><span class="mf-htt-row-lbl">Portfolio</span><span class="mf-htt-row-val">৳' + fmt(pt.portVal) + ' M</span></div>';
    html += '<div class="mf-htt-row"><span class="mf-htt-row-lbl">' + esc(FUND_CODE) + ' close</span><span class="mf-htt-row-val">৳' + fmt2(pt.fundClose) + '</span></div>';

    const prevDate = idx > 0 ? points[idx - 1].date : null;
    const movers = computeTopMovers(pt.date, prevDate);
    if (movers && (movers.gainers.length || movers.laggards.length)) {
      if (movers.gainers.length) {
        html += '<div class="mf-htt-sec"><div class="mf-htt-sec-title up">▲ Pulled up</div><div class="mf-htt-chips">' +
          movers.gainers.map(m =>
            '<span class="mf-htt-chip up">' + esc(m.stockCode) + ' +৳' + fmt(Math.abs(m.valueDiff)) + 'M</span>'
          ).join('') + '</div></div>';
      }
      if (movers.laggards.length) {
        html += '<div class="mf-htt-sec"><div class="mf-htt-sec-title down">▼ Dragged down</div><div class="mf-htt-chips">' +
          movers.laggards.map(m =>
            '<span class="mf-htt-chip down">' + esc(m.stockCode) + ' -৳' + fmt(Math.abs(m.valueDiff)) + 'M</span>'
          ).join('') + '</div></div>';
      }
    }
  }

  if ((historyView === 'portfolio' || historyView === 'ratio') && pt.quarter) {
    html += '<div class="mf-htt-coverage">Holdings as of ' + esc(pt.quarter) +
      (pt.coverage != null && pt.total != null && pt.coverage < pt.total
        ? ' · priced ' + pt.coverage + '/' + pt.total : '') +
      '</div>';
  }

  el.innerHTML = html;
  el.style.opacity = 1;

  // Fixed-position relative to the viewport (not the 300px canvas box) so a
  // tall tooltip — full mover chips on both sides — can extend past the
  // chart's own bounds instead of getting clamped into negative space.
  const canvasRect = chart.canvas.getBoundingClientRect();
  const ttW = el.offsetWidth;
  const ttH = el.offsetHeight;

  let x = canvasRect.left + tooltip.caretX + 16;
  let y = canvasRect.top + tooltip.caretY - ttH / 2;
  if (x + ttW > window.innerWidth - 8) x = canvasRect.left + tooltip.caretX - ttW - 16;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  if (y + ttH > window.innerHeight - 8) y = window.innerHeight - ttH - 8;

  el.style.left = x + 'px';
  el.style.top  = y + 'px';
}

/* ── UNIFIED RENDERER ────────────────────────────────────────── */

let chartHistory = null;

function setHistoryStatus(msg) {
  const el = document.getElementById('history-status');
  if (el) el.textContent = msg;
}

/**
 * Single render function for all four views.
 * Reads historyView + historyRange, merges the two cached datasets
 * as needed, then draws one Chart.js line chart on #chart-history.
 */
function renderHistoryChart() {
  const noteEl = document.getElementById('history-ratio-note');
  if (noteEl) {
    noteEl.style.display = historyView === 'ratio' ? 'block' : 'none';
    noteEl.textContent = "Tracks the fund's own market price against the value of its disclosed " +
      'holdings — rising means the price is pulling ahead of the portfolio (possible premium), ' +
      'falling means the portfolio is outpacing the price. See "Compare" for both series indexed side by side.';
  }

  if (historyView === 'compare') { renderCompareChart(); return; }

  const portfolioPoints = portfolio && portfolio._historyPoints;
  const fundPoints      = window._fundPricePoints;

  // Build the dataset for the current view
  let points = [];   // { date, value, extra? }
  let label  = '';
  let color  = '';
  let yFmt   = v => v;
  let yLabel = '';

  const cs        = getComputedStyle(document.documentElement);
  const teal      = cs.getPropertyValue('--accent').trim()          || '#00f5c4';
  const indigo    = '#6366f1';
  const amber     = '#f59e0b';
  const textMuted = cs.getPropertyValue('--text-muted').trim()      || '#8a8d91';
  const border    = cs.getPropertyValue('--border').trim()          || '#dadde1';
  const bgCard    = cs.getPropertyValue('--bg-card').trim()         || '#fff';
  const textSec   = cs.getPropertyValue('--text-secondary').trim()  || '#65676b';
  const textPri   = cs.getPropertyValue('--text-primary').trim()    || '#050505';
  const gain      = cs.getPropertyValue('--gain').trim()            || '#31a24c';
  const loss      = cs.getPropertyValue('--loss').trim()            || '#fa383e';
  const safeFont  = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  if (historyView === 'portfolio') {
    if (!portfolioPoints) return;
    points = portfolioPoints.map(p => ({ date: p.date, value: p.value, coverage: p.coverage, total: p.total, quarter: p.quarter }));
    label  = 'Portfolio Value (M BDT)';
    color  = teal;
    yFmt   = v => '\u09F3' + fmt(v) + ' M';
    yLabel = 'M BDT';

  } else if (historyView === 'fund') {
    if (!fundPoints) return;
    points = fundPoints.map(p => ({ date: p.date, value: p.close }));
    label  = FUND_CODE + ' Close (\u09F3)';
    color  = indigo;
    yFmt   = v => '\u09F3' + fmt2(v);
    yLabel = '\u09F3';

  } else {
    // ratio view — inner join on date
    if (!portfolioPoints || !fundPoints) return;
    const fundMap = {};
    fundPoints.forEach(p => { fundMap[p.date] = p.close; });
    points = portfolioPoints
      .filter(p => fundMap[p.date] && fundMap[p.date] > 0)
      .map(p => ({
        date:     p.date,
        value:    parseFloat((fundMap[p.date] / p.value).toFixed(6)),
        portVal:  p.value,
        fundClose: fundMap[p.date],
        coverage: p.coverage,
        total:    p.total,
        quarter:  p.quarter,
      }));
    label  = 'Fund Price (\u09F3) \u00f7 Portfolio Value (M)';
    color  = amber;
    yFmt   = v => fmt(v, 4);
    yLabel = '\u09F3/M';
  }

  points = applyHistoryRangeFilter(points);

  if (!points.length) return;

  // Update subtitle + range label
  const subtitleEl = document.getElementById('history-subtitle');
  const rangeEl    = document.getElementById('history-range-label');
  if (subtitleEl) subtitleEl.textContent = label;
  if (rangeEl) rangeEl.textContent =
    points.length > 1 ? '(' + points[0].date + ' \u2192 ' + points[points.length - 1].date + ')' : '';

  // Stat strip
  const statsEl = document.getElementById('history-stats');
  if (statsEl && points.length >= 2) {
    const first  = points[0].value;
    const last   = points[points.length - 1].value;
    const peak   = Math.max(...points.map(p => p.value));
    const trough = Math.min(...points.map(p => p.value));
    const change    = last - first;
    const changePct = first ? (change / first * 100) : 0;
    const clr = change >= 0 ? 'var(--gain)' : 'var(--loss)';

    const extraStats = historyView === 'ratio' ? [
      { lbl: 'Latest Portfolio', val: '\u09F3' + fmt(points[points.length - 1].portVal) + ' M', color: teal },
      { lbl: 'Latest ' + FUND_CODE,  val: '\u09F3' + fmt2(points[points.length - 1].fundClose),  color: indigo },
    ] : [];

    const baseStats = [
      { lbl: 'Start',   val: yFmt(first),  color: 'var(--text-primary)' },
      { lbl: 'Latest',  val: yFmt(last),   color: clr },
      { lbl: 'Change',  val: (change >= 0 ? '+' : '') + yFmt(change) +
             ' (' + (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%)', color: clr },
      { lbl: 'High',    val: yFmt(peak),   color: 'var(--gain)' },
      { lbl: 'Low',     val: yFmt(trough), color: 'var(--loss)' },
      ...extraStats,
    ];

    statsEl.innerHTML = baseStats.map((s, i, arr) =>
      '<div style="flex:1;min-width:110px;padding:10px 14px;' +
        (i < arr.length - 1 ? 'border-right:1px solid var(--border)' : '') + '">' +
        '<div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;' +
          'letter-spacing:.3px;margin-bottom:4px">' + s.lbl + '</div>' +
        '<div style="font-size:13px;font-weight:700;color:' + s.color + ';letter-spacing:-.2px">' + s.val + '</div>' +
      '</div>'
    ).join('');
  }

  // Gradient fill
  const canvasEl = document.getElementById('chart-history');
  const ctx2d    = canvasEl.getContext('2d');
  const gradient = ctx2d.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0,   color + '44');
  gradient.addColorStop(0.7, color + '0a');
  gradient.addColorStop(1,   color + '00');

  const labels = points.map(p => p.date);
  const values = points.map(p => p.value);

  if (chartHistory) { chartHistory.destroy(); chartHistory = null; }

  chartHistory = new Chart(canvasEl, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        borderColor:          color,
        borderWidth:          2,
        pointRadius:          points.length > 60 ? 0 : 3,
        pointHoverRadius:     5,
        pointBackgroundColor: color,
        pointBorderColor:     bgCard,
        pointBorderWidth:     2,
        fill:                 true,
        backgroundColor:      gradient,
        tension:              0.3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: (context) => renderHistoryTooltip(context, {
            points, values, label, yFmt, historyView, FUND_CODE, portfolio,
          }),
        }
      },
      scales: {
        x: {
          grid:   { display: false },
          border: { display: false },
          ticks:  {
            color:         textMuted,
            font:          { family: safeFont, size: 10 },
            maxRotation:   0,
            autoSkip:      true,
            maxTicksLimit: 10,
            callback(val) {
              try {
                return new Date(this.getLabelForValue(val) + 'T00:00:00')
                  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              } catch { return val; }
            }
          }
        },
        y: {
          grid:   { color: border + '66' },
          border: { display: false },
          ticks:  {
            color:    textMuted,
            font:     { family: safeFont, size: 10 },
            callback: v => yFmt(v),
          }
        }
      }
    }
  });
}

/**
 * "Compare" view — Portfolio Value and the fund's own price plotted as one
 * line each on a shared axis, both indexed to 100 at the start of the
 * visible range. Answers the same question the Ratio view does — is the
 * fund's price pulling ahead of or lagging its portfolio? — without
 * requiring the reader to interpret the ratio's arbitrary ৳/M units.
 */
function renderCompareChart() {
  const portfolioPoints = portfolio && portfolio._historyPoints;
  const fundPoints      = window._fundPricePoints;
  if (!portfolioPoints || !fundPoints) return;

  const fundMap = {};
  fundPoints.forEach(p => { fundMap[p.date] = p.close; });
  let points = portfolioPoints
    .filter(p => fundMap[p.date] && fundMap[p.date] > 0)
    .map(p => ({ date: p.date, portVal: p.value, fundClose: fundMap[p.date], coverage: p.coverage, total: p.total, quarter: p.quarter }));

  points = applyHistoryRangeFilter(points);

  const subtitleEl = document.getElementById('history-subtitle');
  const rangeEl    = document.getElementById('history-range-label');
  const statsEl    = document.getElementById('history-stats');

  if (points.length < 2) {
    if (subtitleEl) subtitleEl.textContent = 'Portfolio Value vs ' + FUND_CODE + ' Price — indexed (start = 100)';
    if (rangeEl) rangeEl.textContent = '';
    if (statsEl) statsEl.innerHTML = '';
    if (chartHistory) { chartHistory.destroy(); chartHistory = null; }
    return;
  }

  const cs        = getComputedStyle(document.documentElement);
  const teal      = cs.getPropertyValue('--accent').trim()          || '#00f5c4';
  const indigo    = '#6366f1';
  const textMuted = cs.getPropertyValue('--text-muted').trim()      || '#8a8d91';
  const border    = cs.getPropertyValue('--border').trim()          || '#dadde1';
  const bgCard    = cs.getPropertyValue('--bg-card').trim()         || '#fff';
  const textSec   = cs.getPropertyValue('--text-secondary').trim()  || '#65676b';
  const safeFont  = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  const basePort = points[0].portVal;
  const baseFund = points[0].fundClose;
  const idxPort  = points.map(p => (p.portVal   / basePort) * 100);
  const idxFund  = points.map(p => (p.fundClose / baseFund) * 100);

  if (subtitleEl) subtitleEl.textContent = 'Portfolio Value vs ' + FUND_CODE + ' Price — indexed (start = 100)';
  if (rangeEl) rangeEl.textContent = '(' + points[0].date + ' → ' + points[points.length - 1].date + ')';

  const portChangePct = idxPort[idxPort.length - 1] - 100;
  const fundChangePct = idxFund[idxFund.length - 1] - 100;
  const divergence    = fundChangePct - portChangePct;
  const divClr = divergence >= 0 ? 'var(--gain)' : 'var(--loss)';

  if (statsEl) {
    const baseStats = [
      { lbl: 'Start (indexed)', val: '100.00', color: 'var(--text-primary)' },
      { lbl: 'Portfolio Value', val: idxPort[idxPort.length - 1].toFixed(2) + ' (' + (portChangePct >= 0 ? '+' : '') + portChangePct.toFixed(2) + '%)', color: teal },
      { lbl: FUND_CODE + ' Price', val: idxFund[idxFund.length - 1].toFixed(2) + ' (' + (fundChangePct >= 0 ? '+' : '') + fundChangePct.toFixed(2) + '%)', color: indigo },
      { lbl: 'Divergence', val: (divergence >= 0 ? '+' : '') + divergence.toFixed(2) + ' pp', color: divClr },
    ];
    statsEl.innerHTML = baseStats.map((s, i, arr) =>
      '<div style="flex:1;min-width:130px;padding:10px 14px;' +
        (i < arr.length - 1 ? 'border-right:1px solid var(--border)' : '') + '">' +
        '<div style="font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;' +
          'letter-spacing:.3px;margin-bottom:4px">' + s.lbl + '</div>' +
        '<div style="font-size:13px;font-weight:700;color:' + s.color + ';letter-spacing:-.2px">' + s.val + '</div>' +
      '</div>'
    ).join('');
  }

  const labels  = points.map(p => p.date);
  const canvasEl = document.getElementById('chart-history');

  if (chartHistory) { chartHistory.destroy(); chartHistory = null; }

  chartHistory = new Chart(canvasEl, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Portfolio Value', data: idxPort,
          borderColor: teal, borderWidth: 2,
          pointRadius: points.length > 60 ? 0 : 3, pointHoverRadius: 5,
          pointBackgroundColor: teal, pointBorderColor: bgCard, pointBorderWidth: 2,
          fill: false, tension: 0.3,
        },
        {
          label: FUND_CODE + ' Price', data: idxFund,
          borderColor: indigo, borderWidth: 2,
          pointRadius: points.length > 60 ? 0 : 3, pointHoverRadius: 5,
          pointBackgroundColor: indigo, pointBorderColor: bgCard, pointBorderWidth: 2,
          fill: false, tension: 0.3,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top', align: 'end',
          labels: { color: textSec, font: { family: safeFont, size: 11 }, boxWidth: 10, boxHeight: 10 },
        },
        tooltip: {
          enabled: false,
          external: (context) => renderCompareTooltip(context, { points, idxPort, idxFund, FUND_CODE }),
        }
      },
      scales: {
        x: {
          grid:   { display: false },
          border: { display: false },
          ticks:  {
            color:         textMuted,
            font:          { family: safeFont, size: 10 },
            maxRotation:   0,
            autoSkip:      true,
            maxTicksLimit: 10,
            callback(val) {
              try {
                return new Date(this.getLabelForValue(val) + 'T00:00:00')
                  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
              } catch { return val; }
            }
          }
        },
        y: {
          grid:   { color: border + '66' },
          border: { display: false },
          ticks:  {
            color:    textMuted,
            font:     { family: safeFont, size: 10 },
            callback: v => v.toFixed(0),
          }
        }
      }
    }
  });
}

/** Custom HTML tooltip for the "Compare" (indexed dual-line) view. */
function renderCompareTooltip(context, data) {
  const el = document.getElementById('mf-history-tooltip');
  if (!el) return;
  const { chart, tooltip } = context;
  const { points, idxPort, idxFund, FUND_CODE } = data;

  if (!tooltip || tooltip.opacity === 0) { el.style.opacity = 0; return; }

  const dp  = tooltip.dataPoints && tooltip.dataPoints[0];
  const idx = dp && dp.dataIndex;
  const pt  = idx != null ? points[idx] : null;
  if (!pt) { el.style.opacity = 0; return; }

  let dateStr = pt.date;
  try {
    dateStr = new Date(pt.date + 'T00:00:00')
      .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {}

  const portPct = idxPort[idx] - 100;
  const fundPct = idxFund[idx] - 100;

  let html = '<div class="mf-htt-date">' + esc(dateStr) + '</div>';
  html += '<div class="mf-htt-row"><span class="mf-htt-row-lbl"><span style="color:var(--accent)">●</span> Portfolio Value</span>' +
    '<span class="mf-htt-row-val">' + idxPort[idx].toFixed(2) + ' (' + (portPct >= 0 ? '+' : '') + portPct.toFixed(2) + '%)</span></div>';
  html += '<div class="mf-htt-row"><span class="mf-htt-row-lbl"><span style="color:#6366f1">●</span> ' + esc(FUND_CODE) + ' Price</span>' +
    '<span class="mf-htt-row-val">' + idxFund[idx].toFixed(2) + ' (' + (fundPct >= 0 ? '+' : '') + fundPct.toFixed(2) + '%)</span></div>';
  html += '<div class="mf-htt-divider"></div>';
  html += '<div class="mf-htt-row"><span class="mf-htt-row-lbl">Portfolio</span><span class="mf-htt-row-val">৳' + fmt(pt.portVal) + ' M</span></div>';
  html += '<div class="mf-htt-row"><span class="mf-htt-row-lbl">' + esc(FUND_CODE) + ' close</span><span class="mf-htt-row-val">৳' + fmt2(pt.fundClose) + '</span></div>';

  if (pt.quarter) {
    html += '<div class="mf-htt-coverage">Holdings as of ' + esc(pt.quarter) +
      (pt.coverage != null && pt.total != null && pt.coverage < pt.total
        ? ' · priced ' + pt.coverage + '/' + pt.total : '') +
      '</div>';
  }

  el.innerHTML = html;
  el.style.opacity = 1;

  const canvasRect = chart.canvas.getBoundingClientRect();
  const ttW = el.offsetWidth;
  const ttH = el.offsetHeight;

  let x = canvasRect.left + tooltip.caretX + 16;
  let y = canvasRect.top + tooltip.caretY - ttH / 2;
  if (x + ttW > window.innerWidth - 8) x = canvasRect.left + tooltip.caretX - ttW - 16;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  if (y + ttH > window.innerHeight - 8) y = window.innerHeight - ttH - 8;

  el.style.left = x + 'px';
  el.style.top  = y + 'px';
}