'use strict';

/* ═══════════════════════════════════════════════════════════════════
   DSE — SHARE PRICE SCRAPE
   Extracted from routes/scraper.js so that two callers can share it:

     • the live server, behind GET /api/stocks
     • the published site's refresh job, which runs on GitHub's
       schedule and commits the result as api/stocks.json

   Those two must agree on the row shape exactly — the static site
   reads a file the server never sees. Keeping one parser is what
   makes that true rather than hopeful.
   ═══════════════════════════════════════════════════════════════════ */

const https   = require('https');
const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const URL = 'https://www.dsebd.org/latest_share_price_scroll_l.php';

// dsebd.org serves a chain whose root CA is not in Node's bundle. Scoped to
// this one host rather than disabling verification globally.
const dseAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * @param {Object<string,string>} categories  code → category letter; pass {} if unknown.
 * @returns {Promise<Array<Object>>} one row per listed security
 */
async function scrapeStocks(categories = {}) {
  const res = await fetch(URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'text/html' },
    agent: dseAgent,
  });
  if (!res.ok) throw new Error(`DSE responded ${res.status}`);

  const $ = cheerio.load(await res.text());
  const stocks = [];

  // Header rows use <th>, so rows with fewer than 11 <td> cells (up through
  // VOLUME) are skipped automatically. Do NOT skip i===0 — that was
  // incorrectly dropping the first real stock row.
  $('table.table tr').each((_i, row) => {
    const cells = $(row).find('td');
    if (cells.length < 11) return;

    const text = idx => $(cells[idx]).text().trim();
    const num  = idx => parseFloat(text(idx).replace(/,/g, '')) || 0;
    const int  = idx => parseInt(text(idx).replace(/,/g, ''), 10) || 0;

    const codeCell = $(cells[1]);
    const linkEl   = codeCell.find('a').first();
    const code     = (linkEl.text().trim() || text(1)).toUpperCase();
    if (!code) return;

    stocks.push({
      code,
      name:     codeCell.attr('title') || linkEl.attr('title') || linkEl.attr('data-name') || code,
      category: categories[code] || 'Z',
      ltp:    num(2), high: num(3), low: num(4), close: num(5),
      ycp:    num(6), change: num(7),
      trade:  int(8),   // number of transactions
      value:  num(9),   // turnover, BDT millions
      volume: int(10),  // shares traded
    });
  });

  if (!stocks.length) {
    throw new Error('scrapeStocks: 0 rows parsed — the DSE page structure may have changed');
  }
  return stocks;
}

module.exports = { scrapeStocks, URL, dseAgent };
