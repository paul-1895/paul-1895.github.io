/**
 * financials-charts.js
 * --------------------
 * Renders line charts for all financial data collected by financials.js.
 *
 * Layout (web): 3 charts per row
 *   Row 1 → EPS | NOCFPS | Revenue
 *   Row 2 → NAV | Dividend (cash+stock, wide card spanning 2 cols)
 *
 * Layout (mobile ≤560px): 1 chart per row (handled purely by CSS grid).
 *
 * Dependencies:
 *   - Chart.js loaded via CDN (injected automatically by this module)
 *   - financials-charts.css
 *   - Called by financials.js after every fetchAndRender() via
 *       window.renderFinancialCharts(finData)
 *
 * Add to company.html <head>:
 *   <link rel="stylesheet" href="financials-charts.css" />
 * Add to company.html before </body>:
 *   <script src="financials-charts.js" defer></script>
 * Add <div id="financials-charts-section"></div> below #financials-section.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   CHART.JS LOADER  — injected once, charts rendered after load
═══════════════════════════════════════════════════════════════════════════ */
let chartJsReady = false;
let chartJsCallbacks = [];

(function loadChartJs() {
  if (window.Chart) { chartJsReady = true; return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
  s.onload = () => {
    chartJsReady = true;
    chartJsCallbacks.forEach(fn => fn());
    chartJsCallbacks = [];
  };
  document.head.appendChild(s);
})();

function whenReady(fn) {
  if (chartJsReady) fn();
  else chartJsCallbacks.push(fn);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHART REGISTRY  — track instances so we can destroy before re-render
═══════════════════════════════════════════════════════════════════════════ */
const chartRegistry = {};

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THEME HELPERS
═══════════════════════════════════════════════════════════════════════════ */
function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getThemeColors() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  return {
    accent:       getCSSVar('--accent')       || '#00d4aa',
    gain:         getCSSVar('--gain')         || '#22c55e',
    loss:         getCSSVar('--loss')         || '#ef4444',
    textMuted:    getCSSVar('--text-muted')   || (isDark ? '#4b5563' : '#9ca3af'),
    textSecond:   getCSSVar('--text-secondary')|| (isDark ? '#94a3b8' : '#475569'),
    border:       getCSSVar('--border')       || (isDark ? '#1f2735' : '#e2e8f0'),
    gridColor:    isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    bgCard:       getCSSVar('--bg-card')      || (isDark ? '#161b24' : '#ffffff'),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA HELPERS
═══════════════════════════════════════════════════════════════════════════ */
const QUARTER_ORDER = ['Q1', 'Q2', 'Q3', 'Q4'];

/** Sort quarterly entries chronologically and return { labels, values } */
function prepareQuarterly(entries) {
  const sorted = [...entries].sort((a, b) =>
    a.year !== b.year
      ? a.year - b.year
      : QUARTER_ORDER.indexOf(a.quarter) - QUARTER_ORDER.indexOf(b.quarter)
  );
  return {
    labels: sorted.map(e => `${e.quarter} ${e.year}`),
    values: sorted.map(e => e.value),
  };
}

/** Sort yearly dividend entries chronologically */
function prepareDividend(entries) {
  const sorted = [...entries].sort((a, b) => a.year - b.year);
  return {
    labels: sorted.map(e => String(e.year)),
    cash:   sorted.map(e => e.cashDividend),
    stock:  sorted.map(e => e.stockDividend),
  };
}

/** Compute simple stats for the stat-row */
function stats(values) {
  if (!values.length) return { latest: null, min: null, max: null, trend: null };
  const latest  = values[values.length - 1];
  const prev    = values.length > 1 ? values[values.length - 2] : null;
  const trend   = prev !== null ? latest - prev : null;
  return {
    latest,
    min: Math.min(...values),
    max: Math.max(...values),
    trend,
  };
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return '—';
  return Number(n).toFixed(decimals);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHART BUILDER
═══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {string}   canvasId
 * @param {string[]} labels
 * @param {{ label, values, color }[]} series  — supports multiple lines
 * @param {string}   yUnit
 */
function buildLineChart(canvasId, labels, series, yUnit = '') {
  destroyChart(canvasId);

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const C = getThemeColors();

  const datasets = series.map(s => ({
    label:           s.label,
    data:            s.values,
    borderColor:     s.color,
    backgroundColor: s.color + '20',
    borderWidth:     2,
    pointRadius:     labels.length < 20 ? 4 : 2,
    pointHoverRadius: 6,
    pointBackgroundColor: s.color,
    pointBorderColor:     C.bgCard,
    pointBorderWidth:     2,
    tension:         0.35,
    fill:            true,
  }));

  chartRegistry[canvasId] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: series.length > 1,
          labels: {
            font:      { family: "'Space Mono', monospace", size: 10 },
            color:     C.textSecond,
            boxWidth:  10,
            padding:   12,
          },
        },
        tooltip: {
          backgroundColor: C.bgCard,
          borderColor:     C.border,
          borderWidth:     1,
          titleColor:      C.textSecond,
          bodyColor:       C.textSecond,
          titleFont:  { family: "'Space Mono', monospace", size: 10 },
          bodyFont:   { family: "'Space Mono', monospace", size: 11 },
          padding:    10,
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}${yUnit ? ' ' + yUnit : ''}`,
          },
        },
      },
      scales: {
        x: {
          ticks: {
            font:       { family: "'Space Mono', monospace", size: 9 },
            color:      C.textMuted,
            maxRotation: 45,
            autoSkip:    true,
            maxTicksLimit: 10,
          },
          grid: { color: C.gridColor },
          border: { color: C.border },
        },
        y: {
          ticks: {
            font:  { family: "'Space Mono', monospace", size: 9 },
            color: C.textMuted,
            callback: v => fmt(v) + (yUnit ? ' ' + yUnit : ''),
          },
          grid:   { color: C.gridColor },
          border: { color: C.border },
        },
      },
    },
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAT ROW BUILDER
═══════════════════════════════════════════════════════════════════════════ */
function buildStatRow(containerId, statItems) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = statItems.map(({ label, value, cls }) => `
    <div class="fch-stat">
      <span class="fch-stat-label">${label}</span>
      <span class="fch-stat-value ${cls || ''}">${value}</span>
    </div>`).join('');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION HTML BUILDER
═══════════════════════════════════════════════════════════════════════════ */
function buildChartsHTML() {
  return `
<div class="fch-header">
  <span class="fch-title-icon">📈</span>
  <h2 class="fch-title">Financial Charts</h2>
  <span class="fch-subtitle">Line charts — chronological order</span>
</div>

<div class="fch-grid">

  <!-- EPS -->
  <div class="fch-card">
    <div class="fch-card-header">
      <span class="fch-card-title">EPS</span>
      <span class="fch-card-badge">BDT / SHARE</span>
    </div>
    <div class="fch-canvas-wrap" id="fch-wrap-eps">
      <canvas id="fch-canvas-eps"></canvas>
    </div>
    <div class="fch-stat-row" id="fch-stats-eps"></div>
  </div>

  <!-- NOCFPS -->
  <div class="fch-card">
    <div class="fch-card-header">
      <span class="fch-card-title">NOCFPS</span>
      <span class="fch-card-badge">BDT / SHARE</span>
    </div>
    <div class="fch-canvas-wrap" id="fch-wrap-nocfps">
      <canvas id="fch-canvas-nocfps"></canvas>
    </div>
    <div class="fch-stat-row" id="fch-stats-nocfps"></div>
  </div>

  <!-- Revenue -->
  <div class="fch-card">
    <div class="fch-card-header">
      <span class="fch-card-title">Revenue</span>
      <span class="fch-card-badge">BDT</span>
    </div>
    <div class="fch-canvas-wrap" id="fch-wrap-revenue">
      <canvas id="fch-canvas-revenue"></canvas>
    </div>
    <div class="fch-stat-row" id="fch-stats-revenue"></div>
  </div>

  <!-- NAV -->
  <div class="fch-card">
    <div class="fch-card-header">
      <span class="fch-card-title">NAV</span>
      <span class="fch-card-badge">BDT / SHARE</span>
    </div>
    <div class="fch-canvas-wrap" id="fch-wrap-nav">
      <canvas id="fch-canvas-nav"></canvas>
    </div>
    <div class="fch-stat-row" id="fch-stats-nav"></div>
  </div>

  <!-- Dividend — wide card (spans 2 cols on desktop/tablet) -->
  <div class="fch-card fch-card-wide">
    <div class="fch-card-header">
      <span class="fch-card-title">Dividend</span>
      <span class="fch-card-badge">%</span>
    </div>
    <div class="fch-canvas-wrap" id="fch-wrap-dividend">
      <canvas id="fch-canvas-dividend"></canvas>
    </div>
    <div class="fch-stat-row" id="fch-stats-dividend"></div>
  </div>

</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY STATE HELPER
═══════════════════════════════════════════════════════════════════════════ */
function showEmpty(wrapId, statId, msg = 'No data yet — add entries above.') {
  const wrap = document.getElementById(wrapId);
  const stat = document.getElementById(statId);
  if (wrap) wrap.innerHTML = `<p class="fch-empty">${msg}</p>`;
  if (stat) stat.innerHTML = '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN RENDER  — called by financials.js
═══════════════════════════════════════════════════════════════════════════ */
function renderFinancialCharts(finData) {
  whenReady(() => _doRender(finData));
}

function _doRender(finData) {
  const root = document.getElementById('financials-charts-section');
  if (!root) return;

  // Build DOM once; subsequent calls just update the canvases
  if (!root.querySelector('.fch-grid')) {
    root.innerHTML = buildChartsHTML();
  }

  const C = getThemeColors();

  /* ── EPS ──────────────────────────────────────────────────── */
  if (finData.eps && finData.eps.length) {
    const { labels, values } = prepareQuarterly(finData.eps);
    buildLineChart('fch-canvas-eps', labels,
      [{ label: 'EPS', values, color: C.accent }], 'BDT');
    const s = stats(values);
    buildStatRow('fch-stats-eps', [
      { label: 'Latest',  value: fmt(s.latest) + ' BDT' },
      { label: 'Highest', value: fmt(s.max)    + ' BDT', cls: 'gain' },
      { label: 'Lowest',  value: fmt(s.min)    + ' BDT', cls: 'loss' },
      { label: 'Change',  value: s.trend !== null ? (s.trend >= 0 ? '+' : '') + fmt(s.trend) : '—',
        cls: s.trend > 0 ? 'gain' : s.trend < 0 ? 'loss' : '' },
    ]);
  } else {
    showEmpty('fch-wrap-eps', 'fch-stats-eps');
  }

  /* ── NOCFPS ───────────────────────────────────────────────── */
  if (finData.nocfps && finData.nocfps.length) {
    const { labels, values } = prepareQuarterly(finData.nocfps);
    buildLineChart('fch-canvas-nocfps', labels,
      [{ label: 'NOCFPS', values, color: '#a78bfa' }], 'BDT');
    const s = stats(values);
    buildStatRow('fch-stats-nocfps', [
      { label: 'Latest',  value: fmt(s.latest) + ' BDT' },
      { label: 'Highest', value: fmt(s.max)    + ' BDT', cls: 'gain' },
      { label: 'Lowest',  value: fmt(s.min)    + ' BDT', cls: 'loss' },
      { label: 'Change',  value: s.trend !== null ? (s.trend >= 0 ? '+' : '') + fmt(s.trend) : '—',
        cls: s.trend > 0 ? 'gain' : s.trend < 0 ? 'loss' : '' },
    ]);
  } else {
    showEmpty('fch-wrap-nocfps', 'fch-stats-nocfps');
  }

  /* ── Revenue ──────────────────────────────────────────────── */
  if (finData.revenue && finData.revenue.length) {
    const { labels, values } = prepareQuarterly(finData.revenue);
    buildLineChart('fch-canvas-revenue', labels,
      [{ label: 'Revenue', values, color: '#f59e0b' }], 'BDT');
    const s = stats(values);
    buildStatRow('fch-stats-revenue', [
      { label: 'Latest',  value: fmt(s.latest) + ' BDT' },
      { label: 'Highest', value: fmt(s.max)    + ' BDT', cls: 'gain' },
      { label: 'Lowest',  value: fmt(s.min)    + ' BDT', cls: 'loss' },
      { label: 'Change',  value: s.trend !== null ? (s.trend >= 0 ? '+' : '') + fmt(s.trend) : '—',
        cls: s.trend > 0 ? 'gain' : s.trend < 0 ? 'loss' : '' },
    ]);
  } else {
    showEmpty('fch-wrap-revenue', 'fch-stats-revenue');
  }

  /* ── NAV ──────────────────────────────────────────────────── */
  if (finData.nav && finData.nav.length) {
    const { labels, values } = prepareQuarterly(finData.nav);
    buildLineChart('fch-canvas-nav', labels,
      [{ label: 'NAV', values, color: '#38bdf8' }], 'BDT');
    const s = stats(values);
    buildStatRow('fch-stats-nav', [
      { label: 'Latest',  value: fmt(s.latest) + ' BDT' },
      { label: 'Highest', value: fmt(s.max)    + ' BDT', cls: 'gain' },
      { label: 'Lowest',  value: fmt(s.min)    + ' BDT', cls: 'loss' },
      { label: 'Change',  value: s.trend !== null ? (s.trend >= 0 ? '+' : '') + fmt(s.trend) : '—',
        cls: s.trend > 0 ? 'gain' : s.trend < 0 ? 'loss' : '' },
    ]);
  } else {
    showEmpty('fch-wrap-nav', 'fch-stats-nav');
  }

  /* ── Dividend (2 lines: cash + stock) ────────────────────── */
  if (finData.dividend && finData.dividend.length) {
    const { labels, cash, stock } = prepareDividend(finData.dividend);
    buildLineChart('fch-canvas-dividend', labels, [
      { label: 'Cash Dividend',  values: cash,  color: C.gain },
      { label: 'Stock Dividend', values: stock, color: '#fb923c' },
    ], '%');
    const sc = stats(cash);
    const ss = stats(stock);
    buildStatRow('fch-stats-dividend', [
      { label: 'Cash — Latest',   value: fmt(sc.latest) + '%' },
      { label: 'Cash — High',     value: fmt(sc.max)    + '%', cls: 'gain' },
      { label: 'Stock — Latest',  value: fmt(ss.latest) + '%' },
      { label: 'Stock — High',    value: fmt(ss.max)    + '%', cls: 'gain' },
    ]);
  } else {
    showEmpty('fch-wrap-dividend', 'fch-stats-dividend');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THEME CHANGE — re-render charts when dark/light is toggled
   Hooks into the existing toggleTheme() in company.html by wrapping it.
═══════════════════════════════════════════════════════════════════════════ */
(function patchThemeToggle() {
  // Wait for the company page script to define toggleTheme
  window.addEventListener('DOMContentLoaded', () => {
    const origToggle = window.toggleTheme;
    if (typeof origToggle === 'function') {
      window.toggleTheme = function () {
        origToggle.call(this);
        // Re-render all charts with the new theme palette
        if (window._lastFinData) renderFinancialCharts(window._lastFinData);
      };
    }
  });
})();

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC API
═══════════════════════════════════════════════════════════════════════════ */
window.renderFinancialCharts = function (finData) {
  window._lastFinData = finData;   // cache for theme re-renders
  renderFinancialCharts(finData);
};
