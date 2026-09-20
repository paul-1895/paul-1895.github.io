import { initTheme, toggleTheme } from '../theme/theme.js';

initTheme();
document.getElementById('theme-toggle-btn').addEventListener('click', () => toggleTheme());

/* ════════════════════════════════════════════════════════════
   what-if.js
   "If I had bought this stock..." calculator. Loads a ticker's
   daily candle history (historical_prices/json_files/{code}.json,
   the same files the candlestick chart and trade-analysis modal
   use), the app's own cash-dividend-history text blob (data/
   dividends.json), and its stock-dividend history from the live
   DSE company page (/api/company-details/:code — the same source
   the Fundamentals page reads), then simulates buying on a chosen
   date and holding to the latest available session: bonus shares
   from stock dividends are added automatically (they aren't a
   reinvestment choice), and cash dividends are reinvested net of
   a 15% tax.
   ════════════════════════════════════════════════════════════ */

const FACE_VALUE = 10; // BDT — standard DSE face value used to turn a dividend % into a per-share amount
const TAX_RATE = 0.15; // cash dividend tax, per the brief
const COMMISSION_RATE = 0.004; // buy-side brokerage commission, charged on every share purchase

const fmtMoney = (v) => (v == null || isNaN(v)) ? '—' : '৳' + Math.round(v).toLocaleString('en-US');
const fmtMoney2 = (v) => (v == null || isNaN(v)) ? '—' : '৳' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v) => (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const fmtDate = (d) => d ? `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` : '—';

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ─── Company names + logos (for the stock picker, and resolving free-text input) ──
let namesMap = {};   // TICKER -> company name
let logoMap = {};    // TICKER -> avatar image URL
let tickerList = []; // [{code, name}], built once namesMap is loaded

async function loadPickerData() {
  const [namesResult, logosResult] = await Promise.allSettled([
    fetch('/api/company-names').then(r => r.json()),
    fetch('/data/stock-logos.json').then(r => r.json()),
  ]);
  namesMap = (namesResult.status === 'fulfilled' && namesResult.value.names) || {};
  logoMap = (logosResult.status === 'fulfilled' && logosResult.value) || {};
  if (window.DSEBankLogos) window.DSEBankLogos.applyOverrides(logoMap);
  tickerList = Object.keys(namesMap).sort().map(code => ({ code, name: namesMap[code] || code }));
}

function resolveTicker(raw) {
  const input = String(raw || '').trim();
  if (!input) return null;
  const upper = input.toUpperCase();
  if (namesMap[upper]) return upper;
  // "TICKER — Company Name" (in case a picker selection got typed back in)
  const dashMatch = input.split(/[—-]/)[0].trim().toUpperCase();
  if (dashMatch && namesMap[dashMatch]) return dashMatch;
  // Free-text company-name search.
  const needle = input.toLowerCase();
  const hit = Object.keys(namesMap).find(code => (namesMap[code] || '').toLowerCase().includes(needle));
  return hit || null;
}

// ─── Stock picker (searchable combobox) ──────────────────────────
const PICKER_MAX_RESULTS = 40;

// Ranks matches so exact/prefix ticker hits float to the top, then
// word-start company-name hits, then any other substring hit anywhere.
function scoreTickerMatch(query, item) {
  const q = query.toUpperCase();
  const code = item.code.toUpperCase();
  const name = item.name.toUpperCase();
  if (code === q) return 100;
  if (code.startsWith(q)) return 90;
  if (name.split(/[^A-Z0-9]+/).some(w => w.startsWith(q))) return 70;
  if (code.includes(q)) return 60;
  if (name.includes(q)) return 40;
  return -1;
}

function filterTickers(query) {
  const q = query.trim();
  if (!q) return [];
  return tickerList
    .map(item => ({ item, score: scoreTickerMatch(q, item) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code))
    .slice(0, PICKER_MAX_RESULTS)
    .map(s => s.item);
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const idx = text.toUpperCase().indexOf(query.toUpperCase());
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' + escapeHtml(text.slice(idx + query.length));
}

function avatarHtml(code) {
  const initials = escapeHtml(code.slice(0, 2));
  const url = logoMap[code];
  return url
    ? `<img class="wi-combo-avatar" src="${escapeHtml(url)}" alt="" data-fallback="${initials}">`
    : `<span class="wi-combo-avatar-fallback">${initials}</span>`;
}

function wireAvatarFallbacks(panel) {
  panel.querySelectorAll('img.wi-combo-avatar').forEach(img => {
    img.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'wi-combo-avatar-fallback';
      span.textContent = img.dataset.fallback;
      img.replaceWith(span);
    }, { once: true });
  });
}

