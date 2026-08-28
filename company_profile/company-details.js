/* ================================================================
   company-details.js
   Fetches /api/company-details/:code, renders info cards, and
   makes the dividend cards open a bar-chart modal.
   Called via:  window.initCompanyDetails(code)  from company.js
   ================================================================ */
'use strict';

/* ----------------------------------------------------------------
   Inject styles once
---------------------------------------------------------------- */
(function injectCSS() {
  if (document.getElementById('cd-styles')) return;
  const s = document.createElement('style');
  s.id = 'cd-styles';
  s.textContent = `
/* ── Company Details Section ─────────────────────────────── */
#company-details-section {
  max-width: 1100px;
  margin: 0 auto 20px;
  padding: 0 24px;
}

.cd-section-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  font-family: var(--mono);
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1.5px;
}
.cd-section-hd::before {
  content: '';
  width: 8px; height: 8px;
  background: var(--accent);
  border-radius: 50%;
  box-shadow: 0 0 8px var(--accent-glow);
  flex-shrink: 0;
}
.cd-loading {
  text-align: center;
  padding: 28px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

/* ── Card Grid ───────────────────────────────────────────── */
.cd-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 768px) { .cd-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .cd-grid { grid-template-columns: 1fr 1fr; } }

.cd-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px 18px;
  position: relative;
  overflow: hidden;
  transition: border-color .25s, transform .2s, box-shadow .2s;
}
.cd-card.clickable { cursor: pointer; }
.cd-card.clickable:hover {
  border-color: var(--accent);
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(0,0,0,.4), 0 0 16px var(--accent-glow);
}
.cd-card.clickable::after {
  content: '📊 View history';
  position: absolute;
  bottom: 10px; right: 12px;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--accent);
  opacity: 0;
  transition: opacity .2s;
  letter-spacing: 0.5px;
}
.cd-card.clickable:hover::after { opacity: 1; }

.cd-card-label {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 12px;
  text-align: center;
}
.cd-card-value {
  font-family: var(--mono);
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
  letter-spacing: -0.5px;
  line-height: 1.2;
}
.cd-card-value.gain  { color: var(--gain);    text-shadow: 0 0 16px rgba(0,230,118,.3); }
.cd-card-value.loss  { color: var(--loss);    text-shadow: 0 0 16px rgba(255,64,96,.3); }
.cd-card-value.muted { color: var(--text-muted); font-size: 18px; }

/* Dividend card — compact multi-year preview */
.cd-div-preview {
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  color: var(--gain);
  text-align: center;
  line-height: 1.6;
}
.cd-div-latest-label {
  font-family: var(--mono);
  font-size: 9px;
  color: var(--text-muted);
  letter-spacing: 1px;
  text-align: center;
  margin-top: 4px;
}

/* ── Dividend History Modal ───────────────────────────────── */
.cd-modal-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(0,0,0,.7);
  backdrop-filter: blur(4px);
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.cd-modal-backdrop.open { display: flex; animation: cdBackIn .18s ease; }
@keyframes cdBackIn { from { opacity:0 } to { opacity:1 } }

.cd-modal {
  background: var(--bg-card);
  border: 1px solid var(--border-glow);
  border-radius: 14px;
  width: 100%;
  max-width: 580px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,.8);
  animation: cdModalIn .25s cubic-bezier(.34,1.56,.64,1);
}
@keyframes cdModalIn {
  from { opacity:0; transform:translateY(-24px) scale(.95) }
  to   { opacity:1; transform:none }
}

.cd-modal-hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  background: rgba(0,0,0,.25);
  flex-shrink: 0;
}
.cd-modal-title {
  font-family: var(--mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-primary);
}
.cd-modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 22px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color .15s, transform .2s;
}
.cd-modal-close:hover { color: var(--text-primary); transform: rotate(90deg); }

.cd-modal-body {
  padding: 22px;
  overflow-y: auto;
  flex: 1;
}

/* Summary bar inside modal */
.cd-modal-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  margin-bottom: 22px;
}
.cd-modal-stat {
  padding: 12px 16px;
  border-right: 1px solid var(--border);
  background: rgba(0,0,0,.15);
}
.cd-modal-stat:last-child { border-right: none; }
.cd-stat-lbl { font-family: var(--mono); font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 4px; }
.cd-stat-val { font-family: var(--mono); font-size: 16px; font-weight: 700; color: var(--gain); }

.cd-modal-chart { position: relative; height: 240px; margin-bottom: 18px; }

/* Table inside modal */
.cd-modal-tbl {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 11px;
}
.cd-modal-tbl thead th {
  padding: 8px 12px;
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.cd-modal-tbl thead th.r { text-align: right; }
.cd-modal-tbl tbody tr { border-bottom: 1px solid rgba(255,255,255,.04); transition: background .1s; }
.cd-modal-tbl tbody tr:hover { background: rgba(255,255,255,.03); }
.cd-modal-tbl td { padding: 9px 12px; color: var(--text-secondary); }
.cd-modal-tbl td.r { text-align: right; }
.cd-modal-tbl td.g { color: var(--gain); font-weight: 700; text-align: right; }
`;
  document.head.appendChild(s);
})();

