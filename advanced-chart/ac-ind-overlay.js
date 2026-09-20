/* ════════════════════════════════════════════════════════════
   ac-ind-overlay.js
   PRICE-PANE indicator instances → Lightweight Charts series.

   The Advanced Chart loads ../candlestick_chart/indicator-instances.js
   UNMODIFIED, so every instance's math is already done for us:
   attachIndicatorInstances() (called from attachIndicators() in
   candlestick-data.js) writes each computed series onto the candles as

       candle[`${instance.id}_${outputKey}`]

   This module never calls def.compute() and never calls def.draw()
   (that is the <canvas> path it replaces). It only walks
   `indicatorInstances`, reads those pre-computed fields off
   ACChart.displayData(), and emits Lightweight Charts series through
   ACChart.series(key, type, options, 'price').

   Shapes Lightweight Charts cannot express as a series — band fills,
   the Ichimoku cloud, the visible-range Volume Profile — are painted
   on the transparent overlay canvas through ONE registered overlay
   painter that re-reads window._lastRender, so they track pan/zoom
   without a full drawChart().

   Sub-pane instances (def.isSubPane === true) belong to
   ac-ind-subpane.js and are skipped here.

   Depends on : ac-render.js (window.ACChart, window._lastRender),
                indicator-instances.js (INDICATOR_DEFS, indicatorInstances),
                candlestick-data.js (currentTimeframe),
                lightweight-charts v5 (global LightweightCharts)
   Consumed by: ac-ui.js / candlestick-legend.js via
                window.ACOverlayIndicators
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  // ── Registry access ────────────────────────────────────────────
  // INDICATOR_DEFS / indicatorInstances are top-level `const`/`let` in a
  // classic script, so they live in the shared script scope and are read
  // as bare identifiers — they are NOT properties of window. `indicatorInstances`
  // is *reassigned* by removeIndicatorInstance(), so it must be re-read on
  // every pass rather than captured once.
  function defsRegistry() {
    if (typeof INDICATOR_DEFS !== 'undefined' && INDICATOR_DEFS) return INDICATOR_DEFS;
    return window.INDICATOR_DEFS || null;
  }

  function allInstances() {
    if (typeof indicatorInstances !== 'undefined' && Array.isArray(indicatorInstances)) {
      return indicatorInstances;
    }
    return Array.isArray(window.indicatorInstances) ? window.indicatorInstances : [];
  }

  // ── Per-timeframe visibility ───────────────────────────────────
  // Instances carry a TradingView-style `visibility` map
  // ({ticks,seconds,minutes,hours,days,weeks,months,ranges}). Our
  // timeframes are daily/weekly/monthly, so only three of those keys can
  // ever apply. A missing map or a missing key means "visible".
  const TF_VIS_KEY = { daily: 'days', weekly: 'weeks', monthly: 'months' };

  function hiddenForTimeframe(inst) {
    if (!inst || !inst.visibility) return false;
    const tf = (typeof currentTimeframe !== 'undefined') ? currentTimeframe : 'daily';
    const key = TF_VIS_KEY[tf];
    if (!key) return false;
    return inst.visibility[key] === false;
  }

  // Every price-pane instance that should be drawn this pass.
  function activeOverlayInstances() {
    const DEFS = defsRegistry();
    if (!DEFS) return [];
    const out = [];
    allInstances().forEach((inst) => {
      if (!inst || !inst.style) return;
      const def = DEFS[inst.typeId];
      if (!def || def.isSubPane === true) return;   // agent 4 owns sub-panes
      if (inst.style.visible === false) return;
      if (hiddenForTimeframe(inst)) return;
      out.push({ inst, def });
    });
    return out;
  }

  // ── Style mapping ──────────────────────────────────────────────
  const LS = {
    Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4,
  };

  function lineStyleOf(name) {
    const enumRef = (window.LightweightCharts && window.LightweightCharts.LineStyle) || LS;
    if (name === 'dashed') return enumRef.Dashed;
    if (name === 'dotted') return enumRef.Dotted;
    return enumRef.Solid;
  }

  // Lightweight Charts' LineWidth is 1|2|3|4; the shared defs use 1.5 in a
  // few places. Round into the supported domain rather than risk a v5
  // assertion on a fractional width.
  function lineWidthOf(w) {
    const n = Number(w);
    if (!Number.isFinite(n)) return 1;
    return Math.min(4, Math.max(1, Math.round(n)));
  }

  // Base options shared by every indicator line we emit.
  function lineOptions(style, opts) {
    const o = opts || {};
    return {
      color: o.color || style.color || '#2962FF',
      lineWidth: lineWidthOf(o.lineWidth != null ? o.lineWidth : style.lineWidth),
      lineStyle: lineStyleOf(o.lineStyle != null ? o.lineStyle : style.lineStyle),
      lineVisible: o.lineVisible !== false,
      visible: style.visible !== false,
      // `showLabelOnAxis` is the defs' name for the right-axis price tag.
      // Defs that omit it (Supertrend, Ichimoku, the channels…) get no tag,
      // which is what the canvas page shows.
      lastValueVisible: o.lastValueVisible != null
        ? o.lastValueVisible
        : style.showLabelOnAxis === true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: o.pointMarkersVisible === true,
      ...(o.pointMarkersRadius != null ? { pointMarkersRadius: o.pointMarkersRadius } : {}),
      ...(o.priceFormat ? { priceFormat: o.priceFormat } : {}),
    };
  }

  // ── Colour helpers (hex / rgb / rgba → rgba) ───────────────────
  function withAlpha(color, a) {
    const s = String(color == null ? '' : color).trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      const r = parseInt(m[1][0] + m[1][0], 16);
      const g = parseInt(m[1][1] + m[1][1], 16);
      const b = parseInt(m[1][2] + m[1][2], 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
    if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
    return s || 'rgba(0,0,0,0)';
  }

  // Mirrors indicator-instances.js `_lerpHexColor` so MA Ribbon fans its
  // lines from colorStart to colorEnd exactly like the canvas page.
  function lerpHex(hexA, hexB, t) {
    if (!hexA || hexA[0] !== '#' || !hexB || hexB[0] !== '#' ||
        hexA.length !== 7 || hexB.length !== 7) return hexA;
    const a = [1, 3, 5].map(i => parseInt(hexA.slice(i, i + 2), 16));
    const b = [1, 3, 5].map(i => parseInt(hexB.slice(i, i + 2), 16));
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  // ── Data extraction ────────────────────────────────────────────
  // Values come straight off the candles; null/undefined/NaN becomes
  // `{ time, value: undefined }`, which Lightweight Charts renders as a
  // whitespace gap — exactly what an indicator's warm-up prefix should be.
  //
  // `shift` moves the plot along the time axis: out[i] takes its value from
  // data[i - shift], so +n plots into the future and -n into the past.
  function seriesData(field, opts) {
    const o = opts || {};
    const data = ACChart.displayData() || [];
    const shift = o.shift || 0;
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const t = ACChart.timeOfIndex(i);
      const src = shift ? data[i - shift] : data[i];
      let v = src ? src[field] : null;
      if (v == null || typeof v !== 'number' || !Number.isFinite(v)) v = undefined;
      out[i] = { time: t, value: v };
    }
    return out;
  }

  // A per-point predicate variant: used by Supertrend / Volatility Stop,
  // which split one output into two differently-coloured series.
  function seriesDataWhere(field, keep) {
    const data = ACChart.displayData() || [];
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      let v = c ? c[field] : null;
      if (v == null || typeof v !== 'number' || !Number.isFinite(v) || !keep(c, i)) v = undefined;
      out[i] = { time: ACChart.timeOfIndex(i), value: v };
    }
    return out;
  }

  function hasAnyValue(rows) {
    for (let i = 0; i < rows.length; i++) if (rows[i].value !== undefined) return true;
    return false;
  }

  // ── Series emission ────────────────────────────────────────────
  function put(key, type, options, data) {
    const api = ACChart.series(key, type, options, 'price');
    if (!api) return null;
    api.setData(data);
    return api;
  }

  function seriesKeyFor(instance, outputKey) {
    const id = (instance && typeof instance === 'object') ? instance.id : instance;
    return String(id) + ':' + String(outputKey);
  }

  function line(inst, outputKey, styleOpts, dataOpts) {
    return put(
      seriesKeyFor(inst, outputKey),
      'line',
      lineOptions(inst.style, styleOpts),
      seriesData(`${inst.id}_${outputKey}`, dataOpts)
    );
  }

  // ── Series markers (MA Cross) ──────────────────────────────────
  // v5 has no series.setMarkers(); markers are a plugin attached with
  // LightweightCharts.createSeriesMarkers(series, markers). The primitive
  // dies with its series, so the handle is cached against the series api
  // that owns it and re-created whenever ACChart hands back a new one.
  const _markerPrims = new Map();     // key -> { api, prim }
  let _usedMarkerKeys = new Set();

  function setMarkers(key, seriesApi, markers) {
    if (!seriesApi || !window.LightweightCharts ||
        typeof window.LightweightCharts.createSeriesMarkers !== 'function') return;
    _usedMarkerKeys.add(key);
    let entry = _markerPrims.get(key);
    if (entry && entry.api !== seriesApi) {
      try { entry.prim.detach(); } catch (e) { /* series already gone */ }
      entry = null;
    }
    if (!entry) {
      try {
        entry = { api: seriesApi, prim: window.LightweightCharts.createSeriesMarkers(seriesApi, markers) };
        _markerPrims.set(key, entry);
      } catch (e) { return; }
    } else {
      try { entry.prim.setMarkers(markers); } catch (e) { /* ignore */ }
    }
  }

  function sweepMarkers() {
    const dead = [];
    _markerPrims.forEach((entry, key) => { if (!_usedMarkerKeys.has(key)) dead.push(key); });
    dead.forEach((key) => {
      const entry = _markerPrims.get(key);
      try { entry.prim.detach(); } catch (e) { /* series already removed */ }
      _markerPrims.delete(key);
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Per-type renderers
  // ════════════════════════════════════════════════════════════════

  // Single-line overlays: type → the one output key compute() produces.
  const SINGLE_LINE = {
    EMA: 'ema',
    SMA: 'sma',
    WMA: 'wma',
    HMA: 'hma',
    DEMA: 'dema',
    TEMA: 'tema',
    KAMA: 'kama',
    ALMA: 'alma',
    VWMA: 'vwma',
    VWAP: 'vwap',
    'Anchored VWAP': 'avwap',
  };

  // Band overlays rendered by _drawBandInstance on the canvas: which output
  // keys are the envelope, which (if any) is the centre line, and the fill
  // opacity the canvas falls back to when style.fillOpacity is unset.
  const BANDS = {
    'Bollinger Bands':   { upper: 'upper', lower: 'lower', middle: 'middle', defAlpha: 0.15 },
    'Donchian Channels': { upper: 'upper', lower: 'lower', middle: 'middle', defAlpha: 0.1 },
    'Keltner Channels':  { upper: 'upper', lower: 'lower', middle: 'middle', defAlpha: 0.1 },
    'Linear Regression': { upper: 'upper', lower: 'lower', middle: 'line',   defAlpha: 0.1 },
    'ATR Bands':         { upper: 'upper', lower: 'lower', middle: null,     defAlpha: 0.1 },
  };

  function renderBand(inst, spec) {
    // Envelope keeps the instance's own line style (BB/ATR Bands default to
    // dashed); the centre line is always solid, same as _drawBandInstance.
    line(inst, spec.upper);
    line(inst, spec.lower);
    if (spec.middle) line(inst, spec.middle, { lineStyle: 'solid' });
  }

  function renderIchimoku(inst) {
    const s = inst.style;
    const disp = Math.max(0, Math.round(inst.inputs && inst.inputs.displacement != null ? inst.inputs.displacement : 26));
    line(inst, 'tenkan',  { color: s.colorTenkan || '#2196F3' });
    line(inst, 'kijun',   { color: s.colorKijun  || '#FF5722' });
    // Senkou A/B are plotted UNSHIFTED, matching the instance def's draw()
    // and therefore the hover legend, which reads candle[id_senkouA] at the
    // crosshair bar. (The stand-alone, non-instance ichimoku.js overlay does
    // displace them by 26 — that variant is not what an instance renders.)
    line(inst, 'senkouA', { color: s.colorA || '#26a69a' });
    line(inst, 'senkouB', { color: s.colorB || '#ef5350' });
    // Chikou is compute()d as the raw Close, so drawing it unshifted would
    // just retrace the price line; it is only meaningful displaced BACK by
    // `displacement` bars, which is how every Ichimoku renders it.
    line(inst, 'chikou', {
      color: s.colorChikou || '#ab47bc', lineStyle: 'dashed', lineWidth: 1,
    }, { shift: -disp });
  }

  function renderSupertrend(inst) {
    // Lightweight Charts has no per-point line colour, so the single
    // Supertrend line is split into an "uptrend" and a "downtrend" series,
    // each carrying whitespace where the other is active. Runs therefore
    // break at every flip exactly as the canvas's per-run paths do, without
    // creating a fresh series per run.
    const field = `${inst.id}_supertrend`;
    const trendField = `${inst.id}_trend`;
    put(seriesKeyFor(inst, 'supertrend:up'), 'line',
      lineOptions(inst.style, { color: inst.style.colorUp || '#10b981' }),
      seriesDataWhere(field, c => c[trendField] === 1));
    put(seriesKeyFor(inst, 'supertrend:down'), 'line',
      lineOptions(inst.style, { color: inst.style.colorDown || '#ef4444' }),
      seriesDataWhere(field, c => c[trendField] !== 1));
  }

  function renderMARibbon(inst) {
    const count = Math.max(1, Math.min(12, Math.round((inst.inputs && inst.inputs.count) || 6)));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      line(inst, `line${i}`, {
        color: lerpHex(inst.style.colorStart || '#42A5F5', inst.style.colorEnd || '#EF5350', t),
      });
    }
  }

  function renderMACross(inst) {
    const fastApi = line(inst, 'fast', { color: inst.style.colorFast || '#42A5F5' });
    line(inst, 'slow', { color: inst.style.colorSlow || '#FF7043' });

    // Cross markers ride the fast line, matching the canvas dot placement.
    const data = ACChart.displayData() || [];
    const upKey = `${inst.id}_crossUp`, downKey = `${inst.id}_crossDown`;
    const markers = [];
    for (let i = 0; i < data.length; i++) {
      const up = data[i][upKey], down = data[i][downKey];
      if (!up && !down) continue;
      if (data[i][`${inst.id}_fast`] == null) continue;
      markers.push({
        time: ACChart.timeOfIndex(i),
        position: 'inBar',
        shape: 'circle',
        size: 1,
        color: up ? (inst.style.markerUpColor || '#10b981') : (inst.style.markerDownColor || '#ef4444'),
      });
    }
    setMarkers(seriesKeyFor(inst, 'cross'), fastApi, markers);
  }

  function renderParabolicSAR(inst) {
    // A line series with the stroke switched off and point markers on is the
    // closest LWC analogue of the canvas's per-bar dots, and unlike
    // createSeriesMarkers it places each dot at the SAR *price*.
    put(seriesKeyFor(inst, 'sar'), 'line',
      lineOptions(inst.style, {
        color: inst.style.color || '#FFEB3B',
        lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2,
        lineStyle: 'dotted',
      }),
      seriesData(`${inst.id}_sar`));
  }

  function renderVolatilityStop(inst) {
    const field = `${inst.id}_stop`;
    const trendField = `${inst.id}_trend`;
    const dotOpts = { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2.5, lineStyle: 'dotted' };
    put(seriesKeyFor(inst, 'stop:up'), 'line',
      lineOptions(inst.style, { ...dotOpts, color: inst.style.colorUp || '#10b981' }),
      seriesDataWhere(field, c => c[trendField] === 1));
    put(seriesKeyFor(inst, 'stop:down'), 'line',
      lineOptions(inst.style, { ...dotOpts, color: inst.style.colorDown || '#ef4444' }),
      seriesDataWhere(field, c => c[trendField] !== 1));
  }

  // Fallback for any price-pane def this module does not know by name —
  // e.g. one added to INDICATOR_DEFS after this file was written. The
  // instance's output keys are recovered from the candles themselves
  // (attachIndicatorInstances stamps `${id}_${key}` on every candle), so a
  // new single- or multi-line overlay still renders instead of vanishing.
  const NON_PRICE_OUTPUTS = new Set(['trend', 'crossUp', 'crossDown', 'signal']);

  function renderGeneric(inst) {
    const data = ACChart.displayData() || [];
    const probe = data[data.length - 1];
    if (!probe) return;
    const prefix = inst.id + '_';
    const keys = [];
    for (const k in probe) {
      if (k.indexOf(prefix) !== 0) continue;
      const out = k.slice(prefix.length);
      if (NON_PRICE_OUTPUTS.has(out)) continue;
      keys.push(out);
    }
    if (!keys.length) return;
    const baseColor = inst.style.color || inst.style.colorUp || inst.style.colorA ||
                      inst.style.colorFast || inst.style.colorStart || '#2962FF';
    keys.sort().forEach((out, i) => {
      const rows = seriesData(prefix + out);
      if (!hasAnyValue(rows)) return;
      put(seriesKeyFor(inst, out), 'line',
        lineOptions(inst.style, { color: i === 0 ? baseColor : withAlpha(baseColor, 0.6) }),
        rows);
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Render hook
  // ════════════════════════════════════════════════════════════════
  function renderOverlayIndicators() {
    if (!window.ACChart || !ACChart.ready()) return;
    if (ACChart.paneIndex('price') < 0) return;
    const data = ACChart.displayData();
    if (!data || !data.length) return;

    _usedMarkerKeys = new Set();

    activeOverlayInstances().forEach(({ inst, def }) => {
      try {
        const type = inst.typeId;

        if (SINGLE_LINE[type]) { line(inst, SINGLE_LINE[type]); return; }
        if (BANDS[type])       { renderBand(inst, BANDS[type]); return; }

        switch (type) {
          case 'Ichimoku Cloud':  renderIchimoku(inst); return;
          case 'Supertrend':      renderSupertrend(inst); return;
          case 'MA Ribbon':       renderMARibbon(inst); return;
          case 'MA Cross':        renderMACross(inst); return;
          case 'Parabolic SAR':   renderParabolicSAR(inst); return;
          case 'Volatility Stop': renderVolatilityStop(inst); return;
          // Volume Profile is a horizontal histogram of the VISIBLE range —
          // no per-bar series exists for it at all. Painted on the overlay.
          case 'Volume Profile':  return;
          default:                renderGeneric(inst, def); return;
        }
      } catch (e) {
        console.warn('[AC] overlay indicator', inst && inst.typeId, e);
      }
    });

    sweepMarkers();
  }

  // ════════════════════════════════════════════════════════════════
  //  Overlay painter — the shapes LWC cannot express as a series
  //
  //  ONE painter, registered once, that re-walks indicatorInstances on
  //  every repaint. That keeps it self-cleaning (a removed instance simply
  //  stops being walked, no painter to unregister) and, because
  //  ac-render.js repaints the overlay on every pan/zoom as well as every
  //  drawChart(), the fills and the visible-range Volume Profile stay
  //  glued to the bars without a full re-render.
  // ════════════════════════════════════════════════════════════════
  function plotRight(fallbackWidth) {
    try {
      const w = ACChart.chart().timeScale().width();
      if (Number.isFinite(w) && w > 0) return w;
    } catch (e) { /* fall through */ }
    return fallbackWidth;
  }

  function paintOverlayShapes(ctx, width) {
    const r = window._lastRender;
    if (!r || !r.priceRange || !r.visibleData || !r.visibleData.length) return;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    if (!(maxPrice > minPrice) || !(paneHeight > 0)) return;

    const geom = {
      visible: r.visibleData,
      right: plotRight(width),
      left: r.padding.left,
      paneY0, paneHeight, minPrice, maxPrice,
      toX: idx => r.padding.left + (idx + 0.5) * r.candleWidth,
      toY: v => paneY0 + paneHeight * (1 - (v - minPrice) / (maxPrice - minPrice)),
    };

    ctx.save();
    // Clip to the price pane so nothing bleeds into volume / sub-panes.
    ctx.beginPath();
    ctx.rect(0, paneY0, geom.right, paneHeight);
    ctx.clip();

    activeOverlayInstances().forEach(({ inst }) => {
      try {
        const spec = BANDS[inst.typeId];
        if (spec) { paintBandFill(ctx, geom, inst, spec); return; }
        if (inst.typeId === 'Ichimoku Cloud') { paintIchimokuCloud(ctx, geom, inst); return; }
        if (inst.typeId === 'Volume Profile') { paintVolumeProfile(ctx, geom, inst); return; }
      } catch (e) {
        console.warn('[AC] overlay indicator fill', inst && inst.typeId, e);
      }
    });

    ctx.restore();
  }

  // Bollinger Bands / Donchian / Keltner / ATR Bands / Linear Regression
  // channel: the translucent ribbon between upper and lower. Mirrors
  // _drawBandInstance's fill (the strokes themselves are LWC series).
  function paintBandFill(ctx, geom, inst, spec) {
    const alpha = inst.style.fillOpacity != null ? inst.style.fillOpacity : spec.defAlpha;
    if (!alpha) return;
    const uKey = `${inst.id}_${spec.upper}`, lKey = `${inst.id}_${spec.lower}`;
    const up = [], lo = [];
    geom.visible.forEach((c, idx) => {
      const u = c[uKey], l = c[lKey];
      if (u == null || l == null) return;
      const x = geom.toX(idx);
      up.push({ x, y: geom.toY(u) });
      lo.push({ x, y: geom.toY(l) });
    });
    if (up.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(up[0].x, up[0].y);
    for (let i = 1; i < up.length; i++) ctx.lineTo(up[i].x, up[i].y);
    for (let i = lo.length - 1; i >= 0; i--) ctx.lineTo(lo[i].x, lo[i].y);
    ctx.closePath();
    ctx.fillStyle = withAlpha(inst.style.color, alpha);
    ctx.fill();
  }

  // The Ichimoku cloud: two-tone by whether Senkou A is above or below
  // Senkou B, broken into runs so each run gets its own colour — same
  // algorithm as _drawIchimokuInstance, same 0.16 fill alpha.
  function paintIchimokuCloud(ctx, geom, inst) {
    const aKey = `${inst.id}_senkouA`, bKey = `${inst.id}_senkouB`;
    const pts = geom.visible.map((c, idx) => ({
      x: geom.toX(idx),
      a: c[aKey] != null ? geom.toY(c[aKey]) : null,
      b: c[bKey] != null ? geom.toY(c[bKey]) : null,
    }));
    const colorA = inst.style.colorA || '#26a69a';
    const colorB = inst.style.colorB || '#ef5350';
    const alpha = inst.style.fillOpacity != null ? inst.style.fillOpacity : 0.16;

    let i = 0;
    while (i < pts.length) {
      if (pts[i].a == null || pts[i].b == null) { i++; continue; }
      const bullish = pts[i].a <= pts[i].b;   // screen y: A above B == bullish
      let j = i;
      while (j < pts.length && pts[j].a != null && pts[j].b != null &&
             (pts[j].a <= pts[j].b) === bullish) j++;
      const seg = pts.slice(i, j);
      if (seg.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(seg[0].x, seg[0].a);
        seg.forEach(p => ctx.lineTo(p.x, p.a));
        for (let k = seg.length - 1; k >= 0; k--) ctx.lineTo(seg[k].x, seg[k].b);
        ctx.closePath();
        ctx.fillStyle = withAlpha(bullish ? colorA : colorB, alpha);
        ctx.fill();
      }
      i = j;
    }
  }

  // Visible-range Volume Profile — a horizontal histogram bucketed over the
  // on-screen price range, anchored to the right edge. Straight port of the
  // def's draw(), with _lastRender.priceRange standing in for the canvas geom.
  function paintVolumeProfile(ctx, geom, inst) {
    const { minPrice, maxPrice } = geom;
    const rows = Math.max(5, Math.min(100, Math.round((inst.inputs && inst.inputs.rows) || 24)));
    const bucketSize = (maxPrice - minPrice) / rows || 1;
    const vol = new Array(rows).fill(0);
    const upVol = new Array(rows).fill(0);

    geom.visible.forEach((c) => {
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
      const per = (c.Volume || 0) / span;
      for (let idx = startIdx; idx <= endIdx; idx++) {
        vol[idx] += per;
        if (isUp) upVol[idx] += per;
      }
    });

    const maxBucket = Math.max(1, ...vol);
    const profileWidth = Math.min(160, Math.max(0, geom.right - geom.left) * 0.28);
    const pocIdx = vol.indexOf(maxBucket);
    // Anchored to the RIGHT edge of the plot area and grown leftward, the way
    // TradingView draws it. geom.right is the time scale's width, so the
    // profile sits flush against the price axis it is describing, and it
    // shades the most recent bars instead of burying the oldest ones under a
    // block the reader has to look past. Up volume keeps the anchored side.
    const xR = Math.max(0, geom.right);
    const xL = Math.max(0, geom.left);

    for (let i = 0; i < rows; i++) {
      if (vol[i] <= 0) continue;
      const yTop = geom.toY(minPrice + (i + 1) * bucketSize);
      const yBot = geom.toY(minPrice + i * bucketSize);
      const barW = (vol[i] / maxBucket) * profileWidth;
      const upW = barW * (upVol[i] / vol[i]);
      const y = Math.min(yTop, yBot), h = Math.max(1, Math.abs(yBot - yTop) - 1);
      ctx.fillStyle = inst.style.colorUp || 'rgba(38,166,154,0.5)';
      ctx.fillRect(xR - upW, y, upW, h);
      ctx.fillStyle = inst.style.colorDown || 'rgba(239,83,80,0.5)';
      ctx.fillRect(xR - barW, y, barW - upW, h);
      if (i === pocIdx) {
        ctx.strokeStyle = inst.style.pocColor || '#FFD700';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(xL, y + h / 2);
        ctx.lineTo(xR, y + h / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────
  if (!window.ACChart || typeof ACChart.addRenderHook !== 'function') {
    console.error('[AC] ac-ind-overlay.js loaded before ac-render.js — price-pane indicators disabled');
    return;
  }
  ACChart.addRenderHook('overlay-indicators', renderOverlayIndicators);
  // 'ac-ind-' sorts ahead of any other painter a later module registers.
  ACChart.addOverlayPainter('ac-ind-fills', paintOverlayShapes);

  function refresh() {
    if (typeof drawChart === 'function') drawChart();
    else if (window.ACChart && ACChart.ready() && typeof window.__acRender === 'function') window.__acRender();
  }

  window.ACOverlayIndicators = { refresh, seriesKeyFor };

})();