// Builds a searchable stock combobox inside `root` (an element containing
// .wi-combo-input, .wi-combo-panel, .wi-combo-clear and — optionally — a
// .wi-ticker-hint). Each instance keeps its own match/selection state in a
// closure, so the same markup shape can be wired up any number of times —
// once for the single-stock field, once per Custom ETF basket row.
function createStockCombo(root) {
  const input = root.querySelector('.wi-combo-input');
  const panel = root.querySelector('.wi-combo-panel');
  const clearBtn = root.querySelector('.wi-combo-clear');
  const hint = root.querySelector('.wi-ticker-hint');

  let options = [];
  let activeIndex = -1;
  let isOpen = false;

  function renderPanel(query) {
    options = filterTickers(query);
    activeIndex = options.length ? 0 : -1;

    if (!query.trim()) {
      panel.innerHTML = `<div class="wi-combo-empty">Type a ticker or company name to search ${tickerList.length} listed stocks…</div>`;
    } else if (!options.length) {
      panel.innerHTML = `<div class="wi-combo-empty">No stock matches "${escapeHtml(query)}"</div>`;
    } else {
      panel.innerHTML = options.map((item, i) => `
        <div class="wi-combo-option${i === 0 ? ' active' : ''}" role="option" data-code="${escapeHtml(item.code)}" data-index="${i}">
          ${avatarHtml(item.code)}
          <div class="wi-combo-text">
            <div class="wi-combo-code">${highlightMatch(item.code, query)}</div>
            <div class="wi-combo-name">${highlightMatch(item.name, query)}</div>
          </div>
        </div>
      `).join('');
      wireAvatarFallbacks(panel);
    }
  }

  function highlightActiveOption() {
    panel.querySelectorAll('.wi-combo-option').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.index) === activeIndex);
    });
    const activeEl = panel.querySelector('.wi-combo-option.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    isOpen = true;
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    isOpen = false;
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  function updateHint() {
    if (!hint) return;
    const code = resolveTicker(input.value);
    if (!input.value.trim()) { hint.textContent = ''; hint.className = 'wi-ticker-hint'; return; }
    if (code) { hint.textContent = `${code} — ${namesMap[code]}`; hint.className = 'wi-ticker-hint ok'; }
    else { hint.textContent = 'Stock not found'; hint.className = 'wi-ticker-hint err'; }
  }

  function select(code) {
    input.value = code;
    clearBtn.hidden = false;
    updateHint();
    close();
  }

  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    renderPanel(input.value);
    open();
    updateHint();
  });

  input.addEventListener('focus', () => {
    renderPanel(input.value);
    open();
  });

  input.addEventListener('blur', () => {
    setTimeout(close, 120); // gives a panel mousedown time to register first
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { open(); renderPanel(input.value); }
      if (options.length) {
        activeIndex = (activeIndex + 1) % options.length;
        highlightActiveOption();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length) {
        activeIndex = (activeIndex - 1 + options.length) % options.length;
        highlightActiveOption();
      }
    } else if (e.key === 'Enter') {
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        e.preventDefault();
        select(options[activeIndex].code);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    updateHint();
    renderPanel('');
    input.focus();
  });

  // mousedown (not click) + preventDefault so the input never blurs before
  // the selection is read — a plain click would close the panel via blur first.
  panel.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.wi-combo-option');
    if (!opt) return;
    e.preventDefault();
    select(opt.dataset.code);
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) close();
  });

  return {
    inputEl: input,
    getCode: () => resolveTicker(input.value),
    setValue: (code) => select(code),
  };
}

function initStockPicker() {
  createStockCombo(document.getElementById('wi-combo'));
}

// ─── Price history ──────────────────────────────────────────────
function parseCandleDate(str) {
  const m = String(str).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

const _candleCache = new Map(); // code -> Promise<candles ascending by date>

function loadCandles(code) {
  if (_candleCache.has(code)) return _candleCache.get(code);
  const p = fetch(`/historical_prices/json_files/${encodeURIComponent(code)}.json`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(raw => {
      const rows = (Array.isArray(raw) ? raw : [])
        .map(c => ({ ...c, _date: parseCandleDate(c.Date) }))
        .filter(c => c._date && c.Close > 0 && c.Open > 0 && c.High > 0 && c.Low > 0);
      rows.sort((a, b) => a._date - b._date);
      return rows;
    });
  _candleCache.set(code, p);
  return p;
}

function findIndexOnOrAfter(candles, target) {
  for (let i = 0; i < candles.length; i++) {
    if (candles[i]._date >= target) return i;
  }
  return -1;
}

// candles are sorted ascending, so the last date <= target is found by
// walking forward and remembering the latest match before overshooting.
function findIndexOnOrBefore(candles, target) {
  let result = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candles[i]._date <= target) result = i;
    else break;
  }
  return result;
}

// ─── Dividend history ───────────────────────────────────────────
// data/dividends.json stores each ticker's disclosed cash-dividend history
// as one free-text blob, e.g. "25% 2025, 20% 2024, 40% 2023...", scraped
// from DSE listing pages with inconsistent punctuation (some rows carry
// "(Profit Rate)" for mutual funds, trailing periods, missing commas
// between concatenated entries, etc). This pulls every (percent, year)
// pair out regardless of the separator between them, and sums percentages
// that land on the same year (a handful of tickers disclose top-up/final
// dividends for one year as separate entries).
const DIV_PAIR_RE = /(\d+(?:\.\d+)?)\s*%?[^0-9%]{0,30}?(\d{4})/g;

function parseDividendString(raw) {
  const byYear = new Map();
  if (!raw) return byYear;
  let m;
  DIV_PAIR_RE.lastIndex = 0;
  while ((m = DIV_PAIR_RE.exec(raw))) {
    const pct = parseFloat(m[1]);
    const year = parseInt(m[2], 10);
    if (!isFinite(pct) || !isFinite(year) || year < 1980 || year > 2100) continue;
    byYear.set(year, (byYear.get(year) || 0) + pct);
  }
  return byYear;
}

