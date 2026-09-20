/* ════════════════════════════════════════════════════════════
   ac-drawings.js
   POINTER ROUTING + adapter glue that lets the candlestick page's
   overlay-canvas modules load here COMPLETELY UNMODIFIED:

     ../candlestick_chart/tv-drawing-tools.js
     ../candlestick_chart/tv-drawing-settings-modal.js
     ../candlestick_chart/tv-trade-markers.js
     ../candlestick_chart/sm-trade-overlay.js

   Those files attach their own mouse listeners to #candleCanvas and
   paint through window._lastRender. ac-render.js already provides the
   canvas, the geometry bridge and the repaint hook — everything except
   the one thing a Lightweight Charts page needs and the canvas page
   never did: deciding, moment to moment, whether a pointer event
   belongs to the drawing layer or to the chart underneath it.

   The overlay is `pointer-events: none` by default (advanced-chart.css)
   and `.ac-overlay-interactive` flips it to `auto`. This file owns that
   class. Four rules decide it:

     1. A drawing tool is armed (anything but Cursor/Crosshair)
        → the overlay takes every event; Lightweight Charts sees none.
     2. Cursor mode, pointer within ~6px of an existing drawing
        → the overlay takes it, so the click SELECTS / the dblclick
        opens the settings modal. Anywhere else the overlay is inert
        and LWC pans, zooms and crosshairs normally.
     3. A gesture that began on the overlay keeps it until mouseup,
        so a drag that wanders off the drawing doesn't get dropped.
     4. Escape / Delete re-evaluate, because tv-drawing-tools.js can
        change the armed tool without any rail click happening.

   It also supplies four renderer-specific things the shared files
   expect from candlestick-draw.js, which does not exist on this page:

     · window._crosshairPixel  — tv-trade-markers.js's hover tooltip
       reads it as a bare global; nothing else here defines it.
     · the Zoom tool's actual zoom — tv-drawing-tools' applyZoomBox()
       writes zoomLevel/panOffset, which mean nothing to LWC, so the
       drag is mirrored here and applied as setVisibleLogicalRange().
     · ?smFocus=1 — same story for sm-trade-overlay.js's focusTrade().
     · a preview-coalescing drawChart() wrapper, so a drawing preview
       that repaints on every mousemove doesn't re-setData() the whole
       chart 60 times a second.

   Owns  : #candleCanvas pointer routing, window.ACDrawings
   Reads : window.ACChart (ac-render.js), window._lastRender,
           window.TVDrawingsAPI (tv-drawing-tools.js), localStorage
   Edits : nothing under ../candlestick_chart/ — by design.
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  // ── Constants ──────────────────────────────────────────────────
  const RAIL_ID = 'tvLeftRail';
  const CANVAS_ID = 'candleCanvas';
  const INTERACTIVE_CLASS = 'ac-overlay-interactive';
  const CURSOR_POINTER_CLASS = 'ac-cursor-pointer';
  // tv-drawing-tools.js re-parents these to <body> at load time.
  const TOOLBAR_SEL = '#tvLeftRail, #tvFlyoutLines, #tvFlyoutFib, #tvFlyoutShapes, .tv-tool-flyout, .tv-emoji-flyout';

  // 'crosshair' is passive on purpose: tv-drawing-tools.js explicitly bows
  // out of it ("let existing hover behaviour run"), and on this page the
  // crosshair belongs to Lightweight Charts.
  const PASSIVE_TOOLS = new Set(['cursor', 'crosshair']);

  const HIT_TOL = 6;      // same tolerance tv-drawing-tools' hitTest() uses
  const POINT_TOL = 12;   // ...and the same +6 it allows for single-point types
  const HANDLE_TOL = 9;   // selection handles are drawn r=3.5; give them room
  const SNAPSHOT_TTL = 1500;
  const PREVIEW_WINDOW_MS = 90;
  const TRAILING_RENDER_MS = 220;
  const MIN_ZOOM_BARS = 5;
  const ZOOM_MIN_DRAG_PX = 8;   // matches tv-drawing-tools' own threshold

  const TF_VISIBILITY_KEY = { daily: 'days', weekly: 'weeks', monthly: 'months' };

  const now = () => (window.performance && performance.now ? performance.now() : Date.now());

  // ── State ──────────────────────────────────────────────────────
  let _armed = 'cursor';
  let _interactive = false;
  let _cssModifierWorks = null;   // null = not probed yet
  let _gesture = false;           // a mousedown that landed on the overlay
  let _zoomDrag = null;           // {x1,x2} mirror of tv-drawing-tools' _zoomBox
  let _repaintQueued = false;
  let _refreshQueued = false;
  let _resizeQueued = false;
  let _booted = false;

  // ── Elements ───────────────────────────────────────────────────
  function overlayEl() {
    const api = window.ACChart;
    return (api && typeof api.overlay === 'function' && api.overlay())
      || document.getElementById(CANVAS_ID);
  }
  function containerEl() {
    const api = window.ACChart;
    return (api && typeof api.container === 'function') ? api.container() : null;
  }
  function railEl() { return document.getElementById(RAIL_ID); }
  function chartApi() {
    const api = window.ACChart;
    return (api && typeof api.chart === 'function') ? api.chart() : null;
  }
  function chartReady() {
    const api = window.ACChart;
    return !!(api && typeof api.ready === 'function' && api.ready());
  }

  // ── Interactivity ──────────────────────────────────────────────
  // The class is the contract (advanced-chart.css owns the rule pair), but
  // this page has ten authors and the stylesheet lands independently, so the
  // class is probed once and we fall back to inline styles if the rules
  // aren't actually there. Otherwise a missing rule means either a dead
  // drawing layer or a chart that can never be panned, with no error.
  function probeCssModifier(cv) {
    try {
      const had = cv.classList.contains(INTERACTIVE_CLASS);
      cv.classList.remove(INTERACTIVE_CLASS);
      const off = getComputedStyle(cv).pointerEvents;
      cv.classList.add(INTERACTIVE_CLASS);
      const on = getComputedStyle(cv).pointerEvents;
      cv.classList.toggle(INTERACTIVE_CLASS, had);
      return off === 'none' && on === 'auto';
    } catch (e) {
      return false;
    }
  }

  // `reason` is 'tool' (a drawing tool is armed — crosshair cursor, which is
  // what .ac-overlay-interactive already gives) or 'hit' (cursor mode, over
  // an existing drawing — a pointer cursor, so it reads as grabbable rather
  // than as a place to start drawing). advanced-chart.css defines both.
  function setInteractive(on, reason) {
    on = !!on;
    const cv = overlayEl();
    if (!cv) { _interactive = on; return; }
    if (_cssModifierWorks === null) _cssModifierWorks = probeCssModifier(cv);
    cv.classList.toggle(INTERACTIVE_CLASS, on);
    cv.classList.toggle(CURSOR_POINTER_CLASS, on && reason === 'hit');
    if (!_cssModifierWorks) cv.style.pointerEvents = on ? 'auto' : 'none';
    _interactive = on;
  }

  // ── Which tool is armed ────────────────────────────────────────
  // setActiveTool() in tv-drawing-tools.js is the only writer of `.active`
  // on a `[data-tool]` rail button (the magnet/stay/lock/hide toggles carry
  // `.active` too but have no data-tool, and the flyout options keep a
  // stale `.active` of their own, so neither is read here).
  function readArmedTool() {
    const rail = railEl();
    if (!rail) return 'cursor';
    const btn = rail.querySelector('.tv-rail-btn[data-tool].active');
    return (btn && btn.dataset.tool) ? btn.dataset.tool : 'cursor';
  }

  function isPassive(tool) { return PASSIVE_TOOLS.has(tool); }

  // ── Geometry: mirrors tv-drawing-tools.js exactly ──────────────
  // Not "roughly the same" — deliberately the same arithmetic and the same
  // tolerances, so the overlay is interactive precisely when that file's
  // own hitTest() would return an id. Any drift here shows up as a drawing
  // you can see but cannot click.
  function dataToPixel(index, price) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return null;
    const x = r.padding.left + (index - r.startIdx + 0.5) * r.candleWidth;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    const y = paneY0 + paneHeight * (1 - (price - minPrice) / (maxPrice - minPrice));
    return { x, y };
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function getHitGeometry(d) {
    if (!d || !Array.isArray(d.pts) || !d.pts.length) return null;
    const pxPts = d.pts.map(p => (p ? dataToPixel(p.index, p.price) : null)).filter(Boolean);
    if (!pxPts.length) return null;

    if (d.type === 'hline' || d.type === 'hray') return { hLineY: pxPts[0].y, pxPts };
    if (d.type === 'vline') return { vLineX: pxPts[0].x, pxPts };
    if (d.type === 'crossline') return { hLineY: pxPts[0].y, vLineX: pxPts[0].x, pxPts };

    if (pxPts.length === 1) return { points: pxPts, pxPts };
    if (d.type === 'triangle' && pxPts.length >= 3) {
      return { segments: [[pxPts[0], pxPts[1]], [pxPts[1], pxPts[2]], [pxPts[2], pxPts[0]]], pxPts };
    }
    if (d.type === 'ray' || d.type === 'extendedline') {
      const [a, b] = pxPts;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ext = 2000;
      const far = { x: a.x + (dx / len) * ext, y: a.y + (dy / len) * ext };
      const near = d.type === 'extendedline' ? { x: a.x - (dx / len) * ext, y: a.y - (dy / len) * ext } : a;
      return { segments: [[near, far]], pxPts };
    }
    if ((d.type === 'trendline' || d.type === 'trendangle') && d.style && (d.style.extendLeft || d.style.extendRight)) {
      const [a, b] = pxPts;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ext = 2000;
      const near = d.style.extendLeft ? { x: a.x - (dx / len) * ext, y: a.y - (dy / len) * ext } : a;
      const far = d.style.extendRight ? { x: b.x + (dx / len) * ext, y: b.y + (dy / len) * ext } : b;
      return { segments: [[near, far]], pxPts };
    }
    if (d.type === 'rect' || d.type === 'circle' || d.type === 'ellipse') {
      const [a, b] = pxPts;
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      return { segments: [
        [{ x: x1, y: y1 }, { x: x2, y: y1 }], [{ x: x2, y: y1 }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: x1, y: y2 }], [{ x: x1, y: y2 }, { x: x1, y: y1 }],
      ], pxPts };
    }
    const segments = [];
    for (let i = 0; i < pxPts.length - 1; i++) segments.push([pxPts[i], pxPts[i + 1]]);
    return { segments, pxPts };
  }

  // ── The drawing set ────────────────────────────────────────────
  // userDrawings is private to tv-drawing-tools.js's IIFE and TVDrawingsAPI
  // exposes only getDrawing(id) — no way to enumerate. localStorage is the
  // same source of truth that file loads from and writes back on every
  // mutation (commit / delete / clear / settings-modal save), so the hit
  // test reads it there, cached and invalidated on each of those writes.
  let _snap = { sym: null, raw: null, drawings: [], hidden: false, locked: false, at: 0 };
  let _snapDirty = true;

  function currentSymbol() {
    const el = document.getElementById('tvTicker');
    return el ? el.textContent.trim().toUpperCase() : 'UNKNOWN';
  }

  function drawingsSnapshot() {
    const sym = currentSymbol();
    const t = now();
    if (!_snapDirty && sym === _snap.sym && (t - _snap.at) < SNAPSHOT_TTL) return _snap;

    let raw = null;
    try { raw = localStorage.getItem('tv-drawings-' + sym); } catch (e) { raw = null; }
    _snapDirty = false;
    if (sym === _snap.sym && raw === _snap.raw) { _snap.at = t; return _snap; }

    let drawings = [], hidden = false, locked = false;
    try {
      const stored = JSON.parse(raw || 'null');
      if (Array.isArray(stored)) drawings = stored;                       // legacy bare-array format
      else if (stored && typeof stored === 'object') {
        drawings = Array.isArray(stored.drawings) ? stored.drawings : [];
        hidden = !!stored.hidden;
        locked = !!stored.locked;
      }
    } catch (e) { /* corrupt entry — treat as no drawings */ }

    _snap = { sym, raw, drawings, hidden, locked, at: t };
    return _snap;
  }

  function invalidateSnapshot() { _snapDirty = true; }

  function hiddenForTimeframe(d) {
    if (!d || !d.visibility) return false;
    const tf = (typeof currentTimeframe !== 'undefined') ? currentTimeframe : 'daily';
    const key = TF_VISIBILITY_KEY[tf];
    return key ? d.visibility[key] === false : false;
  }

  // Lightweight Charts' right price scale is its own drag target (drag to
  // rescale, double-click to autoscale). A full-width hline would otherwise
  // blanket that column and make it ungrabbable, so it is carved out.
  let _axisWidth = 0;
  let _axisWidthAt = 0;
  function rightAxisWidth() {
    const t = now();
    if (t - _axisWidthAt < 500) return _axisWidth;
    _axisWidthAt = t;
    try {
      const chart = chartApi();
      const w = chart ? chart.priceScale('right').width() : 0;
      _axisWidth = (typeof w === 'number' && isFinite(w)) ? w : 0;
    } catch (e) { _axisWidth = 0; }
    return _axisWidth;
  }

  // True when the pointer is close enough to an existing drawing (or one of
  // its anchor handles) that the click has to reach tv-drawing-tools.js.
  function hitTestDrawings(px, py) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return false;

    // drawUserAnnotations() clips to the price pane, so nothing below it is
    // clickable — and not stealing that band keeps sub-pane panning intact.
    const priceBottom = r.priceRange.paneY0 + r.priceRange.paneHeight;
    if (py > priceBottom + 2) return false;
    if (r.width && px > r.width - rightAxisWidth()) return false;

    const snap = drawingsSnapshot();
    if (snap.hidden || !snap.drawings.length) return false;   // hide-all: nothing to click

    for (let i = snap.drawings.length - 1; i >= 0; i--) {
      const d = snap.drawings[i];
      if (hiddenForTimeframe(d)) continue;
      const geo = getHitGeometry(d);
      if (!geo) continue;
      if (geo.hLineY != null && Math.abs(py - geo.hLineY) <= HIT_TOL) return true;
      if (geo.vLineX != null && Math.abs(px - geo.vLineX) <= HIT_TOL) return true;
      if (geo.points) {
        if (Math.hypot(px - geo.points[0].x, py - geo.points[0].y) <= POINT_TOL) return true;
      } else if (geo.segments) {
        for (let s = 0; s < geo.segments.length; s++) {
          const a = geo.segments[s][0], b = geo.segments[s][1];
          if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= HIT_TOL) return true;
        }
      }
      // Anchor handles: drawn for the selected drawing, and the grab point
      // for anything that gains a drag-to-move later. _selectedId is private,
      // so every drawing's anchors are live — harmless, they sit on the
      // shape anyway except for the infinite-line types.
      if (geo.pxPts) {
        for (let h = 0; h < geo.pxPts.length; h++) {
          if (Math.hypot(px - geo.pxPts[h].x, py - geo.pxPts[h].y) <= HANDLE_TOL) return true;
        }
      }
    }
    return false;
  }

  // ── Repaint / refresh scheduling ───────────────────────────────
  function scheduleRepaint() {
    if (_repaintQueued) return;
    _repaintQueued = true;
    requestAnimationFrame(() => {
      _repaintQueued = false;
      const api = window.ACChart;
      if (api && typeof api.repaintOverlay === 'function') {
        try { api.repaintOverlay(); } catch (e) { console.warn('[AC] repaintOverlay', e); }
      }
    });
  }

  function scheduleResize() {
    if (_resizeQueued) return;
    _resizeQueued = true;
    requestAnimationFrame(() => {
      _resizeQueued = false;
      const api = window.ACChart;
      if (!api) return;
      try {
        if (typeof api.sizeOverlay === 'function') api.sizeOverlay();
        if (typeof api.computeLastRender === 'function') api.computeLastRender();
        if (typeof api.repaintOverlay === 'function') api.repaintOverlay();
      } catch (e) { console.warn('[AC] overlay resize', e); }
    });
  }

  function scheduleRefresh() {
    if (_refreshQueued) return;
    _refreshQueued = true;
    requestAnimationFrame(() => { _refreshQueued = false; refresh(); });
  }

  // Re-read the armed tool and re-decide the overlay's pointer state.
  function refresh() {
    const prev = _armed;
    _armed = readArmedTool();
    invalidateSnapshot();
    if (!isPassive(_armed)) {
      setInteractive(true, 'tool');
    } else if (!_gesture) {
      setInteractive(false);
    }
    if (prev !== _armed) scheduleRepaint();
  }

  // ── Pointer routing ────────────────────────────────────────────
  function pointerInOverlay(e) {
    const cv = overlayEl();
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    return { x, y, inside };
  }

  // tv-trade-markers.js reads `_crosshairPixel` as a bare global for its
  // hover tooltip; candlestick-draw.js (which normally sets it) is not on
  // this page, so the tooltip is dead without this. A window property
  // satisfies the `typeof _crosshairPixel !== 'undefined'` guard there.
  function setCrosshairPixel(p) {
    const prev = window._crosshairPixel;
    if (!p && !prev) return;
    if (p && prev && prev.x === p.x && prev.y === p.y) return;
    window._crosshairPixel = p;
    if (typeof window.drawTradeMarkers === 'function') scheduleRepaint();
  }

  // Capture phase on `document`, so this runs before the canvas's own
  // listeners (tv-drawing-tools.js registers in capture on the canvas
  // itself, which is the target phase from document's point of view).
  function onMouseMove(e) {
    const p = pointerInOverlay(e);
    if (!p) return;

    // A drag released outside the window never delivers its mouseup, which
    // would otherwise leave the overlay latched interactive forever.
    if (_gesture && e.buttons === 0) { _gesture = false; scheduleRefresh(); }

    setCrosshairPixel(p.inside ? { x: p.x, y: p.y } : null);

    if (!isPassive(_armed)) {
      // A tool is armed: the overlay already owns the pointer. Flag the
      // preview window so the repaint storm that follows is coalesced.
      armPreviewCoalesce();
      return;
    }
    if (_gesture) return;                    // mid-drag — don't retarget under the cursor
    if (_armed !== 'cursor') { setInteractive(false); return; }

    const want = p.inside && hitTestDrawings(p.x, p.y);
    if (want !== _interactive) setInteractive(want, 'hit');
  }

  function onMouseDown(e) {
    const cv = overlayEl();
    _gesture = !!(cv && e.target === cv);
    if (!_gesture) return;
    if (!isPassive(_armed)) armPreviewCoalesce();
    if (_armed === 'zoom') {
      const p = pointerInOverlay(e);
      if (p) _zoomDrag = { x1: p.x, x2: p.x };
    }
  }

  function onMouseUp(e) {
    if (_zoomDrag) {
      const p = pointerInOverlay(e);
      if (p) _zoomDrag.x2 = p.x;
      const box = _zoomDrag;
      _zoomDrag = null;
      applyZoomBox(box);
    }
    if (_gesture) {
      _gesture = false;
      invalidateSnapshot();   // the gesture may have committed a drawing
      scheduleRefresh();
    }
  }

  function onMouseLeaveWindow() {
    setCrosshairPixel(null);
    _gesture = false;
    if (isPassive(_armed)) setInteractive(false);
  }

  // ── Zoom tool ──────────────────────────────────────────────────
  // tv-drawing-tools' applyZoomBox() ends by assigning `zoomLevel` and
  // `panOffset` — candlestick-data.js script-scope bindings that mean
  // nothing to Lightweight Charts and that nothing outside that file's
  // lexical scope can read back. Rather than edit it, the same drag is
  // mirrored above and converted to a logical range here.
  function xToLogical(x) {
    const chart = chartApi();
    if (chart) {
      try {
        const l = chart.timeScale().coordinateToLogical(x);
        if (l != null && isFinite(l)) return l;
      } catch (e) { /* fall through to the _lastRender mapping */ }
    }
    const r = window._lastRender;
    if (!r || !r.candleWidth) return null;
    return r.startIdx + (x - r.padding.left) / r.candleWidth - 0.5;
  }

  function applyZoomBox(box) {
    if (!box || !chartReady()) return;
    if (Math.abs(box.x2 - box.x1) <= ZOOM_MIN_DRAG_PX) return;
    const a = xToLogical(Math.min(box.x1, box.x2));
    const b = xToLogical(Math.max(box.x1, box.x2));
    if (a == null || b == null) return;

    let from = a, to = b;
    if (to - from < MIN_ZOOM_BARS) {
      const mid = (from + to) / 2;
      from = mid - MIN_ZOOM_BARS / 2;
      to = mid + MIN_ZOOM_BARS / 2;
    }
    const chart = chartApi();
    try {
      // The zoom box is drawn full-height (renderZoomBox ignores y), so the
      // selection carries no price range: hand the price scale back to
      // autoscale instead of inventing one, which is what TradingView's
      // box-zoom does and what the drawn box implies.
      chart.priceScale('right').applyOptions({ autoScale: true });
    } catch (e) { /* price scale id may differ — autoscale is a nicety */ }
    try {
      chart.timeScale().setVisibleLogicalRange({ from, to });
    } catch (e) { console.warn('[AC] zoom box', e); }
    scheduleRefresh();
  }

  // ── ?smFocus=1 ─────────────────────────────────────────────────
  // sm-trade-overlay.js's focusTrade() frames the trade by writing
  // zoomLevel/panOffset — the same dead end as the zoom box. The trade's
  // own drawing works untouched through _lastRender; only the framing
  // needs a renderer-specific equivalent, so it is recomputed here from
  // the same URL params rather than patching that file.
  function indexForDate(displayData, dateStr) {
    if (!displayData || !displayData.length || !dateStr) return null;
    const target = String(dateStr).replace(/-/g, '/');
    let onOrBefore = -1;
    for (let i = 0; i < displayData.length; i++) {
      const d = String(displayData[i].Date).replace(/-/g, '/');
      if (d === target) return i;
      if (d <= target) onOrBefore = i;
    }
    return onOrBefore !== -1 ? onOrBefore : null;
  }

  function focusSuperModelTrade() {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('smFocus') !== '1' || !qs.get('smEntryDate')) return;
    const r = window._lastRender;
    if (!r || !r.displayData || !r.displayData.length || !chartReady()) return;

    const data = r.displayData;
    const entryIdx = indexForDate(data, qs.get('smEntryDate'));
    if (entryIdx == null) return;
    const exitRaw = qs.get('smExitDate') ? indexForDate(data, qs.get('smExitDate')) : null;
    const exitIdx = (exitRaw == null) ? entryIdx : exitRaw;

    // Same framing as focusTrade(): the hold period plus roughly equal
    // breathing room either side, exit parked a little in from the right.
    const held = Math.max(1, exitIdx - entryIdx);
    const want = Math.max(30, Math.round(held * 2.2) + 20);
    const padAfter = Math.max(4, Math.round(want * 0.18));
    let to = exitIdx + padAfter;     // may sit past the last bar — that is the breathing room
    let from = to - want;
    // An early trade would otherwise open on a screenful of blank space to
    // the left of bar 0; slide the window right instead of shrinking it.
    if (from < 0) {
      const shift = Math.min(-from, (data.length - 1 + padAfter) - to);
      if (shift > 0) { from += shift; to += shift; }
    }
    try {
      chartApi().timeScale().setVisibleLogicalRange({ from, to });
    } catch (e) { console.warn('[AC] smFocus', e); }
  }

  function scheduleSuperModelFocus() {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('smFocus') !== '1' || !qs.get('smEntryDate')) return;
    let tries = 0;
    const t = setInterval(() => {
      const r = window._lastRender;
      if (r && r.displayData && r.displayData.length && chartReady()) {
        clearInterval(t);
        // One beat after the data lands, so the renderer's own initial
        // fitContent() has already happened and this is the last word.
        setTimeout(focusSuperModelTrade, 150);
      } else if (++tries > 120) {
        clearInterval(t);
      }
    }, 50);
  }

  // ── Preview coalescing ─────────────────────────────────────────
  // Every drawing preview (line2/click3/clickN/drag2/freehand/measure/zoom)
  // repaints by calling drawChart() on each mousemove. On the canvas page
  // that was one 2D repaint; here it is a full LWC pass — setData() on the
  // price, volume and every indicator series, sixty times a second, for a
  // frame in which no DATA changed, only the pointer.
  //
  // So during a live preview drawChart() is reduced to what the preview
  // actually needs — recompute _lastRender, repaint the overlay — with one
  // real render trailing the gesture so any genuine data change still lands.
  // The wrapper is installed on the first drawing gesture, not at load: by
  // then every script has run, so it composes over whatever drawChart()
  // finally is instead of racing another module's wrapper.
  let _coalesceInstalled = false;
  let _coalesceUntil = 0;
  let _trailingTimer = null;

  function installCoalescer() {
    if (_coalesceInstalled) return;
    if (typeof window.drawChart !== 'function') return;
    const realDrawChart = window.drawChart;
    _coalesceInstalled = true;
    window.drawChart = function acCoalescedDrawChart() {
      if (_coalesceUntil > now() && chartReady()) {
        const api = window.ACChart;
        try {
          if (typeof api.computeLastRender === 'function') api.computeLastRender();
          if (typeof api.repaintOverlay === 'function') api.repaintOverlay();
        } catch (e) { console.warn('[AC] coalesced drawChart', e); }
        clearTimeout(_trailingTimer);
        _trailingTimer = setTimeout(() => {
          _coalesceUntil = 0;
          try { realDrawChart(); } catch (e) { console.warn('[AC] trailing drawChart', e); }
        }, TRAILING_RENDER_MS);
        return;
      }
      return realDrawChart.apply(this, arguments);
    };
  }

  function armPreviewCoalesce() {
    installCoalescer();
    _coalesceUntil = now() + PREVIEW_WINDOW_MS;
  }

  // ── Toolbar / keyboard wiring ──────────────────────────────────
  // Bubble phase on `document`: the rail's and the flyouts' own click
  // handlers (registered directly on those elements by tv-drawing-tools.js)
  // have already run by the time an event reaches here, so `.active` is
  // settled and readArmedTool() is reading the new tool, not the old one.
  function onToolbarClick(e) {
    if (!e.target || !e.target.closest) return;
    if (!e.target.closest(TOOLBAR_SEL)) return;
    invalidateSnapshot();
    refresh();
    scheduleRefresh();   // flyout picks close first, then arm — catch the second beat
  }

  // tv-drawing-tools.js already owns Escape (disarm + cancel placement) and
  // Delete/Backspace (remove the selected drawing) on `document`, and both
  // depend on state private to it (_selectedId, _pts, _lockAll). Duplicating
  // either would double-handle it, so this listener only re-syncs the
  // routing afterwards — plus a disarm fallback for the case where that
  // file never loaded and nothing else would put the rail back to Cursor.
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      requestAnimationFrame(() => {
        if (readArmedTool() !== 'cursor' && !window.TVDrawingsAPI) {
          const rail = railEl();
          const cursorBtn = rail && rail.querySelector('.tv-rail-btn[data-tool="cursor"]');
          if (cursorBtn) cursorBtn.click();
        }
        refresh();
      });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      requestAnimationFrame(() => { invalidateSnapshot(); refresh(); scheduleRepaint(); });
    }
  }

  // ── Drawing-mutation sync ──────────────────────────────────────
  // saveDrawings() is called on every mutation tv-drawing-tools.js makes
  // (commit, delete, clear, lock/hide toggle) and by the settings modal.
  // Wrapping it — not editing it — is the exact invalidation signal the
  // localStorage-backed hit test needs.
  let _apiWrapped = false;
  function wrapDrawingsApi() {
    if (_apiWrapped) return;
    const api = window.TVDrawingsAPI;
    if (!api) return;
    _apiWrapped = true;
    if (typeof api.saveDrawings === 'function') {
      const realSave = api.saveDrawings;
      api.saveDrawings = function () {
        const out = realSave.apply(this, arguments);
        invalidateSnapshot();
        scheduleRefresh();
        return out;
      };
    }
    if (typeof api.redraw === 'function') {
      const realRedraw = api.redraw;
      api.redraw = function () {
        invalidateSnapshot();
        return realRedraw.apply(this, arguments);
      };
    }
  }

  // ── Observers ──────────────────────────────────────────────────
  function watchRail() {
    const rail = railEl();
    if (!rail || typeof MutationObserver !== 'function') return;
    // The catch-all: setActiveTool() also runs with no click behind it —
    // Escape, commitDrawing() when stay-mode is off, applyZoomBox(). Every
    // one of those retoggles `.active` on a rail button, so watching the
    // class attribute sees tool changes the click handler never would.
    new MutationObserver(() => scheduleRefresh())
      .observe(rail, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  // ACChart.container() only exists once ac-boot.js has created the chart,
  // which can be after this file boots — so the observer is (re)attached
  // until the real container turns up, then left alone.
  let _resizeObserver = null;
  let _resizeWatchesContainer = false;
  let _resizeTries = 0;

  function watchResize() {
    if (typeof ResizeObserver !== 'function' || _resizeWatchesContainer) return;
    if (!_resizeObserver) _resizeObserver = new ResizeObserver(() => scheduleResize());
    const container = containerEl();
    const cv = overlayEl();
    if (container) {
      _resizeObserver.observe(container);
      _resizeWatchesContainer = true;
    } else if (cv) {
      _resizeObserver.observe(cv.parentElement || cv);
    }
    if (cv && cv.parentElement && cv.parentElement !== container) _resizeObserver.observe(cv.parentElement);
    if (!_resizeWatchesContainer && ++_resizeTries < 120) setTimeout(watchResize, 100);
  }

  // ── Boot ───────────────────────────────────────────────────────
  function boot() {
    if (_booted) return;
    const cv = overlayEl();
    if (!cv) return;                      // markup not parsed yet — retried below
    _booted = true;

    setInteractive(false);

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', onToolbarClick, false);
    document.addEventListener('keydown', onKeyDown, false);
    window.addEventListener('blur', onMouseLeaveWindow);
    document.addEventListener('mouseleave', onMouseLeaveWindow);
    window.addEventListener('storage', (e) => {
      if (!e.key || e.key.indexOf('tv-drawings-') === 0) { invalidateSnapshot(); scheduleRefresh(); }
    });

    watchRail();
    watchResize();
    wrapDrawingsApi();
    refresh();
    scheduleSuperModelFocus();

    // tv-drawing-tools.js runs after this file, so TVDrawingsAPI and the
    // rail's own handlers appear a moment later; pick them up then.
    setTimeout(() => { wrapDrawingsApi(); refresh(); }, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    boot();   // scripts at the end of <body> already have the canvas
  } else {
    boot();
  }

  // ── Public API ─────────────────────────────────────────────────
  window.ACDrawings = {
    // The tool tv-drawing-tools.js currently has armed ('cursor' when the
    // rail is absent or nothing is active).
    armedTool: () => _armed,
    // Force the overlay's pointer state. The router re-decides it on the
    // next pointer event / tool change, so this is a nudge, not a latch.
    setInteractive,
    isInteractive: () => _interactive,
    // Re-read the armed tool, drop the cached drawing set, re-route.
    refresh,
    hitTest: hitTestDrawings,
    repaint: scheduleRepaint,
  };

})();
