/* ════════════════════════════════════════════════════════════
   indicator-instances.js
   Generic multi-instance indicator system.

   Replaces the old single-toggle model (activeMA pills in the
   toolbar) with TradingView-style indicator INSTANCES: each time
   you "Add" an indicator from the modal, a new independent
   instance is created with its own id, inputs (length, source,
   offset...), style (color, line width, line style, visibility
   checkboxes), and per-timeframe visibility. Multiple instances
   of the same indicator type (e.g. two EMAs) can coexist.

   This file owns:
     - the instance store (indicatorInstances[])
     - create / remove / update instance
     - the per-type "definition" registry (INDICATOR_DEFS) that
       describes what inputs/style fields each indicator type has,
       and how to compute + draw it
     - the generic settings modal (Inputs / Style / Visibility tabs)
     - the indicator instance bar under the toolbar (one pill per
       instance, with eye / target / braces / trash / more buttons)
     - persistence (localStorage), following the same _loadPref/
       _savePref pattern already used in candlestick-data.js

   Depends on : candlestick-data.js (_loadPref, _savePref, chartData),
                indicators/*.js (calculateSMA, calculateEMA, etc. —
                reused for the actual math)
   Consumed by: candlestick-draw.js (drawIndicatorInstances),
                candlestick-legend.js (legendRowsIndicatorInstances),
                candlestick.html (renders the instance bar container)
   ════════════════════════════════════════════════════════════ */

// ─── Source resolution (Open/High/Low/Close/HL2/HLC3/OHLC4) ───
const SOURCE_OPTIONS = ['Open', 'High', 'Low', 'Close', 'HL2', 'HLC3', 'OHLC4', 'HL/2'];

function resolveSource(candle, source) {
  switch (source) {
    case 'Open':  return candle.Open;
    case 'High':  return candle.High;
    case 'Low':   return candle.Low;
    case 'Close': return candle.Close;
    case 'HL2':
    case 'HL/2':  return (candle.High + candle.Low) / 2;
    case 'HLC3':  return (candle.High + candle.Low + candle.Close) / 3;
    case 'OHLC4': return (candle.Open + candle.High + candle.Low + candle.Close) / 4;
    default:      return candle.Close;
  }
}

function getSourceSeries(data, source) {
  return data.map(c => resolveSource(c, source));
}

// ─── Line style helpers (solid / dashed / dotted) ──────────────
function applyLineStyle(ctx, lineStyle) {
  if (lineStyle === 'dashed') ctx.setLineDash([6, 4]);
  else if (lineStyle === 'dotted') ctx.setLineDash([2, 3]);
  else ctx.setLineDash([]);
}