let _dividendsPromise = null;
function loadDividends() {
  if (!_dividendsPromise) {
    _dividendsPromise = fetch('/data/dividends.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .catch(() => ({}));
  }
  return _dividendsPromise;
}

// Stock (bonus-share) dividend history isn't in any static file — it only
// lives on each company's live DSE listing page, same source and same
// comma-separated "10% 2025, 5% 2024, ..." format the Fundamentals page
// reads via /api/company-details/:code. Fetched per-ticker on demand (not
// preloaded for all 636 tickers) since it's a live scrape, not a static file.
const _companyDetailsCache = new Map(); // code -> Promise<details|null>
function loadCompanyDetails(code) {
  if (!_companyDetailsCache.has(code)) {
    const p = fetch(`/api/company-details/${encodeURIComponent(code)}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
    _companyDetailsCache.set(code, p);
  }
  return _companyDetailsCache.get(code);
}

// ─── Simulation ─────────────────────────────────────────────────
// Shares trade in whole units only — DSE has no fractional-share market —
// so every purchase (the initial buy and each dividend reinvestment) floors
// to the nearest whole share, and pays a 0.4% buy commission on top of the
// share price. Cash left over because it couldn't buy another whole share
// (net of commission) isn't lost: it sits idle and rolls into the next
// reinvestment, same as it would in a real brokerage account. Average cost
// per share is tracked as a running total-cost-basis / shares-held figure,
// so it blends every lot (the initial buy plus each reinvestment) at its
// own price and commission — bonus shares add 0 to the cost basis, which
// correctly dilutes the average.
// Cash and stock dividends for a year apply together, in ascending year
// order, at the first trading session on/after 1 July of that year:
// bonus shares (stock dividend) are added first — they aren't a
// reinvestment choice, they just arrive — based on shares held going into
// that date, and the cash dividend for the same date is computed off that
// same pre-bonus share count (both entitlements share one record date).
// Returns the share/cash trajectory as row-by-row detail plus the ending
// totals.
// `amount` (single-stock mode) derives the initial share count from a BDT
// budget; `initialShares` (Custom ETF mode) takes a share count directly, as
// chosen per basket constituent. `endIdx` bounds both the valuation price and
// which dividend years are still reinvestable — it defaults to the latest
// candle (single-stock's "hold to today"), but a Custom ETF time frame can
// cap it to an earlier session.
function simulate({ candles, buyIdx, dividendsByYear, stockDividendsByYear, latestClose, amount, initialShares, endIdx }) {
  const buyDate = candles[buyIdx]._date;
  const buyPrice = candles[buyIdx].Close;
  const initialCostPerShare = buyPrice * (1 + COMMISSION_RATE);
  const boundIdx = endIdx != null ? endIdx : candles.length - 1;
  const endPrice = latestClose != null ? latestClose : candles[boundIdx].Close;

  const startShares = initialShares != null ? initialShares : Math.floor(amount / initialCostPerShare);
  const initialLeftoverCash = initialShares != null ? 0 : (amount - startShares * initialCostPerShare);

  const allYears = new Set([...dividendsByYear.keys(), ...stockDividendsByYear.keys()]);
  const years = Array.from(allYears).filter(y => y >= buyDate.getFullYear()).sort((a, b) => a - b);

  let shares = startShares;
  let cash = initialLeftoverCash;
  let costBasis = startShares * initialCostPerShare;
  const rows = [];

  for (const year of years) {
    const cashPct = dividendsByYear.get(year) || 0;
    const stockPct = stockDividendsByYear.get(year) || 0;
    const target = new Date(year, 6, 1); // 1 July — approximated payment date, see UI note
    if (target < buyDate) continue;
    const idx = findIndexOnOrAfter(candles, target);
    if (idx === -1 || idx > boundIdx) continue; // beyond the data, or beyond the chosen end of the time frame

    const sharesBefore = shares;
    const bonusShares = Math.floor(sharesBefore * stockPct / 100);
    shares += bonusShares;

    const perShare = (cashPct / 100) * FACE_VALUE;
    const gross = sharesBefore * perShare;
    const tax = gross * TAX_RATE;
    const net = gross - tax;
    const reinvestPrice = candles[idx].Close;
    const costPerShare = reinvestPrice * (1 + COMMISSION_RATE);
    const available = net + cash;
    const bought = Math.floor(available / costPerShare);
    const spent = bought * costPerShare;
    shares += bought;
    cash = available - spent;
    costBasis += spent;

    rows.push({
      year, cashPct, stockPct, perShare, sharesBefore, bonusShares, gross, tax, net,
      reinvestDate: candles[idx]._date, reinvestPrice, bought,
      avgCost: shares > 0 ? costBasis / shares : null,
    });
  }

  return {
    buyDate, buyPrice, initialCostPerShare, initialShares: startShares, initialLeftoverCash,
    finalSharesDrip: shares, finalCashDrip: cash,
    finalAvgCostDrip: shares > 0 ? costBasis / shares : null,
    rows, latestClose: endPrice,
  };
}

// ─── Rendering ──────────────────────────────────────────────────
function renderError(msg, id = 'wi-error') {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) { el.classList.remove('show'); el.textContent = ''; return; }
  el.textContent = msg;
  el.classList.add('show');
}

function renderResults({ code, name, amount, buyDate, sim }) {
  const results = document.getElementById('wi-results');

  // The price-only scenario gets no dividends at all (cash or stock) — a
  // clean "what if this stock paid nothing" baseline for comparison.
  const priceOnlyValue = sim.initialShares * sim.latestClose + sim.initialLeftoverCash;
  const dripValue = sim.finalSharesDrip * sim.latestClose + sim.finalCashDrip;
  const totalNetDividends = sim.rows.reduce((s, r) => s + r.net, 0);
  const totalBonusShares = sim.rows.reduce((s, r) => s + r.bonusShares, 0);

  const years = Math.max((new Date() - buyDate) / (365.25 * 86400000), 1 / 365.25);
  const returnPctPriceOnly = (priceOnlyValue / amount - 1) * 100;
  const returnPctDrip = (dripValue / amount - 1) * 100;
  const cagrPriceOnly = (Math.pow(priceOnlyValue / amount, 1 / years) - 1) * 100;
  const cagrDrip = (Math.pow(dripValue / amount, 1 / years) - 1) * 100;
  const signClass = (v) => (v >= 0 ? 'pos' : 'neg');

  const maxBar = Math.max(priceOnlyValue, dripValue, 1);
  const barHeight = (v) => Math.max(4, Math.round((v / maxBar) * 160));

  results.innerHTML = `
    <div class="calc-summary-row">
      <div class="calc-summary-card principal">
        <div class="calc-summary-label">${escapeHtml(name)} (${escapeHtml(code)}) — Shares Bought</div>
        <div class="calc-summary-value">${sim.initialShares.toLocaleString('en-US')}</div>
        <div class="calc-summary-sub">${fmtMoney2(sim.buyPrice)} + 0.4% commission = ${fmtMoney2(sim.initialCostPerShare)} avg cost, on ${fmtDate(buyDate)}${sim.initialLeftoverCash >= 0.01 ? ` &middot; ${fmtMoney2(sim.initialLeftoverCash)} left uninvested` : ''}</div>
      </div>
      <div class="calc-summary-card holdings">
        <div class="calc-summary-label">Holdings Today</div>
        <div class="calc-summary-value">${sim.finalSharesDrip.toLocaleString('en-US')} shares</div>
        <div class="calc-summary-sub">${sim.finalAvgCostDrip != null ? `avg cost ${fmtMoney2(sim.finalAvgCostDrip)} vs ${fmtMoney2(sim.latestClose)} now` : '—'}${totalBonusShares > 0 ? ` &middot; ${totalBonusShares.toLocaleString('en-US')} bonus shares` : ''}${sim.finalCashDrip >= 0.01 ? ` &middot; ${fmtMoney2(sim.finalCashDrip)} idle cash` : ''}</div>
      </div>
      <div class="calc-summary-card dividends">
        <div class="calc-summary-label">Net Dividends Reinvested</div>
        <div class="calc-summary-value">${fmtMoney(totalNetDividends)}</div>
        <div class="calc-summary-sub">${sim.rows.length} payout${sim.rows.length === 1 ? '' : 's'}, after 15% tax</div>
      </div>
      <div class="calc-summary-card returnpct">
        <div class="calc-summary-label">Total Return</div>
        <div class="calc-summary-value ${signClass(returnPctDrip)}">${fmtPct(returnPctDrip)}</div>
        <div class="calc-summary-sub">${fmtPct(returnPctPriceOnly)} price-only &middot; ${fmtPct(cagrDrip)}/yr CAGR</div>
      </div>
      <div class="calc-summary-card priceonly">
        <div class="calc-summary-label">Value Today — Price Only</div>
        <div class="calc-summary-value">${fmtMoney(priceOnlyValue)}</div>
        <div class="calc-summary-sub ${signClass(returnPctPriceOnly)}">${fmtPct(returnPctPriceOnly)} &middot; ${fmtPct(cagrPriceOnly)}/yr CAGR</div>
      </div>
      <div class="calc-summary-card total">
        <div class="calc-summary-label">Value Today — With Dividends Reinvested</div>
        <div class="calc-summary-value">${fmtMoney(dripValue)}</div>
        <div class="calc-summary-sub ${signClass(returnPctDrip)}">${fmtPct(returnPctDrip)} &middot; ${fmtPct(cagrDrip)}/yr CAGR</div>
      </div>
    </div>

    <div class="calc-chart-card">
      <div class="calc-chart-hd">
        <span class="calc-chart-title">Price-only vs. dividends reinvested</span>
        <div class="calc-chart-legend">
          <span class="calc-legend-item"><span class="calc-legend-dot priceonly"></span>Price only</span>
          <span class="calc-legend-item"><span class="calc-legend-dot total"></span>With dividends</span>
        </div>
      </div>
      <div class="wi-bars-wrap">
        <div class="wi-bar-col">
          <div class="wi-bar-val">${fmtMoney(priceOnlyValue)}</div>
          <div class="wi-bar-fill priceonly" style="height:${barHeight(priceOnlyValue)}px"></div>
        </div>
        <div class="wi-bar-col">
          <div class="wi-bar-val">${fmtMoney(dripValue)}</div>
          <div class="wi-bar-fill total" style="height:${barHeight(dripValue)}px"></div>
        </div>
      </div>
      <div class="wi-bars-labels">
        <div class="wi-bar-label">Price only</div>
        <div class="wi-bar-label">With dividends</div>
      </div>
    </div>

    <div class="calc-table-card">
      <div class="calc-table-hd">Dividend Reinvestment Detail</div>
      <div class="calc-table-scroll">${dividendDetailTableHtml(sim.rows)}</div>
    </div>
  `;
}

// Shared by the single-stock "Dividend Reinvestment Detail" table and the
// Custom ETF per-stock detail modal — both show the same year-by-year rows
// a simulate() call produces.
function dividendDetailTableHtml(rows) {
  if (!rows.length) {
    return `<div class="calc-table-empty">No dividends were disclosed for this stock over the holding period.</div>`;
  }
  const tableRows = rows.map(r => `
    <tr>
      <td>${r.year}</td>
      <td>${r.cashPct.toFixed(2)}%</td>
      <td>${r.stockPct.toFixed(2)}%</td>
      <td>${r.bonusShares.toLocaleString('en-US')}</td>
      <td>${fmtMoney2(r.perShare)}</td>
      <td>${r.sharesBefore.toLocaleString('en-US')}</td>
      <td>${fmtMoney2(r.gross)}</td>
      <td>${fmtMoney2(r.tax)}</td>
      <td>${fmtMoney2(r.net)}</td>
      <td>${fmtDate(r.reinvestDate)} @ ${r.reinvestPrice.toFixed(2)}</td>
      <td>${r.bought.toLocaleString('en-US')}</td>
      <td>${fmtMoney2(r.avgCost)}</td>
    </tr>
  `).join('');
  return `
    <table class="calc-table">
      <thead>
        <tr>
          <th>Year</th><th>Cash Div %</th><th>Stock Div %</th><th>Bonus Shares</th><th>Cash Div/Share</th><th>Shares Held</th><th>Gross Cash</th><th>Tax (15%)</th><th>Net Reinvested</th><th>Reinvested</th><th>New Shares</th><th>Avg Cost</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
}

// ─── Custom ETF (multi-stock basket) ─────────────────────────────
// A basket is just N independent single-stock simulations sharing a start
// date and, optionally, an end date — run through the same simulate() core
// with a directly-chosen share count instead of a BDT amount — then summed.
let etfRowSeq = 0;
const etfRows = []; // [{ id, rowEl, combo, sharesInput }]

function etfRowTemplate(id) {
  return `
    <div class="wi-etf-row" data-row-id="${id}">
      <div class="wi-combo">
        <div class="wi-combo-input-wrap">
          <svg class="wi-combo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" class="wi-combo-input" placeholder="Search ticker or company…" autocomplete="off"
                 role="combobox" aria-expanded="false" aria-autocomplete="list" />
          <button type="button" class="wi-combo-clear" aria-label="Clear stock" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="wi-combo-panel" role="listbox" hidden></div>
        <div class="wi-ticker-hint"></div>
      </div>
      <div class="wi-etf-shares">
        <input type="number" class="wi-etf-shares-input" placeholder="Shares" min="1" step="1" />
      </div>
      <button type="button" class="wi-etf-remove" aria-label="Remove stock">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `;
}

function updateEtfCount() {
  const el = document.getElementById('wi-etf-count');
  el.textContent = `${etfRows.length} stock${etfRows.length === 1 ? '' : 's'}`;
}

function removeEtfRow(id) {
  const idx = etfRows.findIndex(r => r.id === id);
  if (idx === -1) return;
  etfRows[idx].rowEl.remove();
  etfRows.splice(idx, 1);
  updateEtfCount();
}

function addEtfRow() {
  const id = ++etfRowSeq;
  const container = document.getElementById('wi-etf-rows');
  container.insertAdjacentHTML('beforeend', etfRowTemplate(id));
  const rowEl = container.querySelector(`[data-row-id="${id}"]`);
  const combo = createStockCombo(rowEl.querySelector('.wi-combo'));
  const sharesInput = rowEl.querySelector('.wi-etf-shares-input');
  rowEl.querySelector('.wi-etf-remove').addEventListener('click', () => removeEtfRow(id));
  etfRows.push({ id, rowEl, combo, sharesInput });
  updateEtfCount();
}

function clearEtfRows() {
  [...etfRows].forEach(r => removeEtfRow(r.id));
}

function initEtfPresets() {
  document.getElementById('wi-etf-presets').addEventListener('click', (e) => {
    const btn = e.target.closest('.wi-preset-btn');
    if (!btn) return;
    document.querySelectorAll('#wi-etf-presets .wi-preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const years = Number(btn.dataset.years);
    document.getElementById('wi-etf-end').value = '';
    const startInput = document.getElementById('wi-etf-start');
    if (years > 0) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - years);
      startInput.value = d.toISOString().slice(0, 10);
    } else {
      startInput.value = '2000-01-01'; // "Max" — clamped per-ticker to its first available session
    }
  });
}

// ─── Saved Custom ETF baskets ─────────────────────────────────────
// Server file is the source of truth (data/whatif-baskets.json via
// /api/what-if-baskets), with a localStorage mirror so baskets survive
// offline use or a static export with no backend — same pattern as the
// Task Board (tasks/tasks.js).
const WI_BASKETS_STORAGE_KEY = 'dse_whatif_baskets';
const WI_BASKETS_API_URL = '/api/what-if-baskets';

let savedBaskets = [];

function loadBasketsLocal() {
  try {
    const raw = localStorage.getItem(WI_BASKETS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.baskets)) return parsed.baskets;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveBasketsToServer(baskets) {
  fetch(WI_BASKETS_API_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baskets }),
  }).catch(e => console.warn('[what-if] could not reach /api/what-if-baskets — kept in localStorage only', e));
}

