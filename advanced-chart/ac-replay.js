/* ════════════════════════════════════════════════════════════
   ac-replay.js
   Bar-by-bar chart replay for the Advanced Chart page — the
   Lightweight Charts v5 port of the replay subsystem that lives
   in candlestick_chart/candlestick-ui.js (enterReplayMode …
   _handleReplayBarSelect) plus _drawReplayCursor from
   candlestick-draw.js.

   The renderer already does the hard part: ac-render.js slices
   `data = data.slice(0, replayIndex)` whenever `replayMode` is on,
   so replay here is purely (a) driving the state globals, (b) the
   control-bar UI, (c) picking the start bar from a chart click and
   (d) painting the cursor through ACChart.addOverlayPainter().

   The six state globals — replayMode, replayIndex, replayPlaying,
   replaySpeed, _replayTimer, _selectingBar — are declared with `let`
   at the top level of candlestick-data.js. Top-level `let` lives in
   the global LEXICAL environment, not on `window`, so they are
   assigned here as bare identifiers: `window.replayIndex = n` would
   create a *different* variable that ac-render.js never reads.

   Depends on : candlestick-data.js (state globals, chartData,
                aggregatedData, chartType), ac-render.js (ACChart,
                drawChart, window._lastRender)
   Owns       : window.enterReplayMode / exitReplayMode /
                startSelectingBar / toggleReplayPlay / stepReplay /
                setReplaySpeed / toggleReplaySpeedMenu /
                closeReplaySpeedMenu / updateReplayUI /
                setupReplayKeyboardShortcuts / REPLAY_SPEEDS
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  // ── Speed table (same nine steps as the candlestick page) ──────
  const REPLAY_SPEEDS = [
    { label: '10x',  multiplier: 10,  desc: '10 upd per 1 sec' },
    { label: '7x',   multiplier: 7,   desc: '7 upd per 1 sec'  },
    { label: '5x',   multiplier: 5,   desc: '5 upd per 1 sec'  },
    { label: '3x',   multiplier: 3,   desc: '3 upd per 1 sec'  },
    { label: '1x',   multiplier: 1,   desc: '1 upd per 1 sec'  },
    { label: '0.5x', multiplier: 0.5, desc: '1 upd per 2 sec'  },
    { label: '0.3x', multiplier: 0.3, desc: '1 upd per 3 sec'  },
    { label: '0.2x', multiplier: 0.2, desc: '1 upd per 5 sec'  },
    { label: '0.1x', multiplier: 0.1, desc: '1 upd per 10 sec' },
  ];

  const CURSOR_PAINTER = 'replay-cursor';

  // ── Tiny helpers ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  function hasState() {
    // candlestick-data.js missing => nothing to drive. Never throw.
    try { return typeof replayIndex !== 'undefined'; } catch (e) { return false; }
  }
  function chartReady() {
    return !!(window.ACChart && typeof window.ACChart.ready === 'function' && window.ACChart.ready());
  }
  function redraw() {
    if (typeof drawChart === 'function') drawChart();
  }
  function killTimer() {
    if (typeof _replayTimer !== 'undefined' && _replayTimer) clearInterval(_replayTimer);
    _replayTimer = null;
  }

  /* The replay slice is taken from the data AFTER the chart-type transform
     (ac-render.js does Heikin-Ashi / Renko first, then `.slice(0, replayIndex)`),
     so "total bars" has to be measured on the transformed array too — Renko in
     particular emits a completely different bar count from its source candles.
     Memoised because the progress label asks for it on every tick. */
  let _fdCache = { key: '', data: [] };
  function fullData() {
    let src = [];
    try {
      src = (typeof aggregatedData !== 'undefined' && aggregatedData.length)
        ? aggregatedData
        : (typeof chartData !== 'undefined' ? chartData : []);
    } catch (e) { return []; }
    if (!src || !src.length) return [];

    const type = (typeof chartType !== 'undefined') ? chartType : 'candlestick';
    if (type !== 'heikinashi' && type !== 'renko') return src;

    const box = (typeof renkoBoxSize !== 'undefined') ? renkoBoxSize : 1;
    const key = type + '|' + src.length + '|' + (src[src.length - 1].Date || '') + '|' + box;
    if (_fdCache.key === key) return _fdCache.data;

    let out = src;
    try {
      if (type === 'heikinashi' && typeof calculateHeikinAshi === 'function') out = calculateHeikinAshi(src);
      else if (type === 'renko' && typeof calculateRenko === 'function') out = calculateRenko(src, box);
    } catch (e) { out = src; }
    _fdCache = { key, data: out };
    return out;
  }

  function totalBars() { return fullData().length; }

  // ════════════════════════════════════════════════════════════
  // DOM — the control bar
  // ════════════════════════════════════════════════════════════
  // Built here only if the page markup does not already carry it, so the
  // same code works whether or not advanced-chart.html ships #replayBar.
  // Class names / ids mirror candlestick.html exactly, which is what lets
  // candlestick-chart.css style it unchanged.

  const BAR_HTML = `
    <div class="replay-bar-inner">
      <div class="replay-bar-left">
        <button class="replay-btn replay-select-btn" id="replaySelectBtn"
                title="Click a bar on the chart to set the replay start">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12h8M7 8l-4 4 4 4M21 5v14"/>
          </svg>
          <span>Select Bar</span>
        </button>
        <div class="replay-progress-container">
          <div class="replay-progress-bar">
            <div class="replay-progress-fill" id="replayProgressFill"></div>
            <div class="replay-progress-thumb" id="replayProgressThumb"></div>
          </div>
          <span class="replay-progress-label" id="replayProgressLabel">—</span>
        </div>
      </div>

      <div class="replay-bar-center">
        <button class="replay-btn replay-back-btn" id="replayBackBtn" title="Step back (←)" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="20,4 9,12 20,20"/><line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" stroke-width="2.5"/>
          </svg>
        </button>
        <button class="replay-btn replay-play-btn" id="replayPlayBtn" title="Play / Pause (Space)" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor" class="replay-icon-play">
            <polygon points="5,4 19,12 5,20"/>
          </svg>
          <svg viewBox="0 0 24 24" fill="currentColor" class="replay-icon-pause" style="display:none;">
            <rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>
          </svg>
        </button>
        <button class="replay-btn replay-step-btn" id="replayStepBtn" title="Step forward (→)" disabled>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="4,4 15,12 4,20"/><line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" stroke-width="2.5"/>
          </svg>
        </button>
        <div class="replay-speed-control">
          <button class="replay-btn replay-speed-btn" id="replaySpeedBtn" title="Playback speed">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/>
            </svg>
            <span id="replaySpeedLabel">1x</span>
          </button>
        </div>
        <div class="replay-status-container">
          <span class="replay-status" id="replayStatus">Click chart to select start bar</span>
        </div>
      </div>

      <div class="replay-bar-right">
        <button class="replay-btn replay-exit-btn" id="replayExitBtn" title="Exit replay mode (Esc)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          <span>Exit</span>
        </button>
      </div>
    </div>`;

  function speedMenuHTML() {
    return '<div class="replay-speed-header">REPLAY SPEED</div>' +
      REPLAY_SPEEDS.map(s =>
        `<button class="replay-speed-option${s.multiplier === 1 ? ' active' : ''}" data-speed="${s.multiplier}">` +
        `<span class="rsm-mult">${s.label}</span><span class="rsm-desc">${s.desc}</span></button>`
      ).join('');
  }

  let _wired = false;

  function ensureBar() {
    let bar = $('replayBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'replayBar';
      bar.className = 'replay-bar';
      bar.style.display = 'none';
      bar.innerHTML = BAR_HTML;
      (document.body || document.documentElement).appendChild(bar);
    }
    let menu = $('replaySpeedMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'replaySpeedMenu';
      menu.className = 'replay-speed-menu';
      menu.style.display = 'none';
      menu.innerHTML = speedMenuHTML();
      (document.body || document.documentElement).appendChild(menu);
    }
    ensureBackButton(bar);
    wire(bar, menu);
    return bar;
  }

  /* advanced-chart.html ships the candlestick.html replay bar verbatim, which
     has forward-step but no back-step (the canvas page only offered back on
     ArrowLeft). stepReplay(-1) is a real control here, so give it a button
     rather than leaving it keyboard-only. No-op when one already exists. */
  function ensureBackButton(bar) {
    if (!bar || $('replayBackBtn')) return;
    const center = bar.querySelector('.replay-bar-center');
    if (!center) return;
    const playBtn = center.querySelector('.replay-play-btn') || center.firstElementChild;
    const b = document.createElement('button');
    b.className = 'replay-btn replay-back-btn';
    b.id = 'replayBackBtn';
    b.title = 'Step back (←)';
    b.disabled = true;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor">' +
      '<polygon points="20,4 9,12 20,20"/>' +
      '<line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" stroke-width="2.5"/></svg>';
    center.insertBefore(b, playBtn || null);
  }

  // Bind only where the markup has no inline onclick — a page that ships the
  // candlestick.html markup verbatim (onclick="stepReplay()" …) must not fire twice.
  function bind(el, fn) {
    if (!el || el.__acReplayBound) return;
    if (el.getAttribute && el.getAttribute('onclick')) return;
    el.__acReplayBound = true;
    el.addEventListener('click', (e) => { e.preventDefault(); fn(e); });
  }

  function wire(bar, menu) {
    if (_wired) return;
    _wired = true;

    bind($('replaySelectBtn'), () => window.startSelectingBar());
    bind($('replayPlayBtn'),   () => window.toggleReplayPlay());
    bind($('replayStepBtn'),   () => window.stepReplay(1));
    bind($('replayBackBtn'),   () => window.stepReplay(-1));
    bind($('replaySpeedBtn'),  () => window.toggleReplaySpeedMenu());
    bind($('replayExitBtn'),   () => window.exitReplayMode());
    if (bar) {
      bar.querySelectorAll('.replay-exit-btn').forEach(b => bind(b, () => window.exitReplayMode()));
    }
    if (menu) {
      menu.querySelectorAll('.replay-speed-option').forEach((opt) => {
        bind(opt, () => window.setReplaySpeed(parseFloat(opt.dataset.speed)));
      });
    }
    wireScrub(bar);
  }

  // Click / drag anywhere on the progress bar to seek.
  function wireScrub(bar) {
    const track = bar && bar.querySelector('.replay-progress-bar');
    if (!track || track.__acScrubBound) return;
    track.__acScrubBound = true;

    let dragging = false;
    const seek = (clientX) => {
      const total = totalBars();
      if (!total) return;
      const r = track.getBoundingClientRect();
      if (!r.width) return;
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      replayIndex = Math.max(1, Math.min(total, Math.round(pct * total)));
      _selectingBar = false;
      disarmPicker();
      redraw();
      keepEdgeVisible(true);
      window.updateReplayUI();
    };
    track.addEventListener('pointerdown', (e) => {
      if (!replayMode) return;
      dragging = true;
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
      replayPlaying = false; killTimer();
      seek(e.clientX);
      e.preventDefault();
    });
    track.addEventListener('pointermove', (e) => { if (dragging) seek(e.clientX); });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      try { track.releasePointerCapture(e.pointerId); } catch (err) {}
    };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);
  }

  // ════════════════════════════════════════════════════════════
  // Start-bar picker
  // ════════════════════════════════════════════════════════════
  // The canvas page listened for a click on #candleCanvas and re-derived the
  // visible window by hand. Here the chart owns the geometry, so the click x
  // goes straight through timeScale().coordinateToLogical(), with the
  // documented window._lastRender mapping as the fallback.

  let _pickHost = null;

  function barIndexAtX(x) {
    if (chartReady()) {
      try {
        const lg = window.ACChart.chart().timeScale().coordinateToLogical(x);
        if (lg != null && isFinite(lg)) return Math.round(lg);
      } catch (e) { /* fall through to _lastRender */ }
    }
    const r = window._lastRender;
    if (r && r.candleWidth && r.padding) {
      return Math.round(r.startIdx + (x - r.padding.left) / r.candleWidth - 0.5);
    }
    return null;
  }

  function onPickDown(e) {
    if (!hasState() || !replayMode || !_selectingBar) { disarmPicker(); return; }
    const host = _pickHost;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const idx = barIndexAtX(e.clientX - rect.left);
    if (idx == null) return;

    const data = (window.ACChart && window.ACChart.displayData()) || [];
    if (!data.length) return;
    const clamped = Math.max(0, Math.min(data.length - 1, idx));

    // Capture-phase: swallow this gesture so the drawing tools underneath
    // don't also treat it as the start of a trendline.
    e.preventDefault();
    e.stopPropagation();
    swallowNextClick();

    replayIndex   = clamped + 1;   // include the clicked candle
    _selectingBar = false;
    disarmPicker();

    redraw();
    keepEdgeVisible(true);
    window.updateReplayUI();
  }

  function swallowNextClick() {
    const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', eat, { capture: true, once: true });
    // If no click follows (drag, touch cancel), drop the trap on the next tick.
    setTimeout(() => window.removeEventListener('click', eat, true), 600);
  }

  function armPicker() {
    const host = chartReady() ? window.ACChart.container() : null;
    if (!host) return;
    if (_pickHost === host) { host.style.cursor = 'crosshair'; return; }
    disarmPicker();
    _pickHost = host;
    host.style.cursor = 'crosshair';
    host.title = 'Click to select the starting bar';
    host.addEventListener('pointerdown', onPickDown, true);
  }

  function disarmPicker() {
    if (!_pickHost) return;
    _pickHost.removeEventListener('pointerdown', onPickDown, true);
    _pickHost.style.cursor = '';
    _pickHost.title = '';
    _pickHost = null;
  }

  // ════════════════════════════════════════════════════════════
  // Keeping the replay edge on screen
  // ════════════════════════════════════════════════════════════
  // Slicing the data shortens the series, so the logical range LWC is holding
  // can end up entirely to the right of the remaining bars. After every
  // step/seek, nudge the range so the newest bar stays just inside the right
  // edge, preserving whatever zoom the user has chosen.
  function keepEdgeVisible(force) {
    if (!hasState() || !replayMode || !chartReady()) return;
    const last = replayIndex - 1;
    if (last < 0) return;
    let ts;
    try { ts = window.ACChart.chart().timeScale(); } catch (e) { return; }

    let r = null;
    try { r = ts.getVisibleLogicalRange(); } catch (e) { r = null; }

    let span = r ? (r.to - r.from) : 0;
    if (!isFinite(span) || span < 5) span = 120;

    const pad = Math.max(2, span * 0.1);
    const needs = force || !r || last > (r.to - 1.5) || last < r.from;
    if (!needs) return;

    const to = last + pad;
    try { ts.setVisibleLogicalRange({ from: to - span, to }); } catch (e) { /* range is advisory */ }
  }

  // ════════════════════════════════════════════════════════════
  // Replay cursor overlay
  // ════════════════════════════════════════════════════════════
  // The dashed vertical line + triangle that candlestick-draw.js's
  // _drawReplayCursor() painted on the last visible candle, re-expressed as an
  // ACChart overlay painter over the same window._lastRender geometry.
  function paintCursor(ctx, width) {
    if (!hasState() || !replayMode || !replayIndex) return;
    const r = window._lastRender;
    if (!r || !r.candleWidth || !r.padding || !r.displayData || !r.displayData.length) return;

    const lastIdx = r.displayData.length - 1;
    const x = r.padding.left + (lastIdx - r.startIdx + 0.5) * r.candleWidth;
    if (!isFinite(x) || x < -20 || x > width + 20) return;

    // Run the line to the base of the LAST pane, not the base of the
    // container — otherwise it bleeds over the time axis at the bottom.
    let bottom = 0;
    try {
      (window.ACChart.paneKeys() || []).forEach((k) => {
        bottom = Math.max(bottom, window.ACChart.paneTop(k) + window.ACChart.paneHeight(k));
      });
    } catch (e) { bottom = 0; }
    if (!bottom) bottom = Math.max(0, (r.height || 0) - 4);

    const top = 10;

    ctx.save();
    const accent = (window.ACChart && window.ACChart.colors) ? window.ACChart.colors().accent : '#00f5c4';
    const line = (window.ACChart && window.ACChart.alpha) ? window.ACChart.alpha(accent, 0.6) : 'rgba(0,245,196,0.6)';
    const fill = (window.ACChart && window.ACChart.alpha) ? window.ACChart.alpha(accent, 0.85) : 'rgba(0,245,196,0.85)';

    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, Math.max(top, bottom - 2));
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, top - 1);
    ctx.lineTo(x - 5, top - 9);
    ctx.lineTo(x + 5, top - 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function addCursor() {
    if (window.ACChart && window.ACChart.addOverlayPainter) {
      window.ACChart.addOverlayPainter(CURSOR_PAINTER, paintCursor);
    }
  }
  function removeCursor() {
    if (window.ACChart && window.ACChart.removeOverlayPainter) {
      window.ACChart.removeOverlayPainter(CURSOR_PAINTER);
      if (window.ACChart.repaintOverlay) window.ACChart.repaintOverlay();
    }
  }

  // ════════════════════════════════════════════════════════════
  // Public replay API (globals — inline onclick= and the shared
  // modules both reach these off window)
  // ════════════════════════════════════════════════════════════

  window.REPLAY_SPEEDS = REPLAY_SPEEDS;

  window.enterReplayMode = function enterReplayMode() {
    if (!hasState()) return;
    replayMode    = true;
    replayIndex   = 0;
    replayPlaying = false;
    _selectingBar = true;
    killTimer();

    const bar = ensureBar();
    if (bar) bar.style.display = 'flex';
    const btn = $('replayBtn');
    if (btn) btn.classList.add('active');

    addCursor();
    armPicker();
    redraw();
    window.updateReplayUI();
  };

  window.exitReplayMode = function exitReplayMode() {
    if (!hasState()) return;
    replayMode    = false;
    replayIndex   = 0;
    replayPlaying = false;
    _selectingBar = false;
    killTimer();

    const bar = $('replayBar');
    if (bar) bar.style.display = 'none';
    const btn = $('replayBtn');
    if (btn) btn.classList.remove('active');

    window.closeReplaySpeedMenu();
    disarmPicker();
    removeCursor();
    redraw();
    window.updateReplayUI();
  };

  window.startSelectingBar = function startSelectingBar() {
    if (!hasState()) return;
    if (!replayMode) { window.enterReplayMode(); return; }
    _selectingBar = true;
    replayPlaying = false;
    killTimer();
    armPicker();
    window.updateReplayUI();
  };

  window.toggleReplayPlay = function toggleReplayPlay() {
    if (!hasState() || replayIndex === 0) return;
    replayPlaying = !replayPlaying;
    if (replayPlaying) startInterval(); else killTimer();
    window.updateReplayUI();
  };

  /* dir > 0 steps forward, dir < 0 steps back. The candlestick page only had
     forward on the button and back on ArrowLeft; both live here. */
  window.stepReplay = function stepReplay(dir) {
    if (!hasState() || replayIndex === 0) return;
    replayPlaying = false;
    killTimer();
    if (dir != null && dir < 0) stepBack(); else advance();
    window.updateReplayUI();
  };

  window.setReplaySpeed = function setReplaySpeed(multiplier) {
    if (!hasState()) return;
    const n = parseFloat(multiplier);
    if (!isFinite(n) || n <= 0) return;
    replaySpeed = n;
    if (replayPlaying) startInterval();   // restart on the new cadence

    document.querySelectorAll('.replay-speed-option').forEach((opt) => {
      opt.classList.toggle('active', parseFloat(opt.dataset.speed) === n);
    });
    window.closeReplaySpeedMenu();
    window.updateReplayUI();
  };

  window.toggleReplaySpeedMenu = function toggleReplaySpeedMenu() {
    const menu = $('replaySpeedMenu');
    const btn  = $('replaySpeedBtn');
    if (!menu) return;
    const hidden = !menu.style.display || menu.style.display === 'none';
    if (!hidden) { window.closeReplaySpeedMenu(); return; }

    menu.style.display = 'block';
    if (btn) {
      const rect = btn.getBoundingClientRect();
      menu.style.left = rect.left + 'px';
      menu.style.top  = Math.max(8, rect.top - menu.offsetHeight - 8) + 'px';
    }
    setTimeout(() => document.addEventListener('click', closeSpeedMenuOutside), 0);
  };

  window.closeReplaySpeedMenu = function closeReplaySpeedMenu() {
    const menu = $('replaySpeedMenu');
    if (menu) menu.style.display = 'none';
    document.removeEventListener('click', closeSpeedMenuOutside);
  };

  function closeSpeedMenuOutside(e) {
    const menu = $('replaySpeedMenu');
    const btn  = $('replaySpeedBtn');
    if (menu && !menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
      window.closeReplaySpeedMenu();
    }
  }

  // ── Stepping ───────────────────────────────────────────────────
  function advance() {
    const total = totalBars();
    if (replayIndex < total) {
      replayIndex++;
      redraw();
      keepEdgeVisible(false);
      updateProgressLabel();
      updateProgressBar();
    } else {
      replayPlaying = false;
      killTimer();
      window.updateReplayUI();
    }
  }

  function stepBack() {
    if (replayIndex > 1) {
      replayIndex--;
      redraw();
      keepEdgeVisible(false);
      updateProgressLabel();
      updateProgressBar();
    }
  }

  function startInterval() {
    killTimer();
    // 10x => 100ms per bar, 1x => 1000ms, 0.1x => 10000ms.
    const ms = replaySpeed >= 1
      ? Math.round(1000 / replaySpeed)
      : Math.round((1 / replaySpeed) * 1000);
    _replayTimer = setInterval(advance, Math.max(40, ms));
  }

  // ── UI sync ────────────────────────────────────────────────────
  window.updateReplayUI = function updateReplayUI() {
    if (!hasState()) return;
    const playBtn   = $('replayPlayBtn');
    const selectBtn = $('replaySelectBtn');
    const stepBtn   = $('replayStepBtn');
    const backBtn   = $('replayBackBtn');
    const speedBtn  = $('replaySpeedBtn');
    const speedLbl  = $('replaySpeedLabel');

    if (playBtn) {
      const playIcon  = playBtn.querySelector('.replay-icon-play');
      const pauseIcon = playBtn.querySelector('.replay-icon-pause');
      if (playIcon)  playIcon.style.display  = replayPlaying ? 'none' : 'block';
      if (pauseIcon) pauseIcon.style.display = replayPlaying ? 'block' : 'none';
    }

    const noBar = replayIndex === 0;
    [playBtn, stepBtn, backBtn].forEach((b) => {
      if (!b) return;
      b.disabled = noBar;
      b.classList.toggle('replay-disabled', noBar);
    });
    if (backBtn) {
      const atStart = noBar || replayIndex <= 1;
      backBtn.disabled = atStart;
      backBtn.classList.toggle('replay-disabled', atStart);
    }
    if (selectBtn) selectBtn.classList.toggle('active', !!_selectingBar);

    const speed = REPLAY_SPEEDS.find(s => s.multiplier === replaySpeed);
    const label = speed ? speed.label : (replaySpeed + 'x');
    if (speedLbl) speedLbl.textContent = label;
    else if (speedBtn) speedBtn.textContent = label;

    updateProgressLabel();
    updateProgressBar();
  };

  function updateProgressLabel() {
    const statusEl = $('replayStatus');
    if (!statusEl) return;
    if (!hasState() || replayIndex === 0) {
      statusEl.textContent = 'Click chart to select start bar';
      return;
    }
    const data    = fullData();
    const total   = data.length;
    const current = Math.min(replayIndex, total);
    const candle  = data[current - 1];
    statusEl.textContent = candle
      ? candle.Date + '  (' + current + ' / ' + total + ')'
      : current + ' / ' + total;
  }

  function updateProgressBar() {
    const fill  = $('replayProgressFill');
    const thumb = $('replayProgressThumb');
    const label = $('replayProgressLabel');
    if (!fill && !thumb && !label) return;

    const total = totalBars();
    const pct = total > 0 ? Math.max(0, Math.min(100, (replayIndex / total) * 100)) : 0;
    if (fill)  fill.style.width = pct + '%';
    if (thumb) thumb.style.left = pct + '%';
    if (label) label.textContent = (!hasState() || replayIndex === 0) ? '—' : (replayIndex + ' / ' + total);
  }

  // ════════════════════════════════════════════════════════════
  // Keyboard: Space = play/pause, ←/→ = step, Esc = exit
  // ════════════════════════════════════════════════════════════
  function isTyping(e) {
    const t = (e && e.target) || document.activeElement;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  let _keysInstalled = false;
  window.setupReplayKeyboardShortcuts = function setupReplayKeyboardShortcuts() {
    if (_keysInstalled) return;
    _keysInstalled = true;
    window.addEventListener('keydown', (e) => {
      if (!hasState() || !replayMode) return;
      if (isTyping(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.code) {
        case 'Space':
          if (!replayIndex) return;
          e.preventDefault();
          window.toggleReplayPlay();
          break;
        case 'ArrowRight':
          if (!replayIndex) return;
          e.preventDefault();
          window.stepReplay(1);
          break;
        case 'ArrowLeft':
          if (!replayIndex) return;
          e.preventDefault();
          window.stepReplay(-1);
          break;
        case 'Escape':
          e.preventDefault();
          window.exitReplayMode();
          break;
        default:
          break;
      }
    });
  };

  // ── Boot ───────────────────────────────────────────────────────
  // Idempotent and DOM-order independent: ac-boot.js may or may not call
  // setupReplayKeyboardShortcuts(), and #replayBar may or may not be in the
  // markup by the time this file runs.
  function boot() {
    try { ensureBar(); } catch (e) { console.warn('[AC replay] bar mount', e); }
    window.setupReplayKeyboardShortcuts();
    if (hasState() && replayMode) { addCursor(); window.updateReplayUI(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // Small debug/test surface.
  window.ACReplay = {
    speeds: REPLAY_SPEEDS,
    fullData,
    totalBars,
    keepEdgeVisible,
    barIndexAtX,
  };

})();
