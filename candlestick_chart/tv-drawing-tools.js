'use strict';

/* ════════════════════════════════════════════════════════════
   tv-drawing-tools.js
   Full left-rail drawing toolkit for the standalone candlestick.html
   page: Lines family (trend line, ray, extended line, trend angle,
   horizontal/vertical/cross line, parallel channel), Fibonacci family
   (retracement, extension, channel, trend-based extension), Shapes
   family (rectangle, rotated rectangle, circle, ellipse, triangle,
   polyline, path, curve, double curve, brush, highlighter, arrow +
   arrow markers), plus Text, Icon (emoji), Measure, Zoom, and the
   Magnet / Stay-in-drawing-mode / Lock / Hide / Clear toggles.

   Coordinate math reuses window._lastRender (candle geometry + price
   range, stashed by candlestick-draw.js every drawChart() call) so
   annotations track pan/zoom exactly like the candles themselves.
   Drawings persist per-symbol in localStorage and are rendered via
   drawUserAnnotations(), called from the end of drawChart() in
   candlestick-draw.js.

   A few of the more exotic TradingView tools (rotated rectangle,
   fib channel, trend-based fib extension, double curve) are
   implemented as faithful-but-simplified equivalents rather than
   pixel-exact reproductions — see each render*() function's comment.

   Mouse events are captured in the CAPTURE phase (the `true` third
   argument) so they run BEFORE candlestick-ui.js's existing
   pan/crosshair mousedown/mousemove/mouseup handlers (registered in
   the bubble phase) — when a drawing tool other than Cursor is
   active, stopPropagation() there keeps the existing pan-drag logic
   from also firing on the same click.
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --sans / --mono tokens for
// canvas, falling back to the authored literal when that file isn't on
// the page. See candlestick-draw.js.
const _dtTheme = window.DSEChartTheme;
const _dtFont  = spec => (_dtTheme ? _dtTheme.font(spec) : spec);

(function () {
  const railEl = document.getElementById('tvLeftRail');
  const clearBtnEl = document.getElementById('tvClearDrawings');
  const canvas = document.getElementById('candleCanvas');
  if (!railEl || !canvas) return; // not on this page

  // Re-parent the flyout panels from the rail to <body>. They're
  // position:fixed with a high z-index and no transform/filter exists on
  // any ancestor up to <body> either way, so in principle stacking order
  // alone should already put them above the chart canvas — but empirically
  // (confirmed via elementFromPoint) the canvas still wins hit-testing
  // while nested under the sticky-positioned rail. Moving them to be
  // direct children of <body> sidesteps whatever browser-specific
  // stacking quirk sticky positioning was introducing, rather than
  // relying on z-index math that isn't panning out in practice.
  ['tvFlyoutLines', 'tvFlyoutFib', 'tvFlyoutShapes', 'tvEmojiFlyout'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  });

  // ── Tool metadata: which family it belongs to (for the rail group's
  // remembered icon) and how many/what kind of clicks place it. ──────
  const TOOL_META = {
    trendline:       { group: 'lines',  mode: 'line2' },
    ray:             { group: 'lines',  mode: 'line2' },
    extendedline:    { group: 'lines',  mode: 'line2' },
    trendangle:      { group: 'lines',  mode: 'line2' },
    hline:           { group: 'lines',  mode: 'point1' },
    hray:            { group: 'lines',  mode: 'point1' },
    vline:           { group: 'lines',  mode: 'point1' },
    crossline:       { group: 'lines',  mode: 'point1' },
    parallelchannel: { group: 'lines',  mode: 'click3' },

    fibretracement:  { group: 'fib',    mode: 'line2' },
    fibextension:    { group: 'fib',    mode: 'click3' },
    fibchannel:      { group: 'fib',    mode: 'click3' },
    fibtrendext:     { group: 'fib',    mode: 'click3' },

    rect:            { group: 'shapes', mode: 'drag2' },
    rotatedrect:     { group: 'shapes', mode: 'click3' },
    circle:          { group: 'shapes', mode: 'drag2' },
    ellipse:         { group: 'shapes', mode: 'drag2' },
    triangle:        { group: 'shapes', mode: 'click3' },
    polyline:        { group: 'shapes', mode: 'clickN' },
    path:            { group: 'shapes', mode: 'clickN' },
    curve:           { group: 'shapes', mode: 'clickN' },
    doublecurve:     { group: 'shapes', mode: 'clickN' },
    brush:           { group: 'shapes', mode: 'freehand' },
    highlighter:     { group: 'shapes', mode: 'freehand' },
    arrow:           { group: 'shapes', mode: 'line2' },
    arrowmarker:     { group: 'shapes', mode: 'point1' },
    arrowup:         { group: 'shapes', mode: 'point1' },
    arrowdown:       { group: 'shapes', mode: 'point1' },

    text:            { group: null, mode: 'text' },
    emoji:           { group: null, mode: 'emoji' },
    measure:         { group: null, mode: 'measure' },
    zoom:            { group: null, mode: 'zoom' },
  };

  let activeTool = 'cursor';
  let userDrawings = [];
  let _drawingsSymbol = null;
  let _lockAll = false;
  let _hideAll = false;
  let _magnetOn = false;
  let _stayMode = false;
  let _selectedId = null;

  // In-progress placement state, shared across modes.
  let _pts = [];              // committed data-space points for the current placement
  let _previewPt = null;      // live cursor data-space point (line2/click3/clickN preview)
  let _dragStart = null;      // {x,y,index,price} for drag2 modes
  let _dragging = false;
  let _freehandPts = null;    // array of {index,price} while brush/highlighter is down
  let _measureLive = null;    // {p1,p2} while dragging the measure tool
  let _measureResult = null;  // {p1,p2} shown after mouseup, until next interaction
  let _zoomBox = null;        // {x1,x2} pixel range while dragging the zoom tool

  // ── Global toggle persistence (magnet / stay-mode are behavior prefs,
  // shared across symbols; lock/hide are per-symbol like the drawings). ──
  try { _magnetOn = localStorage.getItem('tv-draw-magnet') === '1'; } catch {}
  try { _stayMode = localStorage.getItem('tv-draw-staymode') === '1'; } catch {}

  // ── Per-symbol persistence ─────────────────────────────────────
  function getCurrentSymbol() {
    const el = document.getElementById('tvTicker');
    return el ? el.textContent.trim().toUpperCase() : 'UNKNOWN';
  }

  function loadDrawingsIfSymbolChanged() {
    const sym = getCurrentSymbol();
    if (sym === _drawingsSymbol) return;
    _drawingsSymbol = sym;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(`tv-drawings-${sym}`) || 'null'); } catch {}
    if (Array.isArray(stored)) { // legacy format: bare array
      userDrawings = stored;
      _lockAll = false;
      _hideAll = false;
    } else if (stored && typeof stored === 'object') {
      userDrawings = Array.isArray(stored.drawings) ? stored.drawings : [];
      _lockAll = !!stored.locked;
      _hideAll = !!stored.hidden;
    } else {
      userDrawings = [];
      _lockAll = false;
      _hideAll = false;
    }
    _selectedId = null;
    updateToggleButtons();
  }

  function saveDrawings() {
    if (!_drawingsSymbol) return;
    try {
      localStorage.setItem(`tv-drawings-${_drawingsSymbol}`, JSON.stringify({
        drawings: userDrawings, locked: _lockAll, hidden: _hideAll,
      }));
    } catch { /* storage unavailable — drawings just won't persist across reloads */ }
  }

  // ── Pixel <-> data-space coordinate conversion ──────────────────
  function pixelToData(px, py) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return null;
    const index = r.startIdx + (px - r.padding.left) / r.candleWidth - 0.5;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    const priceFrac = 1 - (py - paneY0) / paneHeight;
    const price = minPrice + priceFrac * (maxPrice - minPrice);
    return { index, price };
  }

  function dataToPixel(index, price) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return null;
    const x = r.padding.left + (index - r.startIdx + 0.5) * r.candleWidth;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    const y = paneY0 + paneHeight * (1 - (price - minPrice) / (maxPrice - minPrice));
    return { x, y };
  }

  function mousePixel(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Snap a data-space point's price to the nearest OHLC value of the
  // candle at its index, when Magnet mode is on.
  function applyMagnet(data) {
    if (!_magnetOn || !data) return data;
    const r = window._lastRender;
    if (!r || !r.displayData) return data;
    const candle = r.displayData[Math.round(data.index)];
    if (!candle) return data;
    const candidates = [candle.Open, candle.High, candle.Low, candle.Close].filter(v => typeof v === 'number');
    if (!candidates.length) return data;
    let best = candidates[0];
    candidates.forEach(v => { if (Math.abs(v - data.price) < Math.abs(best - data.price)) best = v; });
    return { index: Math.round(data.index), price: best };
  }

  // ── Rail group buttons remember the last tool picked in their flyout ──
  const GROUP_BTN = {
    lines: railEl.querySelector('.tv-rail-group[data-group="lines"] .tv-rail-group-btn'),
    fib: railEl.querySelector('.tv-rail-group[data-group="fib"] .tv-rail-group-btn'),
    shapes: railEl.querySelector('.tv-rail-group[data-group="shapes"] .tv-rail-group-btn'),
  };
  const FLYOUT = {
    lines: document.getElementById('tvFlyoutLines'),
    fib: document.getElementById('tvFlyoutFib'),
    shapes: document.getElementById('tvFlyoutShapes'),
  };
  let _openFlyoutGroup = null;

  function closeFlyouts() {
    Object.values(FLYOUT).forEach(f => { if (f) f.style.display = 'none'; });
    _openFlyoutGroup = null;
  }

  // Several chart-owned overlays live in the same top-left corner a flyout
  // opened from one of the rail's top buttons (Lines/Fib/Shapes/Icon) would
  // naturally land in — the hover legend (symbol/OHLC/volume) and the
  // indicator badge bar (MACD/RSI/EMA pills) above the canvas. Pushing the
  // flyout below whichever of these is actually visible avoids the
  // collision instead of guessing a fixed offset that only covers one of them.
  const FLYOUT_OBSTACLE_SELECTORS = ['.chart-legend', '#indicatorInstanceBar'];

  function safeFlyoutTop(preferredTop) {
    let top = preferredTop;
    FLYOUT_OBSTACLE_SELECTORS.forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.style.display === 'none') return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      top = Math.max(top, rect.bottom + 8);
    });
    return top;
  }

  function openFlyout(group, anchorBtn) {
    const flyout = FLYOUT[group];
    if (!flyout) return;
    closeFlyouts();
    closeEmojiFlyout();
    const rect = anchorBtn.getBoundingClientRect();
    flyout.style.display = 'block';
    flyout.style.left = `${rect.right + 8}px`;
    flyout.style.top = `${safeFlyoutTop(Math.max(8, rect.top - 4))}px`;
    _openFlyoutGroup = group;
  }

  Object.entries(GROUP_BTN).forEach(([group, btn]) => {
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_openFlyoutGroup === group) { closeFlyouts(); return; }
      openFlyout(group, btn);
    });
  });

  Object.entries(FLYOUT).forEach(([group, flyout]) => {
    if (!flyout) return;
    flyout.addEventListener('click', (e) => {
      const opt = e.target.closest('.tv-tool-option[data-tool]');
      if (!opt) return;
      const tool = opt.dataset.tool;
      // Move that option's icon onto the group's rail button so it "remembers".
      const btn = GROUP_BTN[group];
      if (btn) {
        const icon = opt.querySelector('svg');
        const existingIcon = btn.querySelector('svg:not(.tv-rail-caret)');
        if (icon && existingIcon) btn.replaceChild(icon.cloneNode(true), existingIcon);
        btn.dataset.tool = tool;
      }
      flyout.querySelectorAll('.tv-tool-option').forEach(o => o.classList.toggle('active', o === opt));
      closeFlyouts();
      setActiveTool(tool);
    });
  });

  document.addEventListener('click', (e) => {
    if (_openFlyoutGroup && !e.target.closest('.tv-tool-flyout') && !e.target.closest('.tv-rail-group-btn')) {
      closeFlyouts();
    }
  });

  // ── Tool selection (left rail) ──────────────────────────────────
  function resetPlacement() {
    _pts = [];
    _previewPt = null;
    _dragStart = null;
    _dragging = false;
    _freehandPts = null;
    _zoomBox = null;
  }

  function setActiveTool(tool) {
    activeTool = tool;
    resetPlacement();
    railEl.querySelectorAll('.tv-rail-btn[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool && !b.classList.contains('tv-rail-group-btn'));
    });
    Object.entries(GROUP_BTN).forEach(([group, btn]) => {
      if (btn) btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    canvas.style.cursor = (tool === 'cursor') ? '' : 'crosshair';
    if (tool !== 'measure') _measureResult = null;
    drawChart();
  }

  railEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.tv-rail-btn[data-tool]');
    if (btn && !btn.classList.contains('tv-rail-group-btn')) setActiveTool(btn.dataset.tool);
  });

  // ── Toggle buttons: magnet / stay-in-drawing-mode / lock / hide ─────
  const magnetBtn = document.getElementById('tvMagnetBtn');
  const stayBtn = document.getElementById('tvStayModeBtn');
  const lockBtn = document.getElementById('tvLockBtn');
  const hideBtn = document.getElementById('tvHideBtn');

  function updateToggleButtons() {
    if (magnetBtn) magnetBtn.classList.toggle('active', _magnetOn);
    if (stayBtn) stayBtn.classList.toggle('active', _stayMode);
    if (lockBtn) lockBtn.classList.toggle('active', _lockAll);
    if (hideBtn) hideBtn.classList.toggle('active', _hideAll);
  }

  if (magnetBtn) magnetBtn.addEventListener('click', () => {
    _magnetOn = !_magnetOn;
    try { localStorage.setItem('tv-draw-magnet', _magnetOn ? '1' : '0'); } catch {}
    updateToggleButtons();
  });
  if (stayBtn) stayBtn.addEventListener('click', () => {
    _stayMode = !_stayMode;
    try { localStorage.setItem('tv-draw-staymode', _stayMode ? '1' : '0'); } catch {}
    updateToggleButtons();
  });
  if (lockBtn) lockBtn.addEventListener('click', () => {
    _lockAll = !_lockAll;
    saveDrawings();
    updateToggleButtons();
  });
  if (hideBtn) hideBtn.addEventListener('click', () => {
    _hideAll = !_hideAll;
    saveDrawings();
    updateToggleButtons();
    drawChart();
  });

  if (clearBtnEl) {
    clearBtnEl.addEventListener('click', () => {
      if (!userDrawings.length) return;
      if (!confirm(`Remove all ${userDrawings.length} drawing(s) on ${getCurrentSymbol()}?`)) return;
      userDrawings = [];
      _selectedId = null;
      saveDrawings();
      drawChart();
    });
  }

  // ── Commit / finish a placement ──────────────────────────────────
  function commitDrawing(type, pts, extra) {
    const d = Object.assign({ id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, type, pts }, extra || {});
    userDrawings.push(d);
    saveDrawings();
    resetPlacement();
    if (_stayMode) { drawChart(); } else { setActiveTool('cursor'); }
    drawChart();
  }

  function finishClickN(type) {
    if (_pts.length < 2) { resetPlacement(); drawChart(); return; }
    commitDrawing(type, _pts.slice());
  }

  // ── Canvas interaction (capture phase — see file header) ────────
  canvas.addEventListener('mousedown', (e) => {
    if (activeTool === 'cursor') { handleSelectClick(e); return; }
    if (activeTool === 'crosshair') return; // let existing hover behaviour run

    const { x, y } = mousePixel(e);
    let data = pixelToData(x, y);
    if (!data) return;
    data = applyMagnet(data);
    e.stopPropagation();
    e.preventDefault();

    const meta = TOOL_META[activeTool];
    if (!meta) return;

    if (meta.mode === 'point1') {
      commitDrawing(activeTool, [data]);
    } else if (meta.mode === 'text') {
      const label = prompt('Label text:');
      if (label && label.trim()) commitDrawing('text', [data], { text: label.trim() });
    } else if (meta.mode === 'emoji') {
      // The Icon rail button already opened the picker and set _pendingEmoji
      // before arming this tool — a canvas click just stamps it.
      if (_pendingEmoji) commitDrawing('emoji', [data], { emoji: _pendingEmoji });
    } else if (meta.mode === 'line2') {
      if (!_pts.length) { _pts = [data]; _previewPt = data; }
      else { commitDrawing(activeTool, [_pts[0], data]); }
      drawChart();
    } else if (meta.mode === 'click3') {
      _pts.push(data);
      _previewPt = data;
      if (_pts.length >= 3) commitDrawing(activeTool, _pts.slice());
      drawChart();
    } else if (meta.mode === 'clickN') {
      _pts.push(data);
      _previewPt = data;
      drawChart();
    } else if (meta.mode === 'drag2') {
      _dragStart = data;
      _dragging = true;
      drawChart();
    } else if (meta.mode === 'freehand') {
      _freehandPts = [data];
      _dragging = true;
    } else if (meta.mode === 'measure') {
      _dragStart = data;
      _dragging = true;
      _measureResult = null;
    } else if (meta.mode === 'zoom') {
      _zoomBox = { x1: x, x2: x };
      _dragging = true;
    }
  }, true);

  canvas.addEventListener('mousemove', (e) => {
    if (activeTool === 'cursor' || activeTool === 'crosshair') return;
    const { x, y } = mousePixel(e);
    const meta = TOOL_META[activeTool];
    if (!meta) return;

    if (meta.mode === 'line2' && _pts.length) {
      e.stopPropagation();
      _previewPt = applyMagnet(pixelToData(x, y));
      drawChart();
    } else if (meta.mode === 'click3' && _pts.length) {
      e.stopPropagation();
      _previewPt = applyMagnet(pixelToData(x, y));
      drawChart();
    } else if (meta.mode === 'clickN' && _pts.length) {
      e.stopPropagation();
      _previewPt = pixelToData(x, y);
      drawChart();
    } else if (meta.mode === 'drag2' && _dragging) {
      e.stopPropagation();
      _previewPt = applyMagnet(pixelToData(x, y));
      drawChart();
    } else if (meta.mode === 'freehand' && _dragging) {
      e.stopPropagation();
      const d = pixelToData(x, y);
      if (d) _freehandPts.push(d);
      drawChart();
    } else if (meta.mode === 'measure' && _dragging) {
      e.stopPropagation();
      _measureLive = { p1: _dragStart, p2: pixelToData(x, y) };
      drawChart();
    } else if (meta.mode === 'zoom' && _dragging) {
      e.stopPropagation();
      _zoomBox.x2 = x;
      drawChart();
    }
  }, true);

  canvas.addEventListener('dblclick', (e) => {
    const meta = TOOL_META[activeTool];
    if (meta && meta.mode === 'clickN' && _pts.length >= 2) {
      e.stopPropagation();
      e.preventDefault();
      finishClickN(activeTool);
    }
  }, true);

  canvas.addEventListener('mouseup', (e) => {
    const meta = TOOL_META[activeTool];
    if (!meta) return;

    if (meta.mode === 'drag2' && _dragging) {
      const { x, y } = mousePixel(e);
      const data = applyMagnet(pixelToData(x, y));
      if (data && _dragStart) {
        e.stopPropagation();
        commitDrawing(activeTool, [_dragStart, data]);
      } else {
        resetPlacement(); drawChart();
      }
    } else if (meta.mode === 'freehand' && _dragging) {
      e.stopPropagation();
      if (_freehandPts && _freehandPts.length > 1) commitDrawing(activeTool, _freehandPts.slice());
      else { resetPlacement(); drawChart(); }
    } else if (meta.mode === 'measure' && _dragging) {
      e.stopPropagation();
      const { x, y } = mousePixel(e);
      _measureResult = { p1: _dragStart, p2: pixelToData(x, y) };
      _measureLive = null;
      _dragging = false;
      _dragStart = null;
      drawChart();
    } else if (meta.mode === 'zoom' && _dragging) {
      e.stopPropagation();
      applyZoomBox();
    }
  }, true);

  function applyZoomBox() {
    const r = window._lastRender;
    _dragging = false;
    if (r && _zoomBox && Math.abs(_zoomBox.x2 - _zoomBox.x1) > 8) {
      const i1 = pixelToData(_zoomBox.x1, 0);
      const i2 = pixelToData(_zoomBox.x2, 0);
      if (i1 && i2) {
        const loIdx = Math.max(0, Math.min(i1.index, i2.index));
        const hiIdx = Math.min(r.displayData.length - 1, Math.max(i1.index, i2.index));
        const candleCount = Math.max(5, Math.round(hiIdx - loIdx) + 1);
        const chartWidth = r.width - r.padding.left - r.padding.right;
        // Bare identifiers, not window.* — zoomLevel/panOffset are top-level
        // `let` bindings in candlestick-data.js (a classic script), which are
        // script-scope lexical bindings, not window properties.
        zoomLevel = Math.max(0.3, Math.min(4, chartWidth / (8 * candleCount)));
        panOffset = Math.max(0, r.displayData.length - Math.round(hiIdx) - 1);
      }
    }
    _zoomBox = null;
    setActiveTool('cursor');
  }

  // ── Icon (emoji/symbol) picker — a flyout opened directly from the rail
  // button (like Lines/Fib/Shapes), with category tabs and an Emojis/Icons
  // tab bar, matching TradingView's picker. Pick an item here first; the
  // tool then arms and a canvas click stamps the chosen item — the same
  // two-step "pick, then place" flow as every other tool in this file, just
  // with the picker itself surfaced up front instead of buried behind a
  // canvas click. Icons are real single-codepoint Unicode symbols (no
  // custom artwork/image assets), not the sticker packs TradingView also
  // offers — those are licensed image assets this app has no source for.
  const EMOJI_DATA = {
    trading:  { label: '📈', items: ['📈','📉','🚀','🔥','💰','⚠️','🎯','✅','❌','⭐','🐂','🐻','💡','🔔','🛑','🚧','💵','💎','🤑','📊'] },
    smileys:  { label: '😀', items: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','😘','😋','😛','😜','🤪','😎','🥳','😔','😕','🙁','☹️','😖','😢','😭','😤','😠','😡','🤯','😱','😨','😰','😥','🤗','🤔','😶','😐','😑','🙄','😯','😮','😲','😴','🤤'] },
    gestures: { label: '👍', items: ['👍','👎','👏','🙌','🤝','🙏','✊','✌️','🤞','🤟','👋','🤙','👊','🖐️','☝️'] },
    symbols:  { label: '❤️', items: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯','✔️','✖️','➕','➖','⭐','🌟','✨','⚡','🚩','🏁'] },
    nature:   { label: '🌿', items: ['🌱','🌿','🍀','🌳','🌲','🌴','🌵','🌸','🌼','🌻','☀️','🌙','☁️','🌈','☔','⛈️','❄️','☃️','🌊','🔥'] },
    currency: { label: '💵', items: ['💵','💴','💶','💷','💰','💳','🪙','💸'] },
    objects:  { label: '💡', items: ['💡','🔔','🔒','🔓','🔑','📌','📍','📎','✂️','🗑️','📅','⏰','⏳','📁','📄','📋','🖊️','📏','🔍','🎯'] },
  };
  const ICON_DATA = {
    symbols:  { label: '✓', items: ['▲','▼','◆','◇','■','□','●','○','★','☆','✓','✕','➤','→','←','↑','↓','⚑','⚐','✚','−','✱'] },
    currency: { label: '$', items: ['€','£','$','₹','¥','₽','₩','₺','₿','¢'] },
    misc:     { label: '☺', items: ['☺','☹','☎','☏','☐','☑','☒','☀','☁','☂','☃','☄','☕','☮','☯','☠','⚠','⚙','⚖','⚡','⌘','⌥','⏎','⏱','⏲','⏰'] },
  };

  let _pendingEmoji = null;
  let _emojiMainTab = 'emojis';
  let _emojiCat = 'trading';

  const emojiFlyoutEl = document.getElementById('tvEmojiFlyout');
  const emojiCatTabsEl = document.getElementById('tvEmojiCatTabs');
  const emojiGridEl = document.getElementById('tvEmojiGrid');
  const emojiIconBtn = railEl.querySelector('.tv-rail-btn[data-tool="emoji"]');

  function closeEmojiFlyout() {
    if (emojiFlyoutEl) emojiFlyoutEl.style.display = 'none';
  }

  function currentEmojiDataset() {
    return _emojiMainTab === 'icons' ? ICON_DATA : EMOJI_DATA;
  }

  function renderEmojiCatTabs() {
    if (!emojiCatTabsEl) return;
    const dataset = currentEmojiDataset();
    if (!dataset[_emojiCat]) _emojiCat = Object.keys(dataset)[0];
    emojiCatTabsEl.innerHTML = Object.entries(dataset).map(([key, cat]) =>
      `<button type="button" class="tv-emoji-cattab${key === _emojiCat ? ' active' : ''}" data-cat="${key}">${cat.label}</button>`
    ).join('');
  }

  function renderEmojiGrid() {
    if (!emojiGridEl) return;
    const dataset = currentEmojiDataset();
    const cat = dataset[_emojiCat];
    if (!cat) return;
    const label = _emojiMainTab === 'icons' ? _emojiCat : _emojiCat;
    emojiGridEl.innerHTML = `
      <div class="tv-emoji-section-label">${label.toUpperCase()}</div>
      <div class="tv-emoji-section-items">
        ${cat.items.map(ch => `<button type="button" class="tv-emoji-item" data-char="${ch}">${ch}</button>`).join('')}
      </div>`;
  }

  function renderEmojiFlyout() {
    renderEmojiCatTabs();
    renderEmojiGrid();
  }

  if (emojiCatTabsEl) {
    emojiCatTabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.tv-emoji-cattab');
      if (!btn) return;
      _emojiCat = btn.dataset.cat;
      renderEmojiFlyout();
    });
  }

  if (emojiGridEl) {
    emojiGridEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.tv-emoji-item');
      if (!btn) return;
      _pendingEmoji = btn.dataset.char;
      closeEmojiFlyout();
      setActiveTool('emoji');
    });
  }

  if (emojiFlyoutEl) {
    emojiFlyoutEl.querySelectorAll('.tv-emoji-maintab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _emojiMainTab = tabBtn.dataset.maintab;
        _emojiCat = Object.keys(currentEmojiDataset())[0];
        emojiFlyoutEl.querySelectorAll('.tv-emoji-maintab').forEach(t => t.classList.toggle('active', t === tabBtn));
        renderEmojiFlyout();
      });
    });
  }

  function openEmojiFlyout() {
    if (!emojiFlyoutEl || !emojiIconBtn) return;
    closeFlyouts();
    renderEmojiFlyout();
    const rect = emojiIconBtn.getBoundingClientRect();
    emojiFlyoutEl.style.display = 'flex';
    emojiFlyoutEl.style.left = `${rect.right + 8}px`;
    emojiFlyoutEl.style.top = `${safeFlyoutTop(Math.max(8, rect.top - 4))}px`;
  }

  if (emojiIconBtn) {
    emojiIconBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (emojiFlyoutEl && emojiFlyoutEl.style.display !== 'none') { closeEmojiFlyout(); return; }
      openEmojiFlyout();
    });
  }

  document.addEventListener('click', (e) => {
    if (emojiFlyoutEl && emojiFlyoutEl.style.display !== 'none'
        && !e.target.closest('.tv-emoji-flyout') && e.target !== emojiIconBtn) {
      closeEmojiFlyout();
    }
  });

  // ── Select / delete an existing drawing (cursor mode) ────────────
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Reduce any drawing to a list of pixel-space segments (or a single
  // point, or a full horizontal/vertical line) to hit-test against — a
  // generic approximation good enough for click-to-select rather than a
  // bespoke test per tool.
  function getHitGeometry(d, canvasWidth, canvasHeight) {
    const pxPts = d.pts.map(p => dataToPixel(p.index, p.price)).filter(Boolean);
    if (!pxPts.length) return null;

    // hline/hray/vline/crossline are *infinite* lines through a single
    // anchor point — proximity to the anchor pixel itself is the wrong
    // test (that pixel is just wherever the price/index happened to be
    // when placed); test distance to the whole line instead.
    if (d.type === 'hline' || d.type === 'hray') {
      return { hLineY: pxPts[0].y };
    }
    if (d.type === 'vline') {
      return { vLineX: pxPts[0].x };
    }
    if (d.type === 'crossline') {
      return { hLineY: pxPts[0].y, vLineX: pxPts[0].x };
    }

    if (pxPts.length === 1) return { points: pxPts };
    if (d.type === 'triangle') {
      return { segments: [[pxPts[0], pxPts[1]], [pxPts[1], pxPts[2]], [pxPts[2], pxPts[0]]] };
    }
    if (d.type === 'ray' || d.type === 'extendedline') {
      const [a, b] = pxPts;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ext = 2000;
      const far = { x: a.x + (dx / len) * ext, y: a.y + (dy / len) * ext };
      const near = d.type === 'extendedline' ? { x: a.x - (dx / len) * ext, y: a.y - (dy / len) * ext } : a;
      return { segments: [[near, far]] };
    }
    if (['rect', 'circle', 'ellipse'].includes(d.type)) {
      const [a, b] = pxPts;
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      return { segments: [
        [{ x: x1, y: y1 }, { x: x2, y: y1 }], [{ x: x2, y: y1 }, { x: x2, y: y2 }],
        [{ x: x2, y: y2 }, { x: x1, y: y2 }], [{ x: x1, y: y2 }, { x: x1, y: y1 }],
      ] };
    }
    const segments = [];
    for (let i = 0; i < pxPts.length - 1; i++) segments.push([pxPts[i], pxPts[i + 1]]);
    return { segments };
  }

  function hitTest(px, py) {
    const tol = 6;
    for (let i = userDrawings.length - 1; i >= 0; i--) {
      const d = userDrawings[i];
      const geo = getHitGeometry(d);
      if (!geo) continue;
      if (geo.hLineY != null && Math.abs(py - geo.hLineY) <= tol) return d.id;
      if (geo.vLineX != null && Math.abs(px - geo.vLineX) <= tol) return d.id;
      if (geo.points) {
        if (Math.hypot(px - geo.points[0].x, py - geo.points[0].y) <= tol + 6) return d.id;
      } else if (geo.segments) {
        for (const [a, b] of geo.segments) {
          if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= tol) return d.id;
        }
      }
    }
    return null;
  }

  function handleSelectClick(e) {
    const { x, y } = mousePixel(e);
    const id = hitTest(x, y);
    if (id !== _selectedId) { _selectedId = id; drawChart(); }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEmojiFlyout();
      closeFlyouts();
      resetPlacement();
      _measureResult = null;
      _measureLive = null;
      if (activeTool !== 'cursor') setActiveTool('cursor'); else drawChart();
      return;
    }
    if (e.key === 'Enter') {
      const meta = TOOL_META[activeTool];
      if (meta && meta.mode === 'clickN' && _pts.length >= 2) finishClickN(activeTool);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeTool === 'cursor' && _selectedId && !_lockAll) {
      const idx = userDrawings.findIndex(d => d.id === _selectedId);
      if (idx !== -1) {
        // Don't hijack Backspace while the user is typing in an input/textarea elsewhere on the page.
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        userDrawings.splice(idx, 1);
        _selectedId = null;
        saveDrawings();
        drawChart();
      }
    }
  });

  // ── Rendering helpers ─────────────────────────────────────────────
  function fibLevels(kind) {
    if (kind === 'retracement') return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    return [0, 0.382, 0.618, 1, 1.272, 1.618, 2]; // extension / channel / trend-based extension
  }

  function smoothPath(ctx, pxPts) {
    if (pxPts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pxPts[0].x, pxPts[0].y);
    for (let i = 1; i < pxPts.length - 1; i++) {
      const mx = (pxPts[i].x + pxPts[i + 1].x) / 2;
      const my = (pxPts[i].y + pxPts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pxPts[i].x, pxPts[i].y, mx, my);
    }
    const last = pxPts[pxPts.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }

  function drawArrowhead(ctx, from, to, size) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 7), to.y - size * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 7), to.y - size * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  // ── Render one committed drawing ──────────────────────────────────
  function renderOne(ctx, width, d, lineColor, fillColor, gainColor, lossColor) {
    const pxPts = d.pts.map(p => dataToPixel(p.index, p.price)).filter(Boolean);
    if (!pxPts.length) return;
    const selected = d.id === _selectedId;
    ctx.save();
    ctx.strokeStyle = selected ? '#ffb020' : lineColor;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = selected ? 2.2 : 1.5;
    ctx.font = _dtFont('11px "Space Mono", monospace');

    switch (d.type) {
      case 'trendline': case 'arrow': {
        const [a, b] = pxPts;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (d.type === 'arrow') { ctx.fillStyle = ctx.strokeStyle; drawArrowhead(ctx, a, b, 9); }
        break;
      }
      case 'trendangle': {
        const [a, b] = pxPts;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const angleDeg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180 / Math.PI).toFixed(1);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(`${angleDeg}°`, a.x + 6, a.y - 6);
        break;
      }
      case 'ray': {
        const [a, b] = pxPts;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ext = 2000; // px, far enough past the visible canvas
        const bx = a.x + (dx / len) * ext, by = a.y + (dy / len) * ext;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(bx, by); ctx.stroke();
        break;
      }
      case 'extendedline': {
        const [a, b] = pxPts;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ext = 2000;
        ctx.beginPath();
        ctx.moveTo(a.x - (dx / len) * ext, a.y - (dy / len) * ext);
        ctx.lineTo(a.x + (dx / len) * ext, a.y + (dy / len) * ext);
        ctx.stroke();
        break;
      }
      case 'hline': {
        ctx.save(); ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(0, pxPts[0].y); ctx.lineTo(width, pxPts[0].y); ctx.stroke();
        ctx.restore();
        ctx.fillText(d.pts[0].price.toFixed(2), width - 55, pxPts[0].y - 4);
        break;
      }
      case 'hray': {
        ctx.save(); ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(pxPts[0].x, pxPts[0].y); ctx.lineTo(width, pxPts[0].y); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'vline': {
        ctx.save(); ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(pxPts[0].x, 0); ctx.lineTo(pxPts[0].x, ctx.canvas.height); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'crossline': {
        ctx.save(); ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(0, pxPts[0].y); ctx.lineTo(width, pxPts[0].y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pxPts[0].x, 0); ctx.lineTo(pxPts[0].x, ctx.canvas.height); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'parallelchannel': case 'fibchannel': {
        const [a, b, c] = pxPts;
        if (!c) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); break; }
        const offY = c.y - (a.y + (b.y - a.y) * ((c.x - a.x) / ((b.x - a.x) || 1)));
        const a2 = { x: a.x, y: a.y + offY }, b2 = { x: b.x, y: b.y + offY };
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
        if (d.type === 'fibchannel') {
          fibLevels('retracement').forEach((r) => {
            if (r === 0 || r === 1) return;
            ctx.save(); ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y + offY * r); ctx.lineTo(b.x, b.y + offY * r); ctx.stroke();
            ctx.restore();
          });
        } else {
          ctx.save(); ctx.globalAlpha = 0.12; ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'fibretracement': {
        const [a, b] = pxPts;
        const p1 = d.pts[0].price, p2 = d.pts[1].price;
        fibLevels('retracement').forEach((ratio) => {
          const price = p1 + (p2 - p1) * ratio;
          const y = dataToPixel(0, price).y;
          ctx.save(); ctx.setLineDash(ratio === 0 || ratio === 1 ? [] : [4, 3]);
          ctx.globalAlpha = 0.75;
          ctx.beginPath(); ctx.moveTo(Math.min(a.x, b.x), y); ctx.lineTo(width - 60, y); ctx.stroke();
          ctx.restore();
          ctx.fillText(`${(ratio * 100).toFixed(1)}% ${price.toFixed(2)}`, width - 58, y - 3);
        });
        break;
      }
      case 'fibextension': case 'fibtrendext': {
        const [a, b, c] = pxPts;
        if (d.type === 'fibtrendext' && b) { ctx.save(); ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore(); }
        if (!c) break;
        const p1 = d.pts[0].price, p2 = d.pts[1].price, p3 = d.pts[2].price;
        const diff = p2 - p1;
        fibLevels('extension').forEach((ratio) => {
          const price = p3 + diff * ratio;
          const y = dataToPixel(0, price).y;
          ctx.save(); ctx.setLineDash(ratio === 0 ? [] : [4, 3]); ctx.globalAlpha = 0.75;
          ctx.beginPath(); ctx.moveTo(c.x, y); ctx.lineTo(width - 60, y); ctx.stroke();
          ctx.restore();
          ctx.fillText(`${(ratio * 100).toFixed(1)}% ${price.toFixed(2)}`, width - 58, y - 3);
        });
        break;
      }
      case 'rect': {
        const [a, b] = pxPts;
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        break;
      }
      case 'rotatedrect': {
        // Simplified equivalent: pts[0]->pts[1] form one edge (length + angle),
        // pts[2]'s perpendicular distance from that edge sets the depth.
        const [a, b, c] = pxPts;
        if (!c) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); break; }
        const ex = b.x - a.x, ey = b.y - a.y;
        const elen = Math.hypot(ex, ey) || 1;
        const nx = -ey / elen, ny = ex / elen; // unit normal
        const dist = (c.x - a.x) * nx + (c.y - a.y) * ny;
        const p1 = a, p2 = b, p3 = { x: b.x + nx * dist, y: b.y + ny * dist }, p4 = { x: a.x + nx * dist, y: a.y + ny * dist };
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'circle': {
        const [a, b] = pxPts;
        const radius = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.beginPath(); ctx.arc(a.x, a.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      }
      case 'ellipse': {
        const [a, b] = pxPts;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      }
      case 'triangle': {
        if (pxPts.length < 3) break;
        ctx.beginPath(); ctx.moveTo(pxPts[0].x, pxPts[0].y);
        ctx.lineTo(pxPts[1].x, pxPts[1].y); ctx.lineTo(pxPts[2].x, pxPts[2].y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'polyline': {
        ctx.beginPath(); ctx.moveTo(pxPts[0].x, pxPts[0].y);
        pxPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'path': case 'brush': case 'highlighter': {
        ctx.save();
        if (d.type === 'highlighter') { ctx.lineWidth = 8; ctx.globalAlpha = 0.35; ctx.lineCap = 'round'; }
        ctx.beginPath(); ctx.moveTo(pxPts[0].x, pxPts[0].y);
        pxPts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'curve': {
        smoothPath(ctx, pxPts);
        break;
      }
      case 'doublecurve': {
        smoothPath(ctx, pxPts);
        ctx.save(); ctx.globalAlpha = 0.55;
        const offset = pxPts.map(p => ({ x: p.x, y: p.y + 14 }));
        smoothPath(ctx, offset);
        ctx.restore();
        break;
      }
      case 'arrowmarker': {
        const p = pxPts[0];
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.bezierCurveTo(p.x - 8, p.y - 14, p.x - 8, p.y - 26, p.x, p.y - 26);
        ctx.bezierCurveTo(p.x + 8, p.y - 26, p.x + 8, p.y - 14, p.x, p.y);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        break;
      }
      case 'arrowup': case 'arrowdown': {
        const p = pxPts[0];
        const up = d.type === 'arrowup';
        ctx.fillStyle = up ? gainColor : lossColor;
        ctx.strokeStyle = ctx.fillStyle;
        const y0 = up ? p.y : p.y - 16, y1 = up ? p.y - 16 : p.y;
        ctx.beginPath(); ctx.moveTo(p.x, y0); ctx.lineTo(p.x, y1); ctx.stroke();
        drawArrowhead(ctx, { x: p.x, y: up ? y0 : y1 - 1 }, { x: p.x, y: y1 }, 8);
        break;
      }
      case 'text': {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = _dtFont('13px "DM Sans", sans-serif');
        ctx.fillText(d.text || '', pxPts[0].x, pxPts[0].y);
        break;
      }
      case 'emoji': {
        ctx.font = _dtFont('22px sans-serif');
        ctx.fillText(d.emoji || '', pxPts[0].x - 11, pxPts[0].y + 8);
        break;
      }
    }
    if (selected) {
      pxPts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffb020'; ctx.fill();
      });
    }
    ctx.restore();
  }

  function renderMeasure(ctx, m, lineColor) {
    if (!m || !m.p1 || !m.p2) return;
    const a = dataToPixel(m.p1.index, m.p1.price);
    const b = dataToPixel(m.p2.index, m.p2.price);
    if (!a || !b) return;
    const priceDiff = m.p2.price - m.p1.price;
    const pctDiff = m.p1.price ? (priceDiff / m.p1.price) * 100 : 0;
    const bars = Math.round(m.p2.index - m.p1.index);
    ctx.save();
    const up = priceDiff >= 0;
    const boxColor = up ? 'rgba(0,200,120,0.25)' : 'rgba(230,60,60,0.25)';
    ctx.strokeStyle = up ? '#00c878' : '#e63c3c';
    ctx.fillStyle = boxColor;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.setLineDash([]);
    ctx.fillStyle = lineColor;
    ctx.font = _dtFont('bold 12px "Space Mono", monospace');
    const label = `${priceDiff >= 0 ? '+' : ''}${priceDiff.toFixed(2)} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(2)}%)  ${Math.abs(bars)} bars`;
    ctx.fillText(label, Math.min(a.x, b.x), Math.min(a.y, b.y) - 6);
    ctx.restore();
  }

  function renderZoomBox(ctx, height) {
    if (!_zoomBox) return;
    const { x1, x2 } = _zoomBox;
    ctx.save();
    ctx.fillStyle = 'rgba(0,150,255,0.12)';
    ctx.strokeStyle = 'rgba(0,150,255,0.6)';
    ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), height);
    ctx.strokeRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), height);
    ctx.restore();
  }

  // ── Render: called from the end of drawChart() in candlestick-draw.js ──
  window.drawUserAnnotations = function (ctx, width, priceHeight) {
    loadDrawingsIfSymbolChanged();

    const isLight = document.documentElement.classList.contains('light-mode');
    const lineColor = isLight ? 'rgba(8,145,178,0.85)' : 'rgba(0,245,196,0.85)';
    const fillColor = isLight ? 'rgba(8,145,178,0.12)' : 'rgba(0,245,196,0.12)';
    const gainColor = isLight ? '#0a9d5c' : '#00f5c4';
    const lossColor = isLight ? '#d13c3c' : '#ff5c7a';

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, priceHeight);
    ctx.clip();

    if (!_hideAll) {
      userDrawings.forEach((d) => renderOne(ctx, width, d, lineColor, fillColor, gainColor, lossColor));
    }

    // Live preview while placing a multi-step drawing.
    if (_pts.length && _previewPt) {
      const meta = TOOL_META[activeTool];
      const preview = { id: '__preview__', type: activeTool, pts: [..._pts, _previewPt] };
      ctx.save(); ctx.globalAlpha = 0.7; ctx.setLineDash([3, 3]);
      renderOne(ctx, width, preview, lineColor, fillColor, gainColor, lossColor);
      ctx.restore();
    }
    if (_dragStart && _previewPt && TOOL_META[activeTool] && TOOL_META[activeTool].mode === 'drag2') {
      ctx.save(); ctx.globalAlpha = 0.7;
      renderOne(ctx, width, { id: '__preview__', type: activeTool, pts: [_dragStart, _previewPt] }, lineColor, fillColor, gainColor, lossColor);
      ctx.restore();
    }
    if (_freehandPts && _freehandPts.length > 1) {
      renderOne(ctx, width, { id: '__preview__', type: activeTool, pts: _freehandPts }, lineColor, fillColor, gainColor, lossColor);
    }
    if (_measureLive) renderMeasure(ctx, _measureLive, lineColor);
    else if (_measureResult) renderMeasure(ctx, _measureResult, lineColor);
    if (_zoomBox) renderZoomBox(ctx, priceHeight);

    ctx.restore();
  };
})();
