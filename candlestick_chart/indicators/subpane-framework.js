/* ════════════════════════════════════════════════════════════
   indicators/subpane-framework.js
   Generic stacked sub-pane renderer for multi-instance indicators
   registered in INDICATOR_DEFS (indicator-instances.js) with
   `isSubPane: true`. Replaces having to hand-write a bespoke
   ~150-230 line pane (grid, y-axis labels, zero-line, drag-to-
   zoom, legend) per oscillator the way MACD/RSI/Hilega-Milega
   still do — those three stay on their existing bespoke path
   untouched; every *new* sub-pane indicator (Stochastic, ADX,
   OBV, ...) plugs into this one instead.

   One pane per indicator TYPE, not per instance: two Stochastic
   instances (different lengths) share one "Stochastic" pane, the
   same way multiple EMAs share the price pane. A def's `paneKey`
   is therefore both its enabledIndicators/paneOrder entry AND its
   paneHeights/paneVZoom key (see GENERIC_SUBPANE_KEYS in
   candlestick-draw.js).

   A def opts into this framework with:
     isSubPane:  true
     paneKey:    short id, e.g. 'stoch' — must be listed in
                 GENERIC_SUBPANE_KEYS (candlestick-draw.js)
     paneLabel:  title drawn top-left of the pane, e.g. 'Stochastic'
     rangeMode:  'fixed' | 'auto'
       'fixed'  needs `fixedRange: [min, max]` (e.g. [0, 100]);
                zoom stretches/compresses around the range's own
                midpoint (RSI's convention).
       'auto'   scans every active instance's series for min/max,
                always including 0, +15% padding (MACD's convention).
     refLines:   optional array of numbers to draw as dashed guide
                 lines with labels (e.g. [20, 80] for Stochastic).
     zeroLine:   optional bool — draw a dashed line at 0.
     seriesStyle: { <computeKey>: { type: 'line', colorKey } |
                                   { type: 'histogram', upColorKey, downColorKey } }
                 `computeKey` must match a key compute() returns;
                 `colorKey`/`upColorKey`/`downColorKey` name fields
                 on the instance's `style` (must start with "color"
                 so the generic Style tab picks them up for free —
                 see indicator-settings-modal.js:_renderStyleTab).
     drawPane(ctx, visibleData, instance, paneGeom): optional escape
                 hatch for indicators whose rendering isn't a plain
                 line/histogram set (e.g. sign-dependent line colour).
                 When present, called INSTEAD of the seriesStyle loop
                 for that instance (chrome/range/legend still generic).

   Depends on : indicator-instances.js (INDICATOR_DEFS,
                indicatorInstances, applyLineStyle, _hexToRgba),
                candlestick-data.js (paneVZoom, collapsedPanes)
   Consumed by: candlestick-draw.js (drawChart's sub-pane dispatch)
   ════════════════════════════════════════════════════════════ */

const _spfTheme = window.DSEChartTheme;
const _spfFont  = spec => (_spfTheme ? _spfTheme.font(spec) : spec);

// Instances belonging to one paneKey, in creation order.
function _subPaneInstances(paneKey) {
  return indicatorInstances.filter(inst => {
    const def = INDICATOR_DEFS[inst.typeId];
    return def && def.isSubPane && def.paneKey === paneKey;
  });
}

