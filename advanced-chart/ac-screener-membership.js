'use strict';

/* ════════════════════════════════════════════════════════════
   ac-screener-membership.js
   "On Screeners" sidebar panel for the Advanced Chart page — lists
   which of the Screener page's (screener/screener.js) pattern
   categories the CURRENT symbol currently matches.

   screener.js computes matches by fetching ~10 bulk endpoints (each
   already keyed by every stock code) and filtering client-side; its
   own classify*() functions and PATTERNS table are unexported module
   state inside an ES module loaded only by screener.html, so they
   can't be imported here. Rather than re-deriving that page's whole
   scan pipeline, this file re-fetches the SAME bulk endpoints (they're
   cached server-side for 10 minutes — see routes/screener-technicals.js
   — so this is not a second computation, just a second read) and
   applies the same per-code match condition screener.js's classifiers
   use, but only for the one code this page has loaded. Kept as a
   manually-synced copy rather than a shared module for the same reason
   tv-volatility.js is: neither page risks breaking from a change made
   for the other.

   Scope: evaluated at the Screener page's own default timeframe
   (daily) only — this is a quick-glance sidebar summary, not a second
   Daily/Weekly/Monthly control. ddmUndervalued only checks already
   on-disk dividend data (routes/scraper.js's /dividends-bulk store),
   not screener.js's separate live-scrape fallback for the top-30 most
   traded stocks, so it under-reports rather than triggering a scrape
   from this panel.

   Hooks into window.refreshSidebarForSymbol (defined by tv-sidebar.js)
   by wrapping it, so the panel updates on every symbol change — no
   edits to tv-sidebar.js needed (same pattern as tv-volatility.js).
   ════════════════════════════════════════════════════════════ */

