/* ════════════════════════════════════════════════════════════
   candlestick-data.js
   State variables, CSV/JSON parsing, timeframe aggregation,
   and data loading.

   Indicator math (SMA/EMA, MACD, RSI, Bollinger Bands, Ichimoku,
   Supertrend, Hilega-Milega) now lives in its own file under
   indicators/ — see attachIndicators() below, which just calls
   each module's own attach function.

   Depends on : nothing — must be loaded first.
   Consumed by: indicators/*.js, candlestick-draw.js, candlestick-ui.js
   ════════════════════════════════════════════════════════════ */

// ─── Global state ────────────────────────────────────────────
let chartData      = [];          // raw daily candles (processed)
let aggregatedData = [];          // weekly / monthly aggregated copy
let zoomLevel      = 1;           // horizontal zoom multiplier
let vZoomLevel     = 1;           // vertical zoom multiplier — PRICE pane only
// Per-pane vertical zoom for the indicator sub-panes — dragging the right
// value-axis of one of these panes (see _paneAtY() in candlestick-ui.js)
// zooms only that pane, independently of the price pane's vZoomLevel.
let paneVZoom      = { volume: 1, macd: 1, rsi: 1, hm: 1 };
let panOffset      = 0;           // candles scrolled back from right edge
// Vertical pan on the PRICE pane only — an absolute price shift applied on
// top of the auto-fit range, so dragging the candles moves the visible
// price window up/down the same way panOffset moves it left/right. Reset
// alongside panOffset (new symbol, resetView, chart-type change).
let priceOffset    = 0;
let currentTimeframe = 'daily';   // 'daily' | 'weekly' | 'monthly'

// ─── Persisted UI/chart preferences ───────────────────────────
// activeMA, enabledIndicators, and chartType are all user-toggled
// via the toolbar/modal and are expected to survive a page reload,
// so each is seeded from localStorage (falling back to the
// original hardcoded defaults) and re-saved on every change.
function _loadPref(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    if (saved != null) return JSON.parse(saved);
  } catch (e) {}
  return fallback;
}

function _savePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function saveActiveMA()          { _savePref('activeMA', activeMA); }
function saveEnabledIndicators() { _savePref('enabledIndicators', enabledIndicators); }
function saveChartType()         { _savePref('chartType', chartType); }

let activeMA          = _loadPref('activeMA', { 20: true, 50: false, 200: false, ema200: false });
let enabledIndicators = _loadPref('enabledIndicators', ['MACD', 'RSI']);
let chartType         = _loadPref('chartType', 'candlestick'); // 'candlestick' | 'heikinashi' | 'renko' | 'hollow' | 'bars' | 'line' | 'area'

// ─── Sub-pane ordering & collapsed state ──────────────────────
// paneOrder defines the render sequence of the three indicator sub-panes.
// collapsedPanes is an array of indicator keys whose pane is collapsed to
// a slim label strip (COLLAPSED_H px) instead of full height.
let paneOrder      = _loadPref('paneOrder',      ['MACD', 'RSI', 'Hilega-Milega']);
let collapsedPanes = _loadPref('collapsedPanes', []);
function savePaneOrder()      { _savePref('paneOrder',      paneOrder); }
function saveCollapsedPanes() { _savePref('collapsedPanes', collapsedPanes); }

let renkoBoxSize   = 1;           // brick size for Renko charts (synced with renkoSettings.fixedBoxSize)
let useHeikinAshi  = false;       // legacy - kept for compatibility

// ─── Renko settings (TradingView parity) ─────────────────────
const RENKO_DEFAULTS = {
  method:              'ATR',
  atrLength:           14,
  fixedBoxSize:        1,
  source:              'Close',
  showWicks:           true,
  colorUpBars:         '#26a69a',
  colorUpBarsLine:     '#26a69a',
  colorDownBars:       '#ef5350',
  colorDownBarsLine:   '#ef5350',
  colorProjUp:         'rgba(38,166,154,0.35)',
  colorProjUpLine:     'rgba(38,166,154,0.6)',
  colorProjDown:       'rgba(239,83,80,0.35)',
  colorProjDownLine:   'rgba(239,83,80,0.6)',
  opacityUpBars:       100,
  opacityUpBarsLine:   100,
  opacityDownBars:     100,
  opacityDownBarsLine: 100,
  opacityProjUp:       35,
  opacityProjUpLine:   60,
  opacityProjDown:     35,
  opacityProjDownLine: 60,
};
let renkoSettings = _loadPref('renkoSettings', { ...RENKO_DEFAULTS });
function saveRenkoSettings() { _savePref('renkoSettings', renkoSettings); }

