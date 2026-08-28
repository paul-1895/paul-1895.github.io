/* ============================================================
   screener.js  —  Built-in S/R + Candlestick Pattern Screener

   PROGRESSIVE LOADING STRATEGY
   ─────────────────────────────
   • Candle patterns  → computed synchronously, shown instantly
   • S/R results      → skeleton shown, patched once bulk fetch lands
   • DDM results      → skeleton shown, patched per batch as dividends stream

   After the initial full render, only targeted DOM patches are
   applied — no full re-render, no layout thrashing.
============================================================ */
'use strict';

import { initTheme, toggleTheme } from '../theme/theme.js';

const API = '';

// ── S/R tolerance ──────────────────────────────────────────
const SCREENER_TOLERANCE_PCT  = 0.5;   // ±%

// ── Shared candle guard ────────────────────────────────────
const CANDLE_MIN_RANGE_PCT    = 0.3;   // ignore candles with <0.3% range

// ── Hammer / Shooting Star thresholds ─────────────────────
const HAMMER_MIN_WICK_RATIO   = 2.0;   // dominant wick >= 2x body
const HAMMER_MAX_OPP_RATIO    = 0.1;   // opposite wick <= 10% of range
const HAMMER_MAX_BODY_RATIO   = 0.35;  // body <= 35% of range

// ── Marubozu thresholds ────────────────────────────────────
const MARUBOZU_MIN_BODY_RATIO = 0.85;  // body >= 85% of range
const MARUBOZU_MAX_WICK_RATIO = 0.05;  // each wick <= 5% of range

// ── DDM thresholds ─────────────────────────────────────────
const DDM_DEFAULT_G = 5;    // % annual dividend growth
const DDM_DEFAULT_R = 12;   // % required rate of return

// ──────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────
let screenerStocksData   = [];
let screenerSRData       = {};
let screenerDDMDividends = {};
let screenerMacdData     = {};   // code -> crossover result, for the CURRENT screenerMacdTimeframe only
let screenerMinerviniData = {};  // code -> Minervini result (full-pass stocks only, per backend)
let screenerMfPvData     = {};   // code -> price/portfolio-value ratio result (declining only, per backend)
let screenerHmData       = {};   // code -> Hilega-Milega crossover result
let screenerLiqSweepData = {};   // code -> liquidity sweep result
let screenerRetestData   = {};   // code -> breakout retest result
let screenerMacdS1Data   = {};   // code -> MACD + 50 EMA signal standing on the latest bar
let screenerResults      = {
  support:[], resistance:[],
  bullishHammer:[], bearishHammer:[],
  bullishMarubozu:[], bearishMarubozu:[],
  ddmUndervalued:[],
  macdBullishCross:[], macdBearishCross:[],
  minervini:[],
  mfPvDecline:[],
  hmBuy:[], hmSell:[],
  liqSweepBullish:[], liqSweepBearish:[],
  retestBullish:[], retestBearish:[],
  macdS1Buy:[], macdS1Exit:[],
};

// 'loading' = fetch in-flight, null = done
let screenerLoadingState = { candle: null, sr: null, ddm: null, macd: null, minervini: null, mfPv: null, hm: null, liqSweep: null, retest: null, macdS1: null };

let screenerLastScan       = null;
let screenerScanRunning    = false;
let screenerActiveList     = 'support';   // master-detail: always one pattern selected
let screenerSearchQuery    = '';
let screenerSortCol        = null;        // null = natural (pre-sorted) order; else 'code'|'ltp'|'change'|'metric'
let screenerSortDir        = 'desc';
let screenerMacdTimeframe  = 'daily';     // 'daily' | 'weekly' | 'monthly' — only affects the two MACD lists

