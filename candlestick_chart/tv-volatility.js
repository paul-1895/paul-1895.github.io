'use strict';

/* ════════════════════════════════════════════════════════════
   tv-volatility.js
   Volatility card + details modal for the candlestick page's
   right sidebar — ported from company_profile/company.js (the
   "Volatility" widget on the Company Profile page). Same
   computation, same visual language (reuses the identical
   volatility-card and returns-grid class names, injected here
   as a scoped style block since this page doesn't already
   define them), so the numbers and bands never disagree between the
   two pages for the same symbol. Kept as a manually-synced
   copy rather than a shared module so neither page risks
   breaking from a change made for the other.

   Hooks into window.refreshSidebarForSymbol (defined by
   tv-sidebar.js) by wrapping it, so the card updates every time
   the chart's symbol changes — no edits to tv-sidebar.js needed.
   ════════════════════════════════════════════════════════════ */

(function () {
  const bodyEl = document.getElementById('tvVolatilityBody');
  if (!bodyEl) return; // not on this page

  const VOL_TRADING_DAYS_PER_YEAR = 252;
  const VOL_MIN_RETURNS = 5; // need a handful of data points before a stdev means anything

  let _volatilityRecords = null; // cached {date, close, high, low}[] for the currently-loaded symbol
  let _volatilityCode = null;

  /* ── Scoped styles (compact card + modal) ─────────────────────
     Reuses this page's own bg-card/border/text-primary/accent/
     gain/loss/radius design tokens (candlestick-chart.css) so it
     matches the dark/light theme automatically. */
  function injectStyles() {
    if (document.getElementById('tv-volatility-styles')) return;
    const style = document.createElement('style');
    style.id = 'tv-volatility-styles';
    style.textContent = `
      .tv-volatility-panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; flex-shrink: 0; }
      .tv-volatility-body { padding: 12px 14px 14px; }

      .returns-title { font-family: var(--mono); font-size: 9px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.2px; }
      .returns-grid { display: flex; flex-direction: column; gap: 7px; }
      .returns-item { display: grid; grid-template-columns: 24px 1fr 48px; align-items: center; gap: 8px; }
      .returns-period { font-family: var(--mono); font-size: 10px; color: var(--text-muted); }
      .returns-bar-track { position: relative; height: 6px; background: var(--bg-hover); border-radius: 3px; overflow: hidden; }
      .returns-bar { position: absolute; top: 0; bottom: 0; border-radius: 3px; transition: width 0.3s ease; }
      .returns-pct { font-family: var(--mono); font-size: 11px; font-weight: 700; text-align: right; color: var(--text-secondary); }

      .volatility-card--clickable { cursor: pointer; transition: border-color .15s; border: 1px solid transparent; border-radius: var(--radius-md); margin: -2px; padding: 2px; }
      .volatility-card--clickable:hover { border-color: var(--accent); }
      .volatility-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .volatility-badge { font-family: var(--mono); font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
      .volatility-badge.vol-low      { color: var(--gain); }
      .volatility-badge.vol-moderate { color: #d29922; }
      .volatility-badge.vol-high     { color: #f0883e; }
      .volatility-badge.vol-veryhigh { color: var(--loss); }
      .volatility-bar { left: 0; width: 0; }
      .volatility-bar.vol-low      { background: var(--gain); }
      .volatility-bar.vol-moderate { background: #d29922; }
      .volatility-bar.vol-high     { background: #f0883e; }
      .volatility-bar.vol-veryhigh { background: var(--loss); }
      .volatility-caption { margin-top: 10px; font-family: var(--sans); font-size: 10px; line-height: 1.4; color: var(--text-muted); }

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
      .vol-hist-breach-stat { font-size:12px; color:var(--text-secondary); line-height:1.5; background:var(--bg-hover); border:1px solid var(--border); border-radius:var(--radius-md,8px); padding:10px 12px; }
      .vol-hist-breach-stat b { color:var(--text-primary); font-family:var(--mono); font-size:14px; }
      .vol-hist-breach-tabs { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
      .vol-hist-breach-tab { font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:0.8px; background:none; border:1px solid var(--border); border-radius:6px; color:var(--text-muted); padding:5px 10px; cursor:pointer; transition:all .15s; }
      .vol-hist-breach-tab:hover { color:var(--text-primary); }
      .vol-hist-breach-tab.active { color:var(--accent); border-color:var(--accent); background:rgba(0,245,196,.08); }
      .vol-hist-breach-list-wrap { max-height:220px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-md,8px); }
      .vol-hist-breach-tbl { font-size:11px; }
      .vol-hist-breach-tbl thead th { position:sticky; top:0; background:var(--bg-card); }
      .vol-hist-breach-tbl tbody tr:last-child { border-bottom:none; }
      .vol-hist-breach-empty { padding:20px 12px; text-align:center; color:var(--text-muted); font-size:11px; }
      .vol-hist-season-note { font-size:10px; line-height:1.5; color:var(--text-muted); margin-bottom:10px; }
      .vol-hist-season-chart { position:relative; height:190px; }
    `;
    document.head.appendChild(style);
  }

  /* ── Volatility math — identical to company_profile/company.js ── */
  function volBandFor(pct) {
    if (pct < 20) return { key: 'vol-low',      label: 'Low'       };
    if (pct < 40) return { key: 'vol-moderate', label: 'Moderate'  };
    if (pct < 60) return { key: 'vol-high',      label: 'High'      };
    return              { key: 'vol-veryhigh',  label: 'Very High' };
  }

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

  function getISOWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const weekNum = 1 + Math.round((d - firstThursday) / (7 * 86400000));
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function computeDailyMoves(records) {
    const moves = [];
    records.forEach(r => {
      if (r.low > 0 && r.high >= r.low) {
        moves.push({ date: r.date, label: r.date.toISOString().slice(0, 10), low: r.low, high: r.high, rangePct: (r.high - r.low) / r.low * 100 });
      }
    });
    return moves;
  }

  function bucketMoves(records, keyFn, labelFn) {
    const buckets = new Map();
    records.forEach(r => {
      if (!(r.low > 0 && r.high >= r.low)) return;
      const key = keyFn(r.date);
      const b = buckets.get(key);
      if (!b) {
        buckets.set(key, { date: r.date, high: r.high, low: r.low });
      } else {
        b.date = r.date;
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
    return bucketMoves(records, d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, d => `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`);
  }
  function computeYearlyMoves(records) {
    return bucketMoves(records, d => String(d.getFullYear()), d => String(d.getFullYear()));
  }

  function computeMonthlySeasonality(dailyMoves, threshold) {
    const buckets = Array.from({ length: 12 }, () => ({ total: 0, hits: 0 }));
    dailyMoves.forEach(m => {
      const b = buckets[m.date.getMonth()];
      b.total++;
      if (m.rangePct >= threshold) b.hits++;
    });
    return buckets.map((b, i) => ({ month: MONTH_ABBR[i], total: b.total, hits: b.hits, pct: b.total ? (b.hits / b.total * 100) : 0 }));
  }

  function getCurrentCode() {
    if (typeof chartData !== 'undefined' && chartData.length && chartData[0].Symbol) return String(chartData[0].Symbol).toUpperCase();
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return _volatilityCode;
  }

  async function fetchHistory(code) {
    const res = await fetch(`/api/history/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error('history fetch failed');
    const { data } = await res.json();
    return (data || [])
      .map(r => ({ date: new Date(r.Date.replace(/\//g, '-')), close: parseFloat(r.Close), high: parseFloat(r.High), low: parseFloat(r.Low) }))
      .filter(r => !isNaN(r.date.getTime()) && !isNaN(r.close) && r.close > 0)
      .sort((a, b) => a.date - b.date);
  }

  /* ── Compact card ──────────────────────────────────────────── */
  function ensureCardMarkup() {
    if (document.getElementById('tv-volatility-grid')) return;
    bodyEl.innerHTML = `
      <div class="volatility-card--clickable" id="tvVolatilityCard" title="Click for volatility details">
        <div class="volatility-title-row">
          <div class="returns-title">Volatility</div>
          <span class="volatility-badge" id="tv-volatility-badge" style="display:none">—</span>
        </div>
        <div class="returns-grid" id="tv-volatility-grid">
          <div class="returns-item"><span class="returns-period">1M</span><span class="returns-bar-track"><span class="returns-bar volatility-bar"></span></span><span class="returns-pct" id="tv-vol-1m">—</span></div>
          <div class="returns-item"><span class="returns-period">3M</span><span class="returns-bar-track"><span class="returns-bar volatility-bar"></span></span><span class="returns-pct" id="tv-vol-3m">—</span></div>
          <div class="returns-item"><span class="returns-period">6M</span><span class="returns-bar-track"><span class="returns-bar volatility-bar"></span></span><span class="returns-pct" id="tv-vol-6m">—</span></div>
          <div class="returns-item"><span class="returns-period">1Y</span><span class="returns-bar-track"><span class="returns-bar volatility-bar"></span></span><span class="returns-pct" id="tv-vol-1y">—</span></div>
        </div>
        <div class="volatility-caption">Annualized standard deviation of daily returns — higher means larger, less predictable price swings.</div>
      </div>`;
    document.getElementById('tvVolatilityCard').addEventListener('click', () => window.openVolatilityModal(_volatilityCode || getCurrentCode()));
  }

  async function renderVolatility(code) {
    if (!bodyEl || !code) return;
    injectStyles();
    ensureCardMarkup();

    let records;
    try { records = await fetchHistory(code); }
    catch { return; } // leave the widget showing its default "—" placeholders
    if (records.length < 2) return;

    _volatilityRecords = records;
    _volatilityCode = code;

    const latest = records[records.length - 1];
    const periods = [
      { id: 'tv-vol-1m', days: 30 },
      { id: 'tv-vol-3m', days: 91 },
      { id: 'tv-vol-6m', days: 182 },
      { id: 'tv-vol-1y', days: 365 },
    ];

    let repVol = null;
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
      if (barEl) {
        barEl.className = `returns-bar volatility-bar ${band.key}`;
        barEl.style.width = `${Math.min(100, (annualizedPct / 80) * 100)}%`;
      }
      if (p.id === 'tv-vol-3m') repVol = { pct: annualizedPct, band };
    });

    const badgeEl = document.getElementById('tv-volatility-badge');
    if (badgeEl && repVol) {
      badgeEl.textContent = repVol.band.label;
      badgeEl.className = `volatility-badge ${repVol.band.key}`;
      badgeEl.style.display = 'inline-block';
      badgeEl.title = `Based on 3-month annualized volatility (${repVol.pct.toFixed(1)}%)`;
    }
  }

  /* ── Details modal — rolling volatility chart + breach analysis + seasonality ── */
  let _volChart = null;
  let _volSeasonalityChart = null;
  let _volDailyMoves = [];
  let _volWeeklyMoves = [];
  let _volMonthlyMoves = [];
  let _volYearlyMoves = [];
  let _volBreachView = 'days';
  let _volLatestDate = null;

  const VOL_BREACH_SCOPES = [
    { key: 'days',   label: 'Days',   unit: 'trading days', movesOf: () => _volDailyMoves },
    { key: 'weeks',  label: 'Weeks',  unit: 'weeks',        movesOf: () => _volWeeklyMoves },
    { key: 'months', label: 'Months', unit: 'months',       movesOf: () => _volMonthlyMoves },
    { key: 'years',  label: 'Years',  unit: 'years',        movesOf: () => _volYearlyMoves },
  ];

  function ensureVolatilityModal() {
    if (document.getElementById('vol-hist-modal')) return;
    injectStyles();

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
          <div class="vol-hist-note">Annualized standard deviation of daily log returns (&times;&radic;252). Bands (Low/Moderate/High/Very High) are a simple heuristic, not an official rating. "—" means there wasn't enough trading history in that window to compute a meaningful figure.</div>

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

    const scopedHits = {};
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

  function renderVolSeasonality(monthlyStats, threshStr) {
    const canvas = document.getElementById('vol-seasonality-canvas');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_volSeasonalityChart) { _volSeasonalityChart.destroy(); _volSeasonalityChart = null; }
    const sf = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    _volSeasonalityChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: monthlyStats.map(m => m.month),
        datasets: [{ data: monthlyStats.map(m => m.pct), backgroundColor: '#f0883e', borderRadius: 3, maxBarThickness: 34 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#161b24', borderColor: 'rgba(255,255,255,.12)', borderWidth: 1,
            titleFont: { family: sf, size: 11 }, bodyFont: { family: sf, size: 12 },
            callbacks: { label: ctx => { const m = monthlyStats[ctx.dataIndex]; return m.total ? `  ${m.hits} of ${m.total} days ≥ ${threshStr}%` : '  no trading days in this window'; } }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8fa3c0', font: { family: sf, size: 10 } }, border: { display: false } },
          y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#8fa3c0', font: { family: sf, size: 9 }, callback: v => v + '%' }, border: { color: 'rgba(255,255,255,.07)' } }
        }
      }
    });
  }

  window.setVolBreachView = function (view) {
    _volBreachView = view;
    VOL_BREACH_SCOPES.forEach(s => document.getElementById(`vol-hist-tab-${s.key}`)?.classList.toggle('active', s.key === view));
    renderVolBreaches();
  };

  window.openVolatilityModal = async function (code) {
    code = code || getCurrentCode();
    if (!code) return;

    let records = (_volatilityCode === code) ? _volatilityRecords : null;
    if (!records) {
      try { records = await fetchHistory(code); }
      catch { records = []; }
    }
    if (records.length < VOL_MIN_RETURNS + 1) return;

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
            borderColor: '#f0883e', backgroundColor: 'rgba(240,136,62,0.12)',
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
    lookbackInput.value = spanDays;

    renderVolBreaches();

    typeof Chart !== 'undefined' ? drawVolChart() : (() => {
      const sc = document.createElement('script');
      sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      sc.onload = () => { drawVolChart(); renderVolBreaches(); };
      document.head.appendChild(sc);
    })();

    document.getElementById('vol-hist-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeVolatilityModal = function () {
    const m = document.getElementById('vol-hist-modal');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
  };

  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeVolatilityModal?.(); });

  /* ── Rail toggle (mirrors tv-sidebar.js's wireRailToggle) ─────── */
  function wireRailToggle(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const nowHidden = panel.style.display !== 'none';
      panel.style.display = nowHidden ? 'none' : '';
      btn.classList.toggle('active', !nowHidden);
    });
  }
  wireRailToggle('railVolatilityBtn', 'tvVolatilityPanel');

  /* ── Hook into the existing symbol-change flow ─────────────────
     tv-sidebar.js defines window.refreshSidebarForSymbol and is
     guaranteed to load before this script (see candlestick.html
     script order); wrap it so the card refreshes on every symbol
     change without editing tv-sidebar.js. */
  const _origRefresh = window.refreshSidebarForSymbol;
  window.refreshSidebarForSymbol = async function (code) {
    if (typeof _origRefresh === 'function') await _origRefresh(code);
    await renderVolatility(code);
  };

  window.refreshVolatilityForSymbol = renderVolatility;
})();