// ─── Range computation ──────────────────────────────────────────
function _computeSubPaneRange(def, visibleInstances, visibleData) {
  const zoom = (typeof paneVZoom !== 'undefined') ? (paneVZoom[def.paneKey] || 1) : 1;

  if (def.rangeMode === 'fixed') {
    const [lo, hi] = def.fixedRange;
    const mid = (lo + hi) / 2;
    const halfSpan = ((hi - lo) / 2) / zoom;
    return { minVal: mid - halfSpan, maxVal: mid + halfSpan };
  }

  // 'auto' always includes 0 in the range (MACD's convention — right for
  // anything that oscillates around a zero baseline). 'auto-tight' fits only
  // the actual data (no forced 0) — for indicators centered elsewhere, e.g.
  // Vortex (~1.0) or magnitude-only series like Mass Index/ATR/Std Dev,
  // where padding out to 0 would squash the real variation.
  let maxVal = def.rangeMode === 'auto-tight' ? -Infinity : 0;
  let minVal = def.rangeMode === 'auto-tight' ? Infinity : 0;
  visibleInstances.forEach(instance => {
    Object.keys(def.seriesStyle || {}).forEach(key => {
      const field = `${instance.id}_${key}`;
      visibleData.forEach(c => {
        const v = c[field];
        if (v != null) { maxVal = Math.max(maxVal, v); minVal = Math.min(minVal, v); }
      });
    });
  });
  if (!isFinite(maxVal) || !isFinite(minVal)) { maxVal = 1; minVal = 0; }
  const range = (maxVal - minVal) || 1;
  const padRange = range * 0.15;
  maxVal += padRange;
  minVal -= padRange;
  const mid = (maxVal + minVal) / 2;
  const halfSpan = ((maxVal - minVal) / 2) / zoom;
  return { minVal: mid - halfSpan, maxVal: mid + halfSpan };
}

