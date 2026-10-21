#!/usr/bin/env node
'use strict';

/* Re-fetches DSE's daily market snippet PDF and rewrites
   api/market-snippet.json in place. Run by refresh-prices.yml after the
   price scrape; needs pdftotext (poppler-utils) on PATH. */

const fs   = require('fs');
const path = require('path');
const { fetchSnippetPdf, parseSnippetPdf, envelope } = require('./dse-market-snippet');

const ROOT   = path.join(__dirname, '..');
const target = path.join(ROOT, 'api', 'market-snippet.json');

function previous() {
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return null; }
}

(async () => {
  const prev = previous();
  const res = await fetchSnippetPdf({ lastModified: prev && prev.lastModified });
  if (res.notModified) { console.log('market snippet unchanged'); return; }

  const snippet = await parseSnippetPdf(res.buffer);
  // An older session over a newer one would only ever be a DSE hiccup.
  if (prev && prev.snippet && prev.snippet.date > snippet.date) {
    console.error(`refusing to replace ${prev.snippet.date} with older ${snippet.date}`);
    process.exit(1);
  }
  // DSE's servers each stamp the same file with their own Last-Modified, so
  // a 304 is rare; an unchanged report is caught here instead, which keeps a
  // holiday re-run from committing a timestamp-only change.
  if (prev && JSON.stringify(prev.snippet) === JSON.stringify(snippet)) {
    console.log('market snippet unchanged'); return;
  }
  fs.writeFileSync(target, JSON.stringify(envelope({ snippet, lastModified: res.lastModified })));
  console.log(`wrote market snippet for ${snippet.date} to api/market-snippet.json`);
})().catch(err => { console.error(err.message); process.exit(1); });