function persistBaskets(baskets) {
  savedBaskets = baskets;
  localStorage.setItem(WI_BASKETS_STORAGE_KEY, JSON.stringify({ baskets }));
  saveBasketsToServer(baskets);
}

async function loadSavedBaskets() {
  const local = loadBasketsLocal();
  try {
    const res = await fetch(WI_BASKETS_API_URL);
    if (res.ok) {
      const server = await res.json();
      const serverBaskets = Array.isArray(server.baskets) ? server.baskets : [];
      // First load after this feature shipped: server has nothing yet, but
      // this browser already saved baskets locally — push them up once
      // rather than showing an empty list.
      if (!serverBaskets.length && local && local.length) {
        saveBasketsToServer(local);
        return local;
      }
      return serverBaskets;
    }
  } catch (e) { /* server unreachable */ }
  return local || [];
}

function renderSavedBasketsList() {
  const el = document.getElementById('wi-saved-baskets');
  if (!savedBaskets.length) {
    el.innerHTML = '<div class="wi-saved-empty">No saved baskets yet — build one below, name it, and hit Save.</div>';
    return;
  }
  el.innerHTML = savedBaskets.map(b => `
    <div class="wi-saved-basket">
      <button type="button" class="wi-saved-basket-load" data-basket-id="${escapeHtml(b.id)}">
        <span class="wi-saved-basket-name">${escapeHtml(b.name)}</span>
        <span class="wi-saved-basket-meta">${b.constituents.length} stock${b.constituents.length === 1 ? '' : 's'}</span>
      </button>
      <button type="button" class="wi-saved-basket-delete" data-basket-id="${escapeHtml(b.id)}" aria-label="Delete ${escapeHtml(b.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  `).join('');
}

