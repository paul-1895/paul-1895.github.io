/* ════════════════════════════════════════════════════════════
   candlestick-ui.js
   UI wiring: info cards, indicators modal, MA toggle,
   zoom/pan button controls, mouse & touch drag-to-pan,
   mouse-wheel zoom, chart replay, and app initialisation.

   Depends on : candlestick-data.js, candlestick-draw.js
   ════════════════════════════════════════════════════════════ */

// ─── Pane resize drag state ───────────────────────────────────
let _resizing = null;

function _findHandle(canvasY) {
  const HIT = HANDLE_H + 4;
  return (_paneHandles || []).find(h => Math.abs(h.y - canvasY) <= HIT) || null;
}

// ─── Chart type menu toggle ───────────────────────────────────
function toggleChartTypeMenu() {
  const menu = document.getElementById('chartTypeMenu');
  const btn  = document.getElementById('chartTypeBtn');
  if (!menu || !btn) return;
  const isHidden = menu.style.display === 'none';
  if (isHidden) {
    const rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top  = (rect.bottom + 6) + 'px';
    menu.style.display = 'block';
    document.addEventListener('click', closeChartTypeMenuOnClickOutside);
  } else {
    menu.style.display = 'none';
    document.removeEventListener('click', closeChartTypeMenuOnClickOutside);
  }
}

function closeChartTypeMenuOnClickOutside(e) {
  const menu = document.getElementById('chartTypeMenu');
  const btn  = document.getElementById('chartTypeBtn');
  if (!menu || !btn) return;
  if (!menu.contains(e.target) && !btn.contains(e.target)) {
    menu.style.display = 'none';
    document.removeEventListener('click', closeChartTypeMenuOnClickOutside);
  }
}

function setChartType(type) {
  chartType = type;
  if (typeof saveChartType === 'function') saveChartType();
  document.querySelectorAll('.chart-type-option').forEach(opt => opt.classList.remove('active'));
  event.target.closest('.chart-type-option').classList.add('active');
  const menu = document.getElementById('chartTypeMenu');
  if (menu) {
    menu.style.display = 'none';
    document.removeEventListener('click', closeChartTypeMenuOnClickOutside);
  }
  drawChart();
  if (type === 'renko') openRenkoSettings();
}


// ════════════════════════════════════════════════════════════
// RENKO SETTINGS MODAL
// TradingView-style: color picker swatches, opacity, source,
// box size method (ATR / fixed), wicks toggle.
// ════════════════════════════════════════════════════════════

// Active swatch state — tracks which swatch is being edited
let _rsActiveSwatch = null;  // { key, el }

function openRenkoSettings() {
  const modal = document.getElementById('renkoSettingsModal');
  if (!modal) return;
  _rsPopulateForm();
  modal.style.display = 'flex';
}

function closeRenkoSettings() {
  const modal = document.getElementById('renkoSettingsModal');
  if (modal) modal.style.display = 'none';
  ColorPicker.close();
  _rsActiveSwatch = null;
}

