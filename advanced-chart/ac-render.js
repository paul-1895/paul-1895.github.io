/* ════════════════════════════════════════════════════════════
   ac-render.js
   THE RENDERER for the Advanced Chart page — the Lightweight
   Charts v5 replacement for candlestick_chart/candlestick-draw.js.

   Everything else on this page (candlestick-data.js, indicators/*,
   indicator-instances.js, candlestick-legend.js, tv-drawing-tools.js,
   tv-trade-markers.js, sm-trade-overlay.js and every analysis panel)
   is loaded UNMODIFIED from ../candlestick_chart/. They all talk to
   the renderer through exactly three things, which this file owns:

     drawChart()          — full re-render, called by everyone
     window._lastRender   — pixel <-> (index, price) geometry bridge
     window.ACChart       — the pane / series / overlay API the
                            ac-*.js modules render through

   See ARCHITECTURE.md for the full contract.

   Depends on : candlestick-data.js (chartData, aggregatedData,
                chartType, replayMode, paneOrder, enabledIndicators,
                calculateHeikinAshi, calculateRenko, renkoSettings),
                lightweight-charts v5 (global LightweightCharts)
   Consumed by: every other ac-*.js module
   ════════════════════════════════════════════════════════════ */
'use strict';

// ─── Pane bookkeeping (mirrors candlestick-draw.js so the shared
//     pane-control UI and persisted pane prefs keep working) ──────
const GENERIC_SUBPANE_KEYS = [
  // Trend
  'adxdmi', 'aroon', 'linregslope', 'vortex', 'trix', 'kst', 'massindex', 'chandeforecast',
  // Momentum
  'stoch', 'stochrsi', 'willr', 'cci', 'roc', 'mom', 'ao', 'ac', 'uo',
  'rvivigor', 'connorsrsi', 'cmo', 'fisher', 'dpo', 'ppo',
  // Volatility
  'bbwidth', 'atr', 'stddev', 'histvol', 'chaikinvol', 'ulcer', 'rvivol',
  // Volume
  'obv', 'ad', 'cmf', 'mfi', 'volosc', 'eom', 'forceindex', 'klinger',
  'nvi', 'pvi', 'pvt', 'rvol',
];

const COLLAPSED_H = 28;
const paneHeights = { price: 420, volume: 90, macd: 120, rsi: 120, hm: 130 };
GENERIC_SUBPANE_KEYS.forEach(k => { paneHeights[k] = 120; });

const PANE_HEIGHT_KEY = { MACD: 'macd', RSI: 'rsi', 'Hilega-Milega': 'hm' };
GENERIC_SUBPANE_KEYS.forEach(k => { PANE_HEIGHT_KEY[k] = k; });

// A pristine copy of the authored heights, taken BEFORE the persisted ones are
// merged in — this is what "Reset view" restores to, so a column the user has
// dragged around for a while can always be put back.
const PANE_HEIGHT_DEFAULTS = { ...paneHeights };

// Persisted pane heights, same _loadPref/_savePref convention as the rest.
(function _restorePaneHeights() {
  const saved = (typeof _loadPref === 'function') ? _loadPref('acPaneHeights', null) : null;
  if (saved && typeof saved === 'object') Object.assign(paneHeights, saved);
})();
function saveACPaneHeights() {
  if (typeof _savePref === 'function') _savePref('acPaneHeights', paneHeights);
}

// Put every pane back to its authored height and un-collapse anything the user
// has folded down — a collapsed pane is a 28px height, so resetting heights
// without this would visibly skip it.
function resetACPaneHeights() {
  Object.keys(paneHeights).forEach((k) => { delete paneHeights[k]; });
  Object.assign(paneHeights, PANE_HEIGHT_DEFAULTS);
  saveACPaneHeights();
  if (typeof collapsedPanes !== 'undefined' && collapsedPanes.length) {
    collapsedPanes.length = 0;
    if (typeof saveCollapsedPanes === 'function') saveCollapsedPanes();
  }
}

