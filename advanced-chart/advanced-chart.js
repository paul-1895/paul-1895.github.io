/* ════════════════════════════════════════════════════════════
   advanced-chart.js
   Candlestick + volume view for any DSE-listed symbol, rendered
   with TradingView's open-source Lightweight Charts library
   (loaded from CDN in advanced-chart.html).

   Data source: historical_prices/json_files/{SYMBOL}.json — the
   same flat per-day OHLCV files the existing candlestick_chart
   page reads, fetched client-side with the same path-fallback
   pattern (candlestick_chart/candlestick-data.js loadData()).
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DEFAULT_SYMBOL = 'BPML';
  const INDEX_SYMBOLS = ['DSEX'];

  const dataPathCandidates = code => [
    `/historical_prices/json_files/${code}.json`,
    `historical_prices/json_files/${code}.json`,
    `./historical_prices/json_files/${code}.json`,
    `../historical_prices/json_files/${code}.json`,
  ];
  const SYMBOL_LIST_PATHS = [
    '/data/stock-categories.json',
    '../data/stock-categories.json',
    './data/stock-categories.json',
  ];

  const els = {
    input:     document.getElementById('ac-symbol-input'),
    dropdown:  document.getElementById('ac-symbol-dropdown'),
    tfSeg:     document.getElementById('ac-timeframe-seg'),
    typeSeg:   document.getElementById('ac-type-seg'),
    stats:     document.getElementById('ac-stats'),
    legend:    document.getElementById('ac-legend'),
    container: document.getElementById('ac-chart-container'),
    loading:   document.getElementById('ac-loading'),
    error:     document.getElementById('ac-error'),
  };

  let allSymbols       = [];
  let dailyBars        = [];   // ascending, deduped {dateKey, open, high, low, close, volume}
  let currentBars      = [];   // dailyBars aggregated to the active timeframe
  let currentSymbol    = '';
  let currentTimeframe = 'daily';
  let currentType      = 'candlestick';

  let chart, candleSeries, lineSeries, areaSeries, volumeSeries;

  // ── Theme tokens ──────────────────────────────────────────────
  function tok(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function chartColors() {
    return {
      bg:        tok('bg-card', '#ffffff'),
      border:    tok('border', '#e2e5ea'),
      text:      tok('text-secondary', '#3b4151'),
      textMuted: tok('text-muted', '#8a93a6'),
      gain:      tok('gain', '#0f9960'),
      loss:      tok('loss', '#d13f3f'),
      accent:    tok('accent', '#1a5cff'),
    };
  }

  function hexAlpha(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function applyTheme() {
    if (!chart) return;
    const c = chartColors();
    chart.applyOptions({
      layout: { background: { type: 'solid', color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.border }, horzLines: { color: c.border } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
      crosshair: {
        vertLine: { color: c.textMuted, labelBackgroundColor: c.accent },
        horzLine: { color: c.textMuted, labelBackgroundColor: c.accent },
      },
    });
    candleSeries?.applyOptions({
      upColor: c.gain, downColor: c.loss,
      borderUpColor: c.gain, borderDownColor: c.loss,
      wickUpColor: c.gain, wickDownColor: c.loss,
    });
    lineSeries?.applyOptions({ color: c.accent });
    areaSeries?.applyOptions({
      lineColor: c.accent,
      topColor: hexAlpha(c.accent, 0.35),
      bottomColor: hexAlpha(c.accent, 0.02),
    });
    if (volumeSeries && currentBars.length) volumeSeries.setData(toVolumeData(currentBars));
  }
  window.__acApplyTheme = applyTheme;

  // ── Chart setup ───────────────────────────────────────────────
  function initChart() {
    const c = chartColors();
    chart = LightweightCharts.createChart(els.container, {
      layout: { background: { type: 'solid', color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.border }, horzLines: { color: c.border } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border, rightOffset: 4, barSpacing: 8 },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: c.textMuted, labelBackgroundColor: c.accent },
        horzLine: { color: c.textMuted, labelBackgroundColor: c.accent },
      },
      autoSize: true,
    });

    candleSeries = chart.addCandlestickSeries({
      upColor: c.gain, downColor: c.loss, borderVisible: true,
      borderUpColor: c.gain, borderDownColor: c.loss,
      wickUpColor: c.gain, wickDownColor: c.loss,
    });
    lineSeries = chart.addLineSeries({ color: c.accent, lineWidth: 2, visible: false });
    areaSeries = chart.addAreaSeries({
      lineColor: c.accent, topColor: hexAlpha(c.accent, 0.35), bottomColor: hexAlpha(c.accent, 0.02),
      lineWidth: 2, visible: false,
    });
    volumeSeries = chart.addHistogramSeries({
      color: c.textMuted, priceFormat: { type: 'volume' }, priceScaleId: 'ac-volume',
    });
    chart.priceScale('ac-volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    chart.subscribeCrosshairMove(handleCrosshair);
  }

  // ── Row normalization ────────────────────────────────────────
  // historical_prices/json_files/{SYMBOL}.json is newest-first and can
  // carry more than one row for the same Date (see the existing
  // candlestick_chart page, which tolerates this too) — Lightweight
  // Charts throws if fed duplicate/out-of-order times, so collapse to
  // one row per date and sort ascending.
  function normalizeRows(rows) {
    const arr = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.data) ? rows.data : null);
    if (!arr) throw new Error('Unrecognized data shape');
    const byDate = new Map();
    for (const row of arr) {
      const rawDate = row.Date ?? row.date;
      if (!rawDate) continue;
      const dateKey = String(rawDate).replace(/\//g, '-');
      const close = parseFloat(row.Close ?? row.close);
      if (!dateKey || isNaN(close)) continue;
      const open = parseFloat(row.Open ?? row.open);
      const high = parseFloat(row.High ?? row.high);
      const low  = parseFloat(row.Low ?? row.low);
      byDate.set(dateKey, {
        dateKey,
        open:  isFinite(open) ? open : close,
        high:  isFinite(high) ? high : close,
        low:   isFinite(low)  ? low  : close,
        close,
        volume: parseFloat(row.Volume ?? row.volume) || 0,
      });
    }
    return [...byDate.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  }

  // DSE's trading week is Sunday–Thursday, so weekly buckets start on
  // Sunday (day 0) rather than the ISO Monday — a Monday start would
  // split Sunday off into the wrong week.
  function aggregate(bars, mode) {
    if (mode === 'daily' || !bars.length) return bars;
    const map = new Map();
    const out = [];
    for (const bar of bars) {
      const d = new Date(bar.dateKey + 'T00:00:00Z');
      let key;
      if (mode === 'weekly') {
        const dow = d.getUTCDay();
        const start = new Date(d);
        start.setUTCDate(d.getUTCDate() - dow);
        key = start.toISOString().slice(0, 10);
      } else {
        key = bar.dateKey.slice(0, 7) + '-01';
      }
      let b = map.get(key);
      if (!b) {
        b = { dateKey: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 };
        map.set(key, b);
        out.push(b);
      }
      b.high = Math.max(b.high, bar.high);
      b.low = Math.min(b.low, bar.low);
      b.close = bar.close;
      b.volume += bar.volume || 0;
    }
    return out;
  }

  function toSeriesData(bars) { return bars.map(b => ({ time: b.dateKey, open: b.open, high: b.high, low: b.low, close: b.close })); }
  function toLineData(bars)   { return bars.map(b => ({ time: b.dateKey, value: b.close })); }
  function toVolumeData(bars) {
    const c = chartColors();
    return bars.map(b => ({
      time: b.dateKey, value: b.volume || 0,
      color: b.close >= b.open ? hexAlpha(c.gain, 0.5) : hexAlpha(c.loss, 0.5),
    }));
  }

  function fmt(n) { return (n == null || isNaN(n)) ? '—' : Number(n).toFixed(2); }
  function fmtVol(n) {
    if (n == null || isNaN(n)) return '—';
    n = Number(n);
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }

  function renderData() {
    currentBars = aggregate(dailyBars, currentTimeframe);
    candleSeries.setData(toSeriesData(currentBars));
    lineSeries.setData(toLineData(currentBars));
    areaSeries.setData(toLineData(currentBars));
    volumeSeries.setData(toVolumeData(currentBars));
    chart.timeScale().fitContent();
    updateStats();
    updateLegend(currentBars[currentBars.length - 1]);
  }

  function updateStats() {
    const n = currentBars.length;
    if (!n) { els.stats.innerHTML = ''; return; }
    const last = currentBars[n - 1];
    const prev = currentBars[n - 2];
    const chg = prev ? last.close - prev.close : 0;
    const chgPct = prev && prev.close ? (chg / prev.close) * 100 : 0;
    const cls = chg > 0 ? 'ac-up' : chg < 0 ? 'ac-down' : '';
    els.stats.innerHTML = `
      <span class="ac-stat-symbol">${currentSymbol}</span>
      <span class="ac-stat-price ${cls}">${fmt(last.close)}</span>
      <span class="ac-stat-chg ${cls}">${chg >= 0 ? '+' : ''}${fmt(chg)} (${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%)</span>
      <span class="ac-stat-date">${last.dateKey}</span>
    `;
  }

  function updateLegend(bar) {
    if (!bar) { els.legend.innerHTML = ''; return; }
    els.legend.innerHTML = `
      <span class="ac-legend-item">O <b>${fmt(bar.open)}</b></span>
      <span class="ac-legend-item">H <b>${fmt(bar.high)}</b></span>
      <span class="ac-legend-item">L <b>${fmt(bar.low)}</b></span>
      <span class="ac-legend-item">C <b>${fmt(bar.close)}</b></span>
      <span class="ac-legend-item">Vol <b>${fmtVol(bar.volume)}</b></span>
    `;
  }

  function handleCrosshair(param) {
    if (!param || !param.time || !param.seriesData) { updateLegend(currentBars[currentBars.length - 1]); return; }
    const d = param.seriesData.get(candleSeries);
    const v = param.seriesData.get(volumeSeries);
    if (!d) { updateLegend(currentBars[currentBars.length - 1]); return; }
    updateLegend({ open: d.open, high: d.high, low: d.low, close: d.close, volume: v ? v.value : undefined });
  }

  // ── Loading ───────────────────────────────────────────────────
  async function fetchJSON(paths) {
    let lastErr;
    for (const p of paths) {
      try {
        const r = await fetch(p);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('All paths failed');
  }

  function showLoading(on) { els.loading.hidden = !on; }
  function showError(msg) {
    els.error.hidden = !msg;
    els.error.textContent = msg || '';
  }

  async function loadSymbol(code) {
    code = String(code || '').trim().toUpperCase();
    if (!code) return;
    showLoading(true);
    showError(null);
    try {
      const raw = await fetchJSON(dataPathCandidates(code));
      const bars = normalizeRows(raw);
      if (!bars.length) throw new Error('No usable rows in data file');
      dailyBars = bars;
      currentSymbol = code;
      els.input.value = code;
      document.title = `${code} — Advanced Chart — DSE Live Market`;
      renderData();
      updateUrl(code);
    } catch (e) {
      console.error('[AdvancedChart] failed to load', code, e);
      showError(`Could not load price data for "${code}". Make sure historical_prices/json_files/${code}.json exists.`);
    } finally {
      showLoading(false);
    }
  }

  function updateUrl(code) {
    const url = new URL(window.location.href);
    url.searchParams.set('code', code);
    window.history.pushState({ code }, '', url.toString());
  }

  // ── Symbol search ────────────────────────────────────────────
  async function loadSymbolList() {
    try {
      const data = await fetchJSON(SYMBOL_LIST_PATHS);
      const set = new Set(Object.keys(data.categories || {}));
      INDEX_SYMBOLS.forEach(s => set.add(s));
      allSymbols = [...set].sort();
    } catch (e) {
      console.warn('[AdvancedChart] could not load symbol list', e);
    }
  }

  function renderDropdown(matches) {
    if (!matches.length) { els.dropdown.hidden = true; els.dropdown.innerHTML = ''; return; }
    els.dropdown.innerHTML = matches.slice(0, 40).map(s => `<div class="ac-symbol-option" data-symbol="${s}">${s}</div>`).join('');
    els.dropdown.hidden = false;
  }

  function moveActive(dir) {
    const opts = [...els.dropdown.querySelectorAll('.ac-symbol-option')];
    if (!opts.length) return;
    let idx = opts.findIndex(o => o.classList.contains('active'));
    opts.forEach(o => o.classList.remove('active'));
    idx = (idx + dir + opts.length) % opts.length;
    opts[idx].classList.add('active');
    opts[idx].scrollIntoView({ block: 'nearest' });
  }

  els.input.addEventListener('input', () => {
    const q = els.input.value.trim().toUpperCase();
    renderDropdown(q ? allSymbols.filter(s => s.includes(q)) : allSymbols.slice(0, 40));
  });
  els.input.addEventListener('focus', () => {
    const q = els.input.value.trim().toUpperCase();
    renderDropdown(q ? allSymbols.filter(s => s.includes(q)) : allSymbols.slice(0, 40));
  });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const active = els.dropdown.querySelector('.ac-symbol-option.active');
      const symbol = active ? active.dataset.symbol : els.input.value.trim().toUpperCase();
      if (symbol) { loadSymbol(symbol); els.dropdown.hidden = true; els.input.blur(); }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      els.dropdown.hidden = true;
    }
  });
  els.dropdown.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.ac-symbol-option');
    if (!opt) return;
    e.preventDefault();
    loadSymbol(opt.dataset.symbol);
    els.dropdown.hidden = true;
  });
  document.addEventListener('click', (e) => {
    if (!els.dropdown.contains(e.target) && e.target !== els.input) els.dropdown.hidden = true;
  });

  // ── Timeframe / chart-type toggles ──────────────────────────
  function setTimeframe(tf) {
    if (tf === currentTimeframe) return;
    currentTimeframe = tf;
    [...els.tfSeg.children].forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
    renderData();
  }
  function setChartType(type) {
    if (type === currentType) return;
    currentType = type;
    candleSeries.applyOptions({ visible: type === 'candlestick' });
    lineSeries.applyOptions({ visible: type === 'line' });
    areaSeries.applyOptions({ visible: type === 'area' });
    [...els.typeSeg.children].forEach(b => b.classList.toggle('active', b.dataset.type === type));
  }
  els.tfSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.ac-seg-btn');
    if (btn) setTimeframe(btn.dataset.tf);
  });
  els.typeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('.ac-seg-btn');
    if (btn) setChartType(btn.dataset.type);
  });

  // ── Init ─────────────────────────────────────────────────────
  window.addEventListener('popstate', () => {
    const urlCode = new URLSearchParams(window.location.search).get('code') || DEFAULT_SYMBOL;
    if (urlCode.toUpperCase() !== currentSymbol) loadSymbol(urlCode);
  });
  document.addEventListener('dse-display-applied', applyTheme);

  async function init() {
    if (typeof LightweightCharts === 'undefined') {
      showError('Chart library failed to load — check your connection and reload.');
      return;
    }
    initChart();
    applyTheme();
    loadSymbolList();
    const urlCode = new URLSearchParams(window.location.search).get('code') || DEFAULT_SYMBOL;
    await loadSymbol(urlCode);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