// ─── Replay state ─────────────────────────────────────────────
let replayMode    = false;        // is replay active?
let replayIndex   = 0;            // how many candles of displayData are visible
let replayPlaying = false;        // currently auto-playing?
let replaySpeed   = 1;            // speed multiplier (0.1 → 10)
let _replayTimer  = null;         // setInterval handle
let _selectingBar = false;        // waiting for canvas click to set start bar

// ─── Available indicators (for the modal list) ───────────────
const AVAILABLE_INDICATORS = [
  { name: 'Moving Average (SMA)',            category: 'Trend',              description: 'Simple Moving Average'      },
  { name: 'Exponential Moving Average (EMA)',category: 'Trend',              description: 'Exponential Moving Average' },
  { name: 'Bollinger Bands',                 category: 'Volatility',         description: 'Volatility indicator'       },
  { name: 'Ichimoku Cloud',                  category: 'Trend',              description: 'Cloud + support/resistance' },
  { name: 'Stochastic Oscillator',           category: 'Momentum',           description: 'Momentum indicator'         },
  { name: 'Williams %R',                     category: 'Momentum',           description: 'Momentum indicator'         },
  { name: 'Awesome Oscillator',              category: 'Momentum',           description: 'Momentum indicator'         },
  { name: 'Relative Strength Index (RSI)',   category: 'Momentum',           description: 'Currently enabled'          },
  { name: 'MACD',                            category: 'Trend',              description: 'Currently enabled'          },
  { name: 'Average True Range (ATR)',        category: 'Volatility',         description: 'Volatility indicator'       },
  { name: 'On Balance Volume (OBV)',         category: 'Volume',             description: 'Volume indicator'           },
  { name: 'Accumulation/Distribution',       category: 'Volume',             description: 'Volume indicator'           },
  { name: 'Money Flow Index (MFI)',          category: 'Volume',             description: 'Volume indicator'           },
  { name: 'Volume Profile',                  category: 'Volume',             description: 'Volume analysis'            },
  { name: 'Fibonacci Retracement',           category: 'Support/Resistance', description: 'Level drawing'              },
  { name: 'Standard Deviation',              category: 'Volatility',         description: 'Volatility indicator'       },
  { name: 'KDJ Indicator',                   category: 'Momentum',           description: 'Momentum indicator'         },
  { name: 'Average Directional Index (ADX)', category: 'Trend',              description: 'Trend strength'             },
  { name: 'Aroon Indicator',                 category: 'Trend',              description: 'Trend indicator'            },
  { name: 'Balance of Power',                category: 'Momentum',           description: 'Momentum indicator'         },
  { name: 'Chande Momentum Oscillator',      category: 'Momentum',           description: 'Momentum indicator'         },
  { name: 'Hilega-Milega',                   category: 'Momentum',           description: 'RSI + WMA(21) + EMA(3) oscillator' },
  { name: 'Supertrend',                      category: 'Trend',              description: 'ATR-based trend indicator'   },
];

// ─── Indicator attachment ─────────────────────────────────────
// Each indicator module (indicators/*.js) exposes its own
// attachXxx(data) function that writes its fields onto every
// candle. This just runs all of them, in order, on a dataset.
//
// MACD/RSI/Hilega-Milega stay on this single-instance path (they're
// sub-pane indicators, out of scope for the multi-instance rewrite).
// MA/Bollinger Bands/Ichimoku/Supertrend's attach* calls are left
// here too — harmless, they just compute legacy single-instance
// fields (sma20, bbUpper, etc.) that nothing draws anymore now that
// those types moved to the instance system below — but removing them
// isn't necessary and keeping them avoids touching anything that
// might still reference those fields elsewhere.
function attachIndicators(data) {
  attachMA(data);
  attachMACD(data);
  attachRSI(data);
  attachBollingerBands(data);
  attachIchimoku(data);
  attachSupertrend(data);
  attachHilegaMilega(data);
  attachVolumeMA(data);
  if (typeof attachIndicatorInstances === 'function') attachIndicatorInstances(data);
}

