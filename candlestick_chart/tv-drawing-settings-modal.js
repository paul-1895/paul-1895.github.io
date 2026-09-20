/* ════════════════════════════════════════════════════════════
   tv-drawing-settings-modal.js
   TradingView-style "double-click a trend line" settings modal
   (Style / Text / Coordinates / Visibility tabs) for the line-family
   drawing tools in tv-drawing-tools.js (trend line, ray, extended
   line, trend angle, horizontal line, horizontal ray, vertical line,
   cross line).

   Mirrors indicator-settings-modal.js's authoring pattern (plain
   top-level state + functions, draft-copy-committed-on-Ok) but reads
   and writes actual drawing objects through window.TVDrawingsAPI,
   since userDrawings/saveDrawings live inside tv-drawing-tools.js's
   own IIFE.

   Depends on : tv-drawing-tools.js (window.TVDrawingsAPI)
   Consumed by: candlestick.html (#drawingSettingsModal container)
   ════════════════════════════════════════════════════════════ */

let _dsDraftId = null;
let _dsDraft   = null; // working copy of {style, text, visibility, pts}, committed on Ok
let _dsTab     = 'style';

// ─── Open / close / commit ────────────────────────────────────────
function openDrawingSettings(id) {
  const api = window.TVDrawingsAPI;
  const modalEl = document.getElementById('drawingSettingsModal');
  if (!api || !modalEl) return;
  const d = api.getDrawing(id);
  if (!d) return;
  api.ensureDrawingExtras(d);
  _dsDraftId = id;
  _dsTab     = 'style';
  _dsDraft   = {
    type: d.type,
    style: JSON.parse(JSON.stringify(d.style)),
    text: JSON.parse(JSON.stringify(d.text)),
    visibility: JSON.parse(JSON.stringify(d.visibility)),
    pts: JSON.parse(JSON.stringify(d.pts)),
    effective: api.effectiveStyle(d), // resolved (never-null) values, for prefilling inputs
  };
  _renderDrawingSettingsModal();
  modalEl.style.display = 'flex';
}

function closeDrawingSettings() {
  const modalEl = document.getElementById('drawingSettingsModal');
  if (modalEl) modalEl.style.display = 'none';
  _dsDraftId = null;
  _dsDraft = null;
}

function _commitDrawingSettings() {
  const api = window.TVDrawingsAPI;
  if (!api || !_dsDraftId || !_dsDraft) return;
  const d = api.getDrawing(_dsDraftId);
  if (d) {
    d.style = _dsDraft.style;
    d.text = _dsDraft.text;
    d.visibility = _dsDraft.visibility;
    d.pts = _dsDraft.pts;
    api.saveDrawings();
    api.redraw();
  }
  closeDrawingSettings();
}

function _switchDrawingSettingsTab(tab) {
  _dsTab = tab;
  _renderDrawingSettingsModal();
}

function _isOnePointDrawing() {
  const api = window.TVDrawingsAPI;
  return !!(api && _dsDraft && api.ONE_POINT_LINE_TYPES.has(_dsDraft.type));
}

function _dsRerender() { _renderDrawingSettingsModal(); }

// ─── Style tab ─────────────────────────────────────────────────────
const DS_LINE_STYLE_ICONS = {
  solid:  '<svg viewBox="0 0 32 12" width="32" height="12"><line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" stroke-width="2"/></svg>',
  dashed: '<svg viewBox="0 0 32 12" width="32" height="12"><line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" stroke-width="2" stroke-dasharray="5,4"/></svg>',
  dotted: '<svg viewBox="0 0 32 12" width="32" height="12"><line x1="2" y1="6" x2="30" y2="6" stroke="currentColor" stroke-width="2" stroke-dasharray="1,4" stroke-linecap="round"/></svg>',
};

