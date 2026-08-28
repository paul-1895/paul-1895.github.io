/* ================================================================
   bank-financials.js — Quarterly Bank Financials section for company.html
   Renders KPI snapshot, risk-signal insights, and trend charts from
   /api/bank-financials/:code (see routes/bank-financials.js and the
   dataset built under bank_financials/<CODE>/).
   Only invoked for Bank-sector tickers — see company.js sector callback.
================================================================ */
'use strict';

(function () {
  const API = '/api/bank-financials';
  let _code = null;
  let _data = null;
  let _range = '15Y';
  let _charts = {};

  /* ── Chart.js loader (self-contained — nothing else on this page loads it) ── */
  let _chartJsLoading = false;
  function _ensureChartJs() {
    if (window.Chart || _chartJsLoading) return;
    _chartJsLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
    document.head.appendChild(s);
  }

  window.initBankFinancials = async function (code) {
    _code = code;
    try {
      const r = await fetch(`${API}/${encodeURIComponent(code)}`);
      _data = await r.json();
    } catch { _data = null; }

    if (!_data || !_data.available || !(_data.ratios && _data.ratios.periods && _data.ratios.periods.length)) {
      return; // no dataset yet for this bank — leave the section absent
    }

    _ensureChartJs();
    _injectShell();
    _renderKPIs();
    _renderInsights();
    _renderCharts();
  };

  /* ── shell ─────────────────────────────────────────────────── */
  function _injectShell() {
    const sec = document.getElementById('bank-fin-section');
    if (!sec) return;
    const periods = _data.ratios.periods;
    const latest = periods[periods.length - 1];
    sec.innerHTML = `
      <div class="bf-section">
        <div class="bf-card">
          <div class="bf-header">
            <div class="bf-title">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 21h18M4 21V9l8-5 8 5v12M9 21v-6h6v6"/>
              </svg>
              Quarterly Bank Financials
            </div>
            <div class="bf-asof">as of ${latest.financial_year} ${latest.quarter}</div>
          </div>
          <div class="bf-kpi-grid" id="bf-kpi-grid"></div>
        </div>

        <div class="bf-card" id="bf-insights-card">
          <div class="bf-chart-title" style="margin-bottom:12px">Data-Driven Insights &amp; Risk Signals</div>
          <div id="bf-insights-list"></div>
        </div>

        <div class="bf-card">
          <div class="bf-header">
            <div class="bf-chart-title" style="margin:0">Historical Trends</div>
            <div class="bf-range-toggle" id="bf-range-toggle">
              ${['1Y','3Y','5Y','10Y','15Y'].map(r => `<button class="bf-range-btn${r===_range?' active':''}" data-range="${r}">${r}</button>`).join('')}
            </div>
          </div>
          <div class="bf-charts-grid">
            <div class="bf-chart-card bf-wide">
              <div class="bf-chart-title">Balance Sheet — Assets / Loans / Deposits (BDT million)</div>
              <div class="bf-chart-wrap"><canvas id="bf-chart-balance"></canvas></div>
            </div>
            <div class="bf-chart-card">
              <div class="bf-chart-title">NPL Ratio (%)</div>
              <div class="bf-chart-wrap"><canvas id="bf-chart-npl"></canvas></div>
            </div>
            <div class="bf-chart-card">
              <div class="bf-chart-title">Capital Adequacy Ratio (%)</div>
              <div class="bf-chart-wrap"><canvas id="bf-chart-car"></canvas></div>
            </div>
            <div class="bf-chart-card bf-wide">
              <div class="bf-chart-title">Return on Equity (%)</div>
              <div class="bf-chart-wrap"><canvas id="bf-chart-roe"></canvas></div>
            </div>
          </div>
          <div class="bf-source-note">
            Sourced from ${_data.bank_id}'s official unaudited quarterly statements and audited annual reports (see sources.json in the underlying dataset). Reported values are shown as filed; where a figure is calculated rather than directly reported (e.g. NPL ratio derived from classified-loan and gross-loan line items), it is marked "calc" in the tooltip.
          </div>
        </div>
      </div>`;

    document.querySelectorAll('#bf-range-toggle .bf-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _range = btn.dataset.range;
        document.querySelectorAll('#bf-range-toggle .bf-range-btn').forEach(b => b.classList.toggle('active', b === btn));
        _renderCharts();
      });
    });
  }

  /* ── helpers ───────────────────────────────────────────────── */
  function fmtMn(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function fmtPct(v) {
    if (v == null) return '—';
    return `${v >= 0 ? '' : ''}${Number(v).toFixed(2)}%`;
  }
  // Walk backward from the latest period to find the most recent non-null value for a metric accessor.
  function latestWithValue(accessor) {
    const periods = _data.ratios.periods;
    for (let i = periods.length - 1; i >= 0; i--) {
      const v = accessor(periods[i]);
      if (v != null) return { period: periods[i], ...v };
    }
    return null;
  }

  function _renderKPIs() {
    const grid = document.getElementById('bf-kpi-grid');
    if (!grid) return;
    const periods = _data.ratios.periods;
    const latest = periods[periods.length - 1];

    const items = [
      { label: 'Total Assets', ...(() => { const x = latestWithValue(p => p.total_assets != null ? { value: p.total_assets } : null); return { value: x ? `${fmtMn(x.value)}` : '—', unit: 'BDT mn', stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'Gross Loans', ...(() => { const x = latestWithValue(p => p.gross_loans != null ? { value: p.gross_loans } : null); return { value: x ? `${fmtMn(x.value)}` : '—', unit: 'BDT mn', stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'Total Deposits', ...(() => { const x = latestWithValue(p => p.total_deposits != null ? { value: p.total_deposits } : null); return { value: x ? `${fmtMn(x.value)}` : '—', unit: 'BDT mn', stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'Total Equity', ...(() => { const x = latestWithValue(p => p.equity != null ? { value: p.equity } : null); return { value: x ? `${fmtMn(x.value)}` : '—', unit: 'BDT mn', neg: x && x.value < 0, stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'LDR', ...(() => { const x = latestWithValue(p => p.ldr_pct); return { value: fmtPct(x && x.value), calc: x && x.basis === 'calculated', stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'NPL Ratio', ...(() => { const x = latestWithValue(p => p.npl_ratio_pct); return { value: fmtPct(x && x.value), neg: x && x.value > 5, calc: x && x.basis === 'calculated', stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'ROE', ...(() => { const x = latestWithValue(p => p.roe_pct); return { value: fmtPct(x && x.value), neg: x && x.value < 0, pos: x && x.value >= 0, stale: x && x.period !== latest, period: x && x.period }; })() },
      { label: 'CAR', ...(() => { const x = latestWithValue(p => p.car_pct); return { value: fmtPct(x && x.value), neg: x && x.value < 10, stale: x && x.period !== latest, period: x && x.period }; })() },
    ];

    grid.innerHTML = items.map(it => `
      <div class="bf-kpi">
        <div class="bf-kpi-label">${it.label}${it.unit ? ' (' + it.unit + ')' : ''}</div>
        <div class="bf-kpi-value${it.neg ? ' bf-neg' : ''}${it.pos ? ' bf-pos' : ''}">${it.value}</div>
        ${it.calc ? '<div class="bf-kpi-note bf-calc">calculated, not directly reported</div>' : ''}
        ${it.stale && it.period ? `<div class="bf-kpi-note bf-stale">latest available: ${it.period.financial_year} ${it.period.quarter}</div>` : ''}
      </div>`).join('');
  }

  function _renderInsights() {
    const list = document.getElementById('bf-insights-list');
    if (!list) return;
    const signals = (_data.insights && _data.insights.risk_signals) || [];
    if (!signals.length) {
      list.innerHTML = '<div class="bf-empty">No automated insights generated yet for this bank.</div>';
      return;
    }
    list.innerHTML = signals.map(s => `
      <div class="bf-insight">
        <span class="bf-insight-badge bf-${s.severity === 'critical' ? 'critical' : (s.severity === 'moderate' ? 'moderate' : 'info')}">${s.severity}</span>
        <span>${s.statement}</span>
      </div>`).join('');
  }

  /* ── range filter ──────────────────────────────────────────── */
  function _filterByRange(periods) {
    if (_range === '15Y') return periods;
    const years = { '1Y': 1, '3Y': 3, '5Y': 5, '10Y': 10 }[_range] || 15;
    const last = periods[periods.length - 1];
    const cutoff = new Date(last.financial_year - years, 0, 1);
    return periods.filter(p => new Date(p.financial_year, 0, 1) >= cutoff);
  }

  /* ── charts (Chart.js — loaded by financials-charts.js if present on the page) ── */
  function _whenChartReady(fn) {
    if (window.Chart) { fn(); return; }
    const wait = setInterval(() => { if (window.Chart) { clearInterval(wait); fn(); } }, 150);
    setTimeout(() => clearInterval(wait), 8000);
  }

  function _getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function _destroy(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }

  function _lineChart(canvasId, labels, series, opts) {
    _destroy(canvasId);
    const el = document.getElementById(canvasId);
    if (!el) return;
    const textMuted = _getCSSVar('--text-muted') || '#8a93a6';
    const border = _getCSSVar('--border') || '#e2e5ea';
    const bgCard = _getCSSVar('--bg-card') || '#ffffff';
    const textSecondary = _getCSSVar('--text-secondary') || '#3b4151';

    _charts[canvasId] = new Chart(el.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label,
          data: s.data,
          borderColor: s.color,
          backgroundColor: s.color + '20',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: s.color,
          tension: 0.15,
          fill: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: series.length > 1, position: 'top', labels: { color: textSecondary, boxWidth: 10, font: { size: 10.5 } } },
          tooltip: {
            backgroundColor: bgCard, borderColor: border, borderWidth: 1,
            titleColor: textSecondary, bodyColor: textSecondary,
            callbacks: {
              label: (ctx) => {
                const s = series[ctx.datasetIndex];
                const basisNote = s.basis && s.basis[ctx.dataIndex] === 'calculated' ? ' (calc)' : '';
                return `${ctx.dataset.label}: ${ctx.formattedValue}${opts && opts.suffix ? opts.suffix : ''}${basisNote}`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: textMuted, font: { size: 10 } }, grid: { display: false }, border: { color: border } },
          y: { ticks: { color: textMuted, font: { size: 10 } }, grid: { color: border }, border: { color: border } }
        }
      }
    });
  }

  function _renderCharts() {
    _whenChartReady(() => {
      const periods = _filterByRange(_data.ratios.periods);
      const labels = periods.map(p => `${p.quarter} '${String(p.financial_year).slice(2)}`);

      const accent = _getCSSVar('--accent') || '#1a5cff';
      const loss = _getCSSVar('--loss') || '#d13f3f';
      const gain = _getCSSVar('--gain') || '#0f9960';
      const orange = '#eb6834';
      const aqua = '#1baf7a';

      _lineChart('bf-chart-balance', labels, [
        { label: 'Assets', data: periods.map(p => p.total_assets), color: accent },
        { label: 'Loans', data: periods.map(p => p.gross_loans), color: orange },
        { label: 'Deposits', data: periods.map(p => p.total_deposits), color: aqua },
      ]);

      _lineChart('bf-chart-npl', labels, [
        { label: 'NPL Ratio', data: periods.map(p => p.npl_ratio_pct && p.npl_ratio_pct.value), color: loss, basis: periods.map(p => p.npl_ratio_pct && p.npl_ratio_pct.basis) }
      ], { suffix: '%' });

      _lineChart('bf-chart-car', labels, [
        { label: 'CAR', data: periods.map(p => p.car_pct && p.car_pct.value), color: accent, basis: periods.map(p => p.car_pct && p.car_pct.basis) }
      ], { suffix: '%' });

      _lineChart('bf-chart-roe', labels, [
        { label: 'ROE', data: periods.map(p => p.roe_pct && p.roe_pct.value), color: gain, basis: periods.map(p => p.roe_pct && p.roe_pct.basis) }
      ], { suffix: '%' });
    });
  }

})();
