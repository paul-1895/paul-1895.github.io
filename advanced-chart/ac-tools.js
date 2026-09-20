'use strict';

/* ════════════════════════════════════════════════════════════
   ac-tools.js
   Advanced Chart adapter for the three renderer-agnostic analysis
   tools that ship unmodified out of ../candlestick_chart/:

     macd-backtest.js    window.openMACDBacktestModal / close…
     tv-seasonals.js     window.computeSeasonalData / …MonthStats
     tv-seasonals-ui.js  window.refreshSeasonalsForSymbol
     tv-volatility.js    window.openVolatilityModal / close… /
                         window.refreshVolatilityForSymbol /
                         window.setVolBreachView

   All four read the `chartData` / `aggregatedData` globals that
   candlestick-data.js owns and paint into their own DOM (the
   seasonals bar chart and the volatility modal own their own
   canvases), so none of them need porting. What they DO need is:

     1. their markup present BEFORE they execute — tv-seasonals-ui.js
        and tv-volatility.js both bail out of their IIFE and never
        define their globals if their host element is missing;
     2. a symbol/timeframe change to reach them on this page;
     3. the LWC-specific extras this page can offer that the canvas
        page cannot: the backtest's simulated trades drawn ON the
        price series, and the volatility model's bands drawn as
        price lines.

   This file owns (2) and (3), plus a startup diagnostic for (1) —
   which it can only REPORT, never repair, because by the time any
   ac-*.js runs the two bailing IIFEs have already run.

   Depends on : ac-render.js (window.ACChart, drawChart,
                window._lastRender), candlestick-data.js
                (chartData, aggregatedData, currentTimeframe,
                chartType, urlCodeFallback), LightweightCharts v5
                (LightweightCharts.createSeriesMarkers)
   Exports    : window.ACTools, window.toggleBacktestMarkers,
                window.toggleVolatilityBands
   ════════════════════════════════════════════════════════════ */