(function () {

  // ── Module state ───────────────────────────────────────────────
  let chart = null;
  let containerEl = null;
  let overlayEl = null;
  let overlayCtx = null;

  let _paneKeys = [];                  // ordered pane keys currently on the chart
  const _seriesCache = new Map();      // key -> { api, type, paneKey, touched }
  const _renderHooks = new Map();      // name -> fn
  const _overlayPainters = new Map();  // name -> fn(ctx, width, priceBottom)

  let _displayData = [];               // candles as currently rendered
  let _times = [];                     // parallel LWC time values
  let _timeToIndex = new Map();
  let _rendering = false;
  let _pendingFit = true;
  let _maximizedPane = null;      // pane key shown alone, or null

  // ── Theme tokens ───────────────────────────────────────────────
  function tok(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function colors() {
    const theme = window.DSEChartTheme;
    return {
      bg:        tok('bg-card', '#0d1117'),
      grid:      tok('border', 'rgba(255,255,255,0.06)'),
      text:      tok('text-secondary', '#8a93a6'),
      textMuted: tok('text-muted', '#6b7280'),
      gain:      theme ? theme.gain('#26a69a') : tok('gain', '#26a69a'),
      loss:      theme ? theme.loss('#ef5350') : tok('loss', '#ef5350'),
      accent:    tok('accent', '#00f5c4'),
    };
  }

  function alpha(color, a) {
    const theme = window.DSEChartTheme;
    if (theme && typeof theme.alpha === 'function') {
      const out = theme.alpha(color, a);
      if (out) return out;
    }
    const m = /^#([0-9a-f]{6})$/i.exec(String(color || ''));
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // ── Time mapping ───────────────────────────────────────────────
  // Lightweight Charts rejects duplicate or non-increasing times, and our
  // sources produce both: historical_prices files can carry two rows for one
  // Date, and Renko emits many bricks that all share the date of the candle
  // that produced them. So every render assigns strictly-increasing UTC
  // timestamps — the real UTC midnight where it is free, +1s steps where a
  // date repeats. Daily/weekly/monthly data therefore still lands on exact
  // midnights and the date axis reads normally.
  function buildTimes(data) {
    const times = new Array(data.length);
    const index = new Map();
    let prev = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const key = String(data[i].Date || '').replace(/\//g, '-').slice(0, 10);
      const ms = Date.parse(key + 'T00:00:00Z');
      let t = Number.isFinite(ms) ? Math.floor(ms / 1000) : prev + 86400;
      if (t <= prev) t = prev + 1;
      times[i] = t;
      index.set(t, i);
      prev = t;
    }
    return { times, index };
  }

  function fmtAxisDate(ts) {
    const d = new Date(ts * 1000);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    if (typeof currentTimeframe !== 'undefined' && currentTimeframe === 'monthly') {
      return `${mon} ${d.getUTCFullYear()}`;
    }
    return `${d.getUTCDate()} ${mon} ${String(d.getUTCFullYear()).slice(2)}`;
  }

  // ── Chart creation ─────────────────────────────────────────────
  function createChart(el) {
    const c = colors();
    containerEl = el;
    chart = LightweightCharts.createChart(el, {
      autoSize: true,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: c.bg },
        textColor: c.text,
        attributionLogo: false,
        panes: { separatorColor: c.grid, separatorHoverColor: alpha(c.accent, 0.35), enableResize: true },
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.grid, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: {
        borderColor: c.grid,
        rightOffset: 6,
        barSpacing: 8,
        // 0.5px/bar (the LWC default) clamps the range bar's "All" to ~1,835
        // of BPML's 1,943 bars in a ~920px pane — i.e. "All" silently isn't
        // all. 0.02 leaves room for a ~45,000-bar history.
        minBarSpacing: 0.02,
        timeVisible: false,
        secondsVisible: false,
        tickMarkFormatter: ts => fmtAxisDate(ts),
      },
      localization: { timeFormatter: ts => fmtAxisDate(ts) },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: c.textMuted, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: c.accent },
        horzLine: { color: c.textMuted, width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: c.accent },
      },
      handleScroll: true,
      handleScale: true,
    });

    _paneKeys = ['price'];

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      computeLastRender();
      repaintOverlay();
      if (typeof window.__acOnVisibleRangeChange === 'function') window.__acOnVisibleRangeChange();
    });

    window.addEventListener('resize', () => { sizeOverlay(); computeLastRender(); repaintOverlay(); });

    return chart;
  }

  function applyTheme() {
    if (!chart) return;
    const c = colors();
    chart.applyOptions({
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: c.bg },
        textColor: c.text,
        panes: { separatorColor: c.grid, separatorHoverColor: alpha(c.accent, 0.35) },
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.grid },
      timeScale: { borderColor: c.grid },
      crosshair: {
        vertLine: { color: c.textMuted, labelBackgroundColor: c.accent },
        horzLine: { color: c.textMuted, labelBackgroundColor: c.accent },
      },
    });
    if (typeof drawChart === 'function') drawChart();
  }

  // ── Pane reconciliation ────────────────────────────────────────
  function activeSubPaneKeys() {
    const order = (typeof paneOrder !== 'undefined') ? paneOrder : ['MACD', 'RSI', 'Hilega-Milega'];
    const on = (typeof enabledIndicators !== 'undefined') ? enabledIndicators : [];
    return order.filter(k => on.includes(k)).map(k => PANE_HEIGHT_KEY[k] || k);
  }

  function desiredPaneKeys() {
    const all = ['price', 'volume', ...activeSubPaneKeys()];
    // Maximizing shows that pane ALONE. Growing it instead would only shrink
    // the others, because applyPaneHeights() turns heights into proportional
    // stretch factors — the whole point of a maximize is that the other panes
    // get out of the way, which is also what TradingView does.
    if (_maximizedPane && all.includes(_maximizedPane)) return [_maximizedPane];
    return all;
  }

  function setMaximizedPane(paneKey) {
    const next = paneKey || null;
    if (next === _maximizedPane) return;
    _maximizedPane = next;
    render();
  }

  function syncPanes(desired) {
    if (desired.length === _paneKeys.length && desired.every((k, i) => k === _paneKeys[i])) {
      applyPaneHeights();
      return false;
    }
    // Panes are positional in Lightweight Charts, so any change to the set or
    // the order is handled by rebuilding: every cached series is dropped and
    // the render hooks recreate what they still need in this same pass.
    purgeAllSeries();
    const panes = chart.panes();
    for (let i = panes.length - 1; i >= 1; i--) chart.removePane(i);
    for (let i = 1; i < desired.length; i++) chart.addPane(true);
    _paneKeys = desired.slice();
    applyPaneHeights();
    return true;
  }

  // Pane sizing goes through setStretchFactor, NOT setHeight. setHeight is
  // absolute and redistributes the remainder across the other panes, so a loop
  // of setHeight calls fights itself — measured: asking for [400,90,120] across
  // three panes lands on [417,133,120], only the last call surviving. Stretch
  // factors are relative and settle deterministically: the same request as
  // proportions lands on [447,96,127] of the 670px available, and is idempotent
  // under repeated application.
  function applyPaneHeights() {
    const panes = chart.panes();
    const collapsed = (typeof collapsedPanes !== 'undefined') ? collapsedPanes : [];
    const wanted = _paneKeys.map((key) => {
      const displayKey = Object.keys(PANE_HEIGHT_KEY).find(k => PANE_HEIGHT_KEY[k] === key) || key;
      const isCollapsed = collapsed.includes(displayKey) || collapsed.includes(key);
      return isCollapsed ? COLLAPSED_H : (paneHeights[key] || 120);
    });
    const total = wanted.reduce((a, b) => a + b, 0) || 1;
    _paneKeys.forEach((key, i) => {
      const pane = panes[i];
      if (!pane) return;
      try { pane.setStretchFactor(wanted[i] / total); } catch (e) { /* advisory */ }
    });
  }

  // Read the panes' real pixel heights back into `paneHeights`, so a height the
  // user produced by dragging a separator is what gets persisted and restored.
  function syncPaneHeightsFromChart() {
    const panes = chart.panes();
    let changed = false;
    _paneKeys.forEach((key, i) => {
      const pane = panes[i];
      if (!pane) return;
      const h = Math.round(pane.getHeight());
      if (h > 0 && Math.abs((paneHeights[key] || 0) - h) > 1) { paneHeights[key] = h; changed = true; }
    });
    return changed;
  }

  function paneIndex(paneKey) { return _paneKeys.indexOf(paneKey); }

  const PANE_SEPARATOR = 1; // LWC draws a 1px separator between panes

  function paneTop(paneKey) {
    const idx = paneIndex(paneKey);
    if (idx < 0) return 0;
    const panes = chart.panes();
    let y = 0;
    for (let i = 0; i < idx; i++) y += (panes[i] ? panes[i].getHeight() : 0) + PANE_SEPARATOR;
    return y;
  }

  function paneHeightOf(paneKey) {
    const idx = paneIndex(paneKey);
    const panes = chart.panes();
    return (idx >= 0 && panes[idx]) ? panes[idx].getHeight() : 0;
  }

  // ── Keyed series cache ─────────────────────────────────────────
  const SERIES_DEF = {
    line:        () => LightweightCharts.LineSeries,
    area:        () => LightweightCharts.AreaSeries,
    histogram:   () => LightweightCharts.HistogramSeries,
    baseline:    () => LightweightCharts.BaselineSeries,
    candlestick: () => LightweightCharts.CandlestickSeries,
    bar:         () => LightweightCharts.BarSeries,
  };

  function series(key, type, options, paneKey) {
    const wantPane = paneKey || 'price';
    const idx = paneIndex(wantPane);
    if (idx < 0) return null;

    let entry = _seriesCache.get(key);
    if (entry && (entry.type !== type || entry.paneKey !== wantPane)) {
      try { chart.removeSeries(entry.api); } catch (e) {}
      _seriesCache.delete(key);
      entry = null;
    }
    if (!entry) {
      const def = (SERIES_DEF[type] || SERIES_DEF.line)();
      const api = chart.addSeries(def, options || {}, idx);
      entry = { api, type, paneKey: wantPane, touched: true };
      _seriesCache.set(key, entry);
    } else if (options) {
      entry.api.applyOptions(options);
    }
    entry.touched = true;
    return entry.api;
  }

  function touch(key) {
    const entry = _seriesCache.get(key);
    if (entry) entry.touched = true;
  }

  function dropSeries(key) {
    const entry = _seriesCache.get(key);
    if (!entry) return;
    try { chart.removeSeries(entry.api); } catch (e) {}
    _seriesCache.delete(key);
  }

  function purgeAllSeries() {
    _seriesCache.forEach((entry) => { try { chart.removeSeries(entry.api); } catch (e) {} });
    _seriesCache.clear();
  }

  function beginRender() { _seriesCache.forEach(e => { e.touched = false; }); }

  function endRender() {
    const dead = [];
    _seriesCache.forEach((entry, key) => { if (!entry.touched) dead.push(key); });
    dead.forEach(dropSeries);
  }

  // ── Price + volume series ──────────────────────────────────────
  function renderPriceSeries(data, times) {
    const c = colors();
    const type = (typeof chartType !== 'undefined') ? chartType : 'candlestick';

    let kind = 'candlestick';
    let opts = {
      upColor: c.gain, downColor: c.loss, borderVisible: true,
      borderUpColor: c.gain, borderDownColor: c.loss,
      wickUpColor: c.gain, wickDownColor: c.loss,
      priceLineVisible: true, lastValueVisible: true,
    };

    if (type === 'hollow') {
      // TradingView's hollow candles: up bars are outline-only, down bars filled.
      opts = { ...opts, upColor: 'rgba(0,0,0,0)', wickUpColor: c.gain, borderUpColor: c.gain };
    } else if (type === 'bars') {
      kind = 'bar';
      opts = { upColor: c.gain, downColor: c.loss, thinBars: false, priceLineVisible: true, lastValueVisible: true };
    } else if (type === 'line') {
      kind = 'line';
      opts = { color: c.accent, lineWidth: 2, priceLineVisible: true, lastValueVisible: true };
    } else if (type === 'area') {
      kind = 'area';
      opts = {
        lineColor: c.accent, topColor: alpha(c.accent, 0.35), bottomColor: alpha(c.accent, 0.02),
        lineWidth: 2, priceLineVisible: true, lastValueVisible: true,
      };
    } else if (type === 'renko') {
      const rs = (typeof renkoSettings !== 'undefined') ? renkoSettings : {};
      opts = {
        ...opts,
        upColor: rs.colorUpBars || c.gain, downColor: rs.colorDownBars || c.loss,
        borderUpColor: rs.colorUpBarsLine || c.gain, borderDownColor: rs.colorDownBarsLine || c.loss,
        wickVisible: rs.showWicks !== false,
        wickUpColor: rs.colorUpBarsLine || c.gain, wickDownColor: rs.colorDownBarsLine || c.loss,
      };
    }

    const api = series('__price', kind, opts, 'price');
    if (!api) return null;

    if (kind === 'line' || kind === 'area') {
      api.setData(data.map((d, i) => ({ time: times[i], value: d.Close })));
    } else {
      api.setData(data.map((d, i) => ({
        time: times[i], open: d.Open, high: d.High, low: d.Low, close: d.Close,
      })));
    }
    return api;
  }

  function renderVolumeSeries(data, times) {
    if (paneIndex('volume') < 0) return;
    const c = colors();
    const api = series('__volume', 'histogram', {
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    }, 'volume');
    if (!api) return;
    api.setData(data.map((d, i) => ({
      time: times[i],
      value: d.Volume || 0,
      color: (d.Close >= d.Open) ? alpha(c.gain, 0.55) : alpha(c.loss, 0.55),
    })));
  }

  // ── Overlay canvas ─────────────────────────────────────────────
  // A transparent <canvas id="candleCanvas"> sitting exactly on top of the
  // chart. Keeping the candlestick page's element id is what lets
  // tv-drawing-tools.js / tv-trade-markers.js / sm-trade-overlay.js load here
  // completely unmodified — they look that id up and paint into its context.
  function sizeOverlay() {
    if (!overlayEl || !containerEl) return;
    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    overlayEl.style.width = w + 'px';
    overlayEl.style.height = h + 'px';
    overlayEl.width = Math.max(1, Math.round(w * dpr));
    overlayEl.height = Math.max(1, Math.round(h * dpr));
    overlayCtx = overlayEl.getContext('2d');
    overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function chartAreaWidth() {
    try {
      const size = chart.paneSize(0);
      if (size && size.width) return size.width;
    } catch (e) {}
    return containerEl ? containerEl.clientWidth : 0;
  }

  function repaintOverlay() {
    if (!overlayEl || !overlayCtx) return;
    const full = overlayEl.clientWidth;
    const h = overlayEl.clientHeight;
    overlayCtx.clearRect(0, 0, full, h);
    // Painters get the CHART AREA width, not the container width — the right
    // price axis sits inside the container, and every one of these painters
    // uses `width` as a right edge to clip or to run level lines out to.
    const w = chartAreaWidth();

    const r = window._lastRender;
    if (!r) return;
    const priceBottom = r.priceRange ? (r.priceRange.paneY0 + r.priceRange.paneHeight) : h;

    // Same order the canvas page paints them in: user drawings, then trade
    // markers, then the Super Model trade overlay, then anything registered.
    if (typeof drawUserAnnotations === 'function') {
      try { drawUserAnnotations(overlayCtx, w, priceBottom); } catch (e) { console.warn('[AC] drawUserAnnotations', e); }
    }
    if (typeof drawTradeMarkers === 'function') {
      try { drawTradeMarkers(overlayCtx, w, priceBottom); } catch (e) { console.warn('[AC] drawTradeMarkers', e); }
    }
    if (typeof drawSuperModelTrade === 'function') {
      try { drawSuperModelTrade(overlayCtx, w, priceBottom); } catch (e) { console.warn('[AC] drawSuperModelTrade', e); }
    }
    [..._overlayPainters.keys()].sort().forEach((name) => {
      try { _overlayPainters.get(name)(overlayCtx, w, priceBottom); }
      catch (e) { console.warn('[AC] overlay painter', name, e); }
    });
  }

  // ── window._lastRender ─────────────────────────────────────────
  function computeLastRender() {
    if (!chart || !containerEl || !_displayData.length) return;
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;

    const x0 = ts.logicalToCoordinate(Math.round(range.from));
    const x1 = ts.logicalToCoordinate(Math.round(range.from) + 1);
    if (x0 == null || x1 == null) return;
    const candleWidth = Math.max(0.5, x1 - x0);
    const startIdx = Math.max(0, Math.round(range.from));
    const endIdx = Math.min(_displayData.length, Math.ceil(range.to) + 1);

    // While a sub-pane is maximized the price pane is not on the chart at all,
    // so anchor the geometry to whichever pane IS showing. Drawings and trade
    // markers are price-pane overlays and simply have nothing to draw then —
    // but _lastRender still has to describe a real box, because the legend and
    // the pointer routing read it on every mouse move regardless.
    const anchorKey = paneIndex('price') >= 0 ? 'price' : (_paneKeys[0] || 'price');
    let priceApi = (_seriesCache.get('__price') || {}).api;
    if (!priceApi || anchorKey !== 'price') {
      priceApi = null;
      _seriesCache.forEach((entry) => {
        if (!priceApi && entry.paneKey === anchorKey) priceApi = entry.api;
      });
    }
    const pTop = paneTop(anchorKey);
    const pHeight = paneHeightOf(anchorKey) || containerEl.clientHeight;

    let minPrice = 0, maxPrice = 1;
    if (priceApi) {
      // coordinateToPrice is pane-relative, so feed it pane-local coordinates
      // and convert the result's anchor back to container space via pTop.
      const top = priceApi.coordinateToPrice(0);
      const bottom = priceApi.coordinateToPrice(pHeight);
      if (top != null && bottom != null && top !== bottom) { maxPrice = top; minPrice = bottom; }
    }

    const collapsed = (typeof collapsedPanes !== 'undefined') ? collapsedPanes : [];
    const subPanes = activeSubPaneKeys().map((hKey) => {
      const displayKey = Object.keys(PANE_HEIGHT_KEY).find(k => PANE_HEIGHT_KEY[k] === hKey) || hKey;
      return {
        key: displayKey, hKey,
        y: paneTop(hKey), h: paneHeightOf(hKey),
        collapsed: collapsed.includes(displayKey) || collapsed.includes(hKey),
      };
    });

    window._lastRender = {
      visibleData: _displayData.slice(startIdx, endIdx),
      startIdx,
      displayData: _displayData,
      candleWidth,
      padding: { left: x0 - candleWidth / 2, right: Math.max(0, containerEl.clientWidth - chartAreaWidth()), top: 0, bottom: 0 },
      width: containerEl.clientWidth,
      height: containerEl.clientHeight,
      subPanes,
      // paneHeightFull mirrors candlestick-draw.js:459's shape. Nothing reads
      // it today, but the three unmodified overlay files are written against
      // that object, so keep the field set present.
      priceRange: { minPrice, maxPrice, paneHeight: pHeight, paneY0: pTop, paneHeightFull: pHeight },
    };
  }

  // ── The render pass ────────────────────────────────────────────
  function render() {
    if (!chart || _rendering) return;
    _rendering = true;
    try {
      let data = (typeof aggregatedData !== 'undefined' && aggregatedData.length)
        ? aggregatedData
        : (typeof chartData !== 'undefined' ? chartData : []);

      const type = (typeof chartType !== 'undefined') ? chartType : 'candlestick';
      if (type === 'heikinashi' && typeof calculateHeikinAshi === 'function') {
        data = calculateHeikinAshi(data);
      } else if (type === 'renko' && typeof calculateRenko === 'function') {
        data = calculateRenko(data, typeof renkoBoxSize !== 'undefined' ? renkoBoxSize : 1);
      }

      if (typeof replayMode !== 'undefined' && replayMode && replayIndex > 0) {
        data = data.slice(0, replayIndex);
      }

      if (!data.length) { _rendering = false; return; }

      const built = buildTimes(data);
      _displayData = data;
      _times = built.times;
      _timeToIndex = built.index;

      syncPanes(desiredPaneKeys());

      renderPriceSeries(data, _times);
      renderVolumeSeries(data, _times);

      beginRender();
      touch('__price'); touch('__volume');
      const names = [..._renderHooks.keys()].sort((a, b) => {
        const rank = n => (n === 'overlay-indicators' ? 0 : n === 'subpane-indicators' ? 1 : 2);
        return rank(a) - rank(b) || a.localeCompare(b);
      });
      names.forEach((name) => {
        try { _renderHooks.get(name)(); }
        catch (e) { console.warn('[AC] render hook', name, e); }
      });
      endRender();

      if (_pendingFit) { applyDefaultViewport(data.length); _pendingFit = false; }

      sizeOverlay();
      computeLastRender();
      repaintOverlay();

      if (typeof renderChartLegend === 'function') renderChartLegend();
    } finally {
      _rendering = false;
    }
  }

  // fitContent() would show all ~1,900 bars of a full history at well under a
  // pixel per bar. The candlestick page opens on the most recent ~120 bars
  // instead, so match that: a readable default window anchored to the right
  // edge, which the user can then zoom out of.
  const DEFAULT_VISIBLE_BARS = 120;

  function applyDefaultViewport(n) {
    const ts = chart.timeScale();
    if (!n) return;
    if (n <= DEFAULT_VISIBLE_BARS) { ts.fitContent(); return; }
    const rightOffset = (ts.options() && ts.options().rightOffset) || 0;
    ts.setVisibleLogicalRange({ from: n - DEFAULT_VISIBLE_BARS, to: n - 1 + rightOffset });
  }

  // ── Public API ─────────────────────────────────────────────────
  window.ACChart = {
    chart: () => chart,
    ready: () => !!chart,
    container: () => containerEl,
    create: createChart,
    applyTheme,
    colors,
    alpha,

    displayData: () => _displayData,
    times: () => _times,
    timeOfIndex: i => _times[i],
    indexOfTime: t => (_timeToIndex.has(t) ? _timeToIndex.get(t) : -1),

    series, touch, dropSeries, beginRender, endRender, purgeAllSeries,
    // Introspection — used by scripts/verify-advanced-chart-features.js and
    // handy in the console when an indicator does not appear.
    seriesKeys: () => [..._seriesCache.keys()],
    seriesInfo: () => [..._seriesCache.entries()].map(([k, v]) => ({ key: k, type: v.type, pane: v.paneKey })),

    paneIndex, paneTop, paneHeight: paneHeightOf,
    maximizedPane: () => _maximizedPane,
    setMaximizedPane,
    paneKeys: () => _paneKeys.slice(),
    applyPaneHeights, syncPaneHeightsFromChart,
    resetPaneHeights: resetACPaneHeights,
    paneHeightDefaults: () => ({ ...PANE_HEIGHT_DEFAULTS }),

    overlay: () => overlayEl,
    overlayCtx: () => overlayCtx,
    sizeOverlay,
    repaintOverlay,
    addOverlayPainter: (name, fn) => _overlayPainters.set(name, fn),
    removeOverlayPainter: name => _overlayPainters.delete(name),

    addRenderHook: (name, fn) => _renderHooks.set(name, fn),
    removeRenderHook: name => _renderHooks.delete(name),

    computeLastRender,
    requestFit: () => { _pendingFit = true; },
    applyDefaultViewport,
    DEFAULT_VISIBLE_BARS,

    attachOverlay(el) { overlayEl = el; sizeOverlay(); },
  };

  // ── Globals the shared candlestick modules call ────────────────
  window.__acRender = render;

})();

/* candlestick-data.js and the indicator modules call `drawChart()` as a bare
   identifier, so it has to be a real global function binding, not just a
   window property. It is a no-op until the chart exists, because
   processChartData() can finish before init() has created it. */
function drawChart() {
  if (window.ACChart && window.ACChart.ready()) window.__acRender();
}

/* Both of these are called unconditionally at the end of processChartData().
   ac-ui.js redefines them with the real implementations (later script wins). */
function setupChartInteractions() { /* Lightweight Charts owns pan/zoom — see ac-ui.js */ }
function updateInfoCards() { /* redefined in ac-ui.js */ }
