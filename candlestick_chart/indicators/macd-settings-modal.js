/* ════════════════════════════════════════════════════════════
   macd-settings-modal.js
   TradingView-style MACD settings modal.
   Reads/writes the global `macdParams` object defined in macd.js.
   Three tabs: Inputs, Style, Visibility.
   ════════════════════════════════════════════════════════════ */

let _macdSettingsTab = 'inputs';
let _macdDraft       = null;   // working copy, committed on Ok

// ─── Open / close ─────────────────────────────────────────────
function openMACDSettings() {
  _macdDraft       = Object.assign({}, macdParams);
  _macdSettingsTab = 'inputs';
  _renderMACDModal();
  document.getElementById('macdSettingsModal').style.display = 'flex';
}

function closeMACDSettings() {
  document.getElementById('macdSettingsModal').style.display = 'none';
  _macdDraft = null;
}

function _commitMACDSettings() {
  if (!_macdDraft) return;
  Object.assign(macdParams, _macdDraft);
  saveMACDParams();
  // Re-attach with new params, then redraw
  const display = (typeof aggregatedData !== 'undefined' && aggregatedData.length) ? aggregatedData : chartData;
  attachMACD(display);
  if (display !== chartData) attachMACD(chartData);
  drawChart();
  if (typeof renderChartLegend === 'function') renderChartLegend();
  if (typeof renderIndicatorInstanceBar === 'function') renderIndicatorInstanceBar();
  closeMACDSettings();
}

function _switchMACDTab(tab) {
  _macdSettingsTab = tab;
  _renderMACDModal();
}

// ─── Tab content builders ──────────────────────────────────────
function _macdInputsTab() {
  const d = _macdDraft;
  const srcOpts = ['Close','Open','High','Low','HL2','HLC3','OHLC4']
    .map(o => `<option value="${o}"${d.source === o ? ' selected' : ''}>${o}</option>`).join('');
  return `
    <div class="ind-set-row">
      <label>Fast Length</label>
      <input type="number" min="1" max="500" value="${d.fastLength}"
             onchange="_macdDraft.fastLength = parseInt(this.value)||12">
    </div>
    <div class="ind-set-row">
      <label>Slow Length</label>
      <input type="number" min="1" max="500" value="${d.slowLength}"
             onchange="_macdDraft.slowLength = parseInt(this.value)||26">
    </div>
    <div class="ind-set-row">
      <label>Signal Length</label>
      <input type="number" min="1" max="500" value="${d.signalLength}"
             onchange="_macdDraft.signalLength = parseInt(this.value)||9">
    </div>
    <div class="ind-set-row">
      <label>Source</label>
      <select onchange="_macdDraft.source = this.value">${srcOpts}</select>
    </div>`;
}

function _macdStyleTab() {
  const d = _macdDraft;
  return `
    <div class="ind-set-row">
      <label>MACD Line</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="color" value="${d.macdColor}" class="ind-set-color"
               onchange="_macdDraft.macdColor = this.value">
        <input type="number" min="0.5" max="6" step="0.5" value="${d.macdWidth}"
               style="max-width:70px"
               onchange="_macdDraft.macdWidth = parseFloat(this.value)||2.5">
      </div>
    </div>
    <div class="ind-set-row">
      <label>Signal Line</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="color" value="${d.signalColor}" class="ind-set-color"
               onchange="_macdDraft.signalColor = this.value">
        <input type="number" min="0.5" max="6" step="0.5" value="${d.signalWidth}"
               style="max-width:70px"
               onchange="_macdDraft.signalWidth = parseFloat(this.value)||2.5">
      </div>
    </div>
    <div class="ind-set-row">
      <label>Histogram Up</label>
      <input type="color" value="${d.histUpColor}" class="ind-set-color"
             onchange="_macdDraft.histUpColor = this.value">
    </div>
    <div class="ind-set-row">
      <label>Histogram Down</label>
      <input type="color" value="${d.histDownColor}" class="ind-set-color"
             onchange="_macdDraft.histDownColor = this.value">
    </div>
    <div class="ind-set-divider"></div>
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_macd_chk_axis" ${d.showZero ? 'checked' : ''}
             onchange="_macdDraft.showZero = this.checked">
      <label for="_macd_chk_axis">Show zero line</label>
    </div>`;
}

function _macdVisibilityTab() {
  const d = _macdDraft;
  return `
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_macd_vis_line" ${d.showMACD ? 'checked' : ''}
             onchange="_macdDraft.showMACD = this.checked">
      <label for="_macd_vis_line">MACD Line</label>
    </div>
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_macd_vis_sig" ${d.showSignal ? 'checked' : ''}
             onchange="_macdDraft.showSignal = this.checked">
      <label for="_macd_vis_sig">Signal Line</label>
    </div>
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_macd_vis_hist" ${d.showHistogram ? 'checked' : ''}
             onchange="_macdDraft.showHistogram = this.checked">
      <label for="_macd_vis_hist">Histogram</label>
    </div>`;
}

// ─── Main render ───────────────────────────────────────────────
function _renderMACDModal() {
  if (!_macdDraft) return;
  const d = _macdDraft;
  const body = document.getElementById('macdSettingsBody');
  if (!body) return;

  const tabs = ['inputs', 'style', 'visibility'];
  const tabHtml = `
    <div class="ind-set-tabs">
      ${tabs.map(t => `
        <button class="ind-set-tab${_macdSettingsTab === t ? ' active' : ''}"
                onclick="_switchMACDTab('${t}')">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
    </div>`;

  let content = '';
  if (_macdSettingsTab === 'inputs')      content = _macdInputsTab();
  else if (_macdSettingsTab === 'style')  content = _macdStyleTab();
  else                                    content = _macdVisibilityTab();

  body.innerHTML = tabHtml + `<div class="ind-set-content">${content}</div>`;
}

// ─── Reset to defaults ─────────────────────────────────────────
function resetMACDSettings() {
  _macdDraft = Object.assign({}, MACD_DEFAULTS);
  _renderMACDModal();
}