(function () {

  // ── What the four unmodified files need from the page ──────────
  // `hard: true` means the file gives up completely without it: its
  // IIFE returns early and none of its window.* globals are defined.
  const REQUIREMENTS = [
    { sel: '#tvSeasonalsPanel',   hard: true,  file: 'tv-seasonals-ui.js', line: 30,
      why: 'panel host — without it the IIFE returns and refreshSeasonalsForSymbol is never defined' },
    { sel: '#seasonalsToggleBtn', hard: true,  file: 'tv-seasonals-ui.js', line: 29,
      why: 'toggle button — same early return as #tvSeasonalsPanel' },
    { sel: '#tvTicker',           hard: false, file: 'tv-seasonals-ui.js', line: 61,
      why: 'getSeasSymbol() reads it; falls back to "UNKNOWN", which also breaks symbol-change detection (polyfilled here)' },
    { sel: '#tvVolatilityBody',   hard: true,  file: 'tv-volatility.js',   line: 22,
      why: 'card host — without it openVolatilityModal / closeVolatilityModal / setVolBreachView / refreshVolatilityForSymbol are never defined' },
    { sel: '#tvVolatilityPanel',  hard: false, file: 'tv-volatility.js',   line: 607,
      why: 'wireRailToggle() target; no-ops silently when absent' },
    { sel: '#railVolatilityBtn',  hard: false, file: 'tv-volatility.js',   line: 607,
      why: 'wireRailToggle() button; no-ops silently when absent' },
    { sel: '#macdBtModal',        hard: false, file: 'macd-backtest.js',   line: 670,
      why: 'openMACDBacktestModal() returns immediately without it — the panel can never be opened' },
    { sel: '#macdBtBody',         hard: false, file: 'macd-backtest.js',   line: 473,
      why: 'render() returns without it — a run would compute and cache but show nothing' },
    { sel: '#macdBtToggleBtn',    hard: false, file: 'candlestick.html',   line: 694,
      why: 'rail button that calls openMACDBacktestModal(); wired here as a fallback when it carries no inline onclick' },
  ];

  const GLOBALS = [
    { name: 'computeSeasonalData',       file: 'tv-seasonals.js',    line: 94 },
    { name: 'computeSeasonalMonthStats', file: 'tv-seasonals.js',    line: 95 },
    { name: 'refreshSeasonalsForSymbol', file: 'tv-seasonals-ui.js', line: 443 },
    { name: 'openVolatilityModal',       file: 'tv-volatility.js',   line: 481 },
    { name: 'closeVolatilityModal',      file: 'tv-volatility.js',   line: 588 },
    { name: 'setVolBreachView',          file: 'tv-volatility.js',   line: 475 },
    { name: 'refreshVolatilityForSymbol', file: 'tv-volatility.js',  line: 620 },
    { name: 'openMACDBacktestModal',     file: 'macd-backtest.js',   line: 669 },
    { name: 'closeMACDBacktestModal',    file: 'macd-backtest.js',   line: 687 },
  ];

  // ── Backtest store (macd-backtest.js:68-69 — read-only mirror) ──
  // macd-backtest.js keeps its `_result` in closure scope with no
  // accessor, but save() writes every run to localStorage under this
  // key, so that is the supported read path. STORE_VER must track
  // macd-backtest.js:68 — a bump there changes what a stored trade
  // MEANS, and a mismatch here should drop the markers, not re-label them.
  const MBT_STORE_VER = 3;
  const MBT_KEY = sym => `tv-macd-bt-${sym}`;
  const EXIT_ABBR = { target: 'T', stop: 'S', macd: 'X', open: '·' };

  // ── Volatility band model ──────────────────────────────────────
  // The modal reports ANNUALISED volatility (tv-volatility.js:136,
  // stdev of daily log returns x sqrt(252)). A price line needs a
  // price, so the annualised figure is de-annualised to a one-month
  // (21 trading day) horizon and applied to the latest close.
  const VOL_HORIZON_BARS = 21;
  const VOL_TRADING_DAYS = 252;
  const VOL_HUE = '#f0883e';        // the orange tv-volatility.js uses throughout
  const VOL_DEFAULT_THRESHOLD = 5;  // tv-volatility.js:352 slider default

  // ── State ──────────────────────────────────────────────────────
  let _sym = null;
  let _tf = null;

  let _btOn = false;                 // backtest markers toggle
  let _btPlugin = null;              // ISeriesMarkersPluginApi
  let _btPluginSeries = null;        // series the plugin is attached to
  let _btSegments = [];              // entry->exit connectors for the overlay
  let _btModalRendered = false;      // has #macdBtBody re-rendered at least once?
  let _btSig = null;

  let _volOn = false;                // volatility bands toggle
  let _volSeries = null;
  let _volLines = [];                // IPriceLine handles, attached to _volSeries
  let _volSig = null;
  let _volSidebarWrapper = null;     // the refreshSidebarForSymbol tv-volatility.js installed

  let _mapSource = null;             // identity of the displayData the map was built from
  let _mapCache = null;
  let _pendingRender = 0;
  let _seasHostHidden = [];
  let _seasWasOpen = false;

  // ─────────────────────────────────────────────────────────────
  //  Small helpers
  // ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const normDate = v => String(v == null ? '' : v).replace(/\//g, '-').slice(0, 10);

  function currentCode() {
    if (typeof chartData !== 'undefined' && chartData && chartData.length && chartData[0].Symbol) {
      return String(chartData[0].Symbol).toUpperCase();
    }
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return null;
  }

  function currentTf() {
    return (typeof currentTimeframe !== 'undefined' && currentTimeframe) ? currentTimeframe : 'daily';
  }

  function ready() {
    return !!(window.ACChart && window.ACChart.ready());
  }

  function theme() {
    if (ready()) return window.ACChart.colors();
    return { gain: '#26a69a', loss: '#ef5350', accent: '#00f5c4', textMuted: '#6b7280' };
  }

  function fade(color, a) {
    if (ready() && typeof window.ACChart.alpha === 'function') return window.ACChart.alpha(color, a);
    return color;
  }

  function lineStyle(name) {
    const LS = window.LightweightCharts && window.LightweightCharts.LineStyle;
    if (!LS) return 0;
    return LS[name] != null ? LS[name] : LS.Solid;
  }

  // drawChart() is cheap and idempotent by contract (ARCHITECTURE.md), and it
  // is the only place a render hook runs — so every "please repaint" request
  // coalesces into one drawChart() on the next frame.
  function requestRender() {
    if (_pendingRender) return;
    _pendingRender = requestAnimationFrame(() => {
      _pendingRender = 0;
      if (typeof drawChart === 'function') drawChart();
      else if (ready()) window.ACChart.repaintOverlay();
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  Price-series access
  //  ac-render.js's series() drops-and-recreates on a type mismatch,
  //  so the current chartType has to be mapped to the same series kind
  //  renderPriceSeries() chose (ac-render.js:328-377). Options are
  //  passed as null so nothing this file does can restyle the price
  //  series — series() only applyOptions()es a truthy options object.
  // ─────────────────────────────────────────────────────────────
  function priceSeriesKind() {
    const t = (typeof chartType !== 'undefined') ? chartType : 'candlestick';
    if (t === 'bars') return 'bar';
    if (t === 'line') return 'line';
    if (t === 'area') return 'area';
    return 'candlestick'; // candlestick | hollow | heikinashi | renko
  }

  function priceSeries() {
    if (!ready()) return null;
    if (!window.ACChart.displayData().length) return null;
    return window.ACChart.series('__price', priceSeriesKind(), null, 'price');
  }

  // Date -> index into the data currently on screen. Rebuilt whenever the
  // displayData array identity changes (i.e. once per real render pass).
  // First occurrence wins: Renko emits several bricks per source date
  // (ac-render.js:110-117) and the earliest is the closest to the signal.
  function dateIndex() {
    if (!ready()) return new Map();
    const data = window.ACChart.displayData();
    if (_mapSource === data && _mapCache) return _mapCache;
    const m = new Map();
    for (let i = 0; i < data.length; i++) {
      const k = normDate(data[i].Date);
      if (k && !m.has(k)) m.set(k, i);
    }
    _mapSource = data;
    _mapCache = m;
    return m;
  }

  // ═════════════════════════════════════════════════════════════
  //  1. MACD backtest — simulated trades on the price series
  // ═════════════════════════════════════════════════════════════

  function loadBacktestResult(sym) {
    if (!sym) return null;
    try {
      const raw = localStorage.getItem(MBT_KEY(sym));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // macd-backtest.js:410 never stores an errored run, but a hand-edited or
      // future-version payload might — treat anything unexpected as absent.
      if (!parsed || parsed.version !== MBT_STORE_VER || parsed.error) return null;
      if (!Array.isArray(parsed.trades)) return null;
      return parsed;
    } catch (e) { return null; }
  }

  // Trades worth drawing: the stored run for the symbol on screen, provided it
  // was simulated on the timeframe on screen (it replays aggregatedData, so a
  // daily run's dates do not line up with weekly bars) and provided the panel
  // is not currently showing a cleared/errored/no-signal body.
  function backtestTrades() {
    const body = $('macdBtBody');
    if (_btModalRendered && body && !body.querySelector('.mbt-table')) return [];

    const result = loadBacktestResult(_sym || currentCode());
    if (!result) return [];
    if (result.timeframe !== currentTf()) return [];

    const rows = result.trades.slice();
    if (result.openPosition) rows.push(result.openPosition);
    return rows;
  }

  function buildBacktestVisuals() {
    const markers = [];
    const segments = [];
    if (!_btOn || !ready()) return { markers, segments };

    const idx = dateIndex();
    const c = theme();
    const trades = backtestTrades();

    trades.forEach((t, n) => {
      const entryI = idx.has(normDate(t.entryDate)) ? idx.get(normDate(t.entryDate)) : -1;
      const exitI = idx.has(normDate(t.exitDate)) ? idx.get(normDate(t.exitDate)) : -1;
      if (entryI < 0) return; // outside the replay slice / not on these bars

      const pnl = (typeof t.pnlPct === 'number' && isFinite(t.pnlPct)) ? t.pnlPct : null;
      const win = pnl == null ? null : pnl >= 0;
      const label = '#' + (n + 1);

      markers.push({
        time: window.ACChart.timeOfIndex(entryI),
        position: 'belowBar',
        color: c.gain,
        shape: 'arrowUp',
        text: label,
        size: 1,
      });

      if (exitI >= 0 && !t.open) {
        const pnlTxt = pnl == null ? '' : ' ' + (pnl > 0 ? '+' : '') + pnl.toFixed(2) + '%';
        const why = EXIT_ABBR[t.exitReason] ? ' ' + EXIT_ABBR[t.exitReason] : '';
        markers.push({
          time: window.ACChart.timeOfIndex(exitI),
          position: 'aboveBar',
          color: win === false ? c.loss : c.gain,
          shape: 'arrowDown',
          text: label + pnlTxt + why,
          size: 1,
        });
      }

      const endI = exitI >= 0 ? exitI : (window.ACChart.displayData().length - 1);
      const endP = Number(t.exitPrice);
      const startP = Number(t.entryPrice);
      if (isFinite(startP) && isFinite(endP) && endI >= entryI) {
        segments.push({ i0: entryI, p0: startP, i1: endI, p1: endP, win, open: !!t.open });
      }
    });

    // Lightweight Charts requires markers in ascending time order.
    markers.sort((a, b) => a.time - b.time);
    return { markers, segments };
  }

  function applyBacktestMarkers() {
    const series = priceSeries();
    if (!series) return;

    // A pane rebuild or a chart-type switch drops and recreates the price
    // series (ac-render.js:220-235, 285-289); the old plugin went with it.
    if (_btPluginSeries !== series) {
      _btPlugin = null;
      _btPluginSeries = series;
      _btSig = null;
    }

    const { markers, segments } = buildBacktestVisuals();
    _btSegments = segments;

    const sig = markers.length + '|' + markers.map(m => m.time + m.shape + m.text).join(',');
    if (sig === _btSig) return;
    _btSig = sig;

    const LWC = window.LightweightCharts;
    if (!LWC || typeof LWC.createSeriesMarkers !== 'function') {
      if (markers.length) {
        console.warn('[ACTools] LightweightCharts.createSeriesMarkers is unavailable — ' +
          'this page needs lightweight-charts v5 (v4 had series.setMarkers(), which v5 removed).');
      }
      return;
    }

    try {
      if (!_btPlugin) {
        if (!markers.length) return; // nothing to attach yet
        _btPlugin = LWC.createSeriesMarkers(series, markers);
      } else {
        _btPlugin.setMarkers(markers);
      }
    } catch (e) {
      console.warn('[ACTools] could not apply backtest markers', e);
      _btPlugin = null;
      _btSig = null;
    }
  }

  // Faint dashed entry->exit connector per trade, painted on the shared
  // overlay canvas with the documented _lastRender mapping
  // (ARCHITECTURE.md "The consumers' mapping").
  function paintTradeConnectors(ctx, width) {
    if (!_btOn || !_btSegments.length) return;
    const r = window._lastRender;
    if (!r || !r.priceRange) return;

    const { startIdx, candleWidth, padding } = r;
    const { minPrice, maxPrice, paneY0, paneHeight } = r.priceRange;
    if (!(maxPrice > minPrice) || !(candleWidth > 0)) return;

    const xOf = i => padding.left + (i - startIdx + 0.5) * candleWidth;
    const yOf = p => paneY0 + paneHeight * (1 - (p - minPrice) / (maxPrice - minPrice));
    const c = theme();
    const visFrom = startIdx - 2;
    const visTo = startIdx + (width - padding.left) / candleWidth + 2;

    ctx.save();
    // Clip to the price pane so a connector can never bleed into volume /
    // an oscillator sub-pane below it.
    ctx.beginPath();
    ctx.rect(0, paneY0, width, paneHeight);
    ctx.clip();
    ctx.lineWidth = 1;

    _btSegments.forEach((s) => {
      if (s.i1 < visFrom || s.i0 > visTo) return;
      const colour = s.win === false ? c.loss : c.gain;
      ctx.strokeStyle = fade(colour, s.open ? 0.32 : 0.5);
      ctx.setLineDash(s.open ? [2, 4] : [5, 4]);
      ctx.beginPath();
      ctx.moveTo(xOf(s.i0), yOf(s.p0));
      ctx.lineTo(xOf(s.i1), yOf(s.p1));
      ctx.stroke();

      // Small dots at both ends so a flat trade is still readable when the
      // connector is nearly horizontal.
      ctx.setLineDash([]);
      ctx.fillStyle = fade(colour, 0.75);
      [[s.i0, s.p0], [s.i1, s.p1]].forEach(([i, p]) => {
        ctx.beginPath();
        ctx.arc(xOf(i), yOf(p), 2, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    ctx.restore();
  }

  function clearBacktestMarkers() {
    _btSegments = [];
    _btSig = null;
    if (_btPlugin) {
      try { _btPlugin.setMarkers([]); } catch (e) { /* series already gone */ }
    }
  }

  // macd-backtest.js keeps its result private, so the panel body is the only
  // signal that a run finished (or was cleared). Every rerun() replaces
  // #macdBtBody wholesale — watch that and re-read the store.
  function wireBacktestObserver() {
    const body = $('macdBtBody');
    if (!body || body.__acToolsObserved) return;
    body.__acToolsObserved = true;
    try {
      new MutationObserver(() => {
        _btModalRendered = true;
        _btSig = null;
        requestRender();
      }).observe(body, { childList: true, subtree: true });
    } catch (e) { /* MutationObserver is universal; nothing sane to fall back to */ }
  }

  function backtestModalOpen() {
    const m = $('macdBtModal');
    return !!m && m.style.display !== 'none' && m.style.display !== '';
  }

  function wrapBacktestEntryPoints() {
    const open = window.openMACDBacktestModal;
    if (typeof open === 'function' && !open.__acToolsWrapped) {
      const wrapped = function () {
        const out = open.apply(this, arguments);
        wireBacktestObserver();
        _btSig = null;
        requestRender();
        return out;
      };
      wrapped.__acToolsWrapped = true;
      window.openMACDBacktestModal = wrapped;
    }

    const close = window.closeMACDBacktestModal;
    if (typeof close === 'function' && !close.__acToolsWrapped) {
      const wrapped = function () {
        const out = close.apply(this, arguments);
        // Closing the panel is not "clearing the results" — the run stays
        // cached and the markers stay on the chart until the toggle is
        // turned off, the symbol changes, or the body is re-rendered empty.
        requestRender();
        return out;
      };
      wrapped.__acToolsWrapped = true;
      window.closeMACDBacktestModal = wrapped;
    }

    // candlestick.html wires the rail button with an inline onclick
    // (candlestick.html:694). If this page's markup omits it, wire it here.
    const btn = $('macdBtToggleBtn');
    if (btn && !btn.getAttribute('onclick') && !btn.__acToolsWired) {
      btn.__acToolsWired = true;
      btn.addEventListener('click', () => {
        if (typeof window.openMACDBacktestModal === 'function') window.openMACDBacktestModal();
      });
    }
  }

  // ═════════════════════════════════════════════════════════════
  //  2. Volatility — the modal's bands as price lines
  // ═════════════════════════════════════════════════════════════

  // The card's four readouts (tv-volatility.js:245-248) are the published
  // surface of computeAnnualizedVol(); they are filled by
  // refreshVolatilityForSymbol() whether or not the modal was ever opened.
  function readVolPct(id) {
    const el = $(id);
    if (!el) return null;
    const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(el.textContent || '');
    if (!m) return null;
    const v = parseFloat(m[1]);
    return isFinite(v) && v > 0 ? v : null;
  }

  function annualisedVol() {
    // 3M first — it is the figure tv-volatility.js:296 bases its Low/Moderate/
    // High/Very High badge on, so the bands and the badge always agree.
    const order = [['tv-vol-3m', '3M'], ['tv-vol-1m', '1M'], ['tv-vol-6m', '6M'], ['tv-vol-1y', '1Y']];
    for (let i = 0; i < order.length; i++) {
      const v = readVolPct(order[i][0]);
      if (v != null) return { pct: v, label: order[i][1] };
    }
    return null;
  }

  function breachThreshold() {
    const el = $('vol-hist-thresh');
    if (!el) return VOL_DEFAULT_THRESHOLD;
    const v = parseFloat(el.value);
    return isFinite(v) && v > 0 ? v : VOL_DEFAULT_THRESHOLD;
  }

  function anchorPrice() {
    if (!ready()) return null;
    const d = window.ACChart.displayData();
    for (let i = d.length - 1; i >= 0; i--) {
      const c = Number(d[i].Close);
      if (isFinite(c) && c > 0) return c;
    }
    return null;
  }

  function volLineSpecs() {
    if (!_volOn) return [];
    // These lines are a read-out of tv-volatility.js's model. If that file
    // never ran (its #tvVolatilityBody host was missing, tv-volatility.js:22)
    // there is no model to draw, and a bare ±5% pair would be noise.
    if (typeof window.refreshVolatilityForSymbol !== 'function') return [];
    const anchor = anchorPrice();
    if (!anchor) return [];

    const out = [];
    const vol = annualisedVol();

    if (vol) {
      // De-annualise to the one-month horizon the card's shortest window
      // describes: sigma_h = sigma_annual x sqrt(h / 252).
      const sigma = (vol.pct / 100) * Math.sqrt(VOL_HORIZON_BARS / VOL_TRADING_DAYS);
      const bands = [
        { k: 1, a: 0.85, style: 'Dashed' },
        { k: 2, a: 0.45, style: 'Dotted' },
      ];
      bands.forEach(({ k, a, style }) => {
        const up = anchor * (1 + sigma * k);
        const dn = anchor * (1 - sigma * k);
        if (dn <= 0) return;
        out.push({
          price: up, color: fade(VOL_HUE, a), lineStyle: style, lineWidth: 1,
          title: `+${k}σ ${VOL_HORIZON_BARS}d (${vol.label} ${vol.pct.toFixed(1)}% ann)`,
        });
        out.push({
          price: dn, color: fade(VOL_HUE, a), lineStyle: style, lineWidth: 1,
          title: `-${k}σ ${VOL_HORIZON_BARS}d (${vol.label} ${vol.pct.toFixed(1)}% ann)`,
        });
      });
    }

    // Breach levels — the modal's "moves of +/- N%" threshold, expressed as
    // the prices a single session's range of that size would reach from here.
    const t = breachThreshold();
    const c = theme();
    const tTxt = (t % 1 === 0 ? t : t.toFixed(1)) + '%';
    const up = anchor * (1 + t / 100);
    const dn = anchor * (1 - t / 100);
    out.push({ price: up, color: fade(c.gain, 0.7), lineStyle: 'LargeDashed', lineWidth: 1, title: `+${tTxt} breach` });
    if (dn > 0) {
      out.push({ price: dn, color: fade(c.loss, 0.7), lineStyle: 'LargeDashed', lineWidth: 1, title: `-${tTxt} breach` });
    }
    return out;
  }

  function clearVolLines() {
    if (_volSeries && _volLines.length) {
      _volLines.forEach((h) => { try { _volSeries.removePriceLine(h); } catch (e) { /* series gone */ } });
    }
    _volLines = [];
    _volSig = null;
  }

  function applyVolatilityLines() {
    const series = priceSeries();
    if (series !== _volSeries) {
      // The old series was removed; its price lines died with it, so drop the
      // handles WITHOUT calling removePriceLine on a dead series.
      _volLines = [];
      _volSig = null;
      _volSeries = series;
    }
    if (!series) return;

    const specs = volLineSpecs();
    const sig = specs.map(s => s.price.toFixed(4) + s.title).join('|');
    if (sig === _volSig) return;

    clearVolLines();
    _volSeries = series;
    _volSig = sig;

    specs.forEach((s) => {
      try {
        _volLines.push(series.createPriceLine({
          price: s.price,
          color: s.color,
          lineWidth: s.lineWidth,
          lineStyle: lineStyle(s.lineStyle),
          axisLabelVisible: true,
          title: s.title,
        }));
      } catch (e) { /* one bad level should not take the rest down */ }
    });
  }

  // The threshold and look-back sliders re-run renderVolBreaches() on input
  // (tv-volatility.js:382-383); mirror that into the price lines. The modal is
  // built lazily, so the listeners are attached on the wrapped open().
  function wireVolatilityModalInputs() {
    ['vol-hist-thresh', 'vol-hist-lookback'].forEach((id) => {
      const el = $(id);
      if (!el || el.__acToolsWired) return;
      el.__acToolsWired = true;
      el.addEventListener('input', () => { _volSig = null; requestRender(); });
    });
  }

  function wrapVolatilityEntryPoints() {
    const open = window.openVolatilityModal;
    if (typeof open === 'function' && !open.__acToolsWrapped) {
      const wrapped = async function () {
        const out = await open.apply(this, arguments);
        wireVolatilityModalInputs();
        _volSig = null;
        requestRender();
        return out;
      };
      wrapped.__acToolsWrapped = true;
      window.openVolatilityModal = wrapped;
    }

    // tv-volatility.js:615 replaces window.refreshSidebarForSymbol with its own
    // wrapper, and candlestick-data.js:675 calls that at the end of every
    // processChartData(). Remember the wrapper so a symbol change can tell
    // whether the card is already being refreshed for us, or whether this file
    // has to call refreshVolatilityForSymbol() itself.
    _volSidebarWrapper = (typeof window.refreshSidebarForSymbol === 'function')
      ? window.refreshSidebarForSymbol : null;
  }

  // ═════════════════════════════════════════════════════════════
  //  3. Seasonals glue
  // ═════════════════════════════════════════════════════════════

  // tv-seasonals-ui.js:61 reads #tvTicker for the symbol, and
  // candlestick-data.js:652 writes the loaded symbol into it. Without the
  // element the panel title reads "UNKNOWN" AND its symbolChanged test
  // (tv-seasonals-ui.js:256) never fires, so the year-range slider keeps the
  // previous symbol's window. A hidden stand-in restores both behaviours
  // without touching anyone else's markup.
  function ensureTickerEl() {
    let el = $('tvTicker');
    if (!el) {
      el = document.createElement('span');
      el.id = 'tvTicker';
      el.hidden = true;
      el.style.display = 'none';
      el.dataset.acToolsPolyfill = '1';
      document.body.appendChild(el);
    }
    const sym = currentCode();
    if (sym && el.dataset.acToolsPolyfill === '1' && el.textContent.trim().toUpperCase() !== sym) {
      el.textContent = sym;
    }
    return el;
  }

  // tv-seasonals-ui.js:413-419 hides the chart by the candlestick page's own
  // selectors (.chart-container, #indicatorInstanceBar, .strategy-controls,
  // #tvRangeBar, #strategyTableWrap, .info-grid, #replayBar) and restores them
  // on "Back to chart". Any of those this page does not have is simply skipped
  // there — so if .chart-container is absent, the LWC chart stays on screen
  // underneath the panel. Watch the panel's own display flag and hide this
  // page's chart host in that case.
  const AC_CHART_HOSTS = ['.chart-container', '.ac-chart-wrap', '#ac-chart-container', '#chartContainer'];

  function syncSeasonalsHost() {
    const panel = $('tvSeasonalsPanel');
    if (!panel) return;
    const open = getComputedStyle(panel).display !== 'none';
    if (open === _seasWasOpen) return;
    _seasWasOpen = open;

    if (open) {
      // tv-seasonals-ui.js already handled .chart-container if it exists here.
      if (document.querySelector('.chart-container')) return;
      for (let i = 1; i < AC_CHART_HOSTS.length; i++) {
        const el = document.querySelector(AC_CHART_HOSTS[i]);
        if (el && getComputedStyle(el).display !== 'none') {
          _seasHostHidden.push([el, el.style.display]);
          el.style.display = 'none';
          break; // the outermost wrapper is enough
        }
      }
    } else {
      _seasHostHidden.splice(0).forEach(([el, prev]) => { el.style.display = prev; });
      if (window.ACChart && window.ACChart.sizeOverlay) window.ACChart.sizeOverlay();
      requestRender();
    }
  }

  function wireSeasonalsGlue() {
    const panel = $('tvSeasonalsPanel');
    if (!panel || panel.__acToolsWired) return;
    panel.__acToolsWired = true;
    _seasWasOpen = getComputedStyle(panel).display !== 'none';
    try {
      new MutationObserver(syncSeasonalsHost).observe(panel, { attributes: true, attributeFilter: ['style', 'class'] });
    } catch (e) { /* no fallback needed — the panel still works, the chart just stays visible */ }
    const btn = $('seasonalsToggleBtn');
    if (btn && !btn.__acToolsWired) {
      btn.__acToolsWired = true;
      // The panel's display flips inside tv-seasonals-ui.js's own click
      // handler; run after it so the observer never misses a same-tick flip.
      btn.addEventListener('click', () => setTimeout(syncSeasonalsHost, 0));
    }
  }

  // ═════════════════════════════════════════════════════════════
  //  4. Symbol / timeframe changes
  // ═════════════════════════════════════════════════════════════

  function onSymbolChange(sym) {
    ensureTickerEl();

    // Backtest — the previous symbol's trades are meaningless here. Trust the
    // store again (the panel body still shows the old symbol until reopened).
    _btModalRendered = false;
    clearBacktestMarkers();
    if (backtestModalOpen() && typeof window.openMACDBacktestModal === 'function') {
      // Re-entering the panel's own entry point: loads this symbol's cache or
      // runs it fresh, exactly as a manual open would.
      try { window.openMACDBacktestModal(); } catch (e) { /* reported by the panel itself */ }
    }

    // Seasonals — candlestick-data.js:678 already calls this at the end of
    // processChartData(), but only if tv-seasonals-ui.js defined it. Calling
    // it again while the panel is open is a cheap, idempotent recompute and
    // covers the case where the data-layer call never happened.
    if (typeof window.refreshSeasonalsForSymbol === 'function') {
      const panel = $('tvSeasonalsPanel');
      if (panel && getComputedStyle(panel).display !== 'none') {
        try { window.refreshSeasonalsForSymbol(); } catch (e) { console.warn('[ACTools] seasonals refresh', e); }
      }
    }

    // Volatility — candlestick-data.js:675 calls refreshSidebarForSymbol(),
    // which tv-volatility.js wrapped to refresh the card. If something has
    // since replaced that wrapper, refresh the card directly instead.
    if (typeof window.refreshVolatilityForSymbol === 'function') {
      const covered = _volSidebarWrapper && window.refreshSidebarForSymbol === _volSidebarWrapper;
      if (!covered && sym) {
        try { window.refreshVolatilityForSymbol(sym); } catch (e) { console.warn('[ACTools] volatility refresh', e); }
      }
      // Either way the card's numbers land asynchronously (it fetches
      // /api/history) — recompute the bands once they have.
      setTimeout(() => { _volSig = null; requestRender(); }, 900);
    }

    clearVolLines();
    requestRender();
  }

  function onTimeframeChange() {
    // Backtest: macd-backtest.js replays aggregatedData, so a stored daily run
    // does not describe the weekly bars now on screen. backtestTrades() drops
    // it; re-run it if the panel is open so it comes back correct.
    _btSig = null;
    clearBacktestMarkers();
    if (backtestModalOpen()) {
      const rerun = $('mbt-rerun');
      if (rerun) rerun.click();
      else if (typeof window.openMACDBacktestModal === 'function') window.openMACDBacktestModal();
    }

    // Seasonals and Volatility are both timeframe-independent by design:
    // tv-seasonals-ui.js:265 always feeds the raw daily `chartData` (seasonality
    // is a calendar concept) and tv-volatility.js:226 fetches /api/history
    // directly. Refresh seasonals anyway when open — it is cheap and keeps the
    // panel honest if chartData itself changed under the timeframe switch.
    if (typeof window.refreshSeasonalsForSymbol === 'function') {
      const panel = $('tvSeasonalsPanel');
      if (panel && getComputedStyle(panel).display !== 'none') {
        try { window.refreshSeasonalsForSymbol(); } catch (e) {}
      }
    }

    _volSig = null;
    requestRender();
  }

  // ═════════════════════════════════════════════════════════════
  //  5. Render hook — the single place that touches the chart
  // ═════════════════════════════════════════════════════════════

  function onRender() {
    const sym = currentCode();
    const tf = currentTf();

    if (sym !== _sym) {
      const first = _sym === null;
      _sym = sym;
      _tf = tf;
      // Defer out of the render pass: onSymbolChange() can reopen the backtest
      // panel and kick off fetches, and nothing should re-enter drawChart()
      // from inside a render hook.
      setTimeout(() => { if (!first) onSymbolChange(sym); else { ensureTickerEl(); requestRender(); } }, 0);
    } else if (tf !== _tf) {
      _tf = tf;
      setTimeout(onTimeframeChange, 0);
    }

    applyBacktestMarkers();
    applyVolatilityLines();
  }

  // ═════════════════════════════════════════════════════════════
  //  6. Toggles
  // ═════════════════════════════════════════════════════════════

  function toggleBacktestMarkers(force) {
    _btOn = (force === undefined) ? !_btOn : !!force;
    if (!_btOn) clearBacktestMarkers();
    else { _btSig = null; wireBacktestObserver(); }
    syncToggleButtons();
    requestRender();
    return _btOn;
  }

  function toggleVolatilityBands(force) {
    _volOn = (force === undefined) ? !_volOn : !!force;
    if (!_volOn) {
      clearVolLines();
    } else {
      _volSig = null;
      if (typeof window.refreshVolatilityForSymbol !== 'function') {
        console.warn('[ACTools] tv-volatility.js did not run (see ACTools.diagnose()) — there are no volatility bands to draw.');
      } else if (!$('tv-volatility-grid')) {
        // The card has never rendered, so its annualised figures are not on
        // the page yet. Ask for them; the bands appear when the fetch lands.
        const sym = _sym || currentCode();
        if (sym) {
          try { window.refreshVolatilityForSymbol(sym); } catch (e) { console.warn('[ACTools] volatility refresh', e); }
          setTimeout(() => { _volSig = null; requestRender(); }, 900);
        }
      }
    }
    syncToggleButtons();
    requestRender();
    return _volOn;
  }

  // Optional markup hook: any element with data-ac-tool="backtest-markers" or
  // "volatility-bands" gets wired as a toggle and kept in sync. Costs nothing
  // when the page has none.
  function syncToggleButtons() {
    document.querySelectorAll('[data-ac-tool="backtest-markers"]').forEach((el) => {
      el.classList.toggle('active', _btOn);
      el.setAttribute('aria-pressed', String(_btOn));
    });
    document.querySelectorAll('[data-ac-tool="volatility-bands"]').forEach((el) => {
      el.classList.toggle('active', _volOn);
      el.setAttribute('aria-pressed', String(_volOn));
    });
  }

  function wireToggleButtons() {
    document.querySelectorAll('[data-ac-tool]').forEach((el) => {
      if (el.__acToolsWired) return;
      const kind = el.dataset.acTool;
      if (kind !== 'backtest-markers' && kind !== 'volatility-bands') return;
      el.__acToolsWired = true;
      el.addEventListener('click', () => {
        if (kind === 'backtest-markers') toggleBacktestMarkers();
        else toggleVolatilityBands();
      });
    });
    syncToggleButtons();
  }

  // ═════════════════════════════════════════════════════════════
  //  7. Diagnostics
  // ═════════════════════════════════════════════════════════════

  function diagnose(quiet) {
    const missingEls = REQUIREMENTS.filter(r => !document.querySelector(r.sel));
    const missingGlobals = GLOBALS.filter(g => typeof window[g.name] !== 'function');
    const notes = [];

    if (!window.LightweightCharts) {
      notes.push('LightweightCharts is not loaded.');
    } else if (typeof window.LightweightCharts.createSeriesMarkers !== 'function') {
      notes.push('LightweightCharts.createSeriesMarkers is missing — advanced-chart.html must load ' +
        'lightweight-charts v5 (v5 replaced series.setMarkers() with createSeriesMarkers()).');
    }
    if (!window.ACChart) notes.push('window.ACChart is missing — ac-render.js did not load before ac-tools.js.');

    if (!quiet) {
      missingEls.forEach((r) => {
        const msg = `[ACTools] missing ${r.sel} — needed by ${r.file}:${r.line} (${r.why})`;
        if (r.hard) console.error(msg); else console.warn(msg);
      });
      missingGlobals.forEach((g) => {
        console.error(`[ACTools] window.${g.name} is undefined — ${g.file}:${g.line} did not run ` +
          '(its host element was missing when the file executed, or the file is not on the page).');
      });
      notes.forEach(n => console.error('[ACTools] ' + n));
    }
    return { missingEls, missingGlobals, notes, ok: !missingEls.some(r => r.hard) && !missingGlobals.length && !notes.length };
  }

  // ═════════════════════════════════════════════════════════════
  //  8. Boot
  // ═════════════════════════════════════════════════════════════

  function refreshAll(symbol) {
    const sym = (symbol ? String(symbol).toUpperCase() : currentCode()) || null;
    const changed = sym !== _sym;
    _sym = sym;
    _tf = currentTf();
    wire();
    if (changed) onSymbolChange(sym);
    else {
      _btSig = null;
      _volSig = null;
      requestRender();
    }
    return sym;
  }

  function wire() {
    ensureTickerEl();
    wireSeasonalsGlue();
    wireBacktestObserver();
    wrapBacktestEntryPoints();
    wrapVolatilityEntryPoints();
    wireVolatilityModalInputs();
    wireToggleButtons();
    syncSeasonalsHost();
  }

  function boot() {
    wire();
    diagnose();
    if (window.ACChart) {
      window.ACChart.addRenderHook('tools-overlays', onRender);
      window.ACChart.addOverlayPainter('backtest-trades', paintTradeConnectors);
    } else {
      console.error('[ACTools] ac-render.js must load before ac-tools.js — ' +
        'backtest markers and volatility bands are disabled.');
    }
    requestRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // ── Exports ────────────────────────────────────────────────────
  window.toggleBacktestMarkers = toggleBacktestMarkers;
  window.toggleVolatilityBands = toggleVolatilityBands;

  window.ACTools = {
    refreshAll,
    toggleBacktestMarkers,
    toggleVolatilityBands,
    // Introspection — used by the page's own wiring and by manual debugging.
    diagnose,
    backtestMarkersOn: () => _btOn,
    volatilityBandsOn: () => _volOn,
    backtestResult: () => loadBacktestResult(_sym || currentCode()),
  };

})();
