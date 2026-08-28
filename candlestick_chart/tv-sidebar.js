'use strict';

/* ════════════════════════════════════════════════════════════
   tv-sidebar.js
   Right-hand TradingView-style sidebar for the standalone
   candlestick.html page: a watchlist (grouped by the user's own
   saved watchlists, from /api/watchlists) and a symbol info panel
   (company name/sector/logo/price/key stats).

   Entry point: window.refreshSidebarForSymbol(code) — called once
   on initial load and again every time processChartData() finishes
   loading a symbol (see candlestick-data.js), so the panel always
   reflects the symbol actually on screen, including its average
   volume computed from the chart's own just-loaded history.
   ════════════════════════════════════════════════════════════ */

(function () {
  const watchlistBodyEl = document.getElementById('tvWatchlistBody');
  const symbolInfoEl    = document.getElementById('tvSymbolInfo');
  const newsBodyEl      = document.getElementById('tvNewsBody');
  const mfHoldersBodyEl = document.getElementById('tvMfHoldersBody');
  const mfPortfolioBtn  = document.getElementById('mfPortfolioBtn');
  const bankPanelEl     = document.getElementById('tvBankDetails');
  const bankBodyEl      = document.getElementById('tvBankDetailsBody');
  const bankOpenEl      = document.getElementById('tvBankDetailsOpen');
  const bankRailBtn     = document.getElementById('railBankDetailsBtn');
  if (!watchlistBodyEl && !symbolInfoEl && !newsBodyEl && !mfHoldersBodyEl) return; // not on this page

  let stocksByCode = new Map();
  let sectorByCode  = {};
  let nameByCode    = {};
  let logoByCode    = {};
  let watchlists    = [];
  let currentCode   = '';
  let readyPromise  = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function fmtCompact(n) {
    if (n == null || isNaN(n)) return null;
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(0);
  }

  function pctChange(stock) {
    if (!stock || !stock.ycp) return null;
    return (stock.change / stock.ycp) * 100;
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  }

  async function loadStaticData() {
    const [wlData, stocksData, sectorsData, namesData, logosData] = await Promise.all([
      fetchJson('/api/watchlists').catch(() => ({ watchlists: [] })),
      fetchJson('/api/stocks').catch(() => ({ stocks: [] })),
      fetchJson('/api/sectors').catch(() => ({})),
      fetchJson('/api/company-names').catch(() => ({ names: {} })),
      fetchJson('/data/stock-logos.json').catch(() => ({})),
    ]);
    watchlists = wlData.watchlists || [];
    stocksByCode = new Map((stocksData.stocks || []).map((s) => [String(s.code).toUpperCase(), s]));
    sectorByCode = sectorsData || {};
    nameByCode = namesData.names || {};
    logoByCode = logosData || {};
  }

  function ensureReady() {
    if (!readyPromise) readyPromise = loadStaticData();
    return readyPromise;
  }

  async function refreshLiveStocks() {
    try {
      const stocksData = await fetchJson('/api/stocks');
      stocksByCode = new Map((stocksData.stocks || []).map((s) => [String(s.code).toUpperCase(), s]));
      renderWatchlist();
    } catch { /* best-effort refresh — keep showing stale prices rather than erroring */ }
  }

  function renderWatchlist() {
    if (!watchlistBodyEl) return;

    if (!watchlists.length) {
      watchlistBodyEl.innerHTML = '<div class="tv-sidebar-loading">No saved watchlists yet — create one from the Watchlist page.</div>';
      return;
    }

    watchlistBodyEl.innerHTML = watchlists.map((wl) => {
      const rows = (wl.stocks || []).map((s) => {
        const code = String(s.code).toUpperCase();
        const stock = stocksByCode.get(code);
        const last = stock ? stock.ltp : null;
        const chg = stock ? stock.change : null;
        const vol = stock ? stock.volume : null;
        const pct = pctChange(stock);
        const cls = chg > 0 ? 'gain' : chg < 0 ? 'loss' : 'flat';
        const activeCls = code === currentCode ? ' active' : '';
        return `
          <div class="tv-wl-row${activeCls}" data-code="${escapeHtml(code)}">
            <span class="tv-wl-symbol" title="${escapeHtml(code)}">${escapeHtml(code)}</span>
            <span class="tv-wl-last">${last != null ? last.toFixed(2) : '—'}</span>
            <span class="tv-wl-chg-abs ${cls}">${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) : '—'}</span>
            <span class="tv-wl-chg ${cls}">${pct != null ? (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}</span>
            <span class="tv-wl-vol">${vol != null ? fmtCompact(vol) : '—'}</span>
          </div>`;
      }).join('');

      return `
        <div class="tv-wl-group">
          <div class="tv-wl-group-header" data-group="${escapeHtml(wl.id)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            <span>${escapeHtml(wl.name)} (${(wl.stocks || []).length})</span>
          </div>
          <div class="tv-wl-group-body" data-group-body="${escapeHtml(wl.id)}">${rows}</div>
        </div>`;
    }).join('');
  }

  function statRow(label, value) {
    if (value == null || value === '') return '';
    return `<div class="tv-si-stat-row"><span class="tv-si-stat-label">${escapeHtml(label)}</span><span class="tv-si-stat-value">${escapeHtml(String(value))}</span></div>`;
  }

  // ── "Add to Watchlist" (symbol info panel) ─────────────────────
  // Talks to the same /api/watchlists endpoints as watchlist/watchlist.js,
  // but standalone: this page doesn't load that module, so membership
  // state lives in the `watchlists` array already fetched above.
  function stockInAnyWatchlist(code) {
    return watchlists.some((wl) => (wl.stocks || []).some((s) => s.code === code));
  }

  async function wlAddStock(wlId, code, name) {
    await fetch(`/api/watchlists/${wlId}/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name }),
    });
    const wl = watchlists.find((w) => w.id === wlId);
    if (wl) {
      wl.stocks = wl.stocks || [];
      if (!wl.stocks.find((s) => s.code === code)) wl.stocks.push({ code, name });
    }
  }

  async function wlRemoveStock(wlId, code) {
    await fetch(`/api/watchlists/${wlId}/stocks/${encodeURIComponent(code)}`, { method: 'DELETE' });
    const wl = watchlists.find((w) => w.id === wlId);
    if (wl) wl.stocks = (wl.stocks || []).filter((s) => s.code !== code);
  }

  async function wlCreate(name) {
    const r = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const wl = await r.json();
    watchlists.push(wl);
    return wl;
  }

  function updateSiWlBtnState() {
    const btn = document.getElementById('tvSiWlBtn');
    if (!btn) return;
    const inAny = stockInAnyWatchlist(currentCode);
    btn.classList.toggle('active', inAny);
    btn.title = inAny ? 'In watchlist' : 'Add to watchlist';
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', inAny ? 'currentColor' : 'none');
    const label = btn.querySelector('span');
    if (label) label.textContent = inAny ? 'In Watchlist' : 'Watchlist';
  }

  function renderSiWlDropdown() {
    const dd = document.getElementById('tvSiWlDropdown');
    if (!dd) return;
    const code = currentCode;

    if (!watchlists.length) {
      dd.innerHTML = `
        <div class="tv-si-wl-dropdown-hd">Add to Watchlist</div>
        <div class="tv-si-wl-empty">No watchlists yet.</div>
        <div class="tv-si-wl-dropdown-ft">
          <button class="tv-si-wl-create" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            New Watchlist &amp; Add
          </button>
        </div>`;
      return;
    }

    const rows = watchlists.map((wl) => {
      const inList = !!(wl.stocks || []).find((s) => s.code === code);
      return `
        <div class="tv-si-wl-item${inList ? ' in-list' : ''}" data-wl-id="${escapeHtml(wl.id)}">
          <svg class="tv-si-wl-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            ${inList ? '<polyline points="20 6 9 17 4 12"/>' : '<rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>'}
          </svg>
          <span class="tv-si-wl-item-name">${escapeHtml(wl.name)}</span>
          <small>${(wl.stocks || []).length}</small>
        </div>`;
    }).join('');

    dd.innerHTML = `
      <div class="tv-si-wl-dropdown-hd">Add to Watchlist</div>
      <div class="tv-si-wl-dropdown-list">${rows}</div>
      <div class="tv-si-wl-dropdown-ft">
        <button class="tv-si-wl-create" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          New Watchlist &amp; Add
        </button>
      </div>`;
  }

  function closeSiWlDropdown() {
    const dd = document.getElementById('tvSiWlDropdown');
    if (dd) dd.classList.remove('open');
  }

  function toggleSiWlDropdown() {
    const dd = document.getElementById('tvSiWlDropdown');
    if (!dd) return;
    if (dd.classList.contains('open')) {
      closeSiWlDropdown();
    } else {
      renderSiWlDropdown();
      dd.classList.add('open');
    }
  }

  async function handleSiWlItemClick(wlId) {
    const code = currentCode;
    const name = nameByCode[code] || code;
    const wl = watchlists.find((w) => w.id === wlId);
    if (!wl) return;
    const inList = !!(wl.stocks || []).find((s) => s.code === code);
    if (inList) await wlRemoveStock(wlId, code);
    else await wlAddStock(wlId, code, name);
    renderSiWlDropdown();
    renderWatchlist();
    updateSiWlBtnState();
  }

  async function handleSiWlCreateAndAdd() {
    const wlName = prompt('New watchlist name:');
    if (!wlName || !wlName.trim()) return;
    const code = currentCode;
    const name = nameByCode[code] || code;
    const wl = await wlCreate(wlName.trim());
    await wlAddStock(wl.id, code, name);
    renderSiWlDropdown();
    renderWatchlist();
    updateSiWlBtnState();
  }

  async function renderSymbolInfo(code) {
    if (!symbolInfoEl) return;

    const stock = stocksByCode.get(code) || null;
    const name = nameByCode[code] || code;
    const sector = sectorByCode[code] || null;
    const logo = logoByCode[code] || null;

    let details = null;
    try { details = await fetchJson(`/api/company-details/${encodeURIComponent(code)}`); } catch { /* best-effort */ }

    // Only render if the symbol hasn't changed again while this fetch was in flight.
    if (currentCode !== code) return;

    const last = stock ? stock.ltp : null;
    const chg = stock ? stock.change : null;
    const pct = pctChange(stock);
    const chgCls = chg > 0 ? 'gain' : chg < 0 ? 'loss' : 'flat';

    // Average volume computed from the chart's own just-loaded real history —
    // never fabricated; simply absent if chartData isn't populated yet.
    let avgVol30 = null;
    if (typeof chartData !== 'undefined' && Array.isArray(chartData) && chartData.length) {
      const last30 = chartData.slice(-30);
      avgVol30 = last30.reduce((a, c) => a + (c.Volume || 0), 0) / last30.length;
    }

    const marketCapM = details && details.marketCap ? parseFloat(String(details.marketCap).replace(/,/g, '')) : null;
    const cashDividend = details && details.cashDividend ? details.cashDividend.split(',')[0].trim() : null;
    const inAnyWl = stockInAnyWatchlist(code);

    symbolInfoEl.innerHTML = `
      <div class="tv-si-header">
        ${logo ? `<img class="tv-si-logo" src="${escapeHtml(logo)}" alt="" onerror="this.remove()">` : ''}
        <div class="tv-si-name-block">
          <div class="tv-si-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="tv-si-sector">${sector ? escapeHtml(sector) : 'DSE'}</div>
        </div>
      </div>
      <div class="tv-si-price-block">
        <div class="tv-si-price-row">
          <div class="tv-si-price-info">
            <div class="tv-si-price">${last != null ? last.toFixed(2) : '—'} <span style="font-size:12px;color:var(--text-muted);font-weight:500;">BDT</span></div>
            <div class="tv-si-change ${chgCls}">${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(2) : ''}${pct != null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)` : ''}</div>
          </div>
          <div class="tv-si-wl-wrap">
            <button class="tv-si-wl-btn${inAnyWl ? ' active' : ''}" id="tvSiWlBtn" type="button" title="${inAnyWl ? 'In watchlist' : 'Add to watchlist'}">
              <svg viewBox="0 0 24 24" fill="${inAnyWl ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              <span>${inAnyWl ? 'In Watchlist' : 'Watchlist'}</span>
            </button>
            <div class="tv-si-wl-dropdown" id="tvSiWlDropdown"></div>
          </div>
        </div>
      </div>
      <div class="tv-si-stats">
        <div class="tv-si-stats-title">Key stats</div>
        ${statRow('Volume', stock ? fmtCompact(stock.volume) : null)}
        ${statRow('Avg volume (30D)', avgVol30 != null ? fmtCompact(Math.round(avgVol30)) : null)}
        ${statRow('Market cap', marketCapM != null ? '৳ ' + fmtCompact(marketCapM * 1e6) : null)}
        ${statRow('Latest dividend', cashDividend)}
        ${statRow('EPS', details && details.eps)}
        ${statRow('P/E', details && details.pe)}
        ${statRow('NAV', details && details.nav)}
      </div>
    `;
  }

  // News panel — real scraped/user-saved articles for this stock from the
  // app's own /api/news/:code (see routes/news.js and the news-scraper
  // pipeline). No fabrication: an empty result just shows an empty state.
  async function renderNewsPanel(code) {
    if (!newsBodyEl) return;

    let items = null;
    try {
      const res = await fetchJson(`/api/news/${encodeURIComponent(code)}`);
      items = res.items || [];
    } catch { /* leave items null to signal a load error below */ }

    // Only render if the symbol hasn't changed again while this fetch was in flight.
    if (currentCode !== code) return;

    if (items == null) {
      newsBodyEl.innerHTML = '<div class="tv-sidebar-loading">Could not load news.</div>';
      return;
    }
    if (!items.length) {
      newsBodyEl.innerHTML = '<div class="tv-sidebar-loading">No recent news for this stock.</div>';
      return;
    }

    const rows = items.slice(0, 8).map((it) => {
      let dateStr = '';
      try { dateStr = new Date(it.addedAt).toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { /* leave blank */ }
      let site = it.site_name;
      if (!site) { try { site = new URL(it.url).hostname.replace('www.', ''); } catch { site = ''; } }
      return `
        <li class="an-news-row">
          <a class="an-news-title" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title || it.url)}</a>
          <div class="an-news-meta">${escapeHtml(site || '')}${dateStr ? ' · ' + dateStr : ''}</div>
        </li>`;
    }).join('');

    newsBodyEl.innerHTML = `<ul class="an-news-list">${rows}</ul>`;
  }

  // Held by Mutual Funds — reverse lookup from /api/mf-portfolio/holders/:code
  // (routes/mf-portfolio.js), scanning every tracked fund's most recent
  // quarterly portfolio for a holding in this stock. Only covers funds this
  // app has portfolio data for, not every fund listed on the DSE — an empty
  // result just means none of the *tracked* funds currently hold it, shown
  // honestly rather than implying full market coverage.
  async function renderMfHolders(code) {
    if (!mfHoldersBodyEl) return;

    let holders = null;
    try {
      const res = await fetchJson(`/api/mf-portfolio/holders/${encodeURIComponent(code)}`);
      holders = res.holders || [];
    } catch { /* leave null to signal a load error below */ }

    if (currentCode !== code) return;

    if (holders == null) {
      mfHoldersBodyEl.innerHTML = '<div class="tv-sidebar-loading">Could not load mutual fund holdings.</div>';
      return;
    }
    if (!holders.length) {
      mfHoldersBodyEl.innerHTML = '<div class="tv-sidebar-loading">Not held by any mutual fund tracked in this app.</div>';
      return;
    }

    const rows = holders.map((h) => {
      const name = nameByCode[h.fundCode] || h.fundCode;
      const mv = h.marketValue != null ? `৳${h.marketValue.toFixed(2)} mn` : '—';
      const shares = h.shares != null ? fmtCompact(h.shares) + ' shares' : '';
      return `
        <div class="tv-mf-row" data-fund="${escapeHtml(h.fundCode)}">
          <div class="tv-mf-row-top">
            <span class="tv-mf-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="tv-mf-value">${mv}</span>
          </div>
          <div class="tv-mf-row-sub">${escapeHtml(shares)}${shares ? ' · ' : ''}${escapeHtml(h.year)} ${escapeHtml(h.quarter)}</div>
        </div>`;
    }).join('');

    mfHoldersBodyEl.innerHTML = rows;
  }

  // Bank Details — the yearly grid maintained on /bank-details, surfaced
  // read-only here. Shown only for the "Bank" sector, matching the same test
  // company_profile/company.js uses to reveal its Bank Details button.
  //
  // The panel is deliberately not a shrunken copy of the 25-row editor: at
  // sidebar width that would be unreadable. It shows the two most recent
  // years side by side and drops any metric that's blank in both, so what's
  // left is only what has actually been filled in. The full history is one
  // click away via the header link.
  const BANK_SECTOR = 'Bank';
  const BANK_YEARS_SHOWN = 2;

  function isBankStock(code) {
    return sectorByCode[code] === BANK_SECTOR;
  }

  // Same formatting the editor uses in view mode, so a figure doesn't read
  // differently depending on which page you happen to be looking at.
  function fmtBankValue(val, hint) {
    if (val === '' || val == null) return null;
    if (hint === 'text') return String(val);
    const num = Number(val);
    if (!Number.isFinite(num)) return String(val);
    return num.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }

  function setBankApplicable(on) {
    if (bankPanelEl)  bankPanelEl.classList.toggle('tv-na', !on);
    if (bankRailBtn)  bankRailBtn.classList.toggle('tv-na', !on);
  }

  async function renderBankDetails(code) {
    if (!bankPanelEl || !bankBodyEl) return;

    if (!isBankStock(code)) {
      setBankApplicable(false);
      return;
    }
    setBankApplicable(true);

    const gridUrl = `/bank-details/bank-details.html?code=${encodeURIComponent(code)}`;
    if (bankOpenEl) bankOpenEl.href = gridUrl;

    let grid = null;
    try { grid = await fetchJson(`/api/bank-details-grid/${encodeURIComponent(code)}`); } catch { /* null signals a load error */ }

    if (currentCode !== code) return;

    if (grid == null) {
      bankBodyEl.innerHTML = '<div class="tv-sidebar-loading">Could not load bank details.</div>';
      return;
    }

    // The API returns year columns oldest-first, so the most recent are the tail.
    const cols = (grid.columns || []).slice(-BANK_YEARS_SHOWN);
    const cells = grid.cells || {};

    const rows = (window.BANK_ROWS || []).map((r) => {
      const byCol = cells[r.key] || {};
      const vals = cols.map((c) => fmtBankValue(byCol[c.id], r.hint));
      return vals.some((v) => v != null) ? { label: r.label, unit: r.unit, vals } : null;
    }).filter(Boolean);

    if (!cols.length || !rows.length) {
      bankBodyEl.innerHTML = `
        <div class="tv-bd-empty">
          <div>No bank details saved for ${escapeHtml(code)} yet.</div>
          <a href="${escapeHtml(gridUrl)}" target="_blank" rel="noopener">Add them →</a>
        </div>`;
      return;
    }

    const gridStyle = `--tv-bd-years:${cols.length}`;
    const head = `
      <div class="tv-bd-row tv-bd-row--head" style="${gridStyle}">
        <span></span>${cols.map((c) => `<span>${escapeHtml(c.label)}</span>`).join('')}
      </div>`;

    const body = rows.map((r) => `
      <div class="tv-bd-row" style="${gridStyle}">
        <span class="tv-bd-metric" title="${escapeHtml(r.label)}${r.unit ? ' (' + escapeHtml(r.unit) + ')' : ''}">
          <i class="tv-bd-mname">${escapeHtml(r.label)}</i>${r.unit ? `<i class="tv-bd-munit">${escapeHtml(r.unit)}</i>` : ''}
        </span>
        ${r.vals.map((v) => `<span class="tv-bd-val">${v == null ? '—' : escapeHtml(v)}</span>`).join('')}
      </div>`).join('');

    bankBodyEl.innerHTML = head + body;
  }

  // "View this fund's portfolio" rail link — only shown when the symbol on
  // screen is ITSELF a tracked mutual fund (i.e. this app has at least one
  // quarterly portfolio filed for it under mf_portfolios/), so it never
  // points at an empty page for the vast majority of symbols that aren't funds.
  async function checkMfPortfolioLink(code) {
    if (!mfPortfolioBtn) return;
    let hasData = false;
    try {
      const res = await fetchJson(`/api/mf-portfolio/${encodeURIComponent(code)}/quarters`);
      hasData = (res.quarters || []).length > 0;
    } catch { /* leave hidden on error — don't link to an unknown state */ }

    if (currentCode !== code) return;

    if (hasData) {
      mfPortfolioBtn.href = `/mutual_fund_portfolio/mf-portfolio.html?code=${encodeURIComponent(code)}`;
      mfPortfolioBtn.style.display = '';
    } else {
      mfPortfolioBtn.style.display = 'none';
      mfPortfolioBtn.href = '#';
    }
  }

  // ── Public entry point ─────────────────────────────────────────
  window.refreshSidebarForSymbol = async function (code) {
    if (!code) return;
    currentCode = String(code).toUpperCase();
    await ensureReady();
    renderWatchlist();
    await Promise.all([renderSymbolInfo(currentCode), renderNewsPanel(currentCode), renderMfHolders(currentCode), renderBankDetails(currentCode), checkMfPortfolioLink(currentCode)]);
  };

  // ── Event delegation: row click switches symbol, header click collapses group ──
  if (watchlistBodyEl) {
    watchlistBodyEl.addEventListener('click', (e) => {
      const groupHeader = e.target.closest('.tv-wl-group-header');
      if (groupHeader) {
        groupHeader.classList.toggle('collapsed');
        const body = watchlistBodyEl.querySelector(`.tv-wl-group-body[data-group-body="${CSS.escape(groupHeader.dataset.group)}"]`);
        if (body) body.classList.toggle('collapsed');
        return;
      }
      const row = e.target.closest('.tv-wl-row');
      if (row && typeof window.reloadChartForSymbol === 'function') {
        window.reloadChartForSymbol(row.dataset.code);
      }
    });
  }

  // ── Right rail: Watchlist / Symbol-details toggle buttons ──────────────
  // Both panels default to visible (rail buttons start "active"); clicking
  // either just show/hides that one card, independent of the other.
  function wireRailToggle(btnId, panelId) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const nowHidden = panel.style.display !== 'none';
      panel.style.display = nowHidden ? 'none' : '';
      btn.classList.toggle('active', !nowHidden);
    });
  }
  wireRailToggle('railWatchlistBtn', 'tvWatchlist');
  wireRailToggle('railDetailsBtn', 'tvSymbolInfo');
  wireRailToggle('railNewsBtn', 'tvNewsPanel');
  wireRailToggle('railMfHoldersBtn', 'tvMfHolders');
  // Bank Details toggles inline display like the rest; the sector gate uses
  // the .tv-na class instead, so hiding the panel on a non-bank symbol can't
  // silently discard a user's manual show/hide choice when they switch back.
  wireRailToggle('railBankDetailsBtn', 'tvBankDetails');

  // ── Watchlist symbol-column resize ──────────────────────────────────────
  // The (unlabeled) first column holds the ticker; its width lives in the
  // --tv-wl-col1 custom property on .tv-watchlist, which both the header
  // and every .tv-wl-row read from, so dragging the handle in the header
  // keeps every row in sync without a re-render. Width persists via the
  // same _loadPref/_savePref localStorage helpers candlestick-data.js uses
  // for chart type/indicators.
  (function wireWatchlistColResize() {
    const resizer = document.getElementById('tvWlColResizer');
    const panel = document.getElementById('tvWatchlist');
    if (!resizer || !panel || typeof _loadPref !== 'function') return;

    const MIN_WIDTH = 60;
    const MAX_WIDTH_CEILING = 220;
    // Space every OTHER column always needs — the 4 fixed numeric-column
    // widths + grid gaps + row padding (must match --tv-wl-col-last/-chg/
    // -pct/-vol and .tv-wl-row's gap/padding in tv-layout.css). Capping
    // col1 against this keeps it from being dragged wide enough to push
    // the numeric columns into overflow/clipping — but the sidebar is only
    // ~344px total, and this panel's real content width can end up close
    // to (or under) RESERVED_WIDTH + MIN_WIDTH. When that happens,
    // maxWidth() would floor at exactly MIN_WIDTH, and clamp() below
    // degenerates into a CONSTANT function (min(60, max(60, px)) === 60
    // for every px) — the handle looks completely frozen no matter how
    // far you drag. MIN_DRAG_RANGE guarantees maxWidth() always sits well
    // above MIN_WIDTH, so there's always a real range to drag through.
    // Numeric columns may clip at the wide end in a tight panel — that's
    // fine, .tv-watchlist's overflow:hidden clips header and rows
    // identically, so alignment holds even when clipped.
    const RESERVED_WIDTH  = (44 + 40 + 46 + 48) + (8 * 4) + (14 * 2);
    const MIN_DRAG_RANGE  = 70;

    function maxWidth() {
      const available = panel.clientWidth - RESERVED_WIDTH;
      const floor = MIN_WIDTH + MIN_DRAG_RANGE;
      return Math.max(floor, Math.min(MAX_WIDTH_CEILING, available));
    }
    const clamp = (px) => Math.min(maxWidth(), Math.max(MIN_WIDTH, px));

    let width = clamp(_loadPref('tvWlCol1Width', 92));
    panel.style.setProperty('--tv-wl-col1', width + 'px');

    let dragStartX = 0;
    let dragStartWidth = width;

    function onDragMove(e) {
      width = clamp(dragStartWidth + (e.clientX - dragStartX));
      panel.style.setProperty('--tv-wl-col1', width + 'px');
    }
    function onDragEnd() {
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      _savePref('tvWlCol1Width', width);
    }
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragStartX = e.clientX;
      dragStartWidth = width;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd);
    });
  })();

  // ── Chart/sidebar column resize ─────────────────────────────────────
  // Drag handle between the chart (.main-container) and the right sidebar
  // (.tv-right-sidebar) — width lives in --tv-sidebar-width on
  // .tv-page-shell, which .tv-right-sidebar's flex-basis reads from;
  // .main-container is flex:1 1 auto so it automatically fills whatever
  // space the sidebar doesn't take, no separate variable needed for it.
  (function wireColumnResize() {
    const resizer = document.getElementById('tvColResizer');
    const shell = document.querySelector('.tv-page-shell');
    if (!resizer || !shell || typeof _loadPref !== 'function') return;

    const MIN_SIDEBAR = 260;
    const MAX_SIDEBAR_CEILING = 560;
    const MIN_CHART_WIDTH = 420;      // never let the chart pane get squeezed thinner than this
    const RAIL_AND_RESIZER = 52 + 8;  // .tv-left-rail + this resizer's own width
    // Same lesson as the watchlist column-resize bug: guarantee a real
    // drag range even if the shell measures narrower than expected, or
    // maxWidth() could collapse to MIN_SIDEBAR and freeze the handle.
    const MIN_DRAG_RANGE = 100;

    function maxWidth() {
      const available = shell.clientWidth - RAIL_AND_RESIZER - MIN_CHART_WIDTH;
      const floor = MIN_SIDEBAR + MIN_DRAG_RANGE;
      return Math.max(floor, Math.min(MAX_SIDEBAR_CEILING, available));
    }
    const clamp = (px) => Math.min(maxWidth(), Math.max(MIN_SIDEBAR, px));

    let width = clamp(_loadPref('tvSidebarWidth', 344));
    shell.style.setProperty('--tv-sidebar-width', width + 'px');

    let dragStartX = 0;
    let dragStartWidth = width;

    function onDragMove(e) {
      // The sidebar is to the RIGHT of this handle, so dragging LEFT
      // (negative dx) should widen it — inverted vs. the watchlist column
      // resizer above, whose handle sits on the left edge of the column
      // it grows.
      width = clamp(dragStartWidth - (e.clientX - dragStartX));
      shell.style.setProperty('--tv-sidebar-width', width + 'px');
    }
    function onDragEnd() {
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      _savePref('tvSidebarWidth', width);
    }
    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragStartX = e.clientX;
      dragStartWidth = width;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('pointermove', onDragMove);
      document.addEventListener('pointerup', onDragEnd);
    });
  })();

  // Row click → that fund's own portfolio page.
  if (mfHoldersBodyEl) {
    mfHoldersBodyEl.addEventListener('click', (e) => {
      const row = e.target.closest('.tv-mf-row');
      if (row) window.open(`/mutual_fund_portfolio/mf-portfolio.html?code=${encodeURIComponent(row.dataset.fund)}`, '_blank', 'noopener');
    });
  }

  // "Add to Watchlist" button + dropdown in the symbol info panel — delegated
  // since symbolInfoEl.innerHTML is fully replaced on every symbol switch.
  if (symbolInfoEl) {
    symbolInfoEl.addEventListener('click', (e) => {
      if (e.target.closest('.tv-si-wl-btn')) {
        e.stopPropagation();
        toggleSiWlDropdown();
        return;
      }
      if (e.target.closest('.tv-si-wl-create')) {
        e.stopPropagation();
        handleSiWlCreateAndAdd();
        return;
      }
      const item = e.target.closest('.tv-si-wl-item');
      if (item) {
        e.stopPropagation();
        handleSiWlItemClick(item.dataset.wlId);
      }
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tv-si-wl-wrap')) closeSiWlDropdown();
  });

  // Live price refresh every 60s (matches the server's own /api/stocks cache
  // TTL); the interval is configurable in /settings.
  if (window.DSESettings) window.DSESettings.everyRefresh(60_000, refreshLiveStocks);
  else setInterval(refreshLiveStocks, 60_000);
})();
