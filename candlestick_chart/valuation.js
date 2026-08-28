'use strict';

/* ════════════════════════════════════════════════════════════
   valuation.js
   "Intrinsic Value" side panel for candlestick.html — five
   independent valuation models, each seeded with this stock's
   own real EPS/NAV/dividend data (from /api/company-details)
   and the live LTP, with the inherently-subjective inputs
   (growth rate, discount rate, projection years) left as
   editable assumptions rather than invented "correct" numbers —
   same honesty convention as company_profile/ddm.js's Gordon
   Growth calculator, just extended to four more models.

   Models:
     DCF            — EPS-based simplified discounted cash flow
                       (disclosed as an EPS proxy, not a full FCF DCF)
     DDM            — Gordon Growth dividend discount model
     Residual Income — single-stage (perpetuity) residual income
     Graham Number  — √(22.5 × EPS × BVPS), no assumptions needed
     Payback Time   — years of compounding EPS to repay the price

   Entry points : window.openValuationModal(), window.closeValuationModal()
   Depends on   : candlestick-data.js (chartData, urlCodeFallback),
                    /api/company-details/:code, /api/stocks
   Consumed by  : candlestick.html (right-rail button + modal markup)
   ════════════════════════════════════════════════════════════ */

(function () {
  const MODAL_ID = 'valuationModal';
  const BODY_ID  = 'valuationBody';

  let _openId = 0;
  let _ctx    = null; // { code, eps, nav, d0, ltp, weekHigh52, weekLow52 }

  // Per-model editable assumptions — seeded with sensible defaults,
  // never presented as objectively "correct".
  const state = {
    dcf:  { g: 8,  r: 12, years: 5, gTerm: 3 },
    ddm:  { g: 5,  r: 12 },
    rim:  { r: 12 },
    payback: { g: 8, price: null },
  };

  // ─── Formatters ────────────────────────────────────────────
  function fmtBDT(v) {
    return (v == null || isNaN(v)) ? '—' : '৳' + v.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function numFrom(v) {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  // DSE reports cash dividend as a "%" of BDT 10 face value (e.g. "17%" on
  // the most recent line of a multi-year string like "7% 2024, 17% 2023...").
  function parseLastDividend(raw) {
    if (!raw) return null;
    const first = String(raw).split(',')[0].trim();
    const pctMatch = first.match(/([\d.]+)\s*%/);
    if (pctMatch) return parseFloat(pctMatch[1]) * 10 / 100;
    const numMatch = first.match(/([\d.]+)/);
    return numMatch ? parseFloat(numMatch[1]) : null;
  }

  function marginBadge(intrinsic, ltp) {
    if (intrinsic == null || ltp == null) return '';
    const margin = ((intrinsic - ltp) / ltp) * 100;
    const cls = margin > 1 ? 'val-under' : margin < -1 ? 'val-over' : 'val-fair';
    const label = margin > 1 ? '▲ Undervalued' : margin < -1 ? '▼ Overvalued' : '≈ Fairly valued';
    return `<span class="val-badge ${cls}">${label} ${margin >= 0 ? '+' : ''}${margin.toFixed(1)}%</span>`;
  }

  // ─── Data loading ──────────────────────────────────────────
  function getCurrentCode() {
    if (typeof chartData !== 'undefined' && chartData.length && chartData[0].Symbol) return String(chartData[0].Symbol).toUpperCase();
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return null;
  }

  async function loadContext(code) {
    let details = {};
    try {
      const res = await fetch(`/api/company-details/${encodeURIComponent(code)}`);
      if (res.ok) details = await res.json();
    } catch (e) { /* best-effort */ }

    let ltp = null;
    try {
      const res = await fetch('/api/stocks');
      if (res.ok) {
        const data = await res.json();
        const stock = (data.stocks || []).find(s => String(s.code).toUpperCase() === code);
        if (stock) ltp = stock.ltp || null;
      }
    } catch (e) { /* best-effort */ }
    if (!ltp && typeof chartData !== 'undefined' && chartData.length) ltp = chartData[chartData.length - 1].Close;

    return {
      code,
      eps: numFrom(details.eps),
      nav: numFrom(details.nav),
      d0:  parseLastDividend(details.cashDividend),
      ltp,
      weekHigh52: numFrom(details.weekHigh52),
      weekLow52:  numFrom(details.weekLow52),
    };
  }

  // ─── Model 1: DCF (EPS-based, simplified) ──────────────────
  function calcDCF() {
    const { eps } = _ctx;
    const { g, r, years, gTerm } = state.dcf;
    if (!eps || eps <= 0) return { error: 'No positive EPS available — DCF needs a starting earnings figure.' };
    if (r <= gTerm) return { error: 'Discount rate must be greater than the terminal growth rate.' };

    let pv = 0;
    let epsT = eps;
    for (let t = 1; t <= years; t++) {
      epsT = eps * Math.pow(1 + g / 100, t);
      pv += epsT / Math.pow(1 + r / 100, t);
    }
    const terminalEPS = epsT * (1 + gTerm / 100);
    const terminalValue = terminalEPS / ((r - gTerm) / 100);
    const pvTerminal = terminalValue / Math.pow(1 + r / 100, years);
    const intrinsic = pv + pvTerminal;
    return { intrinsic, pv, pvTerminal, years };
  }

  // ─── Model 2: DDM (Gordon Growth) ───────────────────────────
  function calcDDM() {
    const { d0 } = _ctx;
    const { g, r } = state.ddm;
    if (!d0 || d0 <= 0) return { error: 'No dividend data — DDM cannot be applied to non-dividend-paying stocks.' };
    if (r <= g) return { error: 'Required return must be greater than the dividend growth rate.' };
    const D1 = d0 * (1 + g / 100);
    const intrinsic = D1 / ((r - g) / 100);
    return { intrinsic, D1 };
  }

  // ─── Model 3: Residual Income (single-stage / perpetuity) ──
  function calcRIM() {
    const { eps, nav } = _ctx;
    const { r } = state.rim;
    if (!nav || nav <= 0) return { error: 'No positive NAV (book value) available — Residual Income needs a book-value base.' };
    if (!eps) return { error: 'No EPS available to derive ROE.' };
    const roe = (eps / nav) * 100;
    const residualPerShare = ((roe - r) / 100) * nav;
    const intrinsic = nav + residualPerShare / (r / 100);
    return { intrinsic, roe, residualPerShare };
  }

  // ─── Model 4: Benjamin Graham Number (data-only) ────────────
  function calcGraham() {
    const { eps, nav } = _ctx;
    if (!eps || eps <= 0 || !nav || nav <= 0) return { error: 'Requires positive EPS and NAV — not applicable to loss-making or negative-book-value stocks.' };
    const intrinsic = Math.sqrt(22.5 * eps * nav);
    return { intrinsic };
  }

  // ─── Model 5: Payback Time (Phil Town style) ────────────────
  function calcPayback() {
    const { eps } = _ctx;
    const { g } = state.payback;
    const price = state.payback.price != null ? state.payback.price : _ctx.ltp;
    if (!eps || eps <= 0) return { error: 'No positive EPS available — Payback Time needs a starting earnings figure.' };
    if (!price || price <= 0) return { error: 'No price available to compare against.' };

    let cumulative = 0, year = 0, eightYearCum = 0;
    while (cumulative < price && year < 30) {
      year++;
      const epsT = eps * Math.pow(1 + g / 100, year);
      cumulative += epsT;
      if (year === 8) eightYearCum = cumulative;
    }
    if (year < 8) {
      // still need the 8-year figure even if payback happened sooner
      let c = 0;
      for (let t = 1; t <= 8; t++) c += eps * Math.pow(1 + g / 100, t);
      eightYearCum = c;
    }
    const reached = cumulative >= price;
    return { years: reached ? year : null, price, eightYearCum, cumulative };
  }

  // ─── Rendering ───────────────────────────────────────────────
  function inputRow(id, label, value, opts) {
    opts = opts || {};
    return `
      <div class="val-input-row">
        <label for="${id}">${escapeHtml(label)}</label>
        <input type="number" id="${id}" value="${value != null ? value : ''}" step="${opts.step || '0.1'}" ${opts.min != null ? `min="${opts.min}"` : ''} />
      </div>`;
  }

  function renderDCFCard() {
    const r = calcDCF();
    const body = r.error
      ? `<div class="val-warn">${escapeHtml(r.error)}</div>`
      : `
        <div class="val-result-main">
          <div class="val-result-value">${fmtBDT(r.intrinsic)}</div>
          ${marginBadge(r.intrinsic, _ctx.ltp)}
        </div>
        <div class="val-breakdown">
          <div class="val-breakdown-row"><span>PV of ${r.years}yr projected earnings</span><span>${fmtBDT(r.pv)}</span></div>
          <div class="val-breakdown-row"><span>PV of terminal value</span><span>${fmtBDT(r.pvTerminal)}</span></div>
          <div class="val-breakdown-row highlight"><span>LTP</span><span>${fmtBDT(_ctx.ltp)}</span></div>
        </div>`;
    return `
      <div class="val-card">
        <div class="val-card-hd">
          <span class="val-card-title">Discounted Cash Flow (DCF)</span>
          <span class="val-card-note">EPS-based proxy — not a full FCF model</span>
        </div>
        <div class="val-inputs">
          ${inputRow('val-dcf-g', 'Growth rate g (%/yr)', state.dcf.g)}
          ${inputRow('val-dcf-r', 'Discount rate r (%/yr)', state.dcf.r)}
          ${inputRow('val-dcf-years', 'Projection years', state.dcf.years, { step: '1', min: '1' })}
          ${inputRow('val-dcf-gterm', 'Terminal growth (%/yr)', state.dcf.gTerm)}
        </div>
        <div class="val-result">${body}</div>
        <div class="val-formula-note">EPS₀ = ${fmtBDT(_ctx.eps)} · V = Σ EPS₀(1+g)ᵗ/(1+r)ᵗ + terminal value</div>
      </div>`;
  }

  function renderDDMCard() {
    const r = calcDDM();
    const body = r.error
      ? `<div class="val-warn">${escapeHtml(r.error)}</div>`
      : `
        <div class="val-result-main">
          <div class="val-result-value">${fmtBDT(r.intrinsic)}</div>
          ${marginBadge(r.intrinsic, _ctx.ltp)}
        </div>
        <div class="val-breakdown">
          <div class="val-breakdown-row"><span>D₁ = D₀ × (1+g)</span><span>${fmtBDT(r.D1)}</span></div>
          <div class="val-breakdown-row highlight"><span>LTP</span><span>${fmtBDT(_ctx.ltp)}</span></div>
        </div>`;
    return `
      <div class="val-card">
        <div class="val-card-hd">
          <span class="val-card-title">Dividend Discount Model (DDM)</span>
          <span class="val-card-note">Gordon Growth · V = D₁ / (r − g)</span>
        </div>
        <div class="val-inputs">
          ${inputRow('val-ddm-d0', 'Last dividend D₀ (BDT/share)', _ctx.d0 != null ? _ctx.d0.toFixed(2) : '', { min: '0' })}
          ${inputRow('val-ddm-g', 'Dividend growth g (%/yr)', state.ddm.g)}
          ${inputRow('val-ddm-r', 'Required return r (%/yr)', state.ddm.r)}
        </div>
        <div class="val-result">${body}</div>
        <div class="val-formula-note">D₀ from this stock's last reported cash dividend (editable above)</div>
      </div>`;
  }

  function renderRIMCard() {
    const r = calcRIM();
    const body = r.error
      ? `<div class="val-warn">${escapeHtml(r.error)}</div>`
      : `
        <div class="val-result-main">
          <div class="val-result-value">${fmtBDT(r.intrinsic)}</div>
          ${marginBadge(r.intrinsic, _ctx.ltp)}
        </div>
        <div class="val-breakdown">
          <div class="val-breakdown-row"><span>ROE (EPS / NAV)</span><span>${r.roe.toFixed(2)}%</span></div>
          <div class="val-breakdown-row"><span>Residual income / share</span><span>${fmtBDT(r.residualPerShare)}</span></div>
          <div class="val-breakdown-row highlight"><span>LTP</span><span>${fmtBDT(_ctx.ltp)}</span></div>
        </div>`;
    return `
      <div class="val-card">
        <div class="val-card-hd">
          <span class="val-card-title">Residual Income Model</span>
          <span class="val-card-note">Single-stage · V = BV + (ROE − r)·BV / r</span>
        </div>
        <div class="val-inputs">
          ${inputRow('val-rim-r', 'Required return r (%/yr)', state.rim.r)}
        </div>
        <div class="val-result">${body}</div>
        <div class="val-formula-note">BV₀ (NAV) = ${fmtBDT(_ctx.nav)} · EPS₀ = ${fmtBDT(_ctx.eps)}</div>
      </div>`;
  }

  function renderGrahamCard() {
    const r = calcGraham();
    const body = r.error
      ? `<div class="val-warn">${escapeHtml(r.error)}</div>`
      : `
        <div class="val-result-main">
          <div class="val-result-value">${fmtBDT(r.intrinsic)}</div>
          ${marginBadge(r.intrinsic, _ctx.ltp)}
        </div>
        <div class="val-breakdown">
          <div class="val-breakdown-row"><span>EPS</span><span>${fmtBDT(_ctx.eps)}</span></div>
          <div class="val-breakdown-row"><span>NAV (BVPS)</span><span>${fmtBDT(_ctx.nav)}</span></div>
          <div class="val-breakdown-row highlight"><span>LTP</span><span>${fmtBDT(_ctx.ltp)}</span></div>
        </div>`;
    return `
      <div class="val-card">
        <div class="val-card-hd">
          <span class="val-card-title">Benjamin Graham Formula</span>
          <span class="val-card-note">Graham Number · √(22.5 × EPS × BVPS) — no assumptions needed</span>
        </div>
        <div class="val-result">${body}</div>
        <div class="val-formula-note">Implies a ceiling of P/E ≤ 15 and P/B ≤ 1.5 combined — a conservative classic screen, not a growth-aware estimate.</div>
      </div>`;
  }

  function renderPaybackCard() {
    const r = calcPayback();
    const body = r.error
      ? `<div class="val-warn">${escapeHtml(r.error)}</div>`
      : `
        <div class="val-result-main">
          <div class="val-result-value">${r.years != null ? r.years + (r.years === 1 ? ' year' : ' years') : '> 30 years'}</div>
          <span class="val-badge ${r.years != null && r.years <= 8 ? 'val-under' : r.years == null ? 'val-over' : 'val-fair'}">
            ${r.years != null && r.years <= 8 ? '▲ Within classic 8-yr threshold' : r.years == null ? '▼ Exceeds 30-yr horizon' : '≈ Slower payback'}
          </span>
        </div>
        <div class="val-breakdown">
          <div class="val-breakdown-row"><span>8-year cumulative EPS</span><span>${fmtBDT(r.eightYearCum)}</span></div>
          <div class="val-breakdown-row highlight"><span>Price compared</span><span>${fmtBDT(r.price)}</span></div>
        </div>`;
    return `
      <div class="val-card">
        <div class="val-card-hd">
          <span class="val-card-title">Payback Time Model</span>
          <span class="val-card-note">Years of compounding EPS to repay the price paid</span>
        </div>
        <div class="val-inputs">
          ${inputRow('val-payback-g', 'Earnings growth g (%/yr)', state.payback.g)}
          ${inputRow('val-payback-price', 'Price to compare (BDT)', (state.payback.price != null ? state.payback.price : _ctx.ltp))}
        </div>
        <div class="val-result">${body}</div>
        <div class="val-formula-note">EPS₀ = ${fmtBDT(_ctx.eps)} · rule of thumb: under 8 years is considered attractive (Phil Town's "Payback Time")</div>
      </div>`;
  }

  function renderSummaryStrip() {
    const models = [
      { label: 'DCF',     r: calcDCF() },
      { label: 'DDM',     r: calcDDM() },
      { label: 'Residual Income', r: calcRIM() },
      { label: 'Graham Number', r: calcGraham() },
    ];
    const rows = models.map(m => {
      if (m.r.error) return `<div class="val-summary-row"><span>${escapeHtml(m.label)}</span><span class="val-summary-na">n/a</span></div>`;
      return `<div class="val-summary-row"><span>${escapeHtml(m.label)}</span><span>${fmtBDT(m.r.intrinsic)}</span></div>`;
    }).join('');
    return `
      <div class="val-summary">
        <div class="val-summary-hd">
          <span>Current price (LTP)</span>
          <span class="val-summary-ltp">${fmtBDT(_ctx.ltp)}</span>
        </div>
        ${rows}
      </div>`;
  }

  function render() {
    const body = document.getElementById(BODY_ID);
    if (!body || !_ctx) return;
    body.innerHTML = `
      ${renderSummaryStrip()}
      ${renderDCFCard()}
      ${renderDDMCard()}
      ${renderRIMCard()}
      ${renderGrahamCard()}
      ${renderPaybackCard()}
      <div class="val-disclaimer">⚠️ Every model here needs assumptions (growth/discount rate, projection horizon) that are inherently judgment calls — they're pre-filled with common defaults, not predictions. EPS/NAV/dividend inputs are this stock's real, currently-scraped figures. Not financial advice.</div>
    `;
    wireInputs();
  }

  function wireInputs() {
    const bind = (id, path, key, isInt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
        if (!isNaN(v)) {
          path[key] = v;
          render();
          // Re-focus after the innerHTML rebuild wipes it. Cursor-position
          // restoration is skipped — type="number" inputs don't support
          // setSelectionRange in Chrome (throws InvalidStateError).
          const again = document.getElementById(id);
          if (again) again.focus();
        }
      });
    };
    bind('val-dcf-g', state.dcf, 'g');
    bind('val-dcf-r', state.dcf, 'r');
    bind('val-dcf-years', state.dcf, 'years', true);
    bind('val-dcf-gterm', state.dcf, 'gTerm');
    bind('val-ddm-d0', _ctx, 'd0');
    bind('val-ddm-g', state.ddm, 'g');
    bind('val-ddm-r', state.ddm, 'r');
    bind('val-rim-r', state.rim, 'r');
    bind('val-payback-g', state.payback, 'g');
    bind('val-payback-price', state.payback, 'price');
  }

  async function runValuation() {
    const myId = ++_openId;
    const code = getCurrentCode();
    const body = document.getElementById(BODY_ID);
    if (!code) {
      if (body) body.innerHTML = '<div class="val-warn">No symbol loaded yet.</div>';
      return;
    }
    if (body) body.innerHTML = '<div class="val-loading">Loading fundamentals…</div>';

    const ctx = await loadContext(code);
    if (_openId !== myId) return;
    _ctx = ctx;
    render();
  }

  // ─── Public entry points ────────────────────────────────────
  window.openValuationModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = 'flex';
    runValuation();
  };

  window.closeValuationModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    _openId++;
  };
})();