// ── Swatch click handler ─────────────────────────────────────
// Each swatch button calls this with its settings key and opacity key
function _rsSwatchClick(el, colorKey, opacityKey) {
  const s       = renkoSettings;
  const hex     = _rsToHex(s[colorKey] || '#26a69a');
  const opacity = s[opacityKey] != null ? s[opacityKey] : 100;

  // Toggle: clicking the active swatch closes the picker
  if (_rsActiveSwatch && _rsActiveSwatch.key === colorKey) {
    ColorPicker.close();
    el.classList.remove('active');
    _rsActiveSwatch = null;
    return;
  }

  // Deactivate previous
  document.querySelectorAll('.rs-swatch-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  _rsActiveSwatch = { key: colorKey, opacityKey, el };

  ColorPicker.open(el, hex, opacity, ({ hex: h, opacity: op, rgba }) => {
    // Update live preview on swatch
    el.querySelector('.rs-swatch-inner').style.background = rgba;
    // Store in pending settings (apply on OK)
    renkoSettings[colorKey]   = h;
    renkoSettings[opacityKey] = op;
    // Rebuild final rgba for draw
    renkoSettings['_rgba_' + colorKey] = rgba;
    // Live-preview the chart
    drawChart();
  });
}

function _rsToHex(colorStr) {
  if (!colorStr) return '#26a69a';
  if (colorStr.startsWith('#')) return colorStr;
  // rgba(r,g,b,a) -> hex
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#26a69a';
  return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
}

function _rsPopulateForm() {
  const s = renkoSettings;

  // Sync method select + visibility
  const methodEl = document.getElementById('rs-method');
  if (methodEl) { methodEl.value = s.method || 'ATR'; _rsToggleMethodUI(s.method || 'ATR'); }
  const atrEl   = document.getElementById('rs-atr-length');
  if (atrEl)   atrEl.value   = s.atrLength    || 14;
  const fixEl   = document.getElementById('rs-fixed-size');
  if (fixEl)   fixEl.value   = s.fixedBoxSize || 1;
  const srcEl   = document.getElementById('rs-source');
  if (srcEl)   srcEl.value   = s.source       || 'Close';
  const wickEl  = document.getElementById('rs-wicks');
  if (wickEl)  wickEl.checked = s.showWicks !== false;

  // Sync swatch inner colors
  const SWATCHES = [
    ['rs-sw-up-fill',   'colorUpBars',        'opacityUpBars'],
    ['rs-sw-up-line',   'colorUpBarsLine',     'opacityUpBarsLine'],
    ['rs-sw-dn-fill',   'colorDownBars',       'opacityDownBars'],
    ['rs-sw-dn-line',   'colorDownBarsLine',   'opacityDownBarsLine'],
    ['rs-sw-pup-fill',  'colorProjUp',         'opacityProjUp'],
    ['rs-sw-pup-line',  'colorProjUpLine',     'opacityProjUpLine'],
    ['rs-sw-pdn-fill',  'colorProjDown',       'opacityProjDown'],
    ['rs-sw-pdn-line',  'colorProjDownLine',   'opacityProjDownLine'],
  ];
  SWATCHES.forEach(([id, cKey, oKey]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const hex = _rsToHex(s[cKey] || '#26a69a');
    const op  = s[oKey] != null ? s[oKey] : 100;
    const rgba = _hexOpToRgba(hex, op);
    btn.querySelector('.rs-swatch-inner').style.background = rgba;
  });
}

function _hexOpToRgba(hex, opacity) {
  const a = (opacity == null ? 100 : opacity) / 100;
  const m = hex.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  if (!m) return hex;
  return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',' + a + ')';
}

function _rsToggleMethodUI(method) {
  const atrRow   = document.getElementById('rs-atr-row');
  const fixedRow = document.getElementById('rs-fixed-row');
  if (atrRow)   atrRow.style.display   = method === 'ATR'   ? 'flex' : 'none';
  if (fixedRow) fixedRow.style.display = method === 'fixed' ? 'flex' : 'none';
}

function renkoMethodChanged() {
  _rsToggleMethodUI(document.getElementById('rs-method').value);
}

function applyRenkoSettings() {
  const get     = id => { const e = document.getElementById(id); return e ? e.value : ''; };
  const checked = id => { const e = document.getElementById(id); return e ? e.checked : false; };

  // Read swatch colors from the live renkoSettings (updated in real-time by picker)
  renkoSettings.method       = get('rs-method');
  renkoSettings.atrLength    = parseInt(get('rs-atr-length'))   || 14;
  renkoSettings.fixedBoxSize = parseFloat(get('rs-fixed-size')) || 1;
  renkoSettings.source       = get('rs-source');
  renkoSettings.showWicks    = checked('rs-wicks');

  // Rebuild rgba strings from current hex + opacity
  const KEYS = [
    ['colorUpBars',       'opacityUpBars'],
    ['colorUpBarsLine',   'opacityUpBarsLine'],
    ['colorDownBars',     'opacityDownBars'],
    ['colorDownBarsLine', 'opacityDownBarsLine'],
  ];
  KEYS.forEach(([cKey, oKey]) => {
    const rgba = _hexOpToRgba(
      renkoSettings[cKey] || '#26a69a',
      renkoSettings[oKey]
    );
    renkoSettings['_rgba_' + cKey] = rgba;
  });

  renkoBoxSize = renkoSettings.fixedBoxSize;
  if (typeof saveRenkoSettings === 'function') saveRenkoSettings();
  closeRenkoSettings();
  drawChart();
}

function resetRenkoSettings() {
  renkoSettings = { ...RENKO_DEFAULTS };
  renkoBoxSize  = renkoSettings.fixedBoxSize;
  if (typeof saveRenkoSettings === 'function') saveRenkoSettings();
  _rsPopulateForm();
  drawChart();
}

function toggleHeikinAshi() {
  const newType = chartType === 'heikinashi' ? 'candlestick' : 'heikinashi';
  setChartType(newType);
}

// ─── Moving Average toggle ────────────────────────────────────
// company.html still ships the legacy MA20/50/200/EMA200 toolbar pills
// (the indicator instance bar in indicator-settings-modal.js is a separate,
// newer surface for the same overlays) and wires them to this function, so
// it has to keep actually toggling `activeMA` — it's not just a no-op shim.
// `btn` is the clicked pill (passed as `this` from the onclick attribute) so
// its `.active` class can be kept in sync with the real toggle state;
// without it the pill's highlight never matched whether the MA was drawn.
function toggleMA(period, btn) {
  if (typeof activeMA === 'undefined') return;
  activeMA[period] = !activeMA[period];
  if (typeof saveActiveMA === 'function') saveActiveMA();
  drawChart();
  if (btn) btn.classList.toggle('active', !!activeMA[period]);
}

// ─── Info cards ───────────────────────────────────────────────
function updateInfoCards() {
  if (chartData.length === 0) return;
  const latest = chartData[chartData.length - 1];
  const oldest = chartData[0];
  let high = -Infinity, low = Infinity;
  chartData.forEach(c => { high = Math.max(high, c.High); low = Math.min(low, c.Low); });
  const change    = latest.Close - oldest.Close;
  const changePct = ((change / oldest.Close) * 100).toFixed(2);
  document.getElementById('currentPrice').textContent = latest.Close.toFixed(2) + ' ৳';
  document.getElementById('highPrice').textContent    = high.toFixed(2) + ' ৳';
  document.getElementById('lowPrice').textContent     = low.toFixed(2) + ' ৳';
  const el = document.getElementById('periodChange');
  el.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + ' (' + changePct + '%)';
  el.className   = 'info-value ' + (change >= 0 ? 'gain' : 'loss');
}

// ─── Indicator key extraction ─────────────────────────────────
function getIndicatorKey(name) {
  const match = name.match(/\(([^)]+)\)$/);
  return match ? match[1] : name;
}

// Indicator names in AVAILABLE_INDICATORS that have a matching
// entry in INDICATOR_DEFS (indicator-instances.js) are now
// multi-instance: clicking "Add" always creates a NEW instance
// (you can add several EMAs at once), shown in the instance bar
// under the toolbar with its own settings modal. Everything else
// (MACD, RSI, Hilega-Milega — sub-pane, single-instance) keeps the
// older enabledIndicators on/off model.
const MODAL_TO_INSTANCE_TYPE = {
  'Moving Average (SMA)':             'SMA',
  'Exponential Moving Average (EMA)': 'EMA',
  'Bollinger Bands':                  'Bollinger Bands',
  'Ichimoku Cloud':                   'Ichimoku Cloud',
  'Supertrend':                       'Supertrend',
};

// ─── Indicators modal ─────────────────────────────────────────
function openIndicatorsModal() {
  document.getElementById('indicatorsModal').style.display = 'flex';
  populateIndicatorList();
}

function closeIndicatorsModal() {
  document.getElementById('indicatorsModal').style.display = 'none';
}