function loadBasketIntoForm(id) {
  const basket = savedBaskets.find(b => b.id === id);
  if (!basket) return;

  clearEtfRows();
  basket.constituents.forEach(c => {
    addEtfRow();
    const row = etfRows[etfRows.length - 1];
    row.combo.setValue(c.code);
    row.sharesInput.value = c.shares;
  });
  if (!etfRows.length) { addEtfRow(); addEtfRow(); }

  document.getElementById('wi-etf-start').value = basket.startDate || '2020-01-01';
  document.getElementById('wi-etf-end').value = basket.endDate || '';
  document.getElementById('wi-basket-name').value = basket.name;
  document.querySelectorAll('#wi-etf-presets .wi-preset-btn').forEach(b => b.classList.remove('active'));
  renderError(null, 'wi-etf-error');
}

function deleteSavedBasket(id) {
  persistBaskets(savedBaskets.filter(b => b.id !== id));
  renderSavedBasketsList();
}

function handleSaveBasketClick() {
  renderError(null, 'wi-etf-error');
  const nameInput = document.getElementById('wi-basket-name');
  const name = nameInput.value.trim();
  if (!name) { renderError('Name this basket before saving.', 'wi-etf-error'); return; }

  const { constituents, error } = collectEtfConstituents();
  if (error) { renderError(error, 'wi-etf-error'); return; }

  const basket = {
    id: String(Date.now()),
    name,
    constituents,
    startDate: document.getElementById('wi-etf-start').value || null,
    endDate: document.getElementById('wi-etf-end').value || null,
    createdAt: new Date().toISOString(),
  };
  persistBaskets([...savedBaskets, basket]);
  renderSavedBasketsList();
  nameInput.value = '';
}

