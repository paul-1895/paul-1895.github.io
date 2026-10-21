'use strict';

/* ═══════════════════════════════════════════════════════════════════
   DSE — DAILY MARKET SNIPPET
   The exchange's own one-page end-of-day report, fetched as a PDF and
   turned into JSON. Two callers share this parser, like dse-stocks.js:

     • the live server, behind GET /api/market-snippet
       (routes/market-snippet.js — caching and the on-disk archive)
     • the published site's refresh job, which scripts/build-static.js
       copies this file into as tools/dse-market-snippet.js

   The URL never changes. DSE overwrites the file after every trading
   day (the 2026-10-08 report went up at ~09:17 UTC, about 45 minutes
   after the close), so which session a copy describes is read from
   the date printed inside it — never assumed from when it was
   fetched. A Friday fetch returns Thursday's report.

   old.dsebd.org is several servers behind one name, and each holds the
   same bytes under its own mtime: one minute's requests for the
   2026-10-08 report saw Last-Modified 09:17:33, 09:17:38 and 09:23:59.
   nginx answers If-Modified-Since only on an exact match, so a 304 is
   the exception here, and the header is not a version stamp. Callers
   decide "is this a new report?" by content (see sha1 below).

   Parsing works on word coordinates (pdftotext -tsv), not on -layout
   text. The page is two independent columns whose rows interleave —
   the 21-row sector table runs beside the top-turnover table and the
   two land on the same text lines with ragged spacing. Splitting the
   words at the column gutter first makes every table a clean run of
   rows. Needs poppler's pdftotext on PATH (brew install poppler /
   apt-get install poppler-utils).

   The DSEX MOVEMENT chart is an image in the PDF and is not extracted.
   ═══════════════════════════════════════════════════════════════════ */

const https = require('https');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fetch = require('node-fetch');

const URL = 'https://old.dsebd.org/assets/pdf/dse-daily-market-snippet.pdf';

// dsebd.org serves a chain whose root CA is not in Node's bundle; the old.
// host is no different. Scoped to this host rather than disabled globally.
const agent = new https.Agent({ rejectUnauthorized: false });

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Accept: 'application/pdf',
};

// Every table on page 1 sits wholly on one side of this x (points): the left
// column's last glyphs end by ~298, the right column's first start at ~301.
// Only the page title and the date line straddle it, and those are read off
// full-width rows before the split.
const COLUMN_SPLIT = 300;
// Words on one visual row differ in `top` by up to ~0.8pt between the two
// column grids; rows themselves are 10-14pt apart.
const ROW_TOLERANCE = 3;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

// ─── FETCH ────────────────────────────────────────────────────────────────────

/**
 * Conditional GET. Pass the validators from the last good copy; when the same
 * backend answers, an unchanged report costs a 304. Usually a different one
 * answers (see the header), so treat a 200 as "maybe new" and compare sha1.
 *
 * @returns {Promise<{notModified: true} | {buffer: Buffer, sha1: string, etag: string|null, lastModified: string|null}>}
 */
async function fetchSnippetPdf({ etag, lastModified } = {}) {
  const headers = { ...HEADERS };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  const res = await fetch(URL, {
    headers,
    agent,
    timeout: 20000, // dsebd.org can accept the connection and never respond
  });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`DSE responded ${res.status}`);

  const buffer = await res.buffer();
  // A missing file on dsebd.org can come back as an HTML error page; only the
  // magic bytes prove this is the report.
  if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('DSE returned something other than a PDF');
  }
  return {
    buffer,
    sha1: crypto.createHash('sha1').update(buffer).digest('hex'),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}

// ─── WORDS ────────────────────────────────────────────────────────────────────

function pdfWords(buffer) {
  return new Promise((resolve, reject) => {
    const child = execFile('pdftotext', ['-tsv', '-f', '1', '-l', '1', '-', '-'],
      { maxBuffer: 8 * 1024 * 1024, timeout: 20000 },
      (err, stdout) => {
        if (err && err.code === 'ENOENT') {
          return reject(new Error('pdftotext not found — install poppler (brew install poppler / apt-get install poppler-utils)'));
        }
        if (err) return reject(new Error(`pdftotext failed: ${err.message}`));

        const words = [];
        for (const line of stdout.split('\n')) {
          const f = line.split('\t');
          // level 5 = a word; the ###PAGE### / ###LINE### markers are levels 1-4.
          if (f[0] !== '5' || f.length < 12) continue;
          const text = f.slice(11).join('\t').trim();
          if (text) words.push({ x: Number(f[6]), y: Number(f[7]), text });
        }
        resolve(words);
      });
    child.stdin.on('error', () => { /* surfaced through the callback */ });
    child.stdin.end(buffer);
  });
}

