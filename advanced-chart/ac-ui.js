/* ════════════════════════════════════════════════════════════
   ac-ui.js
   Toolbar / menus / modals / pane controls for the Advanced Chart —
   the Lightweight-Charts replacement for
   candlestick_chart/candlestick-ui.js.

   candlestick-ui.js is NOT loaded on this page: roughly half of it is
   canvas-specific (manual pan/zoom maths, crosshair pixel handling,
   pane-separator drag handles, touch pinch). Lightweight Charts does all
   of that natively, so this file ports only the parts that still mean
   something under a real charting engine, and re-expresses the zoom /
   pan / pane-resize parts against the LWC time scale and price scale.

   Ported verbatim (renderer-agnostic — they only touch globals + DOM):
     • the Renko settings modal
     • the indicators modal + MODAL_TO_INSTANCE_TYPE
     • the sub-pane collapse/delete helpers the indicator instance bar calls
     • updateInfoCards()

   Re-implemented against Lightweight Charts:
     • zoomIn/zoomOut          → timeScale().setVisibleLogicalRange()
     • vZoomIn/vZoomOut        → priceScale().setVisibleRange()
     • resetView               → setAutoScale(true) + fitContent()
     • downloadChart           → chart.takeScreenshot() ∘ #candleCanvas
     • pane resize persistence → mirror LWC's own separator drags into
                                 ac-render.js's paneHeights + saveACPaneHeights()
     • setupChartInteractions  → hover legend + pane-control bar only

   Dropped as canvas-only: _findHandle/_resizing (pane separator drag),
   _applyPan/_startPanMomentum/_priceOffsetFromDy (pan maths + momentum),
   the wheel/mousedown/touch pan+pinch handlers, setCrosshairPosition
   plumbing — LWC owns all of it. setupThemeToggle()/applyTheme() are
   dropped too: ac-theme-bridge.js owns theme on this page.

   Depends on : candlestick-data.js (chartData, chartType, enabledIndicators,
                paneOrder, collapsedPanes, renkoSettings, AVAILABLE_INDICATORS…),
                ac-render.js (drawChart, ACChart, paneHeights, PANE_HEIGHT_KEY,
                saveACPaneHeights), indicator-instances.js,
                indicator-settings-modal.js (renderIndicatorInstanceBar),
                candlestick-legend.js (updateLegendHover / clearLegendHover)
   ════════════════════════════════════════════════════════════ */