function initSavedBaskets() {
  document.getElementById('wi-basket-save-btn').addEventListener('click', handleSaveBasketClick);
  document.getElementById('wi-basket-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSaveBasketClick(); }
  });

  document.getElementById('wi-saved-baskets').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.wi-saved-basket-delete');
    if (delBtn) {
      const basket = savedBaskets.find(b => b.id === delBtn.dataset.basketId);
      if (basket && confirm(`Delete "${basket.name}"?`)) deleteSavedBasket(delBtn.dataset.basketId);
      return;
    }
    const loadBtn = e.target.closest('.wi-saved-basket-load');
    if (loadBtn) loadBasketIntoForm(loadBtn.dataset.basketId);
  });

  loadSavedBaskets().then(baskets => {
    savedBaskets = baskets;
    renderSavedBasketsList();
  });
}

function initModeTabs() {
  const tabs = document.querySelectorAll('.wi-mode-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.classList.contains('active')) return;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      const mode = tab.dataset.mode;
      document.getElementById('wi-form').hidden = mode !== 'single';
      document.getElementById('wi-etf-form').hidden = mode !== 'etf';
      renderError(null);
      renderError(null, 'wi-etf-error');
      document.getElementById('wi-results').innerHTML =
        '<div class="wi-placeholder">Pick a stock, amount and date, then hit Calculate.</div>';
    });
  });
}

// Populated by renderEtfResults so the row-click handler wired in
// initEtfDetailModal() can look a constituent's per-year rows back up by
// index without re-parsing the DOM.
let etfLastResults = [];

