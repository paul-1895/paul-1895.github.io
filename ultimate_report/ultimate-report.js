// ─── Ultimate Report ──────────────────────────────────────────────────────────
// The page holds one thing so far: a reusable research prompt. Type a ticker,
// copy the filled-in prompt, paste it into whichever model you're using.
// The prompt is editable, and edits persist in localStorage.
import { initTheme, toggleTheme } from '/theme/theme.js';

const PLACEHOLDER = '{{SYMBOL}}';
const STORE_KEY = 'ur-prompt-template';

// Kept as a single template string rather than assembled from parts — it's meant
// to be read and edited as prose, not composed programmatically.
const DEFAULT_PROMPT = `You are an experienced equity research analyst covering the Dhaka Stock Exchange (DSE).

Prepare an **Ultimate Report** on **${PLACEHOLDER}** (DSE-listed). Work through every section below, in order. Where you genuinely don't have the data, write "not available" and move on — do not estimate a number and present it as fact.

**1. Snapshot**
Full company name, ticker, sector, market category (A/B/N/Z), listing year, market capitalisation, free float, and current price with the as-of date.

**2. What the business actually does**
Revenue by product/segment and by geography. Who the customers are. How it makes money, and what it costs to make it. Capacity, plants, or distribution footprint where relevant.

**3. Industry and competitive position**
Market size and growth. Named competitors and relative share. What gives this company an edge — or doesn't. Regulatory regime, tariffs, subsidies, and input-price exposure.

**4. Recent developments (last 24 months)**
Expansions, new lines, acquisitions, capital raises, rights/bonus issues, management changes, litigation, regulatory actions, plant shutdowns. Date each item.

**5. Financial performance — last 5 fiscal years**
Present as a table: revenue, gross/operating/net margin, EPS, NAV per share, ROE, ROA, and debt-to-equity. Then explain the trend, not just restate it — what drove the direction of margins and returns?

**6. Earnings and cash quality**
Operating cash flow versus net profit, year by year. Receivable and inventory days. Any gap between reported profit and cash collected, and what explains it. Related-party transactions. Auditor's opinion and any emphasis-of-matter.

**7. Dividends**
Cash and stock dividend history for 5 years, payout ratio, and current yield. Is the payout covered by cash flow?

**8. Ownership and governance**
Sponsor/director holding, institutional, foreign, and public float — with the trend over the last several quarters. Any sponsor selling. Board independence and the record of minority-shareholder treatment.

**9. Valuation**
Trailing and forward P/E, P/B, PEG, EV/EBITDA, and dividend yield. Compare each against the sector median and against the company's own 5-year range. State plainly whether it looks cheap, fair, or expensive, and why.

**10. Technical picture**
Primary trend. Position relative to the 50- and 200-day EMA. MACD (12,26,9) posture. Nearest support and resistance with the price levels. Volume behaviour and average daily turnover — flag it if the stock is too thin to enter or exit at size.

**11. Bull case and bear case**
Three to five specific, falsifiable points on each side. No generalities.

**12. Risks**
Business, financial, regulatory, governance, and liquidity risk. Rank by likelihood × impact.

**13. Verdict**
A rating (Buy / Hold / Sell / Avoid), a fair-value range with the method that produced it, a time horizon, and the position size that would be sensible. State explicitly what evidence would change your mind.

**Ground rules**
- All figures in BDT. Label units (crore / million) every time.
- Cite the source and period for each figure — annual report FY, quarterly filing, DSE disclosure.
- Separate fact from inference. Mark every estimate as an estimate.
- Where sources conflict, say so and give both.
- Lead with a 5-bullet executive summary before Section 1.
- Close with a one-line note that this is analysis, not investment advice.`;

const $ = id => document.getElementById(id);

// ─── Template store ───────────────────────────────────────────────────────────
// A saved template is only ever the raw text *with* the placeholder in it; the
// substitution happens at render time so the ticker stays swappable.
function loadTemplate() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    return saved !== null ? saved : DEFAULT_PROMPT;
  } catch {
    return DEFAULT_PROMPT; // storage disabled — fall back to read-only default
  }
}