function _renderDsStyleTab() {
  const style = _dsDraft.style;
  const eff = _dsDraft.effective;
  const onePoint = _isOnePointDrawing();
  let html = `
    <div class="ind-set-row ind-set-style-row">
      <span class="ind-set-style-label">Line</span>
      <input type="color" value="${eff.color}" class="ind-set-color"
             onchange="_dsDraft.style.color = this.value">
      <div class="ds-linestyle-group">
        ${['solid', 'dashed', 'dotted'].map(ls => `
          <button type="button" class="ds-linestyle-btn${eff.lineStyle === ls ? ' active' : ''}"
                  title="${ls.charAt(0).toUpperCase() + ls.slice(1)}"
                  onclick="_dsDraft.style.lineStyle = '${ls}'; _dsDraft.effective.lineStyle = '${ls}'; _dsRerender();">
            ${DS_LINE_STYLE_ICONS[ls]}
          </button>`).join('')}
      </div>
    </div>
    <div class="ind-set-row">
      <label>Line width</label>
      <input type="number" min="1" max="6" value="${eff.lineWidth}"
             onchange="_dsDraft.style.lineWidth = parseFloat(this.value) || 1">
    </div>`;

  if (!onePoint) {
    html += `
      <div class="ind-set-divider"></div>
      <div class="ind-set-row ind-set-checkbox-row">
        <input type="checkbox" id="_ds_extLeft" ${style.extendLeft ? 'checked' : ''}
               onchange="_dsDraft.style.extendLeft = this.checked">
        <label for="_ds_extLeft">Extend left line</label>
      </div>
      <div class="ind-set-row ind-set-checkbox-row">
        <input type="checkbox" id="_ds_extRight" ${style.extendRight ? 'checked' : ''}
               onchange="_dsDraft.style.extendRight = this.checked">
        <label for="_ds_extRight">Extend right line</label>
      </div>
      <div class="ind-set-row ind-set-checkbox-row">
        <input type="checkbox" id="_ds_mid" ${style.midPoint ? 'checked' : ''}
               onchange="_dsDraft.style.midPoint = this.checked">
        <label for="_ds_mid">Middle point</label>
      </div>`;
  }
  html += `
    <div class="ind-set-row ind-set-checkbox-row">
      <input type="checkbox" id="_ds_priceLabels" ${style.priceLabels ? 'checked' : ''}
             onchange="_dsDraft.style.priceLabels = this.checked">
      <label for="_ds_priceLabels">Price labels</label>
    </div>`;

  if (!onePoint) {
    const stats = style.stats;
    const statRow = (key, label) => `
      <div class="ind-set-row ind-set-checkbox-row">
        <input type="checkbox" id="_ds_stat_${key}" ${stats[key] ? 'checked' : ''}
               onchange="_dsDraft.style.stats.${key} = this.checked">
        <label for="_ds_stat_${key}">${label}</label>
      </div>`;
    html += `
      <div class="ind-set-divider"></div>
      <div class="ds-section-label">STATS</div>
      ${statRow('priceRange', 'Price range')}
      ${statRow('barsRange', 'Bars range')}
      ${statRow('dateTimeRange', 'Date/time range')}
      ${statRow('distance', 'Distance')}
      ${statRow('angle', 'Angle')}
      ${statRow('always', 'Always show stats')}
      <div class="ind-set-row">
        <label>Stats position</label>
        <select onchange="_dsDraft.style.stats.position = this.value">
          <option value="left"${stats.position === 'left' ? ' selected' : ''}>Left</option>
          <option value="right"${stats.position === 'right' ? ' selected' : ''}>Right</option>
        </select>
      </div>`;
  }
  return html;
}

// ─── Text tab ──────────────────────────────────────────────────────
function _renderDsTextTab() {
  const text = _dsDraft.text;
  return `
    <div class="ind-set-row ind-set-style-row">
      <input type="checkbox" id="_ds_textEnabled" ${text.enabled ? 'checked' : ''}
             onchange="_dsDraft.text.enabled = this.checked">
      <label for="_ds_textEnabled" class="ind-set-style-label">Text</label>
      <input type="color" value="${text.color}" class="ind-set-color"
             onchange="_dsDraft.text.color = this.value">
      <select onchange="_dsDraft.text.fontSize = parseInt(this.value, 10)">
        ${[10, 11, 12, 13, 14, 16, 18, 20, 24].map(sz => `<option value="${sz}"${text.fontSize === sz ? ' selected' : ''}>${sz}</option>`).join('')}
      </select>
      <button type="button" class="ds-toggle-btn${text.bold ? ' active' : ''}" title="Bold"
              onclick="_dsDraft.text.bold = !_dsDraft.text.bold; _dsRerender();"><b>B</b></button>
      <button type="button" class="ds-toggle-btn${text.italic ? ' active' : ''}" title="Italic"
              onclick="_dsDraft.text.italic = !_dsDraft.text.italic; _dsRerender();"><i>I</i></button>
    </div>
    <textarea class="ds-textarea" placeholder="Label text"
              oninput="_dsDraft.text.content = this.value">${(text.content || '').replace(/</g, '&lt;')}</textarea>
    <div class="ind-set-row">
      <label>Text alignment</label>
      <select onchange="_dsDraft.text.vAlign = this.value">
        <option value="top"${text.vAlign === 'top' ? ' selected' : ''}>Top</option>
        <option value="middle"${text.vAlign === 'middle' ? ' selected' : ''}>Middle</option>
        <option value="bottom"${text.vAlign === 'bottom' ? ' selected' : ''}>Bottom</option>
      </select>
      <select onchange="_dsDraft.text.hAlign = this.value">
        <option value="left"${text.hAlign === 'left' ? ' selected' : ''}>Left</option>
        <option value="center"${text.hAlign === 'center' ? ' selected' : ''}>Center</option>
        <option value="right"${text.hAlign === 'right' ? ' selected' : ''}>Right</option>
      </select>
    </div>`;
}