// Starred pattern keys, pinned into their own sidebar section above "All
// Lists". Persisted client-side only (no account system on this app), so
// it's local to this browser like every other *_ pref elsewhere in the app.
const SCREENER_FAV_KEY = 'screenerFavorites';
function _loadScreenerFavorites() {
  try {
    const raw = localStorage.getItem(SCREENER_FAV_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
function _saveScreenerFavorites() {
  try { localStorage.setItem(SCREENER_FAV_KEY, JSON.stringify([...screenerFavorites])); } catch { /* best effort */ }
}
let screenerFavorites = _loadScreenerFavorites();

// rgb() triplets per pattern color key, injected as a --rgb custom property
// so row/nav/pill styling in CSS stays generic instead of one block per key.
const PATTERN_RGB = {
  support:            '34,197,94',
  resistance:         '239,68,68',
  'bullish-hammer':   '245,158,11',
  'bearish-hammer':   '245,158,11',
  'bullish-marubozu': '245,158,11',
  'bearish-marubozu': '245,158,11',
  'ddm-undervalued':  '59,130,246',
  'macd-cross':       '139,92,246',
  'minervini':        '20,184,166',
  'mf-pv-decline':    '236,72,153',
  'hm-cross':         '38,198,218',
  'liq-sweep':        '244,114,182',
  'breakout-retest':  '99,102,241',
  'macd-s1':          '249,115,22',
};

// ──────────────────────────────────────────────────────────
// CANDLE HELPERS
// ──────────────────────────────────────────────────────────
function candleParts(stock) {
  const open = stock.ycp, close = stock.ltp, high = stock.high, low = stock.low;
  const range = high - low, body = Math.abs(close - open);
  return {
    open, close, high, low, range, body,
    lowerWick: Math.min(open, close) - low,
    upperWick: high - Math.max(open, close),
    rangePct:  range > 0 ? (range / low) * 100 : 0
  };
}
function candleValid(s) {
  return s.ltp > 0 && s.high > 0 && s.low > 0 && s.ycp > 0;
}
function isBullishHammer(s) {
  if (!candleValid(s)) return false;
  const { range, body, lowerWick, upperWick, rangePct } = candleParts(s);
  return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && body > 0
    && body / range <= HAMMER_MAX_BODY_RATIO
    && lowerWick > 0 && lowerWick >= HAMMER_MIN_WICK_RATIO * body
    && upperWick / range <= HAMMER_MAX_OPP_RATIO;
}
function isBearishHammer(s) {
  if (!candleValid(s)) return false;
  const { range, body, lowerWick, upperWick, rangePct } = candleParts(s);
  return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && body > 0
    && body / range <= HAMMER_MAX_BODY_RATIO
    && upperWick > 0 && upperWick >= HAMMER_MIN_WICK_RATIO * body
    && lowerWick / range <= HAMMER_MAX_OPP_RATIO;
}
function isBullishMarubozu(s) {
  if (!candleValid(s)) return false;
  const { open, close, range, body, lowerWick, upperWick, rangePct } = candleParts(s);
  return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && close > open
    && body / range >= MARUBOZU_MIN_BODY_RATIO
    && upperWick / range <= MARUBOZU_MAX_WICK_RATIO
    && lowerWick / range <= MARUBOZU_MAX_WICK_RATIO;
}
function isBearishMarubozu(s) {
  if (!candleValid(s)) return false;
  const { open, close, range, body, lowerWick, upperWick, rangePct } = candleParts(s);
  return range > 0 && rangePct >= CANDLE_MIN_RANGE_PCT && close < open
    && body / range >= MARUBOZU_MIN_BODY_RATIO
    && upperWick / range <= MARUBOZU_MAX_WICK_RATIO
    && lowerWick / range <= MARUBOZU_MAX_WICK_RATIO;
}
function hammerScore(s, wk) { const p = candleParts(s); return p[wk] / (p.body || 0.001); }
function marubozuScore(s)    { const { body, range } = candleParts(s); return range > 0 ? body / range : 0; }

// ──────────────────────────────────────────────────────────
// DDM HELPERS
// ──────────────────────────────────────────────────────────
function parseDividendForScreener(raw) {
  if (!raw) return null;
  const str = String(raw).replace(/,/g,'').trim();
  const pct = str.match(/([\d.]+)\s*%/);
  if (pct) return parseFloat(pct[1]) * 10 / 100;
  const num = str.match(/([\d.]+)/);
  return num ? parseFloat(num[1]) : null;
}
function ddmIntrinsic(d0, g, r) {
  if (!d0 || d0 <= 0 || r <= g) return null;
  return (d0 * (1 + g / 100)) / ((r - g) / 100);
}

// ──────────────────────────────────────────────────────────
// CLASSIFIERS
// ──────────────────────────────────────────────────────────
function classifyCandlePatterns(stocks) {
  const out = { bullishHammer:[], bearishHammer:[], bullishMarubozu:[], bearishMarubozu:[] };
  stocks.forEach(s => {
    if (!candleValid(s)) return;
    const parts = candleParts(s);
    if (isBullishHammer(s))    out.bullishHammer.push({ stock:s, score:hammerScore(s,'lowerWick'), ...parts });
    if (isBearishHammer(s))    out.bearishHammer.push({ stock:s, score:hammerScore(s,'upperWick'), ...parts });
    if (isBullishMarubozu(s))  out.bullishMarubozu.push({ stock:s, score:marubozuScore(s), ...parts });
    if (isBearishMarubozu(s))  out.bearishMarubozu.push({ stock:s, score:marubozuScore(s), ...parts });
  });
  ['bullishHammer','bearishHammer','bullishMarubozu','bearishMarubozu']
    .forEach(k => out[k].sort((a,b) => b.score - a.score));
  return out;
}

function classifySR(stocks) {
  const tol = SCREENER_TOLERANCE_PCT / 100;
  const out = { support:[], resistance:[] };
  stocks.forEach(stock => {
    const sr = screenerSRData[stock.code];
    if (!sr) return;
    for (const type of ['support','resistance']) {
      (sr[type] || []).forEach(lv => {
        const lp = typeof lv === 'object' ? (lv.price ?? lv.value ?? lv) : lv;
        if (lp && Math.abs(stock.ltp - lp) / lp <= tol) out[type].push({ stock, level: lp });
      });
    }
  });
  for (const type of ['support','resistance']) {
    const map = {};
    out[type].forEach(e => {
      const c = e.stock.code;
      if (!map[c] || Math.abs(e.stock.ltp - e.level) / e.level < Math.abs(map[c].stock.ltp - map[c].level) / map[c].level)
        map[c] = e;
    });
    out[type] = Object.values(map);
  }
  return out;
}

function classifyDDM(stocks) {
  const out = [];
  stocks.forEach(stock => {
    const d0 = screenerDDMDividends[stock.code];
    if (!d0) return;
    const intrinsic = ddmIntrinsic(d0, DDM_DEFAULT_G, DDM_DEFAULT_R);
    if (intrinsic && stock.ltp > 0 && stock.ltp < intrinsic)
      out.push({ stock, intrinsic, margin:(intrinsic - stock.ltp) / stock.ltp * 100, d0 });
  });
  return out.sort((a,b) => b.margin - a.margin);
}

function classifyMacdCrossover(stocks, direction) {
  const out = [];
  stocks.forEach(stock => {
    const c = screenerMacdData[stock.code];
    if (c && c.direction === direction) out.push({ stock, ...c });
  });
  return out.sort((a, b) => Math.abs(b.histogram) - Math.abs(a.histogram));
}

function classifyMinervini(stocks) {
  const out = [];
  stocks.forEach(stock => {
    const m = screenerMinerviniData[stock.code];
    if (m) out.push({ stock, ...m });
  });
  return out.sort((a, b) => (b.pctAboveLow ?? 0) - (a.pctAboveLow ?? 0));
}

function classifyMfPvRatio(stocks) {
  const out = [];
  stocks.forEach(stock => {
    const r = screenerMfPvData[stock.code];
    if (r) out.push({ stock, ...r });
  });
  return out.sort((a, b) => a.pctChange - b.pctChange); // biggest decline first
}

function classifyHilegaMilega(stocks, direction) {
  const out = [];
  stocks.forEach(stock => {
    const h = screenerHmData[stock.code];
    if (h && h.direction === direction) out.push({ stock, ...h });
  });
  return out.sort((a, b) => Math.abs(b.rsi - b.wma21) - Math.abs(a.rsi - a.wma21));
}

function classifyLiquiditySweep(stocks, direction) {
  const out = [];
  stocks.forEach(stock => {
    const s = screenerLiqSweepData[stock.code];
    if (s && s.direction === direction) out.push({ stock, ...s });
  });
  return out.sort((a, b) => b.overshootPct - a.overshootPct);
}

// Clean holds first, then whichever is sitting closest to the level: those
// are the ones where the retest is still live and the stop is still tight.
// A name that has already run 12% off the level retested too, but the entry
// that made it interesting has gone.
function classifyBreakoutRetest(stocks, direction) {
  const out = [];
  stocks.forEach(stock => {
    const r = screenerRetestData[stock.code];
    if (r && r.direction === direction) out.push({ stock, ...r });
  });
  return out.sort((a, b) =>
    (a.cleanHold === b.cleanHold ? 0 : a.cleanHold ? -1 : 1) || (a.distancePct - b.distancePct));
}

// Buys where the strategy has actually worked on that stock come first, then
// the tightest stops. A signal is only as good as the rules' record on the
// symbol it fired on, and `edge` (strategy return minus buy & hold) is the
// honest version of that — several of these fire on stocks where the strategy
// has historically lost to simply holding, and that has to sort last rather
// than be hidden. Signals with no usable bracket sink to the bottom: the
// strategy would skip them at fill.
function classifyMacdStrategy1(stocks, direction) {
  const out = [];
  stocks.forEach(stock => {
    const s = screenerMacdS1Data[stock.code];
    if (s && s.direction === direction) out.push({ stock, ...s });
  });
  if (direction === 'buy') {
    return out.sort((a, b) =>
      (a.bracketOk === b.bracketOk ? 0 : a.bracketOk ? -1 : 1) ||
      ((b.edge ?? -Infinity) - (a.edge ?? -Infinity)) ||
      ((a.riskPct ?? Infinity) - (b.riskPct ?? Infinity)));
  }
  // Exits: biggest open gain first — the position with most to protect.
  return out.sort((a, b) => (b.pnlPct ?? 0) - (a.pnlPct ?? 0));
}

// ──────────────────────────────────────────────────────────
// PATTERN METADATA
// ──────────────────────────────────────────────────────────
const PATTERNS = {
  support:{ key:'support', label:'Hitting Support', color:'support',
    desc:`LTP within \xb1${SCREENER_TOLERANCE_PCT}% of a known support level`,
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    badge:'▲ SUP', isSR:true, loadGroup:'sr' },
  resistance:{ key:'resistance', label:'Hitting Resistance', color:'resistance',
    desc:`LTP within \xb1${SCREENER_TOLERANCE_PCT}% of a known resistance level`,
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
    badge:'▼ RES', isSR:true, loadGroup:'sr' },
  bullishHammer:{ key:'bullishHammer', label:'Bullish Hammer', color:'bullish-hammer',
    desc:'Small body near top \xb7 long lower wick ≥ 2\xd7 body \xb7 tiny upper wick',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="4" width="6" height="5" rx="1"/><line x1="12" y1="9" x2="12" y2="21"/><line x1="12" y1="2" x2="12" y2="4"/></svg>`,
    badge:'🔨 B\xb7HAMMER', wickKey:'lowerWick', scoreLabel:'wick/body', isSR:false, loadGroup:'candle',
    emptyMsg:'No stocks are forming a bullish hammer today. Patterns appear after meaningful price rejection at the lows.',
    legend:{ candle:'bullish-hammer', items:[
      { color:'var(--text-muted)', text:'Tiny upper wick (≤ 10% of range)' },
      { color:'#22c55e', text:'Small body near top (≤ 35% of range)' },
      { color:'#f59e0b', text:'Long lower wick (≥ 2\xd7 body) — buyers pushed price back up' }
    ]}},
  bearishHammer:{ key:'bearishHammer', label:'Bearish Hammer', color:'bearish-hammer',
    desc:'Small body near bottom \xb7 long upper wick ≥ 2\xd7 body \xb7 tiny lower wick',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="15" width="6" height="5" rx="1"/><line x1="12" y1="3" x2="12" y2="15"/><line x1="12" y1="20" x2="12" y2="22"/></svg>`,
    badge:'🔻 S\xb7STAR', wickKey:'upperWick', scoreLabel:'wick/body', isSR:false, loadGroup:'candle',
    emptyMsg:'No stocks are forming a bearish hammer (shooting star) today. Patterns appear after price rejection at the highs.',
    legend:{ candle:'bearish-hammer', items:[
      { color:'#ef4444', text:'Long upper wick (≥ 2\xd7 body) — sellers pushed price back down' },
      { color:'#ef4444', text:'Small body near bottom (≤ 35% of range)' },
      { color:'var(--text-muted)', text:'Tiny lower wick (≤ 10% of range)' }
    ]}},
  bullishMarubozu:{ key:'bullishMarubozu', label:'Bullish Marubozu', color:'bullish-marubozu',
    desc:'Green candle \xb7 body ≥ 85% of range \xb7 near-zero wicks',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="3" width="8" height="18" rx="1" fill="rgba(34,197,94,0.2)"/></svg>`,
    badge:'📗 MARUBOZU', scoreLabel:'body%', isSR:false, loadGroup:'candle',
    emptyMsg:'No bullish marubozu candles today. These appear when buyers dominate the full session with almost no wick.',
    legend:{ candle:'bullish-marubozu', items:[
      { color:'#22c55e', text:'Closes at / near the high (upper wick ≤ 5%)' },
      { color:'#22c55e', text:"Large green body covering ≥ 85% of the day's range" },
      { color:'#22c55e', text:'Opens at / near the low (lower wick ≤ 5%)' }
    ]}},
  bearishMarubozu:{ key:'bearishMarubozu', label:'Bearish Marubozu', color:'bearish-marubozu',
    desc:'Red candle \xb7 body ≥ 85% of range \xb7 near-zero wicks',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="3" width="8" height="18" rx="1" fill="rgba(239,68,68,0.2)"/></svg>`,
    badge:'📕 MARUBOZU', scoreLabel:'body%', isSR:false, loadGroup:'candle',
    emptyMsg:'No bearish marubozu candles today. These appear when sellers dominate the full session with almost no wick.',
    legend:{ candle:'bearish-marubozu', items:[
      { color:'#ef4444', text:'Opens at / near the high (upper wick ≤ 5%)' },
      { color:'#ef4444', text:"Large red body covering ≥ 85% of the day's range" },
      { color:'#ef4444', text:'Closes at / near the low (lower wick ≤ 5%)' }
    ]}},
  ddmUndervalued:{ key:'ddmUndervalued', label:'Undervalued — DDM', color:'ddm-undervalued',
    desc:`LTP below DDM intrinsic value (Gordon Growth: g=${DDM_DEFAULT_G}%, r=${DDM_DEFAULT_R}%)`,
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/><path d="M7 17l-2 2M17 17l2 2"/></svg>`,
    badge:'💎 DDM', isSR:false, isDDM:true, loadGroup:'ddm',
    emptyMsg:`No dividend-paying stocks are currently trading below their DDM intrinsic value (g=${DDM_DEFAULT_G}%, r=${DDM_DEFAULT_R}%). Each scan automatically fetches dividend data for the top 30 most-traded stocks. Run more scans or visit individual company pages to grow coverage.` },
  macdBullishCross:{ key:'macdBullishCross', label:'MACD Bullish Cross', color:'macd-cross',
    desc:'MACD(12,26,9) line crossed above its signal line on the latest bar',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 15c4 0 6-9 10-9s6 9 10 9"/><path d="M2 9c4 0 6 9 10 9s6-9 10-9"/><path d="M19 3l3 3-3 3" stroke-width="2.5"/></svg>`,
    badge:'▲ MACD', isSR:false, isMacd:true, loadGroup:'macd',
    emptyMsg:'No stocks have a fresh bullish MACD crossover at this timeframe right now. Try a different timeframe or rescan after prices update.' },
  macdBearishCross:{ key:'macdBearishCross', label:'MACD Bearish Cross', color:'macd-cross',
    desc:'MACD(12,26,9) line crossed below its signal line on the latest bar',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9c4 0 6 9 10 9s6-9 10-9"/><path d="M2 15c4 0 6-9 10-9s6 9 10 9"/><path d="M19 21l3-3-3-3" stroke-width="2.5"/></svg>`,
    badge:'▼ MACD', isSR:false, isMacd:true, loadGroup:'macd',
    emptyMsg:'No stocks have a fresh bearish MACD crossover at this timeframe right now. Try a different timeframe or rescan after prices update.' },
  minervini:{ key:'minervini', label:'Minervini Trend Template', color:'minervini',
    desc:'Meets all 7 Minervini Stage-2 uptrend criteria (50/150/200-day SMA stack, 52-week range)',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>`,
    badge:'🛡 MINERVINI', isSR:false, isMinervini:true, loadGroup:'minervini',
    emptyMsg:'No stocks currently pass all 7 Minervini Trend Template criteria. This is a strict Stage-2 uptrend definition — expect this list to be small or empty most of the time.' },
  mfPvDecline:{ key:'mfPvDecline', label:'MF Price/Portfolio-Value ↓', color:'mf-pv-decline',
    desc:'Mutual funds whose price vs. latest disclosed portfolio value ratio fell quarter-over-quarter',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 9l4 4 4-6 4 5" transform="scale(1,-1) translate(0,-20)"/></svg>`,
    badge:'📉 MF P/PV', isSR:false, isMfPv:true, loadGroup:'mfPv',
    emptyMsg:'No mutual funds currently show a declining price/portfolio-value ratio. Only funds with 2+ quarters of disclosed holdings on the Mutual Fund Portfolio page can be evaluated — coverage here is inherently small.' },
  hmBuy:{ key:'hmBuy', label:'Hilega-Milega Buy', color:'hm-cross',
    desc:'Fast RSI(9) line crossed from below to above its 21-period WMA on the latest bar',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 15c4 0 6-9 10-9s6 9 10 9"/><path d="M2 9c4 0 6 9 10 9s6-9 10-9"/><path d="M19 3l3 3-3 3" stroke-width="2.5"/></svg>`,
    badge:'▲ H-M', isSR:false, isHm:true, loadGroup:'hm',
    emptyMsg:'No stocks have a fresh Hilega-Milega buy crossover right now. Rescan after prices update.' },
  hmSell:{ key:'hmSell', label:'Hilega-Milega Sell', color:'hm-cross',
    desc:'Fast RSI(9) line crossed from above to below its 21-period WMA on the latest bar',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9c4 0 6 9 10 9s6-9 10-9"/><path d="M2 15c4 0 6-9 10-9s6 9 10 9"/><path d="M19 21l3-3-3-3" stroke-width="2.5"/></svg>`,
    badge:'▼ H-M', isSR:false, isHm:true, loadGroup:'hm',
    emptyMsg:'No stocks have a fresh Hilega-Milega sell crossover right now. Rescan after prices update.' },
  liqSweepBullish:{ key:'liqSweepBullish', label:'Liquidity Sweep — Bullish', color:'liq-sweep',
    desc:'Wicked below its 20-day low then closed back above it \xb7 sell-side liquidity swept',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="15" x2="21" y2="15" stroke-dasharray="3 2"/><path d="M12 20V8"/><path d="M8 12l4-4 4 4"/></svg>`,
    badge:'🧲 SWEEP', isSR:false, isLiqSweep:true, loadGroup:'liqSweep',
    emptyMsg:'No stocks wicked below a recent 20-day low and closed back above it today. Rescan after prices update.' },
  liqSweepBearish:{ key:'liqSweepBearish', label:'Liquidity Sweep — Bearish', color:'liq-sweep',
    desc:'Wicked above its 20-day high then closed back below it \xb7 buy-side liquidity swept',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="9" x2="21" y2="9" stroke-dasharray="3 2"/><path d="M12 4v12"/><path d="M8 12l4 4 4-4"/></svg>`,
    badge:'🧲 SWEEP', isSR:false, isLiqSweep:true, loadGroup:'liqSweep',
    emptyMsg:'No stocks wicked above a recent 20-day high and closed back below it today. Rescan after prices update.' },
  retestBullish:{ key:'retestBullish', label:'Breakout Retest \u2014 Bullish', color:'breakout-retest',
    desc:'Closed above a tested 60-day resistance, then pulled back to it and held \xb7 resistance turned support',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="10" x2="22" y2="10" stroke-dasharray="3 2"/><path d="M4 19l5-11 4 6 3-3"/><path d="M16 11l3 3 3-6"/></svg>`,
    badge:'\u21ba RETEST', isSR:false, isRetest:true, loadGroup:'retest',
    emptyMsg:'No stocks are currently retesting a broken resistance. This needs a close above a level that had held at least twice, a pullback to it within the last few days, and no close back below \u2014 so the list is usually short.' },
  retestBearish:{ key:'retestBearish', label:'Breakout Retest \u2014 Bearish', color:'breakout-retest',
    desc:'Closed below a tested 60-day support, then rallied back to it and was capped \xb7 support turned resistance',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="14" x2="22" y2="14" stroke-dasharray="3 2"/><path d="M4 5l5 11 4-6 3 3"/><path d="M16 13l3-3 3 6"/></svg>`,
    badge:'\u21ba RETEST', isSR:false, isRetest:true, loadGroup:'retest',
    emptyMsg:'No stocks are currently retesting a broken support from below. Rescan after prices update.' },
  macdS1Buy:{ key:'macdS1Buy', label:'MACD + 50 EMA \u2014 Buy', color:'macd-s1',
    desc:'MACD crossed up on the latest bar AND that bar closed above the 50-EMA \xb7 the strategy would buy at the next open',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 16c4 0 6-8 10-8s6 8 10 8"/><path d="M3 20h18" stroke-dasharray="3 2"/><path d="M12 3v6"/><path d="M9 6l3-3 3 3"/></svg>`,
    badge:'\u25b2 S1 BUY', isSR:false, isMacdS1:true, loadGroup:'macdS1',
    emptyMsg:'No stock has a MACD + 50 EMA entry signal standing on the latest bar. This needs a bullish MACD cross AND a close above the 50-EMA on the same bar, so it is a much stricter list than the plain MACD Bullish Cross scan.' },
  macdS1Exit:{ key:'macdS1Exit', label:'MACD + 50 EMA \u2014 Exit', color:'macd-s1',
    desc:'MACD crossed down while the strategy holds an open position \xb7 it would sell at the next open',
    icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8c4 0 6 8 10 8s6-8 10-8"/><path d="M3 20h18" stroke-dasharray="3 2"/><path d="M12 3v6"/><path d="M9 6l3 3 3-3"/></svg>`,
    badge:'\u25bc S1 EXIT', isSR:false, isMacdS1:true, loadGroup:'macdS1',
    emptyMsg:'The strategy is not signalling an exit on any open position right now. This only fires when a bearish MACD cross lands on a stock the strategy is already long \u2014 stops and targets close positions without appearing here.' }
};

// ──────────────────────────────────────────────────────────
// MAIN SCAN — three independent async phases
// ──────────────────────────────────────────────────────────
function _activePatternMatchesGroup(group) {
  return PATTERNS[screenerActiveList].loadGroup === group;
}

async function runScreenerScan() {
  if (screenerScanRunning) return;
  screenerScanRunning = true;
  _patchRescanBtn(true);

  screenerStocksData = window.allStocksData || [];
  screenerLoadingState = { candle: null, sr: 'loading', ddm: 'loading', macd: 'loading', minervini: 'loading', mfPv: 'loading', hm: 'loading', liqSweep: 'loading', retest: 'loading', macdS1: 'loading' };
  _patchNavCounts(['support', 'resistance', 'ddmUndervalued', 'macdBullishCross', 'macdBearishCross', 'minervini', 'mfPvDecline', 'hmBuy', 'hmSell', 'liqSweepBullish', 'liqSweepBearish', 'retestBullish', 'retestBearish', 'macdS1Buy', 'macdS1Exit']);
  if (!_activePatternMatchesGroup('candle')) renderMainPane();

  // ── Phase 1: Candle patterns — synchronous, zero wait ───
  const candleResults = classifyCandlePatterns(screenerStocksData);
  screenerResults      = { ...screenerResults, ...candleResults };
  screenerLastScan     = new Date();
  _patchNavCounts(['bullishHammer', 'bearishHammer', 'bullishMarubozu', 'bearishMarubozu']);
  if (_activePatternMatchesGroup('candle')) renderMainPane();
  _patchSidebarStatus();

  // ── Phase 2: S/R — single bulk request ──────────────────
  const srDone = _fetchSR().then(() => {
    const sr = classifySR(screenerStocksData);
    screenerResults.support    = sr.support;
    screenerResults.resistance = sr.resistance;
    screenerLoadingState.sr    = null;
    _patchNavCounts(['support', 'resistance']);
    if (_activePatternMatchesGroup('sr')) renderMainPane();
    _patchSidebarStatus();
  });

  // ── Phase 3: DDM — streams per batch ────────────────────
  const ddmDone = _fetchDDM(() => {
    screenerResults.ddmUndervalued = classifyDDM(screenerStocksData);
    _patchNavCounts(['ddmUndervalued']);
    if (_activePatternMatchesGroup('ddm')) renderMainPane();
  }).then(() => {
    screenerLoadingState.ddm       = null;
    screenerResults.ddmUndervalued = classifyDDM(screenerStocksData);
    _patchNavCounts(['ddmUndervalued']);
    if (_activePatternMatchesGroup('ddm')) renderMainPane();
  });

  // ── Phase 4: MACD crossover — single bulk request at the active timeframe ──
  const macdDone = _fetchMacdCrossover(screenerMacdTimeframe).then(() => {
    screenerResults.macdBullishCross = classifyMacdCrossover(screenerStocksData, 'bullish');
    screenerResults.macdBearishCross = classifyMacdCrossover(screenerStocksData, 'bearish');
    screenerLoadingState.macd        = null;
    _patchNavCounts(['macdBullishCross', 'macdBearishCross']);
    if (_activePatternMatchesGroup('macd')) renderMainPane();
    _patchSidebarStatus();
  });

  // ── Phase 5: Minervini Trend Template — single bulk request ──
  const minerviniDone = _fetchMinervini().then(() => {
    screenerResults.minervini      = classifyMinervini(screenerStocksData);
    screenerLoadingState.minervini = null;
    _patchNavCounts(['minervini']);
    if (_activePatternMatchesGroup('minervini')) renderMainPane();
  });

  // ── Phase 6: MF price/portfolio-value ratio — single bulk request ──
  const mfPvDone = _fetchMfPvRatio().then(() => {
    screenerResults.mfPvDecline = classifyMfPvRatio(screenerStocksData);
    screenerLoadingState.mfPv   = null;
    _patchNavCounts(['mfPvDecline']);
    if (_activePatternMatchesGroup('mfPv')) renderMainPane();
  });

  // ── Phase 7: Hilega-Milega crossover — single bulk request ──
  const hmDone = _fetchHilegaMilega().then(() => {
    screenerResults.hmBuy  = classifyHilegaMilega(screenerStocksData, 'bullish');
    screenerResults.hmSell = classifyHilegaMilega(screenerStocksData, 'bearish');
    screenerLoadingState.hm = null;
    _patchNavCounts(['hmBuy', 'hmSell']);
    if (_activePatternMatchesGroup('hm')) renderMainPane();
  });

  // ── Phase 8: Liquidity sweep zone — single bulk request ──
  const liqSweepDone = _fetchLiquiditySweep().then(() => {
    screenerResults.liqSweepBullish = classifyLiquiditySweep(screenerStocksData, 'bullish');
    screenerResults.liqSweepBearish = classifyLiquiditySweep(screenerStocksData, 'bearish');
    screenerLoadingState.liqSweep   = null;
    _patchNavCounts(['liqSweepBullish', 'liqSweepBearish']);
    if (_activePatternMatchesGroup('liqSweep')) renderMainPane();
  });

  // ── Phase 9: Breakout retest — single bulk request ──
  const retestDone = _fetchBreakoutRetest().then(() => {
    screenerResults.retestBullish = classifyBreakoutRetest(screenerStocksData, 'bullish');
    screenerResults.retestBearish = classifyBreakoutRetest(screenerStocksData, 'bearish');
    screenerLoadingState.retest   = null;
    _patchNavCounts(['retestBullish', 'retestBearish']);
    if (_activePatternMatchesGroup('retest')) renderMainPane();
  });

  // ── Phase 10: MACD + 50 EMA signals — single bulk request ──
  const macdS1Done = _fetchMacdStrategy1().then(() => {
    screenerResults.macdS1Buy    = classifyMacdStrategy1(screenerStocksData, 'buy');
    screenerResults.macdS1Exit   = classifyMacdStrategy1(screenerStocksData, 'exit');
    screenerLoadingState.macdS1  = null;
    _patchNavCounts(['macdS1Buy', 'macdS1Exit']);
    if (_activePatternMatchesGroup('macdS1')) renderMainPane();
  });

  await Promise.all([srDone, ddmDone, macdDone, minerviniDone, mfPvDone, hmDone, liqSweepDone, retestDone, macdS1Done]);
  screenerScanRunning = false;
  _patchRescanBtn(false);
  _patchSidebarStatus();
}

// Re-fetch just the MACD crossover phase at a new timeframe, without
// disturbing any of the other (independent) lists.
function screenerSetMacdTimeframe(tf) {
  if (tf === screenerMacdTimeframe || !['daily', 'weekly', 'monthly'].includes(tf)) return;
  screenerMacdTimeframe = tf;
  screenerLoadingState.macd = 'loading';
  _patchNavCounts(['macdBullishCross', 'macdBearishCross']);
  renderMainPane();
  _fetchMacdCrossover(tf).then(() => {
    screenerResults.macdBullishCross = classifyMacdCrossover(screenerStocksData, 'bullish');
    screenerResults.macdBearishCross = classifyMacdCrossover(screenerStocksData, 'bearish');
    screenerLoadingState.macd        = null;
    _patchNavCounts(['macdBullishCross', 'macdBearishCross']);
    if (_activePatternMatchesGroup('macd')) renderMainPane();
  });
}

// ──────────────────────────────────────────────────────────
// FETCHERS
// ──────────────────────────────────────────────────────────
async function _fetchSR() {
  // Auto-computed from every stock's own weekly swing highs/lows — same
  // algorithm as the candlestick page's Support & Resistance panel — rather
  // than the old hand-entered sr_levels table, which only ever covered a
  // handful of manually-annotated stocks.
  try {
    const r = await fetch(`${API}/api/screener/sr`);
    if (!r.ok) throw new Error();
    screenerSRData = (await r.json()).levels || {};
  } catch {
    screenerSRData = {};
  }
}

async function _fetchMacdCrossover(timeframe) {
  try {
    const r = await fetch(`${API}/api/screener/macd-crossover?timeframe=${encodeURIComponent(timeframe)}`);
    if (!r.ok) throw new Error();
    screenerMacdData = (await r.json()).results || {};
  } catch {
    screenerMacdData = {};
  }
}

async function _fetchMinervini() {
  try {
    const r = await fetch(`${API}/api/screener/minervini`);
    if (!r.ok) throw new Error();
    screenerMinerviniData = (await r.json()).results || {};
  } catch {
    screenerMinerviniData = {};
  }
}

async function _fetchMfPvRatio() {
  try {
    const r = await fetch(`${API}/api/screener/mf-pv-ratio`);
    if (!r.ok) throw new Error();
    screenerMfPvData = (await r.json()).results || {};
  } catch {
    screenerMfPvData = {};
  }
}

async function _fetchHilegaMilega() {
  try {
    const r = await fetch(`${API}/api/screener/hilega-milega`);
    if (!r.ok) throw new Error();
    screenerHmData = (await r.json()).results || {};
  } catch {
    screenerHmData = {};
  }
}

async function _fetchLiquiditySweep() {
  try {
    const r = await fetch(`${API}/api/screener/liquidity-sweep`);
    if (!r.ok) throw new Error();
    screenerLiqSweepData = (await r.json()).results || {};
  } catch {
    screenerLiqSweepData = {};
  }
}

async function _fetchBreakoutRetest() {
  try {
    const r = await fetch(`${API}/api/screener/breakout-retest`);
    if (!r.ok) throw new Error();
    screenerRetestData = (await r.json()).results || {};
  } catch {
    screenerRetestData = {};
  }
}

// Served by routes/macd-strategy1.js rather than screener-technicals, so the
// strategy's rules live in exactly one place — the same replay that powers the
// MACD + 50 EMA page decides what counts as a signal here.
async function _fetchMacdStrategy1() {
  try {
    const r = await fetch(`${API}/api/macd-strategy1/signals`);
    if (!r.ok) throw new Error();
    screenerMacdS1Data = (await r.json()).results || {};
  } catch {
    screenerMacdS1Data = {};
  }
}

async function _fetchDDM(onBatch) {
  // Step 1: persisted disk store — typically < 100 ms
  try {
    const res  = await fetch(`${API}/api/dividends-bulk`);
    const data = await res.json();
    screenerDDMDividends = {};
    Object.entries(data.dividends || {}).forEach(([code, raw]) => {
      const d = parseDividendForScreener(raw);
      if (d) screenerDDMDividends[code] = d;
    });
    onBatch();
  } catch { screenerDDMDividends = {}; }

  // Step 2: batch-fetch missing stocks
  const missing = (window.allStocksData || [])
    .filter(s => !(s.code in screenerDDMDividends))
    .sort((a,b) => b.volume - a.volume)
    .slice(0, 30)
    .map(s => s.code);

  for (let i = 0; i < missing.length; i += 10) {
    try {
      const res  = await fetch(`${API}/api/company-details-batch`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ codes: missing.slice(i, i+10) })
      });
      const data = await res.json();
      Object.entries(data.results || {}).forEach(([code, detail]) => {
        const d = parseDividendForScreener(detail.cashDividend);
        if (d) screenerDDMDividends[code] = d;
      });
      onBatch();
    } catch {}
  }
}