(function () {
  const bodyEl = document.getElementById('tvScreenerMembershipBody');
  if (!bodyEl) return; // not on this page

  const TIMEFRAME = 'daily'; // matches screener.js's default screenerTimeframe

  // Same thresholds screener.js uses (screener/screener.js:32-48) — kept in
  // sync by hand, like the rest of this file.
  const SCREENER_TOLERANCE_PCT  = 0.5;
  const CANDLE_MIN_RANGE_PCT    = 0.3;
  const HAMMER_MIN_WICK_RATIO   = 2.0;
  const HAMMER_MAX_OPP_RATIO    = 0.1;
  const HAMMER_MAX_BODY_RATIO   = 0.35;
  const MARUBOZU_MIN_BODY_RATIO = 0.85;
  const MARUBOZU_MAX_WICK_RATIO = 0.05;
  const DDM_DEFAULT_G = 5;
  const DDM_DEFAULT_R = 12;

  // label + PATTERN_RGB color (screener/screener.js:113-129) for every
  // category this panel can report.
  const CATEGORY_META = {
    support:          { label: 'Hitting Support',              rgb: '34,197,94'   },
    resistance:       { label: 'Hitting Resistance',            rgb: '239,68,68'   },
    bullishHammer:    { label: 'Bullish Hammer',                rgb: '245,158,11'  },
    bearishHammer:    { label: 'Bearish Hammer',                rgb: '245,158,11'  },
    bullishMarubozu:  { label: 'Bullish Marubozu',              rgb: '245,158,11'  },
    bearishMarubozu:  { label: 'Bearish Marubozu',              rgb: '245,158,11'  },
    ddmUndervalued:   { label: 'Undervalued — DDM',             rgb: '59,130,246'  },
    macdBullishCross: { label: 'MACD Bullish Cross',            rgb: '139,92,246'  },
    macdBearishCross: { label: 'MACD Bearish Cross',            rgb: '139,92,246'  },
    minervini:        { label: 'Minervini Trend Template',      rgb: '20,184,166'  },
    mfPvDecline:      { label: 'MF Price/Portfolio-Value ↓',    rgb: '236,72,153'  },
    hmBuy:            { label: 'Hilega-Milega Buy',             rgb: '38,198,218'  },
    hmSell:           { label: 'Hilega-Milega Sell',            rgb: '38,198,218'  },
    liqSweepBullish:  { label: 'Liquidity Sweep — Bullish',     rgb: '244,114,182' },
    liqSweepBearish:  { label: 'Liquidity Sweep — Bearish',     rgb: '244,114,182' },
    volumeSpike:      { label: 'Volume Spike',                  rgb: '250,204,21'  },
    retestBullish:    { label: 'Breakout Retest — Bullish',     rgb: '99,102,241'  },
    retestBearish:    { label: 'Breakout Retest — Bearish',     rgb: '99,102,241'  },
    macdS1Buy:        { label: 'MACD + 50 EMA — Buy',           rgb: '249,115,22'  },
    macdS1Exit:       { label: 'MACD + 50 EMA — Exit',          rgb: '249,115,22'  },
  };

  /* ── Scoped styles ─────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('tv-screener-membership-styles')) return;
    const style = document.createElement('style');
    style.id = 'tv-screener-membership-styles';
    style.textContent = `
      .tv-screener-membership-body { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; }
      .tv-sm-pill {
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: var(--radius-sm);
        background: rgba(var(--sm-rgb), 0.10);
        border: 1px solid rgba(var(--sm-rgb), 0.30);
        font-family: var(--sans); font-size: 12px; color: var(--text-primary);
      }
      .tv-sm-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: rgb(var(--sm-rgb)); }
      .tv-sm-empty { padding: 14px 12px; font-family: var(--sans); font-size: 12px; color: var(--text-muted); }
      .tv-sm-asof { padding: 0 12px 8px; font-family: var(--sans); font-size: 11px; color: var(--text-muted); }
    `;
    document.head.appendChild(style);
  }

  /* ── Candle-pattern helpers (screener/screener.js:134-180) ───── */
  function candleParts(q) {
    const open = q.ycp, close = q.ltp, high = q.high, low = q.low;
    const range = high - low, body = Math.abs(close - open);
    return {
      open, close, high, low, range, body,
      lowerWick: Math.min(open, close) - low,
      upperWick: high - Math.max(open, close),
      rangePct:  range > 0 ? (range / low) * 100 : 0,
    };
  }
  function candleValid(q) { return q.ltp > 0 && q.high > 0 && q.low > 0 && q.ycp > 0; }
  function isBullishHammer(q) {
    if (!candleValid(q)) return false;
    const { range, body, lowerWick, upperWick, rangePct } = candleParts(q);
    return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && body > 0
      && body / range <= HAMMER_MAX_BODY_RATIO
      && lowerWick > 0 && lowerWick >= HAMMER_MIN_WICK_RATIO * body
      && upperWick / range <= HAMMER_MAX_OPP_RATIO;
  }
  function isBearishHammer(q) {
    if (!candleValid(q)) return false;
    const { range, body, lowerWick, upperWick, rangePct } = candleParts(q);
    return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && body > 0
      && body / range <= HAMMER_MAX_BODY_RATIO
      && upperWick > 0 && upperWick >= HAMMER_MIN_WICK_RATIO * body
      && lowerWick / range <= HAMMER_MAX_OPP_RATIO;
  }
  function isBullishMarubozu(q) {
    if (!candleValid(q)) return false;
    const { open, close, range, body, lowerWick, upperWick, rangePct } = candleParts(q);
    return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && close > open
      && body / range >= MARUBOZU_MIN_BODY_RATIO
      && upperWick / range <= MARUBOZU_MAX_WICK_RATIO
      && lowerWick / range <= MARUBOZU_MAX_WICK_RATIO;
  }
  function isBearishMarubozu(q) {
    if (!candleValid(q)) return false;
    const { open, close, range, body, lowerWick, upperWick, rangePct } = candleParts(q);
    return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && close < open
      && body / range >= MARUBOZU_MIN_BODY_RATIO
      && upperWick / range <= MARUBOZU_MAX_WICK_RATIO
      && lowerWick / range <= MARUBOZU_MAX_WICK_RATIO;
  }

  /* ── DDM helpers (screener/screener.js:185-196) ──────────────── */
  function parseDividendForScreener(raw) {
    if (!raw) return null;
    const str = String(raw).replace(/,/g, '').trim();
    const pct = str.match(/([\d.]+)\s*%/);
    if (pct) return parseFloat(pct[1]) * 10 / 100;
    const num = str.match(/([\d.]+)/);
    return num ? parseFloat(num[1]) : null;
  }
  function ddmIntrinsic(d0, g, r) {
    if (!d0 || d0 <= 0 || r <= g) return null;
    return (d0 * (1 + g / 100)) / ((r - g) / 100);
  }

  /* ── Fetch + evaluate ─────────────────────────────────────────
     Every endpoint here is one screener.js already fetches on every
     scan, cached server-side for 10 minutes — a client-side cache on
     top avoids re-downloading the whole-market payload on every single
     symbol switch while the sidebar panel is open. */
  const CLIENT_CACHE_MS = 5 * 60 * 1000;
  let _cache = null; // { at, data }

  async function fetchJson(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function fetchBulk() {
    if (_cache && Date.now() - _cache.at < CLIENT_CACHE_MS) return _cache.data;
    const tf = `timeframe=${TIMEFRAME}`;
    const [stocks, sr, macd, hm, liq, vol, retest, minervini, mfpv, macdS1, dividends] = await Promise.all([
      fetchJson('/api/stocks'),
      fetchJson(`/api/screener/sr?${tf}`),
      fetchJson(`/api/screener/macd-crossover?${tf}`),
      fetchJson(`/api/screener/hilega-milega?${tf}`),
      fetchJson(`/api/screener/liquidity-sweep?${tf}`),
      fetchJson(`/api/screener/volume-spike?${tf}`),
      fetchJson(`/api/screener/breakout-retest?${tf}`),
      fetchJson(`/api/screener/minervini?${tf}`),
      fetchJson('/api/screener/mf-pv-ratio'),
      fetchJson(`/api/macd-strategy1/signals?${tf}`),
      fetchJson('/api/dividends-bulk'),
    ]);
    const data = { stocks, sr, macd, hm, liq, vol, retest, minervini, mfpv, macdS1, dividends };
    _cache = { at: Date.now(), data };
    return data;
  }

  function evaluate(code, data) {
    const matched = [];
    const add = (key) => matched.push(key);

    const quote = (data.stocks?.stocks || []).find((s) => String(s.code).toUpperCase() === code);

    // Candle patterns — daily only (weekly/monthly would need
    // /api/screener/candle-patterns instead; out of scope for this
    // quick-glance panel, which mirrors the Screener page's default).
    if (quote && candleValid(quote)) {
      if (isBullishHammer(quote))   add('bullishHammer');
      if (isBearishHammer(quote))   add('bearishHammer');
      if (isBullishMarubozu(quote)) add('bullishMarubozu');
      if (isBearishMarubozu(quote)) add('bearishMarubozu');
    }

    // Support / resistance — LTP within tolerance of a known level.
    const sr = data.sr?.levels?.[code];
    if (sr && quote?.ltp > 0) {
      const tol = SCREENER_TOLERANCE_PCT / 100;
      const near = (lv) => {
        const lp = typeof lv === 'object' ? (lv.price ?? lv.value ?? lv) : lv;
        return lp && Math.abs(quote.ltp - lp) / lp <= tol;
      };
      if ((sr.support || []).some(near)) add('support');
      if ((sr.resistance || []).some(near)) add('resistance');
    }

    const macd = data.macd?.results?.[code];
    if (macd?.direction === 'bullish') add('macdBullishCross');
    if (macd?.direction === 'bearish') add('macdBearishCross');

    if (data.minervini?.results?.[code]) add('minervini');
    if (data.mfpv?.results?.[code]) add('mfPvDecline');

    const hm = data.hm?.results?.[code];
    if (hm?.direction === 'bullish') add('hmBuy');
    if (hm?.direction === 'bearish') add('hmSell');

    const liq = data.liq?.results?.[code];
    if (liq?.direction === 'bullish') add('liqSweepBullish');
    if (liq?.direction === 'bearish') add('liqSweepBearish');

    // The backend already returns only codes with SOME latest-vs-previous
    // candle volume increase (screener.js's default min-pct filter is 0%,
    // i.e. any increase), so presence alone is the match.
    if (data.vol?.results?.[code]) add('volumeSpike');

    const retest = data.retest?.results?.[code];
    if (retest?.direction === 'bullish') add('retestBullish');
    if (retest?.direction === 'bearish') add('retestBearish');

    const s1 = data.macdS1?.results?.[code];
    if (s1?.direction === 'buy') add('macdS1Buy');
    if (s1?.direction === 'exit') add('macdS1Exit');

    // DDM — only what's already on disk (see file header).
    const rawDiv = data.dividends?.dividends?.[code];
    const d0 = parseDividendForScreener(rawDiv);
    if (d0 && quote?.ltp > 0) {
      const intrinsic = ddmIntrinsic(d0, DDM_DEFAULT_G, DDM_DEFAULT_R);
      if (intrinsic && quote.ltp < intrinsic) add('ddmUndervalued');
    }

    return matched;
  }

  function render(matched) {
    injectStyles();
    if (!matched.length) {
      bodyEl.innerHTML = '<div class="tv-sm-empty">Not currently on any Screener list (Daily).</div>';
      return;
    }
    const rows = matched.map((key) => {
      const meta = CATEGORY_META[key];
      if (!meta) return '';
      return `<div class="tv-sm-pill" style="--sm-rgb:${meta.rgb}"><span class="tv-sm-dot"></span>${meta.label}</div>`;
    }).join('');
    bodyEl.innerHTML = `<div class="tv-sm-asof">Screener lists \xb7 Daily</div>${rows}`;
  }

  async function renderScreenerMembership(code) {
    if (!bodyEl || !code) return;
    injectStyles();
    bodyEl.innerHTML = '<div class="tv-sidebar-loading">Loading…</div>';
    let data;
    try { data = await fetchBulk(); }
    catch { bodyEl.innerHTML = '<div class="tv-sm-empty">Couldn’t load screener data.</div>'; return; }
    render(evaluate(code.toUpperCase(), data));
  }

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
  wireRailToggle('railScreenerMembershipBtn', 'tvScreenerMembership');

  /* ── Hook into the existing symbol-change flow ───────────────── */
  const _origRefresh = window.refreshSidebarForSymbol;
  window.refreshSidebarForSymbol = async function (code) {
    if (typeof _origRefresh === 'function') await _origRefresh(code);
    await renderScreenerMembership(code);
  };
})();
