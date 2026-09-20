/* ════════════════════════════════════════════════════════════
   ac-range-bar.js
   The bottom range / scrub bar for the Advanced Chart page.

   candlestick_chart/tv-range-bar.js is only 95 lines but every one
   of them is canvas-coupled: it measures #candleCanvas and writes
   the hand-rolled zoomLevel / panOffset globals. Lightweight Charts
   owns the viewport here, so this is a reimplementation rather than
   a port. What carries over is the public name — window.applyTVRange
   — and the #tvRangeButtons / #tvRangeDateTime markup contract.

   What it adds over the old bar: a miniature of the whole dataset
   with a draggable / resizable selection window, TradingView-style.
   Drag the middle to pan, drag an edge to zoom; both funnel into
   chart.timeScale().setVisibleLogicalRange().

   Everything is expressed in LWC *logical* units (fractional bar
   indices into ACChart.displayData()), which is also what the
   miniature is drawn from — so the selection stays aligned through
   timeframe switches, Heikin-Ashi / Renko transforms and the replay
   slice with no extra bookkeeping.

   Depends on : ac-render.js (ACChart), candlestick-data.js (chartData /
                aggregatedData, only as a fallback for the date math)
   Owns       : window.applyTVRange, window.ACRangeBar
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  if (window.__acRangeBarLoaded) return;
  window.__acRangeBarLoaded = true;

  // Superset of the buttons the task asks for: 1D/5D are kept because
  // tv-range-bar.js accepted them and applyTVRange() is a public name.
  const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'];
  const BAR_COUNTS = { '1D': 1, '5D': 5 };
  const MONTHS_BACK = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '5Y': 60 };

  const MINI_H = 44;
  const HANDLE_HIT = 7;      // px either side of an edge that grabs it
  const MIN_SPAN = 3;        // never zoom tighter than 3 bars
  const MIN_SEL_PX = 12;     // keep a zoomed-in window wide enough to grab
  const EDGES_FROM_PX = 18;  // below this the whole selection pans — see hitMode

  // ── DOM refs, resolved at mount ────────────────────────────────
  let hostEl = null;         // the whole range bar
  let buttonsEl = null;      // #tvRangeButtons
  let dateTimeEl = null;     // #tvRangeDateTime
  let miniEl = null;         // positioned wrapper for canvas + selection
  let canvasEl = null;
  let selEl = null;
  let mounted = false;
  let createdHost = false;   // true when the markup did not ship a container

  const $ = id => document.getElementById(id);

  function ready() {
    return !!(window.ACChart && typeof window.ACChart.ready === 'function' && window.ACChart.ready());
  }
  function ts() {
    try { return window.ACChart.chart().timeScale(); } catch (e) { return null; }
  }
  function data() {
    try { return (window.ACChart && window.ACChart.displayData()) || []; } catch (e) { return []; }
  }
  function colors() {
    try { return window.ACChart.colors(); } catch (e) {
      return { accent: '#00f5c4', grid: 'rgba(255,255,255,.08)', text: '#8a93a6', textMuted: '#6b7280', bg: '#0d1117' };
    }
  }
  function alpha(c, a) {
    try { return window.ACChart.alpha(c, a); } catch (e) { return c; }
  }

  // ════════════════════════════════════════════════════════════
  // Styles
  // ════════════════════════════════════════════════════════════
  // Only the miniature is new; .tv-range-bar / .tv-range-btn already exist in
  // candlestick_chart/tv-layout.css. The .ac-rb-* rules below are scoped so
  // they cannot collide with anything another agent ships, and the button
  // fallbacks only bite if tv-layout.css is not on the page.
  const STYLE_ID = 'ac-range-bar-style';
  function injectStyles() {
    if ($(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.ac-range-bar { display:flex; flex-direction:column; align-items:stretch; gap:6px; padding:8px 4px 10px; }
.ac-rb-top { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; width:100%; }
.ac-rb-btn { font-size:12px; font-weight:600; color:var(--text-secondary,#8a93a6); background:transparent;
  border:1px solid transparent; border-radius:var(--radius-sm,4px); padding:5px 10px; cursor:pointer; transition:all .15s; }
.ac-rb-btn:hover { background:var(--bg-hover,rgba(255,255,255,.06)); color:var(--text-primary,#e6edf3); }
.ac-rb-btn.active { background:var(--accent,#00f5c4); color:var(--bg-primary,#0d1117); }
.ac-rb-mini { position:relative; height:${MINI_H}px; width:100%; border:1px solid var(--border,rgba(255,255,255,.08));
  border-radius:var(--radius-sm,4px); overflow:hidden; cursor:crosshair; touch-action:none; user-select:none; }
.ac-rb-mini canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
.ac-rb-sel { position:absolute; top:0; bottom:0; left:0; width:0;
  border-left:1px solid var(--accent,#00f5c4); border-right:1px solid var(--accent,#00f5c4);
  background:rgba(127,127,127,.001); cursor:grab; box-sizing:border-box; }
.ac-rb-sel.dragging { cursor:grabbing; }
.ac-rb-handle { position:absolute; top:0; bottom:0; width:7px; cursor:ew-resize; }
.ac-rb-handle.l { left:-3px; } .ac-rb-handle.r { right:-3px; }
.ac-rb-sel.narrow .ac-rb-handle { display:none; }
.ac-rb-handle::after { content:''; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:2px; height:14px; border-radius:1px; background:var(--accent,#00f5c4); opacity:.9; }
@media (max-width:640px){ .ac-rb-mini{ height:32px; } .ac-rb-btn{ padding:4px 7px; font-size:11px; } }
`;
    (document.head || document.documentElement).appendChild(s);
  }

  // ════════════════════════════════════════════════════════════
  // Mount
  // ════════════════════════════════════════════════════════════
  function findHost() {
    return $('ac-range-bar') || $('acRangeBar') || $('tvRangeBar') || null;
  }

  function createHost() {
    const el = document.createElement('div');
    el.id = 'acRangeBar';
    el.className = 'tv-range-bar ac-range-bar';

    const container = ready() ? window.ACChart.container() : ($('ac-chart-container') || null);
    const wrap = (container && container.closest)
      ? (container.closest('.ac-chart-wrap') || container.parentElement)
      : null;

    if (wrap && wrap.parentElement) wrap.parentElement.insertBefore(el, wrap.nextSibling);
    else if (container && container.parentElement) container.parentElement.appendChild(el);
    else (document.querySelector('main') || document.body).appendChild(el);

    createdHost = true;
    return el;
  }

  function buildInner() {
    // Re-use whatever the markup already shipped; only fill the gaps.
    // advanced-chart.html ships #tvRangeButtons + #tvRangeDateTime as direct
    // children of a row-flex #tvRangeBar. Adding the miniature underneath means
    // the bar becomes a column, so those two get re-parented into their own row
    // first — otherwise they would stack on top of each other.
    buttonsEl = $('tvRangeButtons');
    dateTimeEl = $('tvRangeDateTime');

    let top = hostEl.querySelector('.ac-rb-top');
    if (!top) {
      top = document.createElement('div');
      top.className = 'ac-rb-top';
      hostEl.insertBefore(top, hostEl.firstChild);
    }
    if (buttonsEl && buttonsEl.parentElement === hostEl) top.appendChild(buttonsEl);
    if (dateTimeEl && dateTimeEl.parentElement === hostEl) top.appendChild(dateTimeEl);

    if (!buttonsEl) {
      buttonsEl = document.createElement('div');
      buttonsEl.id = 'tvRangeButtons';
      buttonsEl.className = 'tv-range-buttons';
      buttonsEl.innerHTML = RANGES.map(r =>
        `<button type="button" class="tv-range-btn ac-rb-btn${r === 'All' ? ' active' : ''}" data-range="${r}">${r}</button>`
      ).join('');
      top.appendChild(buttonsEl);
    }
    if (!dateTimeEl) {
      dateTimeEl = document.createElement('div');
      dateTimeEl.id = 'tvRangeDateTime';
      dateTimeEl.className = 'tv-range-datetime';
      dateTimeEl.textContent = '—';
      top.appendChild(dateTimeEl);
    }

    miniEl = hostEl.querySelector('.ac-rb-mini') || $('acRangeMini');
    if (!miniEl) {
      miniEl = document.createElement('div');
      miniEl.id = 'acRangeMini';
      miniEl.className = 'ac-rb-mini';
      hostEl.appendChild(miniEl);
    }
    if (!canvasEl) {
      canvasEl = document.createElement('canvas');
      canvasEl.id = 'acRangeCanvas';
      miniEl.appendChild(canvasEl);
    }
    if (!selEl) {
      selEl = document.createElement('div');
      selEl.id = 'acRangeSel';
      selEl.className = 'ac-rb-sel';
      selEl.innerHTML = '<span class="ac-rb-handle l"></span><span class="ac-rb-handle r"></span>';
      miniEl.appendChild(selEl);
    }
  }

  // ════════════════════════════════════════════════════════════
  // Quick ranges
  // ════════════════════════════════════════════════════════════
  function parseDate(s) {
    const key = String(s || '').replace(/\//g, '-').slice(0, 10);
    const ms = Date.parse(key + 'T00:00:00Z');
    return Number.isFinite(ms) ? ms : NaN;
  }

  /* Date-driven rather than fixed bar counts, because the same key has to mean
     the same wall-clock span on daily, weekly and monthly candles. Falls back
     to a bar count when the dates are unparseable. */
  function rangeStartIndex(key, arr) {
    const n = arr.length;
    if (!n) return 0;
    if (key === 'All') return 0;
    if (BAR_COUNTS[key] != null) return Math.max(0, n - BAR_COUNTS[key]);

    const lastMs = parseDate(arr[n - 1].Date);
    if (!Number.isFinite(lastMs)) return 0;
    const last = new Date(lastMs);

    let cutoff;
    if (key === 'YTD') {
      cutoff = Date.UTC(last.getUTCFullYear(), 0, 1);
    } else {
      const m = MONTHS_BACK[key];
      if (m == null) return 0;
      cutoff = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - m, last.getUTCDate());
    }

    let i = n - 1;
    while (i > 0) {
      const d = parseDate(arr[i - 1].Date);
      if (!Number.isFinite(d) || d < cutoff) break;
      i--;
    }
    return i;
  }

  function applyRange(key) {
    const arr = data();
    const scale = ts();
    if (!arr.length || !scale) return;

    const n = arr.length;
    const start = rangeStartIndex(key, arr);
    let from = start - 0.5;
    let to = n - 0.5 + Math.max(1, Math.min(6, (n - start) * 0.04));
    if (to - from < MIN_SPAN) from = to - MIN_SPAN;

    try { scale.setVisibleLogicalRange({ from, to }); } catch (e) { return; }
    markActive(key);
    // A quick range is a jump-to-view, so repaint immediately rather than
    // waiting on the visible-range subscription (which can lag a frame).
    syncSelection();
  }

  function markActive(key) {
    if (!buttonsEl) return;
    buttonsEl.querySelectorAll('.tv-range-btn, .ac-rb-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.range === key);
    });
  }
  function clearActive() {
    if (!buttonsEl) return;
    buttonsEl.querySelectorAll('.tv-range-btn, .ac-rb-btn').forEach(b => b.classList.remove('active'));
  }

  // ════════════════════════════════════════════════════════════
  // Miniature
  // ════════════════════════════════════════════════════════════
  let _rafPending = false;
  function scheduleDraw() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => { _rafPending = false; drawMini(); syncSelection(); });
  }

  function drawMini() {
    if (!canvasEl || !miniEl) return;
    const w = miniEl.clientWidth;
    const h = miniEl.clientHeight;
    if (w < 2 || h < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.max(1, Math.round(w * dpr));
    canvasEl.height = Math.max(1, Math.round(h * dpr));
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const arr = data();
    const n = arr.length;
    if (n < 2) return;

    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = +arr[i].Close;
      if (!isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!isFinite(lo) || !isFinite(hi)) return;
    if (hi === lo) { hi = lo + 1; lo = lo - 1; }

    const pad = 4;
    const xOf = i => (i / (n - 1)) * w;
    const yOf = v => (h - pad) - ((v - lo) / (hi - lo)) * (h - pad * 2);

    // At most ~2 samples per device pixel column — a 2000-bar sparkline
    // redrawn on every pan would otherwise be the most expensive thing on
    // the page.
    const step = Math.max(1, Math.floor(n / Math.max(1, w * 2)));

    const c = colors();
    const pts = [];
    for (let i = 0; i < n; i += step) {
      const v = +arr[i].Close;
      if (isFinite(v)) pts.push([xOf(i), yOf(v)]);
    }
    const lastV = +arr[n - 1].Close;
    if (isFinite(lastV)) pts.push([xOf(n - 1), yOf(lastV)]);
    if (pts.length < 2) return;

    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[pts.length - 1][0], h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, alpha(c.accent, 0.28));
    grad.addColorStop(1, alpha(c.accent, 0.02));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = alpha(c.accent, 0.85);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Selection <-> visible logical range ────────────────────────
  function selRect() {
    const scale = ts();
    const n = data().length;
    if (!scale || !n || !miniEl) return null;
    let r = null;
    try { r = scale.getVisibleLogicalRange(); } catch (e) { return null; }
    if (!r) return null;
    const w = miniEl.clientWidth;
    const px = v => (v / Math.max(1, n - 1)) * w;
    const left = Math.max(0, Math.min(w, px(r.from)));
    const right = Math.max(0, Math.min(w, px(r.to)));
    // Zoomed right in, the true window is sub-pixel wide. Pad it out so there
    // is always something to see and to grab; `from`/`to` stay exact, and all
    // the range math runs off those, never off left/right.
    return { left, right: Math.max(left + MIN_SEL_PX, right), w, n, from: r.from, to: r.to };
  }

  function syncSelection() {
    if (!selEl) return;
    const s = selRect();
    if (!s) { selEl.style.width = '0px'; return; }
    const w = s.right - s.left;
    selEl.style.left = s.left + 'px';
    selEl.style.width = w + 'px';
    selEl.style.background = alpha(colors().accent, 0.10);
    // Hide the grips when hitMode() has stopped honouring them, so the cursor
    // and the affordance never disagree.
    selEl.classList.toggle('narrow', w < EDGES_FROM_PX);
  }

  // ════════════════════════════════════════════════════════════
  // Drag: pan the middle, resize the edges
  // ════════════════════════════════════════════════════════════
  let drag = null;   // { mode, grab, span, n, w }

  function logicalAtPx(px, n, w) {
    return (px / Math.max(1, w)) * Math.max(1, n - 1);
  }

  function setRange(from, to) {
    const scale = ts();
    if (!scale) return;
    if (!(isFinite(from) && isFinite(to)) || to - from < MIN_SPAN) return;
    try { scale.setVisibleLogicalRange({ from, to }); } catch (e) { /* advisory */ }
    syncSelection();
  }

  /* A tight window can be narrower than two handle hit-zones, in which case
     every grab would read as a resize and the selection could never be panned.
     Below EDGES_FROM_PX the whole thing pans; above it the hit-zone shrinks
     with the window so the middle always stays grabbable. */
  function hitMode(px, s) {
    const w = s.right - s.left;
    const hit = Math.max(2, Math.min(HANDLE_HIT, w / 3));
    if (w >= EDGES_FROM_PX) {
      if (Math.abs(px - s.left) <= hit) return 'left';
      if (Math.abs(px - s.right) <= hit) return 'right';
    }
    if (px >= s.left - hit && px <= s.right + hit) return 'pan';
    return 'jump';
  }

  function onDown(e) {
    const s = selRect();
    if (!s || !miniEl) return;
    const px = e.clientX - miniEl.getBoundingClientRect().left;
    let mode = hitMode(px, s);

    const span = s.to - s.from;
    if (mode === 'jump') {
      // Click outside the window: centre the same span on the click.
      const mid = logicalAtPx(px, s.n, s.w);
      setRange(mid - span / 2, mid + span / 2);
      clearActive();
      mode = 'pan';
    }

    drag = { mode, span, n: s.n, w: s.w, grab: logicalAtPx(px, s.n, s.w) - (selRect() || s).from };
    selEl.classList.add('dragging');
    try { miniEl.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
    clearActive();
  }

  function onMove(e) {
    if (!miniEl) return;
    const rect = miniEl.getBoundingClientRect();
    const px = e.clientX - rect.left;

    if (!drag) {
      const s = selRect();
      if (s) {
        const m = hitMode(px, s);
        miniEl.style.cursor = (m === 'left' || m === 'right') ? 'ew-resize' : (m === 'pan' ? 'grab' : 'crosshair');
      }
      return;
    }

    const lg = logicalAtPx(px, drag.n, drag.w);
    const s = selRect();
    if (!s) return;

    if (drag.mode === 'pan') {
      let from = lg - drag.grab;
      const maxFrom = drag.n - 2;
      const minFrom = -Math.max(2, drag.span - 2);
      from = Math.max(minFrom, Math.min(maxFrom, from));
      setRange(from, from + drag.span);
    } else if (drag.mode === 'left') {
      const from = Math.max(-drag.n, Math.min(s.to - MIN_SPAN, lg));
      setRange(from, s.to);
    } else if (drag.mode === 'right') {
      const to = Math.min(drag.n + drag.n * 0.5, Math.max(s.from + MIN_SPAN, lg));
      setRange(s.from, to);
    }
    e.preventDefault();
  }

  function onUp(e) {
    if (!drag) return;
    drag = null;
    if (selEl) selEl.classList.remove('dragging');
    try { miniEl.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  let _obsWired = false;
  function onRenderHook() { scheduleDraw(); }

  function wireEvents() {
    if (buttonsEl && !buttonsEl.__acRangeBound) {
      buttonsEl.__acRangeBound = true;
      buttonsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-range]');
        if (btn) applyRange(btn.dataset.range);
      });
    }
    if (miniEl && !miniEl.__acRangeBound) {
      miniEl.__acRangeBound = true;
      miniEl.addEventListener('pointerdown', onDown);
      miniEl.addEventListener('pointermove', onMove);
      miniEl.addEventListener('pointerup', onUp);
      miniEl.addEventListener('pointercancel', onUp);
      miniEl.addEventListener('pointerleave', () => { if (!drag) miniEl.style.cursor = 'crosshair'; });
    }

    const scale = ts();
    if (scale && !scale.__acRangeSubscribed) {
      scale.__acRangeSubscribed = true;
      scale.subscribeVisibleLogicalRangeChange(() => syncSelection());
    }

    // Data / chart-type / replay changes all funnel through drawChart().
    if (window.ACChart && window.ACChart.addRenderHook) {
      window.ACChart.addRenderHook('range-bar', onRenderHook);
    }

    // Everything below is document- or observer-scoped, so it is wired once
    // even though wireEvents() is re-run on every boot poll (the chart can
    // become ready long after the bar itself has mounted).
    if (_obsWired) return;
    _obsWired = true;

    // Theme: the site fires 'dse-display-applied' on document, and
    // ac-theme-bridge.js flips classes / data-theme on <html>.
    document.addEventListener('dse-display-applied', scheduleDraw);
    window.addEventListener('dse-display-applied', scheduleDraw);
    try {
      new MutationObserver(scheduleDraw).observe(document.documentElement, {
        attributes: true, attributeFilter: ['class', 'data-theme'],
      });
    } catch (e) { /* no MutationObserver: theme repaint falls back to the event */ }

    if (miniEl && typeof ResizeObserver === 'function') {
      try { new ResizeObserver(() => scheduleDraw()).observe(miniEl); } catch (e) {}
    }
    window.addEventListener('resize', scheduleDraw);
  }

  // ── Live clock (parity with tv-range-bar.js) ───────────────────
  function tickClock() {
    if (!dateTimeEl) return;
    dateTimeEl.textContent = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }

  // ════════════════════════════════════════════════════════════
  // Boot
  // ════════════════════════════════════════════════════════════
  function mount() {
    if (mounted) { wireEvents(); return true; }
    hostEl = findHost();
    if (!hostEl) {
      if (!ready() && !$('ac-chart-container')) return false;   // nothing to hang it off yet
      hostEl = createHost();
    }
    if (!hostEl) return false;

    injectStyles();
    hostEl.classList.add('ac-range-bar');
    buildInner();
    wireEvents();
    mounted = true;

    tickClock();
    setInterval(tickClock, 1000);
    scheduleDraw();
    return true;
  }

  let tries = 0;
  function boot() {
    const ok = mount() && ready();
    if (ok) { scheduleDraw(); return; }
    if (tries++ > 300) return;     // ~15s, then give up quietly
    setTimeout(boot, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // ── Public API ─────────────────────────────────────────────────
  window.applyTVRange = applyRange;      // name kept from tv-range-bar.js
  window.ACRangeBar = {
    apply: applyRange,
    redraw: scheduleDraw,
    mount,
    host: () => hostEl,
    createdOwnHost: () => createdHost,
    rangeStartIndex,
  };

})();
