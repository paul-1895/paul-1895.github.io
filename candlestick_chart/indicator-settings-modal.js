/* ════════════════════════════════════════════════════════════
   indicator-settings-modal.js
   Generic TradingView-style settings modal (Inputs / Style /
   Visibility tabs) for any indicator instance, plus the
   indicator instance bar rendered under the toolbar.

   This is intentionally generic: it reads field definitions from
   INDICATOR_DEFS (indicator-instances.js) and renders whatever
   inputs/style fields that type declares — adding a new
   indicator type to INDICATOR_DEFS automatically gets this same
   modal UI with no further wiring here.

   Depends on : indicator-instances.js (INDICATOR_DEFS, instance
                CRUD functions), candlestick-ui.js (drawChart)
   Consumed by: candlestick.html (modal container + instance bar
                container), indicator-instances.js indirectly via
                openIndicatorSettings()
   ════════════════════════════════════════════════════════════ */

let _settingsModalInstanceId = null;
let _settingsModalTab        = 'inputs';
let _settingsModalDraft      = null; // working copy, committed on Ok

// ─── Open / close ───────────────────────────────────────────────
function openIndicatorSettings(instanceId) {
  const instance = getIndicatorInstance(instanceId);
  if (!instance) return;
  _settingsModalInstanceId = instanceId;
  _settingsModalTab        = 'inputs';
  _settingsModalDraft      = JSON.parse(JSON.stringify(instance)); // deep copy
  _renderSettingsModal();
  document.getElementById('indicatorSettingsModal').style.display = 'flex';
}

function closeIndicatorSettings() {
  document.getElementById('indicatorSettingsModal').style.display = 'none';
  _settingsModalInstanceId = null;
  _settingsModalDraft      = null;
}

function _commitIndicatorSettings() {
  if (!_settingsModalInstanceId || !_settingsModalDraft) return;
  updateIndicatorInstance(_settingsModalInstanceId, {
    inputs:     _settingsModalDraft.inputs,
    style:      _settingsModalDraft.style,
    visibility: _settingsModalDraft.visibility,
  });
  renderIndicatorInstanceBar();
  drawChart();
  closeIndicatorSettings();
}

function _switchSettingsTab(tab) {
  _settingsModalTab = tab;
  _renderSettingsModal();
}

