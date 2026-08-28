#!/usr/bin/env node
'use strict';

/* Re-scrapes the DSE share price page and rewrites api/stocks.json in place.
   Run by .github/workflows/refresh-prices.yml on trading days.

   If the site was published with a password, api/stocks.json is ciphertext
   like everything else — so this has to unseal the previous file to compare
   against it, and re-seal the new one. Writing plaintext over ciphertext
   would both publish the prices in the clear and break the page, because the
   browser would try to decrypt JSON. */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { scrapeStocks } = require('./dse-stocks');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'api', 'stocks.json');

function categories() {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'stock-categories.json'), 'utf8'));
    return doc.categories || {};
  } catch {
    return {};   // encrypted or absent: every stock just falls back to category Z
  }
}

// Returns null for an unsealed site, which is a valid way to publish.
function siteKey() {
  let gate;
  try {
    gate = JSON.parse(fs.readFileSync(path.join(ROOT, 'gate.json'), 'utf8'));
  } catch {
    return null;
  }
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    console.error('This site is password-protected but SITE_PASSWORD is not set.');
    console.error('Add it as a repository secret, or the refresh would publish prices in the clear.');
    process.exit(1);
  }
  return crypto.pbkdf2Sync(password, Buffer.from(gate.salt, 'base64'), gate.iterations, 32, 'sha256');
}

function seal(plain, key) {
  const iv = crypto.randomBytes(12);
  const c  = crypto.createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}

function unseal(blob, key) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]);
}

function previousCount(key) {
  try {
    const raw = fs.readFileSync(TARGET);
    const text = key ? unseal(raw, key) : raw;
    return (JSON.parse(text).stocks || []).length;
  } catch {
    return 0;   // unreadable previous file: nothing to compare against
  }
}

(async () => {
  const key    = siteKey();
  const stocks = await scrapeStocks(categories());

  // A partial scrape is worse than yesterday's prices, because it looks
  // current. This check only works because the previous file is unsealed
  // above — reading it raw would throw and skip the guard entirely.
  const before = previousCount(key);
  if (before && stocks.length < before * 0.8) {
    console.error(`refusing to write ${stocks.length} rows over ${before} — looks like a partial scrape`);
    process.exit(1);
  }

  const body = Buffer.from(JSON.stringify({
    stocks, timestamp: new Date().toISOString(), cached: false,
  }), 'utf8');

  fs.writeFileSync(TARGET, key ? seal(body, key) : body);
  console.log(`wrote ${stocks.length} rows to api/stocks.json${key ? ' (sealed)' : ''}`);
})().catch(err => { console.error(err.message); process.exit(1); });
