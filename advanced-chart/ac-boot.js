/* ════════════════════════════════════════════════════════════
   ac-boot.js
   THE INIT SEQUENCE for the Advanced Chart page.

   Loads LAST (see ARCHITECTURE.md's load order), so by the time
   anything in here runs, every shared module out of
   ../candlestick_chart/ and every other ac-*.js has already been
   evaluated. That is the whole point of the ordering: this file
   only has to start things, never to define them.

   What it owns
     • the CDN / v5-API guard and the fatal-error surface
     • chart creation + overlay attach + theme apply
     • the first data load (candlestick-data.js's loadData())
     • window.reloadChartForSymbol(symbol)  — in-place symbol switch
       (stock-search.js, tv-sidebar.js's watchlist / All-Shares rows
       and company.js all call this global)
     • popstate (back/forward between symbols)
     • ?code= / ?timeframe= / ?smFocus= URL seeding
     • the page title + the header symbol chrome

   Depends on : lightweight-charts v5 (global LightweightCharts),
                ac-render.js (window.ACChart, drawChart),
                ../candlestick_chart/candlestick-data.js
                  (loadData, processChartData, setHeaderLogoTag,
                   chartData, aggregatedData, currentTimeframe, …)
   Consumed by: stock-search.js, tv-sidebar.js, ac-sidebar.js,
                anything that calls window.reloadChartForSymbol()
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  const DEFAULT_SYMBOL = 'BPML';
  const TAG = '[ACBoot]';

  let _booted = false;
  let _currentCode = '';

  // ── URL helpers ────────────────────────────────────────────────
  function params() { return new URLSearchParams(window.location.search); }

  // Mirrors candlestick-data.js's urlCodeFallback() exactly — loadData()
  // re-reads ?code= itself, so the URL is the single source of truth for
  // which symbol is being shown and it must be updated BEFORE loadData().
  function codeFromUrl() {
    return (params().get('code') || DEFAULT_SYMBOL).toUpperCase();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // ── Fatal error surface ────────────────────────────────────────
  // #loadingState is the element candlestick-data.js's showError() writes
  // into and processChartData() hides, so it is the one the rest of the
  // page already treats as "the chart is not ready" slot. The others are
  // fallbacks for whatever the markup ends up calling it.
  function errorSlot() {
    return document.getElementById('loadingState')
        || document.getElementById('ac-loading')
        || document.getElementById('ac-error')
        || null;
  }

  function fatal(messageHtml) {
    console.error(TAG, messageHtml.replace(/<[^>]+>/g, ' '));
    const el = errorSlot();
    if (!el) {
      const host = document.getElementById('ac-chart-container') || document.body;
      const div = document.createElement('div');
      div.className = 'chart-loading ac-boot-fatal';
      div.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:32px;text-align:center;line-height:1.6;';
      div.innerHTML = '❌ ' + messageHtml;
      host.appendChild(div);
      return;
    }
    el.hidden = false;
    el.style.display = 'flex';
    el.innerHTML = '❌ ' + messageHtml;
  }

  function showLoading(on) {
    const el = document.getElementById('loadingState');
    if (el) {
      el.hidden = false;
      el.style.display = on ? 'flex' : 'none';
      if (on) el.innerHTML = 'Loading…';
    }
    // The overlay canvas keeps candlestick.html's id and its inline
    // display:none start state; processChartData() flips it back to block.
    const canvas = document.getElementById('candleCanvas');
    if (canvas && on) canvas.style.display = 'none';
  }

  // ── Header / title chrome ──────────────────────────────────────
  // processChartData() does this too, once the data lands, using the
  // Symbol field out of the file. Doing it here as well means the header
  // flips the moment the user picks a symbol instead of a fetch later.
  function applySymbolChrome(code) {
    if (!code) return;
    const upper = String(code).toUpperCase();

    const ticker = document.getElementById('tvTicker');
    if (ticker) ticker.textContent = upper;
    document.querySelectorAll('.tv-ticker, .legend-name').forEach((el) => { el.textContent = upper; });

    if (typeof setHeaderLogoTag === 'function') {
      try { setHeaderLogoTag(upper); } catch (e) { console.warn(TAG, 'setHeaderLogoTag', e); }
    }

    document.title = `${upper} — Advanced Chart · DSE`;

    const profileLink = document.getElementById('headerCompanyProfileLink');
    if (profileLink) profileLink.href = `/company_profile/company.html?code=${encodeURIComponent(upper)}`;
    const researchLink = document.getElementById('researchReportBtn');
    if (researchLink) researchLink.href = `/research/research.html?code=${encodeURIComponent(upper)}`;
  }

  // ── Shared chart state reset ───────────────────────────────────
  // chartData / aggregatedData / zoomLevel / … are top-level `let`s in
  // candlestick-data.js. Classic scripts share one global lexical scope,
  // so a bare assignment here writes that same binding (this is exactly
  // what candlestick-ui.js:1402 does). typeof guards keep a missing data
  // layer from throwing a ReferenceError under 'use strict'.
  function resetChartState() {
    if (typeof chartData !== 'undefined') chartData = [];
    if (typeof aggregatedData !== 'undefined') aggregatedData = [];
    if (typeof replayMode !== 'undefined') replayMode = false;
    if (typeof replayIndex !== 'undefined') replayIndex = 0;
    if (typeof replayPlaying !== 'undefined') replayPlaying = false;
    // zoomLevel / panOffset / vZoomLevel / paneVZoom / priceOffset mean
    // nothing to this renderer (Lightweight Charts owns the viewport), but
    // they exist and sm-trade-overlay.js still writes them, so they are
    // reset for consistency rather than left drifting.
    if (typeof zoomLevel !== 'undefined') zoomLevel = 1;
    if (typeof vZoomLevel !== 'undefined') vZoomLevel = 1;
    if (typeof panOffset !== 'undefined') panOffset = 0;
    if (typeof priceOffset !== 'undefined') priceOffset = 0;
    if (typeof paneVZoom !== 'undefined') paneVZoom = { volume: 1, macd: 1, rsi: 1, hm: 1 };
    // NOTE: currentTimeframe is deliberately NOT reset to 'daily' the way
    // candlestick-ui.js does it. processChartData() re-aggregates from
    // whatever currentTimeframe holds and calls _syncTimeframeButtonUI(),
    // so keeping the user's D/W/M choice across a symbol switch is both
    // supported and less surprising than silently snapping back to daily.
  }

  function closeTransientUI() {
    [
      'closeIndicatorsModal', 'closeAnalysisModal', 'closeValuationModal',
      'closeSRModal', 'closeMACDBacktestModal', 'closeStockSearchModal',
      'closeIndicatorSettingsModal', 'closeRenkoSettingsModal',
    ].forEach((fn) => {
      if (typeof window[fn] === 'function') {
        try { window[fn](); } catch (e) { /* a modal that isn't open is not an error */ }
      }
    });
    ['indicatorSettingsModal', 'renkoSettingsModal'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    if (typeof window.exitReplayMode === 'function') {
      try { window.exitReplayMode(); } catch (e) { /* ac-replay.js may not be wired yet */ }
    }
  }

  // ── Panel fan-out ──────────────────────────────────────────────
  // processChartData()'s own tail already calls refreshSidebarForSymbol()
  // (which tv-volatility.js has wrapped so the volatility card rides along)
  // and refreshSeasonalsForSymbol(). Re-calling them would double every
  // per-symbol fetch those panels make, so they are only invoked here when
  // that tail did NOT run — i.e. the load failed or produced no candles.
  // ACPanels / ACTools belong to other agents and have no other call site,
  // so they are always fanned out to.
  function fanOutForSymbol(code, opts) {
    const dataLayerRefreshed = !!(opts && opts.dataLayerRefreshed);

    if (!dataLayerRefreshed) {
      if (typeof window.refreshSidebarForSymbol === 'function') {
        try { window.refreshSidebarForSymbol(code); } catch (e) { console.warn(TAG, 'refreshSidebarForSymbol', e); }
      }
      if (typeof window.refreshSeasonalsForSymbol === 'function') {
        try { window.refreshSeasonalsForSymbol(); } catch (e) { console.warn(TAG, 'refreshSeasonalsForSymbol', e); }
      }
      if (typeof window.refreshVolatilityForSymbol === 'function') {
        try { window.refreshVolatilityForSymbol(code); } catch (e) { console.warn(TAG, 'refreshVolatilityForSymbol', e); }
      }
    }

    if (window.ACPanels && typeof window.ACPanels.refreshAll === 'function') {
      try { window.ACPanels.refreshAll(code); } catch (e) { console.warn(TAG, 'ACPanels.refreshAll', e); }
    }
    if (window.ACTools && typeof window.ACTools.refreshAll === 'function') {
      try { window.ACTools.refreshAll(code); } catch (e) { console.warn(TAG, 'ACTools.refreshAll', e); }
    }

    // processChartData() retitles the page with candlestick.html's wording;
    // this page is the Advanced Chart, so the title is restored afterwards.
    if (dataLayerRefreshed) document.title = `${String(code).toUpperCase()} — Advanced Chart · DSE`;
  }

  // Hook the end of every successful parse. processChartData is a plain
  // top-level `function` in candlestick-data.js, so it lives on window and
  // loadData()'s bare call resolves through that same slot — wrapping the
  // property therefore intercepts the real call, no shared-file edit.
  function wrapProcessChartData() {
    if (window.__acProcessChartDataWrapped) return;
    const original = window.processChartData;
    if (typeof original !== 'function') {
      console.warn(TAG, 'processChartData() not found — panel fan-out on symbol load is disabled.');
      return;
    }
    window.__acProcessChartDataWrapped = true;
    window.processChartData = function (rows) {
      let out;
      try {
        out = original.apply(this, arguments);
      } finally {
        // Non-empty chartData is the reliable signal that processChartData
        // reached its tail (it returns early on an empty/invalid parse and
        // its catch() calls showError instead).
        const reached = (typeof chartData !== 'undefined' && Array.isArray(chartData) && chartData.length > 0);
        try { fanOutForSymbol(_currentCode || codeFromUrl(), { dataLayerRefreshed: reached }); }
        catch (e) { console.warn(TAG, 'fan-out', e); }
      }
      return out;
    };
  }

  // ── ?smEntryDate= / ?smFocus= ──────────────────────────────────
  // sm-trade-overlay.js reads every sm* param itself, at its own load time,
  // and paints through ACChart's overlay painters — so nothing has to be
  // forwarded to it. The one thing it cannot do here is focusTrade(): it
  // frames the trade by writing zoomLevel/panOffset, which this renderer
  // ignores. Same intent, expressed as a Lightweight Charts visible range.
  function indexForDate(displayData, dateStr) {
    if (!displayData || !displayData.length || !dateStr) return null;
    const target = String(dateStr).replace(/-/g, '/');
    let onOrBefore = -1;
    for (let i = 0; i < displayData.length; i++) {
      const d = String(displayData[i].Date).replace(/-/g, '/');
      if (d === target) return i;
      if (d <= target) onOrBefore = i;
    }
    return onOrBefore >= 0 ? onOrBefore : null;
  }

  function focusSuperModelTrade() {
    const qs = params();
    if (qs.get('smFocus') !== '1') return true;   // nothing to do — stop polling
    const entryDate = qs.get('smEntryDate');
    if (!entryDate) return true;
    if (!window.ACChart || !window.ACChart.ready()) return false;

    const data = window.ACChart.displayData();
    if (!data || !data.length) return false;

    const entryIdx = indexForDate(data, entryDate);
    if (entryIdx == null) return true;
    const exitIdx = qs.get('smExitDate')
      ? (indexForDate(data, qs.get('smExitDate')) ?? entryIdx)
      : entryIdx;

    // Same framing sm-trade-overlay.js aims for: the hold period plus
    // roughly equal breathing room either side, never fewer than 30 bars.
    const held = Math.max(1, exitIdx - entryIdx);
    const want = Math.max(30, Math.round(held * 2.2) + 20);
    const mid = (entryIdx + exitIdx) / 2;
    const from = Math.max(-2, mid - want / 2);
    const to = Math.min(data.length + 4, mid + want / 2);

    try {
      window.ACChart.chart().timeScale().setVisibleLogicalRange({ from, to });
      window.ACChart.computeLastRender();
      window.ACChart.repaintOverlay();
    } catch (e) {
      console.warn(TAG, 'smFocus', e);
    }
    return true;
  }

  function scheduleSuperModelFocus() {
    if (params().get('smFocus') !== '1') return;
    let tries = 0;
    const t = setInterval(() => {
      if (focusSuperModelTrade() || ++tries > 120) clearInterval(t);
    }, 50);
  }

  // ── The in-place symbol switch ─────────────────────────────────
  function loadSymbol(code, opts) {
    const upper = String(code || '').trim().toUpperCase();
    if (!upper) return;
    _currentCode = upper;

    resetChartState();
    closeTransientUI();
    applySymbolChrome(upper);
    showLoading(true);

    // The new symbol's history is a different length and price range, so
    // whatever viewport the previous one was left at is meaningless.
    if (window.ACChart && typeof window.ACChart.requestFit === 'function') window.ACChart.requestFit();

    // Instant feedback in the sidebar's watchlist / All-Shares rows while
    // the fetch is in flight; ac-sidebar.js owns that (pure DOM, no fetch).
    if (window.ACSidebar && typeof window.ACSidebar.markActiveSymbol === 'function') {
      window.ACSidebar.markActiveSymbol(upper);
    }

    if (typeof loadData !== 'function') {
      fatal('candlestick-data.js did not load — <code>loadData()</code> is undefined.');
      return;
    }

    // A tick of slack so the loading state actually paints and any modal
    // close handler above has settled, matching candlestick-ui.js's reload.
    if (opts && opts.immediate) loadData();
    else setTimeout(() => { try { loadData(); } catch (e) { fatal('Failed to start the data load: ' + escapeHtml(e.message)); } }, 0);
  }

  // The global stock-search.js, tv-sidebar.js's rows and company.js all
  // look for. Defined unconditionally here (ac-boot.js is last in the load
  // order, so this is the authoritative definition on this page).
  window.reloadChartForSymbol = function (symbol) {
    if (!symbol) return;
    const upper = String(symbol).trim().toUpperCase();
    if (!upper) return;

    // pushState (not replaceState): switching symbols is a navigation the
    // user expects Back to undo — see the popstate handler below.
    const url = new URL(window.location.href);
    url.searchParams.set('code', upper);
    // Every other param (timeframe, embed, the whole sm* trade set) is left
    // exactly as it was, so a Super Model trade link survives a symbol hop.
    if (url.toString() !== window.location.href) {
      window.history.pushState({ acCode: upper }, '', url.toString());
    }

    console.log(TAG, 'switching to', upper);
    loadSymbol(upper);
  };

  window.addEventListener('popstate', () => {
    const code = codeFromUrl();
    if (code === _currentCode) return;
    loadSymbol(code);
  });

  // ── Boot ───────────────────────────────────────────────────────
  function boot() {
    if (_booted) return;
    _booted = true;

    // 1 ── the CDN guard.
    if (typeof LightweightCharts === 'undefined') {
      fatal('Could not load <strong>Lightweight Charts</strong> from the CDN.<br/>'
          + 'Check the network connection (or a content blocker) and reload — '
          + 'the chart cannot render without it.');
      return;
    }
    // v5 is a hard requirement: v4 has addLineSeries()/series.setMarkers()
    // and no LineSeries/addPane, which ac-render.js and every ac-ind-* module
    // depend on. Fail loudly here rather than 40 stack traces deep.
    if (typeof LightweightCharts.LineSeries === 'undefined' || typeof LightweightCharts.CandlestickSeries === 'undefined') {
      fatal('The wrong <strong>Lightweight Charts</strong> build is loaded '
          + `(version <code>${escapeHtml(LightweightCharts.version ? LightweightCharts.version() : 'unknown')}</code>).<br/>`
          + 'This page needs <strong>v5</strong> — load '
          + '<code>lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js</code>.');
      return;
    }

    // 2 ── create the chart, then hang the overlay canvas on it.
    const container = document.getElementById('ac-chart-container');
    if (!container) {
      fatal('Chart container <code>#ac-chart-container</code> is missing from the page markup.');
      return;
    }
    if (!window.ACChart || typeof window.ACChart.create !== 'function') {
      fatal('<code>ac-render.js</code> did not load — <code>window.ACChart</code> is undefined.');
      return;
    }

    try {
      window.ACChart.create(container);
    } catch (e) {
      fatal('Lightweight Charts failed to initialise: ' + escapeHtml(e.message));
      return;
    }

    // autoSize gives a 0-height chart if the container has no height of its
    // own. Only a genuinely collapsed container is patched, and loudly, so
    // the real fix lands in advanced-chart.css instead of here.
    if (container.clientHeight < 80) {
      container.style.minHeight = '560px';
      console.warn(TAG, '#ac-chart-container had no height (clientHeight < 80px); applied an inline min-height:560px. '
                      + 'This belongs in advanced-chart.css.');
    }

    const overlay = document.getElementById('candleCanvas');
    if (overlay) {
      window.ACChart.attachOverlay(overlay);
    } else {
      console.warn(TAG, '#candleCanvas is missing — drawing tools, trade markers and the Super Model '
                      + 'trade overlay have nowhere to paint (tv-drawing-tools.js / tv-trade-markers.js / '
                      + 'sm-trade-overlay.js all look that id up).');
    }

    // 3 ── theme. ac-theme-bridge.js has already reconciled html.light-mode
    //      with html[data-theme]; this pushes the resulting tokens into LWC.
    try { window.ACChart.applyTheme(); } catch (e) { console.warn(TAG, 'applyTheme', e); }
    // Re-apply whenever the site theme changes from anywhere else. Only
    // claimed if nobody else has: ac-theme-bridge.js may own this hook.
    if (typeof window.__acApplyTheme !== 'function') {
      window.__acApplyTheme = function () {
        if (window.ACChart && window.ACChart.ready()) window.ACChart.applyTheme();
      };
    }

    // 4 ── data. loadData() reads ?code= itself and ends by calling
    //      drawChart(), setupChartInteractions(), updateInfoCards(),
    //      refreshSidebarForSymbol() and refreshSeasonalsForSymbol() —
    //      all of which are defined by files loaded before this one.
    wrapProcessChartData();

    const code = codeFromUrl();
    _currentCode = code;
    // Seed history state so the first Back out of a symbol switch has
    // something to return to instead of leaving the URL ahead of the chart.
    try { window.history.replaceState({ acCode: code }, '', window.location.href); } catch (e) {}

    applySymbolChrome(code);

    const missing = ['loadData', 'processChartData', 'attachIndicators']
      .filter((fn) => typeof window[fn] !== 'function');
    if (missing.length) {
      fatal('The shared data layer did not load — missing <code>' + missing.join('()</code>, <code>') + '()</code>.<br/>'
          + 'Check the <code>../candlestick_chart/candlestick-data.js</code> script tag.');
      return;
    }

    showLoading(true);
    try {
      loadData();
    } catch (e) {
      fatal('Failed to start the data load: ' + escapeHtml(e.message));
      return;
    }

    // 7 ── ?smFocus=1: frame the Super Model trade once the first render
    //      has produced displayData (sm-trade-overlay.js handles the rest).
    scheduleSuperModelFocus();

    console.log(TAG, 'ready —', code,
      '· timeframe', (typeof currentTimeframe !== 'undefined' ? currentTimeframe : '?'),
      '· LWC', (typeof LightweightCharts.version === 'function' ? LightweightCharts.version() : '?'));
  }

  // ── Public surface ─────────────────────────────────────────────
  window.ACBoot = {
    boot,
    booted: () => _booted,
    currentSymbol: () => _currentCode || codeFromUrl(),
    defaultSymbol: DEFAULT_SYMBOL,
    applySymbolChrome,
    refreshPanels: (code) => fanOutForSymbol(code || _currentCode || codeFromUrl(), { dataLayerRefreshed: false }),
    fatal,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})();
