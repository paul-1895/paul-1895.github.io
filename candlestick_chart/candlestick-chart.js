/* ================================================================
   candlestick-chart.js  —  6-Month OHLCV Candlestick Chart
   Self-contained, no dependencies. Pure Canvas 2D.
   Reads CSS variables for theme-aware colours.

   Data source: GET /candlestick_chart/candle_information/BPML.json
   (array of OHLCV rows, see _load())
   Fields used per row: Date, Open, High, Low, Close, Volume

   Usage: window.initCandlestickChart(code) — called from company.js
   ================================================================ */

'use strict';

(function () {

  /* ── State ─────────────────────────────────────────────────── */
  let _code        = null;
  let _allCandles  = [];   // full loaded history
  let _candles     = [];   // currently displayed (period-filtered)
  let _visStart    = 0;
  let _visCount    = 60;
  let _isDragging  = false;
  let _dragStartX  = 0;
  let _dragStartVis= 0;
  let _crosshair   = null;
  let _canvas      = null;
  let _rafId       = null;

  /* ── Apply period filter ────────────────────────────────────── */
  function _applyPeriod() {
    const months = PERIOD_BTNS[_activePeriod]?.months ?? 6;
    if (!_allCandles.length) return;

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutStr = cutoff.toISOString().slice(0, 10);

    _candles  = _allCandles.filter(c => c.date >= cutStr);
    if (!_candles.length) _candles = _allCandles; // fallback to all
    _visCount = _candles.length;  // show all of the period at once
    _visStart = 0;
  }

  /* ── MA config ──────────────────────────────────────────────── */
  const MA_LINES = [
    { key: 'ma20',   label: 'MA20',   period: 20,  type: 'sma', color: '#f0a830', active: true  },
    { key: 'ma50',   label: 'MA50',   period: 50,  type: 'sma', color: '#a78bfa', active: true  },
    { key: 'ema20',  label: 'EMA20',  period: 20,  type: 'ema', color: '#38bdf8', active: false },
    { key: 'ema200', label: 'EMA200', period: 200, type: 'ema', color: '#f87171', active: false },
  ];

  const PERIOD_BTNS = [
    { label: '1M', months: 1 },
    { label: '3M', months: 3 },
    { label: '6M', months: 6 },
    { label: '1Y', months: 12 },
  ];
  let _activePeriod = 2; // default 6M index

  /* ── Public init ────────────────────────────────────────────── */
  window.initCandlestickChart = function (code) {
    _code = code.toUpperCase();
    _buildShell();
    // Wait one animation frame so the injected DOM is fully painted
    requestAnimationFrame(() => _load());
  };

  /* ── Build DOM shell ────────────────────────────────────────── */
  function _buildShell() {
    const section = document.getElementById('candlestick-section');
    if (!section) return;

    section.innerHTML = `
<div class="cs-card">
  <div class="cs-header">
    <div class="cs-title">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:.7">
        <path d="M9 3v4M9 17v4M15 3v4M15 17v4"/>
        <rect x="6" y="7" width="6" height="10" rx="1"/>
        <rect x="12" y="5" width="6" height="14" rx="1"/>
      </svg>
      Price History · <span style="color:var(--accent);letter-spacing:1px">${_code}</span>
    </div>
    <div class="cs-controls">
      <div class="cs-period-group" id="cs-period-group">
        ${PERIOD_BTNS.map((b, i) =>
          `<button class="cs-period-btn${i === _activePeriod ? ' active' : ''}"
                   data-idx="${i}" onclick="window._csPeriod(${i})">${b.label}</button>`
        ).join('')}
      </div>
      <div class="cs-divider"></div>
      <div class="cs-ma-group" id="cs-ma-group">
        ${MA_LINES.map(ma =>
          `<button class="cs-ma-btn${ma.active ? ' active' : ''}"
                   data-key="${ma.key}"
                   style="--ma-color:${ma.color}"
                   onclick="window._csToggleMA('${ma.key}')">${ma.label}</button>`
        ).join('')}
      </div>
      <div class="cs-divider"></div>
      <div class="cs-zoom-group">
        <button class="cs-zoom-btn" onclick="window._csZoom(-1)" title="Zoom in">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button class="cs-zoom-btn" onclick="window._csZoom(1)" title="Zoom out">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button class="cs-zoom-btn" onclick="window._csReset()" title="Reset view">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
      </div>
    </div>
  </div>

  <div class="cs-legend" id="cs-legend"></div>

  <div class="cs-loading" id="cs-loading">
    <div class="cs-spinner"></div>
    <span>Loading price history…</span>
  </div>

  <div class="cs-error" id="cs-error" style="display:none">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="currentColor"/>
    </svg>
    <span id="cs-error-msg">Could not load price history.</span>
  </div>

  <div class="cs-chart-wrap" id="cs-chart-wrap" style="display:none">
    <canvas id="cs-canvas" style="display:block;width:100%;cursor:crosshair"></canvas>
  </div>

  <div class="cs-hint">Scroll to zoom · drag to pan · hover for OHLCV</div>
</div>`;

    // Expose period switcher — slices candles by month count
    window._csPeriod = function (idx) {
      _activePeriod = idx;
      document.querySelectorAll('.cs-period-btn').forEach((b, i) =>
        b.classList.toggle('active', i === idx));
      _applyPeriod();
      _buildMASeries();
      _show('chart');
      _bindEvents();
      _scheduleRedraw();
    };

    // Expose MA toggle globally
    window._csToggleMA = function (key) {
      const ma = MA_LINES.find(m => m.key === key);
      if (!ma) return;
      ma.active = !ma.active;
      const btn = document.querySelector(`.cs-ma-btn[data-key="${key}"]`);
      if (btn) btn.classList.toggle('active', ma.active);
      _scheduleRedraw();
    };

    // Zoom controls
    window._csZoom = function (dir) {
      // dir: -1 = zoom in (fewer candles), +1 = zoom out (more candles)
      const delta = Math.max(5, Math.round(_visCount * 0.2)) * dir;
      const mid   = _visStart + Math.round(_visCount / 2);
      _visCount   = Math.max(10, Math.min(_candles.length, _visCount + delta));
      _visStart   = Math.max(0, Math.min(_candles.length - _visCount, mid - Math.round(_visCount / 2)));
      _scheduleRedraw();
    };

    window._csReset = function () {
      _applyPeriod();
      _scheduleRedraw();
    };
  }

  /* ── Fetch data ─────────────────────────────────────────────── */
  async function _load() {
    _show('loading');
    console.log(`[CandlestickChart] Loading data for ${_code}…`);

    // The per-symbol JSON file is the only source. A second entry used to sit
    // here pointing at /api/candlestick/:code — a route that has never existed
    // server-side, so the loop below always succeeded on the first path and
    // never revealed the dead one.
    const paths = [
      `/historical_prices/json_files/${_code}.json`,
    ];

    let rows = null;
    let lastErr = '';

    for (const jsonPath of paths) {
      try {
        const response = await fetch(jsonPath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        rows = Array.isArray(data) ? data : (data.candles || data.data || null);
        if (rows && rows.length) { console.log(`[CandlestickChart] ✅ Loaded ${rows.length} rows from ${jsonPath}`); break; }
      } catch (e) {
        lastErr = `${jsonPath}: ${e.message}`;
        console.warn(`[CandlestickChart] ⚠️ ${lastErr}`);
        rows = null;
      }
    }

    if (!rows || !rows.length) {
      _show('error', `No price history data available for ${_code}`);
      return;
    }

      // Map JSON rows → candle objects
      const jsonCandles = [];
      for (const row of rows) {
        const candle = {
          date:   row.Date || row.date || '',
          open:   parseFloat(row.Open  ?? row.open)  || null,
          high:   parseFloat(row.High  ?? row.high)  || null,
          low:    parseFloat(row.Low   ?? row.low)   || null,
          close:  parseFloat(row.Close ?? row.close),
          volume: parseFloat(row.Volume ?? row.volume) || 0
        };
        if (candle.date && candle.close != null && !isNaN(candle.close)) {
          jsonCandles.push(candle);
        }
      }

      if (!jsonCandles.length) {
        _show('error', `No valid OHLCV data found for ${_code}`);
        return;
      }

      // JSON is newest-first; sort ascending so chart renders oldest→newest left→right
      jsonCandles.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

      _allCandles = jsonCandles;  // keep full history for period switching
      _applyPeriod();

      console.log(`[CandlestickChart] ✅ Parsed ${_allCandles.length} candles, showing ${_candles.length}`);
      _buildMASeries();
      _show('chart');
      _bindEvents();
      _scheduleRedraw();
  }

  /* ── State switcher ─────────────────────────────────────────── */
  function _show(state, msg) {
    const section = document.getElementById('candlestick-section');
    const loading = document.getElementById('cs-loading');
    const error   = document.getElementById('cs-error');
    const wrap    = document.getElementById('cs-chart-wrap');

    // If shell hasn't been built yet (element IDs missing), rebuild
    if (!loading && section) { _buildShell(); return _show(state, msg); }
    if (!loading) return;

    loading.style.display = state === 'loading' ? 'flex' : 'none';
    error.style.display   = state === 'error'   ? 'flex' : 'none';
    wrap.style.display    = state === 'chart'   ? 'block' : 'none';
    if (state === 'error' && msg) {
      const msgEl = document.getElementById('cs-error-msg');
      if (msgEl) msgEl.textContent = msg;
    }
  }

  /* ── Event binding ──────────────────────────────────────────── */
  function _bindEvents() {
    _canvas = document.getElementById('cs-canvas');
    if (!_canvas || _canvas._csBound) return;
    _canvas._csBound = true;

    // Wheel zoom
    _canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 5 : -5;
      const mid   = _visStart + Math.round(_visCount / 2);
      _visCount   = Math.max(10, Math.min(_candles.length, _visCount + delta));
      _visStart   = Math.max(0, Math.min(_candles.length - _visCount, mid - Math.round(_visCount / 2)));
      _scheduleRedraw();
    }, { passive: false });

    // Drag pan
    _canvas.addEventListener('mousedown', e => {
      _isDragging   = true;
      _dragStartX   = e.clientX;
      _dragStartVis = _visStart;
    });
    window.addEventListener('mouseup', () => { _isDragging = false; });
    _canvas.addEventListener('mousemove', e => {
      const rect = _canvas.getBoundingClientRect();
      const x    = (e.clientX - rect.left) * (_canvas.width / rect.width);
      const y    = (e.clientY - rect.top)  * (_canvas.height / rect.height);

      if (_isDragging) {
        const dx    = e.clientX - _dragStartX;
        const DPR   = window.devicePixelRatio || 1;
        const W     = _canvas.width / DPR;
        const bW    = W / _visCount;
        const shift = Math.round(-dx / bW);
        _visStart   = Math.max(0, Math.min(_candles.length - _visCount, _dragStartVis + shift));
      }

      // Crosshair: find nearest candle by x
      const DPR  = window.devicePixelRatio || 1;
      const W    = _canvas.width / DPR;
      const PAD  = _pad();
      const cW   = W - PAD.l - PAD.r;
      const bW   = cW / _visCount;
      const rawI = Math.round((x / DPR - PAD.l) / bW - 0.5);
      const idx  = Math.max(0, Math.min(_visCount - 1, rawI));
      _crosshair = { x, y: y, idx: _visStart + idx };
      _updateLegend(_crosshair.idx);
      _scheduleRedraw();
    });
    _canvas.addEventListener('mouseleave', () => {
      _crosshair = null;
      _updateLegend(null);
      _scheduleRedraw();
    });

    // Touch pan (basic)
    let _touchX = 0, _touchVis = 0;
    _canvas.addEventListener('touchstart', e => {
      _touchX   = e.touches[0].clientX;
      _touchVis = _visStart;
    }, { passive: true });
    _canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      const dx   = e.touches[0].clientX - _touchX;
      const DPR  = window.devicePixelRatio || 1;
      const W    = _canvas.width / DPR;
      const bW   = W / _visCount;
      const shift= Math.round(-dx / bW);
      _visStart  = Math.max(0, Math.min(_candles.length - _visCount, _touchVis + shift));
      _scheduleRedraw();
    }, { passive: false });

    // Resize
    new ResizeObserver(() => _scheduleRedraw()).observe(_canvas.parentElement);
  }

  /* ── Moving average calculations ───────────────────────────── */
  function _calcSMA(period) {
    const out = new Array(_candles.length).fill(null);
    for (let i = period - 1; i < _candles.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += _candles[i - j].close;
      out[i] = sum / period;
    }
    return out;
  }

  function _calcEMA(period) {
    const out = new Array(_candles.length).fill(null);
    const k   = 2 / (period + 1);
    // Seed with SMA of first `period` candles
    let sum = 0;
    for (let i = 0; i < period; i++) sum += _candles[i].close;
    out[period - 1] = sum / period;
    for (let i = period; i < _candles.length; i++) {
      out[i] = _candles[i].close * k + out[i - 1] * (1 - k);
    }
    return out;
  }

  /* Pre-compute all MA series whenever candles change */
  function _buildMASeries() {
    MA_LINES.forEach(ma => {
      ma.values = ma.type === 'ema' ? _calcEMA(ma.period) : _calcSMA(ma.period);
    });
  }

  /* ── Legend ─────────────────────────────────────────────────── */
  function _updateLegend(idx) {
    const el = document.getElementById('cs-legend');
    if (!el) return;
    if (idx == null || !_candles[idx]) { el.innerHTML = ''; return; }
    const c   = _candles[idx];
    const dir = c.close >= c.open ? 'gain' : 'loss';
    const chg = c.close - c.open;
    const pct = c.open ? ((chg / c.open) * 100).toFixed(2) : '0.00';
    const sign= chg >= 0 ? '+' : '';

    // Active MA values at this index
    const maHtml = MA_LINES.filter(m => m.active && m.values && m.values[idx] != null)
      .map(m => `<span class="cs-leg-item" style="color:${m.color}">${m.label} <strong>${_fmtP(m.values[idx])}</strong></span>`)
      .join('');

    el.innerHTML = `
      <span class="cs-leg-date">${c.date}</span>
      <span class="cs-leg-item">O <strong>${_fmtP(c.open)}</strong></span>
      <span class="cs-leg-item">H <strong>${_fmtP(c.high)}</strong></span>
      <span class="cs-leg-item">L <strong>${_fmtP(c.low)}</strong></span>
      <span class="cs-leg-item cs-leg-${dir}">C <strong>${_fmtP(c.close)}</strong></span>
      <span class="cs-leg-item cs-leg-${dir}">${sign}${_fmtP(chg)} (${sign}${pct}%)</span>
      <span class="cs-leg-item cs-leg-vol">Vol <strong>${_fmtVol(c.volume)}</strong></span>
      ${maHtml}`;
  }

  /* ── Schedule redraw ────────────────────────────────────────── */
  function _scheduleRedraw() {
    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(_draw);
  }

  /* ── Main draw ──────────────────────────────────────────────── */
  function _draw() {
    _rafId = null;
    const canvas = document.getElementById('cs-canvas');
    if (!canvas || !_candles.length) return;

    // Sync DPR
    const DPR   = window.devicePixelRatio || 1;
    const rect  = canvas.parentElement.getBoundingClientRect();
    const W     = rect.width  || 800;
    const H_TOT = Math.max(320, Math.min(480, W * 0.42));
    const H_VOL = 70;
    const H_PRC = H_TOT - H_VOL - 8;  // gap between panes

    if (canvas.width !== Math.round(W * DPR) || canvas.height !== Math.round(H_TOT * DPR)) {
      canvas.width  = Math.round(W * DPR);
      canvas.height = Math.round(H_TOT * DPR);
      canvas.style.height = H_TOT + 'px';
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H_TOT);

    const cv  = p => getComputedStyle(document.documentElement).getPropertyValue(p).trim();
    const COL = {
      gain:    cv('--gain')         || '#22d47a',
      loss:    cv('--loss')         || '#f04f5a',
      text:    cv('--text-primary') || '#e2eaf6',
      muted:   cv('--text-muted')  || '#64748b',
      border:  cv('--border')      || '#334155',
      accent:  cv('--accent')      || '#3b82f6',
      bg:      cv('--bg-card')     || '#161b22',
    };

    const PAD  = _pad();
    const cW   = W - PAD.l - PAD.r;
    const bW   = cW / _visCount;

    const vis  = _candles.slice(_visStart, _visStart + _visCount);

    // ── Price range — clamp MA extension to candle low, not below ──
    const maxH = Math.max(...vis.map(c => c.high  ?? c.close));
    const minL = Math.min(...vis.map(c => c.low   ?? c.close));
    let   extMax = maxH, extMin = minL;
    MA_LINES.forEach(ma => {
      if (!ma.active || !ma.values) return;
      for (let i = _visStart; i < _visStart + _visCount; i++) {
        const v = ma.values[i];
        if (v == null || v <= 0) continue;
        if (v > extMax) extMax = v;
        // Only extend downward if MA is within 20% of candle low (avoid distortion)
        if (v < extMin && v > minL * 0.8) extMin = v;
      }
    });
    const span = (extMax - extMin) || 1;
    const yPad = span * 0.06;
    const yMin = extMin - yPad;
    const yMax = extMax + yPad;
    const ySpan= yMax - yMin;
    const yPx  = v => PAD.top + H_PRC - ((v - yMin) / ySpan) * H_PRC;

    // ── Y-grid ───────────────────────────────────────────────────
    ctx.strokeStyle = COL.border;
    ctx.lineWidth   = 0.5;
    ctx.font        = `10px monospace`;
    ctx.fillStyle   = COL.muted;
    ctx.textAlign   = 'right';
    ctx.textBaseline= 'middle';
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const v = yMin + (ySpan / gridLines) * i;
      const y = yPx(v);
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(PAD.l + cW, y);
      ctx.stroke();
      ctx.fillText('৳' + _fmtP(v), PAD.l - 6, y);
    }

    // ── Volume range ─────────────────────────────────────────────
    const maxVol = Math.max(...vis.map(c => c.volume || 0)) || 1;
    const volTop = H_PRC + 8 + PAD.top;
    const volH   = H_VOL - 10;
    const vPx    = v => volTop + volH - (v / maxVol) * volH;

    // ── X-axis labels ────────────────────────────────────────────
    ctx.fillStyle   = COL.muted;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'top';
    ctx.font        = '9px monospace';
    const labelEvery = Math.max(1, Math.floor(_visCount / 8));
    vis.forEach((c, i) => {
      if (i % labelEvery !== 0) return;
      const x = PAD.l + i * bW + bW / 2;
      // Shorten date: "2024-06-15" → "Jun 15"
      const d   = new Date(c.date);
      const lbl = isNaN(d) ? c.date : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      ctx.fillText(lbl, x, H_TOT - PAD.bot + 4);
    });

    // ── Draw candles & wicks ─────────────────────────────────────
    const minBW = 1;
    const bodyW = Math.max(minBW, bW * 0.55);
    const wickW = Math.max(0.5, bW * 0.08);

    vis.forEach((c, i) => {
      const x      = PAD.l + i * bW + bW / 2;
      const isGain = c.close >= c.open;
      const col    = isGain ? COL.gain : COL.loss;

      const oY  = yPx(c.open);
      const cY  = yPx(c.close);
      const hY  = yPx(c.high);
      const lY  = yPx(c.low);
      const top = Math.min(oY, cY);
      const bH  = Math.max(1, Math.abs(cY - oY));

      // Wick
      ctx.strokeStyle = col;
      ctx.lineWidth   = wickW;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x, hY);
      ctx.lineTo(x, lY);
      ctx.stroke();

      // Body
      ctx.fillStyle   = col;
      ctx.globalAlpha = isGain ? 0.88 : 0.92;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x - bodyW / 2, top, bodyW, bH, Math.min(2, bodyW * 0.15));
        ctx.fill();
      } else {
        ctx.fillRect(x - bodyW / 2, top, bodyW, bH);
      }
      ctx.globalAlpha = 1;

      // Volume bar
      if (c.volume) {
        const vH  = Math.max(1, (c.volume / maxVol) * volH);
        ctx.fillStyle   = col;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x - bodyW / 2, vPx(c.volume), bodyW, vH);
        ctx.globalAlpha = 1;
      }
    });

    // ── Moving average lines ──────────────────────────────────────
    ctx.globalAlpha = 1;
    MA_LINES.forEach(ma => {
      if (!ma.active || !ma.values) return;

      ctx.strokeStyle = ma.color;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash(ma.type === 'ema' ? [5, 3] : []);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();

      let started = false;
      for (let i = 0; i < _visCount; i++) {
        const absIdx = _visStart + i;
        const val    = ma.values[absIdx];
        if (val == null) { started = false; continue; }
        const x = PAD.l + i * bW + bW / 2;
        const y = yPx(val);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else            ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Label at right edge
      const lastI = _visCount - 1;
      for (let i = lastI; i >= 0; i--) {
        const val = ma.values[_visStart + i];
        if (val == null) continue;
        const x = PAD.l + i * bW + bW / 2;
        const y = yPx(val);
        // Pill label
        ctx.font      = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const lbl  = ma.label;
        const tw   = ctx.measureText(lbl).width;
        const px   = Math.min(x + 4, PAD.l + cW - tw - 6);
        ctx.fillStyle   = ma.color + '28'; // translucent bg
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px - 2, y - 7, tw + 6, 14, 3);
        else ctx.rect(px - 2, y - 7, tw + 6, 14);
        ctx.fill();
        ctx.fillStyle = ma.color;
        ctx.fillText(lbl, px, y);
        break;
      }
    });

    // ── Vol label ────────────────────────────────────────────────
    ctx.fillStyle    = COL.muted;
    ctx.font         = 'bold 9px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('VOLUME', PAD.l, volTop + 2);

    // ── Crosshair ────────────────────────────────────────────────
    if (_crosshair) {
      const ci   = _crosshair.idx - _visStart;
      if (ci >= 0 && ci < _visCount) {
        const cx = PAD.l + ci * bW + bW / 2;
        ctx.strokeStyle = COL.muted;
        ctx.lineWidth   = 0.7;
        ctx.setLineDash([4, 3]);

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(cx, PAD.top);
        ctx.lineTo(cx, H_TOT - PAD.bot);
        ctx.stroke();

        ctx.setLineDash([]);

        // Highlight dot at close price
        const c  = _candles[_crosshair.idx];
        if (c) {
          const py = yPx(c.close);
          ctx.fillStyle = c.close >= c.open ? COL.gain : COL.loss;
          ctx.beginPath();
          ctx.arc(cx, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ── Scrollbar indicator ───────────────────────────────────────
    if (_candles.length > _visCount) {
      const sbY  = H_TOT - PAD.bot + 16;
      const sbW  = cW;
      const sbH  = 2;
      const pct  = _visStart / (_candles.length - _visCount);
      const thW  = Math.max(20, sbW * (_visCount / _candles.length));
      const thX  = PAD.l + pct * (sbW - thW);

      ctx.fillStyle   = COL.border;
      ctx.fillRect(PAD.l, sbY, sbW, sbH);
      ctx.fillStyle   = COL.accent;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(thX, sbY, thW, sbH);
      ctx.globalAlpha = 1;
    }
  }

  /* ── Padding helper ─────────────────────────────────────────── */
  function _pad() {
    return { top: 20, r: 14, bot: 28, l: 62 };
  }

  /* ── Format helpers ─────────────────────────────────────────── */
  function _fmtP(n) {
    if (n == null || isNaN(n)) return '—';
    return parseFloat(n).toLocaleString('en-BD', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  }

  function _fmtVol(n) {
    if (!n) return '—';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K';
    return n.toLocaleString();
  }

})();