/* ----------------------------------------------------------------
   Parse dividend strings like "17.50% 2025, 15% 2024, 10% 2023"
---------------------------------------------------------------- */
function parseDividendStr(raw) {
  if (!raw) return [];
  const results = [];
  const re = /(\d+(?:\.\d+)?)\s*%[^,\d]*(\d{4})/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    results.push({ pct: parseFloat(m[1]), year: parseInt(m[2]) });
  }
  // Sort ascending by year
  return results.sort((a, b) => a.year - b.year);
}

/* ----------------------------------------------------------------
   Format raw scraped values (e.g. "12,345.60" → clean display)
---------------------------------------------------------------- */
function fmtDetail(v) {
  if (!v || v === '—') return '—';
  return v;
}

/* ----------------------------------------------------------------
   Build the Card HTML
---------------------------------------------------------------- */
function makeCard(label, value, opts = {}) {
  const { gain, loss, clickFn, preview } = opts;
  const cls = ['cd-card'];
  if (clickFn) cls.push('clickable');
  const valCls = ['cd-card-value', gain ? 'gain' : loss ? 'loss' : ''].filter(Boolean).join(' ');

  const inner = preview
    ? `<div class="cd-div-preview">${preview.latest}</div>
       <div class="cd-div-latest-label">${preview.label}</div>`
    : `<div class="${valCls}">${value === '—' ? '<span class="muted">—</span>' : value}</div>`;

  return `
    <div class="${cls.join(' ')}" ${clickFn ? `onclick="${clickFn}"` : ''}>
      <div class="cd-card-label">${label}</div>
      ${inner}
    </div>`;
}