// Rolling 20-period average volume, drawn as a line in the Volume pane
// (candlestick-draw.js's drawVolumeSection). Attached here rather than
// computed inside the draw function because a trailing SMA needs the bars
// BEFORE the currently-visible window too — same reason every other
// moving average in this file is pre-computed over the full series.
function attachVolumeMA(data) {
  const volumes = data.map(c => c.Volume || 0);
  const vma20   = calculateSMA(volumes, 20);
  data.forEach((candle, i) => { candle.volMA20 = vma20[i]; });
}

// ─── Heikin-Ashi conversion ───────────────────────────────────
// A chart-type transform (not an "indicator" overlay), so it
// stays here alongside Renko rather than in indicators/.
function calculateHeikinAshi(data) {
  const ha = [];
  for (let i = 0; i < data.length; i++) {
    const c       = data[i];
    const haClose = (c.Open + c.High + c.Low + c.Close) / 4;
    const haOpen  = i === 0
      ? (c.Open + c.Close) / 2
      : (ha[i - 1].Open + ha[i - 1].Close) / 2;
    const haHigh  = Math.max(c.High, haOpen, haClose);
    const haLow   = Math.min(c.Low,  haOpen, haClose);
    ha.push({ ...c, Open: haOpen, High: haHigh, Low: haLow, Close: haClose });
  }
  return ha;
}

// ─── Renko conversion ────────────────────────────────────────
// Full TradingView parity: ATR or fixed box size, 7 price sources,
// optional wicks, and a projection (in-progress) brick.

function _renkoSource(c, src) {
  switch (src) {
    case 'Open':  return c.Open;
    case 'High':  return c.High;
    case 'Low':   return c.Low;
    case 'HL2':   return (c.High + c.Low) / 2;
    case 'HLC3':  return (c.High + c.Low + c.Close) / 3;
    case 'OHLC4': return (c.Open + c.High + c.Low + c.Close) / 4;
    default:      return c.Close;
  }
}

function _calcATRSeries(data, period) {
  const out = new Array(data.length).fill(null);
  let smoothed = null;
  let sum = 0;
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].High - data[i].Low,
      Math.abs(data[i].High - data[i-1].Close),
      Math.abs(data[i].Low  - data[i-1].Close)
    );
    if (i < period) {
      sum += tr;
      if (i === period - 1) { smoothed = sum / period; out[i] = smoothed; }
    } else {
      smoothed = (smoothed * (period - 1) + tr) / period;
      out[i] = smoothed;
    }
  }
  return out;
}

function calculateRenko(data, _legacyBoxSize) {
  if (!data || !data.length) return [];
  const cfg     = (typeof renkoSettings !== 'undefined') ? renkoSettings : RENKO_DEFAULTS;
  const method  = cfg.method       || 'ATR';
  const atrLen  = cfg.atrLength    || 14;
  const fixedSz = cfg.fixedBoxSize || _legacyBoxSize || 1;
  const src     = cfg.source       || 'Close';
  const wicks   = cfg.showWicks !== false;

  const atrSeries = method === 'ATR' ? _calcATRSeries(data, atrLen) : null;

  const bricks = [];
  let bTop = null, bBot = null;
  let runHigh = -Infinity, runLow = Infinity;

  for (let i = 0; i < data.length; i++) {
    const c       = data[i];
    const price   = _renkoSource(c, src);
    const boxSize = method === 'ATR'
      ? (atrSeries[i] != null ? atrSeries[i] : fixedSz)
      : fixedSz;

    if (bTop === null) {
      bTop = price + boxSize;
      bBot = price - boxSize;
      runHigh = c.High; runLow = c.Low;
      continue;
    }

    runHigh = Math.max(runHigh, c.High);
    runLow  = Math.min(runLow,  c.Low);

    // Up bricks
    while (price >= bTop) {
      const o = bTop - boxSize, cl = bTop;
      bricks.push({ ...c, Date: c.Date,
        Open: o, Close: cl,
        High: wicks ? runHigh : cl,
        Low:  wicks ? runLow  : o,
        Volume: c.Volume || 0, _renkoUp: true, _projection: false });
      bBot = bTop - boxSize;
      bTop = bTop + boxSize;
      runHigh = c.High; runLow = c.Low;
    }
    // Down bricks
    while (price <= bBot) {
      const o = bBot + boxSize, cl = bBot;
      bricks.push({ ...c, Date: c.Date,
        Open: o, Close: cl,
        High: wicks ? runHigh : o,
        Low:  wicks ? runLow  : cl,
        Volume: c.Volume || 0, _renkoUp: false, _projection: false });
      bTop = bBot + boxSize;
      bBot = bBot - boxSize;
      runHigh = c.High; runLow = c.Low;
    }
  }

  // Projection brick — the live unfinished brick
  if (data.length > 0) {
    const last  = data[data.length - 1];
    const price = _renkoSource(last, src);
    const projUp = bTop !== null && price >= (bBot + (bTop - bBot) / 2);
    const pOpen  = projUp ? bBot : bTop;
    bricks.push({ ...last, Date: last.Date,
      Open:  pOpen,
      Close: price,
      High:  wicks ? Math.max(price, last.High) : Math.max(price, pOpen),
      Low:   wicks ? Math.min(price, last.Low)  : Math.min(price, pOpen),
      Volume: last.Volume || 0,
      _renkoUp: projUp, _projection: true });
  }

  return bricks;
}