(function () {
'use strict';

const $ = id => document.getElementById(id);

// ─── Renderer access (all null-safe: candlestick-data.js can finish
//     loading before ac-boot.js has created the chart) ───────────────
function acChart()     { return (window.ACChart && window.ACChart.ready()) ? window.ACChart.chart() : null; }
function acContainer() { return (window.ACChart && window.ACChart.container && window.ACChart.container()) || $('candleCanvas'); }
function acOverlay()   { return (window.ACChart && window.ACChart.overlay && window.ACChart.overlay()) || $('candleCanvas'); }

// Pointer events have to be caught on the element that contains BOTH the
// Lightweight Charts container and the #candleCanvas overlay (they are
// siblings inside .chart-container), otherwise whichever one is on top
// swallows every move event.
function hoverRoot() {
  const base = acContainer();
  if (!base) return null;
  return base.closest('.chart-container') || base.parentElement || base;
}

// _lastRender / the overlay drawings are derived from the LWC scales, so
// anything that moves a scale outside of drawChart() has to ask for them
// to be recomputed (pan/zoom does this through ac-render's own
// subscribeVisibleLogicalRangeChange; price-scale moves do not).
function refreshGeometry() {
  if (!window.ACChart || !window.ACChart.ready()) return;
  window.ACChart.computeLastRender();
  window.ACChart.repaintOverlay();
}

function symbolCode() {
  return (typeof chartData !== 'undefined' && chartData[0] && chartData[0].Symbol)
    || (new URLSearchParams(window.location.search).get('code'))
    || 'BPML';
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}


/* ════════════════════════════════════════════════════════════
   1. CHART TYPE  (menu + setChartType + toolbar sync)
   ════════════════════════════════════════════════════════════ */

const CHART_TYPE_LABELS = {
  candlestick: 'Candles',
  hollow:      'Hollow candles',
  bars:        'Bars',
  renko:       'Renko',
  heikinashi:  'Heikin Ashi',
  line:        'Line',
  area:        'Area',
};

function chartTypeOptionEl(type) {
  return document.querySelector(`.chart-type-option[onclick*="setChartType('${type}')"]`);
}

// The toolbar button carries no text label in the ported markup — it is an
// icon button — so "syncing the label" means: mirror the active option's
// glyph onto the trigger, and put the human name in title/aria-label (and
// in an optional #chartTypeLabel span, if the markup grows one).
function syncChartTypeUI() {
  const type = (typeof chartType !== 'undefined') ? chartType : 'candlestick';

  document.querySelectorAll('.chart-type-option').forEach(opt => {
    const m  = (opt.getAttribute('onclick') || '').match(/setChartType\('([^']+)'\)/);
    const on = !!m && m[1] === type;
    opt.classList.toggle('active', on);
    if (opt.getAttribute('role') === 'menuitemradio') opt.setAttribute('aria-checked', on ? 'true' : 'false');
  });

  const btn = $('chartTypeBtn');
  if (!btn) return;
  const label = CHART_TYPE_LABELS[type] || type;
  btn.title = 'Chart type: ' + label;
  btn.setAttribute('aria-label', 'Chart type: ' + label);

  const labelEl = btn.querySelector('#chartTypeLabel, .tv-chart-type-label');
  if (labelEl) labelEl.textContent = label;

  const srcSvg = chartTypeOptionEl(type) && chartTypeOptionEl(type).querySelector('svg');
  const curSvg = btn.querySelector('svg');
  if (srcSvg && curSvg) {
    const clone = srcSvg.cloneNode(true);
    clone.removeAttribute('width');   // menu glyphs are 16px-fixed; the
    clone.removeAttribute('height');  // toolbar sizes its icon from CSS
    btn.replaceChild(clone, curSvg);
  }
}

function menuIsOpen(menu) {
  return !!menu && menu.style.display !== 'none' && getComputedStyle(menu).display !== 'none';
}

// The MutationObserver in enhanceMenu() keeps aria-expanded honest when the
// menu is toggled from elsewhere, but it only runs on a microtask — set it
// here as well so the trigger never reports a stale state mid-interaction.
function setMenuExpanded(triggerId, open) {
  const t = $(triggerId);
  if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function closeChartTypeMenu() {
  const menu = $('chartTypeMenu');
  if (menu) menu.style.display = 'none';
  setMenuExpanded('chartTypeBtn', false);
  document.removeEventListener('click', closeChartTypeMenuOnClickOutside);
}

function closeChartTypeMenuOnClickOutside(e) {
  const menu = $('chartTypeMenu');
  const btn  = $('chartTypeBtn');
  if (!menu || !btn) return;
  if (!menu.contains(e.target) && !btn.contains(e.target)) closeChartTypeMenu();
}

function toggleChartTypeMenu() {
  const menu = $('chartTypeMenu');
  const btn  = $('chartTypeBtn');
  if (!menu || !btn) return;
  if (menuIsOpen(menu)) { closeChartTypeMenu(); return; }

  const rect = btn.getBoundingClientRect();
  menu.style.left    = rect.left + 'px';
  menu.style.top     = (rect.bottom + 6) + 'px';
  menu.style.display = 'block';
  setMenuExpanded('chartTypeBtn', true);
  // Deferred: the click that opened the menu is still bubbling.
  setTimeout(() => document.addEventListener('click', closeChartTypeMenuOnClickOutside), 0);
}

function setChartType(type) {
  const prev = (typeof chartType !== 'undefined') ? chartType : 'candlestick';
  chartType = type;
  if (typeof saveChartType === 'function') saveChartType();

  syncChartTypeUI();
  closeChartTypeMenu();

  // Renko re-bins the data into bricks, so the bar COUNT changes wildly in
  // both directions — the old visible logical range would land nowhere near
  // the data. Ask ac-render for a fresh fitContent() on this pass only.
  if ((type === 'renko') !== (prev === 'renko') && window.ACChart && window.ACChart.requestFit) {
    window.ACChart.requestFit();
  }

  drawChart();
  if (type === 'renko') openRenkoSettings();
}

function toggleHeikinAshi() {
  const cur = (typeof chartType !== 'undefined') ? chartType : 'candlestick';
  setChartType(cur === 'heikinashi' ? 'candlestick' : 'heikinashi');
}

// candlestick.html hardcodes "Candles" as the active option in the markup;
// chartType is restored from localStorage, so the two can disagree on load.
function syncToolbarUIWithRestoredPrefs() {
  syncChartTypeUI();

  // Legacy MA20/50/200/EMA200 pills (company.html's toolbar; candlestick.html
  // replaced them with the indicator instance bar). Harmless when absent.
  if (typeof activeMA !== 'undefined') {
    document.querySelectorAll('.ma-btn').forEach(btn => {
      const m = (btn.getAttribute('onclick') || '').match(/toggleMA\(\s*'?(\w+)'?/);
      if (m) btn.classList.toggle('active', !!activeMA[m[1]]);
    });
  }
}

function toggleMA(period, btn) {
  if (typeof activeMA === 'undefined') return;
  activeMA[period] = !activeMA[period];
  if (typeof saveActiveMA === 'function') saveActiveMA();
  drawChart();
  if (btn) btn.classList.toggle('active', !!activeMA[period]);
}


/* ════════════════════════════════════════════════════════════
   2. RENKO SETTINGS MODAL
   Ported from candlestick-ui.js unchanged apart from null guards —
   it only ever touches the renkoSettings global and the DOM.
   ════════════════════════════════════════════════════════════ */

let _rsActiveSwatch = null;   // { key, opacityKey, el }

const RS_SWATCHES = [
  ['rs-sw-up-fill',  'colorUpBars',       'opacityUpBars'],
  ['rs-sw-up-line',  'colorUpBarsLine',   'opacityUpBarsLine'],
  ['rs-sw-dn-fill',  'colorDownBars',     'opacityDownBars'],
  ['rs-sw-dn-line',  'colorDownBarsLine', 'opacityDownBarsLine'],
  ['rs-sw-pup-fill', 'colorProjUp',       'opacityProjUp'],
  ['rs-sw-pup-line', 'colorProjUpLine',   'opacityProjUpLine'],
  ['rs-sw-pdn-fill', 'colorProjDown',     'opacityProjDown'],
  ['rs-sw-pdn-line', 'colorProjDownLine', 'opacityProjDownLine'],
];

function _rsToHex(colorStr) {
  if (!colorStr) return '#26a69a';
  if (colorStr.startsWith('#')) return colorStr;
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#26a69a';
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}

function _hexOpToRgba(hex, opacity) {
  const a = (opacity == null ? 100 : opacity) / 100;
  const m = String(hex).match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  if (!m) return hex;
  return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
}

function _rsToggleMethodUI(method) {
  const atrRow   = $('rs-atr-row');
  const fixedRow = $('rs-fixed-row');
  if (atrRow)   atrRow.style.display   = method === 'ATR'   ? 'flex' : 'none';
  if (fixedRow) fixedRow.style.display = method === 'fixed' ? 'flex' : 'none';
}

function renkoMethodChanged() {
  const el = $('rs-method');
  if (el) _rsToggleMethodUI(el.value);
}

function _rsPopulateForm() {
  if (typeof renkoSettings === 'undefined') return;
  const s = renkoSettings;

  const methodEl = $('rs-method');
  if (methodEl) { methodEl.value = s.method || 'ATR'; _rsToggleMethodUI(s.method || 'ATR'); }
  const atrEl = $('rs-atr-length');
  if (atrEl)  atrEl.value  = s.atrLength    || 14;
  const fixEl = $('rs-fixed-size');
  if (fixEl)  fixEl.value  = s.fixedBoxSize || 1;
  const srcEl = $('rs-source');
  if (srcEl)  srcEl.value  = s.source       || 'Close';
  const wickEl = $('rs-wicks');
  if (wickEl) wickEl.checked = s.showWicks !== false;

  RS_SWATCHES.forEach(([id, cKey, oKey]) => {
    const btn = $(id);
    if (!btn) return;
    const inner = btn.querySelector('.rs-swatch-inner');
    if (!inner) return;
    inner.style.background = _hexOpToRgba(_rsToHex(s[cKey] || '#26a69a'), s[oKey] != null ? s[oKey] : 100);
  });
}

function openRenkoSettings() {
  const modal = $('renkoSettingsModal');
  if (!modal) return;
  _rsPopulateForm();
  modal.style.display = 'flex';
}

function closeRenkoSettings() {
  const modal = $('renkoSettingsModal');
  if (modal) modal.style.display = 'none';
  if (typeof ColorPicker !== 'undefined' && ColorPicker.close) ColorPicker.close();
  _rsActiveSwatch = null;
}

// Each swatch button calls this with its settings key + opacity key.
function _rsSwatchClick(el, colorKey, opacityKey) {
  if (typeof renkoSettings === 'undefined' || typeof ColorPicker === 'undefined') return;
  const s       = renkoSettings;
  const hex     = _rsToHex(s[colorKey] || '#26a69a');
  const opacity = s[opacityKey] != null ? s[opacityKey] : 100;

  // Clicking the active swatch closes the picker.
  if (_rsActiveSwatch && _rsActiveSwatch.key === colorKey) {
    ColorPicker.close();
    el.classList.remove('active');
    _rsActiveSwatch = null;
    return;
  }

  document.querySelectorAll('.rs-swatch-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _rsActiveSwatch = { key: colorKey, opacityKey, el };

  ColorPicker.open(el, hex, opacity, ({ hex: h, opacity: op, rgba }) => {
    const inner = el.querySelector('.rs-swatch-inner');
    if (inner) inner.style.background = rgba;
    renkoSettings[colorKey]          = h;
    renkoSettings[opacityKey]        = op;
    renkoSettings['_rgba_' + colorKey] = rgba;
    drawChart();   // live preview
  });
}

function applyRenkoSettings() {
  if (typeof renkoSettings === 'undefined') return;
  const get     = id => { const e = $(id); return e ? e.value : ''; };
  const checked = id => { const e = $(id); return e ? e.checked : false; };

  renkoSettings.method       = get('rs-method') || renkoSettings.method;
  renkoSettings.atrLength    = parseInt(get('rs-atr-length'), 10)  || 14;
  renkoSettings.fixedBoxSize = parseFloat(get('rs-fixed-size'))    || 1;
  renkoSettings.source       = get('rs-source') || renkoSettings.source;
  renkoSettings.showWicks    = checked('rs-wicks');

  [
    ['colorUpBars',       'opacityUpBars'],
    ['colorUpBarsLine',   'opacityUpBarsLine'],
    ['colorDownBars',     'opacityDownBars'],
    ['colorDownBarsLine', 'opacityDownBarsLine'],
  ].forEach(([cKey, oKey]) => {
    renkoSettings['_rgba_' + cKey] = _hexOpToRgba(renkoSettings[cKey] || '#26a69a', renkoSettings[oKey]);
  });

  renkoBoxSize = renkoSettings.fixedBoxSize;
  if (typeof saveRenkoSettings === 'function') saveRenkoSettings();
  closeRenkoSettings();
  if (window.ACChart && window.ACChart.requestFit) window.ACChart.requestFit();
  drawChart();
}

function resetRenkoSettings() {
  if (typeof RENKO_DEFAULTS === 'undefined') return;
  renkoSettings = { ...RENKO_DEFAULTS };
  renkoBoxSize  = renkoSettings.fixedBoxSize;
  if (typeof saveRenkoSettings === 'function') saveRenkoSettings();
  _rsPopulateForm();
  if (window.ACChart && window.ACChart.requestFit) window.ACChart.requestFit();
  drawChart();
}


/* ════════════════════════════════════════════════════════════
   3. INFO CARDS
   ac-render.js ships a stub; this is the real implementation.
   candlestick-data.js calls it unconditionally at the end of
   processChartData(), so every lookup is null-guarded.
   ════════════════════════════════════════════════════════════ */

function updateInfoCards() {
  if (typeof chartData === 'undefined' || !chartData.length) return;

  const latest = chartData[chartData.length - 1];
  const oldest = chartData[0];
  let high = -Infinity, low = Infinity;
  for (const c of chartData) {
    if (c.High > high) high = c.High;
    if (c.Low  < low)  low  = c.Low;
  }
  const change    = latest.Close - oldest.Close;
  const changePct = oldest.Close ? ((change / oldest.Close) * 100).toFixed(2) : '0.00';

  const price = $('currentPrice');
  if (price) price.textContent = latest.Close.toFixed(2) + ' ৳';
  const hi = $('highPrice');
  if (hi) hi.textContent = high.toFixed(2) + ' ৳';
  const lo = $('lowPrice');
  if (lo) lo.textContent = low.toFixed(2) + ' ৳';

  const el = $('periodChange');
  if (el) {
    el.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + ' (' + changePct + '%)';
    el.className   = 'info-value ' + (change >= 0 ? 'gain' : 'loss');
  }
}


/* ════════════════════════════════════════════════════════════
   4. INDICATORS MODAL
   Renderer-agnostic — ported as-is. Names in AVAILABLE_INDICATORS
   that map to an INDICATOR_DEFS type (indicator-instances.js) are
   multi-instance: "Add" always creates ANOTHER instance. Everything
   else (MACD / RSI / Hilega-Milega) keeps the enabledIndicators
   on/off model.
   ════════════════════════════════════════════════════════════ */

function getIndicatorKey(name) {
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1] : name;
}

const MODAL_TO_INSTANCE_TYPE = {
  'Moving Average (SMA)':             'SMA',
  'Exponential Moving Average (EMA)': 'EMA',
  'Bollinger Bands':                  'Bollinger Bands',
  'Ichimoku Cloud':                   'Ichimoku Cloud',
  'Supertrend':                       'Supertrend',
  'Weighted Moving Average (WMA)':    'WMA',
  'Hull Moving Average (HMA)':        'HMA',
  'Double EMA (DEMA)':                'DEMA',
  'Triple EMA (TEMA)':                'TEMA',
  'Kaufman Adaptive MA (KAMA)':       'KAMA',
  'Arnaud Legoux MA (ALMA)':          'ALMA',
  'Volume Weighted MA (VWMA)':        'VWMA',
  'MA Ribbon':                        'MA Ribbon',
  'MA Cross':                         'MA Cross',
  'Parabolic SAR':                    'Parabolic SAR',
  'Donchian Channels':                'Donchian Channels',
  'Linear Regression':                'Linear Regression',
  'Keltner Channels':                 'Keltner Channels',
  'ATR Bands':                        'ATR Bands',
  'Volatility Stop':                  'Volatility Stop',
  'VWAP':                             'VWAP',
  'Anchored VWAP':                    'Anchored VWAP',
  'Stochastic Oscillator':            'Stochastic',
  'Stochastic RSI':                   'Stochastic RSI',
  'Williams %R':                      'Williams %R',
  'Awesome Oscillator':               'Awesome Oscillator',
  'Chande Momentum Oscillator':       'Chande Momentum Oscillator',
  'Commodity Channel Index (CCI)':    'CCI',
  'Rate of Change (ROC)':             'ROC',
  'Momentum':                         'Momentum',
  'Accelerator Oscillator':           'Accelerator Oscillator',
  'Ultimate Oscillator':              'Ultimate Oscillator',
  'Relative Vigor Index':             'Relative Vigor Index',
  'Connors RSI':                      'Connors RSI',
  'Fisher Transform':                 'Fisher Transform',
  'Detrended Price Oscillator (DPO)': 'DPO',
  'Percentage Price Oscillator (PPO)':'PPO',
  'Average Directional Index (ADX)':  'ADX/DMI',
  'Aroon Indicator':                  'Aroon',
  'Vortex Indicator':                 'Vortex',
  'TRIX':                             'TRIX',
  'Know Sure Thing (KST)':            'KST',
  'Mass Index':                       'Mass Index',
  'Linear Regression Slope':          'Linear Regression Slope',
  'Chande Forecast Oscillator':       'Chande Forecast Oscillator',
  'Average True Range (ATR)':         'ATR',
  'Standard Deviation':               'Standard Deviation',
  'Bollinger Band Width':             'Bollinger Band Width',
  'Historical Volatility':            'Historical Volatility',
  'Chaikin Volatility':               'Chaikin Volatility',
  'Ulcer Index':                      'Ulcer Index',
  'Relative Volatility Index':        'Relative Volatility Index',
  'On Balance Volume (OBV)':          'OBV',
  'Accumulation/Distribution':        'Accumulation/Distribution',
  'Money Flow Index (MFI)':           'Money Flow Index',
  'Volume Oscillator':                'Volume Oscillator',
  'Ease of Movement':                 'Ease of Movement',
  "Force Index (Elder's)":            'Force Index',
  'Klinger Oscillator':               'Klinger Oscillator',
  'Negative Volume Index (NVI)':      'NVI',
  'Positive Volume Index (PVI)':      'PVI',
  'Price Volume Trend (PVT)':         'PVT',
  'Relative Volume (RVOL)':           'Relative Volume',
  'Chaikin Money Flow':               'Chaikin Money Flow',
  'Volume Profile':                   'Volume Profile',
};

function openIndicatorsModal() {
  const modal = $('indicatorsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  populateIndicatorList();
  const search = $('indicatorSearch');
  if (search) setTimeout(() => search.focus(), 0);
}

function closeIndicatorsModal() {
  const modal = $('indicatorsModal');
  if (modal) modal.style.display = 'none';
}

function filterIndicators() {
  const input = $('indicatorSearch');
  if (!input) return;
  const q = input.value.toLowerCase();
  document.querySelectorAll('#indicatorList .indicator-item').forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function populateIndicatorList() {
  const list = $('indicatorList');
  if (!list || typeof AVAILABLE_INDICATORS === 'undefined') return;
  const instances = (typeof indicatorInstances !== 'undefined') ? indicatorInstances : [];

  list.innerHTML = '';
  AVAILABLE_INDICATORS.forEach(indicator => {
    const typeId          = MODAL_TO_INSTANCE_TYPE[indicator.name];
    const key             = getIndicatorKey(indicator.name);
    const isMultiInstance = typeId !== undefined;
    const instanceCount   = isMultiInstance ? instances.filter(inst => inst.typeId === typeId).length : 0;
    const isEnabled       = isMultiInstance
      ? instanceCount > 0
      : (typeof enabledIndicators !== 'undefined' && enabledIndicators.includes(key));

    const item = document.createElement('div');
    item.className = 'indicator-item';

    // Multi-instance types always show "Add" (clicking again adds ANOTHER
    // instance, like TradingView) plus a count badge. Single-instance types
    // keep the original Add/Remove toggle pair.
    const actionsHtml = isMultiInstance ? `
        <div class="indicator-actions">
          ${instanceCount > 0 ? `<span class="indicator-count-badge">${instanceCount} on chart</span>` : ''}
          <button class="indicator-btn add-btn" onclick="addIndicator('${indicator.name}', this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </div>` : `
        <div class="indicator-actions">
          <button class="indicator-btn remove-btn"
                  onclick="removeIndicator('${indicator.name}', this)"
                  style="display:${isEnabled ? 'flex' : 'none'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Remove
          </button>
          <button class="indicator-btn add-btn"
                  onclick="addIndicator('${indicator.name}', this)"
                  style="display:${isEnabled ? 'none' : 'flex'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </div>`;

    item.innerHTML = `
      <div class="indicator-name">
        <span>${indicator.name}</span>
        <span>${indicator.category}</span>
      </div>
      ${actionsHtml}`;
    list.appendChild(item);
  });

  filterIndicators();   // keep the current search query applied across refreshes
}

function addIndicator(name, btn) {
  const typeId = MODAL_TO_INSTANCE_TYPE[name];
  if (typeId !== undefined) {
    if (typeof createIndicatorInstance === 'function') createIndicatorInstance(typeId);
    refreshInstanceBar();
    drawChart();
    populateIndicatorList();   // refresh the count badge
    return;
  }

  const key = getIndicatorKey(name);
  if (typeof enabledIndicators === 'undefined' || enabledIndicators.includes(key)) return;
  enabledIndicators.push(key);
  if (typeof saveEnabledIndicators === 'function') saveEnabledIndicators();
  // A sub-pane has to be in paneOrder to get a pane from ac-render's
  // reconciliation; a stale saved paneOrder can be missing it.
  if (typeof paneOrder !== 'undefined' && !paneOrder.includes(key)) {
    paneOrder.push(key);
    if (typeof savePaneOrder === 'function') savePaneOrder();
  }

  if (btn) {
    const item = btn.closest('.indicator-item');
    if (item) {
      const add = item.querySelector('.add-btn');
      const rem = item.querySelector('.remove-btn');
      if (add) add.style.display = 'none';
      if (rem) rem.style.display = 'flex';
    }
  }
  drawChart();
  refreshInstanceBar();   // the MACD/RSI/HM pill appears immediately
}

function removeIndicator(name, btn) {
  // Multi-instance types are removed one at a time from the instance bar's
  // trash icon — there is no single "the EMA" to remove — so this path only
  // ever runs for MACD / RSI / Hilega-Milega.
  const key = getIndicatorKey(name);
  if (typeof enabledIndicators === 'undefined') return;
  enabledIndicators = enabledIndicators.filter(i => i !== key);
  if (typeof saveEnabledIndicators === 'function') saveEnabledIndicators();

  if (btn) {
    const item = btn.closest('.indicator-item');
    if (item) {
      const add = item.querySelector('.add-btn');
      const rem = item.querySelector('.remove-btn');
      if (rem) rem.style.display = 'none';
      if (add) add.style.display = 'flex';
    }
  }
  drawChart();
  refreshInstanceBar();
}

// ── Indicator instance bar glue ───────────────────────────────
// renderIndicatorInstanceBar() itself lives in the unmodified
// indicator-settings-modal.js; this is just the "call it at the right
// moment" wrapper every mutation point here funnels through.
function refreshInstanceBar() {
  if (typeof renderIndicatorInstanceBar === 'function') renderIndicatorInstanceBar();
}


/* ════════════════════════════════════════════════════════════
   5. SUB-PANE STATE  (shared by the pane-control bar and the
      indicator instance bar's sub-pane pills)
   ════════════════════════════════════════════════════════════ */

// Heights restored on collapse / un-maximize. Mirrors ac-render.js's own
// defaults rather than candlestick-draw.js's, because ac-render is what
// actually lays the panes out here.
const _PANE_DEFAULT_H = { price: 420, volume: 90, hm: 130 };
if (typeof PANE_HEIGHT_KEY !== 'undefined') {
  Object.keys(PANE_HEIGHT_KEY).forEach(k => {
    const hKey = PANE_HEIGHT_KEY[k];
    if (_PANE_DEFAULT_H[hKey] == null) _PANE_DEFAULT_H[hKey] = 120;
  });
}

function paneHKeyOf(displayKey) {
  if (typeof PANE_HEIGHT_KEY !== 'undefined' && PANE_HEIGHT_KEY[displayKey]) return PANE_HEIGHT_KEY[displayKey];
  return ({ MACD: 'macd', RSI: 'rsi', 'Hilega-Milega': 'hm' })[displayKey] || displayKey;
}

function displayKeyOf(hKey) {
  if (typeof PANE_HEIGHT_KEY === 'undefined') return hKey;
  return Object.keys(PANE_HEIGHT_KEY).find(k => PANE_HEIGHT_KEY[k] === hKey) || hKey;
}

function paneIsMaximized(hKey) {
  const ac = window.ACChart;
  return !!(hKey && ac && typeof ac.maximizedPane === 'function' && ac.maximizedPane() === hKey);
}

function setPaneHeight(hKey, px) {
  if (typeof paneHeights === 'undefined' || !hKey) return;
  paneHeights[hKey] = px;
  if (typeof saveACPaneHeights === 'function') saveACPaneHeights();
}

function _setSubPaneCollapsed(key, collapsed) {
  if (typeof collapsedPanes === 'undefined') return;
  const hKey             = paneHKeyOf(key);
  const alreadyCollapsed = collapsedPanes.includes(key);
  if (collapsed && !alreadyCollapsed) {
    collapsedPanes.push(key);
    setPaneHeight(hKey, _PANE_DEFAULT_H[hKey] || 120);   // reset height on collapse
  } else if (!collapsed && alreadyCollapsed) {
    collapsedPanes = collapsedPanes.filter(k => k !== key);
  }
  if (typeof saveCollapsedPanes === 'function') saveCollapsedPanes();
}

function _deleteSubPaneIndicator(key) {
  const hKey = paneHKeyOf(key);

  // Generic-framework sub-panes (indicators/subpane-framework.js) are owned by
  // indicator INSTANCES: dropping the pane without dropping its instances would
  // leave orphan pills in the instance bar that can never redraw, because
  // _registerSubPaneIfNeeded only re-adds the pane when a NEW instance is
  // created. MACD/RSI/Hilega-Milega are not instance-backed, so they skip this.
  if (typeof INDICATOR_DEFS !== 'undefined' && typeof indicatorInstances !== 'undefined'
      && typeof removeIndicatorInstance === 'function') {
    indicatorInstances
      .filter(inst => {
        const def = INDICATOR_DEFS[inst.typeId];
        return def && def.isSubPane && def.paneKey === key;
      })
      .map(inst => inst.id)
      .forEach(id => removeIndicatorInstance(id));
  }

  if (typeof enabledIndicators !== 'undefined') {
    enabledIndicators = enabledIndicators.filter(k => k !== key);
    if (typeof saveEnabledIndicators === 'function') saveEnabledIndicators();
  }
  if (typeof collapsedPanes !== 'undefined') {
    collapsedPanes = collapsedPanes.filter(k => k !== key);
    if (typeof saveCollapsedPanes === 'function') saveCollapsedPanes();
  }
  setPaneHeight(hKey, _PANE_DEFAULT_H[hKey] || 120);
}

// Called from the instance bar's eye icon on MACD / RSI / Hilega-Milega pills.
function _toggleSubPaneVisibility(key) {
  const collapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(key);
  _setSubPaneCollapsed(key, !collapsed);
  drawChart();
  if (typeof renderChartLegend === 'function') renderChartLegend();
  refreshInstanceBar();
}


/* ════════════════════════════════════════════════════════════
   6. PANE CONTROLS OVERLAY
   Floating toolbar shown on hover over a sub-pane: move up/down,
   collapse, maximize, delete. Positions itself from _lastRender's
   subPanes[] (ac-render synthesises those from the real LWC panes).
   ════════════════════════════════════════════════════════════ */

let _hoveredSubPane = null;
let _paneCtrlTimer  = null;

function subPaneAtY(containerY) {
  const r = window._lastRender;
  if (!r || !r.subPanes) return null;
  return r.subPanes.find(p => containerY >= p.y && containerY < p.y + p.h) || null;
}

function showPaneControlsFor(pane) {
  const bar = $('paneControlsBar');
  const chartEl = acContainer();
  if (!bar || !pane || !chartEl) return;

  cancelPaneCtrlHide();
  _hoveredSubPane = pane.key;

  const host          = hoverRoot() || chartEl.parentElement;
  const chartRect     = chartEl.getBoundingClientRect();
  const hostRect      = host.getBoundingClientRect();
  const paneTopInHost = (chartRect.top - hostRect.top) + pane.y;

  bar.style.display = 'flex';
  bar.style.top     = Math.max(paneTopInHost + 5, 0) + 'px';
  bar.style.right   = '50px';   // clear of the price-axis labels

  const order  = (typeof paneOrder !== 'undefined') ? paneOrder : [];
  const on     = (typeof enabledIndicators !== 'undefined') ? enabledIndicators : [];
  const active = order.filter(k => on.includes(k));
  const idx    = active.indexOf(pane.key);

  const upBtn   = bar.querySelector('.pcb-up');
  const downBtn = bar.querySelector('.pcb-down');
  if (upBtn)   upBtn.disabled   = idx <= 0;
  if (downBtn) downBtn.disabled = idx >= active.length - 1;

  const isCollapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(pane.key);
  const colBtn = bar.querySelector('.pcb-collapse');
  if (colBtn) {
    colBtn.title = isCollapsed ? 'Expand pane' : 'Collapse pane';
    const ic = colBtn.querySelector('.pcb-icon-collapse');
    const ie = colBtn.querySelector('.pcb-icon-expand');
    if (ic) ic.style.display = isCollapsed ? 'none' : '';
    if (ie) ie.style.display = isCollapsed ? ''     : 'none';
  }

  const hKey   = paneHKeyOf(pane.key);

  // Volume has nothing to configure, and a sub-pane whose instances have all
  // been removed has nothing left to point at — hide the button rather than
  // offer one that does nothing.
  const setBtn = bar.querySelector('.pcb-settings');
  if (setBtn) {
    const has = (typeof window.acPaneHasSettings === 'function')
      ? window.acPaneHasSettings(hKey || pane.key)
      : false;
    setBtn.style.display = has ? '' : 'none';
  }

  const isMax  = paneIsMaximized(hKey);
  const maxBtn = bar.querySelector('.pcb-maximize');
  if (maxBtn) {
    maxBtn.title = isMax ? 'Restore pane' : 'Maximize pane';
    const im = maxBtn.querySelector('.pcb-icon-max');
    const ir = maxBtn.querySelector('.pcb-icon-restore');
    if (im) im.style.display = isMax ? 'none' : '';
    if (ir) ir.style.display = isMax ? ''     : 'none';
  }
}

// Kept on the candlestick page's (x, y) signature. y is relative to the
// Lightweight Charts container, which is the space _lastRender.subPanes uses.
function _updatePaneControlsBar(containerX, containerY) {
  const pane = subPaneAtY(containerY);
  if (!pane) { _schedulePaneCtrlHide(); return; }
  showPaneControlsFor(pane);
}

// After an action the pane has moved/resized, so re-place the bar from the
// remembered key rather than re-probing a stale cursor position.
function repositionPaneControlsBar() {
  if (!_hoveredSubPane) return;
  const r = window._lastRender;
  const pane = r && r.subPanes && r.subPanes.find(p => p.key === _hoveredSubPane);
  if (pane) showPaneControlsFor(pane);
  else hidePaneControlsBar();
}

function hidePaneControlsBar() {
  const bar = $('paneControlsBar');
  if (bar) bar.style.display = 'none';
  _hoveredSubPane = null;
}

function _schedulePaneCtrlHide() {
  if (_paneCtrlTimer) return;
  _paneCtrlTimer = setTimeout(() => { _paneCtrlTimer = null; hidePaneControlsBar(); }, 350);
}

function cancelPaneCtrlHide() {
  if (_paneCtrlTimer) { clearTimeout(_paneCtrlTimer); _paneCtrlTimer = null; }
}

// ac-render reconciles panes from enabledIndicators / paneOrder /
// collapsedPanes on every drawChart(), so each branch just mutates those.
function paneCtrlAction(action) {
  const key = _hoveredSubPane;
  if (!key) return;

  const hKey      = paneHKeyOf(key);
  const order     = (typeof paneOrder !== 'undefined') ? paneOrder : [];
  const on        = (typeof enabledIndicators !== 'undefined') ? enabledIndicators : [];
  const active    = order.filter(k => on.includes(k));
  const activeIdx = active.indexOf(key);

  const _ac = window.ACChart;
  if (action !== 'maximize' && _ac && typeof _ac.maximizedPane === 'function' && _ac.maximizedPane()) {
    _ac.setMaximizedPane(null);
  }

  if (action === 'up' || action === 'down') {
    if (action === 'up'   && activeIdx <= 0) return;
    if (action === 'down' && activeIdx >= active.length - 1) return;
    const neighbour = action === 'up' ? active[activeIdx - 1] : active[activeIdx + 1];
    const i = order.indexOf(key);
    const j = order.indexOf(neighbour);
    [paneOrder[i], paneOrder[j]] = [paneOrder[j], paneOrder[i]];
    if (typeof savePaneOrder === 'function') savePaneOrder();

  } else if (action === 'delete') {
    _deleteSubPaneIndicator(key);
    hidePaneControlsBar();
    refreshInstanceBar();

  } else if (action === 'collapse') {
    const isCollapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(key);
    _setSubPaneCollapsed(key, !isCollapsed);
    refreshInstanceBar();

  } else if (action === 'settings') {
    if (typeof window.acOpenPaneSettings === 'function') window.acOpenPaneSettings(hKey || key);
    return;   // opening a modal must not redraw or move the controls bar

  } else if (action === 'maximize') {
    // Maximize means "show this pane alone", not "make this pane taller".
    // Enlarging it only squeezed every other pane, because ac-render.js sizes
    // panes by proportional stretch factor — so hand the decision to the
    // renderer, which drops the other panes for the duration and puts them
    // back, at their own heights, on restore.
    const ac = window.ACChart;
    if (!ac || typeof ac.setMaximizedPane !== 'function') return;
    if (paneIsMaximized(hKey)) {
      ac.setMaximizedPane(null);
    } else {
      if (typeof collapsedPanes !== 'undefined' && collapsedPanes.includes(key)) {
        collapsedPanes = collapsedPanes.filter(k => k !== key);
        if (typeof saveCollapsedPanes === 'function') saveCollapsedPanes();
      }
      ac.setMaximizedPane(hKey);
    }
  }

  drawChart();
  if (typeof renderChartLegend === 'function') renderChartLegend();
  setTimeout(repositionPaneControlsBar, 60);
}


/* ════════════════════════════════════════════════════════════
   7. ZOOM / PAN / RESET  (Lightweight Charts scales, not the old
      zoomLevel / panOffset arithmetic)
   ════════════════════════════════════════════════════════════ */

const MIN_VISIBLE_BARS = 6;

function timeScale() {
  const c = acChart();
  return c ? c.timeScale() : null;
}

// The price pane's own right-hand scale. IPaneApi.priceScale() is v5-only;
// IChartApi.priceScale(id, paneIndex) is the fallback.
function pricePaneScale() {
  const c = acChart();
  if (!c) return null;
  const idx = (window.ACChart.paneIndex('price') >= 0) ? window.ACChart.paneIndex('price') : 0;
  try {
    const pane = c.panes()[idx];
    if (pane && typeof pane.priceScale === 'function') return pane.priceScale('right');
  } catch (e) { /* fall through */ }
  try { return c.priceScale('right', idx); } catch (e) { return null; }
}

function zoomBy(factor) {
  const ts = timeScale();
  if (!ts) return;
  const r = ts.getVisibleLogicalRange();
  if (!r) return;

  const total  = (window.ACChart.displayData() || []).length || 1;
  const center = (r.from + r.to) / 2;
  const span   = Math.max(1e-6, r.to - r.from);
  const want   = Math.min(Math.max(span * factor, MIN_VISIBLE_BARS), total * 3);
  const half   = want / 2;
  ts.setVisibleLogicalRange({ from: center - half, to: center + half });
  refreshGeometry();
}

function zoomIn()  { zoomBy(0.8);  }
function zoomOut() { zoomBy(1.25); }

// Vertical zoom expands/compresses the price pane's visible price range
// around its midpoint. Reading the range from _lastRender as a fallback
// keeps it working even before the scale has been pinned once.
function vZoomBy(factor) {
  const ps = pricePaneScale();
  if (!ps) return;

  let range = null;
  try { range = ps.getVisibleRange(); } catch (e) { range = null; }
  if (!range && window._lastRender && window._lastRender.priceRange) {
    const pr = window._lastRender.priceRange;
    range = { from: pr.minPrice, to: pr.maxPrice };
  }
  if (!range || !isFinite(range.from) || !isFinite(range.to) || range.to === range.from) return;

  const mid  = (range.from + range.to) / 2;
  const half = Math.abs(range.to - range.from) / 2 * factor;
  if (!isFinite(half) || half <= 0) return;

  try {
    ps.setAutoScale(false);
    ps.setVisibleRange({ from: mid - half, to: mid + half });
  } catch (e) {
    // Older/standalone builds without setVisibleRange: fall back to padding
    // the scale margins, which produces the same visual effect with autoscale on.
    const margin = Math.min(0.45, Math.max(0, (factor > 1 ? 0.12 : 0.02)));
    try { ps.applyOptions({ scaleMargins: { top: margin, bottom: margin } }); } catch (e2) { /* give up */ }
  }
  refreshGeometry();
}

function vZoomIn()  { vZoomBy(0.8);  }
function vZoomOut() { vZoomBy(1.25); }

function panBy(bars) {
  const ts = timeScale();
  if (!ts) return;
  const r = ts.getVisibleLogicalRange();
  if (!r) return;
  ts.setVisibleLogicalRange({ from: r.from + bars, to: r.to + bars });
  refreshGeometry();
}

function resetView() {
  // The legacy globals are still read by a few shared modules, so keep them
  // in a sane state even though nothing on this page renders from them.
  if (typeof zoomLevel   !== 'undefined') zoomLevel   = 1;
  if (typeof vZoomLevel  !== 'undefined') vZoomLevel  = 1;
  if (typeof panOffset   !== 'undefined') panOffset   = 0;
  if (typeof priceOffset !== 'undefined') priceOffset = 0;
  if (typeof paneVZoom   !== 'undefined') paneVZoom   = { volume: 1, macd: 1, rsi: 1, hm: 1 };

  // A maximized pane is a view state like zoom, so Reset view drops it too —
  // otherwise "reset" leaves you looking at a single pane with no obvious
  // way back other than finding the restore button again.
  const ac = window.ACChart;
  if (ac && typeof ac.maximizedPane === 'function' && ac.maximizedPane()) ac.setMaximizedPane(null);

  // Pane heights are view state as well: they persist across reloads once a
  // separator has been dragged, so without this "Reset view" would leave the
  // panes at whatever sizes they had drifted to.
  if (typeof resetACPaneHeights === 'function') resetACPaneHeights();
  if (ac && typeof ac.applyPaneHeights === 'function') ac.applyPaneHeights();

  const ps = pricePaneScale();
  if (ps) { try { ps.setAutoScale(true); } catch (e) { /* non-fatal */ } }
  const ts = timeScale();
  if (ts) ts.fitContent();
  refreshGeometry();
}


/* ════════════════════════════════════════════════════════════
   8. DOWNLOAD  /  FULLSCREEN
   ════════════════════════════════════════════════════════════ */

// chart.takeScreenshot() only knows about the Lightweight Charts canvases —
// the user's drawings live on the #candleCanvas overlay above them, so the
// two get composited before the PNG is handed over.
function downloadChart() {
  const c = acChart();
  if (!c) return;

  let shot;
  try { shot = c.takeScreenshot(true, false); } catch (e) { shot = null; }
  if (!shot) { try { shot = c.takeScreenshot(); } catch (e) { return; } }
  if (!shot) return;

  const out = document.createElement('canvas');
  out.width  = shot.width;
  out.height = shot.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(shot, 0, 0);

  const overlay = acOverlay();
  const chartEl = acContainer();
  if (overlay && overlay.width && chartEl) {
    // The overlay covers the chart container exactly, so it maps onto the
    // screenshot 1:1 in CSS space; drawImage rescales the DPR difference.
    try { ctx.drawImage(overlay, 0, 0, out.width, out.height); } catch (e) { /* tainted? skip */ }
  }

  let href;
  try {
    href = out.toDataURL('image/png');
  } catch (e) {
    // A cross-origin image painted onto the overlay taints the composite —
    // fall back to the chart-only screenshot rather than failing the download.
    console.warn('[AC] overlay tainted the screenshot, saving chart only', e);
    href = shot.toDataURL('image/png');
  }

  const link = document.createElement('a');
  link.href     = href;
  link.download = `${symbolCode()}-advanced-chart.png`;
  link.click();
}

// Targets .main-container (toolbar + chart + info cards) so the controls
// stay reachable in fullscreen, exactly like the candlestick page.
function toggleFullscreen() {
  const target = document.querySelector('.main-container') || document.documentElement;
  if (!document.fullscreenElement) {
    const req = target.requestFullscreen || target.webkitRequestFullscreen || target.msRequestFullscreen;
    if (req) req.call(target);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
}

// Keeps the toolbar icon honest even when the user leaves fullscreen with
// Esc, which never runs the button's own handler.
function syncFullscreenIcon() {
  const btn = $('fullscreenBtn');
  if (btn) {
    const isFs      = !!document.fullscreenElement;
    const enterIcon = btn.querySelector('.fs-icon-enter');
    const exitIcon  = btn.querySelector('.fs-icon-exit');
    if (enterIcon) enterIcon.style.display = isFs ? 'none'  : 'block';
    if (exitIcon)  exitIcon.style.display  = isFs ? 'block' : 'none';
    btn.title = isFs ? 'Exit fullscreen' : 'Fullscreen';
  }
  // autoSize handles the chart itself, but the overlay canvas is ours to
  // re-measure once the fullscreen layout transition has settled.
  setTimeout(() => { drawChart(); }, 60);
}


/* ════════════════════════════════════════════════════════════
   9. PANE HEIGHT MIRRORING
   layout.panes.enableResize is on, so Lightweight Charts drags the
   separators itself. There is no pane-resize event in v5, so the real
   heights are read back around a pointer gesture and mirrored into
   ac-render.js's paneHeights (which applyPaneHeights() would otherwise
   overwrite on the next drawChart()).
   ════════════════════════════════════════════════════════════ */

let _paneHeightSnapshot = null;

function readPaneHeights() {
  const c = acChart();
  if (!c) return null;
  const keys  = window.ACChart.paneKeys();
  const panes = c.panes();
  const out   = {};
  keys.forEach((k, i) => {
    const p = panes[i];
    if (p && typeof p.getHeight === 'function') out[k] = Math.round(p.getHeight());
  });
  return out;
}

// Only writes back keys that actually moved since the gesture started, so a
// plain pan/click (or LWC's own proportional re-layout on a window resize)
// never drifts the persisted heights.
function mirrorPaneHeights() {
  if (typeof paneHeights === 'undefined' || !_paneHeightSnapshot) return false;
  const now = readPaneHeights();
  if (!now) return false;

  const collapsed = (typeof collapsedPanes !== 'undefined') ? collapsedPanes : [];
  let changed = false;
  Object.keys(now).forEach(k => {
    const before = _paneHeightSnapshot[k];
    if (before == null) return;
    if (collapsed.includes(k) || collapsed.includes(displayKeyOf(k))) return;  // collapsed height is fixed
    const h = now[k];
    if (!(h > 8)) return;
    if (Math.abs(h - before) < 2) return;
    if (paneHeights[k] !== h) { paneHeights[k] = h; changed = true; }
  });
  return changed;
}


/* ════════════════════════════════════════════════════════════
   10. INTERACTIONS
   Lightweight Charts owns pan, zoom, crosshair, touch and the pane
   separators. What is left for us: the hover legend bridge, the
   pane-control bar, the pane-height mirror and a debounced resize.
   ════════════════════════════════════════════════════════════ */

let _globalsBound   = false;
let _chartHooksDone = false;
let _lastPointerType = 'mouse';
let _hoverRAF = null;

function onHoverMove(clientX, clientY) {
  if (typeof updateLegendHover === 'function') updateLegendHover(clientX, clientY);
  const chartEl = acContainer();
  if (chartEl) {
    const rect = chartEl.getBoundingClientRect();
    _updatePaneControlsBar(clientX - rect.left, clientY - rect.top);
  }
}

function bindChartHooks() {
  if (_chartHooksDone) return;
  const c = acChart();
  if (!c) return;
  _chartHooksDone = true;

  // Touch devices never fire mousemove; the crosshair subscription is the
  // only way the hover legend can follow a finger. Mouse moves are handled
  // by the DOM listener below, so this deliberately ignores them rather
  // than rendering the legend twice per pointer move.
  if (typeof c.subscribeCrosshairMove === 'function') {
    c.subscribeCrosshairMove(param => {
      if (_lastPointerType !== 'touch') return;
      const chartEl = acContainer();
      if (!chartEl) return;
      if (!param || !param.point) {
        if (typeof clearLegendHover === 'function') clearLegendHover();
        return;
      }
      const rect = chartEl.getBoundingClientRect();
      if (typeof updateLegendHover === 'function') {
        updateLegendHover(rect.left + param.point.x, rect.top + param.point.y);
      }
    });
  }
}

function bindGlobals() {
  if (_globalsBound) return;
  _globalsBound = true;

  // ── Debounced resize ────────────────────────────────────────
  // candlestick-ui.js:1330 redrew on every resize event; the UI/UX audit
  // (docs/ui-ux-guide/src/02-candlestick-chart.md) flags that. LWC's autoSize
  // already keeps the canvases correct during the drag — this settles the
  // indicator/overlay geometry once the user stops.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = null; drawChart(); }, 200);
  });

  // ── Pane-height mirroring around any pointer gesture ────────
  window.addEventListener('pointerdown', () => { _paneHeightSnapshot = readPaneHeights(); }, true);
  window.addEventListener('pointerup', () => {
    if (!_paneHeightSnapshot) return;
    // Let Lightweight Charts finish applying the drag before reading back.
    setTimeout(() => {
      if (mirrorPaneHeights()) {
        if (typeof saveACPaneHeights === 'function') saveACPaneHeights();
        refreshGeometry();
        repositionPaneControlsBar();
      }
      _paneHeightSnapshot = null;
    }, 60);
  }, true);

  document.addEventListener('fullscreenchange',      syncFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', syncFullscreenIcon);
  document.addEventListener('MSFullscreenChange',     syncFullscreenIcon);

  setupChartKeyboardShortcuts();
  setupMenuKeyboardNav();
}

let _bindRetries = 0;

function setupChartInteractions() {
  bindGlobals();
  bindChartHooks();

  const root = hoverRoot();

  // The chart (and often the container itself) may not exist yet —
  // processChartData() can finish before ac-boot.js has created it — so keep
  // retrying briefly until both the DOM host and the chart are there.
  if ((!root || !_chartHooksDone) && _bindRetries < 100) {
    _bindRetries++;
    setTimeout(setupChartInteractions, 200);
  }

  if (!root || root._acInteractionsBound) return;
  root._acInteractionsBound = true;

  root.addEventListener('pointerdown', e => { _lastPointerType = e.pointerType || 'mouse'; });
  root.addEventListener('pointermove', e => { _lastPointerType = e.pointerType || 'mouse'; }, { passive: true });

  root.addEventListener('mousemove', e => {
    const x = e.clientX, y = e.clientY;
    // Mirror mid-drag so an interleaved drawChart() cannot snap a separator
    // the user is still dragging back to its stored height.
    if (e.buttons & 1) mirrorPaneHeights();
    if (_hoverRAF) return;
    _hoverRAF = requestAnimationFrame(() => { _hoverRAF = null; onHoverMove(x, y); });
  });

  root.addEventListener('mouseleave', () => {
    if (typeof clearLegendHover === 'function') clearLegendHover();
    _schedulePaneCtrlHide();
  });

  // Keeps the hover legend live while a finger is on the chart.
  root.addEventListener('touchend', () => {
    if (typeof clearLegendHover === 'function') clearLegendHover();
  }, { passive: true });
}


/* ════════════════════════════════════════════════════════════
   11. KEYBOARD  —  chart shortcuts + menu navigation
   The audit calls out that #tvTfMenu and #chartTypeMenu are mouse-only
   (no role="menu"/"menuitem", no arrow keys). Both are fixed here.
   ════════════════════════════════════════════════════════════ */

const MODAL_IDS = ['indicatorsModal', 'renkoSettingsModal', 'indicatorSettingsModal', 'macdSettingsModal'];

function modalIsOpen(id) {
  const el = $(id);
  return !!el && el.style.display !== 'none' && el.style.display !== '';
}

function anyModalOpen() {
  return MODAL_IDS.some(modalIsOpen);
}

// Escape closes exactly one thing, innermost first. The settings modals are
// owned by other files, so they are closed through their own public function
// wherever one exists.
function closeTopmostOverlay() {
  const chartMenu = $('chartTypeMenu');
  if (menuIsOpen(chartMenu)) { closeChartTypeMenu(); return true; }

  const tfMenu = $('tvTfMenu');
  if (menuIsOpen(tfMenu)) {
    tfMenu.style.display = 'none';
    setMenuExpanded('tvTfTrigger', false);
    return true;
  }

  if (modalIsOpen('indicatorSettingsModal')) {
    if (typeof closeIndicatorSettings === 'function') closeIndicatorSettings();
    else $('indicatorSettingsModal').style.display = 'none';
    return true;
  }
  if (modalIsOpen('macdSettingsModal')) {
    if (typeof closeMACDSettings === 'function') closeMACDSettings();
    else $('macdSettingsModal').style.display = 'none';
    return true;
  }
  if (modalIsOpen('renkoSettingsModal')) { closeRenkoSettings(); return true; }
  if (modalIsOpen('indicatorsModal'))    { closeIndicatorsModal(); return true; }
  return false;
}

function setupChartKeyboardShortcuts() {
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeTopmostOverlay(); return; }
    if (isTypingTarget(e.target)) return;
    if (anyModalOpen()) return;
    if (e.metaKey || e.ctrlKey) return;

    const replaying = (typeof replayMode !== 'undefined') && replayMode;

    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault(); zoomIn(); break;
      case '-':
      case '_':
        e.preventDefault(); zoomOut(); break;
      case 'ArrowUp':
        if (!e.altKey) return;
        e.preventDefault(); vZoomIn(); break;
      case 'ArrowDown':
        if (!e.altKey) return;
        e.preventDefault(); vZoomOut(); break;
      case 'ArrowLeft':
        if (replaying) return;            // replay owns the arrows while active
        e.preventDefault(); panBy(-(e.shiftKey ? 10 : 1)); break;
      case 'ArrowRight':
        if (replaying) return;
        e.preventDefault(); panBy(e.shiftKey ? 10 : 1); break;
      case 'Home': {
        if (replaying) return;
        const ts = timeScale();
        if (ts) { ts.scrollToPosition(-((window.ACChart.displayData() || []).length), false); refreshGeometry(); }
        e.preventDefault();
        break;
      }
      case 'End': {
        if (replaying) return;
        const ts = timeScale();
        if (ts) { ts.scrollToRealTime(); refreshGeometry(); }
        e.preventDefault();
        break;
      }
      case '0':
        e.preventDefault(); resetView(); break;
      default:
        // Alt-chords: R reset, F fullscreen, I indicators. Alt keeps them
        // clear of the drawing-tool and replay shortcuts.
        if (!e.altKey) return;
        if (e.code === 'KeyR') { e.preventDefault(); resetView(); }
        else if (e.code === 'KeyF') { e.preventDefault(); toggleFullscreen(); }
        else if (e.code === 'KeyI') { e.preventDefault(); openIndicatorsModal(); }
    }
  });
}

// ── role="menu" + arrow-key navigation for the toolbar dropdowns ──
// Roles go on every button (even while the menu is display:none, where an
// offsetParent test would see nothing); focus only ever moves between the
// ones that are actually visible and enabled.
function allMenuButtons(menu) {
  return Array.from(menu.querySelectorAll('button'));
}

function menuItems(menu) {
  return allMenuButtons(menu).filter(b => !b.disabled && b.offsetParent !== null);
}

function markMenuItems(menu, itemRole) {
  allMenuButtons(menu).forEach(item => {
    item.setAttribute('role', itemRole);
    item.tabIndex = -1;
    if (itemRole === 'menuitemradio') item.setAttribute('aria-checked', item.classList.contains('active') ? 'true' : 'false');
  });
}

function focusMenuItem(menu, delta, absolute) {
  const items = menuItems(menu);
  if (!items.length) return;
  let idx;
  if (absolute === 'first') idx = 0;
  else if (absolute === 'last') idx = items.length - 1;
  else {
    const cur = items.indexOf(document.activeElement);
    idx = cur < 0 ? 0 : (cur + delta + items.length) % items.length;
  }
  items[idx].focus({ preventScroll: true });
}

function enhanceMenu(menuId, triggerId, itemRole, closeFn) {
  const menu    = $(menuId);
  const trigger = triggerId ? $(triggerId) : null;
  if (!menu || menu._acMenuReady) return;
  menu._acMenuReady = true;

  menu.setAttribute('role', 'menu');
  markMenuItems(menu, itemRole);

  if (trigger) {
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', menuIsOpen(menu) ? 'true' : 'false');
    trigger.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!menuIsOpen(menu)) trigger.click();           // the inline onclick opens it
        setTimeout(() => focusMenuItem(menu, 0, e.key === 'ArrowUp' ? 'last' : 'first'), 0);
      }
    });
  }

  menu.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusMenuItem(menu,  1); break;
      case 'ArrowUp':   e.preventDefault(); focusMenuItem(menu, -1); break;
      case 'Home':      e.preventDefault(); focusMenuItem(menu, 0, 'first'); break;
      case 'End':       e.preventDefault(); focusMenuItem(menu, 0, 'last');  break;
      case 'Tab':
      case 'Escape':
        if (e.key === 'Escape') e.preventDefault();
        if (closeFn) closeFn(); else menu.style.display = 'none';
        if (trigger) trigger.focus();
        break;
      default: break;
    }
  });

  // The menus are toggled by inline style from several places (here, and
  // _syncTimeframeButtonUI in the unmodified candlestick-data.js), so the
  // open/close moment is observed rather than hooked.
  const obs = new MutationObserver(() => {
    const open = menuIsOpen(menu);
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    markMenuItems(menu, itemRole);
    const active = menu.querySelector('button.active');
    setTimeout(() => {
      const target = active || menuItems(menu)[0];
      if (target) target.focus({ preventScroll: true });
    }, 0);
  });
  obs.observe(menu, { attributes: true, attributeFilter: ['style', 'class'] });
}

