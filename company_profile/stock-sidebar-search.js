/* ================================================================
   stock-sidebar-search.js — Search-stocks sidebar on company.html
   Live filters the full stock list and links to each match's
   company profile page.
   ================================================================ */
'use strict';

(function () {
  const API = '';
  let allStocks = [];

  async function loadStocks() {
    try {
      const res = await fetch(`${API}/api/stocks`);
      if (!res.ok) return;
      const { stocks } = await res.json();
      allStocks = stocks || [];
    } catch { /* search stays empty if this fails */ }
  }

  function fmtChange(change) {
    if (change == null || isNaN(change)) return '—';
    const n = Number(change);
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
  }

  function render(query) {
    const results = document.getElementById('stock-search-results');
    if (!results) return;

    const q = query.trim().toLowerCase();
    if (!q) {
      results.innerHTML = '<div class="stock-search-hint">Type to search across all listed stocks.</div>';
      return;
    }

    const matches = allStocks
      .filter(s => s.code.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q))
      .slice(0, 30);

    if (!matches.length) {
      results.innerHTML = '<div class="stock-search-hint">No stocks match &ldquo;' + esc(query) + '&rdquo;.</div>';
      return;
    }

    results.innerHTML = matches.map(s => {
      const isGain = (s.change || 0) >= 0;
      return `
        <a class="stock-search-row" href="company.html?code=${encodeURIComponent(s.code)}">
          <div class="stock-search-row-main">
            <span class="stock-search-code">${esc(s.code)}</span>
            <span class="stock-search-name">${esc(s.name || '')}</span>
          </div>
          <div class="stock-search-row-price">
            <span class="stock-search-ltp">${esc(String(s.ltp ?? '—'))}</span>
            <span class="stock-search-change ${isGain ? 'gain' : 'loss'}">${fmtChange(s.change)}</span>
          </div>
        </a>`;
    }).join('');
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const COLLAPSE_KEY = 'dse-stock-search-collapsed';

  function setCollapsed(collapsed) {
    const columns = document.querySelector('.profile-columns');
    const toggleBtn = document.getElementById('stock-search-toggle-btn');
    if (!columns || !toggleBtn) return;
    columns.classList.toggle('search-collapsed', collapsed);
    toggleBtn.classList.toggle('active', !collapsed);
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('stock-search-input');
    if (!input) return;
    loadStocks();
    input.addEventListener('input', () => render(input.value));

    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    const toggleBtn = document.getElementById('stock-search-toggle-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const columns = document.querySelector('.profile-columns');
        setCollapsed(!columns.classList.contains('search-collapsed'));
      });
    }
  });
})();