// ─── Timeframe aggregation ───────────────────────────────────
function aggregateCandlesByWeek(data) {
  const weeks = {};
  data.forEach(candle => {
    const date = new Date(candle.Date + ' GMT');
    const dow  = date.getDay();
    const daysBack = dow === 6 ? 0 : (dow === 0 ? 1 : dow + 1);
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - daysBack);
    weekStart.setHours(0, 0, 0, 0);
    const key = weekStart.toISOString().split('T')[0];
    if (!weeks[key]) {
      weeks[key] = { Date: key, Open: candle.Open, High: candle.High, Low: candle.Low, Close: candle.Close, Volume: candle.Volume || 0 };
    } else {
      weeks[key].High   = Math.max(weeks[key].High,  candle.High);
      weeks[key].Low    = Math.min(weeks[key].Low,   candle.Low);
      weeks[key].Close  = candle.Close;
      weeks[key].Volume += candle.Volume || 0;
    }
  });
  return Object.values(weeks).sort((a, b) => new Date(a.Date) - new Date(b.Date));
}

function aggregateCandlesByMonth(data) {
  const months = {};
  data.forEach(candle => {
    const date = new Date(candle.Date + ' GMT');
    const key  = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01';
    if (!months[key]) {
      months[key] = { Date: key, Open: candle.Open, High: candle.High, Low: candle.Low, Close: candle.Close, Volume: candle.Volume || 0 };
    } else {
      months[key].High   = Math.max(months[key].High,  candle.High);
      months[key].Low    = Math.min(months[key].Low,   candle.Low);
      months[key].Close  = candle.Close;
      months[key].Volume += candle.Volume || 0;
    }
  });
  return Object.values(months).sort((a, b) => new Date(a.Date) - new Date(b.Date));
}

const TIMEFRAME_LABELS = { daily: '1D', weekly: '1W', monthly: '1M' };

function changeTimeframe(timeframe) {
  currentTimeframe = timeframe;
  document.querySelectorAll('.timeframe-btn, .tv-timeframe').forEach(btn => btn.classList.remove('active'));
  const activeBtn = event.target.closest('.timeframe-btn, .tv-timeframe');
  if (activeBtn) activeBtn.classList.add('active');

  // TradingView-style interval dropdown (candlestick.html + company.html
  // both use the same trigger/menu ids) — update the trigger label and
  // close the menu. No-op safely if this page doesn't have the dropdown.
  const triggerLabel = document.getElementById('tvTfTriggerLabel');
  if (triggerLabel) triggerLabel.textContent = TIMEFRAME_LABELS[timeframe] || timeframe;
  const menu = document.getElementById('tvTfMenu');
  if (menu) menu.style.display = 'none';

  if      (timeframe === 'weekly')  aggregatedData = aggregateCandlesByWeek(chartData);
  else if (timeframe === 'monthly') aggregatedData = aggregateCandlesByMonth(chartData);
  else                              aggregatedData = chartData;
  if (timeframe !== 'daily') {
    attachIndicators(aggregatedData);
    attachStrategies(aggregatedData);
  }
  drawChart();
  if (typeof _updateStrategyTable === 'function') _updateStrategyTable();
}

function toggleTimeframeMenu() {
  const menu = document.getElementById('tvTfMenu');
  if (!menu) return;
  const opening = menu.style.display === 'none';
  menu.style.display = opening ? 'block' : 'none';
  if (opening) {
    const closeOnOutsideClick = (e) => {
      const wrap = document.getElementById('tvTimeframeDropdown');
      if (wrap && !wrap.contains(e.target)) {
        menu.style.display = 'none';
        document.removeEventListener('click', closeOnOutsideClick);
      }
    };
    // Deferred so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener('click', closeOnOutsideClick), 0);
  }
}