// Words → rows of text, top to bottom, each row's words left to right.
function toRows(words) {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const w of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(w.y - row.y) <= ROW_TOLERANCE) row.words.push(w);
    else rows.push({ y: w.y, words: [w] });
  }
  return rows.map(r => r.words.sort((a, b) => a.x - b.x).map(w => w.text));
}

// ─── CELLS ────────────────────────────────────────────────────────────────────

const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?%?$/;

// "n/a" is a numeric slot with no value (P/E of a loss-maker), not a label word.
function isValue(tok) {
  return tok.toLowerCase() === 'n/a' || (NUMERIC.test(tok) && /\d/.test(tok));
}

function num(tok) {
  if (tok == null || tok.toLowerCase() === 'n/a') return null;
  const n = Number(tok.replace(/[,%+]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// A row as "label words, then values". Values must be the row's trailing run;
// a number inside the label (none today) would otherwise be read as data.
function splitRow(tokens) {
  let i = tokens.length;
  while (i > 0 && isValue(tokens[i - 1])) i--;
  return { label: tokens.slice(0, i).join(' '), values: tokens.slice(i).map(num) };
}

// "Total Turnover (BDTmn)" → { label: 'Total Turnover', unit: 'BDTmn' }
function labelAndUnit(text) {
  const m = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { label: m[1], unit: m[2] } : { label: text, unit: null };
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A ticker row: CODE, one-letter category, then nothing but values.
function tickerRow(tokens) {
  if (tokens.length < 3) return null;
  const [code, cat, ...rest] = tokens;
  if (!/^[A-Z0-9][A-Z0-9&.\-]*$/.test(code) || !/^[A-Z]$/.test(cat)) return null;
  if (!rest.every(isValue)) return null;
  return { code, category: cat, values: rest.map(num) };
}

// "Advanced Declined Unchanged Traded" over "171 150 64 385" → keyed by header.
// Reading by header rather than position means a reordered or added column
// lands in the right key or fails validation — never in the wrong key.
function zip(header, values) {
  if (!header || header.length !== values.length) return null;
  const out = {};
  header.forEach((h, i) => { out[slug(h)] = values[i]; });
  return out;
}

// ─── PARSE ────────────────────────────────────────────────────────────────────

const HEADINGS = {
  left: [
    [/^SECTORAL SUMMARY/i, 'sectors'],
    [/^TOP 10 GAINERS/i, 'gainers'],
    [/^CLIENT TYPE WISE/i, 'clients'],
  ],
  right: [
    [/^DSEX MOVEMENT/i, 'chart'],
    [/^TODAY'?S TOP 10 TURNOVER/i, 'turnover'],
    [/^TOP 10 LOSERS/i, 'losers'],
    [/^CATEGORY WISE/i, 'categories'],
  ],
};

function readDate(words) {
  for (const tokens of toRows(words)) {
    const m = tokens.join(' ')
      .match(/\b(?:Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/);
    if (!m) continue;
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) continue;
    return {
      date: `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      dateLabel: m[0],
    };
  }
  return null;
}

function parseLeft(rows, out) {
  let section = 'summary';
  let header = null;
  for (const tokens of rows) {
    const line = tokens.join(' ');
    const hit = HEADINGS.left.find(([re]) => re.test(line));
    if (hit) { section = hit[1]; header = null; continue; }

    const { label, values } = splitRow(tokens);

    if (section === 'summary') {
      if (!values.length) { header = tokens; continue; }
      // "Turnover (BDTmn)" has the same NAME (description) + 4 values shape as
      // an index row, so it is matched first and index codes must be capitals.
      const idx = label.match(/^([A-Z0-9]+)\s+\((.+)\)$/);
      if (/^Turnover\b/i.test(label)) {
        out.boardTurnover = zip(header, values);
      } else if (/^Market Breadth$/i.test(label)) {
        out.breadth = { ...out.breadth, ...zip(header, values) };
      } else if (/^Advance-to-Decline Ratio$/i.test(label) && values.length === 1) {
        out.breadth = { ...out.breadth, advanceDeclineRatio: values[0] };
      } else if (idx && values.length === 4) {
        const [today, yesterday, change, changePct] = values;
        out.indices.push({ code: idx[1], name: idx[2], today, yesterday, change, changePct });
      }
    } else if (section === 'sectors') {
      if (label && values.length === 5) {
        const [companies, today, yesterday, changePct, marketPct] = values;
        out.sectors.push({ sector: label, companies, today, yesterday, changePct, marketPct });
      }
    } else if (section === 'gainers') {
      const t = tickerRow(tokens);
      if (t && t.values.length === 4) out.gainers.push(moverRow(t));
    } else if (section === 'clients') {
      if (label && values.length === 3) {
        const [buyPct, salePct, totalPct] = values;
        out.clientTypes.push({ type: label, buyPct, salePct, totalPct });
      }
    }
  }
}

function parseRight(rows, out) {
  let section = 'summary';
  for (const tokens of rows) {
    const line = tokens.join(' ');
    const hit = HEADINGS.right.find(([re]) => re.test(line));
    if (hit) { section = hit[1]; continue; }

    if (section === 'summary') {
      const usd = line.match(/^1\s+USD\s*=\s*([\d.,]+)\s*BDT$/i);
      if (usd) { out.usdRate = num(usd[1]); continue; }
      const { label, values } = splitRow(tokens);
      if (!label || (values.length !== 2 && values.length !== 4)) continue;
      const { label: name, unit } = labelAndUnit(label);
      const [today, yesterday, change = null, changePct = null] = values;
      out.totals.push({ key: slug(label), label: name, unit, today, yesterday, change, changePct });
    } else if (section === 'turnover') {
      const t = tickerRow(tokens);
      if (t && t.values.length === 4) {
        const [close, turnover, pctOfTotal, pe] = t.values;
        out.topTurnover.push({ code: t.code, category: t.category, close, turnover, pctOfTotal, pe });
      }
    } else if (section === 'losers') {
      const t = tickerRow(tokens);
      if (t && t.values.length === 4) out.losers.push(moverRow(t));
    } else if (section === 'categories') {
      const { label, values } = splitRow(tokens);
      if (/^[A-Z]$/.test(label) && values.length === 3) {
        const [trades, value, pct] = values;
        out.categories.push({ category: label, trades, value, pct });
      }
    }
  }
}

function moverRow(t) {
  const [close, ycp, changePct, pe] = t.values;
  return { code: t.code, category: t.category, close, ycp, changePct, pe };
}

/**
 * Word list (as pdfWords returns it) → the report as JSON. Separate from the
 * PDF step so it can be exercised without poppler.
 */
function parseSnippetWords(words) {
  const when = readDate(words);
  const out = {
    date: when ? when.date : null,
    dateLabel: when ? when.dateLabel : null,
    indices: [],
    totals: [],
    breadth: null,
    boardTurnover: null,
    usdRate: null,
    sectors: [],
    topTurnover: [],
    gainers: [],
    losers: [],
    clientTypes: [],
    categories: [],
  };

  parseLeft(toRows(words.filter(w => w.x < COLUMN_SPLIT)), out);
  parseRight(toRows(words.filter(w => w.x >= COLUMN_SPLIT)), out);

  // Fail loudly rather than serve a half-read report as if it were whole —
  // a layout change should surface as an error, not as empty cards.
  const missing = [];
  if (!out.date) missing.push('report date');
  if (!out.indices.some(i => i.code === 'DSEX')) missing.push('DSEX index row');
  if (!out.totals.length) missing.push('market totals');
  if (!out.breadth || out.breadth.advanced == null) missing.push('market breadth');
  if (out.sectors.length < 10) missing.push(`sectors (got ${out.sectors.length})`);
  if (!out.topTurnover.length) missing.push('top turnover');
  if (!out.gainers.length && !out.losers.length) missing.push('gainers/losers');
  if (missing.length) {
    throw new Error(`market snippet layout not recognised — missing ${missing.join(', ')}`);
  }
  return out;
}

async function parseSnippetPdf(buffer) {
  return parseSnippetWords(await pdfWords(buffer));
}

/**
 * The JSON both callers serve — GET /api/market-snippet and the published
 * site's api/market-snippet.json — so the page reads one shape from either.
 */
function envelope({ snippet, lastModified, checkedAt }, extra = {}) {
  return {
    snippet,
    source: URL,
    lastModified: lastModified || null,
    checkedAt: new Date(checkedAt || Date.now()).toISOString(),
    ...extra,
  };
}

module.exports = { URL, fetchSnippetPdf, parseSnippetPdf, parseSnippetWords, pdfWords, envelope };