// ─── Field helpers ───────────────────────────────────────────────
function _fieldLabel(key) {
  const labels = {
    length: 'Length', source: 'Source', offset: 'Offset', stdDev: 'StdDev',
    tenkan: 'Conversion Line', kijun: 'Base Line', senkouB: 'Leading Span B',
    displacement: 'Displacement', atrPeriod: 'ATR Length', factor: 'Factor',
  };
  return labels[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function _isNumericInput(key, value) {
  return typeof value === 'number';
}

// ─── Render: Inputs tab ──────────────────────────────────────────
function _renderInputsTab() {
  const inst = _settingsModalDraft;
  const def  = INDICATOR_DEFS[inst.typeId];
  let html = '';
  Object.keys(def.defaultInputs).forEach(key => {
    const value = inst.inputs[key];
    if (key === 'source') {
      html += `
        <div class="ind-set-row">
          <label>${_fieldLabel(key)}</label>
          <select onchange="_settingsModalDraft.inputs.${key} = this.value">
            ${SOURCE_OPTIONS.map(opt => `<option value="${opt}"${opt === value ? ' selected' : ''}>${opt}</option>`).join('')}
          </select>
        </div>`;
    } else if (_isNumericInput(key, value)) {
      html += `
        <div class="ind-set-row">
          <label>${_fieldLabel(key)}</label>
          <input type="number" value="${value}" step="${key === 'stdDev' || key === 'factor' ? '0.1' : '1'}"
                 onchange="_settingsModalDraft.inputs.${key} = parseFloat(this.value) || 0">
        </div>`;
    }
  });
  return html;
}

// ─── Render: Style tab ────────────────────────────────────────────
function _renderStyleTab() {
  const inst = _settingsModalDraft;
  const style = inst.style;
  let html = '';

  // Color fields: anything in style whose key starts with "color" or is exactly "color"
  Object.keys(style).forEach(key => {
    if (key === 'color' || key.startsWith('color')) {
      const label = key === 'color' ? def_label(inst) : _fieldLabel(key.replace('color', ''));
      html += `
        <div class="ind-set-row ind-set-style-row">
          <input type="checkbox" checked disabled>
          <span class="ind-set-style-label">${label}</span>
          <input type="color" value="${style[key]}" class="ind-set-color"
                 onchange="_settingsModalDraft.style.${key} = this.value; document.getElementById('_swatch_${key}').style.background = this.value;">
          <select onchange="_settingsModalDraft.style.lineStyle = this.value">
            <option value="solid"${style.lineStyle === 'solid' ? ' selected' : ''}>Solid</option>
            <option value="dashed"${style.lineStyle === 'dashed' ? ' selected' : ''}>Dashed</option>
            <option value="dotted"${style.lineStyle === 'dotted' ? ' selected' : ''}>Dotted</option>
          </select>
        </div>`;
    }
  });

  html += `
    <div class="ind-set-row">
      <label>Line width</label>
      <input type="number" min="1" max="6" value="${style.lineWidth || 1}"
             onchange="_settingsModalDraft.style.lineWidth = parseFloat(this.value) || 1">
    </div>`;

  if (style.fillOpacity != null) {
    html += `
      <div class="ind-set-row">
        <label>Fill opacity</label>
        <input type="range" min="0" max="1" step="0.05" value="${style.fillOpacity}"
               oninput="_settingsModalDraft.style.fillOpacity = parseFloat(this.value)">
      </div>`;
  }

  html += `<div class="ind-set-divider"></div>`;
  html += `
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_chk_showAxis" ${style.showLabelOnAxis ? 'checked' : ''}
             onchange="_settingsModalDraft.style.showLabelOnAxis = this.checked">
      <label for="_chk_showAxis">Labels on price scale</label>
    </div>
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_chk_showLegend" ${style.showInLegend ? 'checked' : ''}
             onchange="_settingsModalDraft.style.showInLegend = this.checked">
      <label for="_chk_showLegend">Values in status line</label>
    </div>`;

  return html;
}

function def_label(inst) {
  const def = INDICATOR_DEFS[inst.typeId];
  return def ? def.label : inst.typeId;
}

// ─── Render: Visibility tab ───────────────────────────────────────
const VISIBILITY_ROWS = [
  { key: 'ticks',   label: 'Ticks',   range: false },
  { key: 'seconds', label: 'Seconds', range: true, min: 1, max: 59 },
  { key: 'minutes', label: 'Minutes', range: true, min: 1, max: 59 },
  { key: 'hours',   label: 'Hours',   range: true, min: 1, max: 24 },
  { key: 'days',    label: 'Days',    range: true, min: 1, max: 366 },
  { key: 'weeks',   label: 'Weeks',   range: true, min: 1, max: 52 },
  { key: 'months',  label: 'Months',  range: true, min: 1, max: 12 },
  { key: 'ranges',  label: 'Ranges',  range: false },
];

function _renderVisibilityTab() {
  const vis = _settingsModalDraft.visibility;
  return VISIBILITY_ROWS.map(row => `
    <div class="ind-set-vis-row">
      <input type="checkbox" ${vis[row.key] ? 'checked' : ''}
             onchange="_settingsModalDraft.visibility.${row.key} = this.checked">
      <span class="ind-set-vis-label">${row.label}</span>
      ${row.range ? `
        <span class="ind-set-vis-range">
          <input type="number" value="${row.min}" disabled>
          <span class="ind-set-vis-slider"></span>
          <input type="number" value="${row.max}" disabled>
        </span>` : ''}
    </div>`).join('');
}

// ─── Main modal render ────────────────────────────────────────────
function _renderSettingsModal() {
  const inst = _settingsModalDraft;
  if (!inst) return;
  const def = INDICATOR_DEFS[inst.typeId];
  const title = def ? def.label : inst.typeId;

  const body = document.getElementById('indicatorSettingsBody');
  const titleEl = document.getElementById('indicatorSettingsTitle');
  if (titleEl) titleEl.textContent = title;

  const tabHtml = `
    <div class="ind-set-tabs">
      <button class="ind-set-tab${_settingsModalTab === 'inputs' ? ' active' : ''}" onclick="_switchSettingsTab('inputs')">Inputs</button>
      <button class="ind-set-tab${_settingsModalTab === 'style' ? ' active' : ''}" onclick="_switchSettingsTab('style')">Style</button>
      <button class="ind-set-tab${_settingsModalTab === 'visibility' ? ' active' : ''}" onclick="_switchSettingsTab('visibility')">Visibility</button>
    </div>`;

  let contentHtml = '';
  if (_settingsModalTab === 'inputs')      contentHtml = _renderInputsTab();
  else if (_settingsModalTab === 'style')  contentHtml = _renderStyleTab();
  else                                     contentHtml = _renderVisibilityTab();

  if (body) body.innerHTML = tabHtml + `<div class="ind-set-content">${contentHtml}</div>`;
}

// ─── Instance bar (the strip under the toolbar showing each
//     active indicator instance, like image 4) ─────────────────
function renderIndicatorInstanceBar() {
  const bar = document.getElementById('indicatorInstanceBar');
  if (!bar) return;

  // ── Sub-pane indicators (MACD / RSI / Hilega-Milega) — single-instance,
  //    enabled/disabled via enabledIndicators[]. Shown as pills with a
  //    settings gear that opens their own dedicated settings modal.
  const SUB_PANE_DEFS = [
    {
      key: 'MACD',
      label: () => {
        const p = (typeof macdParams !== 'undefined') ? macdParams : {};
        return `MACD ${p.fastLength||12} ${p.slowLength||26} ${p.signalLength||9}`;
      },
      color: () => (typeof macdParams !== 'undefined') ? macdParams.macdColor : '#FF9C00',
      openSettings: 'openMACDSettings()',
    },
    {
      key: 'RSI',
      label: () => 'RSI 14',
      color: () => '#a78bfa',
      openSettings: null,   // no dedicated modal yet — omit gear icon
    },
    {
      key: 'Hilega-Milega',
      label: () => 'Hilega-Milega',
      color: () => '#f0a830',
      openSettings: null,
    },
  ];

  const subPanePills = SUB_PANE_DEFS
    .filter(def => enabledIndicators.includes(def.key))
    .map(def => {
      const label = def.label();
      const color = def.color();
      const isCollapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(def.key);
      const gearBtn = def.openSettings ? `
        <button class="ind-bar-btn" title="Settings" onclick="${def.openSettings}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>` : '';
      return `
        <div class="ind-bar-pill" data-key="${def.key}" style="border-color:${color}22">
          <span class="ind-bar-name" style="color:${color}">${label}</span>
          <button class="ind-bar-btn" title="${isCollapsed ? 'Show pane' : 'Hide pane'}" onclick="_toggleSubPaneVisibility('${def.key}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
              ${isCollapsed
                ? '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 4.22-5.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
                : '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>'}
            </svg>
          </button>
          ${gearBtn}
          <button class="ind-bar-btn ind-bar-btn-danger" title="Remove"
                  onclick="_removeSubPaneFromBar('${def.key}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>`;
    }).join('');

  // ── Multi-instance overlay indicators (EMA, SMA, BB, Ichimoku, Supertrend) ──
  const instancePills = indicatorInstances.map(instance => {
    const def = INDICATOR_DEFS[instance.typeId];
    const label = def ? def.label : instance.typeId;
    const lengthBadge = instance.inputs.length != null ? instance.inputs.length
                        : instance.inputs.tenkan != null ? `${instance.inputs.tenkan} ${instance.inputs.kijun} ${instance.inputs.senkouB}`
                        : instance.inputs.atrPeriod != null ? `${instance.inputs.atrPeriod} ${instance.inputs.factor}`
                        : '';
    const sourceBadge = instance.inputs.source ? instance.inputs.source.toLowerCase() : '';
    return `
      <div class="ind-bar-pill" data-id="${instance.id}">
        <span class="ind-bar-name">${label}</span>
        <span class="ind-bar-meta">${lengthBadge} ${sourceBadge}</span>
        <button class="ind-bar-btn" title="Toggle visibility" onclick="_toggleInstanceVisible('${instance.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
            ${instance.style.visible
              ? '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>'
              : '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 4.22-5.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'}
          </svg>
        </button>
        <button class="ind-bar-btn" title="Settings" onclick="openIndicatorSettings('${instance.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="ind-bar-btn ind-bar-btn-danger" title="Remove" onclick="_removeInstanceFromBar('${instance.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  const totalPills = subPanePills + instancePills;
  if (!totalPills.trim()) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = totalPills;
}

function _toggleInstanceVisible(id) {
  const inst = getIndicatorInstance(id);
  if (!inst) return;
  updateIndicatorInstance(id, { style: { visible: !inst.style.visible } });
  renderIndicatorInstanceBar();
  if (typeof renderChartLegend === 'function') renderChartLegend();
  drawChart();
}

function _removeInstanceFromBar(id) {
  removeIndicatorInstance(id);
  renderIndicatorInstanceBar();
  drawChart();
}

function _removeSubPaneFromBar(key) {
  if (typeof _deleteSubPaneIndicator === 'function') {
    _deleteSubPaneIndicator(key);
  } else {
    enabledIndicators = enabledIndicators.filter(k => k !== key);
    if (typeof saveEnabledIndicators === 'function') saveEnabledIndicators();
  }
  renderIndicatorInstanceBar();
  drawChart();
  if (typeof renderChartLegend === 'function') renderChartLegend();
}