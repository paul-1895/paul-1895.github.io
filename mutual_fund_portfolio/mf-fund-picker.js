/**
 * mf-fund-picker.js
 * ─────────────────────────────────────────────────────────────
 * Landing state for mf-portfolio.html / mf-compare.html when opened
 * without a ?code= (e.g. clicked cold from the nav menu). Lists every
 * fund we have portfolio data for (GET /api/mf-portfolio) so there's
 * somewhere to go instead of a dead-end error toast.
 */

'use strict';

const CSS = `
.mf-picker-wrap {
  display: flex;
  justify-content: center;
  padding: 40px 16px;
}
.mf-picker-card {
  width: 100%;
  max-width: 560px;
  background: var(--bg-card, #161b22);
  border: 1px solid var(--border-glow, rgba(255,255,255,.15));
  border-radius: 12px;
  padding: 24px;
}
.mf-picker-title { margin: 0 0 4px; font-size: 18px; }
.mf-picker-hint { margin: 0 0 16px; font-size: 12px; color: var(--text-muted, #7d8aa3); }
.mf-picker-search {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-input, #1a2233);
  border: 1px solid var(--border-glow, rgba(255,255,255,.15));
  border-radius: 6px;
  color: var(--text-primary, #e2eaf6);
  font-family: var(--mono, monospace);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
  margin-bottom: 14px;
}
.mf-picker-search:focus { border-color: var(--accent, #00f5c4); }
.mf-picker-list { max-height: 360px; overflow-y: auto; }
.mf-picker-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid rgba(255,255,255,.04);
}
.mf-picker-item:hover { background: rgba(0,245,196,.07); }
.mf-picker-item-code {
  font-family: var(--mono, monospace);
  font-size: 12px;
  font-weight: 700;
  color: var(--accent, #00f5c4);
  min-width: 84px;
}
.mf-picker-item-name { flex: 1; font-size: 12px; }
.mf-picker-item-meta { font-size: 11px; color: var(--text-muted, #7d8aa3); }
.mf-picker-empty { padding: 20px 4px; font-size: 12px; color: var(--text-muted, #7d8aa3); }
`;

function injectStyle() {
  if (document.getElementById('mf-fund-picker-style')) return;
  const style = document.createElement('style');
  style.id = 'mf-fund-picker-style';
  style.textContent = CSS;
  document.head.appendChild(style);
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {HTMLElement} rootEl - hidden container to render the picker into
 * @param {{ title: string, hint: string, buildHref: (fund) => string }} opts
 */
export async function renderFundPicker(rootEl, { title, hint, buildHref }) {
  injectStyle();
  rootEl.className = 'mf-picker-wrap';
  rootEl.style.display = 'flex';
  rootEl.innerHTML = `
    <div class="mf-picker-card">
      <h2 class="mf-picker-title">${esc(title)}</h2>
      <p class="mf-picker-hint">${esc(hint)}</p>
      <input class="mf-picker-search" type="text" placeholder="Search fund code or name…" />
      <div class="mf-picker-list"></div>
    </div>
  `;
  const listEl = rootEl.querySelector('.mf-picker-list');
  const searchEl = rootEl.querySelector('.mf-picker-search');

  let funds = [];
  try {
    const [fundsRes, stocksRes] = await Promise.all([
      fetch('/api/mf-portfolio'),
      fetch('/api/stocks'),
    ]);
    const fundsData = await fundsRes.json();
    const stocksData = await stocksRes.json();
    const nameByCode = {};
    (stocksData.stocks || []).forEach(s => { nameByCode[s.code] = s.name; });
    funds = (fundsData.funds || []).map(f => ({ ...f, name: nameByCode[f.code] || f.code }));
  } catch (err) {
    listEl.innerHTML = `<div class="mf-picker-empty">Couldn't load the fund list.</div>`;
    return;
  }

  function render(filter) {
    const q = filter.trim().toLowerCase();
    const rows = funds.filter(f => !q || f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q));
    if (!rows.length) {
      listEl.innerHTML = `<div class="mf-picker-empty">No funds match "${esc(filter)}".</div>`;
      return;
    }
    listEl.innerHTML = rows.map(f => `
      <a class="mf-picker-item" href="${esc(buildHref(f))}">
        <span class="mf-picker-item-code">${esc(f.code)}</span>
        <span class="mf-picker-item-name">${esc(f.name)}</span>
        <span class="mf-picker-item-meta">${f.latest ? esc(`${f.latest.year} ${f.latest.quarter}`) : 'No data yet'}</span>
      </a>
    `).join('');
  }

  if (!funds.length) {
    listEl.innerHTML = `<div class="mf-picker-empty">No funds have portfolio data yet.</div>`;
    return;
  }
  render('');
  searchEl.addEventListener('input', () => render(searchEl.value));
}