// ──────────────────────────────────────────────────────────
// SORTING — generic across all 7 pattern types
// ──────────────────────────────────────────────────────────
function getMetricValue(entry, p) {
  if (p.isSR)        return entry.level;
  if (p.isDDM)        return entry.margin;
  if (p.isMacd)       return Math.abs(entry.histogram);
  if (p.isMinervini)  return entry.pctAboveLow ?? 0;
  if (p.isMfPv)        return entry.pctChange;
  if (p.isHm)           return Math.abs(entry.rsi - entry.wma21);
  if (p.isLiqSweep)     return entry.overshootPct;
  if (p.isRetest)       return entry.distancePct;
  // Buys sort on the strategy's own edge on that stock; exits on open P&L.
  if (p.isMacdS1)       return entry.direction === 'buy' ? (entry.edge ?? 0) : (entry.pnlPct ?? 0);
  return entry.score !== undefined ? entry.score : (entry.body / (entry.range || 1));
}
function sortedList(key) {
  const p    = PATTERNS[key];
  const list = (screenerResults[key] || []).slice();
  if (!screenerSortCol) return list;
  const dir = screenerSortDir === 'asc' ? 1 : -1;
  return list.sort((a, b) => {
    if (screenerSortCol === 'code') return a.stock.code.localeCompare(b.stock.code) * dir;
    const av = screenerSortCol === 'ltp'    ? a.stock.ltp
             : screenerSortCol === 'change' ? a.stock.change
             : getMetricValue(a, p);
    const bv = screenerSortCol === 'ltp'    ? b.stock.ltp
             : screenerSortCol === 'change' ? b.stock.change
             : getMetricValue(b, p);
    return (av - bv) * dir;
  });
}
function screenerSortBy(col) {
  if (screenerSortCol === col) {
    screenerSortDir = screenerSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    screenerSortCol = col;
    screenerSortDir = col === 'code' ? 'asc' : 'desc';
  }
  renderMainPane();
}

