'use strict';

/* ════════════════════════════════════════════════════════════
   ac-panels.js
   Chart-side wiring for the three analysis panels the Advanced
   Chart loads UNMODIFIED out of ../candlestick_chart/:

     candlestick-analysis.js  → window.openAnalysisModal / AnalysisEngine
     valuation.js             → window.openValuationModal
     support-resistance.js    → window.openSRModal

   Those three are renderer-agnostic: they read `chartData` /
   `aggregatedData` and render into their own modal bodies, and
   they touch neither the canvas, nor `drawChart()`, nor
   `window._lastRender`. So this file does NOT reimplement them.
   It adds the three things they cannot do for themselves here:

     1. A dependency audit — every global, DOM id and stylesheet
        the three files need, checked at boot, reported in the
        console (and via ACPanels.audit()) instead of failing
        silently. Nothing under candlestick_chart/ is patched.

     2. S/R levels drawn ON the chart. On the candlestick page the
        detected zones only ever appear as a list inside #srModal.
        Lightweight Charts gives us price lines, so each detected
        level is also plotted on the price series — supports green,
        resistances red, labelled with their touch count, the
        more-tested ones drawn solid and thicker. Toggle:
        window.toggleSRLevels(), default OFF, persisted.

     3. Symbol/timeframe sync. candlestick-data.js only notifies
        the sidebar and the seasonals panel when a new symbol
        finishes loading (candlestick-data.js:675-678) — the three
        panels here are never told, so an OPEN panel would keep
        showing the previous stock. A cheap render hook watches the
        (symbol, timeframe, bar count) signature and re-runs only
        what is actually on screen.

   Depends on : ac-render.js (window.ACChart), candlestick-data.js
                (chartData, aggregatedData, currentTimeframe,
                 chartType, aggregateCandlesByWeek, _loadPref,
                 _savePref), the three panel files above.
   Owns       : window.ACPanels, window.toggleSRLevels,
                window.refreshAnalysisForSymbol,
                window.refreshValuationForSymbol,
                window.refreshSRForSymbol
   ════════════════════════════════════════════════════════════ */