function filterIndicators() {
  const q     = document.getElementById('indicatorSearch').value.toLowerCase();
  const items = document.querySelectorAll('#indicatorList .indicator-item');
  items.forEach(item => {
    item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function populateIndicatorList() {
  const list = document.getElementById('indicatorList');
  list.innerHTML = '';
  AVAILABLE_INDICATORS.forEach(indicator => {
    const typeId = MODAL_TO_INSTANCE_TYPE[indicator.name];
    const key     = getIndicatorKey(indicator.name);
    const isMultiInstance = typeId !== undefined;
    const instanceCount = isMultiInstance
      ? indicatorInstances.filter(inst => inst.typeId === typeId).length
      : 0;
    const isEnabled = isMultiInstance ? instanceCount > 0 : enabledIndicators.includes(key);
    const item      = document.createElement('div');
    item.className  = 'indicator-item';

    // Multi-instance types always show "Add" (clicking it again adds
    // ANOTHER instance, like TradingView) plus a count badge once at
    // least one exists. Single-instance types (MACD/RSI/HM) keep the
    // original Add/Remove toggle pair.
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

    item.innerHTML  = `
      <div class="indicator-name">
        <span>${indicator.name}</span>
        <span>${indicator.category}</span>
      </div>
      ${actionsHtml}`;
    list.appendChild(item);
  });
}

function addIndicator(name, btn) {
  const typeId = MODAL_TO_INSTANCE_TYPE[name];
  if (typeId !== undefined) {
    createIndicatorInstance(typeId);
    renderIndicatorInstanceBar();
    drawChart();
    populateIndicatorList(); // refresh count badge
    return;
  }
  const key = getIndicatorKey(name);
  if (enabledIndicators.includes(key)) return;
  enabledIndicators.push(key);
  if (typeof saveEnabledIndicators === 'function') saveEnabledIndicators();
  const item = btn.closest('.indicator-item');
  item.querySelector('.add-btn').style.display    = 'none';
  item.querySelector('.remove-btn').style.display = 'flex';
  drawChart();
}

function removeIndicator(name, btn) {
  // Multi-instance types are removed individually from the instance
  // bar (trash icon), not from this modal — there's no single
  // "the EMA" to remove once multiple instances can exist. The
  // modal's Add button for these types never shows a Remove button
  // (see populateIndicatorList), so this path is single-instance only.
  const key         = getIndicatorKey(name);
  enabledIndicators = enabledIndicators.filter(i => i !== key);
  if (typeof saveEnabledIndicators === 'function') saveEnabledIndicators();
  const item = btn.closest('.indicator-item');
  item.querySelector('.remove-btn').style.display = 'none';
  item.querySelector('.add-btn').style.display    = 'flex';
  drawChart();
}

// ─── Zoom / pan buttons ───────────────────────────────────────
function zoomIn()   { zoomLevel  = Math.min(zoomLevel  + 0.2, 4);   drawChart(); }
function zoomOut()  { zoomLevel  = Math.max(zoomLevel  - 0.2, 0.3); drawChart(); }
function vZoomIn()  { vZoomLevel = Math.min(vZoomLevel + 0.2, 4);   drawChart(); }
function vZoomOut() { vZoomLevel = Math.max(vZoomLevel - 0.2, 0.3); drawChart(); }

function resetView() {
  zoomLevel  = 1;
  vZoomLevel = 1;
  paneVZoom  = { volume: 1, macd: 1, rsi: 1, hm: 1 };
  panOffset  = 0;
  priceOffset = 0;
  drawChart();
}

function downloadChart() {
  const canvas = document.getElementById('candleCanvas');
  const code   = (chartData[0] && chartData[0].Symbol)
    || (new URLSearchParams(window.location.search).get('code'))
    || 'BPML';
  const link   = document.createElement('a');
  link.href     = canvas.toDataURL('image/png');
  link.download = `${code}-trading-chart.png`;
  link.click();
}

// ─── Fullscreen toggle ────────────────────────────────────────
// Targets .main-container (toolbar + chart + info cards) rather
// than just the canvas, so timeframe/indicator/replay controls
// stay reachable while fullscreen. Falls back to documentElement
// if that wrapper isn't found for some reason.
function toggleFullscreen() {
  const target = document.querySelector('.main-container') || document.documentElement;
  if (!document.fullscreenElement) {
    const req = target.requestFullscreen
      || target.webkitRequestFullscreen   // Safari
      || target.msRequestFullscreen;      // old Edge/IE
    if (req) req.call(target);
  } else {
    const exit = document.exitFullscreen
      || document.webkitExitFullscreen
      || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
}

// Keeps the toolbar icon in sync, including when the user exits via
// Esc (which never touches the button's own click handler at all).
function _syncFullscreenIcon() {
  const btn = document.getElementById('fullscreenBtn');
  if (!btn) return;
  const isFs       = !!document.fullscreenElement;
  const enterIcon  = btn.querySelector('.fs-icon-enter');
  const exitIcon   = btn.querySelector('.fs-icon-exit');
  if (enterIcon) enterIcon.style.display = isFs ? 'none'  : 'block';
  if (exitIcon)  exitIcon.style.display  = isFs ? 'block' : 'none';
  btn.title = isFs ? 'Exit fullscreen' : 'Fullscreen';
  // Canvas width derives from its parent's offsetWidth — re-measure
  // once the browser finishes the fullscreen layout transition.
  setTimeout(() => drawChart(), 50);
}

document.addEventListener('fullscreenchange',       _syncFullscreenIcon);
document.addEventListener('webkitfullscreenchange',  _syncFullscreenIcon);
document.addEventListener('MSFullscreenChange',      _syncFullscreenIcon);

// ════════════════════════════════════════════════════════════
// PANE CONTROLS OVERLAY
// Floating toolbar that appears on hover over each sub-pane
// (MACD / RSI / Hilega-Milega). Buttons: move up, move down,
// delete, collapse, maximize. Hides after a short delay when
// the mouse leaves the pane or canvas.
// ════════════════════════════════════════════════════════════

const _PANE_DEFAULT_H = { macd: 100, rsi: 100, hm: 110 };
let _hoveredSubPane   = null;
let _paneCtrlTimer    = null;

function _getSubPaneAtCanvasY(canvasY) {
  const r = window._lastRender;
  if (!r || !r.subPanes) return null;
  for (const p of r.subPanes) {
    if (canvasY >= p.y && canvasY < p.y + p.h) return p;
  }
  return null;
}

function _updatePaneControlsBar(canvasX, canvasY) {
  const bar = document.getElementById('paneControlsBar');
  if (!bar) return;
  const canvas = document.getElementById('candleCanvas');
  if (!canvas) return;

  const pane = _getSubPaneAtCanvasY(canvasY);
  if (!pane) {
    _schedulePaneCtrlHide();
    return;
  }

  _cancelPaneCtrlHide();
  _hoveredSubPane = pane.key;

  // Position bar relative to .chart-container
  const container = canvas.closest('.chart-container') || canvas.parentElement;
  const canvasRect    = canvas.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const paneTopInContainer = (canvasRect.top - containerRect.top) + pane.y;

  bar.style.display = 'flex';
  bar.style.top     = Math.max(paneTopInContainer + 5, 0) + 'px';
  bar.style.right   = '50px';  // clear of the Y-axis labels

  // Enable/disable up-down based on position in active order
  const _paneOrderSafe = (typeof paneOrder !== 'undefined') ? paneOrder : [];
  const active = _paneOrderSafe.filter(k => enabledIndicators.includes(k));
  const idx    = active.indexOf(pane.key);

  const upBtn   = bar.querySelector('.pcb-up');
  const downBtn = bar.querySelector('.pcb-down');
  if (upBtn)   upBtn.disabled   = idx <= 0;
  if (downBtn) downBtn.disabled = idx >= active.length - 1;

  // Collapse icon swap
  const isCollapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(pane.key);
  const colBtn = bar.querySelector('.pcb-collapse');
  if (colBtn) {
    colBtn.title = isCollapsed ? 'Expand pane' : 'Collapse pane';
    const ic = colBtn.querySelector('.pcb-icon-collapse');
    const ie = colBtn.querySelector('.pcb-icon-expand');
    if (ic) ic.style.display = isCollapsed ? 'none' : '';
    if (ie) ie.style.display = isCollapsed ? ''     : 'none';
  }

  // Maximize icon swap
  const hKey  = (typeof PANE_HEIGHT_KEY !== 'undefined') ? PANE_HEIGHT_KEY[pane.key] : null;
  const isMax = hKey && paneHeights[hKey] >= 200;
  const maxBtn = bar.querySelector('.pcb-maximize');
  if (maxBtn) {
    maxBtn.title = isMax ? 'Restore pane' : 'Maximize pane';
    const im = maxBtn.querySelector('.pcb-icon-max');
    const ir = maxBtn.querySelector('.pcb-icon-restore');
    if (im) im.style.display = isMax ? 'none' : '';
    if (ir) ir.style.display = isMax ? ''     : 'none';
  }
}

function _schedulePaneCtrlHide() {
  if (_paneCtrlTimer) return;
  _paneCtrlTimer = setTimeout(() => {
    _paneCtrlTimer = null;
    const bar = document.getElementById('paneControlsBar');
    if (bar) bar.style.display = 'none';
    _hoveredSubPane = null;
  }, 350);
}

function _cancelPaneCtrlHide() {
  if (_paneCtrlTimer) { clearTimeout(_paneCtrlTimer); _paneCtrlTimer = null; }
}

// ── Shared sub-pane hide/delete logic ───────────────────────────
// Single source of truth for MACD/RSI/Hilega-Milega visibility and removal,
// used by both the hover-triggered pane controls bar below (paneCtrlAction)
// and the Indicator Instance Bar's sub-pane pills (renderIndicatorInstanceBar
// in indicator-settings-modal.js) — the only two places these are exposed.
// (The on-chart legend intentionally does NOT get interactive controls: it's
// rebuilt via innerHTML on every crosshair move, which would destroy and
// recreate any button mid-click. See the comment on _legendIndRow.)
function _setSubPaneCollapsed(key, collapsed) {
  const hKey = (typeof PANE_HEIGHT_KEY !== 'undefined') ? PANE_HEIGHT_KEY[key] : null;
  const alreadyCollapsed = collapsedPanes.includes(key);
  if (collapsed && !alreadyCollapsed) {
    collapsedPanes.push(key);
    if (hKey) paneHeights[hKey] = _PANE_DEFAULT_H[hKey]; // reset height on collapse
  } else if (!collapsed && alreadyCollapsed) {
    collapsedPanes = collapsedPanes.filter(k => k !== key);
  }
  saveCollapsedPanes();
}

function _deleteSubPaneIndicator(key) {
  const hKey = (typeof PANE_HEIGHT_KEY !== 'undefined') ? PANE_HEIGHT_KEY[key] : null;
  enabledIndicators = enabledIndicators.filter(k => k !== key);
  saveEnabledIndicators();
  collapsedPanes = collapsedPanes.filter(k => k !== key);
  saveCollapsedPanes();
  if (hKey) paneHeights[hKey] = _PANE_DEFAULT_H[hKey];
}

// Called from the Indicator Instance Bar's eye icon on MACD/RSI/
// Hilega-Milega pills — same effect as the pane-hover controls bar's
// collapse action, just reachable without hovering the sub-pane itself.
function _toggleSubPaneVisibility(key) {
  _setSubPaneCollapsed(key, !collapsedPanes.includes(key));
  drawChart();
  if (typeof renderChartLegend === 'function') renderChartLegend();
  if (typeof renderIndicatorInstanceBar === 'function') renderIndicatorInstanceBar();
}

// Called by the HTML buttons (onclick="paneCtrlAction('...')")
function paneCtrlAction(action) {
  const key = _hoveredSubPane;
  if (!key) return;

  const _paneHKey = (typeof PANE_HEIGHT_KEY !== 'undefined') ? PANE_HEIGHT_KEY : { 'MACD':'macd','RSI':'rsi','Hilega-Milega':'hm' };
  const hKey      = _paneHKey[key];
  const _orderSafe = (typeof paneOrder !== 'undefined') ? paneOrder : [];
  const active     = _orderSafe.filter(k => enabledIndicators.includes(k));
  const activeIdx  = active.indexOf(key);

  if (action === 'up' || action === 'down') {
    if (action === 'up'   && activeIdx <= 0) return;
    if (action === 'down' && activeIdx >= active.length - 1) return;
    const neighbour = action === 'up' ? active[activeIdx - 1] : active[activeIdx + 1];
    const i = _orderSafe.indexOf(key);
    const j = _orderSafe.indexOf(neighbour);
    [paneOrder[i], paneOrder[j]] = [paneOrder[j], paneOrder[i]];
    savePaneOrder();

  } else if (action === 'delete') {
    _deleteSubPaneIndicator(key);
    _hoveredSubPane = null;
    const bar = document.getElementById('paneControlsBar');
    if (bar) bar.style.display = 'none';
    if (typeof renderIndicatorInstanceBar === 'function') renderIndicatorInstanceBar();

  } else if (action === 'collapse') {
    _setSubPaneCollapsed(key, !collapsedPanes.includes(key));

  } else if (action === 'maximize') {
    const isMax = hKey && paneHeights[hKey] >= 200;
    if (isMax) {
      if (hKey) paneHeights[hKey] = _PANE_DEFAULT_H[hKey];
    } else {
      if (hKey) paneHeights[hKey] = 280;
      // Ensure not collapsed
      collapsedPanes = collapsedPanes.filter(k => k !== key);
      saveCollapsedPanes();
    }
  }

  drawChart();
  if (typeof renderChartLegend === 'function') renderChartLegend();
  // Re-evaluate bar position after redraw
  setTimeout(() => {
    const bar = document.getElementById('paneControlsBar');
    if (bar && _hoveredSubPane) _updatePaneControlsBar(0, 0);
  }, 60);
}

// ════════════════════════════════════════════════════════════
// REPLAY SUBSYSTEM
// ════════════════════════════════════════════════════════════

const REPLAY_SPEEDS = [
  { label: '10x',  multiplier: 10,  desc: '10 upd per 1 sec'  },
  { label: '7x',   multiplier: 7,   desc: '7 upd per 1 sec'   },
  { label: '5x',   multiplier: 5,   desc: '5 upd per 1 sec'   },
  { label: '3x',   multiplier: 3,   desc: '3 upd per 1 sec'   },
  { label: '1x',   multiplier: 1,   desc: '1 upd per 1 sec'   },
  { label: '0.5x', multiplier: 0.5, desc: '1 upd per 2 sec'   },
  { label: '0.3x', multiplier: 0.3, desc: '1 upd per 3 sec'   },
  { label: '0.2x', multiplier: 0.2, desc: '1 upd per 5 sec'   },
  { label: '0.1x', multiplier: 0.1, desc: '1 upd per 10 sec'  },
];

function enterReplayMode() {
  replayMode    = true;
  replayIndex   = 0;
  replayPlaying = false;
  _selectingBar = true;
  clearInterval(_replayTimer);
  _replayTimer  = null;

  document.getElementById('replayBar').style.display = 'flex';
  document.getElementById('replayBtn').classList.add('active');

  const canvas = document.getElementById('candleCanvas');
  if (canvas) { canvas.style.cursor = 'crosshair'; canvas.title = 'Click to select the starting bar'; }

  updateReplayUI();
}

function exitReplayMode() {
  replayMode    = false;
  replayIndex   = 0;
  replayPlaying = false;
  _selectingBar = false;
  clearInterval(_replayTimer);
  _replayTimer  = null;

  document.getElementById('replayBar').style.display = 'none';
  document.getElementById('replayBtn').classList.remove('active');

  const canvas = document.getElementById('candleCanvas');
  if (canvas) { canvas.style.cursor = 'grab'; canvas.title = ''; }

  drawChart();
}

function startSelectingBar() {
  _selectingBar = true;
  replayPlaying = false;
  clearInterval(_replayTimer);
  _replayTimer  = null;
  const canvas = document.getElementById('candleCanvas');
  if (canvas) canvas.style.cursor = 'crosshair';
  updateReplayUI();
}

function toggleReplayPlay() {
  if (replayIndex === 0) return;
  replayPlaying = !replayPlaying;
  if (replayPlaying) {
    _startReplayInterval();
  } else {
    clearInterval(_replayTimer);
    _replayTimer = null;
  }
  updateReplayUI();
}

function stepReplay() {
  if (replayIndex === 0) return;
  replayPlaying = false;
  clearInterval(_replayTimer);
  _replayTimer = null;
  _advanceReplay();
  updateReplayUI();
}

function _advanceReplay() {
  const fullData = aggregatedData.length > 0 ? aggregatedData : chartData;
  if (replayIndex < fullData.length) {
    replayIndex++;
    drawChart();
    _updateReplayProgressLabel();
  } else {
    // Reached end of data — stop playing
    replayPlaying = false;
    clearInterval(_replayTimer);
    _replayTimer  = null;
    updateReplayUI();
  }
}

function _startReplayInterval() {
  clearInterval(_replayTimer);
  // 10x = 100ms/candle, 1x = 1000ms/candle, 0.1x = 10000ms/candle
  const ms = replaySpeed >= 1
    ? Math.round(1000 / replaySpeed)
    : Math.round((1 / replaySpeed) * 1000);
  _replayTimer = setInterval(_advanceReplay, ms);
}

function setReplaySpeed(multiplier) {
  replaySpeed = multiplier;
  if (replayPlaying) _startReplayInterval(); // restart with new speed
  // Highlight active option
  document.querySelectorAll('.replay-speed-option').forEach(opt => {
    opt.classList.toggle('active', parseFloat(opt.dataset.speed) === multiplier);
  });
  const btn = document.getElementById('replaySpeedBtn');
  const speed = REPLAY_SPEEDS.find(s => s.multiplier === multiplier);
  if (btn && speed) btn.textContent = speed.label;
  closeReplaySpeedMenu();
}

function toggleReplaySpeedMenu() {
  const menu = document.getElementById('replaySpeedMenu');
  if (!menu) return;
  const isHidden = !menu.style.display || menu.style.display === 'none';
  if (isHidden) {
    menu.style.display = 'block';
    // Position above the button
    const btn  = document.getElementById('replaySpeedBtn');
    const rect = btn.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top  = (rect.top - menu.offsetHeight - 8) + 'px';
    document.addEventListener('click', _closeSpeedMenuOutside);
  } else {
    closeReplaySpeedMenu();
  }
}

function closeReplaySpeedMenu() {
  const menu = document.getElementById('replaySpeedMenu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('click', _closeSpeedMenuOutside);
}

function _closeSpeedMenuOutside(e) {
  const menu = document.getElementById('replaySpeedMenu');
  const btn  = document.getElementById('replaySpeedBtn');
  if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
    closeReplaySpeedMenu();
  }
}

function updateReplayUI() {
  const playBtn   = document.getElementById('replayPlayBtn');
  const selectBtn = document.getElementById('replaySelectBtn');
  const stepBtn   = document.getElementById('replayStepBtn');
  const speedBtn  = document.getElementById('replaySpeedBtn');
  const speedLbl  = document.getElementById('replaySpeedLabel');
  if (!playBtn) return;

  // Play / Pause icon swap
  const playIcon = playBtn.querySelector('.replay-icon-play');
  const pauseIcon = playBtn.querySelector('.replay-icon-pause');
  if (replayPlaying) {
    playIcon.style.display = 'none';
    pauseIcon.style.display = 'block';
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
  }

  const noBar = replayIndex === 0;
  playBtn.disabled = noBar;
  stepBtn.disabled = noBar;
  playBtn.classList.toggle('replay-disabled', noBar);
  stepBtn.classList.toggle('replay-disabled', noBar);

  selectBtn.classList.toggle('active', _selectingBar);

  const speed = REPLAY_SPEEDS.find(s => s.multiplier === replaySpeed);
  if (speedBtn && speed) speedBtn.textContent = speed.label;
  if (speedLbl && speed) speedLbl.textContent = speed.label;

  _updateReplayProgressLabel();
  _updateReplayProgressBar();
}

function _updateReplayProgressLabel() {
  const statusEl = document.getElementById('replayStatus');
  if (!statusEl) return;
  if (replayIndex === 0) {
    statusEl.textContent = 'Click chart to select start bar';
    return;
  }
  const fullData = aggregatedData.length > 0 ? aggregatedData : chartData;
  const total    = fullData.length;
  const current  = Math.min(replayIndex, total);
  const candle   = fullData[current - 1];
  statusEl.textContent = candle
    ? candle.Date + '  (' + current + ' / ' + total + ')'
    : current + ' / ' + total;
}

function _updateReplayProgressBar() {
  const fullData = aggregatedData.length > 0 ? aggregatedData : chartData;
  const fill = document.getElementById('replayProgressFill');
  const thumb = document.getElementById('replayProgressThumb');
  const label = document.getElementById('replayProgressLabel');
  
  if (!fill || !thumb || !label) return;
  
  const total = fullData.length;
  const percent = total > 0 ? (replayIndex / total) * 100 : 0;
  
  fill.style.width = percent + '%';
  thumb.style.left = percent + '%';
  
  if (replayIndex === 0) {
    label.textContent = '—';
  } else {
    label.textContent = replayIndex + ' / ' + total;
  }
}

// ── Canvas click: bar selection ────────────────────────────────
function _handleReplayBarSelect(e) {
  if (!replayMode || !_selectingBar) return;

  const canvas = document.getElementById('candleCanvas');
  const rect   = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;

  // Replicate the visible-window calculation from drawChart()
  const fullData    = aggregatedData.length > 0 ? aggregatedData : chartData;
  const padding     = { left: 60, right: 40 };
  const width       = canvas.clientWidth;
  const chartWidth  = width - padding.left - padding.right;
  const candleCount = Math.max(5, Math.min(
    fullData.length,
    Math.floor(chartWidth / (8 * zoomLevel))
  ));
  const maxPan     = Math.max(0, fullData.length - candleCount);
  const clampedPan = Math.max(0, Math.min(maxPan, panOffset));
  const endIdx     = fullData.length - clampedPan;
  const startIdx   = Math.max(0, endIdx - candleCount);
  const visCount   = endIdx - startIdx;
  const candleW    = chartWidth / visCount;

  const localX   = clickX - padding.left;
  const clickedI = Math.floor(localX / candleW);
  const absIdx   = startIdx + Math.max(0, Math.min(visCount - 1, clickedI));

  if (absIdx < 0 || absIdx >= fullData.length) return;

  replayIndex   = absIdx + 1; // include clicked candle
  _selectingBar = false;
  panOffset     = 0;

  const c = document.getElementById('candleCanvas');
  if (c) { c.style.cursor = 'grab'; c.title = ''; }

  drawChart();
  updateReplayUI();
}

// ─── Mouse / touch interactions ───────────────────────────────
let _isDragging   = false;
let _dragStartX   = 0;
let _dragStartPan = 0;
let _dragStartYPan = 0;           // 2-D pan: mouse Y at drag start (vertical price shift)
let _dragStartPriceOffset = 0;    // 2-D pan: priceOffset at drag start
let _dragStartPaneKey = 'price';  // 2-D pan: which pane the drag started in — vertical shift is price-pane only
let _isVerticalDragging = false;  // NEW: for drag-to-zoom
let _dragStartY = 0;              // NEW: for drag-to-zoom
let _dragStartVZoom = 1;          // NEW: for drag-to-zoom
let _dragPaneKey = 'price';       // which pane's Y-axis is being dragged — see _paneAtY()

// Converts a vertical drag distance into a priceOffset delta using the price
// pane's own current price-per-pixel scale (from the last drawChart() call),
// so a 1px drag always shifts the same on-screen distance regardless of
// zoom level. Falls back to no-op if the chart hasn't drawn yet.
function _priceOffsetFromDy(startOffset, dy) {
  if (!_lastPriceRange || !_lastPriceRange.paneHeight) return startOffset;
  const { minPrice, maxPrice, paneHeight } = _lastPriceRange;
  const pricePerPixel = (maxPrice - minPrice) / paneHeight;
  return startOffset + dy * pricePerPixel;
}

function setupChartInteractions() {
  const canvas = document.getElementById('candleCanvas');
  if (!canvas || canvas._interactionsBound) return;
  canvas._interactionsBound = true;

  // ── Progress bar seeking ──────────────────────────────────
  const progressBar = document.getElementById('replayProgressFill');
  const progressContainer = document.querySelector('.replay-progress-bar');
  if (progressContainer) {
    progressContainer.addEventListener('click', e => {
      if (!replayMode || replayIndex === 0) return;
      const rect = progressContainer.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const fullData = aggregatedData.length > 0 ? aggregatedData : chartData;
      replayIndex = Math.max(1, Math.round(percent * fullData.length));
      replayPlaying = false;
      clearInterval(_replayTimer);
      _replayTimer = null;
      drawChart();
      updateReplayUI();
    });
  }

  // ── Replay bar selection via canvas click ─────────────────────
  canvas.addEventListener('click', e => {
    if (replayMode && _selectingBar) {
      _handleReplayBarSelect(e);
      e.stopPropagation();
    }
  });

  // ── Mouse wheel: horizontal zoom (plain) or vertical zoom (Ctrl/Shift) ──
  let _wheelBusy = false;
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (_wheelBusy) return;
    _wheelBusy = true;
    setTimeout(() => { _wheelBusy = false; }, 60);
    const dir  = e.deltaY > 0 ? -1 : 1;
    const STEP = 0.04;
    if (e.ctrlKey || e.shiftKey) {
      vZoomLevel = Math.max(0.3, Math.min(4, vZoomLevel + dir * STEP));
    } else {
      zoomLevel  = Math.max(0.3, Math.min(4, zoomLevel  + dir * STEP));
    }
    drawChart();
  }, { passive: false });

  // ── Drag to pan OR resize pane OR vertical zoom ───────────────
  canvas.addEventListener('mousedown', e => {
    e.preventDefault();

    // Block pan/resize while selecting a replay bar
    if (replayMode && _selectingBar) return;

    const rect    = canvas.getBoundingClientRect();
    const canvasY = e.clientY - rect.top;
    const canvasX = e.clientX - rect.left;
    const handle  = _findHandle(canvasY);

    // NEW: Check if dragging on right Y-axis area for vertical zoom
    const rightAxisWidth = rect.width * 0.05; // Right 5% is Y-axis area
    if (typeof clearCrosshairPosition === 'function') clearCrosshairPosition();

    if (canvasX > rect.width - rightAxisWidth) {
      _isVerticalDragging = true;
      _dragStartY   = e.clientY;
      _dragPaneKey  = _paneAtY(canvasY);
      _dragStartVZoom = _dragPaneKey === 'price' ? vZoomLevel : (paneVZoom[_dragPaneKey] ?? 1);
      canvas.style.cursor = 'ns-resize';
      return;
    }

    if (handle) {
      _resizing = {
        handle,
        startY:     e.clientY,
        startAbove: paneHeights[handle.above],
        startBelow: paneHeights[handle.below],
      };
      canvas.style.cursor = 'ns-resize';
    } else {
      _isDragging   = true;
      _dragStartX   = e.clientX;
      _dragStartYPan = e.clientY;
      _dragStartPan = panOffset;
      _dragStartPriceOffset = priceOffset;
      // Vertical shift only applies within the price/candlestick pane —
      // dragging over the Volume/MACD/RSI sub-panes still pans horizontally
      // (shared time axis) but leaves their own auto-scaled Y range alone.
      _dragStartPaneKey = _paneAtY(canvasY);
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mouseup', () => {
    _isDragging = false;
    _isVerticalDragging = false;  // NEW: clear vertical zoom flag
    _resizing   = null;
    if (!replayMode || !_selectingBar) {
      document.getElementById('candleCanvas').style.cursor = 'grab';
    }
  });

  // ── Legend hover tracking + crosshair ───────────────────────
  canvas.addEventListener('mousemove', e => {
    if (typeof updateLegendHover === 'function') updateLegendHover(e.clientX, e.clientY);
    const rect = canvas.getBoundingClientRect();
    _updatePaneControlsBar(e.clientX - rect.left, e.clientY - rect.top);
    // Only while purely hovering — not mid-pan/mid-resize/mid-vertical-zoom,
    // same as TradingView hiding its crosshair while you're dragging.
    if (typeof setCrosshairPosition === 'function' && !_isDragging && !_resizing && !_isVerticalDragging) {
      setCrosshairPosition(e.clientX - rect.left, e.clientY - rect.top);
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (typeof clearLegendHover === 'function') clearLegendHover();
    if (typeof clearCrosshairPosition === 'function') clearCrosshairPosition();
    _schedulePaneCtrlHide();
  });

  window.addEventListener('mousemove', e => {
    // NEW: Handle vertical drag-to-zoom on right Y-axis — targets whichever
    // pane the drag started in (price uses vZoomLevel, indicator sub-panes
    // use their own entry in paneVZoom so they zoom independently).
    if (_isVerticalDragging) {
      const dy = e.clientY - _dragStartY;
      const zoomSpeed = 0.01;  // Sensitivity: 1% change per pixel
      const newVZoom = Math.max(0.3, Math.min(4, _dragStartVZoom + (dy * zoomSpeed)));
      if (_dragPaneKey === 'price') {
        vZoomLevel = newVZoom;
      } else {
        paneVZoom[_dragPaneKey] = newVZoom;
      }
      drawChart();
      return;
    }

    if (_resizing) {
      const dy       = e.clientY - _resizing.startY;
      const newAbove = Math.max(PANE_MIN, _resizing.startAbove + dy);
      const newBelow = Math.max(PANE_MIN, _resizing.startBelow - dy);
      paneHeights[_resizing.handle.above] = newAbove;
      paneHeights[_resizing.handle.below] = newBelow;
      drawChart();
      return;
    }

    if (!_isDragging) {
      const rect    = canvas.getBoundingClientRect();
      const canvasY = e.clientY - rect.top;
      const canvasX = e.clientX - rect.left;
      const rightAxisWidth = rect.width * 0.05;

      // NEW: Change cursor on right Y-axis area
      if (canvasX > rect.width - rightAxisWidth) {
        canvas.style.cursor = 'ns-resize';
      } else if (!replayMode || !_selectingBar) {
        canvas.style.cursor = _findHandle(canvasY) ? 'ns-resize' : 'grab';
      }
    }

    if (!_isDragging) return;
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartYPan;
    const approxCandleW = Math.max(2,
      canvas.width / Math.max(1, Math.floor((canvas.width - 100) / (8 * zoomLevel)))
    );
    const DAMPING     = 0.4;
    const candleShift = Math.round((dx / approxCandleW) * DAMPING);
    _applyPan(candleShift, dy);
  });

  // ── Touch: pan (1 finger) + pinch-to-zoom (2 fingers) ────────
  let _t1X = 0, _t1Y = 0, _t2X = 0, _t2Y = 0;
  let _tPan = 0, _tZoom = 1, _tVZoom = 1;
  let _tPriceOffset = 0;            // 2-D pan: priceOffset at touch start
  let _tPinchH = 0, _tPinchV = 0;
  let _tPaneKey = null, _tPaneH0 = 0;
  let _isPinching = false;

  function _paneAtY(canvasY) {
    let y = 0;
    const checks = [
      { key: 'price',  h: paneHeights.price  },
      { key: 'volume', h: paneHeights.volume + SPACING },
    ];
    if (enabledIndicators.includes('MACD'))          checks.push({ key: 'macd', h: paneHeights.macd + SPACING });
    if (enabledIndicators.includes('RSI'))           checks.push({ key: 'rsi',  h: paneHeights.rsi  + SPACING });
    if (enabledIndicators.includes('Hilega-Milega')) checks.push({ key: 'hm',   h: paneHeights.hm   + SPACING });
    for (const c of checks) {
      y += c.h;
      if (canvasY <= y) return c.key;
    }
    return 'price';
  }

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      _isPinching = false;
      _t1X = e.touches[0].clientX;
      _t1Y = e.touches[0].clientY;
      _tPan = panOffset;
      _tPriceOffset = priceOffset;
      // Vertical shift only applies within the price/candlestick pane — see
      // the matching comment on _dragStartPaneKey in the mouse handler above.
      const rect = canvas.getBoundingClientRect();
      _tPaneKey = _paneAtY(_t1Y - rect.top);
      if (typeof updateLegendHover === 'function') updateLegendHover(_t1X, _t1Y);
    } else if (e.touches.length === 2) {
      _isPinching = true;
      _t1X = e.touches[0].clientX; _t1Y = e.touches[0].clientY;
      _t2X = e.touches[1].clientX; _t2Y = e.touches[1].clientY;
      _tPinchH = Math.abs(_t2X - _t1X);
      _tPinchV = Math.abs(_t2Y - _t1Y);
      _tZoom   = zoomLevel;
      _tVZoom  = vZoomLevel;
      _tPan    = panOffset;
      const rect = canvas.getBoundingClientRect();
      const midY = ((_t1Y + _t2Y) / 2) - rect.top;
      _tPaneKey  = _paneAtY(midY);
      _tPaneH0   = paneHeights[_tPaneKey] || 100;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && _isPinching) {
      const cx1 = e.touches[0].clientX, cy1 = e.touches[0].clientY;
      const cx2 = e.touches[1].clientX, cy2 = e.touches[1].clientY;
      const curH = Math.abs(cx2 - cx1);
      const curV = Math.abs(cy2 - cy1);
      if (_tPinchH > 10) {
        zoomLevel = Math.max(0.3, Math.min(4, _tZoom * (curH / _tPinchH)));
      }
      if (_tPinchV > 10 && _tPaneKey) {
        paneHeights[_tPaneKey] = Math.max(PANE_MIN, Math.round(_tPaneH0 * (curV / _tPinchV)));
      }
      const midDx = ((cx1 + cx2) / 2) - ((_t1X + _t2X) / 2);
      const approxCW = Math.max(2,
        canvas.width / Math.max(1, Math.floor((canvas.width - 100) / (8 * zoomLevel)))
      );
      const shift = Math.round((-midDx / approxCW) * 0.4);
      panOffset = Math.max(0, isFinite(_tPan + shift) ? _tPan + shift : 0);
      drawChart();
    } else if (e.touches.length === 1 && !_isPinching) {
      const dx = e.touches[0].clientX - _t1X;
      const dy = e.touches[0].clientY - _t1Y;
      const approxCW = Math.max(2,
        canvas.width / Math.max(1, Math.floor((canvas.width - 100) / (8 * zoomLevel)))
      );
      const shift = Math.round((dx / approxCW) * 0.4);
      panOffset = Math.max(0, isFinite(_tPan + shift) ? _tPan + shift : 0);
      if (_tPaneKey === 'price') {
        priceOffset = _priceOffsetFromDy(_tPriceOffset, dy);
      }
      if (typeof updateLegendHover === 'function') updateLegendHover(e.touches[0].clientX, e.touches[0].clientY);
      drawChart();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) _isPinching = false;
    if (e.touches.length === 1) {
      _t1X  = e.touches[0].clientX;
      _t1Y  = e.touches[0].clientY;
      _tPan = panOffset;
      _tPriceOffset = priceOffset;
    }
  }, { passive: true });

  canvas.style.cursor = 'grab';
}

function _applyPan(candleShift, dy) {
  const next = _dragStartPan + candleShift;
  panOffset  = Math.max(0, isFinite(next) ? next : 0);
  if (dy != null && _dragStartPaneKey === 'price') {
    priceOffset = _priceOffsetFromDy(_dragStartPriceOffset, dy);
  }
  drawChart();
}

// ─── Theme toggle ─────────────────────────────────────────────
function setupThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;
  const savedTheme = localStorage.getItem('chartTheme') || 'dark-mode';
  applyTheme(savedTheme);
  themeToggle.addEventListener('click', () => {
    const root     = document.documentElement;
    const newTheme = root.classList.contains('light-mode') ? 'dark-mode' : 'light-mode';
    applyTheme(newTheme);
    localStorage.setItem('chartTheme', newTheme);
  });
}