// ──────────────────────────────────────────────────────────
// DOM PATCH HELPERS — targeted, no full re-render
// ──────────────────────────────────────────────────────────
function _patchNavCounts(keys) {
  const nav = document.getElementById('scr-nav');
  if (!nav) return;
  keys.forEach(key => {
    const item = nav.querySelector(`.scr-nav-item[data-key="${key}"]`);
    if (!item) return;
    const p         = PATTERNS[key];
    const isLoading = screenerLoadingState[p.loadGroup] === 'loading';
    const n         = (screenerResults[key] || []).length;

    const countEl = item.querySelector('.scr-nav-count');
    if (countEl) {
      const prevText = countEl.textContent;
      countEl.innerHTML = isLoading ? '<span class="sc-skeleton-count sc-skeleton-count--sm"></span>' : String(n);
      // Pop only when a real number just landed (not on every skeleton
      // repaint, and not on first paint where there's nothing to compare to).
      if (!isLoading && prevText && prevText !== String(n)) {
        countEl.classList.remove('sc-count-pop');
        void countEl.offsetWidth; // restart the animation on repeat updates
        countEl.classList.add('sc-count-pop');
      }
    }

    item.classList.toggle('sc-loading', isLoading);
  });
}

function _patchSidebarStatus() {
  const bar = document.getElementById('sc-status-bar');
  if (bar) bar.innerHTML = _buildStatusContent();
}