function renderEtfResults({ rows, startDate, endDateInput }) {
  const resultsEl = document.getElementById('wi-results');

  const enriched = rows.map(({ code, name, sim }) => {
    const priceOnlyValue = sim.initialShares * sim.latestClose;
    const dripValue = sim.finalSharesDrip * sim.latestClose + sim.finalCashDrip;
    const cost = sim.initialShares * sim.initialCostPerShare;
    const netDividends = sim.rows.reduce((s, r) => s + r.net, 0);
    const bonusShares = sim.rows.reduce((s, r) => s + r.bonusShares, 0);
    return { code, name, sim, priceOnlyValue, dripValue, cost, netDividends, bonusShares };
  });
  etfLastResults = enriched;

  const totalCost = enriched.reduce((s, r) => s + r.cost, 0);
  const totalPriceOnly = enriched.reduce((s, r) => s + r.priceOnlyValue, 0);
  const totalDrip = enriched.reduce((s, r) => s + r.dripValue, 0);
  const totalDividends = enriched.reduce((s, r) => s + r.netDividends, 0);

  const endLabel = endDateInput ? fmtDate(endDateInput) : 'latest session';
  const years = Math.max(((endDateInput || new Date()) - startDate) / (365.25 * 86400000), 1 / 365.25);
  const returnPctPriceOnly = (totalPriceOnly / totalCost - 1) * 100;
  const returnPctDrip = (totalDrip / totalCost - 1) * 100;
  const cagrPriceOnly = (Math.pow(totalPriceOnly / totalCost, 1 / years) - 1) * 100;
  const cagrDrip = (Math.pow(totalDrip / totalCost, 1 / years) - 1) * 100;
  const signClass = (v) => (v >= 0 ? 'pos' : 'neg');

  const maxBar = Math.max(totalPriceOnly, totalDrip, 1);
  const barHeight = (v) => Math.max(4, Math.round((v / maxBar) * 160));

  const tableRows = enriched.map((r, i) => {
    const weight = totalCost > 0 ? (r.cost / totalCost) * 100 : 0;
    const retPct = r.cost > 0 ? (r.dripValue / r.cost - 1) * 100 : 0;
    return `
      <tr class="wi-row-clickable" data-etf-idx="${i}" tabindex="0" title="View year-by-year dividend detail">
        <td>${escapeHtml(r.name)} (${escapeHtml(r.code)})</td>
        <td>${r.sim.initialShares.toLocaleString('en-US')}</td>
        <td>${fmtDate(r.sim.buyDate)}</td>
        <td>${fmtMoney2(r.sim.buyPrice)}</td>
        <td>${fmtMoney2(r.cost)}</td>
        <td>${weight.toFixed(1)}%</td>
        <td>${r.bonusShares > 0 ? '+' + r.bonusShares.toLocaleString('en-US') : '—'}</td>
        <td>${r.netDividends > 0 ? fmtMoney(r.netDividends) : '—'}</td>
        <td>${r.sim.finalSharesDrip.toLocaleString('en-US')}</td>
        <td>${fmtMoney2(r.sim.latestClose)}</td>
        <td>${fmtMoney(r.dripValue)}</td>
        <td class="${signClass(retPct)}">${fmtPct(retPct)}</td>
      </tr>
    `;
  }).join('');

  resultsEl.innerHTML = `
    <div class="calc-summary-row">
      <div class="calc-summary-card principal">
        <div class="calc-summary-label">Basket Cost</div>
        <div class="calc-summary-value">${fmtMoney(totalCost)}</div>
        <div class="calc-summary-sub">${enriched.length} stock${enriched.length === 1 ? '' : 's'} &middot; from ${fmtDate(startDate)}</div>
      </div>
      <div class="calc-summary-card dividends">
        <div class="calc-summary-label">Net Dividends Reinvested</div>
        <div class="calc-summary-value">${fmtMoney(totalDividends)}</div>
        <div class="calc-summary-sub">across the basket, after 15% tax</div>
      </div>
      <div class="calc-summary-card returnpct">
        <div class="calc-summary-label">Total Return</div>
        <div class="calc-summary-value ${signClass(returnPctDrip)}">${fmtPct(returnPctDrip)}</div>
        <div class="calc-summary-sub">${fmtPct(returnPctPriceOnly)} price-only &middot; ${fmtPct(cagrDrip)}/yr CAGR</div>
      </div>
      <div class="calc-summary-card priceonly">
        <div class="calc-summary-label">Value at ${escapeHtml(endLabel)} — Price Only</div>
        <div class="calc-summary-value">${fmtMoney(totalPriceOnly)}</div>
        <div class="calc-summary-sub ${signClass(returnPctPriceOnly)}">${fmtPct(returnPctPriceOnly)} &middot; ${fmtPct(cagrPriceOnly)}/yr CAGR</div>
      </div>
      <div class="calc-summary-card total">
        <div class="calc-summary-label">Value at ${escapeHtml(endLabel)} — With Dividends</div>
        <div class="calc-summary-value">${fmtMoney(totalDrip)}</div>
        <div class="calc-summary-sub ${signClass(returnPctDrip)}">${fmtPct(returnPctDrip)} &middot; ${fmtPct(cagrDrip)}/yr CAGR</div>
      </div>
    </div>

    <div class="calc-chart-card">
      <div class="calc-chart-hd">
        <span class="calc-chart-title">Price-only vs. dividends reinvested</span>
        <div class="calc-chart-legend">
          <span class="calc-legend-item"><span class="calc-legend-dot priceonly"></span>Price only</span>
          <span class="calc-legend-item"><span class="calc-legend-dot total"></span>With dividends</span>
        </div>
      </div>
      <div class="wi-bars-wrap">
        <div class="wi-bar-col">
          <div class="wi-bar-val">${fmtMoney(totalPriceOnly)}</div>
          <div class="wi-bar-fill priceonly" style="height:${barHeight(totalPriceOnly)}px"></div>
        </div>
        <div class="wi-bar-col">
          <div class="wi-bar-val">${fmtMoney(totalDrip)}</div>
          <div class="wi-bar-fill total" style="height:${barHeight(totalDrip)}px"></div>
        </div>
      </div>
      <div class="wi-bars-labels">
        <div class="wi-bar-label">Price only</div>
        <div class="wi-bar-label">With dividends</div>
      </div>
    </div>

    <div class="calc-table-card">
      <div class="calc-table-hd">Basket Breakdown <span class="wi-table-hint">— click a stock for year-by-year dividend detail</span></div>
      <div class="calc-table-scroll">
        <table class="calc-table">
          <thead>
            <tr>
              <th>Stock</th><th>Shares</th><th>Buy Date</th><th>Buy Price</th><th>Cost</th><th>Weight</th>
              <th>Bonus Shares</th><th>Net Dividends</th><th>Ending Shares</th>
              <th>Price at ${escapeHtml(endLabel)}</th><th>Value Today</th><th>Return</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ─── Custom ETF per-stock detail modal ───────────────────────────
function openEtfDetailModal(idx) {
  const r = etfLastResults[idx];
  if (!r) return;

  document.getElementById('wi-etf-detail-title').textContent = `${r.name} (${r.code})`;
  const payouts = r.sim.rows.length;
  const bits = [
    `${r.sim.initialShares.toLocaleString('en-US')} shares from ${fmtDate(r.sim.buyDate)}`,
    `${payouts} payout${payouts === 1 ? '' : 's'}`,
  ];
  if (r.bonusShares > 0) bits.push(`${r.bonusShares.toLocaleString('en-US')} bonus shares`);
  if (r.netDividends > 0) bits.push(`${fmtMoney(r.netDividends)} net dividends reinvested`);
  document.getElementById('wi-etf-detail-sub').textContent = bits.join(' · ');

  document.getElementById('wi-etf-detail-body').innerHTML =
    `<div class="calc-table-scroll">${dividendDetailTableHtml(r.sim.rows)}</div>`;

  const modal = document.getElementById('wi-etf-detail-modal');
  modal.style.display = 'flex';
  document.addEventListener('keydown', handleEtfDetailModalKeydown);
}

function closeEtfDetailModal() {
  const modal = document.getElementById('wi-etf-detail-modal');
  modal.style.display = 'none';
  document.removeEventListener('keydown', handleEtfDetailModalKeydown);
}

function handleEtfDetailModalKeydown(e) {
  if (e.key === 'Escape') closeEtfDetailModal();
}

function initEtfDetailModal() {
  const modal = document.getElementById('wi-etf-detail-modal');
  modal.addEventListener('click', (e) => { if (e.target === modal) closeEtfDetailModal(); });
  document.getElementById('wi-etf-detail-close').addEventListener('click', closeEtfDetailModal);

  // Delegated on #wi-results (re-rendered on every Calculate) rather than on
  // the rows themselves, so this only needs wiring up once.
  const results = document.getElementById('wi-results');
  results.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-etf-idx]');
    if (row) openEtfDetailModal(Number(row.dataset.etfIdx));
  });
  results.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('tr[data-etf-idx]');
    if (!row) return;
    e.preventDefault();
    openEtfDetailModal(Number(row.dataset.etfIdx));
  });
}

// Reads the current basket rows into [{code, shares}], skipping fully-blank
// rows. Returns { error } instead of throwing so both Calculate and Save can
// show the message inline without a try/catch at the call site.
function collectEtfConstituents() {
  const constituents = [];
  for (const row of etfRows) {
    const tickerRaw = row.combo.inputEl.value.trim();
    const sharesRaw = row.sharesInput.value.trim();
    if (!tickerRaw && !sharesRaw) continue; // blank row — skip silently
    const code = row.combo.getCode();
    if (!code) {
      return { error: `"${tickerRaw}" isn't a recognized stock. Pick one from the suggestions.` };
    }
    const shares = parseInt(sharesRaw, 10);
    if (!shares || shares <= 0) {
      return { error: `Enter a whole number of shares for ${code}.` };
    }
    constituents.push({ code, shares });
  }
  if (!constituents.length) {
    return { error: 'Add at least one stock with a share count.' };
  }
  return { constituents };
}