function saveTemplate(text) {
  try {
    if (text === DEFAULT_PROMPT) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

let template = loadTemplate();
let editing = false;

// ─── Render ───────────────────────────────────────────────────────────────────
const currentSymbol = () => $('ur-symbol').value.trim().toUpperCase();
const filled = () => template.replaceAll(PLACEHOLDER, currentSymbol() || PLACEHOLDER);

function render() {
  $('ur-prompt-text').textContent = filled();
  $('ur-badge').hidden = template === DEFAULT_PROMPT;
}

function setMode(next) {
  editing = next;
  $('ur-prompt-text').hidden = editing;
  $('ur-prompt-edit').hidden = !editing;
  $('ur-actions-view').hidden = editing;
  $('ur-actions-edit').hidden = !editing;
  $('ur-edit-hint').hidden = !editing;
  if (editing) {
    const ta = $('ur-prompt-edit');
    ta.value = template; // the raw template, placeholder intact — not the preview
    ta.focus();
    ta.setSelectionRange(0, 0);
    ta.scrollTop = 0;
  } else {
    render();
  }
}

// ─── Edit actions ─────────────────────────────────────────────────────────────
function save() {
  const text = $('ur-prompt-edit').value;
  if (!text.trim()) { flash($('ur-save'), 'Prompt is empty', false); return; }
  template = text;
  const ok = saveTemplate(text);
  setMode(false);
  // A failed write still applies for this session — say so rather than pretend.
  flash($('ur-edit'), ok ? 'Saved' : 'Saved (this tab only)', ok);
}

function cancel() {
  setMode(false);
}

// Loads the default into the editor rather than committing it, so the change is
// still reviewable — and cancellable — before it replaces anything.
function resetToDefault() {
  const ta = $('ur-prompt-edit');
  if (ta.value === DEFAULT_PROMPT) { flash($('ur-reset'), 'Already default', true); return; }
  ta.value = DEFAULT_PROMPT;
  ta.focus();
  flash($('ur-reset'), 'Default loaded — Save to keep', true);
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
async function copyPrompt() {
  const btn = $('ur-copy');
  const text = filled();
  try {
    await navigator.clipboard.writeText(text);
    flash(btn, 'Copied', true);
  } catch {
    // Clipboard API refuses outside a secure context; fall back to a hidden
    // textarea + execCommand, which still works there.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    flash(btn, ok ? 'Copied' : 'Copy failed', ok);
  }
}

function flash(btn, msg, ok) {
  clearTimeout(btn._flashT);
  if (!btn._label) btn._label = btn.textContent;
  btn.textContent = msg;
  btn.classList.toggle('ur-btn-ok', ok);
  btn.classList.toggle('ur-btn-bad', !ok);
  btn._flashT = setTimeout(() => {
    btn.textContent = btn._label;
    btn.classList.remove('ur-btn-ok', 'ur-btn-bad');
  }, 1600);
}

// ─── Ticker suggestions ───────────────────────────────────────────────────────
// Purely a convenience — a failed fetch leaves the free-text input usable.
async function loadSymbols() {
  try {
    const res = await fetch('/api/stocks');
    if (!res.ok) return;
    const { stocks } = await res.json();
    if (!Array.isArray(stocks)) return;
    $('ur-symbols').innerHTML = stocks.map(s => `<option value="${s.code}">`).join('');
  } catch {
    /* offline or server down */
  }
}

// ─── Wire-up ──────────────────────────────────────────────────────────────────
initTheme();
// Wrapped, not passed directly: toggleTheme's first argument is an optional
// callback, and handing it the click Event makes it throw.
$('theme-toggle-btn').addEventListener('click', () => toggleTheme());

$('ur-symbol').addEventListener('input', () => { if (!editing) render(); });
$('ur-copy').addEventListener('click', copyPrompt);
$('ur-edit').addEventListener('click', () => setMode(true));
$('ur-save').addEventListener('click', save);
$('ur-cancel').addEventListener('click', cancel);
$('ur-reset').addEventListener('click', resetToDefault);

$('ur-prompt-edit').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
});

// Edits made in another tab shouldn't leave this one showing a stale prompt.
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY || editing) return;
  template = loadTemplate();
  render();
});

render();
loadSymbols();