// ─── Indicator type definitions ────────────────────────────────
// Each entry describes one indicator TYPE. Instances reference a
// typeId and carry their own copy of `inputs`/`style`.
//
//   inputs:  fields shown on the "Inputs" tab. Each instance gets
//            its own values, seeded from `defaultInputs`.
//   style:   fields shown on the "Style" tab (per output line/band).
//            Each instance gets its own values, seeded from
//            `defaultStyle`.
//   compute(data, inputs): returns an object of computed series
//            (e.g. { ema: [...] }) — values written onto each
//            candle as candle[`${instanceId}_ema`] etc. by
//            attachIndicatorInstances().
//   draw(ctx, visibleData, instance, geom): renders the instance's
//            line(s)/band(s) into the price pane. `geom` carries
//            {width,height,candleWidth,padding,minPrice,maxPrice}.
//   legendRows(instance, candle): returns legend HTML for this
//            instance at the given candle, or '' if nothing to show.
//   isSubPane: true for indicators that get their own pane (not
//            used yet in this pass — MACD/RSI/HM stay on the old
//            single-instance path for now).
const INDICATOR_DEFS = {

  EMA: {
    label: 'EMA',
    defaultInputs: { length: 9, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#2962FF', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const ema = calculateEMA(src, Math.max(1, inputs.length || 9));
      return { ema };
    },
    draw(ctx, visibleData, instance, geom) {
      _drawSingleLine(ctx, visibleData, `${instance.id}_ema`, instance, geom);
    },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_ema`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`EMA ${instance.inputs.length}`, [
        { val: _legendFmtPrice(v), color: instance.style.color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  SMA: {
    label: 'SMA',
    defaultInputs: { length: 9, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#FF6D00', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const sma = calculateSMA(src, Math.max(1, inputs.length || 9));
      return { sma };
    },
    draw(ctx, visibleData, instance, geom) {
      _drawSingleLine(ctx, visibleData, `${instance.id}_sma`, instance, geom);
    },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_sma`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`MA ${instance.inputs.length}`, [
        { val: _legendFmtPrice(v), color: instance.style.color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Bollinger Bands': {
    label: 'Bollinger Bands',
    defaultInputs: { length: 20, source: 'Close', stdDev: 2, offset: 0 },
    defaultStyle:  {
      color: '#00D4FF', lineWidth: 1, lineStyle: 'dashed', visible: true,
      showLabelOnAxis: true, showInLegend: true, fillOpacity: 0.15,
    },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const bb  = calculateBollingerBands(src, Math.max(1, inputs.length || 20), inputs.stdDev || 2);
      return { upper: bb.upper, middle: bb.middle, lower: bb.lower };
    },
    draw(ctx, visibleData, instance, geom) {
      _drawBollingerInstance(ctx, visibleData, instance, geom);
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const u = candle[`${instance.id}_upper`], m = candle[`${instance.id}_middle`], l = candle[`${instance.id}_lower`];
      if (u == null) return '';
      return _legendIndRow(`BB ${instance.inputs.length} ${instance.inputs.stdDev}`, [
        { val: _legendFmtPrice(u), color: instance.style.color },
        { val: _legendFmtPrice(m), color: instance.style.color },
        { val: _legendFmtPrice(l), color: instance.style.color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Ichimoku Cloud': {
    label: 'Ichimoku Cloud',
    defaultInputs: { tenkan: 9, kijun: 26, senkouB: 52, displacement: 26 },
    defaultStyle:  {
      colorA: '#26a69a', colorB: '#ef5350', colorTenkan: '#2196F3', colorKijun: '#FF5722',
      lineWidth: 1, lineStyle: 'solid', visible: true, showInLegend: true,
    },
    compute(data, inputs) {
      return calculateIchimoku(data, inputs.tenkan || 9, inputs.kijun || 26, inputs.senkouB || 52);
    },
    draw(ctx, visibleData, instance, geom) {
      _drawIchimokuInstance(ctx, visibleData, instance, geom);
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const t = candle[`${instance.id}_tenkan`];
      if (t == null) return '';
      return _legendIndRow(`Ichimoku ${instance.inputs.tenkan} ${instance.inputs.kijun} ${instance.inputs.senkouB}`, [
        { val: _legendFmtPrice(t),                              color: instance.style.colorTenkan },
        { val: _legendFmtPrice(candle[`${instance.id}_kijun`]),  color: instance.style.colorKijun },
        { val: _legendFmtPrice(candle[`${instance.id}_senkouA`]),color: instance.style.colorA },
        { val: _legendFmtPrice(candle[`${instance.id}_senkouB`]),color: instance.style.colorB },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  Supertrend: {
    label: 'Supertrend',
    defaultInputs: { atrPeriod: 10, factor: 3 },
    defaultStyle:  { colorUp: '#10b981', colorDown: '#ef4444', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    compute(data, inputs) {
      const result = calculateSupertrend(data, inputs.atrPeriod || 10, inputs.factor || 3);
      return { supertrend: result.supertrend, trend: result.trend };
    },
    draw(ctx, visibleData, instance, geom) {
      _drawSupertrendInstance(ctx, visibleData, instance, geom);
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_supertrend`];
      if (v == null) return '';
      const trend = candle[`${instance.id}_trend`];
      const color = trend === 1 ? instance.style.colorUp : instance.style.colorDown;
      return _legendIndRow(`Supertrend ${instance.inputs.atrPeriod} ${instance.inputs.factor}`, [
        { val: v.toFixed(2), color },
        { val: trend === 1 ? 'UP' : 'DOWN', color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },
};

// ─── Instance store ─────────────────────────────────────────────
let indicatorInstances = _loadPref('indicatorInstances', []);
let _instanceCounter    = _loadPref('_instanceCounter', 0);

function saveIndicatorInstances() {
  _savePref('indicatorInstances', indicatorInstances);
  _savePref('_instanceCounter', _instanceCounter);
}

function createIndicatorInstance(typeId) {
  const def = INDICATOR_DEFS[typeId];
  if (!def) return null;
  _instanceCounter += 1;
  const instance = {
    id:     'ind_' + _instanceCounter,
    typeId,
    inputs: { ...def.defaultInputs },
    style:  { ...def.defaultStyle },
    visibility: { ticks: true, seconds: true, minutes: true, hours: true, days: true, weeks: true, months: true, ranges: true },
  };
  indicatorInstances.push(instance);
  saveIndicatorInstances();
  if (typeof attachIndicatorInstances === 'function' && typeof chartData !== 'undefined') {
    attachIndicatorInstances(chartData);
    if (typeof aggregatedData !== 'undefined' && aggregatedData.length) attachIndicatorInstances(aggregatedData);
  }
  return instance;
}

function removeIndicatorInstance(id) {
  indicatorInstances = indicatorInstances.filter(inst => inst.id !== id);
  saveIndicatorInstances();
}

function getIndicatorInstance(id) {
  return indicatorInstances.find(inst => inst.id === id) || null;
}

function updateIndicatorInstance(id, patch) {
  const inst = getIndicatorInstance(id);
  if (!inst) return;
  if (patch.inputs) Object.assign(inst.inputs, patch.inputs);
  if (patch.style)  Object.assign(inst.style, patch.style);
  if (patch.visibility) Object.assign(inst.visibility, patch.visibility);
  saveIndicatorInstances();
  if (typeof attachIndicatorInstances === 'function' && typeof chartData !== 'undefined') {
    attachIndicatorInstances(chartData);
    if (typeof aggregatedData !== 'undefined' && aggregatedData.length) attachIndicatorInstances(aggregatedData);
  }
}

// ─── Attach computed values to candle data ─────────────────────
// Called alongside attachIndicators() in candlestick-data.js.
function attachIndicatorInstances(data) {
  indicatorInstances.forEach(instance => {
    const def = INDICATOR_DEFS[instance.typeId];
    if (!def) return;
    const series = def.compute(data, instance.inputs);
    data.forEach((candle, i) => {
      Object.keys(series).forEach(key => {
        candle[`${instance.id}_${key}`] = series[key][i];
      });
    });
  });
}

// ─── Drawing entry point (called from drawPriceSection) ────────
function drawIndicatorInstancesOverlay(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  const geom = { width, height, candleWidth, padding, minPrice, maxPrice };
  indicatorInstances.forEach(instance => {
    if (!instance.style.visible) return;
    const def = INDICATOR_DEFS[instance.typeId];
    if (!def) return;
    def.draw(ctx, visibleData, instance, geom);
  });
}

// ─── Legend entry point (called from renderChartLegend) ────────
function legendRowsIndicatorInstances(candle) {
  let html = '';
  indicatorInstances.forEach(instance => {
    const def = INDICATOR_DEFS[instance.typeId];
    if (!def) return;
    html += def.legendRows(instance, candle);
  });
  return html;
}

// ─── Generic line drawer (used by EMA/SMA) ──────────────────────
function _drawSingleLine(ctx, visibleData, field, instance, geom) {
  const { height, candleWidth, padding, minPrice, maxPrice } = geom;
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  ctx.strokeStyle = instance.style.color;
  ctx.lineWidth   = instance.style.lineWidth || 1;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  applyLineStyle(ctx, instance.style.lineStyle);
  ctx.beginPath();
  let started = false;
  visibleData.forEach((candle, idx) => {
    const v = candle[field];
    if (v == null) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

function _drawBollingerInstance(ctx, visibleData, instance, geom) {
  const { height, candleWidth, padding, minPrice, maxPrice } = geom;
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  const upperPts = [], lowerPts = [];
  visibleData.forEach((candle, idx) => {
    const u = candle[`${instance.id}_upper`], l = candle[`${instance.id}_lower`];
    if (u == null) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    upperPts.push({ x, y: toY(u) });
    lowerPts.push({ x, y: toY(l) });
  });
  if (upperPts.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(upperPts[0].x, upperPts[0].y);
  upperPts.forEach(p => ctx.lineTo(p.x, p.y));
  for (let i = lowerPts.length - 1; i >= 0; i--) ctx.lineTo(lowerPts[i].x, lowerPts[i].y);
  ctx.closePath();
  const fillAlpha = instance.style.fillOpacity != null ? instance.style.fillOpacity : 0.15;
  ctx.fillStyle = _hexToRgba(instance.style.color, fillAlpha);
  ctx.fill();

  ctx.strokeStyle = instance.style.color;
  ctx.lineWidth   = instance.style.lineWidth || 1;
  applyLineStyle(ctx, instance.style.lineStyle);
  ctx.beginPath();
  upperPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.beginPath();
  lowerPts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);

  _drawSingleLine(ctx, visibleData, `${instance.id}_middle`, { ...instance, style: { ...instance.style, lineStyle: 'solid' } }, geom);
}

function _drawIchimokuInstance(ctx, visibleData, instance, geom) {
  // Full Ichimoku cloud shift/forward-projection (the 26-period
  // displacement) needs the full displayData/startIdx context that
  // the old single-instance drawIchimokuCloudOverlay() received.
  // For instance-based rendering we keep it simple: draw tenkan/
  // kijun/senkouA/senkouB aligned to the *current* candle (no
  // forward shift) — still fully informative for analysis, and
  // avoids needing to thread displayData/startIdx through the
  // generic draw(ctx, visibleData, instance, geom) signature.
  const { height, candleWidth, padding, minPrice, maxPrice } = geom;
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  const pts = [];
  visibleData.forEach((candle, idx) => {
    const a = candle[`${instance.id}_senkouA`], b = candle[`${instance.id}_senkouB`];
    pts.push({
      x: padding.left + (idx + 0.5) * candleWidth,
      a: a != null ? toY(a) : null,
      b: b != null ? toY(b) : null,
    });
  });

  let i = 0;
  while (i < pts.length) {
    if (pts[i].a == null || pts[i].b == null) { i++; continue; }
    const bullish = pts[i].a <= pts[i].b;
    let j = i;
    while (j < pts.length && pts[j].a != null && pts[j].b != null && (pts[j].a <= pts[j].b) === bullish) j++;
    const seg = pts.slice(i, j);
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].a);
    seg.forEach(p => ctx.lineTo(p.x, p.a));
    for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].b);
    ctx.closePath();
    ctx.fillStyle = _hexToRgba(bullish ? instance.style.colorA : instance.style.colorB, 0.16);
    ctx.fill();
    i = j;
  }

  ctx.lineWidth = instance.style.lineWidth || 1;
  applyLineStyle(ctx, instance.style.lineStyle);
  _strokePoints(ctx, pts, 'a', instance.style.colorA);
  _strokePoints(ctx, pts, 'b', instance.style.colorB);
  _drawSingleLine(ctx, visibleData, `${instance.id}_tenkan`, { ...instance, style: { ...instance.style, color: instance.style.colorTenkan } }, geom);
  _drawSingleLine(ctx, visibleData, `${instance.id}_kijun`,  { ...instance, style: { ...instance.style, color: instance.style.colorKijun } },  geom);
  ctx.setLineDash([]);
}

function _strokePoints(ctx, pts, key, color) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  let started = false;
  pts.forEach(p => {
    if (p[key] == null) { started = false; return; }
    if (!started) { ctx.moveTo(p.x, p[key]); started = true; } else ctx.lineTo(p.x, p[key]);
  });
  ctx.stroke();
}

function _drawSupertrendInstance(ctx, visibleData, instance, geom) {
  const { height, candleWidth, padding, minPrice, maxPrice } = geom;
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  ctx.lineWidth = instance.style.lineWidth || 1.5;
  ctx.lineCap   = 'round';
  ctx.lineJoin  = 'round';
  applyLineStyle(ctx, instance.style.lineStyle);

  let i = 0;
  while (i < visibleData.length) {
    const v = visibleData[i][`${instance.id}_supertrend`];
    if (v == null) { i++; continue; }
    const trend = visibleData[i][`${instance.id}_trend`];
    ctx.strokeStyle = trend === 1 ? instance.style.colorUp : instance.style.colorDown;
    let j = i;
    while (j < visibleData.length &&
           visibleData[j][`${instance.id}_supertrend`] != null &&
           visibleData[j][`${instance.id}_trend`] === trend) j++;
    ctx.beginPath();
    for (let k = i; k < j; k++) {
      const x = padding.left + (k + 0.5) * candleWidth;
      const y = toY(visibleData[k][`${instance.id}_supertrend`]);
      if (k === i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    i = j;
  }
  ctx.setLineDash([]);
}

// ─── Color helper: hex (#RRGGBB) → rgba(...) string ────────────
function _hexToRgba(hex, alpha) {
  if (!hex || hex[0] !== '#') return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
