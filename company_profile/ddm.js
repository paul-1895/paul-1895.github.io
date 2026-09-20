/* ================================================================
   ddm.js — Dividend Discount Model intrinsic value section
   Attaches to company.html · call initDDM(code, ltp)
   ================================================================ */
'use strict';

(function () {
  /* ── DEFAULTS ─────────────────────────────────────────────── */
  const DEFAULT_GROWTH    = 5;    // % annual dividend growth
  const DEFAULT_DISCOUNT  = 12;   // % required rate of return (typical DSE)

  /* ── STORAGE KEY ──────────────────────────────────────────── */
  function storageKey(code) { return `ddm_inputs_${code}`; }

  function loadSaved(code) {
    try { return JSON.parse(localStorage.getItem(storageKey(code)) || '{}'); }
    catch { return {}; }
  }
  function saveInputs(code, g, r) {
    localStorage.setItem(storageKey(code), JSON.stringify({ g, r }));
  }

  /* ── DDM FORMULA ──────────────────────────────────────────── */
  // Gordon Growth Model:  V = D1 / (r - g)
  // D1 = D0 * (1 + g)    where D0 = last cash dividend per share
  function calcDDM(d0, g, r) {
    if (r <= g) return null;           // model breaks down
    if (!d0 || d0 <= 0) return null;  // no dividend — can't use DDM
    const D1 = d0 * (1 + g / 100);
    return D1 / ((r - g) / 100);
  }

  /* ── PARSE DIVIDEND ───────────────────────────────────────── */
  // cashDividend from company-details may be "10%" or "2.50" or "2.50 TK"
  // DSE reports cash dividend as % of face value (face value = 10 BDT by default)
  function parseDividend(raw) {
    if (!raw) return null;
    const str = String(raw).replace(/,/g, '').trim();
    // "10%" → 10% of BDT 10 face value = 1.0 BDT per share
    const pctMatch = str.match(/([\d.]+)\s*%/);
    if (pctMatch) return parseFloat(pctMatch[1]) * 10 / 100; // % × face-value
    // "2.50 TK" or "2.50"
    const numMatch = str.match(/([\d.]+)/);
    return numMatch ? parseFloat(numMatch[1]) : null;
  }

  /* ── INIT ─────────────────────────────────────────────────── */
  window.initDDM = async function (code, ltp) {
    const container = document.getElementById('ddm-section');
    if (!container) return;

    container.innerHTML = renderShell(code);
    bindEvents(code, ltp);

    // Try to prefill dividend from company-details API
    try {
      const res  = await fetch(`/api/company-details/${code}`);
      const data = await res.json();
      const d0   = parseDividend(data.cashDividend);
      if (d0 !== null) {
        const inp = document.getElementById('ddm-d0');
        if (inp && !inp.value) inp.value = d0.toFixed(2);
      }
    } catch { /* silently skip */ }

    // Restore user's saved g & r
    const saved = loadSaved(code);
    if (saved.g !== undefined) document.getElementById('ddm-g').value = saved.g;
    if (saved.r !== undefined) document.getElementById('ddm-r').value = saved.r;

    recalc(code, ltp);
  };

  /* ── SHELL HTML ───────────────────────────────────────────── */
  function renderShell(code) {
    return `
      <div class="ddm-section">
        <div class="ddm-section-label">
          <span class="ddm-section-label-text">Intrinsic Value — DDM</span>
          <span class="ddm-section-label-line"></span>
        </div>

        <div class="ddm-card">

          <!-- Info strip -->
          <div class="ddm-info-strip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 16v-4M12 8h.01"/>
            </svg>
            Gordon Growth Model &nbsp;·&nbsp; <em>V = D₁ / (r − g)</em> &nbsp;·&nbsp;
            Only reliable for consistent dividend-paying stocks.
          </div>

          <!-- Inputs -->
          <div class="ddm-inputs">
            <div class="ddm-input-group">
              <label class="ddm-label" for="ddm-d0">Last Dividend D₀ <span class="ddm-unit">(BDT/share)</span></label>
              <input id="ddm-d0" class="ddm-input" type="number" step="0.01" min="0"
                placeholder="e.g. 2.00" title="Cash dividend per share last year" />
            </div>
            <div class="ddm-input-group">
              <label class="ddm-label" for="ddm-g">Dividend Growth <span class="ddm-unit">g (%/yr)</span></label>
              <input id="ddm-g" class="ddm-input" type="number" step="0.1" min="0" max="99"
                value="${DEFAULT_GROWTH}" title="Expected annual dividend growth rate" />
            </div>
            <div class="ddm-input-group">
              <label class="ddm-label" for="ddm-r">Required Return <span class="ddm-unit">r (%/yr)</span></label>
              <input id="ddm-r" class="ddm-input" type="number" step="0.1" min="0.1" max="99"
                value="${DEFAULT_DISCOUNT}" title="Your required rate of return (discount rate)" />
            </div>
            <button class="ddm-calc-btn" id="ddm-calc-btn">Calculate</button>
          </div>

          <!-- Result -->
          <div class="ddm-result" id="ddm-result">
            <div class="ddm-result-placeholder">Enter inputs above and press Calculate.</div>
          </div>

        </div>
      </div>`;
  }

  /* ── EVENTS ───────────────────────────────────────────────── */
  function bindEvents(code, ltp) {
    document.getElementById('ddm-calc-btn')
      .addEventListener('click', () => recalc(code, ltp));

    ['ddm-d0','ddm-g','ddm-r'].forEach(id => {
      document.getElementById(id)
        .addEventListener('keydown', e => { if (e.key === 'Enter') recalc(code, ltp); });
    });
  }

  /* ── RECALCULATE & RENDER ─────────────────────────────────── */
  function recalc(code, ltp) {
    const d0 = parseFloat(document.getElementById('ddm-d0').value);
    const g  = parseFloat(document.getElementById('ddm-g').value);
    const r  = parseFloat(document.getElementById('ddm-r').value);
    const el = document.getElementById('ddm-result');

    if (isNaN(g) || isNaN(r)) {
      el.innerHTML = '<div class="ddm-result-placeholder">Please fill in growth and discount rates.</div>';
      return;
    }

    saveInputs(code, g, r);

    if (isNaN(d0) || d0 <= 0) {
      el.innerHTML = `
        <div class="ddm-result-warn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          No dividend data — DDM cannot be applied to non-dividend-paying stocks.
        </div>`;
      return;
    }

    if (r <= g) {
      el.innerHTML = `<div class="ddm-result-warn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Required return (r) must be greater than growth rate (g).</div>`;
      return;
    }

    const intrinsic = calcDDM(d0, g, r);
    if (!intrinsic) {
      el.innerHTML = '<div class="ddm-result-warn">Unable to calculate. Check inputs.</div>';
      return;
    }

    const margin = ltp ? ((intrinsic - ltp) / ltp * 100) : null;
    const isUnder = margin !== null && margin > 0;
    const isOver  = margin !== null && margin < 0;

    const fmtBDT = n => '৳ ' + n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const D1     = d0 * (1 + g / 100);

    el.innerHTML = `
      <div class="ddm-result-grid">

        <div class="ddm-result-main">
          <div class="ddm-result-label">Intrinsic Value</div>
          <div class="ddm-result-value">${fmtBDT(intrinsic)}</div>
          ${margin !== null ? `
            <div class="ddm-margin-badge ${isUnder ? 'under' : isOver ? 'over' : 'fair'}">
              ${isUnder ? '▲ Undervalued' : isOver ? '▼ Overvalued' : '≈ Fairly Valued'}
              &nbsp;${Math.abs(margin).toFixed(1)}%
            </div>` : ''}
        </div>

        <div class="ddm-result-breakdown">
          <div class="ddm-breakdown-row">
            <span>D₀ (last dividend)</span><span>${fmtBDT(d0)}</span>
          </div>
          <div class="ddm-breakdown-row">
            <span>D₁ = D₀ × (1 + g)</span><span>${fmtBDT(D1)}</span>
          </div>
          <div class="ddm-breakdown-row">
            <span>r − g</span><span>${(r - g).toFixed(2)}%</span>
          </div>
          <div class="ddm-breakdown-row">
            <span>LTP</span><span>${ltp ? fmtBDT(ltp) : '—'}</span>
          </div>
          ${margin !== null ? `
          <div class="ddm-breakdown-row highlight ${isUnder ? 'under' : isOver ? 'over' : ''}">
            <span>Margin of Safety</span>
            <span>${margin > 0 ? '+' : ''}${margin.toFixed(2)}%</span>
          </div>` : ''}
        </div>

      </div>

      <div class="ddm-formula-note">
        V = ${fmtBDT(D1)} ÷ ${(r - g).toFixed(2)}% = <strong>${fmtBDT(intrinsic)}</strong>
      </div>`;

    // Expose result for screener bulk use
    window._ddmResults = window._ddmResults || {};
    window._ddmResults[code] = { intrinsic, ltp, margin, d0, g, r };
  }

})();
