/* ════════════════════════════════════════════════════════════
   ac-sidebar.js
   Glue for the right-hand sidebar and the symbol search on the
   Advanced Chart page.

   ../candlestick_chart/tv-sidebar.js (the whole TradingView-style
   right sidebar) and ../candlestick_chart/stock-search.js (the
   symbol-search modal) are loaded here COMPLETELY UNMODIFIED.
   Neither needs a patch to work against this renderer — they only
   need (a) the DOM ids they look up at load time to exist, and
   (b) window.reloadChartForSymbol() to exist by the time someone
   clicks a row, which ac-boot.js guarantees. This file therefore
   does the four things that are genuinely missing:

     1. a load-time audit of every DOM id those modules require,
        reported with the file + line that reads it
     2. markActiveSymbol() — instant row highlight on a symbol
        switch, before the fetch that ac-boot.js kicks off lands
     3. a sidebar collapse toggle (tv-sidebar.js owns the *drag*
        resize; it has no collapse) and a hidden-tab pause fallback
        for the 60s live-price poll
     4. a mobile bottom-sheet for the right sidebar and the left
        drawing rail, which tv-layout.css simply display:none's
        below 1200px / 900px with no substitute UI

   Styling for (4) is injected from here as a single <style
   id="ac-sidebar-injected-styles"> block — advanced-chart.css
   belongs to another agent, so it is kept in one clearly-labelled
   place to be lifted out later.

   Depends on : ../candlestick_chart/tv-sidebar.js, stock-search.js,
                ac-boot.js (window.reloadChartForSymbol)
   Consumed by: ac-boot.js (window.ACSidebar.markActiveSymbol)
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  const TAG = '[ACSidebar]';

  /* ══════════════════════════════════════════════════════════════
     1 · Live-price poll: pause in a hidden tab
     ══════════════════════════════════════════════════════════════
     tv-sidebar.js:828 does

       if (window.DSESettings) window.DSESettings.everyRefresh(60_000, refreshLiveStocks);
       else setInterval(refreshLiveStocks, 60_000);

     /shared/display-settings.js is loaded in <head> on this page, so the
     first branch is what actually runs — and everyRefresh() ALREADY skips
     its tick while document.hidden (display-settings.js:774) and replays
     the missed one when the tab comes back. Nothing to do in that case.

     The fallback below only covers the case where DSESettings is absent
     (a stripped build, or the script failing to load), and it has to be
     installed before tv-sidebar.js runs to see the interval at all — see
     the load-order note logged in the audit.                             */
  const _longPollTimers = [];
  const LONG_POLL_MIN_MS = 30000;
  let _pollFallbackInstalled = false;

  if (!window.DSESettings && !window.__acLongPollGuard) {
    window.__acLongPollGuard = true;
    _pollFallbackInstalled = true;
    const nativeSetInterval = window.setInterval.bind(window);

    window.setInterval = function (fn, ms) {
      const args = Array.prototype.slice.call(arguments, 2);
      const id = nativeSetInterval.apply(null, [fn, ms].concat(args));
      if (typeof fn === 'function' && typeof ms === 'number' && ms >= LONG_POLL_MIN_MS) {
        _longPollTimers.push({ id, fn, ms, args, paused: false });
      }
      return id;
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        _longPollTimers.forEach((t) => {
          if (t.id == null) return;
          clearInterval(t.id);
          t.id = null;
          t.paused = true;
        });
      } else {
        _longPollTimers.forEach((t) => {
          if (!t.paused) return;
          t.paused = false;
          // Catch up on the tick the hidden tab skipped, the same way
          // DSESettings.everyRefresh() does, so data is never staler than
          // it would have been without the pause.
          try { t.fn(); } catch (e) { console.warn(TAG, 'poll catch-up', e); }
          t.id = nativeSetInterval.apply(null, [t.fn, t.ms].concat(t.args));
        });
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     2 · Injected styles  (AGENT 2: lift this into advanced-chart.css)
     ══════════════════════════════════════════════════════════════ */
  const INJECTED_STYLE_ID = 'ac-sidebar-injected-styles';

  const INJECTED_CSS = `
/* ──────────────────────────────────────────────────────────────
   Injected by advanced-chart/ac-sidebar.js.
   Everything here is the mobile bottom-sheet substitute for the two
   panels tv-layout.css:1145-1152 hides outright (.tv-right-sidebar
   below 1200px, .tv-left-rail below 900px), plus the sidebar
   collapse state. Safe to move into advanced-chart.css verbatim —
   nothing in it is computed at runtime.
   ────────────────────────────────────────────────────────────── */

/* Floating triggers. Hidden entirely at desktop widths, where both
   panels are on screen already. */
.ac-mobile-fabs {
  position: fixed;
  right: 14px;
  bottom: 14px;
  bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  z-index: 950;
  display: none;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.ac-mobile-fabs > * { pointer-events: auto; }

.ac-fab {
  width: 46px;
  height: 46px;
  display: none;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border, rgba(255,255,255,0.12));
  border-radius: 50%;
  background: var(--bg-card, #11161f);
  color: var(--text-secondary, #8a93a6);
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0,0,0,0.35);
  transition: color 0.15s, border-color 0.15s, transform 0.12s;
}
.ac-fab:hover,
.ac-fab[aria-expanded="true"] {
  color: var(--accent, #1a5cff);
  border-color: var(--accent, #1a5cff);
}
.ac-fab:active { transform: scale(0.94); }
.ac-fab svg { width: 21px; height: 21px; }

@media (max-width: 1200px) {
  .ac-mobile-fabs { display: flex; }
  .ac-fab[data-sheet="sidebar"] { display: flex; }
}
@media (max-width: 900px) {
  .ac-fab[data-sheet="tools"] { display: flex; }
}

/* Scrim behind an open sheet. */
.ac-sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: 960;
  background: rgba(0,0,0,0.55);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}
html.ac-sheet-open .ac-sheet-scrim { opacity: 1; pointer-events: auto; }
html.ac-sheet-open body { overflow: hidden; }

@keyframes ac-sheet-rise { from { transform: translateY(100%); } to { transform: translateY(0); } }

/* Shared sheet chrome — the grab handle is a pseudo-element so no extra
   markup has to be injected into either shared panel. */
html.ac-sheet-open .ac-sheet-panel::before {
  content: '';
  position: absolute;
  top: 10px;
  left: 50%;
  width: 40px;
  height: 4px;
  margin-left: -20px;
  border-radius: 2px;
  background: var(--border, rgba(255,255,255,0.22));
}

/* The right sidebar as a bottom sheet. Overrides tv-layout.css:310-318
   (sticky, fixed-width flex child) and :1146 (display:none). */
@media (max-width: 1200px) {
  html.ac-sheet-sidebar .tv-right-sidebar {
    display: flex !important;
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    top: auto !important;
    width: auto !important;
    flex: 0 0 auto !important;
    max-height: 84vh !important;
    max-height: 84dvh !important;
    z-index: 970;
    background: var(--bg-card, #11161f);
    border-top: 1px solid var(--border, rgba(255,255,255,0.12));
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -18px 44px rgba(0,0,0,0.5);
    padding: 26px 0 env(safe-area-inset-bottom, 0px);
    animation: ac-sheet-rise 0.2s ease-out;
    overflow: hidden;
  }
  html.ac-sheet-sidebar .tv-sidebar-panels { padding: 0 10px 12px; }
  /* The sheet is narrower than the desktop sidebar, so the watchlist's
     persisted symbol-column width (tv-sidebar.js:703, written inline on
     .tv-watchlist) pushes the Vol column past .tv-watchlist's
     overflow:hidden edge. Narrow it for the sheet only — !important to
     beat that inline custom property; the saved width is untouched. */
  html.ac-sheet-sidebar .tv-watchlist { --tv-wl-col1: 72px !important; }
  html.ac-sheet-sidebar .tv-right-rail {
    margin-left: 6px;
    border-radius: 0;
    align-self: stretch;
    overflow-y: auto;
  }
  /* The drag handle between chart and sidebar is meaningless in a sheet. */
  html.ac-sheet-sidebar .tv-col-resizer { display: none !important; }
}

/* The left drawing rail as a bottom sheet — laid out as a wrapping row
   rather than the desktop column, so it reads as a tool palette.
   Overrides tv-layout.css:68-78 and :1151. */
@media (max-width: 900px) {
  html.ac-sheet-tools .tv-left-rail {
    display: flex !important;
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    top: auto !important;
    width: auto !important;
    flex: 0 0 auto !important;
    flex-direction: row !important;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 6px;
    max-height: 56vh;
    overflow-y: auto;
    z-index: 970;
    border-right: none;
    border-top: 1px solid var(--border, rgba(255,255,255,0.12));
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -18px 44px rgba(0,0,0,0.5);
    padding: 28px 10px calc(10px + env(safe-area-inset-bottom, 0px));
    animation: ac-sheet-rise 0.2s ease-out;
  }
  /* .tv-rail-sep is a horizontal divider on desktop; make it vertical so a
     wrapped row still reads as grouped. */
  html.ac-sheet-tools .tv-left-rail .tv-rail-sep {
    width: 1px;
    height: 24px;
    margin: 0 2px;
  }
  /* tv-drawing-tools.js positions the flyouts absolutely against their
     trigger, which lands off-screen once the rail is a bottom sheet.
     Re-anchor them as a centred fixed panel (display: is left alone, that
     is the JS's open/closed state). */
  html.ac-sheet-tools .tv-tool-flyout,
  html.ac-sheet-tools .tv-emoji-flyout {
    position: fixed !important;
    left: 10px !important;
    right: 10px !important;
    top: 8vh !important;
    bottom: auto !important;
    width: auto !important;
    max-height: 60vh !important;
    overflow-y: auto !important;
    z-index: 980 !important;
  }
}

/* Desktop: sidebar collapsed to its icon rail. Width is the same
   rail-only figure sm-trade-overlay.js uses when embedding the page.
   !important is load-bearing: tv-sidebar.js:764 writes --tv-sidebar-width
   as an INLINE style on .tv-page-shell when the split is dragged, and a
   normal rule here would lose to it. The user's dragged width is untouched
   in the inline style, so it comes straight back on expand. */
html.ac-sidebar-collapsed .tv-page-shell { --tv-sidebar-width: 68px !important; }
html.ac-sidebar-collapsed .tv-sidebar-panels { display: none; }
html.ac-sidebar-collapsed .tv-right-rail { margin-left: 0; }
`;

  function injectStyles() {
    if (document.getElementById(INJECTED_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = INJECTED_STYLE_ID;
    style.textContent = INJECTED_CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════════
     3 · DOM audit
     ══════════════════════════════════════════════════════════════
     Every id the unmodified shared sidebar modules look up, with the file
     and line that reads it, so a missing container is reported as a markup
     gap rather than showing up later as a silently dead panel. */
  const REQUIRED_DOM = [
    // tv-sidebar.js reads all of these at IIFE-eval time (lines 18-29) and
    // bails outright unless at least one of the five `critical` ones exists.
    { id: 'tvWatchlistBody',         src: 'tv-sidebar.js:18',  critical: true,  note: 'watchlist rows' },
    { id: 'tvSymbolInfo',            src: 'tv-sidebar.js:19',  critical: true,  note: 'symbol info card (also railDetailsBtn target)' },
    { id: 'tvNewsBody',              src: 'tv-sidebar.js:20',  critical: true,  note: 'related news' },
    { id: 'tvMfHoldersBody',         src: 'tv-sidebar.js:21',  critical: true,  note: 'mutual-fund holders' },
    { id: 'tvAllSharesBody',         src: 'tv-sidebar.js:27',  critical: true,  note: 'All Shares board' },
    { id: 'mfPortfolioBtn',          src: 'tv-sidebar.js:22',  note: 'rail link, shown only for MF symbols' },
    { id: 'tvBankDetails',           src: 'tv-sidebar.js:23',  note: 'bank details panel (/shared/bank-rows.js)' },
    { id: 'tvBankDetailsBody',       src: 'tv-sidebar.js:24',  note: 'bank details rows' },
    { id: 'tvBankDetailsOpen',       src: 'tv-sidebar.js:25',  note: '"Full grid" link' },
    { id: 'railBankDetailsBtn',      src: 'tv-sidebar.js:26',  note: 'bank details rail toggle' },
    { id: 'tvAllSharesSectorSelect', src: 'tv-sidebar.js:28',  note: 'All Shares sector filter' },
    { id: 'tvAllSharesSearch',       src: 'tv-sidebar.js:29',  note: 'All Shares free-text filter' },
    // wireRailToggle(btnId, panelId) — needs BOTH or the toggle silently no-ops.
    { id: 'railWatchlistBtn',        src: 'tv-sidebar.js:652', note: 'toggles #tvWatchlist' },
    { id: 'tvWatchlist',             src: 'tv-sidebar.js:652', note: 'watchlist panel (also the col-resize host)' },
    { id: 'railAllSharesBtn',        src: 'tv-sidebar.js:653', note: 'toggles #tvAllShares' },
    { id: 'tvAllShares',             src: 'tv-sidebar.js:653', note: 'All Shares panel' },
    { id: 'railDetailsBtn',          src: 'tv-sidebar.js:654', note: 'toggles #tvSymbolInfo' },
    { id: 'railNewsBtn',             src: 'tv-sidebar.js:655', note: 'toggles #tvNewsPanel' },
    { id: 'tvNewsPanel',             src: 'tv-sidebar.js:655', note: 'news panel' },
    { id: 'railMfHoldersBtn',        src: 'tv-sidebar.js:656', note: 'toggles #tvMfHolders' },
    { id: 'tvMfHolders',             src: 'tv-sidebar.js:656', note: 'MF holders panel' },
    // Resizers.
    { id: 'tvWlColResizer',          src: 'tv-sidebar.js:670', note: 'watchlist symbol-column drag handle' },
    { id: 'tvColResizer',            src: 'tv-sidebar.js:739', note: 'chart/sidebar column drag handle' },
    // tv-volatility.js wraps refreshSidebarForSymbol; it bails without its body.
    { id: 'tvVolatilityBody',        src: 'tv-volatility.js:22',  note: 'volatility card — file is inert without it' },
    { id: 'tvVolatilityPanel',       src: 'tv-volatility.js:607', note: 'toggled by railVolatilityBtn' },
    { id: 'railVolatilityBtn',       src: 'tv-volatility.js:607', note: 'volatility rail toggle' },
    // ac-screener-membership.js wraps refreshSidebarForSymbol; it bails without its body.
    { id: 'tvScreenerMembershipBody', src: 'ac-screener-membership.js:37',  note: 'screener membership list — file is inert without it' },
    { id: 'tvScreenerMembership',     src: 'ac-screener-membership.js:298', note: 'toggled by railScreenerMembershipBtn' },
    { id: 'railScreenerMembershipBtn',src: 'ac-screener-membership.js:298', note: 'screener membership rail toggle' },
    // tv-seasonals-ui.js bails without both.
    { id: 'seasonalsToggleBtn',      src: 'tv-seasonals-ui.js:29', note: 'seasonals rail button — file is inert without it' },
    { id: 'tvSeasonalsPanel',        src: 'tv-seasonals-ui.js:30', note: 'seasonals panel' },
    // candlestick-data.js's processChartData() tail + showError().
    { id: 'loadingState',            src: 'candlestick-data.js:662,693', critical: true, note: 'loading + error surface (ac-boot.js writes fatals here)' },
    { id: 'candleCanvas',            src: 'candlestick-data.js:663',     critical: true, note: 'overlay canvas — drawings / trade markers / sm-trade-overlay paint into it' },
    { id: 'tvTicker',                src: 'candlestick-data.js:651',     note: 'toolbar ticker; needs class .tv-ticker too (stock-search.js:123)' },
    { id: 'headerLogoTag',           src: 'candlestick-data.js:67',      note: 'header logo pill' },
    { id: 'headerCompanyProfileLink',src: 'candlestick-data.js:657',     note: 'header Company Profile link' },
    { id: 'researchReportBtn',       src: 'candlestick-data.js:659',     note: 'rail Research Report link' },
  ];

  const REQUIRED_SELECTORS = [
    { sel: '.tv-page-shell',     src: 'tv-sidebar.js:740',   note: 'the column-resize handle writes --tv-sidebar-width on it; sm-trade-overlay.js:83 too' },
    { sel: '.tv-right-sidebar',  src: 'tv-layout.css:310',   note: 'the sidebar column itself' },
    { sel: '.tv-sidebar-panels', src: 'tv-layout.css:320',   note: 'internal scroll container for the panels' },
    { sel: '.tv-left-rail',      src: 'tv-layout.css:68',    note: 'drawing-tools rail (tv-drawing-tools.js binds inside it)' },
    { sel: '.tv-ticker',         src: 'stock-search.js:123', note: 'click target that opens the symbol-search modal' },
  ];

  const audit = { missingIds: [], missingSelectors: [], notes: [] };

  function runAudit() {
    // Rebuilt from scratch every pass — init() runs it twice (once at
    // DOMContentLoaded, once after stock-search.js's 500ms modal timer and
    // ac-boot.js have both had their turn), and a note from the early pass
    // would otherwise linger after the thing it flagged had appeared.
    audit.notes = [];
    audit.missingIds = REQUIRED_DOM.filter(r => !document.getElementById(r.id));
    audit.missingSelectors = REQUIRED_SELECTORS.filter(r => !document.querySelector(r.sel));

    const criticalMissing = audit.missingIds.filter(r => r.critical);

    if (!audit.missingIds.length && !audit.missingSelectors.length) {
      console.log(TAG, 'DOM audit: every id tv-sidebar.js / tv-volatility.js / tv-seasonals-ui.js / '
                     + 'stock-search.js / candlestick-data.js looks up is present.');
    } else {
      console.groupCollapsed(`${TAG} DOM audit — ${audit.missingIds.length} id(s) + `
                           + `${audit.missingSelectors.length} selector(s) missing`
                           + (criticalMissing.length ? ` (${criticalMissing.length} CRITICAL)` : ''));
      audit.missingIds.forEach((r) => {
        console[r.critical ? 'error' : 'warn'](
          `${r.critical ? 'CRITICAL ' : ''}#${r.id} — read by ${r.src} — ${r.note}`);
      });
      audit.missingSelectors.forEach((r) => {
        console.warn(`${r.sel} — expected by ${r.src} — ${r.note}`);
      });
      console.groupEnd();
    }

    // The single most consequential failure mode: tv-sidebar.js:30 bails out
    // of its whole IIFE unless one of the five critical bodies exists, and
    // then window.refreshSidebarForSymbol is never defined at all, so
    // processChartData()'s tail call is a silent no-op forever.
    if (typeof window.refreshSidebarForSymbol !== 'function') {
      audit.notes.push('window.refreshSidebarForSymbol is undefined — tv-sidebar.js bailed at its line-30 guard '
                     + '(none of #tvWatchlistBody / #tvSymbolInfo / #tvNewsBody / #tvMfHoldersBody / #tvAllSharesBody found), '
                     + 'or the script tag is missing.');
      console.error(TAG, audit.notes[audit.notes.length - 1]);
    }
    if (typeof window.reloadChartForSymbol !== 'function') {
      audit.notes.push('window.reloadChartForSymbol is undefined — ac-boot.js did not run; '
                     + 'symbol clicks in the watchlist / All Shares / search modal will do nothing.');
      console.error(TAG, audit.notes[audit.notes.length - 1]);
    }
    if (typeof window.BANK_ROWS === 'undefined') {
      audit.notes.push('/shared/bank-rows.js is not loaded — the Bank Details panel will render empty '
                     + '(tv-sidebar.js:533 maps over window.BANK_ROWS).');
      console.warn(TAG, audit.notes[audit.notes.length - 1]);
    }
    if (!document.getElementById('stockSearchModal')) {
      audit.notes.push('stock-search.js has not injected #stockSearchModal yet (it does so ~500ms after '
                     + 'DOMContentLoaded); its markup needs candlestick_chart/stock-search.css + the .modal rules '
                     + 'from candlestick-chart.css to be styled.');
    }
    if (_pollFallbackInstalled && !_longPollTimers.length) {
      audit.notes.push('The hidden-tab poll-pause fallback saw no long interval — either window.DSESettings is '
                     + 'handling it (normal), or ac-sidebar.js is loaded AFTER tv-sidebar.js and missed its '
                     + 'setInterval. Load ac-sidebar.js before tv-sidebar.js if the fallback is needed.');
    }
  }

  /* ══════════════════════════════════════════════════════════════
     4 · Instant row highlight on symbol switch
     ══════════════════════════════════════════════════════════════
     tv-sidebar.js only re-stamps `.active` when it re-renders, which happens
     at the END of the fetch chain (processChartData → refreshSidebarForSymbol).
     This is the cheap DOM-only half, called by ac-boot.js the moment the
     user picks a symbol, so the click feels instant. */
  function markActiveSymbol(code) {
    const want = String(code || '').trim().toUpperCase();
    if (!want) return;
    document.querySelectorAll('.tv-wl-row, .tv-as-row').forEach((row) => {
      const rowCode = String(row.dataset.code || '').toUpperCase();
      row.classList.toggle('active', rowCode === want);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     5 · Sidebar collapse (desktop)
     ══════════════════════════════════════════════════════════════
     tv-sidebar.js:737-793 owns the DRAG resize of the chart/sidebar split
     and persists it as tvSidebarWidth — that needs nothing from this file.
     What it has no equivalent of is a collapse: double-clicking the same
     handle folds the panels away and leaves the icon rail, which is the one
     gesture a TradingView user reaches for. Persisted alongside it. */
  function applyCollapsed(on) {
    document.documentElement.classList.toggle('ac-sidebar-collapsed', !!on);
    if (typeof _savePref === 'function') _savePref('acSidebarCollapsed', !!on);
    // The chart column grows/shrinks with it; LWC's autoSize catches the
    // container resize, the overlay canvas and _lastRender do not.
    requestAnimationFrame(() => {
      if (!window.ACChart || !window.ACChart.ready()) return;
      window.ACChart.sizeOverlay();
      window.ACChart.computeLastRender();
      window.ACChart.repaintOverlay();
    });
  }

  function wireCollapse() {
    const resizer = document.getElementById('tvColResizer');
    if (!resizer) return;
    resizer.title = 'Drag to resize · double-click to collapse';
    resizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      applyCollapsed(!document.documentElement.classList.contains('ac-sidebar-collapsed'));
    });
    const saved = (typeof _loadPref === 'function') ? _loadPref('acSidebarCollapsed', false) : false;
    if (saved) applyCollapsed(true);
  }

  /* ══════════════════════════════════════════════════════════════
     6 · Mobile bottom sheets
     ══════════════════════════════════════════════════════════════ */
  const SHEETS = {
    sidebar: {
      cls: 'ac-sheet-sidebar',
      target: () => document.querySelector('.tv-right-sidebar'),
      label: 'Watchlist & symbol panels',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
          + '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="14" y1="4" x2="14" y2="20"/>'
          + '<line x1="17" y1="9" x2="18" y2="9"/><line x1="17" y1="13" x2="18" y2="13"/></svg>',
    },
    tools: {
      cls: 'ac-sheet-tools',
      target: () => document.querySelector('.tv-left-rail'),
      label: 'Drawing tools',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
          + '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>',
    },
  };

  let _openSheet = null;
  let _scrimEl = null;
  const _fabEls = {};

  function closeSheet() {
    if (!_openSheet) return;
    const spec = SHEETS[_openSheet];
    const el = spec.target();
    if (el) el.classList.remove('ac-sheet-panel');
    document.documentElement.classList.remove('ac-sheet-open', spec.cls);
    if (_scrimEl) _scrimEl.hidden = true;
    if (_fabEls[_openSheet]) _fabEls[_openSheet].setAttribute('aria-expanded', 'false');
    _openSheet = null;
  }

  function openSheet(name) {
    const spec = SHEETS[name];
    if (!spec) return;
    const el = spec.target();
    if (!el) { console.warn(TAG, `cannot open the ${name} sheet — its panel is not in the markup`); return; }
    if (_openSheet === name) { closeSheet(); return; }
    closeSheet();
    el.classList.add('ac-sheet-panel');
    document.documentElement.classList.add('ac-sheet-open', spec.cls);
    if (_scrimEl) _scrimEl.hidden = false;
    if (_fabEls[name]) _fabEls[name].setAttribute('aria-expanded', 'true');
    _openSheet = name;
  }

  function buildMobileTriggers() {
    if (document.getElementById('acMobileFabs')) return;

    _scrimEl = document.createElement('div');
    _scrimEl.className = 'ac-sheet-scrim';
    _scrimEl.id = 'acSheetScrim';
    _scrimEl.hidden = true;
    _scrimEl.addEventListener('click', closeSheet);
    document.body.appendChild(_scrimEl);

    const wrap = document.createElement('div');
    wrap.className = 'ac-mobile-fabs';
    wrap.id = 'acMobileFabs';

    // Tools first so it sits above the sidebar button in the stack.
    ['tools', 'sidebar'].forEach((name) => {
      const spec = SHEETS[name];
      if (!spec.target()) return;   // no panel in the markup → no trigger
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-fab';
      btn.id = name === 'tools' ? 'acToolsFab' : 'acSidebarFab';
      btn.dataset.sheet = name;
      btn.title = spec.label;
      btn.setAttribute('aria-label', spec.label);
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = spec.icon;
      btn.addEventListener('click', () => openSheet(name));
      wrap.appendChild(btn);
      _fabEls[name] = btn;
    });

    if (!wrap.children.length) return;
    document.body.appendChild(wrap);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _openSheet) { e.stopPropagation(); closeSheet(); }
    });

    // Picking a symbol inside the sheet means the user is done with it.
    const sidebarEl = SHEETS.sidebar.target();
    if (sidebarEl) {
      sidebarEl.addEventListener('click', (e) => {
        if (_openSheet === 'sidebar' && e.target.closest('.tv-wl-row, .tv-as-row')) closeSheet();
      });
    }
    // Same for picking a drawing tool — but not for the group buttons, which
    // only open a flyout, nor the magnet/lock/hide toggles (no data-tool).
    const railEl = SHEETS.tools.target();
    if (railEl) {
      railEl.addEventListener('click', (e) => {
        if (_openSheet !== 'tools') return;
        const tool = e.target.closest('[data-tool]');
        if (tool && !tool.hasAttribute('data-flyout')) closeSheet();
      });
    }

    // Back above the breakpoint the real panels are on screen again, so a
    // sheet left open would double them up.
    if (window.matchMedia) {
      const wide = window.matchMedia('(min-width: 1201px)');
      const midWide = window.matchMedia('(min-width: 901px)');
      const onChange = () => {
        if (_openSheet === 'sidebar' && wide.matches) closeSheet();
        if (_openSheet === 'tools' && midWide.matches) closeSheet();
      };
      (wide.addEventListener ? wide.addEventListener('change', onChange) : wide.addListener(onChange));
      (midWide.addEventListener ? midWide.addEventListener('change', onChange) : midWide.addListener(onChange));
    }
  }

  /* ══════════════════════════════════════════════════════════════
     7 · reloadChartForSymbol safety net
     ══════════════════════════════════════════════════════════════
     stock-search.js:272 prefers window.reloadChartForSymbol and otherwise
     falls back to a code path written for the canvas renderer (it pokes
     zoomLevel / panOffset / vZoomLevel, which mean nothing here). ac-boot.js
     defines the global, so that fallback never runs — this only covers
     ac-boot.js having failed outright, in which case a real navigation is
     better than a dead click. Installed late and only if still missing, so
     it can never shadow ac-boot.js's definition. */
  function installReloadFallback() {
    if (typeof window.reloadChartForSymbol === 'function') return;
    console.warn(TAG, 'window.reloadChartForSymbol was never defined — installing a navigation fallback. '
                    + 'ac-boot.js should own this global.');
    window.reloadChartForSymbol = function (symbol) {
      if (!symbol) return;
      const url = new URL(window.location.href);
      url.searchParams.set('code', String(symbol).trim().toUpperCase());
      window.location.assign(url.toString());
    };
  }

  /* ══════════════════════════════════════════════════════════════
     Init
     ══════════════════════════════════════════════════════════════ */
  function init() {
    injectStyles();
    buildMobileTriggers();
    wireCollapse();
    runAudit();
    // stock-search.js builds its modal on a 500ms timer, and ac-boot.js
    // defines reloadChartForSymbol on DOMContentLoaded — re-check after both.
    setTimeout(() => { installReloadFallback(); runAudit(); }, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.ACSidebar = {
    markActiveSymbol,
    openSheet,
    closeSheet,
    openSheetName: () => _openSheet,
    setCollapsed: applyCollapsed,
    collapsed: () => document.documentElement.classList.contains('ac-sidebar-collapsed'),
    audit,
    runAudit,
    injectedStyleId: INJECTED_STYLE_ID,
  };

})();
