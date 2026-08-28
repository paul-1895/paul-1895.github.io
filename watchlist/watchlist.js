// ═══════════════════════════════════════════════════════════
// WATCHLIST STATE & API
// ═══════════════════════════════════════════════════════════
let watchlists = [];        // [{id, name, stocks:[{code,name}]}]
let allStocksData = [];     // current full stock list (for live prices)

const API = '';

async function fetchWatchlists() {
  try {
    const r = await fetch(`${API}/api/watchlists`);
    const d = await r.json();
    watchlists = d.watchlists || [];
    renderWatchlistPanel();
    updateFavButtons();
    updateWatchlistBadge();
    refreshWatchlistFilter();
  } catch (e) {
    console.error('Watchlist fetch failed', e);
  }
}

async function createWatchlist(name) {
  const r = await fetch(`${API}/api/watchlists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const wl = await r.json();
  watchlists.push(wl);
  renderWatchlistPanel();
  updateFavButtons();
  updateWatchlistBadge();
  refreshWatchlistFilter();
  return wl;
}

async function renameWatchlist(id, name) {
  await fetch(`${API}/api/watchlists/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  const wl = watchlists.find(w => w.id === id);
  if (wl) wl.name = name;
  renderWatchlistPanel();
  refreshWatchlistFilter();
}

async function deleteWatchlist(id) {
  if (!confirm('Delete this watchlist?')) return;
  await fetch(`${API}/api/watchlists/${id}`, { method: 'DELETE' });
  watchlists = watchlists.filter(w => w.id !== id);
  renderWatchlistPanel();
  updateFavButtons();
  updateWatchlistBadge();
  refreshWatchlistFilter();
}

// ═══════════════════════════════════════════════════════════
// WATCHLIST FILTER (main stocks table, wired via app.js)
// ═══════════════════════════════════════════════════════════

// Rebuild the <select> options from the current watchlists, then re-apply
// app.js's filter so the table reflects any membership change immediately
// (e.g. star/unstar a stock while its watchlist is the active filter).
function refreshWatchlistFilter() {
  const select = document.getElementById('watchlist-filter-select');
  if (!select) return;

  const current = select.value;
  select.innerHTML = '<option value="">All Watchlists</option>' +
    watchlists.map(wl => `<option value="${wl.id}">${escHtml(wl.name)}</option>`).join('');

  const stillExists = current && watchlists.some(wl => wl.id === current);
  select.value = stillExists ? current : '';

  if (typeof setWatchlistFilter === 'function') setWatchlistFilter(select.value);
}

function isCodeInWatchlist(watchlistId, code) {
  const wl = watchlists.find(w => w.id === watchlistId);
  return !!(wl && wl.stocks.find(s => s.code === code));
}

async function addStockToWatchlist(wlId, code, name) {
  await fetch(`${API}/api/watchlists/${wlId}/stocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name })
  });
  const wl = watchlists.find(w => w.id === wlId);
  if (wl && !wl.stocks.find(s => s.code === code)) {
    wl.stocks.push({ code, name });
  }
  renderWatchlistPanel();
  updateFavButtons();
  refreshWatchlistFilter();
}

async function removeStockFromWatchlist(wlId, code) {
  await fetch(`${API}/api/watchlists/${wlId}/stocks/${code}`, { method: 'DELETE' });
  const wl = watchlists.find(w => w.id === wlId);
  if (wl) wl.stocks = wl.stocks.filter(s => s.code !== code);
  renderWatchlistPanel();
  updateFavButtons();
  refreshWatchlistFilter();
}

// ═══════════════════════════════════════════════════════════
// PANEL OPEN / CLOSE
// ═══════════════════════════════════════════════════════════
function openWatchlistPanel() {
  document.getElementById('wl-panel').classList.add('open');
  document.getElementById('wl-overlay').classList.add('open');
  document.body.style.overflow = 'hidden'; // prevent background scroll behind the drawer
}
function closeWatchlistPanel() {
  document.getElementById('wl-panel').classList.remove('open');
  document.getElementById('wl-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════
// CREATE INPUT
// ═══════════════════════════════════════════════════════════
function showCreateInput() {
  document.getElementById('wl-create-input').style.display = 'flex';
  document.getElementById('wl-new-btn').style.display = 'none';
  document.getElementById('wl-create-name').value = '';
  document.getElementById('wl-create-name').focus();
}
function hideCreateInput() {
  document.getElementById('wl-create-input').style.display = 'none';
  document.getElementById('wl-new-btn').style.display = 'flex';
}
async function confirmCreate() {
  const name = document.getElementById('wl-create-name').value.trim();
  if (!name) return;
  await createWatchlist(name);
  hideCreateInput();
}

// ═══════════════════════════════════════════════════════════
// RENDER WATCHLIST PANEL
// ═══════════════════════════════════════════════════════════
function renderWatchlistPanel() {
  const container = document.getElementById('wl-lists');

  if (watchlists.length === 0) {
    container.innerHTML = '<div class="wl-empty-msg">No watchlists yet. Create one above!</div>';
    return;
  }

  // Preserve expanded state before wiping DOM
  const expanded = new Set();
  container.querySelectorAll('.wl-card.expanded').forEach(el => expanded.add(el.dataset.id));

  container.innerHTML = '';

  watchlists.forEach(wl => {
    const card = document.createElement('div');
    card.className = 'wl-card' + (expanded.has(wl.id) ? ' expanded' : '');
    card.dataset.id = wl.id;

    // wl.id is a server-generated numeric string (safe to interpolate); stock
    // code/name come from user-editable data, so those are rendered via DOM
    // APIs below rather than string-concatenated HTML/onclick attributes.
    card.innerHTML = `
      <div class="wl-card-header" onclick="toggleWlCard(this)">
        <div class="wl-card-left">
          <span class="wl-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg></span>
          <span class="wl-card-name">${escHtml(wl.name)}</span>
          <span class="wl-stock-count">${wl.stocks.length} stock${wl.stocks.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="wl-card-actions">
          <button class="wl-action-btn" title="Rename" onclick="event.stopPropagation();showRename('${wl.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="wl-action-btn danger" title="Delete" onclick="event.stopPropagation();deleteWatchlist('${wl.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          </button>
        </div>
      </div>
      <div class="wl-rename-wrap" id="wl-rename-${wl.id}">
        <input type="text" value="${escHtml(wl.name)}" placeholder="New name…" onkeydown="if(event.key==='Enter')confirmRename('${wl.id}',this.value)" />
        <button onclick="confirmRename('${wl.id}',document.querySelector('#wl-rename-${wl.id} input').value)">Save</button>
      </div>
      <div class="wl-stocks-body"></div>`;

    const stocksBody = card.querySelector('.wl-stocks-body');
    if (wl.stocks.length === 0) {
      stocksBody.innerHTML = `<div class="wl-empty-msg">No stocks yet. Use ⭐ on any row.</div>`;
    } else {
      wl.stocks.forEach(s => stocksBody.appendChild(buildStockItem(wl.id, s)));
    }

    container.appendChild(card);
  });
}

// Builds one stock row as real DOM nodes (not innerHTML) so a stock code/name
// containing HTML or quote characters can never break out into markup or
// into the neighboring onclick attributes.
function buildStockItem(wlId, s) {
  const item = document.createElement('div');
  item.className = 'wl-stock-item';

  const info = document.createElement('div');
  info.className = 'wl-stock-info';

  const codeDiv = document.createElement('div');
  codeDiv.className = 'wl-stock-code';
  const link = document.createElement('a');
  link.href = `/company_profile/company.html?code=${encodeURIComponent(s.code)}`;
  link.style.color = 'inherit';
  link.style.textDecoration = 'none';
  link.textContent = s.code;
  codeDiv.appendChild(link);

  const nameDiv = document.createElement('div');
  nameDiv.className = 'wl-stock-name';
  nameDiv.textContent = s.name;

  info.appendChild(codeDiv);
  info.appendChild(nameDiv);

  const priceEl = document.createElement('span');
  const live = allStocksData.find(x => x.code === s.code);
  if (live) {
    const dir = live.change > 0 ? 'up' : live.change < 0 ? 'dn' : '';
    const sign = live.change > 0 ? '+' : '';
    priceEl.className = `wl-stock-price ${dir}`;
    priceEl.innerHTML = `৳${live.ltp.toFixed(1)} <small>${sign}${live.change.toFixed(1)}</small>`;
  } else {
    priceEl.className = 'wl-stock-price wl-stock-price-empty';
    priceEl.textContent = 'No price';
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'wl-remove-stock';
  removeBtn.title = 'Remove';
  removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
  removeBtn.addEventListener('click', () => removeStockFromWatchlist(wlId, s.code));

  item.appendChild(info);
  item.appendChild(priceEl);
  item.appendChild(removeBtn);
  return item;
}

function toggleWlCard(header) {
  header.closest('.wl-card').classList.toggle('expanded');
}

function showRename(id) {
  const el = document.getElementById(`wl-rename-${id}`);
  el.classList.toggle('show');
  if (el.classList.contains('show')) el.querySelector('input').focus();
}

async function confirmRename(id, name) {
  name = name.trim();
  if (!name) return;
  await renameWatchlist(id, name);
  const el = document.getElementById(`wl-rename-${id}`);
  if (el) el.classList.remove('show');
}

// ═══════════════════════════════════════════════════════════
// WATCHLIST BADGE (header count)
// ═══════════════════════════════════════════════════════════
function updateWatchlistBadge() {
  document.getElementById('wl-count-badge').textContent = watchlists.length;
}

// ═══════════════════════════════════════════════════════════
// FAV BUTTONS IN TABLE
// ═══════════════════════════════════════════════════════════

// Returns true if stock is in ANY watchlist
function stockInAnyWatchlist(code) {
  return watchlists.some(wl => wl.stocks.find(s => s.code === code));
}

function updateFavButtons() {
  document.querySelectorAll('.fav-btn[data-code]').forEach(btn => {
    const code = btn.dataset.code;
    if (stockInAnyWatchlist(code)) {
      btn.classList.add('active');
      btn.title = 'In watchlist';
    } else {
      btn.classList.remove('active');
      btn.title = 'Add to watchlist';
    }
  });
}

// Open / close fav dropdown
let openDropdownCode = null;

function toggleFavDropdown(btn, code, name) {
  // Close any other open dropdown first
  if (openDropdownCode && openDropdownCode !== code) {
    closeFavDropdown(openDropdownCode);
  }

  const dd = document.getElementById(`fav-dd-${code}`);
  if (!dd) return;

  if (dd.classList.contains('open')) {
    closeFavDropdown(code);
  } else {
    openFavDropdown(code, name, dd);
  }
}

function openFavDropdown(code, name, dd) {
  renderFavDropdown(code, name, dd);
  dd.classList.add('open');
  openDropdownCode = code;
}

function closeFavDropdown(code) {
  const dd = document.getElementById(`fav-dd-${code}`);
  if (dd) dd.classList.remove('open');
  if (openDropdownCode === code) openDropdownCode = null;
}

function renderFavDropdown(code, name, dd) {
  dd.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'fav-dropdown-header';
  header.textContent = 'Add to Watchlist';
  dd.appendChild(header);

  if (watchlists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'fav-dropdown-empty';
    empty.textContent = 'No watchlists yet.';
    dd.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'fav-dropdown-list';

    watchlists.forEach(wl => {
      const inList = !!wl.stocks.find(s => s.code === code);
      const item = document.createElement('div');
      item.className = 'fav-dropdown-item' + (inList ? ' in-list' : '');
      item.innerHTML = `
        <svg class="fav-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          ${inList ? '<polyline points="20 6 9 17 4 12"/>' : '<rect x="3" y="3" width="18" height="18" rx="3" ry="3"/>'}
        </svg>
        <span class="fav-item-name">${escHtml(wl.name)}</span>
        <small style="font-family:var(--mono);font-size:9px;color:var(--text-muted)">${wl.stocks.length}</small>`;
      item.addEventListener('click', async () => {
        if (inList) {
          await removeStockFromWatchlist(wl.id, code);
        } else {
          await addStockToWatchlist(wl.id, code, name);
        }
        if (dd.classList.contains('open')) renderFavDropdown(code, name, dd);
      });
      list.appendChild(item);
    });

    dd.appendChild(list);
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'fav-dropdown-footer';
  const createBtn = document.createElement('button');
  createBtn.className = 'fav-dropdown-create';
  createBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> New Watchlist & Add`;
  createBtn.addEventListener('click', async () => {
    const wlName = prompt('New watchlist name:');
    if (!wlName || !wlName.trim()) return;
    const wl = await createWatchlist(wlName.trim());
    await addStockToWatchlist(wl.id, code, name);
    closeFavDropdown(code);
  });
  footer.appendChild(createBtn);
  dd.appendChild(footer);
}

// Close dropdown on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.fav-cell')) {
    if (openDropdownCode) closeFavDropdown(openDropdownCode);
  }
});

// ═══════════════════════════════════════════════════════════
// HOOK INTO app.js TABLE RENDERING
// (intercept after rows are rendered to inject fav cells)
// ═══════════════════════════════════════════════════════════
// stockMeta: safe code→name lookup, avoids broken inline onclick strings
const stockMeta = {};

function injectFavCells() {
  // Populate meta from live data
  (allStocksData || []).forEach(s => { stockMeta[s.code] = s.name; });

  document.querySelectorAll('#stocks-tbody tr[data-code]').forEach(row => {
    if (row.querySelector('.fav-cell')) return; // already injected this render
    const code = row.dataset.code;
    const name = stockMeta[code] || code;
    const isActive = stockInAnyWatchlist(code);

    const td = document.createElement('td');
    td.className = 'fav-cell';

    const btn = document.createElement('button');
    btn.className = 'fav-btn' + (isActive ? ' active' : '');
    btn.dataset.code = code;
    btn.title = 'Add to watchlist';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="${isActive ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavDropdown(btn, code, name);
    });

    const dd = document.createElement('div');
    dd.className = 'fav-dropdown';
    dd.id = 'fav-dd-' + code;

    td.appendChild(btn);
    td.appendChild(dd);
    row.insertBefore(td, row.firstChild);
  });
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════════════════
// INIT — run after app.js loads
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  fetchWatchlists();

  // Inject fav cells whenever app.js renders rows into the table
  const tbody = document.getElementById('stocks-tbody');
  if (tbody) {
    new MutationObserver(() => injectFavCells())
      .observe(tbody, { childList: true, subtree: true });
  }
});

// Poll watchlist prices every 60s to keep panel fresh (only while it's open —
// no point re-rendering an off-screen drawer)
function pollWatchlistPanel() {
  if (watchlists.length > 0 && document.getElementById('wl-panel').classList.contains('open')) {
    renderWatchlistPanel();
  }
}
if (window.DSESettings) window.DSESettings.everyRefresh(60000, pollWatchlistPanel);
else setInterval(pollWatchlistPanel, 60000);

window.isCodeInWatchlist = isCodeInWatchlist;
window.openWatchlistPanel = openWatchlistPanel;
window.closeWatchlistPanel = closeWatchlistPanel;
window.showCreateInput = showCreateInput;
window.hideCreateInput = hideCreateInput;
window.confirmCreate = confirmCreate;
window.toggleWlCard = toggleWlCard;
window.showRename = showRename;
window.confirmRename = confirmRename;
window.deleteWatchlist = deleteWatchlist;
window.removeStockFromWatchlist = removeStockFromWatchlist;
window.injectFavCells = injectFavCells;
window.setWatchlistStocksData = (data) => {
  allStocksData = data;
  // Re-render so prices that arrive after the panel's first paint actually show up
  if (watchlists.length > 0) renderWatchlistPanel();
};