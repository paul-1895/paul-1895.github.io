/* ════════════════════════════════════════════════════════════
   ac-pane-settings.js
   A settings button for EVERY indicator pane.

   The pane-controls bar shipped with move-up / move-down /
   collapse / maximize / delete, but no way to configure the
   indicator the pane belongs to. Where a settings surface already
   exists this just routes to it:

     generic sub-panes (42 types: Stochastic, ADX, OBV, MFI …)
         → openIndicatorSettings(<instance id>), the full
           Inputs/Style/Visibility editor, since every one of them
           is a multi-instance indicator
     MACD → openMACDSettings(), its own dedicated modal

   RSI and Hilega-Milega are the two legacy single-instance panes
   and had no settings surface at all — their periods and colours
   are `const` in indicators/rsi.js and indicators/hilega-milega.js.
   Rather than ship a dead button for them, this file gives them
   real settings: the maths functions those files expose
   (calculateRSI, calculateWMA, calculateEMA) are global, so the
   values can simply be recomputed at the chosen periods and
   re-attached to the candles, and ac-ind-subpane.js reads the
   colours/levels back out of the param objects below.

   Nothing under candlestick_chart/ is modified — attachIndicators()
   is wrapped, not edited, so the shared defaults still apply on the
   candlestick page.

   Depends on : candlestick-data.js (_loadPref/_savePref, chartData,
                aggregatedData, attachIndicators),
                indicators/rsi.js (calculateRSI),
                indicators/hilega-milega.js (calculateWMA),
                indicators/ma.js (calculateEMA)
   Owns       : window.acRsiParams, window.acHmParams,
                window.acOpenPaneSettings, window.acPaneHasSettings
   ════════════════════════════════════════════════════════════ */
'use strict';

/* Defaults mirror the hard-coded values in the shared indicator files, so an
   untouched chart looks exactly as it did before this existed. */
const AC_RSI_DEFAULTS = {
  period: 14,
  color: '#D77FFF',
  overbought: 70,
  oversold: 30,
};

const AC_HM_DEFAULTS = {
  rsiPeriod: 9,
  wmaPeriod: 21,
  emaPeriod: 3,
  colorRsi: '#26c6da',
  colorStrength: '#ffa726',
  colorPrice: '#66bb6a',
  colorLine50: '#4caf50',
};

let acRsiParams = Object.assign({}, AC_RSI_DEFAULTS,
  (typeof _loadPref === 'function') ? _loadPref('acRsiParams', {}) : {});
let acHmParams = Object.assign({}, AC_HM_DEFAULTS,
  (typeof _loadPref === 'function') ? _loadPref('acHmParams', {}) : {});

function saveAcRsiParams() { if (typeof _savePref === 'function') _savePref('acRsiParams', acRsiParams); }
function saveAcHmParams()  { if (typeof _savePref === 'function') _savePref('acHmParams', acHmParams); }

