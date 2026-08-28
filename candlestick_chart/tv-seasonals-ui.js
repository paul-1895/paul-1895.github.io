'use strict';

/* ════════════════════════════════════════════════════════════
   tv-seasonals-ui.js
   Renders the "Seasonals" panel (#tvSeasonalsPanel in
   candlestick.html) — year x month returns table, "Rises and
   falls" + Average/Median summary rows, a bar-chart alternative
   view, a dual-handle year-range slider, and Percent/Points +
   Average/Median controls. Toggled via the Seasonals button in
   the toolbar (#seasonalsToggleBtn).

   Standalone page only — not loaded by company_profile/company.html,
   same as the other tv-*.js layout pieces.

   Data comes from tv-seasonals.js's computeSeasonalData() /
   computeSeasonalMonthStats(), fed with the raw `chartData` global
   (always the unaggregated daily series — seasonality is a calendar
   concept, independent of the D/W/M candle-interval toggle).
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --sans / --mono tokens for
// canvas, falling back to the authored literal when that file isn't on
// the page. See candlestick-draw.js.
const _seaTheme = window.DSEChartTheme;
const _seaFont  = spec => (_seaTheme ? _seaTheme.font(spec) : spec);

(function () {
  const toggleBtn = document.getElementById('seasonalsToggleBtn');
  const panel = document.getElementById('tvSeasonalsPanel');
  if (!toggleBtn || !panel) return; // not on this page

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let _seasOpen = false;
  let _seasViewMode = 'table';   // 'table' | 'chart'
  let _seasUnitMode = 'percent'; // 'percent' | 'points'
  let _seasStatMode = 'average'; // 'average' | 'median'
  let _seasSymbol = null;
  let _seasCache = null;         // last computeSeasonalData() result
  let _companyNames = null;      // code -> full company name, fetched once from /api/company-names
  let _companyNamesPromise = null;
  let _seasAllMin = null, _seasAllMax = null; // full available year bounds
  let _seasYearMin = null, _seasYearMax = null; // slider-selected sub-range
  let _seasDraggingHandle = null; // 'min' | 'max' | null

  const _hiddenEls = []; // {el, prevDisplay} — restored exactly on close

  function hideWithRestore(elOrSelector) {
    const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
    if (!el) return;
    _hiddenEls.push({ el, prevDisplay: el.style.display });
    el.style.display = 'none';
  }
  function restoreHidden() {
    _hiddenEls.splice(0).forEach(({ el, prevDisplay }) => { el.style.display = prevDisplay; });
  }

  function getSeasSymbol() {
    const el = document.getElementById('tvTicker');
    return el ? el.textContent.trim().toUpperCase() : 'UNKNOWN';
  }

  // Fetched once and cached — matches the TradingView header, which shows the
  // full company name ("Walton Hi-Tech Industries PLC · Seasonals"), not
  // the bare ticker. Falls back to the ticker itself if the lookup fails.
  function ensureCompanyNames() {
    if (!_companyNamesPromise) {
      _companyNamesPromise = fetch('/api/company-names')
        .then((r) => r.json())
        .then((data) => { _companyNames = data.names || {}; })
        .catch(() => { _companyNames = {}; });
    }
    return _companyNamesPromise;
  }

  function fmtCell(v, unitMode) {
    if (v == null) return '—';
    const sign = v > 0 ? '+' : '';
    return unitMode === 'points' ? `${sign}${v.toFixed(2)}` : `${sign}${v.toFixed(2)}%`;
  }

  function cellClass(v) {
    if (v == null) return 'empty';
    if (Math.abs(v) < 0.005) return 'flat';
    return v > 0 ? 'gain' : 'loss';
  }

  // Heatmap intensity is always keyed off the underlying % change
  // (not the currently-displayed unit) so "Points" mode still shows
  // a meaningful, cross-comparable color scale.
  function cellBg(pct) {
    if (pct == null || Math.abs(pct) < 0.005) return '';
    const a = Math.min(1, Math.abs(pct) / 10); // full intensity by +-10%
    const varName = pct > 0 ? '--gain' : '--loss';
    return ` style="background: color-mix(in srgb, var(${varName}) ${Math.round(15 + a * 55)}%, transparent);"`;
  }

  // ── Panel skeleton (built once, first time the view is opened) ──
  function ensurePanelSkeleton() {
    if (panel.dataset.built === '1') return;
    panel.dataset.built = '1';
    panel.innerHTML = `
      <div class="tv-seas-header">
        <div class="tv-seas-header-left">
          <div class="tv-seas-view-toggle" id="tvSeasViewToggle">
            <button class="tv-seas-icon-btn" data-view="chart" type="button" title="Chart view" aria-label="Chart view">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 6"/></svg>
            </button>
            <button class="tv-seas-icon-btn active" data-view="table" type="button" title="Table view" aria-label="Table view">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
            </button>
          </div>
          <div class="tv-seas-title"><span id="tvSeasSymbolName">—</span><span class="tv-seas-title-sep">&middot;</span>Seasonals</div>
        </div>
        <div class="tv-seas-header-right">
          <select class="tv-seas-select" id="tvSeasStatSelect" title="Summary statistic">
            <option value="average">Average</option>
            <option value="median">Median</option>
          </select>
          <select class="tv-seas-select" id="tvSeasUnitSelect" title="Value units">
            <option value="percent">Percent</option>
            <option value="points">Points</option>
          </select>
          <button class="tv-seas-back-btn" id="tvSeasBackBtn" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l-7-7 7-7M5 12h14"/></svg>
            Back to chart
          </button>
        </div>
      </div>

      <div class="tv-seas-slider-wrap">
        <div class="tv-seas-slider" id="tvSeasSlider">
          <div class="tv-seas-slider-track"></div>
          <div class="tv-seas-slider-range" id="tvSeasSliderRange">
            <svg class="tv-seas-slider-grip" viewBox="0 0 16 8" width="16" height="8"><circle cx="2" cy="4" r="1.3" fill="currentColor"/><circle cx="8" cy="4" r="1.3" fill="currentColor"/><circle cx="14" cy="4" r="1.3" fill="currentColor"/></svg>
          </div>
          <div class="tv-seas-slider-handle" id="tvSeasHandleMin" data-handle="min"></div>
          <div class="tv-seas-slider-handle" id="tvSeasHandleMax" data-handle="max"></div>
        </div>
        <div class="tv-seas-slider-labels">
          <span id="tvSeasYearMinLabel">—</span>
          <span id="tvSeasYearMaxLabel">—</span>
        </div>
      </div>

      <div class="tv-seas-body" id="tvSeasBody"></div>
    `;

    panel.querySelector('#tvSeasViewToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.tv-seas-icon-btn');
      if (!btn) return;
      _seasViewMode = btn.dataset.view;
      panel.querySelectorAll('.tv-seas-icon-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderSeasBody();
    });

    const statSelect = document.getElementById('tvSeasStatSelect');
    statSelect.value = _seasStatMode;
    statSelect.addEventListener('change', (e) => { _seasStatMode = e.target.value; renderSeasBody(); });

    const unitSelect = document.getElementById('tvSeasUnitSelect');
    unitSelect.value = _seasUnitMode;
    unitSelect.addEventListener('change', (e) => { _seasUnitMode = e.target.value; renderSeasBody(); });

    document.getElementById('tvSeasBackBtn').addEventListener('click', closeSeasonalsView);

    wireSlider();

    window.addEventListener('resize', () => {
      if (_seasOpen && _seasViewMode === 'chart') renderSeasBody();
    });
  }

  // ── Dual-handle year-range slider ──────────────────────────────
  function wireSlider() {
    const slider = document.getElementById('tvSeasSlider');
    const minHandle = document.getElementById('tvSeasHandleMin');
    const maxHandle = document.getElementById('tvSeasHandleMax');
    const rangeEl = document.getElementById('tvSeasSliderRange');

    let _panStartX = 0, _panStartMin = 0, _panStartMax = 0;

    function yearAtClientX(clientX) {
      const rect = slider.getBoundingClientRect();
      let frac = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      frac = Math.max(0, Math.min(1, frac));
      return _seasAllMin + frac * (_seasAllMax - _seasAllMin);
    }

    function onDrag(e) {
      if (!_seasDraggingHandle || _seasAllMin == null) return;
      const year = Math.round(yearAtClientX(e.clientX));
      if (_seasDraggingHandle === 'min') _seasYearMin = Math.min(year, _seasYearMax);
      else if (_seasDraggingHandle === 'max') _seasYearMax = Math.max(year, _seasYearMin);
      else if (_seasDraggingHandle === 'pan') {
        const deltaYears = Math.round(yearAtClientX(e.clientX) - yearAtClientX(_panStartX));
        const span = _panStartMax - _panStartMin;
        let newMin = _panStartMin + deltaYears;
        let newMax = _panStartMax + deltaYears;
        if (newMin < _seasAllMin) { newMin = _seasAllMin; newMax = newMin + span; }
        if (newMax > _seasAllMax) { newMax = _seasAllMax; newMin = newMax - span; }
        _seasYearMin = newMin;
        _seasYearMax = newMax;
      }
      renderSliderVisuals();
      renderSeasBody();
    }
    function endDrag() {
      _seasDraggingHandle = null;
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', endDrag);
    }
    function startDrag(which) {
      return (e) => {
        e.preventDefault();
        e.stopPropagation();
        _seasDraggingHandle = which;
        if (which === 'pan') {
          _panStartX = e.clientX;
          _panStartMin = _seasYearMin;
          _panStartMax = _seasYearMax;
        }
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', endDrag);
      };
    }
    minHandle.addEventListener('mousedown', startDrag('min'));
    maxHandle.addEventListener('mousedown', startDrag('max'));
    // Dragging the highlighted span itself pans the whole selected window
    // (both handles move together, clamped to the full available range) --
    // matches TradingView's slider, where you can shift the window without
    // resizing it.
    if (rangeEl) rangeEl.addEventListener('mousedown', startDrag('pan'));
  }

  function renderSliderVisuals() {
    if (_seasAllMin == null) return;
    const span = Math.max(1, _seasAllMax - _seasAllMin);
    const minPct = ((_seasYearMin - _seasAllMin) / span) * 100;
    const maxPct = ((_seasYearMax - _seasAllMin) / span) * 100;
    document.getElementById('tvSeasHandleMin').style.left = minPct + '%';
    document.getElementById('tvSeasHandleMax').style.left = maxPct + '%';
    const rangeEl = document.getElementById('tvSeasSliderRange');
    rangeEl.style.left = minPct + '%';
    rangeEl.style.width = Math.max(0, maxPct - minPct) + '%';
    document.getElementById('tvSeasYearMinLabel').textContent = _seasYearMin;
    document.getElementById('tvSeasYearMaxLabel').textContent = _seasYearMax;
  }

  // ── Data refresh (symbol switch / initial open) ────────────────
  function refreshSeasonalsForSymbol() {
    if (!_seasOpen) return;
    const symbol = getSeasSymbol();
    const symbolChanged = symbol !== _seasSymbol;
    _seasSymbol = symbol;
    const nameEl = document.getElementById('tvSeasSymbolName');
    if (nameEl) nameEl.textContent = symbol; // shown immediately; upgraded to the full name below once fetched
    ensureCompanyNames().then(() => {
      if (nameEl && _seasSymbol === symbol) nameEl.textContent = (_companyNames && _companyNames[symbol]) || symbol;
    });

    const seasData = (typeof window.computeSeasonalData === 'function')
      ? window.computeSeasonalData(typeof chartData !== 'undefined' ? chartData : [])
      : { years: [], monthsMatrix: {} };
    _seasCache = seasData;

    if (!seasData.years.length) {
      _seasAllMin = _seasAllMax = null;
      _seasYearMin = _seasYearMax = null;
    } else {
      _seasAllMin = seasData.years[0];
      _seasAllMax = seasData.years[seasData.years.length - 1];
      if (symbolChanged || _seasYearMin == null || _seasYearMax == null) {
        _seasYearMin = _seasAllMin;
        _seasYearMax = _seasAllMax;
      } else {
        _seasYearMin = Math.max(_seasAllMin, Math.min(_seasYearMin, _seasAllMax));
        _seasYearMax = Math.min(_seasAllMax, Math.max(_seasYearMax, _seasAllMin));
      }
    }
    renderSliderVisuals();
    renderSeasBody();
  }

  // ── Body render: table or chart ─────────────────────────────────
  function renderSeasBody() {
    const body = document.getElementById('tvSeasBody');
    if (!body) return;
    const seasData = _seasCache || { years: [], monthsMatrix: {} };
    if (!seasData.years.length || _seasAllMin == null) {
      body.innerHTML = '<div class="tv-seas-empty">No historical data available for this symbol yet.</div>';
      return;
    }
    const years = seasData.years
      .filter((y) => y >= _seasYearMin && y <= _seasYearMax)
      .sort((a, b) => b - a); // newest first
    const unitMode = _seasUnitMode === 'points' ? 'abs' : 'pct';
    const stats = window.computeSeasonalMonthStats(seasData.monthsMatrix, years, unitMode);

    if (_seasViewMode === 'table') {
      body.innerHTML = renderSeasTableHTML(seasData.monthsMatrix, years, stats);
    } else {
      body.innerHTML = '<div class="tv-seas-chart-wrap"><canvas id="tvSeasChartCanvas"></canvas></div>';
      requestAnimationFrame(() => drawSeasChart(stats));
    }
  }

  function renderSeasTableHTML(monthsMatrix, years, stats) {
    let html = '<div class="tv-seas-table-scroll"><table class="tv-seas-table"><thead><tr><th class="tv-seas-th-date">Date</th>';
    html += MONTH_NAMES_FULL.map((m) => `<th>${m}</th>`).join('');
    html += '</tr></thead><tbody>';

    years.forEach((y) => {
      html += `<tr><td class="tv-seas-year-cell">${y}</td>`;
      for (let m = 1; m <= 12; m++) {
        const cell = monthsMatrix[y] && monthsMatrix[y][m];
        const val = cell ? (_seasUnitMode === 'points' ? cell.abs : cell.pct) : null;
        html += `<td class="tv-seas-cell ${cellClass(val)}"${cellBg(cell ? cell.pct : null)}>${fmtCell(val, _seasUnitMode)}</td>`;
      }
      html += '</tr>';
    });

    html += '<tr class="tv-seas-summary-row"><td class="tv-seas-year-cell">Rises and falls</td>';
    for (let m = 1; m <= 12; m++) {
      const s = stats[m];
      if (!s || !s.count) { html += '<td class="tv-seas-cell empty">—</td>'; continue; }
      html += '<td class="tv-seas-cell tv-seas-rf-cell">';
      if (s.up)   html += `<span class="tv-seas-rf gain">&#9650;${s.up}</span>`;
      if (s.flat) html += `<span class="tv-seas-rf flat">&#9632;${s.flat}</span>`;
      if (s.down) html += `<span class="tv-seas-rf loss">&#9660;${s.down}</span>`;
      html += '</td>';
    }
    html += '</tr>';

    const statLabel = _seasStatMode === 'median' ? 'Median' : 'Average';
    html += `<tr class="tv-seas-summary-row"><td class="tv-seas-year-cell">${statLabel}</td>`;
    for (let m = 1; m <= 12; m++) {
      const s = stats[m];
      const val = s && s.count ? (_seasStatMode === 'median' ? s.median : s.mean) : null;
      html += `<td class="tv-seas-cell ${cellClass(val)}">${fmtCell(val, _seasUnitMode)}</td>`;
    }
    html += '</tr></tbody></table></div>';
    return html;
  }

  function drawSeasChart(stats) {
    const canvas = document.getElementById('tvSeasChartCanvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const width = Math.max(300, wrap.clientWidth);
    const height = 360;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cs = getComputedStyle(document.documentElement);
    const gain = cs.getPropertyValue('--gain').trim() || '#10b981';
    const loss = cs.getPropertyValue('--loss').trim() || '#ef4444';
    const textMuted = cs.getPropertyValue('--text-muted').trim() || '#6b7a99';
    const textPrimary = cs.getPropertyValue('--text-primary').trim() || '#e2eaf6';
    const border = cs.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)';

    const padding = { top: 24, right: 20, bottom: 30, left: 20 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;
    const baseline = padding.top + plotH / 2;

    const vals = MONTH_NAMES.map((_, i) => {
      const s = stats[i + 1];
      if (!s || !s.count) return null;
      return _seasStatMode === 'median' ? s.median : s.mean;
    });
    const maxAbs = Math.max(1e-6, ...vals.filter((v) => v != null).map((v) => Math.abs(v)));
    const barSlot = plotW / 12;
    const barWidth = barSlot * 0.55;

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, baseline);
    ctx.lineTo(width - padding.right, baseline);
    ctx.stroke();

    ctx.font = _seaFont('11px "DM Sans", sans-serif');
    ctx.textAlign = 'center';

    vals.forEach((v, i) => {
      const x = padding.left + barSlot * i + barSlot / 2;
      ctx.fillStyle = textMuted;
      ctx.fillText(MONTH_NAMES[i], x, height - 10);
      if (v == null) return;
      const barH = (Math.abs(v) / maxAbs) * (plotH / 2 - 10);
      ctx.fillStyle = v >= 0 ? gain : loss;
      if (v >= 0) ctx.fillRect(x - barWidth / 2, baseline - barH, barWidth, barH);
      else ctx.fillRect(x - barWidth / 2, baseline, barWidth, barH);
      ctx.fillStyle = textPrimary;
      const labelY = v >= 0 ? Math.max(12, baseline - barH - 6) : Math.min(height - 16, baseline + barH + 14);
      ctx.fillText(fmtCell(v, _seasUnitMode), x, labelY);
    });
  }

  // ── Open / close ─────────────────────────────────────────────────
  function openSeasonalsView() {
    _seasOpen = true;
    ensurePanelSkeleton();
    hideWithRestore('.chart-container');
    hideWithRestore('#indicatorInstanceBar');
    hideWithRestore('.strategy-controls');
    hideWithRestore('#tvRangeBar');
    hideWithRestore('#strategyTableWrap');
    hideWithRestore('.info-grid');
    hideWithRestore('#replayBar');
    panel.style.display = 'block';
    toggleBtn.classList.add('active');
    refreshSeasonalsForSymbol();
  }

  function closeSeasonalsView() {
    _seasOpen = false;
    restoreHidden();
    panel.style.display = 'none';
    toggleBtn.classList.remove('active');
    if (typeof drawChart === 'function') drawChart(); // container size may have changed
  }

  function toggleSeasonalsView() {
    if (_seasOpen) closeSeasonalsView();
    else openSeasonalsView();
  }

  toggleBtn.addEventListener('click', toggleSeasonalsView);

  // Called by candlestick-data.js's processChartData() on every load/switch.
  // No-op while the panel isn't open — next time it's opened it recomputes
  // fresh from the (by-then already updated) chartData anyway.
  window.refreshSeasonalsForSymbol = refreshSeasonalsForSymbol;
})();
