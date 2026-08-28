/* ════════════════════════════════════════════════════════════
   candlestick-legend.js
   TradingView-style hover legend: shows symbol/OHLCV on the
   first line, then one line per active overlay/indicator with
   its live value(s) at the hovered (or latest) candle.

   Each indicator module (indicators/*.js) owns its own
   legendRowsXxx(candle) function and decides internally whether
   it's currently enabled — this file just calls them in order
   and stitches the HTML together.

   Depends on : candlestick-data.js, candlestick-draw.js, indicators/*.js
   Consumed by: candlestick-ui.js (mouse events call updateLegendHover)
   ════════════════════════════════════════════════════════════ */

let _legendHoverIdx = null; // index into the *visible* render window, or null

// ─── Collapsed/expanded state for the indicator row list ──────
// Collapsed by default (TradingView-style): only the symbol/OHLC
// rows show, plus a small "⌄ N" pill. Persisted like other prefs.
let _legendExpanded = (typeof _loadPref === 'function') ? _loadPref('legendExpanded', false) : false;

function toggleLegendExpanded() {
  _legendExpanded = !_legendExpanded;
  if (typeof _savePref === 'function') _savePref('legendExpanded', _legendExpanded);
  renderChartLegend();
}

function _legendToggleRow(count, expanded) {
  const chevron = expanded
    ? '<polyline points="18 15 12 9 6 15"></polyline>'
    : '<polyline points="6 9 12 15 18 9"></polyline>';
  const countBadge = !expanded ? `<span class="legend-toggle-count">${count}</span>` : '';
  return `<div class="legend-row legend-toggle" onclick="toggleLegendExpanded()" title="${expanded ? 'Hide indicators' : 'Show indicators'}">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">${chevron}</svg>${countBadge}
  </div>`;
}

// ─── Volume formatter (matches drawVolumeSection) ─────────────
function _legendFmtVol(v) {
  if (v == null || isNaN(v)) return '—';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(3) + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(3) + 'K';
  return Math.round(v).toString();
}

function _legendFmtPrice(v) {
  return (v == null || isNaN(v)) ? '—' : v.toFixed(2);
}

// ─── Resolve which candle the legend should describe ─────────
// Priority: hovered candle > replay cursor > latest visible candle.
function _legendResolveCandle() {
  const r = window._lastRender;
  if (!r || !r.visibleData || r.visibleData.length === 0) return null;

  let idx = r.visibleData.length - 1; // default: latest visible
  if (_legendHoverIdx != null && _legendHoverIdx >= 0 && _legendHoverIdx < r.visibleData.length) {
    idx = _legendHoverIdx;
  }
  return r.visibleData[idx];
}

// ─── Build one indicator row's HTML ───────────────────────────
// Shared helper used by every indicator module's legendRowsXxx().
//
// Deliberately READ-ONLY, no buttons: drawChart() calls renderChartLegend()
// on every crosshair move (i.e. near-continuous mousemove over the canvas —
// see setCrosshairPosition in candlestick-draw.js), which fully replaces
// #chartLegend's innerHTML each time. Any interactive element placed inside
// it gets destroyed and recreated as a new DOM node mid-gesture, so a click
// (which needs mousedown and mouseup on the same node) reliably fails to
// register. Show/hide and delete for indicators live exclusively in the
// Indicator Instance Bar (indicator-settings-modal.js), which only
// re-renders on actual state changes, never on hover — this row just shows
// opts.visible === false as a dimmed/muted state for information.
function _legendIndRow(label, parts, opts) {
  // parts: array of { val, color } — already-formatted strings
  const vals = parts
    .filter(p => p.val != null)
    .map(p => `<span class="legend-ind-val" style="color:${p.color}">${p.val}</span>`)
    .join('');
  if (!vals) return '';
  const muted = !!(opts && opts.visible === false);
  return `<div class="legend-row legend-indicator${muted ? ' legend-indicator-muted' : ''}">
    <span class="legend-ind-name">${label}</span>${vals}
  </div>`;
}