function applyTheme(theme) {
  const root     = document.documentElement;
  const moonIcon = document.querySelector('.theme-icon-moon');
  const sunIcon  = document.querySelector('.theme-icon-sun');
  if (theme === 'light-mode') {
    root.classList.add('light-mode');
    if (moonIcon) moonIcon.style.display = 'none';
    if (sunIcon)  sunIcon.style.display  = 'block';
  } else {
    root.classList.remove('light-mode');
    if (moonIcon) moonIcon.style.display = 'block';
    if (sunIcon)  sunIcon.style.display  = 'none';
  }
  setTimeout(() => drawChart(), 50);
}

// ─── Public: Reload chart for a specific symbol ────────────────
// Called from company.html or anywhere to switch symbols dynamically
window.reloadChartForSymbol = function(symbol) {
  if (!symbol) return;
  
  const upperSymbol = symbol.toUpperCase();
  console.log(`[Chart] Reloading for symbol: ${upperSymbol}`);
  
  // Update URL with stock code parameter
  const url = new URL(window.location);
  url.searchParams.set('code', upperSymbol);
  window.history.replaceState({code: upperSymbol}, '', url.toString());
  
  // Reset chart state
  chartData = [];
  aggregatedData = [];
  replayMode = false;
  replayIndex = 0;
  replayPlaying = false;
  zoomLevel = 1;
  vZoomLevel = 1;
  paneVZoom = { volume: 1, macd: 1, rsi: 1, hm: 1 };
  panOffset = 0;
  priceOffset = 0;
  currentTimeframe = 'daily';
  
  // Update UI labels
  document.querySelectorAll('.tv-ticker, .legend-name').forEach(el => {
    el.textContent = upperSymbol;
  });
  document.getElementById('headerLogoTag').textContent = upperSymbol;
  document.title = `${upperSymbol} Candlestick Chart — Professional Trading View`;
  
  // Show loading state
  const loadingEl = document.getElementById('loadingState');
  const canvas = document.getElementById('candleCanvas');
  if (loadingEl) loadingEl.style.display = 'flex';
  if (canvas) canvas.style.display = 'none';
  
  // Close any open modals
  closeIndicatorsModal();
  if (document.getElementById('indicatorSettingsModal')) {
    document.getElementById('indicatorSettingsModal').style.display = 'none';
  }
  if (document.getElementById('renkoSettingsModal')) {
    document.getElementById('renkoSettingsModal').style.display = 'none';
  }
  if (typeof closeAnalysisModal === 'function') closeAnalysisModal();
  if (typeof closeValuationModal === 'function') closeValuationModal();
  if (typeof closeSRModal === 'function') closeSRModal();
  exitReplayMode();
  
  // Load new data
  setTimeout(() => {
    if (typeof loadData === 'function') {
      loadData();
    }
  }, 100);
};