function _buildStatusContent() {
  const t = screenerLastScan
    ? screenerLastScan.toLocaleTimeString('en-BD', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    : '—';
  const srTxt  = screenerLoadingState.sr  === 'loading' ? '<span class="sc-stat-skeleton"></span>' : `<span>${Object.keys(screenerSRData).length} with S/R</span>`;
  const ddmTxt = screenerLoadingState.ddm === 'loading' ? '<span class="sc-stat-skeleton"></span>' : `<span>${Object.keys(screenerDDMDividends).length} with dividend data</span>`;
  return `<span class="screener-live-dot"></span> Last scan <span>${t}</span> &middot; <span>${screenerStocksData.length} stocks</span><br>${srTxt} &middot; ${ddmTxt}`;
}

function _patchRescanBtn(spinning) {
  const btn = document.getElementById('screener-rescan-btn');
  if (!btn) return;
  const wasSpinning = btn.classList.contains('spinning');
  btn.classList.toggle('spinning', spinning);
  // Quiet ring-flash the moment a scan actually finishes, not on every call.
  if (wasSpinning && !spinning) {
    btn.classList.remove('sc-rescan-done');
    void btn.offsetWidth;
    btn.classList.add('sc-rescan-done');
  }
}

// Filter the sidebar nav list by the current search query (no re-render).
// Walks each .scr-nav-group (Favorites / All Lists) separately so a group
// whose every item got filtered out can hide its own section label instead
// of leaving a heading dangling over nothing.
function _filterNavItems() {
  const nav = document.getElementById('scr-nav');
  if (!nav) return;
  const q = screenerSearchQuery.trim().toLowerCase();

  let visibleCount = 0;
  nav.querySelectorAll('.scr-nav-group').forEach(group => {
    let groupVisible = 0;
    group.querySelectorAll('.scr-nav-item').forEach(item => {
      const p = PATTERNS[item.dataset.key];
      if (!p) return;
      const matches = !q
        || p.label.toLowerCase().includes(q)
        || p.desc.toLowerCase().includes(q)
        || p.key.toLowerCase().includes(q);
      item.style.display = matches ? '' : 'none';
      if (matches) groupVisible++;
    });
    visibleCount += groupVisible;
    const label = group.querySelector('.scr-nav-section-label');
    if (label) label.style.display = groupVisible ? '' : 'none';
  });

  // Show / hide empty-search state
  let emptyEl = nav.querySelector('.sc-search-empty');
  if (visibleCount === 0 && q) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'sc-search-empty';
      emptyEl.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span>No lists match <strong>"${escHtmlS(q)}"</strong></span>`;
      nav.appendChild(emptyEl);
    } else {
      emptyEl.querySelector('span').innerHTML = `No lists match <strong>"${escHtmlS(q)}"</strong>`;
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }
}

// Called by the inline oninput on the search field
window.screenerSearchInput = function(val) {
  screenerSearchQuery = val;
  _filterNavItems();
  const clearBtn = document.getElementById('sc-search-clear');
  if (clearBtn) clearBtn.style.display = val ? 'flex' : 'none';
};

window.screenerSearchClear = function() {
  screenerSearchQuery = '';
  const input = document.getElementById('sc-search-input');
  if (input) { input.value = ''; input.focus(); }
  _filterNavItems();
  const clearBtn = document.getElementById('sc-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
};

// Called by the star button on each nav row (event.stopPropagation() in its
// own onclick keeps this from also firing screenerSelectPattern on the row).
window.screenerToggleFavorite = function(key) {
  if (screenerFavorites.has(key)) screenerFavorites.delete(key);
  else screenerFavorites.add(key);
  _saveScreenerFavorites();
  const nav = document.getElementById('scr-nav');
  if (nav) nav.innerHTML = buildNavHTML();
  _filterNavItems();
};

// ──────────────────────────────────────────────────────────
// RENDER — persistent sidebar shell + swappable main pane
// ──────────────────────────────────────────────────────────
function renderShell() {
  const root = document.getElementById('screener-page-root');
  if (!root) return;
  root.innerHTML = `
    <div class="scr-shell">
      <aside class="scr-sidebar">${buildSidebar()}</aside>
      <section class="scr-main" id="scr-main">${buildMainPane()}</section>
    </div>`;
  if (!screenerSearchQuery) {
    const inp = document.getElementById('sc-search-input');
    if (inp) setTimeout(() => inp.focus(), 120);
  }
}

function renderMainPane() {
  const main = document.getElementById('scr-main');
  if (main) main.innerHTML = buildMainPane();
}

function screenerSelectPattern(key) {
  if (key === screenerActiveList) return;
  screenerActiveList = key;
  screenerSortCol = null;
  screenerSortDir = 'desc';
  document.querySelectorAll('.scr-nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.key === key));
  renderMainPane();
}

// ──────────────────────────────────────────────────────────
// BUILD — Sidebar (status + search + pattern nav)
// ──────────────────────────────────────────────────────────
function buildNavHTML() {
  const favKeys  = Object.keys(PATTERNS).filter(k => screenerFavorites.has(k));
  const restKeys = Object.keys(PATTERNS).filter(k => !screenerFavorites.has(k));
  // Mutually exclusive groups — a favorited item only appears once, in the
  // Favorites group. Duplicating it into both would leave _patchNavCounts'
  // and _filterNavItems' data-key lookups only ever touching whichever
  // copy querySelector happens to find first, silently desyncing the other.
  const favHTML = favKeys.length ? `
    <div class="scr-nav-group" data-group="fav">
      <div class="scr-nav-section-label">★ Favorites</div>
      ${favKeys.map(k => buildNavItem(PATTERNS[k])).join('')}
    </div>` : '';
  const restHTML = `
    <div class="scr-nav-group" data-group="all">
      ${favKeys.length ? `<div class="scr-nav-section-label">All Lists</div>` : ''}
      ${restKeys.map(k => buildNavItem(PATTERNS[k])).join('')}
    </div>`;
  return favHTML + restHTML;
}

function buildSidebar() {
  const navHTML = buildNavHTML();
  return `
    <div class="scr-sidebar-status">
      <div class="scr-live-row" id="sc-status-bar">${_buildStatusContent()}</div>
      <button class="scr-rescan-btn${screenerScanRunning ? ' spinning' : ''}"
              id="screener-rescan-btn" onclick="runScreenerScan()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
        Rescan
      </button>
    </div>
    <div class="sc-search-row">
      <div class="sc-search-wrap">
        <svg class="sc-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          id="sc-search-input"
          class="sc-search-input"
          type="text"
          placeholder="Search lists&hellip;"
          autocomplete="off"
          spellcheck="false"
          value="${escHtmlS(screenerSearchQuery)}"
          oninput="screenerSearchInput(this.value)"
          onkeydown="if(event.key==='Escape'){screenerSearchClear();event.stopPropagation();}"
        />
        <button id="sc-search-clear" class="sc-search-clear"
                style="display:${screenerSearchQuery ? 'flex' : 'none'}"
                onclick="screenerSearchClear()" title="Clear search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <nav class="scr-nav" id="scr-nav">${navHTML}</nav>`;
}

function buildNavItem(p) {
  const isLoading = screenerLoadingState[p.loadGroup] === 'loading';
  const n         = (screenerResults[p.key] || []).length;
  const countHtml = isLoading ? '<span class="sc-skeleton-count sc-skeleton-count--sm"></span>' : n;
  const isFav     = screenerFavorites.has(p.key);
  // A star <button> can't nest inside the row's own <button> (interactive
  // content isn't valid inside <button> — browsers silently mis-parse it),
  // so the row itself is a div acting as a button (role+tabindex+keydown)
  // with the star as a real, independently-focusable nested button.
  return `
    <div class="scr-nav-item${p.key === screenerActiveList ? ' active' : ''}${isLoading ? ' sc-loading' : ''}"
         data-key="${p.key}" style="--rgb:${PATTERN_RGB[p.color]}"
         role="button" tabindex="0"
         onclick="screenerSelectPattern('${p.key}')"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();screenerSelectPattern('${p.key}');}">
      <span class="scr-nav-icon">${p.icon}</span>
      <span class="scr-nav-name">${p.label}</span>
      <span class="scr-nav-count">${countHtml}</span>
      <button class="scr-nav-fav-btn${isFav ? ' is-fav' : ''}"
              onclick="event.stopPropagation();screenerToggleFavorite('${p.key}')"
              title="${isFav ? 'Remove from favorites' : 'Add to favorites'}"
              aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
        <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/>
        </svg>
      </button>
    </div>`;
}

// ──────────────────────────────────────────────────────────
// BUILD — Main pane (header + legend + full-width table)
// ──────────────────────────────────────────────────────────
function buildMainPane() {
  const key       = screenerActiveList;
  const p         = PATTERNS[key];
  const isLoading = screenerLoadingState[p.loadGroup] === 'loading';
  const list      = isLoading ? [] : sortedList(key);

  const legendHTML = (!p.isSR && !p.isDDM && p.legend && !isLoading) ? `
    <div class="scr-legend">
      ${buildLegendCandle(p.legend.candle)}
      <div class="scr-legend-labels">
        ${p.legend.items.map(item => `
          <div class="scr-legend-row">
            <span class="scr-legend-dot" style="background:${item.color}"></span>
            <span>${item.text}</span>
          </div>`).join('')}
      </div>
    </div>` : '';

  let bodyHTML;
  if (isLoading) {
    bodyHTML = buildSkeletonTable(p);
  } else if (!list.length) {
    bodyHTML = `
      <div class="scr-empty">
        <div class="scr-empty-icon">${p.icon}</div>
        <h3>No Stocks Found</h3>
        <p>${p.emptyMsg || 'No stocks matched the criteria. Rescan after prices update.'}</p>
      </div>`;
  } else {
    bodyHTML = `
      <div class="scr-table-wrap">
        <table class="scr-table">
          ${buildTableHead()}
          <tbody>${list.map(entry => buildRow(key, entry)).join('')}</tbody>
        </table>
      </div>`;
  }

  const note = p.isSR
    ? `Stocks within \xb1${SCREENER_TOLERANCE_PCT}% of a known ${key} level`
    : p.isDDM
      ? `Gordon Growth \xb7 g=${DDM_DEFAULT_G}% \xb7 r=${DDM_DEFAULT_R}% \xb7 ${Object.keys(screenerDDMDividends).length} stocks have dividend data`
      : p.isMacd
        ? `Crossed on the latest completed ${screenerMacdTimeframe} bar \xb7 fast=12 slow=26 signal=9`
        : p.isMinervini
          ? `All 7 must pass: (1) price>150\xb7200-day SMA (2) 150-day SMA>200-day SMA (3) 200-day SMA rising ≥ 1mo (4) 50-day SMA>150\xb7200-day SMA (5) price>50-day SMA (6) ≥ 25% above 52-week low (7) within 25% of 52-week high`
          : p.isMfPv
            ? `Price \xf7 sum of disclosed holdings' market value, quarter-over-quarter \xb7 covers only funds with 2+ disclosed quarters`
            : p.isHm
              ? `Crossed on the latest completed daily bar \xb7 RSI(9) vs its own WMA(21)`
              : p.isLiqSweep
                ? `Today's wick clears the prior 20-day range extreme by ≥ 0.1% but today's close lands back inside it`
                : p.isRetest
                  ? `Closed ≥ 1% beyond a 60-day level that had held ≥ 2 times, within the last 15 bars \xb7 pulled back to within 2% of it in the last 3 bars \xb7 no close 1.5% back through it`
                  : p.isMacdS1
                    ? (screenerActiveList === 'macdS1Buy'
                        ? `MACD(12,26,9) crossed up on the latest bar with that bar closing above the 50-EMA \xb7 stop = 10-bar low, target = 2.0R \xb7 sorted by the strategy's own edge on each stock`
                        : `Bearish MACD cross on a position the strategy is already long \xb7 sorted by open P&L \xb7 stops and targets close positions without appearing here`)
                    : `Default sort by signal strength \xb7 open ≈ YCP \xb7 click a column to re-sort`;

  const pillCount = isLoading
    ? '<span class="sc-chip-dot"></span>'
    : `${list.length} stock${list.length !== 1 ? 's' : ''}`;

  const timeframeHTML = p.isMacd ? `
    <div class="scr-tf-row">
      ${['daily', 'weekly', 'monthly'].map(tf => `
        <button class="scr-tf-btn${tf === screenerMacdTimeframe ? ' active' : ''}"
                onclick="screenerSetMacdTimeframe('${tf}')">${tf[0].toUpperCase()}${tf.slice(1)}</button>`).join('')}
    </div>` : '';

  return `
    <div class="scr-main-hd" style="--rgb:${PATTERN_RGB[p.color]}">
      <div class="scr-main-icon">${p.icon}</div>
      <div class="scr-main-title-wrap">
        <div class="scr-main-title">${p.label}</div>
        <div class="scr-main-desc">${p.desc}</div>
      </div>
      ${timeframeHTML}
      <span class="scr-main-pill">${pillCount}</span>
    </div>
    <div class="scr-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      ${note}
    </div>
    ${legendHTML}
    ${bodyHTML}`;
}

function buildTableHead() {
  const arrow = (col) => screenerSortCol === col ? (screenerSortDir === 'asc' ? ' ▴' : ' ▾') : '';
  return `
    <thead>
      <tr>
        <th onclick="screenerSortBy('code')">Stock${arrow('code')}</th>
        <th class="scr-th-num" onclick="screenerSortBy('ltp')">LTP${arrow('ltp')}</th>
        <th class="scr-th-num" onclick="screenerSortBy('change')">Change${arrow('change')}</th>
        <th class="scr-th-num" onclick="screenerSortBy('metric')">Signal${arrow('metric')}</th>
      </tr>
    </thead>`;
}

function buildSkeletonTable(p) {
  const rows = Array.from({ length: 6 }).map(() => `
    <tr>
      <td><div class="sc-skel-bar" style="width:62px;height:11px"></div></td>
      <td><div class="sc-skel-bar" style="width:50px;height:11px;margin-left:auto"></div></td>
      <td><div class="sc-skel-bar" style="width:42px;height:11px;margin-left:auto"></div></td>
      <td><div class="sc-skel-bar" style="width:72px;height:11px;margin-left:auto"></div></td>
    </tr>`).join('');
  return `
    <div class="scr-table-wrap">
      <table class="scr-table">
        ${buildTableHead()}
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="scr-skel-note">
      <span class="screener-scanning-spinner"></span>
      Fetching ${p.isSR ? 'support &amp; resistance levels' : 'dividend data'} from server&hellip;
    </div>`;
}

function buildRow(key, entry) {
  const p   = PATTERNS[key];
  const s   = entry.stock;
  const dir = s.change > 0 ? 'up' : s.change < 0 ? 'dn' : 'fl';
  const sgn = s.change > 0 ? '+' : '';
  const pct = s.ycp ? ((s.change / s.ycp) * 100).toFixed(1) : '0.0';

  let signalHTML;
  if (p.isSR) {
    const distPct = ((entry.level - s.ltp) / s.ltp * 100).toFixed(1);
    signalHTML = `
      <div class="scr-signal-main">${p.badge} ৳${entry.level.toFixed(1)}</div>
      <div class="scr-signal-sub">${distPct >= 0 ? '+' : ''}${distPct}% away</div>`;
  } else if (p.isDDM) {
    signalHTML = `
      <div class="scr-signal-main">৳${entry.intrinsic.toFixed(1)} intrinsic</div>
      <div class="scr-signal-sub">+${entry.margin.toFixed(1)}% margin \xb7 D₀=৳${entry.d0.toFixed(2)}</div>`;
  } else if (p.isMacd) {
    const arrow = entry.direction === 'bullish' ? '▲' : '▼';
    signalHTML = `
      <div class="scr-signal-main">${arrow} ${entry.histogram >= 0 ? '+' : ''}${entry.histogram.toFixed(3)}</div>
      <div class="scr-signal-sub">MACD ${entry.macd.toFixed(2)} / Sig ${entry.signal.toFixed(2)}</div>`;
  } else if (p.isMinervini) {
    signalHTML = `
      <div class="scr-signal-main">${entry.passed}/${entry.total} criteria</div>
      <div class="scr-signal-sub">+${entry.pctAboveLow}% off low \xb7 -${entry.pctBelowHigh}% off high</div>`;
  } else if (p.isMfPv) {
    signalHTML = `
      <div class="scr-signal-main" style="color:var(--loss)">${entry.pctChange.toFixed(1)}%</div>
      <div class="scr-signal-sub">${entry.prevQuarter} → ${entry.latestQuarter}</div>`;
  } else if (p.isHm) {
    const arrow = entry.direction === 'bullish' ? '▲' : '▼';
    signalHTML = `
      <div class="scr-signal-main">${arrow} RSI ${entry.rsi.toFixed(1)}</div>
      <div class="scr-signal-sub">vs WMA21 ${entry.wma21.toFixed(1)}</div>`;
  } else if (p.isLiqSweep) {
    const arrow = entry.direction === 'bullish' ? '▲' : '▼';
    signalHTML = `
      <div class="scr-signal-main">${arrow} +${entry.overshootPct}% wick</div>
      <div class="scr-signal-sub">vs 20d ${entry.direction === 'bullish' ? 'low' : 'high'} ৳${entry.level.toFixed(1)}</div>`;
  } else if (p.isRetest) {
    // distancePct is signed in the breakout's own direction, so negative means
    // price has slipped back through the level and the retest is failing.
    // That has to stay visible rather than being averaged into a badge.
    const at   = entry.distancePct === 0 ? 'at the level'
               : entry.distancePct > 0   ? `${entry.distancePct}% above`
                                         : `${Math.abs(entry.distancePct)}% below`;
    const warn = !entry.cleanHold
      ? `<span class="scr-retest-flag" title="Closed back through the level ${entry.closesThrough} time${entry.closesThrough === 1 ? '' : 's'} since the breakout — price is churning across it rather than holding it">churn ×${entry.closesThrough}</span>`
      : '';
    const volTxt = entry.volumeRatio != null ? ` \xb7 vol ×${entry.volumeRatio.toFixed(1)}` : '';
    signalHTML = `
      <div class="scr-signal-main${entry.holding ? '' : ' scr-retest-risk'}">৳${entry.level.toFixed(1)} <span class="scr-signal-label">${at}</span>${warn}</div>
      <div class="scr-signal-sub">broke ${entry.breakoutDate.slice(5)} +${entry.breakoutPct}%${volTxt} \xb7 ${entry.touches} prior tests \xb7 retested ${entry.barsSinceRetest === 0 ? 'today' : entry.barsSinceRetest + 'd ago'}</div>`;
  } else if (p.isMacdS1) {
    // The strategy's record on THIS stock, shown beside the signal. Negative
    // edge means the rules underperformed simply holding it — the single most
    // useful thing to know before taking the trade, so it is never omitted.
    const rec = entry.trades
      ? `${entry.trades} prior trade${entry.trades === 1 ? '' : 's'} \xb7 ${entry.winRate == null ? '—' : entry.winRate.toFixed(0) + '% win'}` +
        (entry.edge == null ? '' : ` \xb7 <span class="${entry.edge > 0 ? 'scr-s1-edge-pos' : 'scr-s1-edge-neg'}">${entry.edge > 0 ? '+' : ''}${entry.edge.toFixed(0)}% vs hold</span>`)
      : 'no prior trades on this stock';

    if (entry.direction === 'buy') {
      if (!entry.bracketOk) {
        // Close already at/below the stop: the strategy skips this at fill.
        signalHTML = `
          <div class="scr-signal-main scr-retest-risk">▲ no valid stop</div>
          <div class="scr-signal-sub">close ৳${(entry.lastClose ?? 0).toFixed(1)} is at or below the ${'৳'}${(entry.stop ?? 0).toFixed(1)} lookback low \xb7 ${rec}</div>`;
      } else {
        signalHTML = `
          <div class="scr-signal-main">▲ stop ৳${entry.stop.toFixed(1)} <span class="scr-signal-label">→ ৳${entry.indicativeTarget.toFixed(1)}</span></div>
          <div class="scr-signal-sub">risk ${entry.riskPct.toFixed(1)}% \xb7 fills at next open, bracket indicative \xb7 ${rec}</div>`;
      }
    } else {
      const pnl = entry.pnlPct ?? 0;
      signalHTML = `
        <div class="scr-signal-main" style="color:var(--${pnl >= 0 ? 'gain' : 'loss'})">▼ ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%${entry.r == null ? '' : ` <span class="scr-signal-label">${entry.r.toFixed(1)}R</span>`}</div>
        <div class="scr-signal-sub">in from ${entry.entryDate.slice(5)} @ ৳${entry.entryPrice.toFixed(1)} \xb7 ${entry.bars} bar${entry.bars === 1 ? '' : 's'} \xb7 exits at next open</div>`;
    }
  } else {
    const isHammer = key === 'bullishHammer' || key === 'bearishHammer';
    const wickKey  = p.wickKey || 'body';
    const metric   = isHammer ? entry.score.toFixed(1) + '\xd7' : Math.round((entry.body / (entry.range || 1)) * 100) + '%';
    const barPct   = isHammer ? Math.min(100, Math.round((entry[wickKey] / (entry.range || 1)) * 100)) : Math.round((entry.body / (entry.range || 1)) * 100);
    signalHTML = `
      <div class="scr-signal-main">${metric} <span class="scr-signal-label">${p.scoreLabel}</span></div>
      <div class="scr-wick-bar"><div class="scr-wick-fill" style="width:${barPct}%"></div></div>`;
  }

  return `
    <tr class="scr-row" style="--rgb:${PATTERN_RGB[p.color]}" onclick="window.location='/candlestick_chart/candlestick.html?code=${encodeURIComponent(s.code)}'">
      <td class="scr-td-code">${escHtmlS(s.code)}</td>
      <td class="scr-td-num">৳${s.ltp.toFixed(1)}</td>
      <td class="scr-td-num scr-change ${dir}">${sgn}${s.change.toFixed(1)} <small>${sgn}${pct}%</small></td>
      <td class="scr-td-signal">${signalHTML}</td>
    </tr>`;
}

// ──────────────────────────────────────────────────────────
// BUILD — Mini illustrated candle for legend
// ──────────────────────────────────────────────────────────
function buildLegendCandle(type) {
  const shapes = {
    'bullish-hammer': `<div class="slc-wick" style="height:4px;background:var(--text-muted);opacity:.6"></div><div class="slc-body" style="height:12px;background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.4)"></div><div class="slc-wick" style="height:40px;background:linear-gradient(180deg,#f59e0b,#fbbf24);box-shadow:0 0 8px rgba(245,158,11,.3)"></div>`,
    'bearish-hammer': `<div class="slc-wick" style="height:40px;background:linear-gradient(180deg,#fbbf24,#f59e0b);box-shadow:0 0 8px rgba(245,158,11,.3)"></div><div class="slc-body" style="height:12px;background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,.4)"></div><div class="slc-wick" style="height:4px;background:var(--text-muted);opacity:.6"></div>`,
    'bullish-marubozu': `<div class="slc-wick" style="height:2px;background:transparent"></div><div class="slc-body" style="height:56px;background:linear-gradient(180deg,#16a34a,#22c55e);box-shadow:0 0 14px rgba(34,197,94,.45)"></div><div class="slc-wick" style="height:2px;background:transparent"></div>`,
    'bearish-marubozu': `<div class="slc-wick" style="height:2px;background:transparent"></div><div class="slc-body" style="height:56px;background:linear-gradient(180deg,#ef4444,#b91c1c);box-shadow:0 0 14px rgba(239,68,68,.45)"></div><div class="slc-wick" style="height:2px;background:transparent"></div>`,
  };
  return `<div class="scr-legend-candle">${shapes[type] || ''}</div>`;
}

// ──────────────────────────────────────────────────────────
// HELPER
// ──────────────────────────────────────────────────────────
function escHtmlS(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────────────────
// INIT — standalone page: paint shell, load live quotes, scan
// ──────────────────────────────────────────────────────────
async function initScreenerPage() {
  initTheme();
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);

  screenerLoadingState = { candle: 'loading', sr: 'loading', ddm: 'loading' };
  renderShell();

  try {
    const res  = await fetch(`${API}/api/stocks`);
    const data = await res.json();
    window.allStocksData = data.stocks || [];
  } catch {
    window.allStocksData = [];
  }

  runScreenerScan();
}

document.addEventListener('DOMContentLoaded', initScreenerPage);

window.runScreenerScan          = runScreenerScan;
window.screenerSelectPattern    = screenerSelectPattern;
window.screenerSortBy           = screenerSortBy;
window.screenerSetMacdTimeframe = screenerSetMacdTimeframe;