// ─── CSV parsing ─────────────────────────────────────────────
function parseCSV(csv) {
  if (typeof csv !== 'string') {
    throw new Error(`Expected CSV text but got ${Array.isArray(csv) ? 'an array' : typeof csv} — check that the JSON response is either an array of rows or has been converted to a string before reaching parseCSV().`);
  }
  const lines   = csv.trim().split('\n');
  const headers = lines[0].split(',');
  const data    = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].split(',');
    const row    = {};
    headers.forEach((h, idx) => { row[h.trim()] = values[idx]; });
    data.push(row);
  }
  return data;
}

// ─── Data loading ─────────────────────────────────────────────
function loadData() {
  // Read stock code from URL ?code= param so this works on both
  // candlestick.html (no param → BPML) and company.html (?code=XYZ)
  const urlCode = ((new URLSearchParams(window.location.search)).get('code') || 'BPML').toUpperCase();
  console.log(`[DataLoad] Loading data for symbol: ${urlCode}`);
  
  const possiblePaths = [
    `/historical_prices/json_files/${urlCode}.json`,
    `historical_prices/json_files/${urlCode}.json`,
    `./historical_prices/json_files/${urlCode}.json`,
    `../historical_prices/json_files/${urlCode}.json`,
  ];
  
  let idx = 0;
  const errors = [];
  
  function tryNext() {
    if (idx >= possiblePaths.length) {
      console.error(`[DataLoad] Failed to load ${urlCode}.json from all paths:`, errors);
      showError(`Could not load ${urlCode}.json. Make sure the file exists at:<br/>historical_prices/json_files/${urlCode}.json`);
      return;
    }
    
    const path = possiblePaths[idx];
    console.log(`[DataLoad] Trying path: ${path}`);
    
    fetch(path)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        console.log(`[DataLoad] ✅ Successfully loaded from: ${path}`);
        processChartData(data);
      })
      .catch(err => {
        errors.push(`${path}: ${err.message}`);
        console.warn(`[DataLoad] ❌ Failed to load from ${path}: ${err.message}`);
        idx++;
        tryNext();
      });
  }
  
  tryNext();
}