function setupMenuKeyboardNav() {
  enhanceMenu('chartTypeMenu', 'chartTypeBtn',  'menuitemradio', closeChartTypeMenu);
  enhanceMenu('tvTfMenu',      'tvTfTrigger',   'menuitemradio', null);
}


/* ════════════════════════════════════════════════════════════
   12. INIT
   ac-boot.js owns the real init sequence (loadData etc.); this only
   brings the toolbar's own surfaces up to date and is idempotent, so
   calling it twice is harmless.
   ════════════════════════════════════════════════════════════ */

function initUI() {
  syncToolbarUIWithRestoredPrefs();
  refreshInstanceBar();
  bindGlobals();
  syncFullscreenIcon();
  setupChartInteractions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}


/* ════════════════════════════════════════════════════════════
   EXPORTS
   Everything the ported markup calls via inline onclick, everything
   the shared candlestick modules call as a bare identifier, and the
   two ac-render.js stubs this file replaces.
   ════════════════════════════════════════════════════════════ */

// chart type
window.setChartType         = setChartType;
window.toggleChartTypeMenu  = toggleChartTypeMenu;
window.closeChartTypeMenuOnClickOutside = closeChartTypeMenuOnClickOutside;
window.toggleHeikinAshi     = toggleHeikinAshi;
window.syncToolbarUIWithRestoredPrefs = syncToolbarUIWithRestoredPrefs;
window.toggleMA             = toggleMA;