// ─── Main render ───────────────────────────────────────────────
function renderChartLegend() {
  const el = document.getElementById('chartLegend');
  if (!el) return;

  const candle = _legendResolveCandle();
  if (!candle) { el.style.display = 'none'; return; }

  const isGain   = candle.Close >= candle.Open;
  const changeColor = isGain ? 'var(--gain)' : 'var(--loss)';
  const prevCandle = (() => {
    const r = window._lastRender;
    if (!r) return null;
    const idx = r.visibleData.indexOf(candle);
    if (idx > 0) return r.visibleData[idx - 1];
    // fall back to full dataset previous candle
    const full = r.displayData;
    const gi = full ? full.indexOf(candle) : -1;
    return (full && gi > 0) ? full[gi - 1] : null;
  })();
  const refClose = prevCandle ? prevCandle.Close : candle.Open;
  const change    = candle.Close - refClose;
  const changePct = refClose ? (change / refClose) * 100 : 0;
  const sign = change >= 0 ? '+' : '';

  const tfLabel = currentTimeframe === 'weekly' ? '1W' : currentTimeframe === 'monthly' ? '1M' : '1D';
  const symbolName = (chartData[0] && chartData[0].Symbol) || 'BPML';
  const chartTypeLabel =
    chartType === 'heikinashi' ? 'Heikin-Ashi' :
    chartType === 'renko'      ? 'Renko'       :
    chartType === 'line'       ? 'Line'        :
    chartType === 'area'       ? 'Area'        :
    chartType === 'bars'       ? 'Bars'        :
    chartType === 'hollow'     ? 'Hollow'      : null;
  const replayBadge = replayMode ? `<span class="legend-sep">·</span><span class="legend-replay">⏵ REPLAY</span>` : '';
  const typeBadge = chartTypeLabel ? `<span class="legend-sep">·</span><span>${chartTypeLabel}</span>` : '';

  let html = `
    <div class="legend-row legend-symbol">
      <span class="legend-name">${symbolName}</span>
      <span class="legend-sep">·</span><span>${tfLabel}</span>
      <span class="legend-sep">·</span><span>DSE</span>${typeBadge}${replayBadge}
      <span class="legend-dot"></span>
    </div>
    <div class="legend-row legend-ohlc" style="color:${changeColor}">
      <span class="legend-v"><span class="legend-k">O</span>${_legendFmtPrice(candle.Open)}</span>
      <span class="legend-v"><span class="legend-k">H</span>${_legendFmtPrice(candle.High)}</span>
      <span class="legend-v"><span class="legend-k">L</span>${_legendFmtPrice(candle.Low)}</span>
      <span class="legend-v"><span class="legend-k">C</span>${_legendFmtPrice(candle.Close)}</span>
      <span class="legend-v">${sign}${change.toFixed(2)} (${sign}${changePct.toFixed(2)}%)</span>
      <span class="legend-v"><span class="legend-k">Vol</span>${_legendFmtVol(candle.Volume)}</span>
    </div>`;

  // ── Per-indicator rows — each module knows when it applies ────
  // EMA/SMA/Bollinger Bands/Ichimoku Cloud/Supertrend are now
  // multi-instance — one legend row per active instance.
  let indicatorHtml = '';
  if (typeof legendRowsIndicatorInstances === 'function') indicatorHtml += legendRowsIndicatorInstances(candle);
  indicatorHtml += legendRowsMACD(candle);
  indicatorHtml += legendRowsRSI(candle);
  indicatorHtml += legendRowsHilegaMilega(candle);

  // ── Active strategy row, if any (independent of indicator state) ──
  indicatorHtml += legendRowsActiveStrategy(candle);

  const indicatorCount = (indicatorHtml.match(/class="legend-row legend-indicator/g) || []).length;
  if (indicatorCount > 0) {
    html += _legendExpanded ? indicatorHtml + _legendToggleRow(indicatorCount, true) : _legendToggleRow(indicatorCount, false);
  }

  el.innerHTML = html;
  el.style.display = 'block';
}

// ─── Hover index resolution from a mouse/canvas X position ────
// Mirrors the candleWidth math used in drawChart()'s visible window.
function updateLegendHover(clientX, clientY) {
  const canvas = document.getElementById('candleCanvas');
  const r = window._lastRender;
  if (!canvas || !r) return;

  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  // Only react within the price pane's horizontal extent & overall vertical bounds
  if (y < 0 || y > rect.height) { clearLegendHover(); return; }

  const localX = x - r.padding.left;
  const idx = Math.floor(localX / r.candleWidth);

  if (idx < 0 || idx >= r.visibleData.length) {
    clearLegendHover();
    return;
  }

  _legendHoverIdx = idx;
  renderChartLegend();
}

function clearLegendHover() {
  if (_legendHoverIdx === null) { renderChartLegend(); return; }
  _legendHoverIdx = null;
  renderChartLegend();
}