function processChartData(rows) {
  try {
    // `rows` always comes from loadData() doing r.json(), so it is
    // already-parsed JSON — never a raw CSV string. It just isn't
    // always a bare array: some endpoints wrap the row list inside
    // an object, e.g. { data: [...] }, { rows: [...] }, { prices: [...] }.
    // Unwrap those known shapes first. parseCSV() is only a fallback
    // for the (rare/legacy) case where the server genuinely returns
    // CSV text instead of JSON — it will now throw a clear error of
    // its own if `rows` isn't a string, instead of crashing on
    // `.trim()`.
    let parsed;
    if (Array.isArray(rows)) {
      parsed = rows;
    } else if (rows && typeof rows === 'object') {
      // Don't guess specific key names — scan every own property for
      // the first one that's an array of row-like objects (anything
      // with a Date or Close field qualifies). This handles whatever
      // the server happens to call its wrapper key (data/rows/prices/
      // candles/history/series/result/payload/etc.) without needing
      // to know it in advance.
      const isRowLike = v => v && typeof v === 'object' && ('Date' in v || 'date' in v || 'Close' in v || 'close' in v);
      let wrapped = null;
      for (const key of Object.keys(rows)) {
        const val = rows[key];
        if (Array.isArray(val) && val.length > 0 && isRowLike(val[0])) { wrapped = val; break; }
        if (Array.isArray(val) && val.length === 0) { wrapped = val; } // keep as a fallback if nothing better is found
      }
      if (Array.isArray(wrapped)) {
        parsed = wrapped;
      } else {
        throw new Error(`Unrecognized JSON shape for chart data. Top-level keys were: ${Object.keys(rows).join(', ') || '(none)'}`);
      }
    } else {
      parsed = parseCSV(rows);
    }

    chartData = parsed
      .map(row => ({
        Date:      row.Date ?? row.date,
        Symbol:    row.Symbol ?? row.symbol,
        High:      row.High ?? row.high,
        Low:       row.Low ?? row.low,
        Open:      row.Open ?? row.open,
        Close:     row.Close ?? row.close,
        YCP:       row.YCP ?? row.ycp,
        Volume:    row.Volume ?? row.volume,
        ChangePct: row.ChangePct ?? row.changePct ?? row.changepct,
      }))
      .filter(row => row.Date && row.Close != null && !isNaN(parseFloat(row.Close)))
      .map(row => ({
        Date:      row.Date,
        Symbol:    row.Symbol,
        High:      parseFloat(row.High)      || parseFloat(row.Close),
        Low:       parseFloat(row.Low)       || parseFloat(row.Close),
        Open:      parseFloat(row.Open)      || parseFloat(row.Close),
        Close:     parseFloat(row.Close),
        YCP:       parseFloat(row.YCP),
        Volume:    parseFloat(row.Volume),
        ChangePct: parseFloat(row.ChangePct),
      }))
      .reverse()
      // ── Remove duplicate candles (weekends/holidays with identical OHLCV) ──
      // A candle is a duplicate if Open, High, Low, Close AND Volume
      // all exactly match the previous candle — catches weekend/holiday
      // snapshots where the exchange was closed and no real trading occurred.
      .filter((candle, i, arr) => {
        if (i === 0) return true;
        const prev = arr[i - 1];
        return !(
          candle.Open   === prev.Open  &&
          candle.High   === prev.High  &&
          candle.Low    === prev.Low   &&
          candle.Close  === prev.Close &&
          candle.Volume === prev.Volume
        );
      });

    if (chartData.length === 0) { showError('No valid data found'); return; }
    attachIndicators(chartData);
    attachStrategies(chartData);
    aggregatedData = chartData;

    // ── Sync the hardcoded "BPML" placeholders in the markup with the
    // actual loaded symbol (candlestick.html ships with BPML baked into
    // the toolbar ticker / header logo tag / page title, since that's
    // the default when no ?code= is given — but it never updates on
    // its own once a different stock's data comes in).
    const loadedSymbol = (chartData[0] && chartData[0].Symbol) || urlCodeFallback();
    const tickerEl = document.getElementById('tvTicker');
    const logoEl   = document.getElementById('headerLogoTag');
    if (tickerEl) tickerEl.textContent = loadedSymbol;
    if (logoEl)   logoEl.textContent   = loadedSymbol;
    document.title = `${loadedSymbol} Candlestick Chart — Professional Trading View`;
    // Header nav's "Company Profile" link always points at whichever symbol
    // is actually on screen, not a hardcoded default.
    const companyProfileLink = document.getElementById('headerCompanyProfileLink');
    if (companyProfileLink) companyProfileLink.href = `/company_profile/company.html?code=${encodeURIComponent(loadedSymbol)}`;
    const researchReportLink = document.getElementById('researchReportBtn');
    if (researchReportLink) researchReportLink.href = `/research/research.html?code=${encodeURIComponent(loadedSymbol)}`;

    const loadingEl = document.getElementById('loadingState');
    const canvas    = document.getElementById('candleCanvas');
    if (loadingEl) loadingEl.style.display = 'none';
    if (canvas)    canvas.style.display    = 'block';

    updateInfoCards();
    drawChart();
    setupChartInteractions();
    if (typeof _updateStrategyTable === 'function') _updateStrategyTable();
    // TradingView-style right sidebar (candlestick.html only — undefined on
    // company.html's embedded chart, which doesn't load tv-sidebar.js). Fired
    // here rather than on symbol-switch directly so it always reflects
    // chartData that's actually finished loading (needed for avg-volume calc).
    if (typeof window.refreshSidebarForSymbol === 'function') window.refreshSidebarForSymbol(loadedSymbol);
    // Seasonals panel (candlestick.html only) — no-op while closed; recomputes
    // fresh from this now-updated chartData next time it's opened either way.
    if (typeof window.refreshSeasonalsForSymbol === 'function') window.refreshSeasonalsForSymbol();
  } catch (err) {
    showError('Error processing data: ' + err.message);
    console.error(err);
  }
}

// Fallback symbol source if a row's Symbol field is ever missing —
// reads the same ?code= param loadData() uses, so the label still
// reflects what was requested even if the data itself omits Symbol.
function urlCodeFallback() {
  return ((new URLSearchParams(window.location.search)).get('code') || 'BPML').toUpperCase();
}

function showError(msg) {
  const el = document.getElementById('loadingState');
  if (el) el.innerHTML = '❌ ' + msg;
}