// renko settings modal
window.openRenkoSettings    = openRenkoSettings;
window.closeRenkoSettings   = closeRenkoSettings;
window.applyRenkoSettings   = applyRenkoSettings;
window.resetRenkoSettings   = resetRenkoSettings;
window.renkoMethodChanged   = renkoMethodChanged;
window._rsSwatchClick       = _rsSwatchClick;
window._rsPopulateForm      = _rsPopulateForm;

// indicators modal
window.openIndicatorsModal  = openIndicatorsModal;
window.closeIndicatorsModal = closeIndicatorsModal;
window.filterIndicators     = filterIndicators;
window.populateIndicatorList = populateIndicatorList;
window.addIndicator         = addIndicator;
window.removeIndicator      = removeIndicator;
window.getIndicatorKey      = getIndicatorKey;
window.MODAL_TO_INSTANCE_TYPE = MODAL_TO_INSTANCE_TYPE;

// sub-pane state (indicator-settings-modal.js calls these by bare name)
window._setSubPaneCollapsed    = _setSubPaneCollapsed;
window._deleteSubPaneIndicator = _deleteSubPaneIndicator;
window._toggleSubPaneVisibility = _toggleSubPaneVisibility;
window._PANE_DEFAULT_H         = _PANE_DEFAULT_H;
window.paneIsMaximized         = paneIsMaximized;

// pane controls overlay
window.paneCtrlAction         = paneCtrlAction;
window._updatePaneControlsBar = _updatePaneControlsBar;
window._schedulePaneCtrlHide  = _schedulePaneCtrlHide;
window._cancelPaneCtrlHide    = cancelPaneCtrlHide;

// zoom / pan / view
window.zoomIn     = zoomIn;
window.zoomOut    = zoomOut;
window.vZoomIn    = vZoomIn;
window.vZoomOut   = vZoomOut;
window.resetView  = resetView;
window.acPanBy    = panBy;

// actions
window.downloadChart    = downloadChart;
window.toggleFullscreen = toggleFullscreen;

// the two ac-render.js stubs, and the init hook for ac-boot.js
window.updateInfoCards        = updateInfoCards;
window.setupChartInteractions = setupChartInteractions;
window.acInitUI               = initUI;
window.acRefreshInstanceBar   = refreshInstanceBar;

})();
