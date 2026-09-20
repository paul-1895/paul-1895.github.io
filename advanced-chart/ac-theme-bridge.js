/* ════════════════════════════════════════════════════════════
   ac-theme-bridge.js
   Two theme conventions, one page.

   The Advanced Chart loads BOTH stylesheet families:

     candlestick_chart/candlestick-chart.css + tv-layout.css
        → DARK-DEFAULT, keyed on  html.light-mode / html.dark-mode,
          historically persisted under localStorage 'chartTheme'
          (default 'dark-mode').

     the rest of the site (theme/theme.js, shared/*.css, style.css)
        → LIGHT-DEFAULT, keyed on html[data-theme="light"|"dark"],
          persisted under localStorage 'dse-theme'.

   Neither can be dropped here, so this file keeps both live and in
   sync, in both directions, for the lifetime of the page:

     • html gets data-theme AND exactly one of .light-mode/.dark-mode
     • both localStorage keys are written on every change
     • a MutationObserver mirrors whichever representation a third
       party changed onto the other one

   Consumers that make this non-optional:
     tv-drawing-tools.js:126,1286  — branch on
       document.documentElement.classList.contains('light-mode')
     shared/display-settings.js    — writes data-theme, and has its own
       observer on [data-theme, class]
     candlestick-chart.css:28      — ":root.light-mode, :root[data-theme=light]"

   Loads VERY EARLY (before ac-render.js, before the chart CSS is read),
   so everything here is dependency-free and null-safe: window.ACChart
   does not exist yet, and neither does the chart container.

   Depends on : nothing
   Consumed by: ac-render.js (ACChart.applyTheme), advanced-chart.html's
                header toggle and ac-ui.js's toolbar, via acToggleTheme()
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Idempotent: a double <script> include must not install two observers.
  if (window.__acThemeBridge) return;

  var root = document.documentElement;

  var DSE_KEY = 'dse-theme';      // 'light' | 'dark'      — site-wide
  var CHART_KEY = 'chartTheme';   // 'light-mode' | 'dark-mode' — legacy chart key

  // Guards the observer against the mutations we make ourselves.
  var applying = false;
  var observer = null;

  // The theme we last asserted. The observer compares both representations
  // against this to work out which one a third party actually changed.
  var current = null;

  // True only while no explicit choice has ever been stored, in which case we
  // keep tracking the OS setting instead of freezing the first resolved value.
  var followSystem = false;

  // ── localStorage (private mode / disabled storage throws) ───────
  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { /* private mode */ }
  }

  // ── Normalisation ───────────────────────────────────────────────
  // Accepts either convention's spelling and returns 'light' | 'dark' | null.
  function normalize(v) {
    if (v === 'light' || v === 'light-mode') return 'light';
    if (v === 'dark' || v === 'dark-mode') return 'dark';
    return null;
  }

  function systemTheme() {
    try {
      if (window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
    } catch (e) { /* no matchMedia */ }
    // Last resort matches the chart shell's own default.
    return 'dark';
  }

  // What is currently painted on <html>, per representation.
  function attrTheme() { return normalize(root.getAttribute('data-theme')); }
  function classTheme() {
    if (root.classList.contains('light-mode')) return 'light';
    if (root.classList.contains('dark-mode')) return 'dark';
    return null;
  }

  function inAgreement(theme) {
    return attrTheme() === theme && classTheme() === theme;
  }

  // ── Resolution order (load time) ────────────────────────────────
  //   1. 'dse-theme'          — the site-wide key wins if present
  //   2. 'chartTheme'         — migrated forward (and kept in sync after)
  //   3. whatever is already painted on <html> — shared/display-settings.js
  //      runs ahead of us in <head> and may have forced a theme already
  //   4. the OS prefers-color-scheme
  function resolveInitial() {
    var t = normalize(lsGet(DSE_KEY));
    if (t) return t;

    t = normalize(lsGet(CHART_KEY));
    if (t) return t;                       // migration; persist() writes both keys

    t = attrTheme() || classTheme();
    if (t) return t;

    followSystem = true;
    return systemTheme();
  }

  // ── Write both representations onto <html> ──────────────────────
  // MutationObserver records are delivered in a microtask, so clearing the
  // guard synchronously after the writes would be too late — the callback
  // would still run, with applying already back to false. takeRecords()
  // drains the queue synchronously instead, which is what actually makes
  // the guard airtight.
  function paint(theme) {
    applying = true;
    try {
      if (root.getAttribute('data-theme') !== theme) {
        root.setAttribute('data-theme', theme);
      }
      if (theme === 'light') {
        root.classList.remove('dark-mode');
        root.classList.add('light-mode');
      } else {
        root.classList.remove('light-mode');
        root.classList.add('dark-mode');
      }
    } finally {
      if (observer) { try { observer.takeRecords(); } catch (e) { /* detached */ } }
      applying = false;
    }
  }

  function persist(theme) {
    lsSet(DSE_KEY, theme);
    lsSet(CHART_KEY, theme === 'light' ? 'light-mode' : 'dark-mode');
  }

  // ── Header / toolbar button chrome ──────────────────────────────
  // Both conventions' toggle buttons are updated, every lookup optional:
  //   #theme-icon / #theme-label       — theme/theme.js's header button
  //   .theme-icon-moon / .theme-icon-sun — candlestick.html's toolbar button
  // Icon and label advertise the theme the button switches TO, matching
  // theme/theme.js exactly.
  function paintButtons(theme) {
    var icon = document.getElementById('theme-icon');
    var label = document.getElementById('theme-label');
    if (icon) icon.textContent = theme === 'light' ? '🌙' : '☀️';
    if (label) label.textContent = theme === 'light' ? 'Dark' : 'Light';

    var moon = document.querySelector('.theme-icon-moon');
    var sun = document.querySelector('.theme-icon-sun');
    if (moon) moon.style.display = theme === 'light' ? 'none' : 'block';
    if (sun) sun.style.display = theme === 'light' ? 'block' : 'none';
  }

  // ── Tell the renderer ───────────────────────────────────────────
  // ACChart.applyTheme() re-reads the CSS tokens into the Lightweight Charts
  // options and re-runs drawChart(). It is a no-op before the chart exists,
  // and ACChart itself does not exist until ac-render.js has run — hence
  // both guards. Nothing else is dispatched from here.
  function notifyRenderer() {
    try {
      if (window.ACChart && typeof window.ACChart.applyTheme === 'function') {
        window.ACChart.applyTheme();
      }
    } catch (e) {
      console.warn('[AC theme] ACChart.applyTheme failed', e);
    }
  }

  // ── The one path every theme change goes through ────────────────
  function setTheme(next, opts) {
    next = normalize(next) || systemTheme();
    var explicit = !(opts && opts.fromSystem);
    if (explicit) followSystem = false;

    var changed = next !== current || !inAgreement(next);
    current = next;

    paint(next);
    if (explicit || !followSystem) persist(next);
    paintButtons(next);
    if (changed) notifyRenderer();
    return next;
  }

  function toggleTheme() {
    return setTheme(current === 'light' ? 'dark' : 'light');
  }

  // ── Keep the two representations mirrored ───────────────────────
  // Anything on the page may flip either one: shared/display-settings.js
  // writes [data-theme], the ported candlestick chrome writes .light-mode,
  // theme/theme.js writes [data-theme]. Whichever moved, mirror it onto the
  // other and write both keys.
  function installObserver() {
    if (typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(function (records) {
      if (applying) return;

      var sawAttr = false;
      var sawClass = false;
      for (var i = 0; i < records.length; i++) {
        if (records[i].attributeName === 'data-theme') sawAttr = true;
        else if (records[i].attributeName === 'class') sawClass = true;
      }

      var fromAttr = sawAttr ? attrTheme() : null;
      var fromClass = sawClass ? classTheme() : null;

      // The representation that no longer agrees with what we last asserted
      // is the one that was just changed.
      var next = null;
      if (fromClass && fromClass !== current) next = fromClass;
      else if (fromAttr && fromAttr !== current) next = fromAttr;

      if (!next) {
        // Nothing meaningful moved, but the two may still have drifted apart
        // (e.g. a stylesheet-driven class add, or .light-mode removed without
        // .dark-mode being added — candlestick-ui.js's applyTheme() does
        // exactly that). Re-assert without re-persisting or re-rendering.
        if (current && !inAgreement(current)) paint(current);
        return;
      }

      current = next;
      followSystem = false;
      paint(next);
      persist(next);
      paintButtons(next);
      notifyRenderer();
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  }

  // ── OS theme changes, while no explicit choice exists ───────────
  function watchSystem() {
    var mq;
    try { mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)'); }
    catch (e) { return; }
    if (!mq) return;
    var onChange = function () {
      if (!followSystem) return;
      setTheme(mq.matches ? 'dark' : 'light', { fromSystem: true });
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function') mq.addListener(onChange);
  }

  // ── shared/display-settings.js ──────────────────────────────────
  // 'dse-display-applied' fires whenever the user's display preferences are
  // (re)applied — accent, gain/loss colours, fonts, text scale. None of that
  // touches [data-theme], so the observer above never sees it, but every one
  // of those tokens is read by ACChart.colors(). Re-theme the chart.
  function watchDisplaySettings() {
    var onApplied = function () { notifyRenderer(); };
    try { document.addEventListener('dse-display-applied', onApplied); } catch (e) { /* no-op */ }
    // Belt and braces: the event is dispatched on document, but listening on
    // window too costs nothing and survives a future dispatch-target change.
    try { window.addEventListener('dse-display-applied', onApplied); } catch (e) { /* no-op */ }
  }

  // ── Another tab changed the theme ───────────────────────────────
  function watchStorage() {
    try {
      window.addEventListener('storage', function (ev) {
        if (!ev || (ev.key !== DSE_KEY && ev.key !== CHART_KEY)) return;
        var t = normalize(ev.newValue);
        if (t && t !== current) setTheme(t);
      });
    } catch (e) { /* no-op */ }
  }

  // ── Boot ────────────────────────────────────────────────────────
  installObserver();

  current = resolveInitial();
  paint(current);
  if (!followSystem) persist(current);

  watchSystem();
  watchDisplaySettings();
  watchStorage();

  // The button chrome and the renderer are not in the document yet at this
  // point in <head>. Re-run both once the DOM is up and once everything has
  // loaded; paintButtons() is a no-op when the buttons are absent and
  // ACChart.applyTheme() is a no-op until the chart exists, so extra calls
  // are free.
  function lateSync() {
    paintButtons(current);
    notifyRenderer();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lateSync);
  } else {
    lateSync();
  }
  window.addEventListener('load', lateSync);

  // ── Public API ──────────────────────────────────────────────────
  // acToggleTheme() is what advanced-chart.html's header button and
  // ac-ui.js's toolbar button call — both flow through setTheme(), so the
  // classes, the attribute, both storage keys, the button chrome and the
  // renderer all move together.
  window.acToggleTheme = toggleTheme;

  window.ACTheme = {
    get: function () { return current; },
    set: function (t) { return setTheme(t); },
    toggle: toggleTheme,
    isLight: function () { return current === 'light'; },
    // Force the two representations back into agreement without changing the
    // theme — for anything that rewrites html's class list wholesale.
    resync: function () { if (current) paint(current); return current; },
  };

  window.__acThemeBridge = true;
})();