(function () {

  const $ = (id) => document.getElementById(id);

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }

  function LWC() { return window.LightweightCharts || null; }

  // LineStyle is an enum on the LWC global; the numeric fallbacks are the
  // same values v4 and v5 both use, so a CDN hiccup degrades to plain lines
  // instead of throwing.
  const LINE_STYLE_FALLBACK = { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 };
  function lineStyle(name) {
    const L = LWC();
    if (L && L.LineStyle && L.LineStyle[name] != null) return L.LineStyle[name];
    return LINE_STYLE_FALLBACK[name];
  }

  function panelVisible(modalId) {
    const m = $(modalId);
    if (!m) return false;
    // The panel files toggle the inline style directly (display:flex / none),
    // so the inline value is authoritative when it is set.
    if (m.style && m.style.display) return m.style.display !== 'none';
    try { return getComputedStyle(m).display !== 'none'; } catch (e) { return false; }
  }

  function currentSymbol() {
    if (typeof chartData !== 'undefined' && chartData.length && chartData[0].Symbol) {
      return String(chartData[0].Symbol).toUpperCase();
    }
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return null;
  }

  function loadPref(key, fallback) {
    return (typeof _loadPref === 'function') ? _loadPref(key, fallback) : fallback;
  }
  function savePref(key, value) {
    if (typeof _savePref === 'function') _savePref(key, value);
  }

  /* ══════════════════════════════════════════════════════════
     1. DEPENDENCY AUDIT
     Everything the three unmodified files reach for, with the
     line in that file that reaches for it. Reported, never
     patched — a miss here is a bug in the page markup or the
     script order, not in candlestick_chart/.
     ══════════════════════════════════════════════════════════ */

  const REQUIREMENTS = [
    // ── candlestick-analysis.js ──────────────────────────────
    { file: 'candlestick-analysis.js', line: 707, kind: 'global', name: 'chartData',
      test: () => typeof chartData !== 'undefined' },
    { file: 'candlestick-analysis.js', line: 707, kind: 'global', name: 'aggregatedData',
      test: () => typeof aggregatedData !== 'undefined' },
    { file: 'candlestick-analysis.js', line: 446, kind: 'global', name: 'urlCodeFallback()',
      test: () => typeof urlCodeFallback === 'function' },
    { file: 'candlestick-analysis.js', line: 331, kind: 'global', name: 'calculateSMA() — indicators/ma.js',
      test: () => typeof calculateSMA === 'function' },
    { file: 'candlestick-analysis.js', line: 80, kind: 'global', name: 'attachMA() — writes the sma20/sma50/sma200 fields analyzeTrend() reads off each candle',
      test: () => typeof attachMA === 'function' },
    { file: 'candlestick-analysis.js', line: 415, kind: 'global', name: 'computeSeasonalData() — tv-seasonals.js',
      test: () => typeof computeSeasonalData === 'function' },
    { file: 'candlestick-analysis.js', line: 418, kind: 'global', name: 'computeSeasonalMonthStats() — tv-seasonals.js',
      test: () => typeof computeSeasonalMonthStats === 'function' },
    { file: 'candlestick-analysis.js', line: 730, kind: 'dom', name: '#analysisModal',
      test: () => !!$('analysisModal') },
    { file: 'candlestick-analysis.js', line: 673, kind: 'dom', name: '#analysisBody',
      test: () => !!$('analysisBody') },
    { file: 'candlestick-analysis.js', line: 729, kind: 'export', name: 'window.openAnalysisModal',
      test: () => typeof window.openAnalysisModal === 'function' },
    { file: 'candlestick-analysis.js', line: 747, kind: 'export', name: 'window.AnalysisEngine',
      test: () => !!window.AnalysisEngine },
    { file: 'candlestick-analysis.js', line: 1, kind: 'css', name: 'candlestick-analysis.css',
      test: () => hasStylesheet('candlestick-analysis.css') },

    // ── valuation.js ─────────────────────────────────────────
    { file: 'valuation.js', line: 101, kind: 'global', name: 'chartData',
      test: () => typeof chartData !== 'undefined' },
    { file: 'valuation.js', line: 81, kind: 'global', name: 'urlCodeFallback()',
      test: () => typeof urlCodeFallback === 'function' },
    { file: 'valuation.js', line: 426, kind: 'dom', name: '#valuationModal',
      test: () => !!$('valuationModal') },
    { file: 'valuation.js', line: 366, kind: 'dom', name: '#valuationBody',
      test: () => !!$('valuationBody') },
    { file: 'valuation.js', line: 426, kind: 'export', name: 'window.openValuationModal',
      test: () => typeof window.openValuationModal === 'function' },
    { file: 'valuation.js', line: 1, kind: 'css', name: 'valuation.css',
      test: () => hasStylesheet('valuation.css') },

    // ── support-resistance.js ────────────────────────────────
    { file: 'support-resistance.js', line: 137, kind: 'global', name: 'chartData',
      test: () => typeof chartData !== 'undefined' },
    { file: 'support-resistance.js', line: 144, kind: 'global', name: 'aggregateCandlesByWeek()',
      test: () => typeof aggregateCandlesByWeek === 'function' },
    { file: 'support-resistance.js', line: 131, kind: 'global', name: 'urlCodeFallback()',
      test: () => typeof urlCodeFallback === 'function' },
    { file: 'support-resistance.js', line: 256, kind: 'dom', name: '#srModal',
      test: () => !!$('srModal') },
    { file: 'support-resistance.js', line: 167, kind: 'dom', name: '#srBody',
      test: () => !!$('srBody') },
    { file: 'support-resistance.js', line: 255, kind: 'export', name: 'window.openSRModal',
      test: () => typeof window.openSRModal === 'function' },
    { file: 'support-resistance.js', line: 1, kind: 'css', name: 'support-resistance.css',
      test: () => hasStylesheet('support-resistance.css') },
    // support-resistance.js's own CSS covers .sr-*, but the panel shell
    // (.an-panel / .an-panel-body) and .val-warn / .val-disclaimer it renders
    // into come from the other two sheets — all three must be linked.
  ];

  function hasStylesheet(fileName) {
    const links = document.querySelectorAll('link[rel="stylesheet"][href]');
    for (const l of links) {
      if (String(l.getAttribute('href')).indexOf(fileName) !== -1) return true;
    }
    return false;
  }

  function audit() {
    const missing = [];
    REQUIREMENTS.forEach((r) => {
      let ok = false;
      try { ok = !!r.test(); } catch (e) { ok = false; }
      if (!ok) missing.push(r);
    });
    return { ok: missing.length === 0, missing, checked: REQUIREMENTS.length };
  }

  function reportAudit() {
    const res = audit();
    if (res.ok) return res;
    console.warn(
      '[AC panels] %d of %d panel dependencies are missing — the three shared panel files are NOT patched, fix the page instead:',
      res.missing.length, res.checked
    );
    res.missing.forEach((m) => {
      console.warn(`  · ${m.kind.padEnd(6)} ${m.name}  — needed by ${m.file}:${m.line}`);
    });
    return res;
  }

  /* ══════════════════════════════════════════════════════════
     2. SUPPORT & RESISTANCE — levels plotted on the chart

     support-resistance.js keeps its level maths module-private
     (the IIFE at support-resistance.js:34 exports only
     openSRModal/closeSRModal at :255/:262 — computeLevels() at
     :105 is never exposed), so the algorithm is MIRRORED here,
     step for step, off the same daily `chartData`:

       findSwingPoints   ← support-resistance.js:58
       clusterPoints     ← support-resistance.js:76
       selectSpacedLevels← support-resistance.js:94
       computeLevels     ← support-resistance.js:105
       the High>0/Low>0 scrape-gap filter ← support-resistance.js:143

     If that file ever grows an additive `window.SRLevels =
     { computeLevels }` export, the mirror stands down on its own
     (see srCompute()) — that is the fix to prefer, and it is
     flagged in this agent's report to the orchestrator.

     The detection knobs are read live out of the modal's own
     inputs (#sr-mingap / #sr-maxlevels / #sr-lookback /
     #sr-cluster, rendered at support-resistance.js:202-205) when
     the panel has been opened, so the lines on the chart always
     show exactly the levels the panel lists.
     ══════════════════════════════════════════════════════════ */

  const SR_DEFAULTS = { lookback: 2, clusterPct: 1.5, minGapPct: 3, maxLevels: 4 };

  function srSettings() {
    const s = Object.assign({}, SR_DEFAULTS);
    const read = (id, key, isInt) => {
      const el = $(id);
      if (!el) return;
      const v = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
      if (!isNaN(v) && v > 0) s[key] = v;
    };
    read('sr-mingap', 'minGapPct');
    read('sr-maxlevels', 'maxLevels', true);
    read('sr-lookback', 'lookback', true);
    read('sr-cluster', 'clusterPct');
    return s;
  }

  function findSwingPoints(weekly, lookback) {
    const highs = [], lows = [];
    for (let i = lookback; i < weekly.length - lookback; i++) {
      const c = weekly[i];
      let isHigh = true, isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (weekly[j].High >= c.High) isHigh = false;
        if (weekly[j].Low <= c.Low) isLow = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) highs.push({ price: c.High, date: c.Date });
      if (isLow) lows.push({ price: c.Low, date: c.Date });
    }
    return { highs, lows };
  }

  function clusterPoints(points, tolerancePct) {
    const sorted = points.slice().sort((a, b) => a.price - b.price);
    const clusters = [];
    for (const p of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(p.price - last.avgPrice) / last.avgPrice * 100 <= tolerancePct) {
        last.points.push(p);
        last.avgPrice = last.points.reduce((s, x) => s + x.price, 0) / last.points.length;
        last.touches = last.points.length;
        if (p.date > last.lastDate) last.lastDate = p.date;
      } else {
        clusters.push({ avgPrice: p.price, points: [p], touches: 1, lastDate: p.date });
      }
    }
    return clusters;
  }

  function selectSpacedLevels(clusters, maxCount, minGapPct) {
    const ranked = clusters.slice().sort((a, b) => b.touches - a.touches || (a.lastDate < b.lastDate ? 1 : -1));
    const selected = [];
    for (const c of ranked) {
      const tooClose = selected.some((s) => Math.abs(c.avgPrice - s.avgPrice) / s.avgPrice * 100 < minGapPct);
      if (!tooClose) selected.push(c);
      if (selected.length >= maxCount) break;
    }
    return selected;
  }

  function mirrorComputeLevels(weekly, price, st) {
    if (!weekly || weekly.length < st.lookback * 2 + 3) {
      return { error: `Not enough weekly history yet (need at least ${st.lookback * 2 + 3} weeks, have ${weekly ? weekly.length : 0}).` };
    }
    const sw = findSwingPoints(weekly, st.lookback);
    if (!sw.highs.length && !sw.lows.length) {
      return { error: 'No clear swing highs/lows found in the available weekly history.' };
    }
    const highClusters = clusterPoints(sw.highs, st.clusterPct);
    const lowClusters  = clusterPoints(sw.lows, st.clusterPct);

    const resistance = selectSpacedLevels(
      highClusters.filter((c) => c.avgPrice > price), st.maxLevels, st.minGapPct
    ).sort((a, b) => a.avgPrice - b.avgPrice);
    const support = selectSpacedLevels(
      lowClusters.filter((c) => c.avgPrice < price), st.maxLevels, st.minGapPct
    ).sort((a, b) => b.avgPrice - a.avgPrice);

    return { support, resistance, weeksAnalyzed: weekly.length };
  }

  // Prefer the real implementation the moment support-resistance.js exposes
  // one; fall back to the mirror above until then.
  function srCompute(weekly, price, st) {
    const shared = window.SRLevels;
    if (shared && typeof shared.computeLevels === 'function') {
      try { return shared.computeLevels(weekly, price, st); } catch (e) { /* fall through */ }
    }
    return mirrorComputeLevels(weekly, price, st);
  }

  let _srCache = null; // { sig, result }

  function srLevels() {
    if (typeof chartData === 'undefined' || !chartData || !chartData.length) return null;
    if (typeof aggregateCandlesByWeek !== 'function') return null;

    const st = srSettings();
    const sig = [
      currentSymbol(), chartData.length, chartData[chartData.length - 1].Date,
      st.lookback, st.clusterPct, st.minGapPct, st.maxLevels,
    ].join('|');
    if (_srCache && _srCache.sig === sig) return _srCache.result;

    // Same scrape-gap guard support-resistance.js:143 applies: a handful of
    // archive days carry High/Low/Open = 0, and a Low of 0 would always win
    // as "the lowest low", inventing a ৳0 support.
    const valid = chartData.filter((c) => c.High > 0 && c.Low > 0);
    const weekly = aggregateCandlesByWeek(valid);
    const price = chartData[chartData.length - 1].Close;
    const result = srCompute(weekly, price, st);
    result.price = price;
    _srCache = { sig, result };
    return result;
  }

  // ── The price series the levels hang off ─────────────────────
  // Mirrors ac-render.js:renderPriceSeries()'s chartType → series-kind
  // mapping so ACChart.series('__price', …) returns the EXISTING series
  // instead of swapping it for a new one of the wrong kind.
  function priceKind() {
    const t = (typeof chartType !== 'undefined') ? chartType : 'candlestick';
    if (t === 'bars') return 'bar';
    if (t === 'line') return 'line';
    if (t === 'area') return 'area';
    return 'candlestick'; // candlestick | hollow | heikinashi | renko
  }

  function priceSeriesApi() {
    const AC = window.ACChart;
    if (!AC || !AC.ready()) return null;
    const data = AC.displayData();
    if (!data || !data.length) return null;   // never conjure an empty price series
    if (AC.paneIndex('price') < 0) return null;
    try { return AC.series('__price', priceKind(), undefined, 'price'); } catch (e) { return null; }
  }

  // ── Plotted lines ────────────────────────────────────────────
  let _srVisible = !!loadPref('acSRLevels', false);
  let _srLines = [];     // [{ api, line }]
  let _srSeries = null;  // the series the current set is attached to

  function clearSRLines() {
    _srLines.forEach((entry) => {
      // A pane rebuild purges every cached series; removing a price line from
      // an already-removed series is a no-op we just swallow.
      try { entry.api.removePriceLine(entry.line); } catch (e) {}
    });
    _srLines = [];
    _srSeries = null;
  }

  function plotSRLevels() {
    clearSRLines();
    if (!_srVisible) return;

    const api = priceSeriesApi();
    if (!api) return;
    _srSeries = api; // claim the anchor even if there is nothing to draw,
                     // so the per-render identity check stays a cheap no-op

    const res = srLevels();
    if (!res || res.error) return;

    const AC = window.ACChart;
    const c = AC.colors();

    const add = (level, kind) => {
      const base = (kind === 'support') ? c.gain : c.loss;
      const touches = level.touches || 1;
      const strong = touches >= 3;
      try {
        const line = api.createPriceLine({
          price: level.avgPrice,
          color: AC.alpha(base, strong ? 0.95 : 0.7),
          lineWidth: strong ? 2 : 1,
          lineStyle: lineStyle(strong ? 'Solid' : 'Dashed'),
          axisLabelVisible: true,
          title: `${kind === 'support' ? 'S' : 'R'} ×${touches}`,
        });
        _srLines.push({ api, line });
      } catch (e) { /* the series went away mid-render */ }
    };

    (res.support || []).forEach((l) => add(l, 'support'));
    (res.resistance || []).forEach((l) => add(l, 'resistance'));
  }

  // ── Toggle ───────────────────────────────────────────────────
  const SR_BTN_ID = 'acSRLevelsBtn';
  const SR_BTN_CANDIDATES = ['acSRLevelsBtn', 'ac-sr-levels-btn', 'srLevelsToggleBtn', 'srLevelsBtn'];

  function srButton() {
    for (const id of SR_BTN_CANDIDATES) { const el = $(id); if (el) return el; }
    return document.querySelector('[data-ac-action="toggle-sr-levels"]');
  }

  function syncSRButton() {
    const btn = srButton();
    if (!btn) return;
    btn.classList.toggle('active', _srVisible);
    btn.setAttribute('aria-pressed', _srVisible ? 'true' : 'false');
  }

  function toggleSRLevels(force) {
    _srVisible = (typeof force === 'boolean') ? force : !_srVisible;
    savePref('acSRLevels', _srVisible);
    syncSRButton();
    plotSRLevels();
    return _srVisible;
  }

  // The right rail ships a button that OPENS the S/R panel (#srToggleBtn,
  // advanced-chart.html:730) but none that plots the levels, so one is added
  // beside it — only when the page has not already provided its own.
  function ensureSRButton() {
    if (srButton()) { syncSRButton(); return; }
    const anchor = $('srToggleBtn');
    if (!anchor || !anchor.parentNode) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = SR_BTN_ID;
    btn.className = 'tv-rail-btn tv-toggle-btn';
    btn.title = 'Plot the detected support & resistance levels on the chart';
    btn.setAttribute('aria-label', 'Plot S/R levels on chart');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<line x1="3" y1="8" x2="21" y2="8" stroke-dasharray="3 3"/>' +
      '<line x1="3" y1="16" x2="21" y2="16" stroke-dasharray="3 3"/>' +
      '<path d="M3 20.5l5-6 4 3 4-7 5 4" opacity="0.55"/></svg>';
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    syncSRButton();
  }

  function wireSRButton() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest
        ? ev.target.closest('#' + SR_BTN_ID + ', [data-ac-action="toggle-sr-levels"], #srLevelsToggleBtn, #srLevelsBtn, #ac-sr-levels-btn')
        : null;
      if (!btn) return;
      ev.preventDefault();
      toggleSRLevels();
    });

    // Retuning the detection settings inside the panel must move the lines
    // too — the inputs are re-created on every render() there, so this is
    // delegated rather than bound per element.
    document.addEventListener('input', (ev) => {
      const t = ev.target;
      if (!t || !t.id) return;
      if (t.id !== 'sr-mingap' && t.id !== 'sr-maxlevels' && t.id !== 'sr-lookback' && t.id !== 'sr-cluster') return;
      _srCache = null;
      if (_srVisible) plotSRLevels();
    });
  }

  /* ══════════════════════════════════════════════════════════
     3. ANALYSIS — recompute on symbol change + toolbar verdict
     ══════════════════════════════════════════════════════════ */

  // A named slot only. The toolbar agent 1 shipped
  // (advanced-chart.html:253) has no badge container, so by default this
  // does nothing at all; adding <span data-ac-slot="analysis-verdict"></span>
  // anywhere in the toolbar turns it on, or call
  // ACPanels.mountVerdictBadge(elOrSelector).
  const VERDICT_SLOT_IDS = [
    'acAnalysisVerdict', 'ac-analysis-verdict', 'acVerdictBadge',
    'ac-verdict-badge', 'analysisVerdictBadge', 'tvAnalysisVerdict',
  ];
  const VERDICT_SLOT_SELECTOR = '[data-ac-slot="analysis-verdict"]';

  let _mountedSlot = null;

  function verdictSlot() {
    if (_mountedSlot && document.body && document.body.contains(_mountedSlot)) return _mountedSlot;
    for (const id of VERDICT_SLOT_IDS) { const el = $(id); if (el) return el; }
    return document.querySelector(VERDICT_SLOT_SELECTOR);
  }

  // The same rule-based signals the panel's banner is built from — minus the
  // sector-relative one, which needs a /api/stocks round trip. Everything
  // here is synchronous, so it is safe to recompute on every symbol change.
  function computeVerdictNow() {
    const E = window.AnalysisEngine;
    if (!E || typeof E.computeTechnical !== 'function' || typeof E.computeVerdict !== 'function') return null;

    const data = (typeof aggregatedData !== 'undefined' && aggregatedData.length)
      ? aggregatedData
      : (typeof chartData !== 'undefined' ? chartData : []);
    if (!data || data.length < 5) return null;

    let tech;
    try { tech = E.computeTechnical(data); } catch (e) { return null; }
    if (!tech || tech.insufficientData) return null;

    const signals = [].concat(
      tech.trend || [], tech.momentum || [], tech.volatility || [],
      tech.volume || [], tech.patterns || []
    );
    if (typeof E.computeMinervini === 'function') {
      try {
        const mn = E.computeMinervini(typeof chartData !== 'undefined' ? chartData : []);
        if (mn && mn.signal) signals.push(mn.signal);
      } catch (e) { /* Minervini needs 200 days; absence is normal */ }
    }
    if (!signals.length) return null;

    try { return E.computeVerdict(signals); } catch (e) { return null; }
  }

  const VERDICT_COLOR_VAR = {
    bullish: 'var(--gain)',
    'bullish-mild': 'var(--gain)',
    bearish: 'var(--loss)',
    'bearish-mild': 'var(--loss)',
    neutral: 'var(--text-secondary)',
  };

  function updateVerdictBadge() {
    const slot = verdictSlot();
    if (!slot) return false;

    const v = computeVerdictNow();
    if (!v) {
      slot.innerHTML = '';
      slot.hidden = true;
      return false;
    }
    slot.hidden = false;

    const color = VERDICT_COLOR_VAR[v.cls] || 'var(--text-secondary)';
    const mild = v.cls.indexOf('-mild') !== -1;
    slot.innerHTML =
      `<span class="ac-verdict-badge ac-verdict-badge--${esc(v.cls)}" data-verdict="${esc(v.cls)}" role="button" tabindex="0"` +
      ` title="Rule-based verdict from ${v.bull} bullish / ${v.bear} bearish / ${v.neu} neutral signals on this chart's own price and volume` +
      ` (the panel's own banner adds a sector-relative signal that needs a network fetch). Click for the full Analysis panel.">` +
      `<span class="ac-verdict-badge-label">${esc(v.label)}</span>` +
      `<span class="ac-verdict-badge-score">${v.score > 0 ? '+' : ''}${v.score}</span>` +
      '</span>';

    const badge = slot.firstElementChild;
    if (badge) {
      // Only style it ourselves when the page ships no rule for the class —
      // whatever CSS an agent adds later wins without a change here.
      let styled = false;
      try {
        const cs = getComputedStyle(badge);
        styled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
      } catch (e) {}
      if (!styled) {
        badge.style.cssText =
          'display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:999px;' +
          'border:1px solid var(--border);background:var(--bg-hover);cursor:pointer;' +
          'font-family:var(--sans);font-size:11px;font-weight:600;line-height:18px;white-space:nowrap;';
        const label = badge.querySelector('.ac-verdict-badge-label');
        const score = badge.querySelector('.ac-verdict-badge-score');
        if (label) label.style.cssText = `color:${color};${mild ? 'opacity:0.82;' : ''}`;
        if (score) score.style.cssText = 'font-family:var(--mono);color:var(--text-secondary);font-size:10px;';
      }
      badge.addEventListener('click', openAnalysis);
      badge.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openAnalysis(); }
      });
    }
    return true;
  }

  function openAnalysis() {
    if (typeof window.openAnalysisModal === 'function') window.openAnalysisModal();
  }

  function mountVerdictBadge(target) {
    const el = (typeof target === 'string') ? document.querySelector(target) : target;
    if (!el || !el.nodeType) return false;
    _mountedSlot = el;
    return updateVerdictBadge();
  }

  /* ══════════════════════════════════════════════════════════
     4. KEEPING THE PANELS IN SYNC WITH THE CHART

     Re-opening a panel is how it recomputes — openAnalysisModal /
     openValuationModal / openSRModal each bump their own _openId
     and re-run, which also invalidates any in-flight fetch from
     the previous symbol. So a "refresh" of an open panel is
     literally a re-open; a closed panel needs nothing, it reads
     fresh chartData the next time it is opened.
     ══════════════════════════════════════════════════════════ */

  function reopenIfVisible(modalId, openFnName) {
    if (!panelVisible(modalId)) return false;
    const fn = window[openFnName];
    if (typeof fn !== 'function') return false;
    try { fn(); return true; }
    catch (e) { console.warn('[AC panels] refresh via ' + openFnName, e); return false; }
  }

  function refreshAnalysisForSymbol(symbol) {
    updateVerdictBadge();
    return reopenIfVisible('analysisModal', 'openAnalysisModal');
  }

  function refreshValuationForSymbol(symbol) {
    return reopenIfVisible('valuationModal', 'openValuationModal');
  }

  function refreshSRForSymbol(symbol) {
    _srCache = null;
    plotSRLevels();
    return reopenIfVisible('srModal', 'openSRModal');
  }

  function refreshAll(symbol) {
    const code = symbol || currentSymbol();
    _lastSig = stateSignature();
    refreshAnalysisForSymbol(code);
    refreshValuationForSymbol(code);
    refreshSRForSymbol(code);
  }

  // ── Change detection ─────────────────────────────────────────
  // drawChart() runs constantly, so the hook itself must stay at the cost of
  // one string build. Pans/zooms never reach it at all (ac-render.js only
  // recomputes _lastRender on a visible-range change), and everything heavy
  // is deferred out of the render pass.
  function stateSignature() {
    const n = (typeof chartData !== 'undefined' && chartData) ? chartData.length : 0;
    const sym = (n && chartData[0].Symbol) ? chartData[0].Symbol : '';
    const last = n ? chartData[n - 1].Date : '';
    const tf = (typeof currentTimeframe !== 'undefined') ? currentTimeframe : '';
    return sym + '|' + tf + '|' + n + '|' + last;
  }

  let _lastSig = null;
  let _refreshQueued = false;

  function scheduleRefresh() {
    if (_refreshQueued) return;
    _refreshQueued = true;
    setTimeout(() => { _refreshQueued = false; refreshAll(currentSymbol()); }, 0);
  }

  function onRender() {
    const sig = stateSignature();
    if (sig !== _lastSig) {
      _lastSig = sig;
      _srCache = null;
      scheduleRefresh();
      return;
    }
    // Same symbol, same data: the only thing that can have invalidated the
    // price lines is the price series itself being rebuilt (a pane set /
    // chart-type change purges the series cache, and its price lines with it).
    if (_srVisible) {
      const api = priceSeriesApi();
      if (api && api !== _srSeries) plotSRLevels();
    }
  }

  /* ══════════════════════════════════════════════════════════
     5. BOOT
     ══════════════════════════════════════════════════════════ */

  function onReady() {
    reportAudit();
    ensureSRButton();
    wireSRButton();
    syncSRButton();

    // candlestick-data.js:675 fires this once a symbol has finished loading
    // (tv-volatility.js:614 chains onto it the same way). Chaining gives a
    // second, data-complete trigger next to the render hook; refreshAll()
    // is idempotent and the signature check absorbs the duplicate.
    const prevRefresh = window.refreshSidebarForSymbol;
    window.refreshSidebarForSymbol = function (code) {
      let out;
      if (typeof prevRefresh === 'function') {
        try { out = prevRefresh.apply(this, arguments); } catch (e) { console.warn('[AC panels] sidebar refresh', e); }
      }
      scheduleRefresh();
      return out;
    };

    // First paint of whatever is already loaded.
    scheduleRefresh();
  }

  if (window.ACChart && typeof window.ACChart.addRenderHook === 'function') {
    window.ACChart.addRenderHook('panels', onRender);
  } else {
    console.warn('[AC panels] window.ACChart is not available — ac-render.js must load before ac-panels.js');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }

  /* ══════════════════════════════════════════════════════════
     6. EXPORTS
     ══════════════════════════════════════════════════════════ */

  window.refreshAnalysisForSymbol = refreshAnalysisForSymbol;
  window.refreshValuationForSymbol = refreshValuationForSymbol;
  window.refreshSRForSymbol = refreshSRForSymbol;
  window.toggleSRLevels = toggleSRLevels;

  window.ACPanels = {
    refreshAll,
    toggleSRLevels,
    srLevelsVisible: () => _srVisible,

    // Extras for the other ac-* modules / the console.
    srLevels,                 // the detected zones, as the modal computes them
    plotSRLevels,             // force a re-plot
    updateVerdictBadge,
    mountVerdictBadge,
    computeVerdict: computeVerdictNow,
    audit,
  };

})();