// ─── Series drawing (line / histogram) ──────────────────────────
function _drawSubPaneLine(ctx, visibleData, field, color, lineWidth, lineStyle, geom) {
  const { candleWidth, padding, valueToY } = geom;
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth || 1.5;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  applyLineStyle(ctx, lineStyle);
  ctx.beginPath();
  let started = false;
  visibleData.forEach((candle, idx) => {
    const v = candle[field];
    if (v == null) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = valueToY(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function _drawSubPaneHistogram(ctx, visibleData, field, upColor, downColor, geom) {
  const { candleWidth, spacing, padding, valueToY } = geom;
  const zeroY = valueToY(0);
  visibleData.forEach((candle, idx) => {
    const v = candle[field];
    if (v == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = valueToY(v);
    const barW = Math.max(1, spacing * 0.7);
    ctx.fillStyle = _hexToRgba(v >= 0 ? upColor : downColor, 0.55);
    ctx.fillRect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(zeroY - y));
  });
}

function _drawSubPaneInstance(ctx, visibleData, def, instance, geom) {
  if (typeof def.drawPane === 'function') { def.drawPane(ctx, visibleData, instance, geom); return; }
  Object.keys(def.seriesStyle || {}).forEach(key => {
    const spec  = def.seriesStyle[key];
    const field = `${instance.id}_${key}`;
    if (spec.type === 'histogram') {
      _drawSubPaneHistogram(ctx, visibleData, field, instance.style[spec.upColorKey], instance.style[spec.downColorKey], geom);
    } else {
      _drawSubPaneLine(ctx, visibleData, field, instance.style[spec.colorKey], instance.style.lineWidth, instance.style.lineStyle, geom);
    }
  });
}

// ─── End-of-line value labels (mirrors MACD's inline labels) ────
function _drawSubPaneEndLabels(ctx, visibleData, def, visibleInstances, geom) {
  const lastIdx = visibleData.length - 1;
  if (lastIdx < 0) return;
  const candle = visibleData[lastIdx];
  const x = geom.padding.left + (lastIdx + 0.5) * geom.candleWidth;
  const labelX = Math.min(x + 8, geom.width - geom.padding.right - 46);
  ctx.font = _spfFont('bold 10px "DM Sans", sans-serif');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let row = 0;
  visibleInstances.forEach(instance => {
    Object.keys(def.seriesStyle || {}).forEach(key => {
      if (def.seriesStyle[key].type === 'histogram') return; // too noisy to label every bar
      const v = candle[`${instance.id}_${key}`];
      if (v == null) return;
      const colorKey = def.seriesStyle[key].colorKey;
      ctx.fillStyle = instance.style[colorKey] || '#fff';
      ctx.fillText(v.toFixed(2), labelX, geom.startY + 15 + row * 14);
      row++;
    });
  });
}

// ─── Main pane draw entry point ──────────────────────────────────
function drawGenericSubPane(ctx, paneKey, visibleData, width, height, candleWidth, spacing, padding, startY) {
  const allInstances = _subPaneInstances(paneKey);
  if (allInstances.length === 0) return;
  const def = INDICATOR_DEFS[allInstances[0].typeId];
  const visibleInstances = allInstances.filter(inst => inst.style.visible);

  const { minVal, maxVal } = _computeSubPaneRange(def, visibleInstances, visibleData);
  const chartHeight = height - 20;
  const valueToY = v => startY + chartHeight * (1 - (v - minVal) / (maxVal - minVal || 1));
  const geom = { width, height, candleWidth, spacing, padding, startY, chartHeight, valueToY };

  const isLightMode = document.documentElement.classList.contains('light-mode');
  const gridColor  = isLightMode ? 'rgba(0,0,0,0.08)'  : 'rgba(255,255,255,0.05)';
  const textColor  = isLightMode ? 'rgba(0,0,0,0.6)'   : 'rgba(160,174,192,0.6)';
  const labelColor = isLightMode ? 'rgba(0,0,0,0.8)'   : 'rgba(160,174,192,0.95)';

  // ── Grid lines & labels ─────────────────────────────────────
  ctx.font = _spfFont('9px "DM Sans", sans-serif');
  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;

  if (def.rangeMode === 'fixed' && def.refLines && def.refLines.length) {
    const levels = [def.fixedRange[0], ...def.refLines, def.fixedRange[1]];
    levels.forEach(level => {
      const y = valueToY(level);
      ctx.strokeStyle = def.refLines.includes(level) ? 'rgba(255,255,255,0.10)' : gridColor;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillText(String(level), width - padding.right + 10, y + 3);
    });
  } else {
    for (let i = 0; i <= 4; i++) {
      const val = minVal + (maxVal - minVal) * (i / 4);
      const y = valueToY(val);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(1), width - padding.right + 10, y + 3);
    }
    // Auto-range indicators (CCI, Ultimate Oscillator's neighbours, etc.) can
    // still declare conventional overbought/oversold guide lines — drawn on
    // top of the evenly-spaced grid, skipped if the current zoom pushed them
    // out of view.
    if (def.refLines && def.refLines.length) {
      ctx.font = _spfFont('9px "DM Sans", sans-serif');
      def.refLines.forEach(level => {
        if (level < minVal || level > maxVal) return;
        const y = valueToY(level);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = textColor;
        ctx.fillText(String(level), width - padding.right + 10, y + 3);
      });
    }
  }

  if (def.zeroLine && minVal < 0 && maxVal > 0) {
    const zY = valueToY(0);
    ctx.strokeStyle = isLightMode ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padding.left, zY);
    ctx.lineTo(width - padding.right, zY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Pane title ───────────────────────────────────────────────
  ctx.font = _spfFont('bold 10px "DM Sans", sans-serif');
  ctx.fillStyle = labelColor;
  ctx.textAlign = 'right';
  ctx.fillText(def.paneLabel || def.label, padding.left - 8, startY + 15);

  // ── Series ───────────────────────────────────────────────────
  visibleInstances.forEach(instance => _drawSubPaneInstance(ctx, visibleData, def, instance, geom));
  _drawSubPaneEndLabels(ctx, visibleData, def, visibleInstances, geom);
}

// Shared `legendRows(instance, candle)` building block for sub-pane defs —
// mutes the row when either the instance itself is hidden or its whole pane
// is collapsed, mirroring legendRowsMACD's `collapsedPanes` check.
function _subPaneLegendOpts(instance) {
  const def = INDICATOR_DEFS[instance.typeId];
  const collapsed = (typeof collapsedPanes !== 'undefined') && def && collapsedPanes.includes(def.paneKey);
  return { instanceId: instance.id, visible: instance.style.visible && !collapsed };
}