/* ----------------------------------------------------------------
   Render the section
---------------------------------------------------------------- */
function renderDetailCards(data) {
  const root = document.getElementById('company-details-section');
  if (!root) return;

  // Parse dividends
  const cashDivs  = parseDividendStr(data.cashDividend);
  const stockDivs = parseDividendStr(data.stockDividend);

  const latestCash  = cashDivs.length  ? cashDivs[cashDivs.length  - 1] : null;
  const latestStock = stockDivs.length ? stockDivs[stockDivs.length - 1] : null;

  const cashPreview = latestCash
    ? { latest: `${latestCash.pct}% (${latestCash.year})`, label: `${cashDivs.length} year${cashDivs.length > 1 ? 's' : ''} of data` }
    : null;
  const stockPreview = latestStock
    ? { latest: `${latestStock.pct}% (${latestStock.year})`, label: `${stockDivs.length} year${stockDivs.length > 1 ? 's' : ''} of data` }
    : null;

  // Build grid
  root.innerHTML = `
    <div class="cd-section-hd">Company Details</div>
    <div class="cd-grid">
      ${makeCard('52W High', fmtDetail(data.weekHigh52), { gain: !!data.weekHigh52 })}
      ${makeCard('52W Low',  fmtDetail(data.weekLow52),  { loss: !!data.weekLow52 })}
      ${makeCard('Beta',     fmtDetail(data.beta))}
      ${cashPreview
        ? makeCard('Cash Dividend', null, { gain: true, clickFn: "window.__openCashDivModal()", preview: cashPreview })
        : makeCard('Cash Dividend', '—')}
      ${stockPreview
        ? makeCard('Stock Dividend', null, { gain: true, clickFn: "window.__openStockDivModal()", preview: stockPreview })
        : makeCard('Stock Dividend', '—')}
      ${makeCard('NAV / Share',        fmtDetail(data.nav))}
      ${makeCard('Paid Up Cap',        fmtDetail(data.paidUpCapital))}
      ${makeCard('Authorized Cap',     fmtDetail(data.authorizedCapital))}
      ${makeCard('Short Term Loan',    fmtDetail(data.shortTermLoan), { loss: !!data.shortTermLoan })}
      ${makeCard('Long Term Loan',     fmtDetail(data.longTermLoan),  { loss: !!data.longTermLoan })}
      ${makeCard('EPS',                fmtDetail(data.eps),           { gain: !!data.eps })}
      ${makeCard('P/E Ratio',          fmtDetail(data.pe))}
    </div>`;

  // Inject modal once
  if (!document.getElementById('cd-div-modal')) {
    const m = document.createElement('div');
    m.id = 'cd-div-modal';
    m.className = 'cd-modal-backdrop';
    m.innerHTML = `
      <div class="cd-modal" onclick="event.stopPropagation()">
        <div class="cd-modal-hd">
          <span class="cd-modal-title" id="cd-modal-title">Dividend History</span>
          <button class="cd-modal-close" onclick="window.__closeDivModal()">✕</button>
        </div>
        <div class="cd-modal-body">
          <div class="cd-modal-stats" id="cd-modal-stats"></div>
          <div class="cd-modal-chart"><canvas id="cd-div-chart"></canvas></div>
          <table class="cd-modal-tbl">
            <thead><tr>
              <th>Year</th>
              <th class="r">Dividend (%)</th>
              <th class="r">vs Prev Year</th>
            </tr></thead>
            <tbody id="cd-div-tbody"></tbody>
          </table>
        </div>
      </div>`;
    m.addEventListener('click', window.__closeDivModal);
    document.body.appendChild(m);
  }

  // Wire up click handlers
  let _chart = null;

  function openModal(label, divs) {
    if (!divs.length) return;
    document.getElementById('cd-modal-title').textContent = label + ' — History';

    // Stats
    const latest = divs[divs.length - 1];
    const max    = Math.max(...divs.map(d => d.pct));
    const avg    = divs.reduce((s, d) => s + d.pct, 0) / divs.length;
    document.getElementById('cd-modal-stats').innerHTML = `
      <div class="cd-modal-stat"><div class="cd-stat-lbl">Latest (${latest.year})</div><div class="cd-stat-val">${latest.pct}%</div></div>
      <div class="cd-modal-stat"><div class="cd-stat-lbl">Highest</div><div class="cd-stat-val">${max}%</div></div>
      <div class="cd-modal-stat"><div class="cd-stat-lbl">Average</div><div class="cd-stat-val" style="color:var(--accent)">${avg.toFixed(2)}%</div></div>`;

    // Table
    const reversed = [...divs].reverse();
    document.getElementById('cd-div-tbody').innerHTML = reversed.map((d, i) => {
      const prev   = reversed[i + 1];
      const delta  = prev ? d.pct - prev.pct : null;
      const dStr   = delta === null ? '—' : (delta >= 0 ? `+${delta.toFixed(2)}%` : `${delta.toFixed(2)}%`);
      const dCls   = delta === null ? '' : delta >= 0 ? 'g' : 'loss-text';
      return `<tr>
        <td style="color:var(--text-muted)">${d.year}</td>
        <td class="g">${d.pct}%</td>
        <td class="${dCls} r">${dStr}</td>
      </tr>`;
    }).join('');

    // Chart
    const safeFont = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    if (_chart) { _chart.destroy(); _chart = null; }

    // Load Chart.js if not present
    function doChart() {
      _chart = new Chart(document.getElementById('cd-div-chart'), {
        type: 'bar',
        data: {
          labels: divs.map(d => d.year),
          datasets: [{
            label: 'Dividend (%)',
            data:  divs.map(d => d.pct),
            backgroundColor: divs.map(d => 'rgba(0,230,118,0.72)'),
            borderColor: '#00e676',
            borderWidth: 1,
            borderRadius: 5,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#161b24',
              borderColor: 'rgba(255,255,255,.12)',
              borderWidth: 1,
              titleFont: { family: safeFont, size: 11 },
              bodyFont:  { family: safeFont, size: 12 },
              callbacks: { label: ctx => `  Dividend: ${ctx.raw}%` }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#8fa3c0', font: { family: safeFont, size: 10 } }, border: { display: false } },
            y: {
              grid: { color: 'rgba(255,255,255,.05)' },
              ticks: { color: '#00e676', font: { family: safeFont, size: 10 }, callback: v => v + '%' },
              border: { color: 'rgba(255,255,255,.07)' }
            }
          }
        }
      });
    }

    if (typeof Chart !== 'undefined') {
      doChart();
    } else {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      sc.onload = doChart;
      document.head.appendChild(sc);
    }

    document.getElementById('cd-div-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  window.__openCashDivModal  = () => openModal('Cash Dividend',  cashDivs);
  window.__openStockDivModal = () => openModal('Stock Dividend', stockDivs);
  window.__closeDivModal     = () => {
    const m = document.getElementById('cd-div-modal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
  };

  // Close on Escape
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.__closeDivModal(); }, { once: false });
}

/* ----------------------------------------------------------------
   Public API — called from company.js populateProfile()
---------------------------------------------------------------- */
window.initCompanyDetails = async function (code) {
  const root = document.getElementById('company-details-section');
  if (!root) return;

  root.innerHTML = '<div class="cd-loading">Loading company details…</div>';

  try {
    const res  = await fetch(`/api/company-details/${encodeURIComponent(code)}`);
    const data = await res.json();
    renderDetailCards(data);
  } catch (err) {
    root.innerHTML = `<div class="cd-loading" style="color:var(--loss)">Could not load company details.</div>`;
    console.error('[company-details]', err);
  }
};
