import { initTheme, toggleTheme } from '../theme/theme.js';
/* ================================================================
   company.js  —  Theme, market status, profile data & chart
   ================================================================ */

'use strict';

// Shared state — also consumed by news.js
window.currentStockCode = null;

const API     = '';
const FIN_API = `${API}/api/financials`;

/* ----------------------------------------------------------------
   LOAD PROFILE
---------------------------------------------------------------- */
async function loadProfile() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');

  if (!code) {
    document.getElementById('profile-loading').innerHTML =
      '<p style="color:var(--loss)">No company code specified. <a href="/" style="color:var(--accent)">Go back</a></p>';
    return;
  }

  document.title = `${code} — DSE Company Profile`;

  try {
    const res = await fetch(`${API}/api/stocks`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const { stocks } = await res.json();
    const s = stocks.find(x => x.code === code.toUpperCase());

    if (!s) {
      document.getElementById('profile-loading').innerHTML =
        `<p style="color:var(--loss)">Company "<strong>${code}</strong>" not found.
         <a href="/" style="color:var(--accent)">Go back</a></p>`;
      return;
    }

    populateProfile(s);
    document.getElementById('profile-loading').style.display = 'none';
    document.getElementById('profile-body').style.display    = 'block';

    // Init full candlestick chart now that profile-body is visible and has real dimensions
    requestAnimationFrame(() => {
      if (typeof window.initCandlestickFullChart === 'function') {
        window.initCandlestickFullChart();
      }
    });
    if (window.initFinancials)       window.initFinancials(s.code);
    if (window.initSRLevels)         window.initSRLevels(s.code, s.ltp);
    if (window.initDDM)              window.initDDM(s.code, s.ltp);
    if (window.initAnnualReports)    window.initAnnualReports(s.code);

    loadNewsLinks(s.code);   // defined in news.js
    loadReturns(s.code);
    loadVolatility(s.code);

    // Load sector in background and populate immediately when ready
    fetch(`${API}/api/sectors`)
      .then(r => r.json())
      .then(map => {
        const sector = map[s.code] || '—';
        const pSector = document.getElementById('p-sector');
        const dSector = document.getElementById('d-sector');
        if (pSector) pSector.textContent = sector;
        if (dSector) dSector.textContent = sector;
        // Show Bank Details button only for Bank sector
        const bankBtn = document.getElementById('bank-details-btn');
        if (bankBtn) bankBtn.style.display = sector === 'Bank' ? 'inline-flex' : 'none';
        // Quarterly bank financials dashboard — Bank sector only
        if (sector === 'Bank' && window.initBankFinancials) window.initBankFinancials(s.code);
        // Show MF Portfolio button only for mutual fund sector stocks
        injectMFPortfolioButton(s, sector);
        loadSectorComparison(s.code, sector, map);
      })
      .catch(() => {});

    // Kick off enriched details in background (non-blocking)
    fetchAndRenderDetails(s.code, s.ltp);

  } catch (err) {
    document.getElementById('profile-loading').innerHTML =
      `<p style="color:var(--loss)">Failed to load data: ${err.message}<br><br>
       <a href="/" style="color:var(--accent)">← Go back to Market</a></p>`;
  }
}

/* ----------------------------------------------------------------
   RETURNS WIDGET — period-over-period % change from price history
---------------------------------------------------------------- */
// % change from the earliest record on/after (latest.date - days) up to
// latest. Returns null if there's no usable baseline (not enough history,
// or the baseline collapses onto latest) — shared by the Returns widget and
// the sector peer comparison below so both agree on what "3M return" means.
function computeReturnPct(records, latest, days) {
  const cutoff = new Date(latest.date.getTime() - days * 86400000);
  const baseline = records.find(r => r.date >= cutoff);
  if (!baseline || baseline === latest || !baseline.close) return null;
  return ((latest.close - baseline.close) / baseline.close) * 100;
}