// ─── Coordinates tab ───────────────────────────────────────────────
function _renderDsCoordinatesTab() {
  const pts = _dsDraft.pts;
  return pts.map((p, i) => `
    <div class="ind-set-row">
      <label>#${i + 1} (price, bar)</label>
      <input type="number" step="0.01" value="${p.price}"
             onchange="_dsDraft.pts[${i}].price = parseFloat(this.value) || 0" style="max-width:100px;">
      <input type="number" step="1" value="${Math.round(p.index)}"
             onchange="_dsDraft.pts[${i}].index = parseInt(this.value, 10) || 0" style="max-width:80px;">
    </div>`).join('');
}

// ─── Visibility tab (Days / Weeks / Months — this app has no intraday
//     data, so Minutes/Hours rows from the TradingView original are
//     dropped; each checkbox is live-wired to real show/hide behavior,
//     unlike the indicator settings modal's cosmetic Visibility tab). ──
const DS_VISIBILITY_ROWS = [
  { key: 'days', label: 'Days', min: 1, max: 366 },
  { key: 'weeks', label: 'Weeks', min: 1, max: 52 },
  { key: 'months', label: 'Months', min: 1, max: 12 },
];

function _renderDsVisibilityTab() {
  const vis = _dsDraft.visibility;
  return DS_VISIBILITY_ROWS.map(row => `
    <div class="ind-set-vis-row">
      <input type="checkbox" ${vis[row.key] ? 'checked' : ''}
             onchange="_dsDraft.visibility.${row.key} = this.checked">
      <span class="ind-set-vis-label">${row.label}</span>
      <span class="ind-set-vis-range">
        <input type="number" value="${row.min}" disabled>
        <span class="ind-set-vis-slider"></span>
        <input type="number" value="${row.max}" disabled>
      </span>
    </div>`).join('');
}

// ─── Main modal render ─────────────────────────────────────────────
const DS_TYPE_LABELS = {
  trendline: 'Trend Line', ray: 'Ray', extendedline: 'Extended Line', trendangle: 'Trend Angle',
  hline: 'Horizontal Line', hray: 'Horizontal Ray', vline: 'Vertical Line', crossline: 'Cross Line',
};

function _renderDrawingSettingsModal() {
  if (!_dsDraft) return;
  const titleEl = document.getElementById('drawingSettingsTitle');
  if (titleEl) titleEl.textContent = DS_TYPE_LABELS[_dsDraft.type] || 'Line';

  const tabHtml = `
    <div class="ind-set-tabs">
      <button class="ind-set-tab${_dsTab === 'style' ? ' active' : ''}" onclick="_switchDrawingSettingsTab('style')">Style</button>
      <button class="ind-set-tab${_dsTab === 'text' ? ' active' : ''}" onclick="_switchDrawingSettingsTab('text')">Text</button>
      <button class="ind-set-tab${_dsTab === 'coordinates' ? ' active' : ''}" onclick="_switchDrawingSettingsTab('coordinates')">Coordinates</button>
      <button class="ind-set-tab${_dsTab === 'visibility' ? ' active' : ''}" onclick="_switchDrawingSettingsTab('visibility')">Visibility</button>
    </div>`;

  let contentHtml = '';
  if (_dsTab === 'style') contentHtml = _renderDsStyleTab();
  else if (_dsTab === 'text') contentHtml = _renderDsTextTab();
  else if (_dsTab === 'coordinates') contentHtml = _renderDsCoordinatesTab();
  else contentHtml = _renderDsVisibilityTab();

  const body = document.getElementById('drawingSettingsBody');
  if (body) body.innerHTML = tabHtml + `<div class="ind-set-content">${contentHtml}</div>`;
}
