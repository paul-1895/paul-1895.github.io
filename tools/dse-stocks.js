'use strict';

/* ═══════════════════════════════════════════════════════════════════
   DSE — SHARE PRICE FEED
   Extracted from routes/scraper.js so that two callers can share it:

     • the live server, behind GET /api/stocks
     • the published site's refresh job, which runs on GitHub's
       schedule and commits the result as api/stocks.json

   Those two must agree on the row shape exactly — the static site
   reads a file the server never sees. Keeping one parser is what
   makes that true rather than hopeful.

   SOURCE (changed 2026-09-24): dsebd.org was rebuilt as a Next.js
   app and every legacy .php endpoint now 404s, including the
   latest_share_price_scroll_l.php table this module used to scrape.
   The replacement is the JSON feed the new market page itself calls.
   It is strictly better than the old HTML: it carries the real
   opening price and trade count, which the scraped table never had.
   Note the site answers a 404 with a ~218 KB Next.js error page, so
   a "did we get bytes back" check is not a liveness check — only the
   status code is.
   ═══════════════════════════════════════════════════════════════════ */

const https = require('https');
const fetch = require('node-fetch');

const URL        = 'https://www.dsebd.org/api/live/prices';
const MARKET_URL = 'https://www.dsebd.org/api/live/market';

// dsebd.org serves a chain whose root CA is not in Node's bundle. Scoped to
// this one host rather than disabling verification globally.
const dseAgent = new https.Agent({ rejectUnauthorized: false });

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Accept: 'application/json',
};

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const int = v => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

/**
 * One row per listed security.
 *
 * `categories` and `names` stay caller-supplied so this module keeps no
 * disk dependencies — the published refresh job ships without them and
 * falls back to the feed's own category and to the code as its own name,
 * exactly as the HTML scraper did when a row carried no title attribute.
 *
 * @param {Object<string,string>} categories  code → category letter; pass {} if unknown.
 * @param {Object<string,string>} names       code → company name; pass {} if unknown.
 * @returns {Promise<Array<Object>>} one row per listed security
 */
async function scrapeStocks(categories = {}, names = {}) {
  return (await scrapePrices(categories, names)).stocks;
}

/**
 * The rows, plus the trading day they belong to.
 *
 * The feed serves the last session's prices until the next one opens: before
 * 10:00, all weekend and through a holiday. `session.sessionDate` is the
 * exchange's own answer to "which day are these from?", so anything that
 * stores prices by date should take it from here rather than the clock.
 *
 * @returns {Promise<{stocks: Array<Object>, sessionDate: string|null}>}
 *   sessionDate is YYYY-MM-DD, or null when the feed didn't carry one.
 */
async function scrapePrices(categories = {}, names = {}) {
  const res = await fetch(URL, {
    headers: HEADERS,
    agent: dseAgent,
    timeout: 15000, // dsebd.org can accept the connection and never respond; don't hang forever
  });
  if (!res.ok) throw new Error(`DSE responded ${res.status}`);

  const body = await res.json();
  const cols = body && body.cols;
  const rows = body && body.rows;
  if (!Array.isArray(cols) || !Array.isArray(rows)) {
    throw new Error('scrapeStocks: unexpected payload — expected {cols, rows}');
  }

  // Address every field by name. The feed is positional, so reading it by
  // fixed index would silently mis-assign every price the day DSE inserts a
  // column — the exact class of bug that put YCP in the Open field for three
  // weeks under the old scraper.
  const at = {};
  cols.forEach((c, i) => { at[c] = i; });
  for (const required of ['code', 'ltp', 'ycp', 'open', 'high', 'low', 'close', 'volume', 'value', 'trades']) {
    if (at[required] === undefined) throw new Error(`scrapeStocks: feed is missing the '${required}' column`);
  }

  const stocks = [];
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const code = String(r[at.code] || '').toUpperCase();
    if (!code) continue;

    const ltp = num(r[at.ltp]);
    const ycp = num(r[at.ycp]);

    stocks.push({
      code,
      name:     names[code] || code,
      category: categories[code] || (at.category !== undefined ? String(r[at.category] || 'Z') : 'Z'),
      ltp,
      // The feed reports close as 0 until the session settles; the old table
      // behaved the same way and every consumer already treats 0 as "not closed
      // yet", so it is passed through rather than back-filled from ltp here.
      open:   num(r[at.open]),
      high:   num(r[at.high]),
      low:    num(r[at.low]),
      close:  num(r[at.close]),
      ycp,
      // DSE's own change column is last-traded minus yesterday's close.
      change: ycp ? Number((ltp - ycp).toFixed(4)) : 0,
      trade:  int(r[at.trades]), // number of transactions
      value:  num(r[at.value]),  // turnover, BDT millions
      volume: int(r[at.volume]), // shares traded
      sector: at.sector !== undefined ? String(r[at.sector] || '') : '',
    });
  }

  if (!stocks.length) {
    throw new Error('scrapeStocks: 0 rows parsed — the DSE feed structure may have changed');
  }
  const sessionDate = body.session && body.session.sessionDate;
  return {
    stocks,
    sessionDate: /^\d{4}-\d{2}-\d{2}$/.test(sessionDate || '') ? sessionDate : null,
  };
}

/**
 * Session state straight from the exchange, so callers never have to infer
 * "is the market open?" from a calendar they maintain themselves.
 *
 * @returns {Promise<{isOpen: boolean, tradeTime: string|null, indices: Array}>}
 */
async function fetchMarketState() {
  const res = await fetch(MARKET_URL, { headers: HEADERS, agent: dseAgent, timeout: 15000 });
  if (!res.ok) throw new Error(`DSE responded ${res.status}`);
  const body = await res.json();
  return {
    isOpen:    Boolean(body && body.session && body.session.isOpen),
    tradeTime: (body && body.totals && body.totals.tradeTime) || null,
    indices:   (body && body.indices) || [],
  };
}

module.exports = { scrapeStocks, scrapePrices, fetchMarketState, URL, MARKET_URL, dseAgent };
