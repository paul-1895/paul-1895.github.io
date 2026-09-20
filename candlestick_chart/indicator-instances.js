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

// Shifts a computed series left/right along the time axis by `offset` bars
// (TradingView-style "Offset" input) — positive moves the plotted values
// into the future (right), negative into the past (left). Used by EMA/SMA/
// Bollinger Bands, whose `offset` input is otherwise read but never applied.
function _applyOffset(series, offset) {
  if (!offset) return series;
  const n = series.length;
  const out = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const srcIdx = i - offset;
    if (srcIdx >= 0 && srcIdx < n) out[i] = series[srcIdx];
  }
  return out;
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
      return { ema: _applyOffset(ema, inputs.offset || 0) };
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
      return { sma: _applyOffset(sma, inputs.offset || 0) };
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
      const offset = inputs.offset || 0;
      return {
        upper:  _applyOffset(bb.upper, offset),
        middle: _applyOffset(bb.middle, offset),
        lower:  _applyOffset(bb.lower, offset),
      };
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

  // ─── Additional MA-family overlays (indicators/moving-averages-extra.js) ───
  WMA: {
    label: 'WMA',
    defaultInputs: { length: 9, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#4CAF50', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const wma = calculateWMA(src, Math.max(1, inputs.length || 9));
      return { wma: _applyOffset(wma, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_wma`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_wma`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`WMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  HMA: {
    label: 'HMA',
    defaultInputs: { length: 9, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#AB47BC', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const hma = calculateHMA(src, Math.max(2, inputs.length || 9));
      return { hma: _applyOffset(hma, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_hma`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_hma`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`HMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  DEMA: {
    label: 'DEMA',
    defaultInputs: { length: 20, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#FF7043', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const dema = calculateDEMA(src, Math.max(1, inputs.length || 20));
      return { dema: _applyOffset(dema, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_dema`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_dema`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`DEMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  TEMA: {
    label: 'TEMA',
    defaultInputs: { length: 20, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#26C6DA', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const tema = calculateTEMA(src, Math.max(1, inputs.length || 20));
      return { tema: _applyOffset(tema, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_tema`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_tema`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`TEMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  KAMA: {
    label: 'KAMA',
    defaultInputs: { length: 10, fastEnd: 2, slowEnd: 30, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#8D6E63', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const kama = calculateKAMA(src, Math.max(2, inputs.length || 10), inputs.fastEnd || 2, inputs.slowEnd || 30);
      return { kama: _applyOffset(kama, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_kama`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_kama`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`KAMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  ALMA: {
    label: 'ALMA',
    defaultInputs: { length: 9, almaOffset: 0.85, sigma: 6, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#EC407A', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const alma = calculateALMA(src, Math.max(1, inputs.length || 9), inputs.almaOffset != null ? inputs.almaOffset : 0.85, inputs.sigma || 6);
      return { alma: _applyOffset(alma, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_alma`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_alma`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`ALMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  VWMA: {
    label: 'VWMA',
    defaultInputs: { length: 20, source: 'Close', offset: 0 },
    defaultStyle:  { color: '#5C6BC0', lineWidth: 1, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const vwma = calculateVWMA(data, Math.max(1, inputs.length || 20), inputs.source || 'Close');
      return { vwma: _applyOffset(vwma, inputs.offset || 0) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_vwma`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_vwma`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`VWMA ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'MA Ribbon': {
    label: 'MA Ribbon',
    defaultInputs: { source: 'Close', maType: 'EMA', baseLength: 20, step: 20, count: 6 },
    defaultStyle:  { colorStart: '#42A5F5', colorEnd: '#EF5350', lineWidth: 1, lineStyle: 'solid', visible: true, showInLegend: true },
    compute(data, inputs) {
      const count = Math.max(1, Math.min(12, Math.round(inputs.count || 6)));
      const lines = calculateMARibbon(data, inputs.source || 'Close', inputs.maType || 'EMA', inputs.baseLength || 20, inputs.step != null ? inputs.step : 20, count);
      const out = {};
      lines.forEach((series, i) => { out[`line${i}`] = series; });
      return out;
    },
    draw(ctx, visibleData, instance, geom) {
      const count = Math.max(1, Math.min(12, Math.round(instance.inputs.count || 6)));
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0 : i / (count - 1);
        const color = _lerpHexColor(instance.style.colorStart, instance.style.colorEnd, t);
        _drawSingleLine(ctx, visibleData, `${instance.id}_line${i}`, { ...instance, style: { ...instance.style, color } }, geom);
      }
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const count = Math.max(1, Math.min(12, Math.round(instance.inputs.count || 6)));
      const parts = [];
      for (let i = 0; i < count; i++) {
        const v = candle[`${instance.id}_line${i}`];
        if (v == null) continue;
        const t = count === 1 ? 0 : i / (count - 1);
        parts.push({ val: _legendFmtPrice(v), color: _lerpHexColor(instance.style.colorStart, instance.style.colorEnd, t) });
      }
      if (!parts.length) return '';
      return _legendIndRow(`MA Ribbon ${instance.inputs.baseLength}+${instance.inputs.step}x${count}`, parts, { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'MA Cross': {
    label: 'MA Cross',
    defaultInputs: { source: 'Close', maType: 'EMA', fastLength: 9, slowLength: 21 },
    defaultStyle:  { colorFast: '#42A5F5', colorSlow: '#FF7043', markerUpColor: '#10b981', markerDownColor: '#ef4444', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    compute(data, inputs) {
      const r = calculateMACross(data, inputs.source || 'Close', inputs.maType || 'EMA', Math.max(1, inputs.fastLength || 9), Math.max(1, inputs.slowLength || 21));
      return { fast: r.fast, slow: r.slow, crossUp: r.crossUp, crossDown: r.crossDown };
    },
    draw(ctx, visibleData, instance, geom) {
      _drawSingleLine(ctx, visibleData, `${instance.id}_fast`, { ...instance, style: { ...instance.style, color: instance.style.colorFast } }, geom);
      _drawSingleLine(ctx, visibleData, `${instance.id}_slow`, { ...instance, style: { ...instance.style, color: instance.style.colorSlow } }, geom);
      const { height, candleWidth, padding, minPrice, maxPrice } = geom;
      const chartHeight = height - padding.top - padding.bottom;
      const y0 = padding.top;
      const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));
      visibleData.forEach((candle, idx) => {
        const up = candle[`${instance.id}_crossUp`], down = candle[`${instance.id}_crossDown`];
        if (!up && !down) return;
        const v = candle[`${instance.id}_fast`];
        if (v == null) return;
        const x = padding.left + (idx + 0.5) * candleWidth;
        const y = toY(v);
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = up ? instance.style.markerUpColor : instance.style.markerDownColor;
        ctx.fill();
      });
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const f = candle[`${instance.id}_fast`], s = candle[`${instance.id}_slow`];
      if (f == null) return '';
      return _legendIndRow(`MA Cross ${instance.inputs.fastLength}/${instance.inputs.slowLength}`, [
        { val: _legendFmtPrice(f), color: instance.style.colorFast },
        { val: _legendFmtPrice(s), color: instance.style.colorSlow },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  // ─── Additional overlays (indicators/trend-overlays-extra.js) ──────────
  'Parabolic SAR': {
    label: 'Parabolic SAR',
    defaultInputs: { step: 0.02, maxStep: 0.2 },
    defaultStyle:  { color: '#FFEB3B', visible: true, showInLegend: true },
    compute(data, inputs) {
      const r = calculateParabolicSAR(data, inputs.step || 0.02, inputs.maxStep || 0.2);
      return { sar: r.sar, trend: r.trend };
    },
    draw(ctx, visibleData, instance, geom) {
      const { height, candleWidth, padding, minPrice, maxPrice } = geom;
      const chartHeight = height - padding.top - padding.bottom;
      const y0 = padding.top;
      const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));
      visibleData.forEach((candle, idx) => {
        const v = candle[`${instance.id}_sar`];
        if (v == null) return;
        const x = padding.left + (idx + 0.5) * candleWidth;
        const y = toY(v);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = instance.style.color;
        ctx.fill();
      });
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_sar`];
      if (v == null) return '';
      return _legendIndRow('PSAR', [{ val: v.toFixed(2), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Donchian Channels': {
    label: 'Donchian Channels',
    defaultInputs: { length: 20 },
    defaultStyle:  { color: '#26A69A', lineWidth: 1, lineStyle: 'solid', visible: true, showInLegend: true, fillOpacity: 0.1 },
    compute(data, inputs) {
      const dc = calculateDonchianChannels(data, Math.max(1, inputs.length || 20));
      return { upper: dc.upper, middle: dc.middle, lower: dc.lower };
    },
    draw(ctx, visibleData, instance, geom) { _drawBandInstance(ctx, visibleData, instance, geom, { upper: 'upper', lower: 'lower', middle: 'middle' }); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const u = candle[`${instance.id}_upper`];
      if (u == null) return '';
      return _legendIndRow(`Donchian ${instance.inputs.length}`, [
        { val: _legendFmtPrice(u), color: instance.style.color },
        { val: _legendFmtPrice(candle[`${instance.id}_middle`]), color: instance.style.color },
        { val: _legendFmtPrice(candle[`${instance.id}_lower`]), color: instance.style.color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Linear Regression': {
    label: 'Linear Regression',
    defaultInputs: { length: 100, source: 'Close', channelMult: 2 },
    defaultStyle:  { color: '#42A5F5', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true, fillOpacity: 0.08 },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const lr = calculateLinearRegression(src, Math.max(2, inputs.length || 100), inputs.channelMult != null ? inputs.channelMult : 2);
      return { line: lr.line, upper: lr.upper, lower: lr.lower };
    },
    draw(ctx, visibleData, instance, geom) { _drawBandInstance(ctx, visibleData, instance, geom, { upper: 'upper', lower: 'lower', middle: 'line' }); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_line`];
      if (v == null) return '';
      return _legendIndRow(`LinReg ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Keltner Channels': {
    label: 'Keltner Channels',
    defaultInputs: { length: 20, atrPeriod: 10, multiplier: 2, source: 'Close' },
    defaultStyle:  { color: '#7E57C2', lineWidth: 1, lineStyle: 'solid', visible: true, showInLegend: true, fillOpacity: 0.1 },
    compute(data, inputs) {
      const kc = calculateKeltnerChannels(data, Math.max(1, inputs.length || 20), Math.max(1, inputs.atrPeriod || 10), inputs.multiplier != null ? inputs.multiplier : 2, inputs.source || 'Close');
      return { upper: kc.upper, middle: kc.middle, lower: kc.lower };
    },
    draw(ctx, visibleData, instance, geom) { _drawBandInstance(ctx, visibleData, instance, geom, { upper: 'upper', lower: 'lower', middle: 'middle' }); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const m = candle[`${instance.id}_middle`];
      if (m == null) return '';
      return _legendIndRow(`Keltner ${instance.inputs.length}`, [
        { val: _legendFmtPrice(candle[`${instance.id}_upper`]), color: instance.style.color },
        { val: _legendFmtPrice(m), color: instance.style.color },
        { val: _legendFmtPrice(candle[`${instance.id}_lower`]), color: instance.style.color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'ATR Bands': {
    label: 'ATR Bands',
    defaultInputs: { atrPeriod: 14, multiplier: 2.5, source: 'Close' },
    defaultStyle:  { color: '#EF5350', lineWidth: 1, lineStyle: 'dashed', visible: true, showInLegend: true, fillOpacity: 0.08 },
    compute(data, inputs) {
      const ab = calculateATRBands(data, Math.max(1, inputs.atrPeriod || 14), inputs.multiplier != null ? inputs.multiplier : 2.5, inputs.source || 'Close');
      return { upper: ab.upper, lower: ab.lower };
    },
    draw(ctx, visibleData, instance, geom) { _drawBandInstance(ctx, visibleData, instance, geom, { upper: 'upper', lower: 'lower' }); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const u = candle[`${instance.id}_upper`];
      if (u == null) return '';
      return _legendIndRow(`ATR Bands ${instance.inputs.atrPeriod}`, [
        { val: _legendFmtPrice(u), color: instance.style.color },
        { val: _legendFmtPrice(candle[`${instance.id}_lower`]), color: instance.style.color },
      ], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Volatility Stop': {
    label: 'Volatility Stop',
    defaultInputs: { atrPeriod: 20, factor: 2 },
    defaultStyle:  { colorUp: '#10b981', colorDown: '#ef4444', visible: true, showInLegend: true },
    compute(data, inputs) {
      const vs = calculateVolatilityStop(data, Math.max(1, inputs.atrPeriod || 20), inputs.factor != null ? inputs.factor : 2);
      return { stop: vs.stop, trend: vs.trend };
    },
    draw(ctx, visibleData, instance, geom) {
      const { height, candleWidth, padding, minPrice, maxPrice } = geom;
      const chartHeight = height - padding.top - padding.bottom;
      const y0 = padding.top;
      const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));
      visibleData.forEach((candle, idx) => {
        const v = candle[`${instance.id}_stop`];
        if (v == null) return;
        const trend = candle[`${instance.id}_trend`];
        const x = padding.left + (idx + 0.5) * candleWidth;
        const y = toY(v);
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = trend === 1 ? instance.style.colorUp : instance.style.colorDown;
        ctx.fill();
      });
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_stop`];
      if (v == null) return '';
      const trend = candle[`${instance.id}_trend`];
      const color = trend === 1 ? instance.style.colorUp : instance.style.colorDown;
      return _legendIndRow('Vol Stop', [{ val: v.toFixed(2), color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  VWAP: {
    label: 'VWAP',
    defaultInputs: { anchor: 'Month' },
    defaultStyle:  { color: '#7B1FA2', lineWidth: 1.5, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      return { vwap: calculateVWAP(data, inputs.anchor || 'Month') };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_vwap`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_vwap`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow(`VWAP ${instance.inputs.anchor}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  'Anchored VWAP': {
    label: 'Anchored VWAP',
    defaultInputs: { anchorDate: '' },
    defaultStyle:  { color: '#F57F17', lineWidth: 1.5, lineStyle: 'solid', visible: true, showLabelOnAxis: true, showInLegend: true },
    compute(data, inputs) {
      const anchorDate = inputs.anchorDate || (data[0] && data[0].Date) || '';
      return { avwap: calculateAnchoredVWAP(data, anchorDate) };
    },
    draw(ctx, visibleData, instance, geom) { _drawSingleLine(ctx, visibleData, `${instance.id}_avwap`, instance, geom); },
    legendRows(instance, candle) {
      const v = candle[`${instance.id}_avwap`];
      if (!instance.style.showInLegend || v == null) return '';
      return _legendIndRow('Anchored VWAP', [{ val: _legendFmtPrice(v), color: instance.style.color }], { instanceId: instance.id, visible: instance.style.visible });
    },
  },

  // ─── Sub-pane proof-of-concept (indicators/momentum-oscillators.js) ────
  // Built on the generic sub-pane framework (indicators/subpane-framework.js)
  // — the rest of the momentum/volatility/volume sub-pane indicators follow
  // this exact same shape in a later pass.
  Stochastic: {
    label: 'Stochastic',
    isSubPane: true,
    paneKey: 'stoch',
    paneLabel: 'Stochastic %K %D',
    rangeMode: 'fixed',
    fixedRange: [0, 100],
    refLines: [20, 80],
    defaultInputs: { kPeriod: 14, kSmooth: 1, dPeriod: 3 },
    defaultStyle:  { colorK: '#2962FF', colorD: '#FF6D00', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { k: { type: 'line', colorKey: 'colorK' }, d: { type: 'line', colorKey: 'colorD' } },
    compute(data, inputs) {
      return calculateStochastic(data, Math.max(1, inputs.kPeriod || 14), Math.max(1, inputs.kSmooth || 1), Math.max(1, inputs.dPeriod || 3));
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const k = candle[`${instance.id}_k`];
      if (k == null) return '';
      const d = candle[`${instance.id}_d`];
      return _legendIndRow(`Stoch ${instance.inputs.kPeriod} ${instance.inputs.kSmooth} ${instance.inputs.dPeriod}`, [
        { val: k.toFixed(2), color: instance.style.colorK },
        { val: d != null ? d.toFixed(2) : null, color: instance.style.colorD },
      ], _subPaneLegendOpts(instance));
    },
  },

  'Stochastic RSI': {
    label: 'Stochastic RSI', isSubPane: true, paneKey: 'stochrsi', paneLabel: 'Stochastic RSI',
    rangeMode: 'fixed', fixedRange: [0, 100], refLines: [20, 80],
    defaultInputs: { rsiPeriod: 14, stochPeriod: 14, kSmooth: 3, dPeriod: 3 },
    defaultStyle:  { colorK: '#2962FF', colorD: '#FF6D00', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { k: { type: 'line', colorKey: 'colorK' }, d: { type: 'line', colorKey: 'colorD' } },
    compute(data, inputs) {
      return calculateStochasticRSI(data, Math.max(1, inputs.rsiPeriod || 14), Math.max(1, inputs.stochPeriod || 14), Math.max(1, inputs.kSmooth || 3), Math.max(1, inputs.dPeriod || 3));
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const k = candle[`${instance.id}_k`];
      if (k == null) return '';
      const d = candle[`${instance.id}_d`];
      return _legendIndRow('Stoch RSI', [
        { val: k.toFixed(2), color: instance.style.colorK },
        { val: d != null ? d.toFixed(2) : null, color: instance.style.colorD },
      ], _subPaneLegendOpts(instance));
    },
  },

  'Williams %R': {
    label: 'Williams %R', isSubPane: true, paneKey: 'willr', paneLabel: 'Williams %R',
    rangeMode: 'fixed', fixedRange: [-100, 0], refLines: [-20, -80],
    defaultInputs: { length: 14 },
    defaultStyle:  { color: '#AB47BC', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { willr: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { willr: calculateWilliamsR(data, Math.max(1, inputs.length || 14)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_willr`];
      if (v == null) return '';
      return _legendIndRow(`Williams %R ${instance.inputs.length}`, [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  CCI: {
    label: 'CCI', isSubPane: true, paneKey: 'cci', paneLabel: 'CCI',
    rangeMode: 'auto', refLines: [-100, 100], zeroLine: true,
    defaultInputs: { length: 20 },
    defaultStyle:  { color: '#26A69A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { cci: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { cci: calculateCCI(data, Math.max(1, inputs.length || 20)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_cci`];
      if (v == null) return '';
      return _legendIndRow(`CCI ${instance.inputs.length}`, [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  ROC: {
    label: 'ROC', isSubPane: true, paneKey: 'roc', paneLabel: 'ROC %',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 9, source: 'Close' },
    defaultStyle:  { color: '#42A5F5', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { roc: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { roc: calculateROC(src, Math.max(1, inputs.length || 9)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_roc`];
      if (v == null) return '';
      return _legendIndRow(`ROC ${instance.inputs.length}`, [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  Momentum: {
    label: 'Momentum', isSubPane: true, paneKey: 'mom', paneLabel: 'Momentum',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 10, source: 'Close' },
    defaultStyle:  { color: '#FF7043', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { mom: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { mom: calculateMomentum(src, Math.max(1, inputs.length || 10)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_mom`];
      if (v == null) return '';
      return _legendIndRow(`Momentum ${instance.inputs.length}`, [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Awesome Oscillator': {
    label: 'Awesome Oscillator', isSubPane: true, paneKey: 'ao', paneLabel: 'Awesome Oscillator',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: {},
    defaultStyle:  { histUpColor: '#10b981', histDownColor: '#ef4444', visible: true, showInLegend: true },
    seriesStyle: { ao: { type: 'histogram', upColorKey: 'histUpColor', downColorKey: 'histDownColor' } },
    compute(data) { return { ao: calculateAwesomeOscillator(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_ao`];
      if (v == null) return '';
      const color = v >= 0 ? instance.style.histUpColor : instance.style.histDownColor;
      return _legendIndRow('AO', [{ val: v.toFixed(3), color }], _subPaneLegendOpts(instance));
    },
  },

  'Accelerator Oscillator': {
    label: 'Accelerator Oscillator', isSubPane: true, paneKey: 'ac', paneLabel: 'Accelerator Oscillator',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: {},
    defaultStyle:  { histUpColor: '#10b981', histDownColor: '#ef4444', visible: true, showInLegend: true },
    seriesStyle: { ac: { type: 'histogram', upColorKey: 'histUpColor', downColorKey: 'histDownColor' } },
    compute(data) { return { ac: calculateAcceleratorOscillator(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_ac`];
      if (v == null) return '';
      const color = v >= 0 ? instance.style.histUpColor : instance.style.histDownColor;
      return _legendIndRow('AC', [{ val: v.toFixed(3), color }], _subPaneLegendOpts(instance));
    },
  },

  'Ultimate Oscillator': {
    label: 'Ultimate Oscillator', isSubPane: true, paneKey: 'uo', paneLabel: 'Ultimate Oscillator',
    rangeMode: 'fixed', fixedRange: [0, 100], refLines: [30, 70],
    defaultInputs: { fastLength: 7, midLength: 14, slowLength: 28 },
    defaultStyle:  { color: '#8D6E63', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { uo: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      return { uo: calculateUltimateOscillator(data, Math.max(1, inputs.fastLength || 7), Math.max(1, inputs.midLength || 14), Math.max(1, inputs.slowLength || 28)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_uo`];
      if (v == null) return '';
      return _legendIndRow('UO', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Relative Vigor Index': {
    label: 'Relative Vigor Index', isSubPane: true, paneKey: 'rvivigor', paneLabel: 'Relative Vigor Index',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 10 },
    defaultStyle:  { colorRvi: '#2962FF', colorSignal: '#FF6D00', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { rvi: { type: 'line', colorKey: 'colorRvi' }, signal: { type: 'line', colorKey: 'colorSignal' } },
    compute(data, inputs) { return calculateRVIVigor(data, Math.max(1, inputs.length || 10)); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_rvi`];
      if (v == null) return '';
      const s = candle[`${instance.id}_signal`];
      return _legendIndRow('RVI (Vigor)', [
        { val: v.toFixed(3), color: instance.style.colorRvi },
        { val: s != null ? s.toFixed(3) : null, color: instance.style.colorSignal },
      ], _subPaneLegendOpts(instance));
    },
  },

  'Connors RSI': {
    label: 'Connors RSI', isSubPane: true, paneKey: 'connorsrsi', paneLabel: 'Connors RSI',
    rangeMode: 'fixed', fixedRange: [0, 100], refLines: [20, 80],
    defaultInputs: { rsiPeriod: 3, streakPeriod: 2, rankPeriod: 100 },
    defaultStyle:  { color: '#EC407A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { crsi: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      return { crsi: calculateConnorsRSI(data, Math.max(1, inputs.rsiPeriod || 3), Math.max(1, inputs.streakPeriod || 2), Math.max(2, inputs.rankPeriod || 100)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_crsi`];
      if (v == null) return '';
      return _legendIndRow('Connors RSI', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Chande Momentum Oscillator': {
    label: 'Chande Momentum Oscillator', isSubPane: true, paneKey: 'cmo', paneLabel: 'CMO',
    rangeMode: 'fixed', fixedRange: [-100, 100], refLines: [-50, 50],
    defaultInputs: { length: 9, source: 'Close' },
    defaultStyle:  { color: '#5C6BC0', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { cmo: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { cmo: calculateCMO(src, Math.max(1, inputs.length || 9)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_cmo`];
      if (v == null) return '';
      return _legendIndRow(`CMO ${instance.inputs.length}`, [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Fisher Transform': {
    label: 'Fisher Transform', isSubPane: true, paneKey: 'fisher', paneLabel: 'Fisher Transform',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 9 },
    defaultStyle:  { colorFisher: '#2962FF', colorSignal: '#FF6D00', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { fish: { type: 'line', colorKey: 'colorFisher' }, signal: { type: 'line', colorKey: 'colorSignal' } },
    compute(data, inputs) {
      const r = calculateFisherTransform(data, Math.max(2, inputs.length || 9));
      return { fish: r.fish, signal: r.signal };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_fish`];
      if (v == null) return '';
      const s = candle[`${instance.id}_signal`];
      return _legendIndRow('Fisher', [
        { val: v.toFixed(3), color: instance.style.colorFisher },
        { val: s != null ? s.toFixed(3) : null, color: instance.style.colorSignal },
      ], _subPaneLegendOpts(instance));
    },
  },

  DPO: {
    label: 'DPO', isSubPane: true, paneKey: 'dpo', paneLabel: 'Detrended Price Oscillator',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 20, source: 'Close' },
    defaultStyle:  { color: '#26C6DA', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { dpo: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { dpo: calculateDPO(src, Math.max(2, inputs.length || 20)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_dpo`];
      if (v == null) return '';
      return _legendIndRow(`DPO ${instance.inputs.length}`, [{ val: _legendFmtPrice(v), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  PPO: {
    label: 'PPO', isSubPane: true, paneKey: 'ppo', paneLabel: 'PPO',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { fastLength: 12, slowLength: 26, signalLength: 9, source: 'Close' },
    defaultStyle:  { color: '#FF9C00', colorSignal: '#0891B2', histUpColor: '#10B981', histDownColor: '#EF4444', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: {
      ppo:    { type: 'line', colorKey: 'color' },
      signal: { type: 'line', colorKey: 'colorSignal' },
      hist:   { type: 'histogram', upColorKey: 'histUpColor', downColorKey: 'histDownColor' },
    },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const r = calculatePPO(src, Math.max(1, inputs.fastLength || 12), Math.max(1, inputs.slowLength || 26), Math.max(1, inputs.signalLength || 9));
      return { ppo: r.ppoLine, signal: r.signalLine, hist: r.histogram };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_ppo`];
      if (v == null) return '';
      const s = candle[`${instance.id}_signal`];
      return _legendIndRow(`PPO ${instance.inputs.fastLength} ${instance.inputs.slowLength} ${instance.inputs.signalLength}`, [
        { val: v.toFixed(3), color: instance.style.color },
        { val: s != null ? s.toFixed(3) : null, color: instance.style.colorSignal },
      ], _subPaneLegendOpts(instance));
    },
  },

  // ─── Trend-strength sub-panes (indicators/trend-strength.js) ───────────
  'ADX/DMI': {
    label: 'ADX/DMI', isSubPane: true, paneKey: 'adxdmi', paneLabel: 'ADX / DMI',
    rangeMode: 'auto',
    defaultInputs: { length: 14 },
    defaultStyle:  { colorPlusDI: '#26A69A', colorMinusDI: '#EF5350', colorAdx: '#FFCA28', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: {
      plusDI:  { type: 'line', colorKey: 'colorPlusDI' },
      minusDI: { type: 'line', colorKey: 'colorMinusDI' },
      adx:     { type: 'line', colorKey: 'colorAdx' },
    },
    compute(data, inputs) { return calculateADXDMI(data, Math.max(2, inputs.length || 14)); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const adx = candle[`${instance.id}_adx`];
      if (adx == null) return '';
      return _legendIndRow(`ADX ${instance.inputs.length}`, [
        { val: candle[`${instance.id}_plusDI`]?.toFixed(2), color: instance.style.colorPlusDI },
        { val: candle[`${instance.id}_minusDI`]?.toFixed(2), color: instance.style.colorMinusDI },
        { val: adx.toFixed(2), color: instance.style.colorAdx },
      ], _subPaneLegendOpts(instance));
    },
  },

  Aroon: {
    label: 'Aroon', isSubPane: true, paneKey: 'aroon', paneLabel: 'Aroon',
    rangeMode: 'fixed', fixedRange: [0, 100], refLines: [50],
    defaultInputs: { length: 14 },
    defaultStyle:  { colorUp: '#26A69A', colorDown: '#EF5350', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { up: { type: 'line', colorKey: 'colorUp' }, down: { type: 'line', colorKey: 'colorDown' } },
    compute(data, inputs) { return calculateAroon(data, Math.max(1, inputs.length || 14)); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const up = candle[`${instance.id}_up`];
      if (up == null) return '';
      return _legendIndRow(`Aroon ${instance.inputs.length}`, [
        { val: up.toFixed(1), color: instance.style.colorUp },
        { val: candle[`${instance.id}_down`]?.toFixed(1), color: instance.style.colorDown },
      ], _subPaneLegendOpts(instance));
    },
  },

  Vortex: {
    label: 'Vortex', isSubPane: true, paneKey: 'vortex', paneLabel: 'Vortex',
    rangeMode: 'auto-tight',
    defaultInputs: { length: 14 },
    defaultStyle:  { colorPlus: '#26A69A', colorMinus: '#EF5350', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { viPlus: { type: 'line', colorKey: 'colorPlus' }, viMinus: { type: 'line', colorKey: 'colorMinus' } },
    compute(data, inputs) { return calculateVortex(data, Math.max(1, inputs.length || 14)); },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const p = candle[`${instance.id}_viPlus`];
      if (p == null) return '';
      return _legendIndRow(`Vortex ${instance.inputs.length}`, [
        { val: p.toFixed(3), color: instance.style.colorPlus },
        { val: candle[`${instance.id}_viMinus`]?.toFixed(3), color: instance.style.colorMinus },
      ], _subPaneLegendOpts(instance));
    },
  },

  TRIX: {
    label: 'TRIX', isSubPane: true, paneKey: 'trix', paneLabel: 'TRIX',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 15, source: 'Close' },
    defaultStyle:  { color: '#7E57C2', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { trix: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { trix: calculateTRIX(src, Math.max(2, inputs.length || 15)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_trix`];
      if (v == null) return '';
      return _legendIndRow(`TRIX ${instance.inputs.length}`, [{ val: v.toFixed(3), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  KST: {
    label: 'KST', isSubPane: true, paneKey: 'kst', paneLabel: 'Know Sure Thing',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { roc1: 10, roc2: 15, roc3: 20, roc4: 30, signalLength: 9, source: 'Close' },
    defaultStyle:  { color: '#42A5F5', colorSignal: '#FF7043', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { kst: { type: 'line', colorKey: 'color' }, signal: { type: 'line', colorKey: 'colorSignal' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      const r = calculateKST(src, Math.max(1, inputs.roc1 || 10), Math.max(1, inputs.roc2 || 15), Math.max(1, inputs.roc3 || 20), Math.max(1, inputs.roc4 || 30), 10, Math.max(1, inputs.signalLength || 9));
      return { kst: r.kst, signal: r.signal };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_kst`];
      if (v == null) return '';
      return _legendIndRow('KST', [
        { val: v.toFixed(2), color: instance.style.color },
        { val: candle[`${instance.id}_signal`]?.toFixed(2), color: instance.style.colorSignal },
      ], _subPaneLegendOpts(instance));
    },
  },

  'Mass Index': {
    label: 'Mass Index', isSubPane: true, paneKey: 'massindex', paneLabel: 'Mass Index',
    rangeMode: 'auto-tight', refLines: [27],
    defaultInputs: { length: 9, sumLength: 25 },
    defaultStyle:  { color: '#8D6E63', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { mi: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { mi: calculateMassIndex(data, Math.max(1, inputs.length || 9), Math.max(2, inputs.sumLength || 25)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_mi`];
      if (v == null) return '';
      return _legendIndRow('Mass Index', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Linear Regression Slope': {
    label: 'Linear Regression Slope', isSubPane: true, paneKey: 'linregslope', paneLabel: 'Linear Regression Slope',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 14, source: 'Close' },
    defaultStyle:  { color: '#26C6DA', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { slope: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { slope: calculateLinRegSlope(src, Math.max(2, inputs.length || 14)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_slope`];
      if (v == null) return '';
      return _legendIndRow(`LinReg Slope ${instance.inputs.length}`, [{ val: v.toFixed(3), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Chande Forecast Oscillator': {
    label: 'Chande Forecast Oscillator', isSubPane: true, paneKey: 'chandeforecast', paneLabel: 'Chande Forecast Oscillator',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 14, source: 'Close' },
    defaultStyle:  { color: '#EC407A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { cfo: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { cfo: calculateChandeForecastOscillator(src, Math.max(2, inputs.length || 14)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_cfo`];
      if (v == null) return '';
      return _legendIndRow('CFO', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  // ─── Volatility sub-panes (indicators/volatility-oscillators.js) ───────
  'Bollinger Band Width': {
    label: 'Bollinger Band Width', isSubPane: true, paneKey: 'bbwidth', paneLabel: 'BB Width',
    rangeMode: 'auto',
    defaultInputs: { length: 20, stdDev: 2, source: 'Close' },
    defaultStyle:  { color: '#00D4FF', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { width: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { width: calculateBBWidth(src, Math.max(1, inputs.length || 20), inputs.stdDev || 2) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_width`];
      if (v == null) return '';
      return _legendIndRow('BB Width', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  ATR: {
    label: 'ATR', isSubPane: true, paneKey: 'atr', paneLabel: 'Average True Range',
    rangeMode: 'auto',
    defaultInputs: { length: 14 },
    defaultStyle:  { color: '#EF5350', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { atr: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { atr: calculateATR(data, Math.max(1, inputs.length || 14)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_atr`];
      if (v == null) return '';
      return _legendIndRow(`ATR ${instance.inputs.length}`, [{ val: v.toFixed(3), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Standard Deviation': {
    label: 'Standard Deviation', isSubPane: true, paneKey: 'stddev', paneLabel: 'Standard Deviation',
    rangeMode: 'auto',
    defaultInputs: { length: 20, source: 'Close' },
    defaultStyle:  { color: '#FFCA28', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { stddev: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { stddev: calculateStdDev(src, Math.max(1, inputs.length || 20)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_stddev`];
      if (v == null) return '';
      return _legendIndRow(`StdDev ${instance.inputs.length}`, [{ val: v.toFixed(3), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Historical Volatility': {
    label: 'Historical Volatility', isSubPane: true, paneKey: 'histvol', paneLabel: 'Historical Volatility',
    rangeMode: 'auto',
    defaultInputs: { length: 10, source: 'Close' },
    defaultStyle:  { color: '#AB47BC', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { hv: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { hv: calculateHistoricalVolatility(src, Math.max(2, inputs.length || 10)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_hv`];
      if (v == null) return '';
      return _legendIndRow('Hist Vol', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Chaikin Volatility': {
    label: 'Chaikin Volatility', isSubPane: true, paneKey: 'chaikinvol', paneLabel: 'Chaikin Volatility',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { emaLength: 10, rocLength: 10 },
    defaultStyle:  { color: '#26A69A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { cv: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { cv: calculateChaikinVolatility(data, Math.max(1, inputs.emaLength || 10), Math.max(1, inputs.rocLength || 10)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_cv`];
      if (v == null) return '';
      return _legendIndRow('Chaikin Vol', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Ulcer Index': {
    label: 'Ulcer Index', isSubPane: true, paneKey: 'ulcer', paneLabel: 'Ulcer Index',
    rangeMode: 'auto',
    defaultInputs: { length: 14, source: 'Close' },
    defaultStyle:  { color: '#FF7043', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { ui: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { ui: calculateUlcerIndex(src, Math.max(1, inputs.length || 14)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_ui`];
      if (v == null) return '';
      return _legendIndRow('Ulcer Index', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Relative Volatility Index': {
    label: 'Relative Volatility Index', isSubPane: true, paneKey: 'rvivol', paneLabel: 'Relative Volatility Index',
    rangeMode: 'fixed', fixedRange: [0, 100], refLines: [50],
    defaultInputs: { stdDevLength: 10, smoothLength: 14, source: 'Close' },
    defaultStyle:  { color: '#5C6BC0', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { rvi: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) {
      const src = getSourceSeries(data, inputs.source || 'Close');
      return { rvi: calculateRVIVolatility(src, Math.max(1, inputs.stdDevLength || 10), Math.max(1, inputs.smoothLength || 14)) };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_rvi`];
      if (v == null) return '';
      return _legendIndRow('RVI (Volatility)', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  // ─── Volume sub-panes (indicators/volume-oscillators.js) ───────────────
  OBV: {
    label: 'OBV', isSubPane: true, paneKey: 'obv', paneLabel: 'On-Balance Volume',
    rangeMode: 'auto-tight',
    defaultInputs: {},
    defaultStyle:  { color: '#42A5F5', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { obv: { type: 'line', colorKey: 'color' } },
    compute(data) { return { obv: calculateOBV(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_obv`];
      if (v == null) return '';
      return _legendIndRow('OBV', [{ val: _legendFmtVol(v), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Accumulation/Distribution': {
    label: 'Accumulation/Distribution', isSubPane: true, paneKey: 'ad', paneLabel: 'Accumulation/Distribution',
    rangeMode: 'auto-tight',
    defaultInputs: {},
    defaultStyle:  { color: '#26A69A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { ad: { type: 'line', colorKey: 'color' } },
    compute(data) { return { ad: calculateAD(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_ad`];
      if (v == null) return '';
      return _legendIndRow('A/D', [{ val: _legendFmtVol(v), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Chaikin Money Flow': {
    label: 'Chaikin Money Flow', isSubPane: true, paneKey: 'cmf', paneLabel: 'Chaikin Money Flow',
    rangeMode: 'fixed', fixedRange: [-1, 1], refLines: [-0.2, 0.2], zeroLine: true,
    defaultInputs: { length: 20 },
    defaultStyle:  { color: '#FF7043', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { cmf: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { cmf: calculateCMF(data, Math.max(1, inputs.length || 20)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_cmf`];
      if (v == null) return '';
      return _legendIndRow(`CMF ${instance.inputs.length}`, [{ val: v.toFixed(3), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Money Flow Index': {
    label: 'Money Flow Index', isSubPane: true, paneKey: 'mfi', paneLabel: 'Money Flow Index',
    rangeMode: 'fixed', fixedRange: [0, 100], refLines: [20, 80],
    defaultInputs: { length: 14 },
    defaultStyle:  { color: '#AB47BC', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { mfi: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { mfi: calculateMFI(data, Math.max(2, inputs.length || 14)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_mfi`];
      if (v == null) return '';
      return _legendIndRow(`MFI ${instance.inputs.length}`, [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Volume Oscillator': {
    label: 'Volume Oscillator', isSubPane: true, paneKey: 'volosc', paneLabel: 'Volume Oscillator',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { fastLength: 5, slowLength: 20 },
    defaultStyle:  { color: '#26C6DA', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { vo: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { vo: calculateVolumeOscillator(data, Math.max(1, inputs.fastLength || 5), Math.max(1, inputs.slowLength || 20)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_vo`];
      if (v == null) return '';
      return _legendIndRow('Vol Osc', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Ease of Movement': {
    label: 'Ease of Movement', isSubPane: true, paneKey: 'eom', paneLabel: 'Ease of Movement',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 14 },
    defaultStyle:  { color: '#5C6BC0', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { eom: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { eom: calculateEOM(data, Math.max(1, inputs.length || 14)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_eom`];
      if (v == null) return '';
      return _legendIndRow('EOM', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Force Index': {
    label: 'Force Index', isSubPane: true, paneKey: 'forceindex', paneLabel: "Force Index (Elder's)",
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { length: 13 },
    defaultStyle:  { histUpColor: '#10b981', histDownColor: '#ef4444', visible: true, showInLegend: true },
    seriesStyle: { fi: { type: 'histogram', upColorKey: 'histUpColor', downColorKey: 'histDownColor' } },
    compute(data, inputs) { return { fi: calculateForceIndex(data, Math.max(1, inputs.length || 13)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_fi`];
      if (v == null) return '';
      const color = v >= 0 ? instance.style.histUpColor : instance.style.histDownColor;
      return _legendIndRow('Force Index', [{ val: _legendFmtVol(v), color }], _subPaneLegendOpts(instance));
    },
  },

  'Klinger Oscillator': {
    label: 'Klinger Oscillator', isSubPane: true, paneKey: 'klinger', paneLabel: 'Klinger Oscillator',
    rangeMode: 'auto', zeroLine: true,
    defaultInputs: { fastLength: 34, slowLength: 55, signalLength: 13 },
    defaultStyle:  { color: '#FFCA28', colorSignal: '#EF5350', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { kvo: { type: 'line', colorKey: 'color' }, signal: { type: 'line', colorKey: 'colorSignal' } },
    compute(data, inputs) {
      const r = calculateKlinger(data, Math.max(1, inputs.fastLength || 34), Math.max(1, inputs.slowLength || 55), Math.max(1, inputs.signalLength || 13));
      return { kvo: r.kvo, signal: r.signal };
    },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_kvo`];
      if (v == null) return '';
      return _legendIndRow('KVO', [
        { val: _legendFmtVol(v), color: instance.style.color },
        { val: candle[`${instance.id}_signal`] != null ? _legendFmtVol(candle[`${instance.id}_signal`]) : null, color: instance.style.colorSignal },
      ], _subPaneLegendOpts(instance));
    },
  },

  NVI: {
    label: 'NVI', isSubPane: true, paneKey: 'nvi', paneLabel: 'Negative Volume Index',
    rangeMode: 'auto-tight',
    defaultInputs: {},
    defaultStyle:  { color: '#EF5350', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { nvi: { type: 'line', colorKey: 'color' } },
    compute(data) { return { nvi: calculateNVI(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_nvi`];
      if (v == null) return '';
      return _legendIndRow('NVI', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  PVI: {
    label: 'PVI', isSubPane: true, paneKey: 'pvi', paneLabel: 'Positive Volume Index',
    rangeMode: 'auto-tight',
    defaultInputs: {},
    defaultStyle:  { color: '#26A69A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { pvi: { type: 'line', colorKey: 'color' } },
    compute(data) { return { pvi: calculatePVI(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_pvi`];
      if (v == null) return '';
      return _legendIndRow('PVI', [{ val: v.toFixed(2), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  PVT: {
    label: 'PVT', isSubPane: true, paneKey: 'pvt', paneLabel: 'Price Volume Trend',
    rangeMode: 'auto-tight',
    defaultInputs: {},
    defaultStyle:  { color: '#8D6E63', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { pvt: { type: 'line', colorKey: 'color' } },
    compute(data) { return { pvt: calculatePVT(data) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_pvt`];
      if (v == null) return '';
      return _legendIndRow('PVT', [{ val: _legendFmtVol(v), color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  'Relative Volume': {
    label: 'Relative Volume', isSubPane: true, paneKey: 'rvol', paneLabel: 'Relative Volume',
    rangeMode: 'auto-tight', refLines: [1],
    defaultInputs: { length: 20 },
    defaultStyle:  { color: '#EC407A', lineWidth: 1.5, lineStyle: 'solid', visible: true, showInLegend: true },
    seriesStyle: { rvol: { type: 'line', colorKey: 'color' } },
    compute(data, inputs) { return { rvol: calculateRVOL(data, Math.max(1, inputs.length || 20)) }; },
    legendRows(instance, candle) {
      if (!instance.style.showInLegend) return '';
      const v = candle[`${instance.id}_rvol`];
      if (v == null) return '';
      return _legendIndRow('RVOL', [{ val: v.toFixed(2) + 'x', color: instance.style.color }], _subPaneLegendOpts(instance));
    },
  },

  // ─── Visible-Range Volume Profile ───────────────────────────────────
  // Unlike every other overlay, this has no per-candle scalar series — the
  // profile is a function of whatever's currently panned/zoomed into view,
  // so compute() is a no-op and all the bucketing happens in draw() itself
  // (reusing geom.minPrice/maxPrice, already the visible price range).
  // Fixed Range and Anchored variants (drag-to-select / click-to-anchor)
  // are out of scope — they need a drawing-tool interaction this pass
  // doesn't add.
  'Volume Profile': {
    label: 'Volume Profile',
    defaultInputs: { rows: 24 },
    defaultStyle:  { colorUp: 'rgba(38,166,154,0.5)', colorDown: 'rgba(239,83,80,0.5)', pocColor: '#FFD700', visible: true, showInLegend: false },
    compute() { return {}; },
    draw(ctx, visibleData, instance, geom) {
      if (!visibleData.length) return;
      const { height, padding, minPrice, maxPrice, width } = geom;
      const chartHeight = height - padding.top - padding.bottom;
      const y0 = padding.top;
      const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

      const rows = Math.max(5, Math.min(100, Math.round(instance.inputs.rows || 24)));
      const bucketSize = (maxPrice - minPrice) / rows || 1;
      const vol = new Array(rows).fill(0);
      const upVol = new Array(rows).fill(0);

      visibleData.forEach(c => {
        const lo = Math.max(minPrice, c.Low), hi = Math.min(maxPrice, c.High);
        const isUp = c.Close >= c.Open;
        if (hi <= lo) {
          const idx = Math.min(rows - 1, Math.max(0, Math.floor((c.Close - minPrice) / bucketSize)));
          vol[idx] += c.Volume || 0;
          if (isUp) upVol[idx] += c.Volume || 0;
          return;
        }
        const startIdx = Math.max(0, Math.floor((lo - minPrice) / bucketSize));
        const endIdx = Math.min(rows - 1, Math.floor((hi - minPrice) / bucketSize));
        const span = Math.max(1, endIdx - startIdx + 1);
        const volPerBucket = (c.Volume || 0) / span;
        for (let idx = startIdx; idx <= endIdx; idx++) {
          vol[idx] += volPerBucket;
          if (isUp) upVol[idx] += volPerBucket;
        }
      });

      const maxBucket = Math.max(1, ...vol);
      const profileWidth = Math.min(160, (width - padding.left - padding.right) * 0.28);
      const pocIdx = vol.indexOf(maxBucket);
      // Anchored to the RIGHT edge of the plot area and grown leftward, the
      // way TradingView draws it: the profile sits against the price axis it
      // is describing, and it shades the most recent bars instead of burying
      // the oldest ones. Up volume keeps the anchored side.
      const xR = width - padding.right;
      const xL = padding.left;

      for (let i = 0; i < rows; i++) {
        if (vol[i] <= 0) continue;
        const yTop = toY(minPrice + (i + 1) * bucketSize);
        const yBot = toY(minPrice + i * bucketSize);
        const barW = (vol[i] / maxBucket) * profileWidth;
        const upW = barW * (upVol[i] / vol[i]);
        const y = Math.min(yTop, yBot), h = Math.max(1, Math.abs(yBot - yTop) - 1);
        ctx.fillStyle = instance.style.colorUp;
        ctx.fillRect(xR - upW, y, upW, h);
        ctx.fillStyle = instance.style.colorDown;
        ctx.fillRect(xR - barW, y, barW - upW, h);
        if (i === pocIdx) {
          ctx.strokeStyle = instance.style.pocColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(xL, y + h / 2);
          ctx.lineTo(xR, y + h / 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    },
    legendRows() { return ''; },
  },
};

// ─── Instance store ─────────────────────────────────────────────
let indicatorInstances = _loadPref('indicatorInstances', []);
let _instanceCounter    = _loadPref('_instanceCounter', 0);

function saveIndicatorInstances() {
  _savePref('indicatorInstances', indicatorInstances);
  _savePref('_instanceCounter', _instanceCounter);
}

// Sub-pane defs share one pane per TYPE (not per instance — see
// indicators/subpane-framework.js), so the pane itself only needs adding to
// enabledIndicators/paneOrder once, on the first instance of that paneKey,
// and removing once, when the last instance of that paneKey is gone. This
// is the only bookkeeping a generic-framework indicator needs to plug into
// the pre-existing stacking/collapse/reorder/resize machinery that MACD/RSI/
// Hilega-Milega already use (candlestick-data.js paneOrder/enabledIndicators,
// candlestick-draw.js's layout loop).
function _registerSubPaneIfNeeded(def) {
  if (!def.isSubPane) return;
  const key = def.paneKey;
  if (!enabledIndicators.includes(key)) {
    enabledIndicators.push(key);
    saveEnabledIndicators();
  }
  if (!paneOrder.includes(key)) {
    paneOrder.push(key);
    savePaneOrder();
  }
}

function _unregisterSubPaneIfEmpty(def) {
  if (!def.isSubPane) return;
  const key = def.paneKey;
  const stillHasInstances = indicatorInstances.some(inst => INDICATOR_DEFS[inst.typeId] === def);
  if (stillHasInstances) return;
  enabledIndicators = enabledIndicators.filter(k => k !== key);
  saveEnabledIndicators();
  collapsedPanes = collapsedPanes.filter(k => k !== key);
  saveCollapsedPanes();
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
  _registerSubPaneIfNeeded(def);
  if (typeof attachIndicatorInstances === 'function' && typeof chartData !== 'undefined') {
    attachIndicatorInstances(chartData);
    if (typeof aggregatedData !== 'undefined' && aggregatedData.length) attachIndicatorInstances(aggregatedData);
  }
  return instance;
}

function removeIndicatorInstance(id) {
  const inst = getIndicatorInstance(id);
  const def  = inst ? INDICATOR_DEFS[inst.typeId] : null;
  indicatorInstances = indicatorInstances.filter(inst => inst.id !== id);
  saveIndicatorInstances();
  if (def) _unregisterSubPaneIfEmpty(def);
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
    if (!def || def.isSubPane) return; // sub-pane instances render via drawGenericSubPane instead
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

// Generic upper/lower band fill + optional middle line — reused by every
// new band-style overlay (Donchian Channels, Keltner Channels, ATR Bands,
// Linear Regression channel) instead of copy-pasting _drawBollingerInstance's
// fill-and-stroke logic once per indicator. `fields` names the instance's
// computed series to read (e.g. {upper:'upper', lower:'lower', middle:'middle'}).
function _drawBandInstance(ctx, visibleData, instance, geom, fields) {
  const { height, candleWidth, padding, minPrice, maxPrice } = geom;
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  const upperPts = [], lowerPts = [];
  visibleData.forEach((candle, idx) => {
    const u = candle[`${instance.id}_${fields.upper}`], l = candle[`${instance.id}_${fields.lower}`];
    if (u == null || l == null) return;
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
  const fillAlpha = instance.style.fillOpacity != null ? instance.style.fillOpacity : 0.1;
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

  if (fields.middle) {
    _drawSingleLine(ctx, visibleData, `${instance.id}_${fields.middle}`, { ...instance, style: { ...instance.style, lineStyle: 'solid' } }, geom);
  }
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

// Linear interpolation between two hex colors — used by MA Ribbon to fan
// its N lines from `colorStart` to `colorEnd`.
function _lerpHexColor(hexA, hexB, t) {
  if (!hexA || hexA[0] !== '#' || !hexB || hexB[0] !== '#') return hexA;
  const a = [1, 3, 5].map(i => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map(i => parseInt(hexB.slice(i, i + 2), 16));
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return '#' + mix.map(v => v.toString(16).padStart(2, '0')).join('');
}