// ─── App initialisation ───────────────────────────────────────
// Core init — called either automatically (standalone candlestick.html)
// or by company.js after #profile-body becomes visible.
function _runChartInit() {
  setupThemeToggle();
  syncToolbarUIWithRestoredPrefs();
  if (typeof renderIndicatorInstanceBar === 'function') renderIndicatorInstanceBar();
  loadData();
  setupChartInteractions();
  setupReplayKeyboardShortcuts();
}

// Exposed so company.js can trigger init at the right moment
window.initCandlestickFullChart = _runChartInit;

window.addEventListener('load', () => {
  // When embedded in company.html, #loadingState is inside #profile-body which
  // starts as display:none — offsetParent===null detects this.
  // In that case, company.js calls initCandlestickFullChart() once the body is visible.
  const loadEl = document.getElementById('loadingState');
  if (loadEl && loadEl.offsetParent === null) return;
  _runChartInit();
});

// ─── Sync toolbar button states with restored localStorage prefs ──
// candlestick.html hardcodes "Candles" as "active" in markup. If a
// saved preference says otherwise (e.g. user had switched to Heikin
// Ashi), reflect that here so the toolbar matches what drawChart()
// will actually render. (MA20/50/200/EMA200 pills were replaced by
// the indicator instance bar, so there's no MA-pill sync here anymore.)
function syncToolbarUIWithRestoredPrefs() {
  document.querySelectorAll('.chart-type-option').forEach(opt => {
    const onclick = opt.getAttribute('onclick') || '';
    const match   = onclick.match(/setChartType\('([^']+)'\)/);
    opt.classList.toggle('active', !!match && match[1] === chartType);
  });

  // MA20/50/200/EMA200 pills default to MA20-only in the static HTML, but
  // activeMA is restored from localStorage (see candlestick-data.js) and can
  // differ — sync the pills' highlight to match what's actually drawn.
  if (typeof activeMA !== 'undefined') {
    document.querySelectorAll('.ma-btn').forEach(btn => {
      const onclick = btn.getAttribute('onclick') || '';
      const match   = onclick.match(/toggleMA\(\s*'?(\w+)'?/);
      if (!match) return;
      btn.classList.toggle('active', !!activeMA[match[1]]);
    });
  }
}

window.addEventListener('resize', drawChart);

// ── Replay keyboard shortcuts ────────────────────────────────
function setupReplayKeyboardShortcuts() {
  window.addEventListener('keydown', e => {
    if (!replayMode || !replayIndex) return;
    
    switch(e.code) {
      case 'Space':
        e.preventDefault();
        toggleReplayPlay();
        break;
      case 'ArrowRight':
        e.preventDefault();
        stepReplay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (replayIndex > 1) {
          replayIndex--;
          drawChart();
          updateReplayUI();
        }
        break;
      case 'Escape':
        e.preventDefault();
        exitReplayMode();
        break;
    }
  });
}