async function handleEtfSubmit(e) {
  e.preventDefault();
  renderError(null, 'wi-etf-error');

  const submitBtn = document.getElementById('wi-etf-submit');
  const startStr = document.getElementById('wi-etf-start').value;
  const endStr = document.getElementById('wi-etf-end').value;

  if (!startStr) { renderError('Pick a start date.', 'wi-etf-error'); return; }
  const startDate = new Date(startStr + 'T00:00:00');
  const endDateInput = endStr ? new Date(endStr + 'T00:00:00') : null;
  if (endDateInput && endDateInput < startDate) {
    renderError('End date must be on or after the start date.', 'wi-etf-error');
    return;
  }

  const { constituents, error } = collectEtfConstituents();
  if (error) { renderError(error, 'wi-etf-error'); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Calculating…';
  try {
    const dividends = await loadDividends();
    const candlesList = await Promise.all(constituents.map(c => loadCandles(c.code)));
    const detailsList = await Promise.all(constituents.map(c => loadCompanyDetails(c.code)));

    const results = [];
    for (let i = 0; i < constituents.length; i++) {
      const { code, shares } = constituents[i];
      const candles = candlesList[i];
      if (!candles.length) throw new Error(`No price history is on file for ${code}.`);

      const firstDate = candles[0]._date;
      const lastCandle = candles[candles.length - 1];
      const effectiveStart = startDate < firstDate ? firstDate : startDate;
      if (effectiveStart > lastCandle._date) {
        throw new Error(`${code}'s price history only runs up to ${fmtDate(lastCandle._date)}.`);
      }

      const buyIdx = findIndexOnOrAfter(candles, effectiveStart);
      if (buyIdx === -1) throw new Error(`No trading session on/after ${fmtDate(effectiveStart)} was found for ${code}.`);

      let endIdx = candles.length - 1;
      if (endDateInput) {
        endIdx = findIndexOnOrBefore(candles, endDateInput);
        if (endIdx === -1 || endIdx < buyIdx) {
          throw new Error(`${code} has no trading session between ${fmtDate(effectiveStart)} and ${fmtDate(endDateInput)}.`);
        }
      }

      const dividendsByYear = parseDividendString(dividends[code] && dividends[code].cashDividend);
      const stockDividendsByYear = parseDividendString(detailsList[i] && detailsList[i].stockDividend);
      const sim = simulate({ candles, buyIdx, dividendsByYear, stockDividendsByYear, endIdx, initialShares: shares });

      results.push({ code, name: namesMap[code] || code, sim });
    }

    renderEtfResults({ rows: results, startDate, endDateInput });
  } catch (err) {
    renderError(err.message, 'wi-etf-error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Calculate ETF Return';
  }
}

function initEtfDateBounds() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('wi-etf-start').max = today;
  document.getElementById('wi-etf-end').max = today;
  document.getElementById('wi-etf-start').value = '2020-01-01';
}

// ─── Wiring ──────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  renderError(null);

  const submitBtn = document.getElementById('wi-submit');
  const rawTicker = document.getElementById('wi-ticker').value;
  const amount = parseFloat(document.getElementById('wi-amount').value);
  const dateStr = document.getElementById('wi-date').value;

  const code = resolveTicker(rawTicker);
  if (!code) { renderError('That stock could not be found. Pick one from the suggestions.'); return; }
  if (!amount || amount <= 0) { renderError('Enter an investment amount greater than zero.'); return; }
  if (!dateStr) { renderError('Pick a purchase date.'); return; }
  const chosenDate = new Date(dateStr + 'T00:00:00');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Calculating…';
  try {
    const [candles, dividends, details] = await Promise.all([loadCandles(code), loadDividends(), loadCompanyDetails(code)]);
    if (!candles.length) { renderError(`No price history is on file for ${code}.`); return; }

    const firstDate = candles[0]._date;
    const lastCandle = candles[candles.length - 1];
    let effectiveDate = chosenDate < firstDate ? firstDate : chosenDate;
    if (effectiveDate > lastCandle._date) {
      renderError(`${code}'s price history only runs up to ${fmtDate(lastCandle._date)}. Pick an earlier date.`);
      return;
    }

    const buyIdx = findIndexOnOrAfter(candles, effectiveDate);
    if (buyIdx === -1) { renderError(`No trading session on/after ${fmtDate(effectiveDate)} was found for ${code}.`); return; }
    const buyDate = candles[buyIdx]._date;
    const buyPrice = candles[buyIdx].Close;
    const buyCostPerShare = buyPrice * (1 + COMMISSION_RATE);
    if (amount < buyCostPerShare) {
      renderError(`৳${amount.toLocaleString('en-US')} isn't enough to buy even one ${code} share at ৳${buyPrice.toFixed(2)} + 0.4% commission (${fmtDate(buyDate)}). Shares trade in whole units only.`);
      return;
    }

    const dividendsByYear = parseDividendString(dividends[code] && dividends[code].cashDividend);
    const stockDividendsByYear = parseDividendString(details && details.stockDividend);
    const sim = simulate({ candles, buyIdx, dividendsByYear, stockDividendsByYear, latestClose: lastCandle.Close, amount });

    renderResults({ code, name: namesMap[code] || code, amount, buyDate, sim });
  } catch (err) {
    renderError(`Couldn't load data for ${code}: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Calculate';
  }
}

function initDateBounds() {
  const dateInput = document.getElementById('wi-date');
  const today = new Date();
  dateInput.max = today.toISOString().slice(0, 10);
  dateInput.value = '2020-01-01';
}

loadPickerData();
initStockPicker();
initDateBounds();
initEtfDateBounds();
initModeTabs();
initEtfPresets();
initEtfDetailModal();
initSavedBaskets();
document.getElementById('wi-form').addEventListener('submit', handleSubmit);
document.getElementById('wi-etf-form').addEventListener('submit', handleEtfSubmit);
document.getElementById('wi-etf-add').addEventListener('click', addEtfRow);
addEtfRow();
addEtfRow();
