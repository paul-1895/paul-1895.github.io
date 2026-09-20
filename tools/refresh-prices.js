#!/usr/bin/env node
'use strict';

/* Re-scrapes the DSE share price page and rewrites api/stocks.json in place.
   Run by .github/workflows/refresh-prices.yml on trading days. Deliberately
   the only moving part in the published repo. */

const fs   = require('fs');
const path = require('path');
const { scrapeStocks } = require('./dse-stocks');

const ROOT = path.join(__dirname, '..');

function categories() {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'stock-categories.json'), 'utf8'));
    return doc.categories || {};
  } catch {
    return {};
  }
}

(async () => {
  const stocks = await scrapeStocks(categories());

  // Refuse to overwrite a good file with a suspiciously short one — a partial
  // scrape is worse than yesterday's prices, because it looks current.
  const target = path.join(ROOT, 'api', 'stocks.json');
  if (fs.existsSync(target)) {
    try {
      const prev = JSON.parse(fs.readFileSync(target, 'utf8')).stocks || [];
      if (prev.length && stocks.length < prev.length * 0.8) {
        console.error(`refusing to write ${stocks.length} rows over ${prev.length} — looks like a partial scrape`);
        process.exit(1);
      }
    } catch { /* unreadable previous file: proceed */ }
  }

  fs.writeFileSync(target, JSON.stringify({
    stocks,
    timestamp: new Date().toISOString(),
    cached: false,
  }));
  console.log(`wrote ${stocks.length} rows to api/stocks.json`);
})().catch(err => { console.error(err.message); process.exit(1); });