async function loadReturns(code) {
  const grid = document.getElementById('p-returns-grid');
  if (!grid) return;

  let records;
  try {
    const res = await fetch(`${API}/api/history/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error('history fetch failed');
    const { data } = await res.json();
    records = (data || [])
      .map(r => ({ date: new Date(r.Date.replace(/\//g, '-')), close: parseFloat(r.Close) }))
      .filter(r => !isNaN(r.date.getTime()) && !isNaN(r.close))
      .sort((a, b) => a.date - b.date);
  } catch {
    return; // leave the widget showing its default "—" placeholders
  }
  if (records.length < 2) return;

  const latest = records[records.length - 1];
  const periods = [
    { label: '1W',  days: 7 },
    { label: '1M',  days: 30 },
    { label: '3M',  days: 91 },
    { label: '6M',  days: 182 },
    { label: '1Y',  days: 365 },
  ];

  const items = grid.querySelectorAll('.returns-item');
  periods.forEach((p, i) => {
    const item = items[i];
    if (!item) return;
    const pctEl  = item.querySelector('.returns-pct');
    const barEl  = item.querySelector('.returns-bar');
    const pct = computeReturnPct(records, latest, p.days);
    if (pct == null) {
      pctEl.textContent = '—';
      return;
    }
    const isGain = pct >= 0;
    pctEl.textContent = `${isGain ? '+' : ''}${pct.toFixed(1)}%`;
    pctEl.className = `returns-pct ${isGain ? 'gain' : 'loss'}`;
    barEl.className = `returns-bar ${isGain ? 'gain' : 'loss'}`;
    const width = Math.min(50, Math.abs(pct) * 2.5); // cap fill so extreme swings don't overflow the track
    barEl.style.width = `${width}%`;
  });
}

/* ----------------------------------------------------------------
   VOLATILITY — annualized stdev of daily log returns, computed
   from the same /api/history price series as Returns. Shared
   helpers here are reused by both the compact card and the
   details modal (openVolatilityModal, below) so the numbers
   never disagree between the two views.
---------------------------------------------------------------- */
const VOL_TRADING_DAYS_PER_YEAR = 252;
const VOL_MIN_RETURNS = 5; // need a handful of data points before a stdev means anything

let _volatilityRecords = null; // cached {date, close}[] for the currently-loaded symbol
let _volatilityCode = null;

// Volatility bands (annualized %) — a heuristic classification for
// equities, not an official/regulatory rating.
function volBandFor(pct) {
  if (pct < 20) return { key: 'vol-low',      label: 'Low'       };
  if (pct < 40) return { key: 'vol-moderate', label: 'Moderate'  };
  if (pct < 60) return { key: 'vol-high',      label: 'High'      };
  return              { key: 'vol-veryhigh',  label: 'Very High' };
}

// Annualized stdev of daily log returns over the trailing `days` calendar
// days ending at `latest`. Returns null if there isn't enough data to make
// the estimate meaningful (rather than showing a noisy/misleading number).
function computeAnnualizedVol(records, latest, days) {
  const cutoff = new Date(latest.date.getTime() - days * 86400000);
  const windowRecords = records.filter(r => r.date >= cutoff);
  const logReturns = [];
  for (let i = 1; i < windowRecords.length; i++) {
    const prev = windowRecords[i - 1].close, cur = windowRecords[i].close;
    if (prev > 0 && cur > 0) logReturns.push(Math.log(cur / prev));
  }
  if (logReturns.length < VOL_MIN_RETURNS) return null;
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(VOL_TRADING_DAYS_PER_YEAR) * 100;
}

// Trailing `windowDays`-trading-day rolling annualized volatility, sampled
// once per trading day across the whole series — the time-series view shown
// in the details modal, so you can see how volatility has moved, not just
// where it stands today.
function computeRollingVolatility(records, windowDays = 30) {
  const logReturns = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1].close, cur = records[i].close;
    logReturns.push(prev > 0 && cur > 0 ? Math.log(cur / prev) : null);
  }
  const series = [];
  for (let i = windowDays; i < logReturns.length; i++) {
    const win = logReturns.slice(i - windowDays, i).filter(v => v != null);
    if (win.length < VOL_MIN_RETURNS) continue;
    const mean = win.reduce((s, v) => s + v, 0) / win.length;
    const variance = win.reduce((s, v) => s + (v - mean) ** 2, 0) / (win.length - 1);
    const pct = Math.sqrt(variance) * Math.sqrt(VOL_TRADING_DAYS_PER_YEAR) * 100;
    series.push({ date: records[i + 1] ? records[i + 1].date : records[i].date, pct });
  }
  return series;
}

// ISO-8601 week key ("2024-W23") for grouping daily records into weeks —
// same "bucket then diff against the previous populated bucket" pattern as
// the Seasonals month grouping, just at week granularity.
function getISOWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A "move" is the size of a period's own High-Low price range, expressed as
// a % of that period's Low — used for the "how many days/weeks/months/years
// moved by X% or more" threshold-breach view. This is a single-period range,
// not a close-to-close change, so it needs no prior period to compare
// against and every period with valid High/Low produces a value. Each move
// carries its own display `label` so the render code stays generic across
// all four granularities.
function computeDailyMoves(records) {
  const moves = [];
  records.forEach(r => {
    if (r.low > 0 && r.high >= r.low) {
      moves.push({ date: r.date, label: r.date.toISOString().slice(0, 10), low: r.low, high: r.high, rangePct: (r.high - r.low) / r.low * 100 });
    }
  });
  return moves;
}

// Shared bucketing helper for weekly/monthly/yearly moves: groups records by
// `keyFn`, tracks the running High/Low across each bucket plus its last
// trading day (for sorting/lookback), then labels each bucket via `labelFn`.
function bucketMoves(records, keyFn, labelFn) {
  const buckets = new Map();
  records.forEach(r => {
    if (!(r.low > 0 && r.high >= r.low)) return;
    const key = keyFn(r.date);
    const b = buckets.get(key);
    if (!b) {
      buckets.set(key, { date: r.date, high: r.high, low: r.low });
    } else {
      b.date = r.date; // keep the bucket's last trading day for display/sorting
      b.high = Math.max(b.high, r.high);
      b.low = Math.min(b.low, r.low);
    }
  });
  return Array.from(buckets.values()).map(b => ({
    date: b.date, label: labelFn(b.date), low: b.low, high: b.high, rangePct: (b.high - b.low) / b.low * 100
  }));
}

function computeWeeklyMoves(records) {
  return bucketMoves(records, getISOWeekKey, d => d.toISOString().slice(0, 10));
}

function computeMonthlyMoves(records) {
  return bucketMoves(
    records,
    d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    d => `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`
  );
}

function computeYearlyMoves(records) {
  return bucketMoves(records, d => String(d.getFullYear()), d => String(d.getFullYear()));
}

// Which calendar months (Jan-Dec, pooled across every year present) tend to
// have more threshold-breaching days — a seasonality view, distinct from the
// Months tab above which lists individual year-month buckets.
function computeMonthlySeasonality(dailyMoves, threshold) {
  const buckets = Array.from({ length: 12 }, () => ({ total: 0, hits: 0 }));
  dailyMoves.forEach(m => {
    const b = buckets[m.date.getMonth()];
    b.total++;
    if (m.rangePct >= threshold) b.hits++;
  });
  return buckets.map((b, i) => ({
    month: MONTH_ABBR[i], total: b.total, hits: b.hits, pct: b.total ? (b.hits / b.total * 100) : 0
  }));
}

async function loadVolatility(code) {
  const grid = document.getElementById('p-volatility-grid');
  if (!grid) return;

  let records;
  try {
    const res = await fetch(`${API}/api/history/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error('history fetch failed');
    const { data } = await res.json();
    records = (data || [])
      .map(r => ({ date: new Date(r.Date.replace(/\//g, '-')), close: parseFloat(r.Close), high: parseFloat(r.High), low: parseFloat(r.Low) }))
      .filter(r => !isNaN(r.date.getTime()) && !isNaN(r.close) && r.close > 0)
      .sort((a, b) => a.date - b.date);
  } catch {
    return; // leave the widget showing its default "—" placeholders
  }
  if (records.length < 2) return;

  _volatilityRecords = records;
  _volatilityCode = code;

  const latest = records[records.length - 1];
  const periods = [
    { id: 'vol-1m', days: 30 },
    { id: 'vol-3m', days: 91 },
    { id: 'vol-6m', days: 182 },
    { id: 'vol-1y', days: 365 },
  ];

  let repVol = null; // representative (3M) value, drives the badge

  periods.forEach(p => {
    const item = document.getElementById(p.id)?.closest('.returns-item');
    const pctEl = document.getElementById(p.id);
    const barEl = item?.querySelector('.volatility-bar');
    if (!pctEl) return;

    const annualizedPct = computeAnnualizedVol(records, latest, p.days);
    if (annualizedPct == null) {
      pctEl.textContent = '—';
      if (barEl) barEl.style.width = '0%';
      return;
    }

    const band = volBandFor(annualizedPct);
    pctEl.textContent = `${annualizedPct.toFixed(1)}%`;
    pctEl.className = 'returns-pct';
    if (barEl) {
      barEl.className = `returns-bar volatility-bar ${band.key}`;
      // Scale so ~80% annualized vol fills the track — DSE small-caps can run
      // well past "high"; cap the width rather than let it overflow the track.
      barEl.style.width = `${Math.min(100, (annualizedPct / 80) * 100)}%`;
    }

    if (p.id === 'vol-3m') repVol = { pct: annualizedPct, band };
  });

  const badgeEl = document.getElementById('p-volatility-badge');
  if (badgeEl && repVol) {
    badgeEl.textContent = repVol.band.label;
    badgeEl.className = `volatility-badge ${repVol.band.key}`;
    badgeEl.style.display = 'inline-block';
    badgeEl.title = `Based on 3-month annualized volatility (${repVol.pct.toFixed(1)}%)`;
  }
}

/* ----------------------------------------------------------------
   VOLATILITY DETAILS MODAL — rolling 30-day annualized volatility
   chart + period breakdown, opened by clicking the Volatility card.
---------------------------------------------------------------- */
let _volChart = null;
let _volSeasonalityChart = null;
let _volDailyMoves = [];
let _volWeeklyMoves = [];
let _volMonthlyMoves = [];
let _volYearlyMoves = [];
let _volBreachView = 'days'; // 'days' | 'weeks' | 'months' | 'years'
let _volLatestDate = null; // most recent trading date for the loaded symbol, anchors the lookback slider

const VOL_BREACH_SCOPES = [
  { key: 'days',   label: 'Days',   unit: 'trading days', movesOf: () => _volDailyMoves },
  { key: 'weeks',  label: 'Weeks',  unit: 'weeks',        movesOf: () => _volWeeklyMoves },
  { key: 'months', label: 'Months', unit: 'months',       movesOf: () => _volMonthlyMoves },
  { key: 'years',  label: 'Years',  unit: 'years',        movesOf: () => _volYearlyMoves },
];

function ensureVolatilityModal() {
  if (document.getElementById('vol-hist-modal')) return;

  const style = document.createElement('style');
  style.textContent = `
    #vol-hist-modal { display:none; position:fixed; inset:0; z-index:9500; background:rgba(0,0,0,.6); align-items:center; justify-content:center; padding:20px; }
    #vol-hist-modal.open { display:flex; animation:_vhbIn .15s ease; }
    @keyframes _vhbIn { from{opacity:0} to{opacity:1} }
    .vol-hist-inner { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; width:100%; max-width:640px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; animation:_vhIn .15s ease; }
    @keyframes _vhIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:none} }
    .vol-hist-hd { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--border); flex-shrink:0; }
    .vol-hist-hd h3 { font-family:var(--mono); font-size:12px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; color:var(--text-primary); margin:0; }
    .vol-hist-close { background:none; border:none; color:var(--text-muted); font-size:22px; cursor:pointer; padding:0 4px; line-height:1; transition:color .15s; }
    .vol-hist-close:hover { color:var(--text-primary); }
    .vol-hist-body { padding:22px; overflow-y:auto; flex:1; }
    .vol-hist-stats { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--border); border-radius:var(--radius-md,8px); overflow:hidden; margin-bottom:20px; }
    .vol-hist-stat { padding:12px 16px; border-right:1px solid var(--border); }
    .vol-hist-stat:last-child { border-right:none; }
    .vol-hist-stat-lbl { font-family:var(--mono); font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1.2px; margin-bottom:4px; }
    .vol-hist-stat-val { font-family:var(--mono); font-size:16px; font-weight:700; color:var(--text-primary); }
    .vol-hist-chart-hd { font-family:var(--mono); font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1.2px; margin-bottom:8px; }
    .vol-hist-chart { position:relative; height:200px; margin-bottom:20px; }
    .vol-hist-tbl { width:100%; border-collapse:collapse; font-family:var(--mono); font-size:11px; }
    .vol-hist-tbl thead th { padding:8px 12px; font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.8px; border-bottom:1px solid var(--border); text-align:left; }
    .vol-hist-tbl thead th.r { text-align:right; }
    .vol-hist-tbl tbody tr { border-bottom:1px solid var(--border); }
    .vol-hist-tbl td { padding:9px 12px; color:var(--text-secondary); }
    .vol-hist-tbl td.r { text-align:right; font-weight:700; }
    .vol-hist-note { margin-top:14px; font-size:10px; line-height:1.5; color:var(--text-muted); }
    .vol-hist-breach { margin-top:22px; padding-top:18px; border-top:1px solid var(--border); }
    .vol-hist-breach-hd { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
    .vol-hist-thresh-row { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--text-secondary); }
    .vol-hist-thresh-row input[type=range] { width:120px; accent-color:var(--accent); }
    .vol-hist-thresh-row #vol-hist-thresh-label { flex-shrink:0; min-width:72px; text-align:right; color:var(--text-primary); font-family:var(--mono); font-size:11px; }
    .vol-hist-lookback-row { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--text-secondary); margin-bottom:14px; }
    .vol-hist-lookback-row input[type=range] { flex:1; accent-color:var(--accent); }
    .vol-hist-lookback-row #vol-hist-lookback-label { flex-shrink:0; min-width:104px; text-align:right; color:var(--text-primary); font-family:var(--mono); font-size:10px; }
    .vol-hist-breach-note { font-size:10px; line-height:1.5; color:var(--text-muted); margin-bottom:12px; }
    .vol-hist-breach-summary { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
    .vol-hist-breach-stat { font-size:12px; color:var(--text-secondary); line-height:1.5; background:var(--bg-secondary,rgba(255,255,255,.03)); border:1px solid var(--border); border-radius:var(--radius-md,8px); padding:10px 12px; }
    .vol-hist-breach-stat b { color:var(--text-primary); font-family:var(--mono); font-size:14px; }
    .vol-hist-breach-tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
    .vol-hist-breach-tab { font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.8px; background:none; border:1px solid var(--border); border-radius:6px; color:var(--text-muted); padding:5px 10px; cursor:pointer; transition:all .15s; }
    .vol-hist-breach-tab:hover { color:var(--text-primary); }
    .vol-hist-breach-tab.active { color:var(--accent); border-color:var(--accent); background:rgba(88,166,255,.08); }
    .vol-hist-breach-list-wrap { max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-md,8px); }
    .vol-hist-breach-tbl { font-size:11px; }
    .vol-hist-breach-tbl thead th { position:sticky; top:0; background:var(--bg-card); }
    .vol-hist-breach-tbl tbody tr:last-child { border-bottom:none; }
    .vol-hist-breach-empty { padding:20px 12px; text-align:center; color:var(--text-muted); font-size:11px; }
    .vol-hist-season-note { font-size:10px; line-height:1.5; color:var(--text-muted); margin-bottom:10px; }
    .vol-hist-season-chart { position:relative; height:190px; }
  `;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.id = 'vol-hist-modal';
  modal.innerHTML = `
    <div class="vol-hist-inner" onclick="event.stopPropagation()">
      <div class="vol-hist-hd">
        <h3 id="vol-hist-title">Volatility Details</h3>
        <button class="vol-hist-close" onclick="closeVolatilityModal()">✕</button>
      </div>
      <div class="vol-hist-body">
        <div class="vol-hist-stats" id="vol-hist-stats"></div>
        <div class="vol-hist-chart-hd">30-Day Rolling Annualized Volatility</div>
        <div class="vol-hist-chart"><canvas id="vol-hist-canvas"></canvas></div>
        <table class="vol-hist-tbl">
          <thead><tr><th>Period</th><th class="r">Annualized Volatility</th><th class="r">Level</th></tr></thead>
          <tbody id="vol-hist-tbody"></tbody>
        </table>
        <div class="vol-hist-note">Annualized standard deviation of daily log returns (×&radic;252). Bands (Low/Moderate/High/Very High) are a simple heuristic, not an official rating. "—" means there wasn't enough trading history in that window to compute a meaningful figure.</div>

        <div class="vol-hist-breach">
          <div class="vol-hist-breach-hd">
            <div class="vol-hist-chart-hd" style="margin-bottom:0">Threshold Breach Analysis</div>
            <div class="vol-hist-thresh-row">
              <span>Moves of &plusmn;</span>
              <input type="range" id="vol-hist-thresh" min="0.5" max="20" step="0.5" value="5">
              <span id="vol-hist-thresh-label">5% or more</span>
            </div>
          </div>
          <div class="vol-hist-lookback-row">
            <span>Look back</span>
            <input type="range" id="vol-hist-lookback" min="30" max="365" step="1" value="365">
            <span id="vol-hist-lookback-label">All history</span>
          </div>
          <div class="vol-hist-breach-note">A move is that period's (High &minus; Low) &divide; Low &mdash; the size of its own price range, not the change from the prior close.</div>
          <div class="vol-hist-breach-summary" id="vol-hist-breach-summary"></div>
          <div class="vol-hist-breach-tabs">
            ${VOL_BREACH_SCOPES.map((s, i) => `<button class="vol-hist-breach-tab${i === 0 ? ' active' : ''}" id="vol-hist-tab-${s.key}" onclick="window.setVolBreachView('${s.key}')">${s.label}</button>`).join('')}
          </div>
          <div class="vol-hist-breach-list-wrap">
            <table class="vol-hist-tbl vol-hist-breach-tbl">
              <thead><tr><th id="vol-hist-breach-col1">Date</th><th class="r">Low</th><th class="r">High</th><th class="r">Range %</th></tr></thead>
              <tbody id="vol-hist-breach-tbody"></tbody>
            </table>
            <div class="vol-hist-breach-empty" id="vol-hist-breach-empty" style="display:none">Nothing matched this threshold.</div>
          </div>

          <div class="vol-hist-chart-hd" id="vol-season-hd" style="margin-top:22px">Seasonality &mdash; % of Days &ge; 5% by Month</div>
          <div class="vol-hist-season-note">Every trading day in the selected look-back window, grouped by calendar month (Jan&ndash;Dec) regardless of year &mdash; shows which months have historically had more high-volatility days, not just the current one.</div>
          <div class="vol-hist-season-chart"><canvas id="vol-seasonality-canvas"></canvas></div>
        </div>
      </div>
    </div>`;
  modal.addEventListener('click', closeVolatilityModal);
  document.body.appendChild(modal);
  document.getElementById('vol-hist-thresh').addEventListener('input', renderVolBreaches);
  document.getElementById('vol-hist-lookback').addEventListener('input', renderVolBreaches);
}

// Recomputes and renders the day/week breach summary + active-tab list from
// the threshold and lookback-window currently in the controls, scoped to the
// moves cached by the last openVolatilityModal() call.
function renderVolBreaches() {
  const input = document.getElementById('vol-hist-thresh');
  const threshLabel = document.getElementById('vol-hist-thresh-label');
  const lookbackInput = document.getElementById('vol-hist-lookback');
  const lookbackLabel = document.getElementById('vol-hist-lookback-label');
  const summaryEl = document.getElementById('vol-hist-breach-summary');
  const tbody = document.getElementById('vol-hist-breach-tbody');
  const emptyEl = document.getElementById('vol-hist-breach-empty');
  const colHd = document.getElementById('vol-hist-breach-col1');
  if (!input || !lookbackInput || !summaryEl || !tbody) return;

  let threshold = parseFloat(input.value);
  if (!isFinite(threshold) || threshold < 0) threshold = 0;
  if (threshLabel) threshLabel.textContent = `${threshold % 1 === 0 ? threshold : threshold.toFixed(1)}% or more`;

  const lookbackMax = parseInt(lookbackInput.max, 10);
  let lookbackDays = parseInt(lookbackInput.value, 10);
  if (!isFinite(lookbackDays) || lookbackDays < 1) lookbackDays = lookbackMax;
  const isFullHistory = lookbackDays >= lookbackMax;
  if (lookbackLabel) lookbackLabel.textContent = isFullHistory ? `All history (${lookbackMax}d)` : `Last ${lookbackDays} days`;

  const cutoff = _volLatestDate ? new Date(_volLatestDate.getTime() - lookbackDays * 86400000) : null;

  const scopedHits = {}; // key -> { scoped, hits }
  VOL_BREACH_SCOPES.forEach(s => {
    const scoped = cutoff ? s.movesOf().filter(m => m.date >= cutoff) : s.movesOf();
    const hits = scoped.filter(m => m.rangePct >= threshold);
    scopedHits[s.key] = { scoped, hits };
  });

  summaryEl.innerHTML = VOL_BREACH_SCOPES.map(s => {
    const { scoped, hits } = scopedHits[s.key];
    const pct = scoped.length ? (hits.length / scoped.length * 100) : 0;
    return `<div class="vol-hist-breach-stat"><b>${hits.length}</b> of ${scoped.length} ${s.unit} (${pct.toFixed(1)}%) moved &ge; ${threshold}%</div>`;
  }).join('');

  const activeScope = VOL_BREACH_SCOPES.find(s => s.key === _volBreachView) || VOL_BREACH_SCOPES[0];
  const hits = scopedHits[activeScope.key].hits.slice().sort((a, b) => b.date - a.date);
  if (colHd) colHd.textContent = activeScope.key === 'days' ? 'Date' : activeScope.key === 'weeks' ? 'Week Of' : activeScope.key === 'months' ? 'Month' : 'Year';

  if (!hits.length) {
    tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    tbody.innerHTML = hits.map(m => `
      <tr>
        <td>${m.label}</td>
        <td class="r">${m.low.toFixed(2)}</td>
        <td class="r">${m.high.toFixed(2)}</td>
        <td class="r" style="color:#f0883e">${m.rangePct.toFixed(2)}%</td>
      </tr>`).join('');
  }

  const seasonHd = document.getElementById('vol-season-hd');
  const threshStr = threshold % 1 === 0 ? threshold : threshold.toFixed(1);
  if (seasonHd) seasonHd.innerHTML = `Seasonality &mdash; % of Days &ge; ${threshStr}% by Month`;
  renderVolSeasonality(computeMonthlySeasonality(scopedHits.days.scoped, threshold), threshStr);
}

// Bar chart of computeMonthlySeasonality() output — one bar per calendar
// month (Jan-Dec pooled across years), % of that month's days that breached
// the current threshold. No-ops until Chart.js is loaded; drawVolChart()'s
// load callback re-invokes renderVolBreaches() so this still paints once it
// becomes available even if the user never touches a slider.
function renderVolSeasonality(monthlyStats, threshStr) {
  const canvas = document.getElementById('vol-seasonality-canvas');
  if (!canvas || typeof Chart === 'undefined') return;
  if (_volSeasonalityChart) { _volSeasonalityChart.destroy(); _volSeasonalityChart = null; }
  const sf = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  _volSeasonalityChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: monthlyStats.map(m => m.month),
      datasets: [{
        data: monthlyStats.map(m => m.pct),
        backgroundColor: '#f0883e',
        borderRadius: 3,
        maxBarThickness: 34,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161b24', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
          titleFont: { family: sf, size: 11 }, bodyFont: { family: sf, size: 12 },
          callbacks: {
            label: ctx => {
              const m = monthlyStats[ctx.dataIndex];
              return m.total ? `  ${m.hits} of ${m.total} days ≥ ${threshStr}%` : '  no trading days in this window';
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8fa3c0', font: { family: sf, size: 10 } }, border: { display: false } },
        y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#8fa3c0', font: { family: sf, size: 9 }, callback: v => v + '%' }, border: { color: 'rgba(255,255,255,.07)' } }
      }
    }
  });
}

window.setVolBreachView = function(view) {
  _volBreachView = view;
  VOL_BREACH_SCOPES.forEach(s => document.getElementById(`vol-hist-tab-${s.key}`)?.classList.toggle('active', s.key === view));
  renderVolBreaches();
};

window.openVolatilityModal = async function(code) {
  code = code || window.currentStockCode;
  if (!code) return;

  // Reuse the already-fetched/parsed series from the card if it's for the
  // same symbol; otherwise fetch fresh (e.g. modal opened before the card
  // finished loading).
  let records = (_volatilityCode === code) ? _volatilityRecords : null;
  if (!records) {
    try {
      const res = await fetch(`${API}/api/history/${encodeURIComponent(code)}`);
      const { data } = await res.json();
      records = (data || [])
        .map(r => ({ date: new Date(r.Date.replace(/\//g, '-')), close: parseFloat(r.Close), high: parseFloat(r.High), low: parseFloat(r.Low) }))
        .filter(r => !isNaN(r.date.getTime()) && !isNaN(r.close) && r.close > 0)
        .sort((a, b) => a.date - b.date);
    } catch {
      records = [];
    }
  }
  if (records.length < VOL_MIN_RETURNS + 1) return; // not enough data for any of this to be meaningful

  ensureVolatilityModal();
  document.getElementById('vol-hist-title').textContent = `${code} — Volatility Details`;

  const latest = records[records.length - 1];
  const periods = [
    { label: '1 Month',  days: 30  },
    { label: '3 Months', days: 91  },
    { label: '6 Months', days: 182 },
    { label: '1 Year',   days: 365 },
  ];
  const periodResults = periods.map(p => ({ ...p, pct: computeAnnualizedVol(records, latest, p.days) }));

  // Rolling series drives both the chart and the "1Y high/avg" stats —
  // restricted to the trailing year so the summary reflects recent regime,
  // not the stock's entire (possibly much longer) history.
  const rollingFull = computeRollingVolatility(records, 30);
  const oneYearAgo = new Date(latest.date.getTime() - 365 * 86400000);
  const rolling1Y = rollingFull.filter(pt => pt.date >= oneYearAgo);

  const current = periodResults.find(p => p.days === 91)?.pct ?? null;
  const rollingVals = rolling1Y.map(p => p.pct);
  const high1Y = rollingVals.length ? Math.max(...rollingVals) : null;
  const avg1Y  = rollingVals.length ? rollingVals.reduce((s, v) => s + v, 0) / rollingVals.length : null;
  const fmtPct = v => v == null ? '—' : `${v.toFixed(1)}%`;

  document.getElementById('vol-hist-stats').innerHTML = `
    <div class="vol-hist-stat"><div class="vol-hist-stat-lbl">Current (3M)</div><div class="vol-hist-stat-val">${fmtPct(current)}</div></div>
    <div class="vol-hist-stat"><div class="vol-hist-stat-lbl">1Y Rolling High</div><div class="vol-hist-stat-val" style="color:var(--loss)">${fmtPct(high1Y)}</div></div>
    <div class="vol-hist-stat"><div class="vol-hist-stat-lbl">1Y Rolling Avg</div><div class="vol-hist-stat-val" style="color:var(--accent)">${fmtPct(avg1Y)}</div></div>`;

  document.getElementById('vol-hist-tbody').innerHTML = periodResults.map(p => {
    const band = p.pct == null ? null : volBandFor(p.pct);
    const cls = band ? (band.key === 'vol-low' ? 'gain' : band.key === 'vol-veryhigh' ? 'loss' : '') : '';
    return `<tr>
      <td>${p.label}</td>
      <td class="r ${cls}">${fmtPct(p.pct)}</td>
      <td class="r" style="color:${band ? `var(--${band.key === 'vol-low' ? 'gain' : band.key === 'vol-veryhigh' ? 'loss' : 'text-secondary'})` : 'inherit'}">${band ? band.label : '—'}</td>
    </tr>`;
  }).join('');

  // Chart — use the fuller rolling series (not just the trailing year) so a
  // deep-history symbol like BPML shows its real long-run volatility shape.
  const chartSeries = rollingFull.length > 400 ? rollingFull.slice(-400) : rollingFull;
  const sf = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  if (_volChart) { _volChart.destroy(); _volChart = null; }

  function drawVolChart() {
    _volChart = new Chart(document.getElementById('vol-hist-canvas'), {
      type: 'line',
      data: {
        labels: chartSeries.map(p => p.date.toISOString().slice(0, 10)),
        datasets: [{
          label: '30D Rolling Annualized Volatility (%)',
          data: chartSeries.map(p => p.pct),
          borderColor: '#f0883e',
          backgroundColor: 'rgba(240,136,62,0.12)',
          borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.15,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161b24', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
            titleFont: { family: sf, size: 11 }, bodyFont: { family: sf, size: 12 },
            callbacks: { label: ctx => `  ${ctx.raw.toFixed(1)}% annualized` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8fa3c0', font: { family: sf, size: 9 }, maxTicksLimit: 8 }, border: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#f0883e', font: { family: sf, size: 10 }, callback: v => v + '%' }, border: { color: 'rgba(255,255,255,.07)' } }
        }
      }
    });
  }

  _volDailyMoves = computeDailyMoves(records);
  _volWeeklyMoves = computeWeeklyMoves(records);
  _volMonthlyMoves = computeMonthlyMoves(records);
  _volYearlyMoves = computeYearlyMoves(records);
  _volLatestDate = latest.date;

  const lookbackInput = document.getElementById('vol-hist-lookback');
  const spanDays = Math.max(1, Math.round((latest.date - records[0].date) / 86400000));
  lookbackInput.min = Math.min(30, spanDays);
  lookbackInput.max = spanDays;
  lookbackInput.value = spanDays; // default to full available history

  renderVolBreaches();

  typeof Chart !== 'undefined' ? drawVolChart() : (() => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    sc.onload = () => { drawVolChart(); renderVolBreaches(); }; // Chart wasn't loaded yet when renderVolBreaches() ran above, so the seasonality bar chart needs a repaint now that it is
    document.head.appendChild(sc);
  })();

  document.getElementById('vol-hist-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeVolatilityModal = function() {
  const m = document.getElementById('vol-hist-modal');
  if (m) m.classList.remove('open');
  document.body.style.overflow = '';
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeVolatilityModal?.(); });

/* ----------------------------------------------------------------
   SECTOR PEER COMPARISON — where this stock sits among the other
   stocks in its DSE sector on the two axes that matter: 3-month
   return (did it go up?) and 3-month annualized volatility (how
   rough was the ride?).

   Built to be readable without a stats background:
     · a plain-English verdict up top,
     · two percentile meters with named ends — never a bare "#23 of 36",
     · a scatter split at the peer medians with its four corners
       labelled, so a dot's position means something on sight,
     · a ranked table for anyone who'd rather just read the numbers.
   The return/vol math is computeReturnPct / computeAnnualizedVol —
   the same helpers the Returns and Volatility cards use, so these
   numbers can never disagree with the widgets above.
---------------------------------------------------------------- */
const SECTOR_PEER_WINDOW_DAYS = 91; // 3M, matches the "3M" period shown elsewhere on this page
const MAX_SECTOR_PEERS = 40; // bound worst-case fetch fan-out for large sectors (Textile has 56 members)
const PEER_SELF_COLOR = '#f0883e'; // "this stock" orange — same highlight the volatility charts use
let _sectorPeerChart = null;

const fmtSignedPct = v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

function peerMedian(vals) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Canvas can't read CSS custom properties, so resolve the theme tokens to
// literal colors at draw time — that keeps the chart legible in the light
// theme too instead of baking in the dark palette.
function themeColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function withAlpha(hex, a) {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return (full.length !== 6 || Number.isNaN(n))
    ? hex
    : `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

async function fetchStockRecords(code) {
  try {
    const res = await fetch(`${API}/api/history/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const { data } = await res.json();
    const records = (data || [])
      .map(r => ({ date: new Date(r.Date.replace(/\//g, '-')), close: parseFloat(r.Close) }))
      .filter(r => !isNaN(r.date.getTime()) && !isNaN(r.close) && r.close > 0)
      .sort((a, b) => a.date - b.date);
    return records.length >= 2 ? records : null;
  } catch {
    return null;
  }
}

async function loadSectorComparison(code, sector, sectorsMap) {
  const section   = document.getElementById('sectorPeerSection');
  const subEl     = document.getElementById('sector-peer-sub');
  const verdictEl = document.getElementById('sector-peer-verdict');
  const statsEl   = document.getElementById('sector-peer-stats');
  const titleEl   = document.getElementById('sector-peer-title');
  const chartEl   = document.getElementById('sector-peer-chartwrap');
  const toggleBtn = document.getElementById('sector-peer-toggle');
  const tableWrap = document.getElementById('sector-peer-table');
  if (!section || !sector || sector === '—') return;

  const allPeerCodes = Object.keys(sectorsMap).filter(c => sectorsMap[c] === sector && c !== code);
  if (!allPeerCodes.length) return; // no other stocks tagged with this sector — nothing to compare against

  section.style.display = '';
  titleEl.textContent = `Sector Peer Comparison — ${sector}`;
  const capped = allPeerCodes.length > MAX_SECTOR_PEERS;
  const peerCodes = capped ? allPeerCodes.slice(0, MAX_SECTOR_PEERS) : allPeerCodes;

  const [selfRecords, ...peerRecordsList] = await Promise.all(
    [code, ...peerCodes].map(fetchStockRecords)
  );

  function toPoint(c, records) {
    if (!records) return null;
    const latest = records[records.length - 1];
    const ret = computeReturnPct(records, latest, SECTOR_PEER_WINDOW_DAYS);
    const vol = computeAnnualizedVol(records, latest, SECTOR_PEER_WINDOW_DAYS);
    return (ret == null || vol == null) ? null : { code: c, ret, vol };
  }

  // Nothing to say without both sides of the comparison — blank the widget
  // rather than leaving half-rendered stats from a previous state.
  function bail(msg) {
    subEl.textContent = msg;
    verdictEl.innerHTML = '';
    statsEl.innerHTML = '';
    chartEl.style.display = 'none';
    toggleBtn.style.display = 'none';
  }

  const selfPoint = toPoint(code, selfRecords);
  const peerPoints = peerCodes.map((c, i) => toPoint(c, peerRecordsList[i])).filter(Boolean);
  if (!selfPoint)       return bail('Not enough price history for this stock to compare.');
  if (!peerPoints.length) return bail(`No ${sector} peers had enough price history to compare.`);

  const allPoints = [selfPoint, ...peerPoints];
  const n = allPoints.length;

  // Medians are peers-only, so "the middle of the pack" is a yardstick this
  // stock is measured against rather than one it's part of.
  const medRet = peerMedian(peerPoints.map(p => p.ret));
  const medVol = peerMedian(peerPoints.map(p => p.vol));

  const beatsCount    = peerPoints.filter(p => p.ret < selfPoint.ret).length;
  const peersCalmer   = peerPoints.filter(p => p.vol < selfPoint.vol).length; // steadier than this stock
  const peersChoppier = peerPoints.filter(p => p.vol > selfPoint.vol).length;
  const pct = k => Math.round(k / peerPoints.length * 100);
  // "beats 50% of peers" is a silly way to say "beats 1 of its 2 peers" —
  // below a handful of peers, percentages read as more precision than exists.
  const share = k => peerPoints.length < 5 ? `${k} of ${peerPoints.length}` : `${pct(k)}%`;
  const returnRank = 1 + peerPoints.filter(p => p.ret > selfPoint.ret).length;
  const volRank    = 1 + peersCalmer; // 1 = calmest in the sector

  subEl.textContent = capped
    ? `How ${code} compares with ${peerCodes.length} of its ${allPeerCodes.length} ${sector} peers over the last 3 months`
    : `How ${code} compares with the other ${peerPoints.length} ${sector} stocks over the last 3 months`;

  /* ── Verdict — the one sentence someone should be able to stop at ── */
  const stronger = selfPoint.ret >= medRet;
  const calmer   = selfPoint.vol <= medVol;
  const swingClause = peerPoints.length < 5
    ? `it ${calmer ? 'moves more gently' : 'swings harder'} than ${calmer ? peersChoppier : peersCalmer} of its ${peerPoints.length} peers`
    : `it ${calmer ? 'moves more gently' : 'swings harder'} than ${pct(calmer ? peersChoppier : peersCalmer)}% of them`;
  verdictEl.className = `sector-peer-verdict ${stronger ? 'is-strong' : 'is-weak'}`;
  verdictEl.innerHTML = `
    <div class="sector-peer-verdict-head">${stronger ? 'Stronger' : 'Weaker'} return, ${calmer ? 'calmer' : 'choppier'} ride than the typical ${sector} stock</div>
    <div class="sector-peer-verdict-body">${selfPoint.ret >= 0 ? 'Up' : 'Down'} ${Math.abs(selfPoint.ret).toFixed(1)}% over 3 months where the middle peer did ${fmtSignedPct(medRet)}, and ${swingClause}.</div>`;

  /* ── Two meters: value, where it sits in the pack, and the yardstick ── */
  const meter = (posPct, leftLbl, rightLbl) => `
    <div class="sector-peer-meter"><span class="sector-peer-meter-dot" style="left:${posPct}%"></span></div>
    <div class="sector-peer-meter-ends"><span>${leftLbl}</span><span>${rightLbl}</span></div>`;
  statsEl.innerHTML = `
    <div class="sector-peer-stat">
      <div class="sector-peer-stat-lbl">3M Return</div>
      <div class="sector-peer-stat-val ${selfPoint.ret >= 0 ? 'gain' : 'loss'}">${fmtSignedPct(selfPoint.ret)}</div>
      ${meter(pct(beatsCount), 'worst', 'best')}
      <div class="sector-peer-stat-note">#${returnRank} of ${n} · beats ${share(beatsCount)} of peers<br>peer median ${fmtSignedPct(medRet)}</div>
    </div>
    <div class="sector-peer-stat">
      <div class="sector-peer-stat-lbl">3M Price Swing</div>
      <div class="sector-peer-stat-val">${selfPoint.vol.toFixed(1)}%</div>
      ${meter(pct(peersCalmer), 'calmest', 'wildest')}
      <div class="sector-peer-stat-note">#${volRank} calmest of ${n} · calmer than ${share(peersChoppier)}<br>peer median ${medVol.toFixed(1)}%</div>
    </div>`;

  /* ── Ranked table — the same data for people who'd rather read it ── */
  const ranked = [...allPoints].sort((a, b) => b.ret - a.ret);
  tableWrap.innerHTML = `
    <table class="sector-peer-table">
      <thead><tr><th>#</th><th>Code</th><th class="r">3M Return</th><th class="r">3M Swing</th></tr></thead>
      <tbody>${ranked.map((p, i) => `
        <tr class="${p.code === code ? 'is-self' : ''}">
          <td>${i + 1}</td>
          <td>${p.code === code ? `${p.code} <span class="sector-peer-you">this stock</span>` : `<a href="company.html?code=${encodeURIComponent(p.code)}">${p.code}</a>`}</td>
          <td class="r ${p.ret >= 0 ? 'gain' : 'loss'}">${fmtSignedPct(p.ret)}</td>
          <td class="r">${p.vol.toFixed(1)}%</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  const setToggleLabel = () => { toggleBtn.textContent = tableWrap.hidden ? `Show all ${n} stocks ▾` : 'Hide the list ▴'; };
  tableWrap.hidden = true;
  toggleBtn.style.display = '';
  toggleBtn.onclick = () => {
    tableWrap.hidden = !tableWrap.hidden;
    setToggleLabel();
    // Centre this stock in the scroll box — mid-table it would open off-screen.
    const row = !tableWrap.hidden && tableWrap.querySelector('tr.is-self');
    if (row) {
      const r = row.getBoundingClientRect(), box = tableWrap.getBoundingClientRect();
      tableWrap.scrollTop += (r.top - box.top) - (box.height - r.height) / 2;
    }
  };
  setToggleLabel();

  /* ── Scatter ─────────────────────────────────────────────────────
     Peer dots are deliberately recessive; this stock is the orange one,
     labelled in place so the chart reads without a hover (which a phone
     can't do anyway). The dashed crosshair at the peer medians turns the
     plot into four named corners — that's what makes a dot's position
     mean something at a glance. ─────────────────────────────────── */
  chartEl.style.display = '';

  function drawChart() {
    const canvas = document.getElementById('sector-peer-canvas');
    if (!canvas) return;
    if (_sectorPeerChart) { _sectorPeerChart.destroy(); _sectorPeerChart = null; }

    const sf     = "'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif";
    const mono   = "'Space Mono','Menlo',monospace";
    const muted  = themeColor('--text-muted', '#8a93a6');
    const card   = themeColor('--bg-card', '#ffffff');
    const grid   = withAlpha(muted, 0.16);

    // Corner labels: "how bumpy was it" × "how did it do", one per quadrant.
    // Stacked onto two lines when the plot is too narrow for one — the
    // corners are empty space anyway, and a clipped label helps nobody.
    const corners = [
      { x: 'left',  y: 'top',    words: ['CALMER', 'STRONGER'] },
      { x: 'right', y: 'top',    words: ['CHOPPIER', 'STRONGER'] },
      { x: 'left',  y: 'bottom', words: ['CALMER', 'WEAKER'] },
      { x: 'right', y: 'bottom', words: ['CHOPPIER', 'WEAKER'] },
    ];

    const quadrantPlugin = {
      id: 'peerQuadrants',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: ca, scales } = chart;
        if (!ca) return;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = withAlpha(muted, 0.55);
        const mx = scales.x.getPixelForValue(medVol);
        const my = scales.y.getPixelForValue(medRet);
        if (mx > ca.left && mx < ca.right) { ctx.beginPath(); ctx.moveTo(mx, ca.top); ctx.lineTo(mx, ca.bottom); ctx.stroke(); }
        if (my > ca.top && my < ca.bottom) { ctx.beginPath(); ctx.moveTo(ca.left, my); ctx.lineTo(ca.right, my); ctx.stroke(); }
        ctx.setLineDash([]);

        const oneLine = ca.right - ca.left > 360;
        ctx.font = `9px ${sf}`;
        ctx.fillStyle = withAlpha(muted, 0.95);
        corners.forEach(c => {
          const lines = oneLine ? [c.words.join('  ·  ')] : c.words;
          ctx.textAlign = c.x === 'left' ? 'left' : 'right';
          ctx.textBaseline = c.y === 'top' ? 'top' : 'bottom';
          const px = c.x === 'left' ? ca.left + 6 : ca.right - 6;
          lines.forEach((line, i) => {
            const row = c.y === 'top' ? i : i - (lines.length - 1);
            ctx.fillText(line, px, (c.y === 'top' ? ca.top + 5 : ca.bottom - 5) + row * 11);
          });
        });
        ctx.restore();
      },
      // Direct-label this stock so the chart reads without a hover. The pill
      // sits above the dot (below it near the top edge) and is clamped inside
      // the plot — in a crowded sector a bare label vanishes into the cluster.
      afterDatasetsDraw(chart) {
        const pt = chart.getDatasetMeta(1)?.data?.[0];
        const ca = chart.chartArea;
        if (!pt || !ca) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = `700 11px ${mono}`;
        const padX = 5, h = 17;
        const w = ctx.measureText(code).width + padX * 2;
        const below = pt.y - 14 - h < ca.top;
        const y = below ? pt.y + 14 : pt.y - 14 - h;
        const x = Math.min(Math.max(pt.x - w / 2, ca.left + 2), ca.right - w - 2);
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        ctx.fillStyle = card;
        ctx.globalAlpha = 0.92;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = PEER_SELF_COLOR;
        ctx.stroke();
        ctx.fillStyle = PEER_SELF_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code, x + w / 2, y + h / 2 + 0.5);
        ctx.restore();
      },
    };

    _sectorPeerChart = new Chart(canvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `Other ${sector} stocks`,
            data: peerPoints.map(p => ({ x: p.vol, y: p.ret, code: p.code })),
            backgroundColor: withAlpha(muted, 0.5),
            borderColor: card, // 2px surface ring keeps overlapping dots countable
            borderWidth: 1.5,
            radius: 5,
            hoverRadius: 7,
          },
          {
            label: `${code} (this stock)`,
            data: [{ x: selfPoint.vol, y: selfPoint.ret, code: selfPoint.code }],
            backgroundColor: PEER_SELF_COLOR,
            borderColor: card,
            borderWidth: 2,
            radius: 8,
            hoverRadius: 9,
          },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 4, right: 8, left: 2 } },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            display: true, position: 'bottom', reverse: true,
            labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', color: muted, font: { family: sf, size: 10 }, padding: 14 }
          },
          tooltip: {
            backgroundColor: themeColor('--bg-base', '#161b24'),
            borderColor: withAlpha(muted, 0.35), borderWidth: 1,
            titleColor: themeColor('--text-primary', '#e8eaf0'),
            bodyColor: themeColor('--text-secondary', '#9aa3b8'),
            titleFont: { family: mono, size: 11 }, bodyFont: { family: sf, size: 12 },
            displayColors: false, padding: 8,
            callbacks: {
              title: ctx => ctx[0].raw.code + (ctx[0].raw.code === code ? '  (this stock)' : ''),
              label: ctx => [`3M return  ${fmtSignedPct(ctx.raw.y)}`, `3M swing  ${ctx.raw.x.toFixed(1)}%`]
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'calmer  ←   3M price swing   →  choppier', color: muted, font: { family: sf, size: 10 } },
            grid: { color: grid }, border: { color: grid },
            ticks: { color: muted, font: { family: sf, size: 9 }, callback: v => v + '%' }
          },
          y: {
            title: { display: true, text: 'weaker  ←   3M return   →  stronger', color: muted, font: { family: sf, size: 10 } },
            grid: { color: grid }, border: { color: grid }, grace: '5%',
            ticks: { color: muted, font: { family: sf, size: 9 }, callback: v => v + '%' }
          }
        }
      },
      plugins: [quadrantPlugin],
    });
  }

  typeof Chart !== 'undefined' ? drawChart() : (() => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    sc.onload = drawChart;
    document.head.appendChild(sc);
  })();
}

/* ----------------------------------------------------------------
   FETCH ENRICHED DETAILS + RENDER STATS GRID
   Runs in parallel: scraped company page + local EPS data
---------------------------------------------------------------- */
async function fetchAndRenderDetails(code, ltp) {
  // Show loading skeleton on the stats grid
  const grid = document.getElementById('company-detail-stats');
  if (grid) {
    grid.innerHTML = Array(15).fill(0).map(() => `
      <div class="cds-card cds-card--loading">
        <div class="cds-skeleton cds-skeleton--label"></div>
        <div class="cds-skeleton cds-skeleton--value"></div>
      </div>`).join('');
  }

  const [detailsResult, finResult, sectorsResult] = await Promise.allSettled([
    fetch(`${API}/api/company-details/${code}`).then(r => r.json()),
    fetch(`${FIN_API}/${code}`).then(r => r.json()),
    fetch(`${API}/api/sectors`).then(r => r.json()),
  ]);

  const d          = detailsResult.status === 'fulfilled' ? detailsResult.value : {};
  const finData    = finResult.status     === 'fulfilled' ? finResult.value     : {};
  const sectorsMap = sectorsResult.status === 'fulfilled' ? sectorsResult.value : {};
  const sector     = sectorsMap[code] || null;

  // ── P/E from last 4 quarters EPS ──────────────────────────────
  const QORDER   = { Q1: 0, Q2: 1, Q3: 2, Q4: 3 };
  const epsArr   = (finData.eps || []).sort(
    (a, b) => b.year - a.year || (QORDER[b.quarter] ?? 0) - (QORDER[a.quarter] ?? 0)
  );
  const last4Eps = epsArr.slice(0, 4);
  const totalEps = last4Eps.reduce((s, e) => s + (parseFloat(e.value) || 0), 0);
  const localPE  = totalEps > 0 ? (ltp / totalEps).toFixed(2) : null;

  // ── NAV history from local financials (one value per year, prefer Q4) ──
  const navByYear = {};
  (finData.nav || []).forEach(e => {
    const qIdx = QORDER[e.quarter] ?? -1;
    if (!navByYear[e.year] || qIdx > (QORDER[navByYear[e.year].quarter] ?? -1)) navByYear[e.year] = e;
  });
  const navYears   = Object.keys(navByYear).map(Number).sort((a, b) => a - b);
  // Encode as "value (year), ..." — parsed by parseNavStr below
  const localNavRaw = navYears.length
    ? navYears.map(yr => `${parseFloat(navByYear[yr].value).toFixed(2)} (${yr})`).join(', ')
    : null;
  const navDisplay = localNavRaw
    ? (() => { const p = parseNavStr(localNavRaw); const l = p[p.length - 1]; return l ? `৳ ${l.val} (${l.year})` : null; })()
    : (d.nav ? `৳ ${parseFloat(d.nav).toFixed(2)}` : null);
  const navRaw = localNavRaw || (d.nav ? `${parseFloat(d.nav).toFixed(2)} (scraped)` : null);

  // ── Derived values ─────────────────────────────────────────────
  // `|| null` here would collapse a legitimate 0 (e.g. a bank reporting
  // zero short-term loans) into null, and fmtLarge(null) → null → interpolated
  // into the `৳ ${...}` template as the literal string "null".
  const numOf = str => {
    const n = parseFloat((str || '').toString().replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  };

  const totalShares = numOf(d.totalShares);
  const marketCap   = totalShares ? totalShares * ltp : null;

  // ── Build stat definitions ─────────────────────────────────────
  const stats = [
    // Row A — Price / valuation
    { label: 'LTP',            value: `৳ ${fmtN(ltp)}`,                         accent: ''       },
    { label: 'P/E RATIO',      value: localPE || d.pe || null,                    accent: ''       },
    { label: 'EPS (4 QTR)',    value: totalEps > 0 ? `৳ ${totalEps.toFixed(2)}` : fmtScraped(d.eps, '৳ '), accent: '' },
    { label: 'MARKET CAP',     value: marketCap ? `৳ ${fmtLarge(marketCap)}` : null, accent: ''  },

    // Row B — 52-week range
    { label: '52W HIGH',       value: d.weekHigh52  ? `৳ ${d.weekHigh52}`  : null, accent: 'gain' },
    { label: '52W LOW',        value: d.weekLow52   ? `৳ ${d.weekLow52}`   : null, accent: 'loss' },
    { label: 'BETA',           value: d.beta || null,                               accent: ''     },
    { label: 'DIVIDEND YIELD', value: d.dividendYield ? `${d.dividendYield}%` : null, accent: ''  },

    // Row C — Dividends / NAV
    { label: 'CASH DIVIDEND',  value: fmtDivLatest(d.cashDividend),  raw: d.cashDividend,  accent: 'gain', clickable: true  },
    { label: 'STOCK DIVIDEND', value: fmtDivLatest(d.stockDividend), raw: d.stockDividend, accent: 'gain', clickable: true  },
    { label: 'NAV / SHARE',    value: navDisplay, raw: navRaw, accent: '', clickable: !!localNavRaw },
    { label: 'TOTAL SHARES',   value: totalShares ? fmtLarge(totalShares) : null,     accent: ''      },
    { label: 'SECTOR',         value: sector,                                           accent: ''      },

    // Row D — Capital structure / debt
    { label: 'PAID UP CAP',    value: d.paidUpCapital     ? `৳ ${fmtLarge(numOf(d.paidUpCapital))}` : null,     accent: '' },
    { label: 'AUTHORIZED CAP', value: d.authorizedCapital ? `৳ ${fmtLarge(numOf(d.authorizedCapital))}` : null, accent: '' },
    { label: 'SHORT TERM LOAN',value: d.shortTermLoan     ? `৳ ${fmtLarge(numOf(d.shortTermLoan))}` : null,     accent: 'loss' },
    { label: 'LONG TERM LOAN', value: d.longTermLoan      ? `৳ ${fmtLarge(numOf(d.longTermLoan))}` : null,      accent: 'loss' },
  ];

  renderStatsGrid(stats);
}

/* ----------------------------------------------------------------
   RENDER — stat grid cards
---------------------------------------------------------------- */
function renderStatsGrid(stats) {
  const grid = document.getElementById('company-detail-stats');
  if (!grid) return;

  grid.innerHTML = stats.map(s => {
    const val     = s.value;
    const display = (val !== null && val !== undefined && val !== '' && val !== '0' && val !== '0.00')
      ? val : '—';
    const accentClass   = s.accent    ? ` cds-val--${s.accent}` : '';
    const emptyClass    = display === '—' ? ' cds-card--empty' : '';
    const clickableAttr = s.clickable && display !== '—'
      ? ` cds-card--clickable" onclick="openDivModal(this)`
      : '';
    const rawAttr = s.raw ? ` data-raw="${escAttr(s.raw)}"` : '';
    const labelAttr = ` data-label="${escAttr(s.label)}"`;

    return `
      <div class="cds-card${emptyClass}${s.clickable && display !== '—' ? ' cds-card--clickable' : ''}"
           ${s.clickable && display !== '—' ? `onclick="openDivModal(this)"` : ''}
           ${rawAttr}${labelAttr}>
        <div class="cds-label">${s.label}</div>
        <div class="cds-val${accentClass}">${display}</div>
        ${s.clickable && display !== '—' ? '<div class="cds-hint">📊 tap for history</div>' : ''}
      </div>`;
  }).join('');
}

/* ----------------------------------------------------------------
   FORMAT HELPERS
---------------------------------------------------------------- */
function fmtN(n, dec = 2) {
  if (n == null || isNaN(n)) return '—';
  return parseFloat(n).toLocaleString('en-BD', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtLarge(n) {
  if (n === null || n === undefined || isNaN(n)) return null;
  if (n === 0) return '0.00';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

function fmtScraped(val, prefix = '') {
  if (!val) return null;
  const n = parseFloat(val.toString().replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? val : `${prefix}${n.toFixed(2)}`;
}

/* ----------------------------------------------------------------
   DIVIDEND HELPERS
---------------------------------------------------------------- */
/** Extract only the latest year's value to show on the card */
function fmtDivLatest(raw) {
  if (!raw) return null;
  const pairs = parseDivStr(raw);
  if (!pairs.length) return raw; // fallback to raw string
  const latest = pairs[pairs.length - 1];
  return `${latest.pct}% (${latest.year})`;
}

/** Parse "17.50% 2025, 15% 2024, 10% 2023" → [{pct, year}, …] sorted asc */
function parseDivStr(raw) {
  if (!raw) return [];
  const results = [];
  const re = /(\d+(?:\.\d+)?)\s*%[^,\d]*(\d{4})/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    results.push({ pct: parseFloat(m[1]), year: parseInt(m[2]) });
  }
  return results.sort((a, b) => a.year - b.year);
}

// Parse NAV history string: "20.70 (2024), 18.50 (2023)" → [{val, year}, ...]
function parseNavStr(raw) {
  if (!raw) return [];
  const results = [];
  const re = /(-?\d+(?:\.\d+)?)\s*\((\d{4}|scraped)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m[2] !== 'scraped') results.push({ val: m[1], year: parseInt(m[2]) });
  }
  return results.sort((a, b) => a.year - b.year);
}

function escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ----------------------------------------------------------------
   DIVIDEND HISTORY MODAL
---------------------------------------------------------------- */
let _divChart = null;

function ensureDivModal() {
  if (document.getElementById('div-hist-modal')) return;

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    .cds-card--clickable { cursor: pointer; transition: border-color .15s; }
    .cds-card--clickable:hover { border-color: var(--accent) !important; }
    .cds-hint { font-family: var(--mono); font-size: 9px; color: var(--text-muted); text-align: center; margin-top: 8px; letter-spacing: 0.3px; opacity: 0; transition: opacity .15s; }
    .cds-card--clickable:hover .cds-hint { opacity: 1; }

    #div-hist-modal { display:none; position:fixed; inset:0; z-index:9500; background:rgba(0,0,0,.6); align-items:center; justify-content:center; padding:20px; }
    #div-hist-modal.open { display:flex; animation:_dhbIn .15s ease; }
    @keyframes _dhbIn { from{opacity:0} to{opacity:1} }
    .div-hist-inner { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; width:100%; max-width:580px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; animation:_dhIn .15s ease; }
    @keyframes _dhIn { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:none} }
    .div-hist-hd { display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--border); flex-shrink:0; }
    .div-hist-hd h3 { font-family:var(--mono); font-size:12px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; color:var(--text-primary); margin:0; }
    .div-hist-close { background:none; border:none; color:var(--text-muted); font-size:22px; cursor:pointer; padding:0 4px; line-height:1; transition:color .15s; }
    .div-hist-close:hover { color:var(--text-primary); }
    .div-hist-body { padding:22px; overflow-y:auto; flex:1; }
    .div-hist-stats { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--border); border-radius:var(--radius-md,8px); overflow:hidden; margin-bottom:20px; }
    .div-hist-stat { padding:12px 16px; border-right:1px solid var(--border); }
    .div-hist-stat:last-child { border-right:none; }
    .div-hist-stat-lbl { font-family:var(--mono); font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1.2px; margin-bottom:4px; }
    .div-hist-stat-val { font-family:var(--mono); font-size:16px; font-weight:700; color:var(--gain); }
    .div-hist-chart { position:relative; height:220px; margin-bottom:18px; }
    .div-hist-tbl { width:100%; border-collapse:collapse; font-family:var(--mono); font-size:11px; }
    .div-hist-tbl thead th { padding:8px 12px; font-size:9px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.8px; border-bottom:1px solid var(--border); text-align:left; }
    .div-hist-tbl thead th.r { text-align:right; }
    .div-hist-tbl tbody tr { border-bottom:1px solid var(--border); transition:background .1s; }
    .div-hist-tbl tbody tr:hover { background:var(--bg-row-hover); }
    .div-hist-tbl td { padding:9px 12px; color:var(--text-secondary); }
    .div-hist-tbl td.r { text-align:right; }
    .div-hist-tbl td.gain { color:var(--gain); font-weight:700; text-align:right; }
    .div-hist-tbl td.loss { color:var(--loss); text-align:right; }
  `;
  document.head.appendChild(style);

  // Modal HTML
  const modal = document.createElement('div');
  modal.id = 'div-hist-modal';
  modal.innerHTML = `
    <div class="div-hist-inner" onclick="event.stopPropagation()">
      <div class="div-hist-hd">
        <h3 id="div-hist-title">Dividend History</h3>
        <button class="div-hist-close" onclick="closeDivModal()">✕</button>
      </div>
      <div class="div-hist-body">
        <div class="div-hist-stats" id="div-hist-stats"></div>
        <div class="div-hist-chart"><canvas id="div-hist-canvas"></canvas></div>
        <table class="div-hist-tbl">
          <thead><tr>
            <th>Year</th>
            <th class="r">Dividend (%)</th>
            <th class="r">Change</th>
          </tr></thead>
          <tbody id="div-hist-tbody"></tbody>
        </table>
      </div>
    </div>`;
  modal.addEventListener('click', closeDivModal);
  document.body.appendChild(modal);
}

window.openDivModal = function(card) {
  ensureDivModal();
  const raw   = card.getAttribute('data-raw') || '';
  const label = card.getAttribute('data-label') || 'Dividend';

  // Detect NAV vs dividend by label
  const isNAV = label.includes('NAV');
  const pairs = isNAV ? parseNavStr(raw) : parseDivStr(raw);
  if (!pairs.length) return;

  document.getElementById('div-hist-title').textContent = label + ' — History';

  const unit = isNAV ? '৳' : '%';

  // Stats bar
  const latest   = pairs[pairs.length - 1];
  const latestV  = isNAV ? parseFloat(latest.val) : latest.pct;
  const allVals  = pairs.map(p => isNAV ? parseFloat(p.val) : p.pct);
  const maxV     = Math.max(...allVals);
  const avgV     = allVals.reduce((s, v) => s + v, 0) / allVals.length;
  const fmtV     = v => isNAV ? `৳ ${v.toFixed(2)}` : `${v.toFixed(2)}%`;
  document.getElementById('div-hist-stats').innerHTML = `
    <div class="div-hist-stat"><div class="div-hist-stat-lbl">Latest (${latest.year})</div><div class="div-hist-stat-val">${fmtV(latestV)}</div></div>
    <div class="div-hist-stat"><div class="div-hist-stat-lbl">Highest</div><div class="div-hist-stat-val">${fmtV(maxV)}</div></div>
    <div class="div-hist-stat"><div class="div-hist-stat-lbl">Avg (${pairs.length}yr)</div><div class="div-hist-stat-val" style="color:var(--accent)">${fmtV(avgV)}</div></div>`;

  // Table header
  document.querySelector('#div-hist-modal .div-hist-tbl thead tr').innerHTML = `
    <th>Year</th>
    <th class="r">${isNAV ? 'NAV / Share (৳)' : 'Dividend (%)'}</th>
    <th class="r">Change</th>`;

  // Table (newest first)
  const rev = [...pairs].reverse();
  document.getElementById('div-hist-tbody').innerHTML = rev.map((d, i) => {
    const dVal  = isNAV ? parseFloat(d.val) : d.pct;
    const prev  = rev[i + 1];
    const prevV = prev ? (isNAV ? parseFloat(prev.val) : prev.pct) : null;
    const delta = prevV != null ? dVal - prevV : null;
    const dStr  = delta == null ? '—' : (delta >= 0 ? `+${delta.toFixed(2)}${isNAV ? '' : '%'}` : `${delta.toFixed(2)}${isNAV ? '' : '%'}`);
    const dCls  = delta == null ? '' : delta >= 0 ? 'gain' : 'loss';
    return `<tr>
      <td style="color:var(--text-muted)">${d.year}</td>
      <td class="${isNAV ? '' : 'gain'}" style="${isNAV ? 'text-align:right;font-weight:700' : ''}">${fmtV(dVal)}</td>
      <td class="${dCls} r">${dStr}</td>
    </tr>`;
  }).join('');

  // Chart
  const sf = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
  if (_divChart) { _divChart.destroy(); _divChart = null; }

  function drawChart() {
    _divChart = new Chart(document.getElementById('div-hist-canvas'), {
      type: 'bar',
      data: {
        labels: pairs.map(d => d.year),
        datasets: [{
          label: isNAV ? 'NAV / Share (৳)' : 'Dividend (%)',
          data: pairs.map(p => isNAV ? parseFloat(p.val) : p.pct),
          backgroundColor: isNAV ? 'rgba(59,130,246,0.65)' : 'rgba(0,230,118,0.68)',
          borderColor: isNAV ? '#3b82f6' : '#00e676',
          borderWidth: 1, borderRadius: 5, borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161b24', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
            titleFont: { family: sf, size: 11 }, bodyFont: { family: sf, size: 12 },
            callbacks: { label: ctx => isNAV ? `  ৳${ctx.raw}` : `  ${label}: ${ctx.raw}%` }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8fa3c0', font: { family: sf, size: 10 } }, border: { display: false } },
          y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: isNAV ? '#3b82f6' : '#00e676', font: { family: sf, size: 10 }, callback: v => isNAV ? '৳' + v : v + '%' }, border: { color: 'rgba(255,255,255,.07)' } }
        }
      }
    });
  }

  typeof Chart !== 'undefined' ? drawChart() : (() => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
    sc.onload = drawChart;
    document.head.appendChild(sc);
  })();

  document.getElementById('div-hist-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeDivModal = function() {
  const m = document.getElementById('div-hist-modal');
  if (m) m.classList.remove('open');
  document.body.style.overflow = '';
};

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeDivModal?.(); });

/* ----------------------------------------------------------------
   POPULATE PROFILE DOM
---------------------------------------------------------------- */
function populateProfile(s) {
  const fmt    = n => n.toLocaleString('en-BD', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const fmtVol = n => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M'
                    : n >= 1_000      ? (n / 1_000).toFixed(1)     + 'K'
                    : n.toLocaleString();

  const dir  = s.change > 0 ? 'up' : s.change < 0 ? 'dn' : 'fl';
  const sign = s.change > 0 ? '+' : '';
  const pct  = s.ycp ? ((s.change / s.ycp) * 100).toFixed(2) : '0.00';

  // Hero
  document.getElementById('p-code').textContent  = s.code;
  document.getElementById('p-code2').textContent = s.code;
  document.getElementById('p-name').textContent  = s.name;
  // Category badge colours: A=green, B=amber, Z=muted
  const catEl = document.getElementById('p-category');
  const cat   = s.category || 'Z';
  catEl.textContent = cat;
  catEl.style.color = cat === 'A' ? 'var(--gain)' : cat === 'B' ? '#d29922' : 'var(--text-muted)';
  document.getElementById('p-ltp').textContent   = '৳ ' + fmt(s.ltp);
  const chgEl = document.getElementById('p-change');
  chgEl.textContent = `${sign}${fmt(s.change)} (${sign}${pct}%)`;
  chgEl.className   = `price-change-big ${dir}`;

  // Top stats (4-card row kept for at-a-glance)
  document.getElementById('p-high').textContent   = s.high  ? '৳ ' + fmt(s.high)  : '—';
  document.getElementById('p-low').textContent    = s.low   ? '৳ ' + fmt(s.low)   : '—';
  document.getElementById('p-close').textContent  = s.close ? '৳ ' + fmt(s.close) : '—';
  document.getElementById('p-volume').textContent = fmtVol(s.volume);

  // Hero quick-stats row
  const heroYcp = document.getElementById('p-hero-ycp');
  if (heroYcp) heroYcp.textContent = s.ycp ? '৳ ' + fmt(s.ycp) : '—';
  const heroVolume = document.getElementById('p-hero-volume');
  if (heroVolume) heroVolume.textContent = s.volume ? fmtVol(s.volume) : '—';
  const heroTrade = document.getElementById('p-hero-trade');
  if (heroTrade) heroTrade.textContent = s.trade ? s.trade.toLocaleString('en-BD') : '—';
  const heroValue = document.getElementById('p-hero-value');
  if (heroValue) heroValue.textContent = s.value ? '৳ ' + s.value.toFixed(2) + 'cr' : '—';

  // Range bar
  if (s.high && s.low && s.high !== s.low) {
    const p = ((s.ltp - s.low) / (s.high - s.low)) * 100;
    document.getElementById('p-range-low').textContent  = '৳ ' + fmt(s.low);
    document.getElementById('p-range-high').textContent = '৳ ' + fmt(s.high);
    setTimeout(() => {
      document.getElementById('p-range-fill').style.width = p + '%';
      document.getElementById('p-range-dot').style.left   = p + '%';
    }, 100);
  }

  // DSE external link
  document.getElementById('p-dse-link').href =
    `https://www.dsebd.org/displayCompany.php?name=${encodeURIComponent(s.code)}`;

  // Detail summary table (compact, below the big grid)
  document.getElementById('d-code').textContent     = s.code;
  document.getElementById('d-category').textContent = s.category || 'Z';
  document.getElementById('d-name').textContent     = s.name;
  document.getElementById('d-ltp').textContent    = '৳ ' + fmt(s.ltp);
  document.getElementById('d-ycp').textContent    = s.ycp   ? '৳ ' + fmt(s.ycp)   : '—';
  document.getElementById('d-high').textContent   = s.high  ? '৳ ' + fmt(s.high)  : '—';
  document.getElementById('d-low').textContent    = s.low   ? '৳ ' + fmt(s.low)   : '—';
  document.getElementById('d-close').textContent  = s.close ? '৳ ' + fmt(s.close) : '—';
  document.getElementById('d-volume').textContent = fmtVol(s.volume);
  const dChg = document.getElementById('d-change');
  dChg.textContent = `${sign}${fmt(s.change)} (${sign}${pct}%)`;
  dChg.style.color = dir === 'up' ? 'var(--gain)' : dir === 'dn' ? 'var(--loss)' : 'var(--neutral)';

  // Fundamentals page link
  const fundBtn = document.getElementById('fund-nav-btn');
  if (fundBtn) fundBtn.href = `/fundamentals/fundamentals.html?code=${encodeURIComponent(s.code)}`;

  // Timeline page link
  const timelineBtn = document.getElementById('timeline-nav-btn');
  if (timelineBtn) timelineBtn.href = `/timeline/timeline.html?code=${encodeURIComponent(s.code)}`;

  // Bank Details button — shown after sector data loads (see loadProfile sector fetch)
  const bankBtn = document.getElementById('bank-details-btn');
  if (bankBtn) bankBtn.href = `/bank-details/bank-details.html?code=${encodeURIComponent(s.code)}`;

  window.currentStockCode = s.code;
}


function injectMFPortfolioButton(s, sector) {
  // Only show for stocks in the Mutual Fund sector
  const isMF = /mutual\s*funds?/i.test(sector || '');
  if (!isMF) return;

  // Avoid double injection
  if (document.getElementById('mf-portfolio-btn-section')) return;

  const encodedName = encodeURIComponent(s.name || s.code);

  const btn = document.createElement('a');
  btn.id        = 'mf-portfolio-btn-section';
  btn.href      = `/mutual_fund_portfolio/mf-portfolio.html?code=${encodeURIComponent(s.code)}&name=${encodedName}`;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 9h18M9 21V9"/>
    </svg>
    MF Portfolio`;
  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 14px;
    background: rgba(99,102,241,0.12);
    border: 1px solid #6366f1;
    color: #6366f1;
    border-radius: var(--radius-sm, 6px);
    font-family: var(--mono, monospace);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  `;
  btn.onmouseenter = () => { btn.style.background = '#6366f1'; btn.style.color = '#fff'; };
  btn.onmouseleave = () => { btn.style.background = 'rgba(99,102,241,0.12)'; btn.style.color = '#6366f1'; };

  // Insert into header-meta before the theme toggle
  const headerMeta = document.querySelector('.header-meta');
  const themeBtn   = document.getElementById('theme-toggle-btn');
  if (headerMeta && themeBtn) {
    headerMeta.insertBefore(btn, themeBtn);
  } else if (headerMeta) {
    headerMeta.prepend(btn);
  }
}

/* ----------------------------------------------------------------
   INIT
---------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  document
    .getElementById('theme-toggle-btn')
    .addEventListener('click', () => {
      toggleTheme();
      if (typeof drawChart === 'function') setTimeout(drawChart, 50);
    });
  loadProfile();
});