(function () {

  // ── Recompute the two legacy panes at the chosen periods ──────
  // attachRSI()/attachHilegaMilega() run first with their fixed periods; this
  // overwrites the same candle fields afterwards, so ac-ind-subpane.js renders
  // the chosen settings without knowing anything changed.
  function reattachLegacy(data) {
    if (!Array.isArray(data) || !data.length) return;
    if (typeof calculateRSI !== 'function') return;
    const closes = data.map(c => c.Close);

    // Recompute UNCONDITIONALLY, even at the default period. Skipping the
    // default would leave whatever the previous setting wrote still sitting on
    // the candles, so moving a length back to its default appeared to do
    // nothing — attachRSI() itself is not re-run by this path.
    const rp = clampInt(acRsiParams.period, 2, 200, AC_RSI_DEFAULTS.period);
    const rsi = calculateRSI(closes, rp);
    data.forEach((c, i) => { c.rsi = rsi[i]; });

    if (typeof calculateWMA !== 'function' || typeof calculateEMA !== 'function') return;

    // Mirrors attachHilegaMilega() exactly, with the periods made settable:
    // the warm-up nulls are filled with 50 (the RSI midline, NOT zero), and
    // BOTH smoothings are taken over the RSI series — hmEma3 is an EMA of RSI,
    // not of price, despite the "Price EMA3" name the shared legend gives it.
    const hp = clampInt(acHmParams.rsiPeriod, 2, 200, AC_HM_DEFAULTS.rsiPeriod);
    const wp = clampInt(acHmParams.wmaPeriod, 2, 200, AC_HM_DEFAULTS.wmaPeriod);
    const ep = clampInt(acHmParams.emaPeriod, 1, 200, AC_HM_DEFAULTS.emaPeriod);
    const hmRsi = calculateRSI(closes, hp);
    const filled = hmRsi.map(v => v ?? 50);
    const hmWma = calculateWMA(filled, wp);
    const hmEma = calculateEMA(filled, ep);
    data.forEach((c, i) => {
      c.hmRsi   = hmRsi[i];
      c.hmWma21 = hmWma[i];
      c.hmEma3  = hmEma[i];
    });
  }

  function clampInt(v, lo, hi, fallback) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function reattachAll() {
    if (typeof chartData !== 'undefined') reattachLegacy(chartData);
    if (typeof aggregatedData !== 'undefined' && aggregatedData !== chartData) reattachLegacy(aggregatedData);
  }

  // attachIndicators() is a top-level function declaration, so assigning
  // through window replaces the same binding every caller resolves.
  (function wrapAttach() {
    const original = window.attachIndicators;
    if (typeof original !== 'function' || window.__acPaneSettingsWrapped) return;
    window.attachIndicators = function acAttachIndicators(data) {
      const out = original.apply(this, arguments);
      try { reattachLegacy(data); } catch (e) { console.warn('[ACPaneSettings] reattach failed', e); }
      return out;
    };
    window.__acPaneSettingsWrapped = true;
  })();

  // ── Which surface does a pane key configure? ──────────────────
  function instancesInPane(paneKey) {
    if (typeof indicatorInstances === 'undefined' || typeof INDICATOR_DEFS === 'undefined') return [];
    return indicatorInstances.filter((inst) => {
      const def = INDICATOR_DEFS[inst.typeId];
      return def && def.isSubPane && def.paneKey === paneKey;
    });
  }

  function paneHasSettings(paneKey) {
    if (!paneKey) return false;
    if (paneKey === 'macd' || paneKey === 'MACD') return typeof window.openMACDSettings === 'function';
    if (paneKey === 'rsi' || paneKey === 'RSI') return true;
    if (paneKey === 'hm' || paneKey === 'Hilega-Milega') return true;
    if (paneKey === 'volume') return false;
    return instancesInPane(paneKey).length > 0;
  }

  function openPaneSettings(paneKey) {
    if (!paneKey) return false;
    if (paneKey === 'macd' || paneKey === 'MACD') {
      if (typeof window.openMACDSettings === 'function') { window.openMACDSettings(); return true; }
      return false;
    }
    if (paneKey === 'rsi' || paneKey === 'RSI') { openLegacyModal('rsi'); return true; }
    if (paneKey === 'hm' || paneKey === 'Hilega-Milega') { openLegacyModal('hm'); return true; }

    const list = instancesInPane(paneKey);
    if (!list.length) return false;
    if (typeof window.openIndicatorSettings !== 'function') return false;
    // Several instances can share one pane (two Stochastics, say). Open the
    // first; the legend rows give per-instance access to the rest.
    window.openIndicatorSettings(list[0].id);
    return true;
  }

  // ── The RSI / Hilega-Milega settings modal ────────────────────
  const MODAL_ID = 'acPaneSettingsModal';

  const FIELDS = {
    rsi: {
      title: 'RSI',
      get: () => acRsiParams,
      defaults: AC_RSI_DEFAULTS,
      save: saveAcRsiParams,
      rows: [
        { key: 'period', label: 'Length', type: 'number', min: 2, max: 200 },
        { key: 'overbought', label: 'Overbought', type: 'number', min: 1, max: 99 },
        { key: 'oversold', label: 'Oversold', type: 'number', min: 1, max: 99 },
        { key: 'color', label: 'Line colour', type: 'color' },
      ],
    },
    hm: {
      title: 'Hilega-Milega',
      get: () => acHmParams,
      defaults: AC_HM_DEFAULTS,
      save: saveAcHmParams,
      rows: [
        { key: 'rsiPeriod', label: 'RSI length', type: 'number', min: 2, max: 200 },
        { key: 'wmaPeriod', label: 'Strength WMA length', type: 'number', min: 2, max: 200 },
        { key: 'emaPeriod', label: 'EMA length', type: 'number', min: 1, max: 200 },
        { key: 'colorRsi', label: 'RSI colour', type: 'color' },
        { key: 'colorStrength', label: 'Strength colour', type: 'color' },
        { key: 'colorPrice', label: 'EMA colour', type: 'color' },
        { key: 'colorLine50', label: 'Line-50 colour', type: 'color' },
      ],
    },
  };

  let _openKind = null;

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-content ind-set-modal">
        <div class="modal-header">
          <h2 id="acPaneSettingsTitle">Indicator</h2>
          <button class="modal-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body" id="acPaneSettingsBody"></div>
        <div class="ind-set-footer">
          <button type="button" class="ind-set-cancel" data-act="reset">Reset</button>
          <button type="button" class="ind-set-ok" data-act="ok">Done</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('.modal-close').addEventListener('click', closeLegacyModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeLegacyModal(); });
    modal.querySelector('[data-act="ok"]').addEventListener('click', closeLegacyModal);
    modal.querySelector('[data-act="reset"]').addEventListener('click', () => {
      if (!_openKind) return;
      const spec = FIELDS[_openKind];
      Object.assign(spec.get(), spec.defaults);
      spec.save();
      renderBody();
      apply();
    });
    return modal;
  }

  function renderBody() {
    const spec = FIELDS[_openKind];
    if (!spec) return;
    const params = spec.get();
    const body = document.getElementById('acPaneSettingsBody');
    const rows = spec.rows.map((row) => {
      const v = params[row.key];
      const input = row.type === 'color'
        ? `<input type="color" class="ind-set-color" data-key="${row.key}" value="${v}">`
        : `<input type="number" data-key="${row.key}" value="${v}" min="${row.min}" max="${row.max}">`;
      return `<div class="ind-set-row">
        <label>${row.label}</label>${input}
      </div>`;
    }).join('');
    body.innerHTML = `<div class="ind-set-content">${rows}</div>`;

    body.querySelectorAll('input[data-key]').forEach((el) => {
      el.addEventListener('input', () => {
        const key = el.dataset.key;
        params[key] = (el.type === 'number') ? Number(el.value) : el.value;
        spec.save();
        apply();
      });
    });
  }

  function apply() {
    reattachAll();
    if (typeof drawChart === 'function') drawChart();
    if (typeof renderChartLegend === 'function') renderChartLegend();
  }

  function openLegacyModal(kind) {
    _openKind = kind;
    const modal = ensureModal();
    document.getElementById('acPaneSettingsTitle').textContent = FIELDS[kind].title + ' settings';
    renderBody();
    modal.style.display = 'flex';
  }

  function closeLegacyModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    _openKind = null;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _openKind) closeLegacyModal();
  });

  window.acOpenPaneSettings = openPaneSettings;
  window.acPaneHasSettings = paneHasSettings;
  window.acClosePaneSettings = closeLegacyModal;
  window.acReattachLegacySubPanes = reattachAll;

  // Values attached before this file loaded were computed with the shared
  // defaults; re-apply the saved settings once at boot.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(reattachAll, 0));
  } else {
    setTimeout(reattachAll, 0);
  }

})();
