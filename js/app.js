import { initTheme, toggleTheme } from '../theme/theme.js';
import { saveDailySnapshot } from '../priceHistory/priceHistory.js';

// ─── STATE ────────────────────────────────────────────────────────────────────
let allStocks = [];
let scopedStocks = [];  // allStocks narrowed by sector + watchlist — applies page-wide (ticker, summary, ranking cards, table)
let filteredStocks = []; // scopedStocks further narrowed by search/category/gainer-loser — table only
window.allStocksData = null; // exposed for watchlist code in index.html
let currentFilter = 'all';
let currentSort = { key: 'code', dir: 'asc' };
let sectorMap = {};
let currentCategoryFilter = '';
let currentSectorFilter = '';
let currentWatchlistFilter = '';

// ─── COLUMN VISIBILITY ────────────────────────────────────────────────────────
const MKT_COLS = [
  { key: 'rank',     label: '#'      },
  { key: 'category', label: 'Cat'    },
  { key: 'code',     label: 'Code'   },
  { key: 'sector',   label: 'Sector' },
  { key: 'ltp',      label: 'LTP'    },
  { key: 'high',     label: 'High'   },
  { key: 'low',      label: 'Low'    },
  { key: 'close',    label: 'Close'  },
  { key: 'ycp',      label: 'YCP'    },
  { key: 'change',   label: 'Change' },
  { key: 'trade',    label: 'Trades' },
  { key: 'value',    label: 'Turnover' },
  { key: 'volume',   label: 'Volume' },
];

let mktColVis = {};
(function initMktColVis() {
  try {
    const saved = localStorage.getItem('dse-mkt-col-vis');
    mktColVis = saved ? JSON.parse(saved) : {};
  } catch {}
  MKT_COLS.forEach(c => { if (mktColVis[c.key] === undefined) mktColVis[c.key] = true; });
})();

function saveMktColVis() {
  try { localStorage.setItem('dse-mkt-col-vis', JSON.stringify(mktColVis)); } catch {}
}

function syncMktTh() {
  MKT_COLS.forEach(c => {
    const th = document.querySelector(`#stocks-table th[data-col="${c.key}"]`);
    if (th) th.style.display = mktColVis[c.key] ? '' : 'none';
  });
}

function buildMktColPicker() {
  const body = document.getElementById('mkt-col-picker-body');
  if (!body) return;
  body.innerHTML = MKT_COLS.map(c => `
    <div class="mkt-cpitem${mktColVis[c.key] ? '' : ' mkt-cpitem-off'}" data-key="${c.key}">
      <input type="checkbox" ${mktColVis[c.key] ? 'checked' : ''}
             onchange="onMktColToggle('${c.key}', this.checked)" />
      <span>${c.label}</span>
    </div>
  `).join('');
  syncMktTh();
}

function onMktColToggle(key, visible) {
  mktColVis[key] = visible;
  saveMktColVis();
  const item = document.querySelector(`.mkt-cpitem[data-key="${key}"]`);
  if (item) item.classList.toggle('mkt-cpitem-off', !visible);
  applyFilterAndSort();
}

function resetMktColVis() {
  MKT_COLS.forEach(c => { mktColVis[c.key] = true; });
  saveMktColVis();
  document.querySelectorAll('.mkt-cpitem').forEach(item => {
    item.classList.remove('mkt-cpitem-off');
    const cb = item.querySelector('input');
    if (cb) cb.checked = true;
  });
  applyFilterAndSort();
}

function toggleMktColPicker(e) {
  if (e) e.stopPropagation();
  const backdrop = document.getElementById('mkt-col-picker-backdrop');
  if (!backdrop) return;
  backdrop.classList.toggle('open');
  if (backdrop.classList.contains('open')) {
    document.body.style.overflow = 'hidden'; // Prevent scroll behind modal
  }
}

function closeMktColModal(e) {
  if (e && e.target !== e.currentTarget) return; // Only close if clicking backdrop, not modal content
  const backdrop = document.getElementById('mkt-col-picker-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── SECTOR MAP ───────────────────────────────────────────────────────────────
async function loadSectorMap() {
  if (Object.keys(sectorMap).length) {
    return; // already loaded
  }
  try {
    const res = await fetch('/data/stock-sectors.json');
    sectorMap = await res.json();
    populateSectorFilterOptions(sectorMap);
  } catch {
    sectorMap = {};
  }
}

function populateSectorFilterOptions(map) {
  const select = document.getElementById('sector-filter-select');
  if (!select) return;
  const sectors = [...new Set(Object.values(map))].sort();
  sectors.forEach(sector => {
    const opt = document.createElement('option');
    opt.value = sector;
    opt.textContent = sector;
    select.appendChild(opt);
  });
}

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
async function loadData() {
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('error-state').classList.add('hidden');
  document.getElementById('stocks-table').classList.add('hidden');
  document.getElementById('refresh-btn').disabled = true;

  try {
    const res = await fetch('/api/stocks');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const { stocks, timestamp } = await res.json();

    await loadSectorMap();
    stocks.forEach(s => { s.sector = sectorMap[s.code] || 'N/A'; });

    allStocks = stocks;
    window.allStocksData = stocks; // expose to watchlist code in index.html
    if (typeof window.setWatchlistStocksData === 'function') window.setWatchlistStocksData(stocks); // keep watchlist panel prices live

    saveDailySnapshot(stocks); // persist today's prices to localStorage

    document.getElementById('last-updated').textContent =
      new Date(timestamp).toLocaleTimeString('en-BD');
    document.getElementById('total-count').textContent = stocks.length.toLocaleString();

    applyScope();

    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('stocks-table').classList.remove('hidden');
  } catch (err) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('error-msg').textContent = 'Error: ' + err.message;
  } finally {
    document.getElementById('refresh-btn').disabled = false;
  }
}

// ─── TICKER ───────────────────────────────────────────────────────────────────
function buildTicker(stocks) {
  const track = document.getElementById('ticker-track');
  const notable = stocks.filter(s => Math.abs(s.change) > 0).slice(0, 40);
  if (!notable.length) { track.textContent = 'No market movement data'; return; }

  const items = notable.map(s => {
    const dir  = s.change > 0 ? 'up' : 'dn';
    const sign = s.change > 0 ? '▲' : '▼';
    return `<span class="ticker-item ${dir}"><strong>${s.code}</strong> ৳${s.ltp.toFixed(1)} <em>${sign}${Math.abs(s.change).toFixed(1)}</em></span>`;
  }).join('');

  track.innerHTML = items + items; // duplicate for seamless loop
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────
function updateSummary(stocks) {
  const gainers = stocks.filter(s => s.change > 0).length;
  const losers  = stocks.filter(s => s.change < 0).length;
  const neutral = stocks.filter(s => s.change === 0).length;
  const prices  = stocks.map(s => s.ltp).filter(Boolean);
  const highest  = prices.length ? Math.max(...prices) : 0;
  const lowest   = prices.length ? Math.min(...prices) : 0;
  const turnover = stocks.reduce((sum, s) => sum + (s.value || 0), 0);

  document.getElementById('sc-gainers').textContent   = gainers;
  document.getElementById('sc-losers').textContent    = losers;
  document.getElementById('sc-unchanged').textContent = neutral;
  document.getElementById('sc-highest').textContent   = highest ? '৳' + highest.toFixed(1) : '—';
  document.getElementById('sc-lowest').textContent    = lowest  ? '৳' + lowest.toFixed(1)  : '—';
  document.getElementById('sc-turnover').textContent  = fmtTurnover(turnover);
}

// ─── RANKING CARDS (Top Volume / Gainers / Losers / Volatile) ─────────────────
let rankFullLists = { volume: [], gainers: [], losers: [], volatile: [] };

function pctChange(s) {
  return s.ycp ? (s.change / s.ycp) * 100 : 0;
}

// Gap between the day's high and low, as a percentage of YCP — i.e. the
// difference between how far above (high) and below (low) YCP the stock
// traded, same denominator as pctChange() above.
function volatilityPct(s) {
  return s.ycp ? ((s.high - s.low) / s.ycp) * 100 : 0;
}

function buildRankingCards(stocks) {
  const byVolume   = [...stocks].filter(s => s.volume > 0).sort((a, b) => b.volume - a.volume);
  const byGain     = [...stocks].filter(s => s.change > 0).sort((a, b) => pctChange(b) - pctChange(a));
  const byLoss     = [...stocks].filter(s => s.change < 0).sort((a, b) => pctChange(a) - pctChange(b));
  const byVolatile = [...stocks].filter(s => s.high > 0 && s.low > 0 && s.ycp > 0 && s.high >= s.low)
    .sort((a, b) => volatilityPct(b) - volatilityPct(a));

  rankFullLists = { volume: byVolume, gainers: byGain, losers: byLoss, volatile: byVolatile };

  renderRankList('volume',   byVolume.slice(0, 5),   s => fmtVol(s.volume));
  renderRankList('gainers',  byGain.slice(0, 5),     s => `+${pctChange(s).toFixed(2)}%`, 'up');
  renderRankList('losers',   byLoss.slice(0, 5),     s => `${pctChange(s).toFixed(2)}%`,  'dn');
  renderRankList('volatile', byVolatile.slice(0, 5), s => `${volatilityPct(s).toFixed(2)}%`);
}

function renderRankList(key, items, metricFn, dirClass) {
  const list = document.getElementById('rank-list-' + key);
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="rank-empty">No data available</div>';
    return;
  }

  list.innerHTML = items.map((s, i) => `
    <a class="rank-row-item" href="/company_profile/company.html?code=${encodeURIComponent(s.code)}">
      <span class="rank-rk">${i + 1}</span>
      <span class="rank-code">${s.code}</span>
      <span class="rank-metric${dirClass ? ' ' + dirClass : ''}">${metricFn(s)}</span>
    </a>
  `).join('');
}

const RANK_MODAL_TITLES = {
  volume:   'All Stocks — By Volume',
  gainers:  'All Stocks — Top Gainers',
  losers:   'All Stocks — Top Losers',
  volatile: 'All Stocks — Most Volatile',
};

function openRankModal(key) {
  const items = rankFullLists[key] || [];
  document.getElementById('rank-modal-title').textContent = RANK_MODAL_TITLES[key] || 'All Stocks';

  const tbody = document.getElementById('rank-modal-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted);">No data available</td></tr>';
  } else {
    tbody.innerHTML = items.map((s, i) => {
      const dir  = s.change > 0 ? 'up' : s.change < 0 ? 'dn' : '';
      const sign = s.change > 0 ? '+' : '';
      const pct  = pctChange(s).toFixed(2);
      return `<tr onclick="window.location.href='/company_profile/company.html?code=${encodeURIComponent(s.code)}'">
        <td class="rmt-rank">${i + 1}</td>
        <td class="rmt-code">${s.code}</td>
        <td class="rmt-num">৳${fmt(s.ltp)}</td>
        <td class="rmt-num ${dir}">${sign}${fmt(s.change)} (${sign}${pct}%)</td>
        <td class="rmt-num">${volatilityPct(s).toFixed(2)}%</td>
        <td class="rmt-num">${s.low > 0 && s.high > 0 ? `${fmt(s.low)} – ${fmt(s.high)}` : '—'}</td>
        <td class="rmt-num">${fmtVol(s.volume)}</td>
      </tr>`;
    }).join('');
  }

  const backdrop = document.getElementById('rank-modal-backdrop');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeRankModal(e) {
  if (e && e.target !== e.currentTarget) return; // only close on backdrop click, not modal content
  const backdrop = document.getElementById('rank-modal-backdrop');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── FILTER ───────────────────────────────────────────────────────────────────
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilterAndSort();
}

function filterTable() {
  applyFilterAndSort();
}

function setCategoryFilter(value) {
  currentCategoryFilter = value;
  applyFilterAndSort();
}

function setSectorFilter(value) {
  currentSectorFilter = value;
  applyScope();
}

function setWatchlistFilter(value) {
  currentWatchlistFilter = value;
  applyScope();
}

// Sector + Watchlist narrow WHICH stocks the whole page is about — recompute
// the ticker, summary cards and ranking cards from that scope, then cascade
// into the table filter (search/category/gainer-loser refine within it).
function applyScope() {
  scopedStocks = allStocks.filter(s => {
    const matchSector    = !currentSectorFilter    || s.sector === currentSectorFilter;
    const matchWatchlist = !currentWatchlistFilter ||
      (typeof isCodeInWatchlist === 'function' && isCodeInWatchlist(currentWatchlistFilter, s.code));
    return matchSector && matchWatchlist;
  });

  buildTicker(scopedStocks);
  updateSummary(scopedStocks);
  buildRankingCards(scopedStocks);
  applyFilterAndSort();
}

function applyFilterAndSort() {
  const query = (document.getElementById('search-input').value || '').toLowerCase();

  filteredStocks = scopedStocks.filter(s => {
    const matchSearch = !query || s.code.toLowerCase().includes(query) || s.name.toLowerCase().includes(query);
    const matchFilter =
      currentFilter === 'all'     ? true :
      currentFilter === 'gainer'  ? s.change > 0 :
      currentFilter === 'loser'   ? s.change < 0 :
      currentFilter === 'neutral' ? s.change === 0 : true;
    const matchCategory = !currentCategoryFilter || s.category === currentCategoryFilter;
    return matchSearch && matchFilter && matchCategory;
  });

  sortStocks(filteredStocks);
  renderTable(filteredStocks);
}

// ─── SORT ─────────────────────────────────────────────────────────────────────
function toggleSort(key) {
  if (currentSort.key === key) {
    currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.key = key;
    currentSort.dir = 'asc';
  }
  updateSortArrows();
  syncSortSelect();
  applyFilterAndSort();
}

function sortTable() {
  const val = document.getElementById('sort-select').value;
  const [key, dir] = val.split('-');
  currentSort = { key, dir };
  updateSortArrows();
  applyFilterAndSort();
}

// The dropdown only covers a few of the sortable columns — when the header
// click sorts by one it doesn't know about, deselect rather than leave a
// stale option showing.
function syncSortSelect() {
  const select = document.getElementById('sort-select');
  if (!select) return;
  const val = `${currentSort.key}-${currentSort.dir}`;
  const match = [...select.options].some(o => o.value === val);
  if (match) select.value = val;
  else select.selectedIndex = -1;
}

function sortStocks(arr) {
  const { key, dir } = currentSort;
  arr.sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSortArrows() {
  ['code', 'category', 'sector', 'ltp', 'high', 'low', 'close', 'ycp', 'change', 'trade', 'value', 'volume'].forEach(k => {
    const el = document.getElementById('sort-' + k);
    if (!el) return;
    el.textContent = currentSort.key === k ? (currentSort.dir === 'asc' ? '↑' : '↓') : '';
  });
}

// ─── CATEGORY BADGE ───────────────────────────────────────────────────────────
function catBadge(cat) {
  const c = cat === 'A' ? '#39d353' : cat === 'B' ? '#d29922' : '#8b949e';
  return `<span style="font-family:var(--mono,monospace);font-size:10px;font-weight:700;` +
    `padding:2px 6px;border-radius:3px;background:${c}22;color:${c};border:1px solid ${c}55">${cat || 'Z'}</span>`;
}

// ─── RENDER TABLE ─────────────────────────────────────────────────────────────
function fmt(n) {
  return n ? n.toLocaleString('en-BD', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) : '—';
}
function fmtVol(n) {
  if (!n) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1)     + 'K';
  return n.toLocaleString();
}
// s.value from the scraper is turnover in BDT millions; DSE market
// commentary conventionally reports turnover in crore (1 crore = 10 million).
function fmtTurnover(mn) {
  if (!mn) return '—';
  const cr = mn / 10;
  return '৳' + cr.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'Cr';
}

function renderTable(stocks) {
  const tbody  = document.getElementById('stocks-tbody');
  const footer = document.getElementById('table-footer');

  // Keep th elements in sync with current visibility
  syncMktTh();

  const v = mktColVis; // shorthand
  const visCount = MKT_COLS.filter(c => v[c.key]).length + 1; // +1 for always-visible fav col

  if (!stocks.length) {
    tbody.innerHTML = `<tr><td colspan="${visCount}" style="text-align:center;padding:40px;color:var(--text-muted);font-family:var(--mono);font-size:12px;">No results found</td></tr>`;
    footer.textContent = '';
    return;
  }

  tbody.innerHTML = stocks.map((s, i) => {
    const dir  = s.change > 0 ? 'up' : s.change < 0 ? 'dn' : '';
    const sign = s.change > 0 ? '+' : '';
    const pct  = s.ycp ? ((s.change / s.ycp) * 100).toFixed(2) : '0.00';
    return `<tr data-code="${s.code}" data-name="${escAttrApp(s.name)}" onclick="goToCompany(event,'${escAttrApp(s.code)}')" style="cursor:pointer">
      ${v.rank     ? `<td class="th-rank"                 data-col="rank"    >${i + 1}</td>` : ''}
      ${v.category ? `<td style="text-align:center"      data-col="category">${catBadge(s.category)}</td>` : ''}
      ${v.code     ? `<td class="th-code"                 data-col="code"    ><strong>${s.code}</strong></td>` : ''}
      ${v.sector   ? `<td                                  data-col="sector"  >${escAttrApp(s.sector)}</td>` : ''}
      ${v.ltp      ? `<td class="th-num"                  data-col="ltp"     >৳${fmt(s.ltp)}</td>` : ''}
      ${v.high     ? `<td class="th-num"                  data-col="high"    >${s.high  ? '৳' + fmt(s.high)  : '—'}</td>` : ''}
      ${v.low      ? `<td class="th-num"                  data-col="low"     >${s.low   ? '৳' + fmt(s.low)   : '—'}</td>` : ''}
      ${v.close    ? `<td class="th-num"                  data-col="close"   >${s.close ? '৳' + fmt(s.close) : '—'}</td>` : ''}
      ${v.ycp      ? `<td class="th-num"                  data-col="ycp"     >${s.ycp   ? '৳' + fmt(s.ycp)   : '—'}</td>` : ''}
      ${v.change   ? `<td class="th-num ${dir}"           data-col="change"  >${sign}${fmt(s.change)} <small>(${sign}${pct}%)</small></td>` : ''}
      ${v.trade    ? `<td class="th-num"                  data-col="trade"   >${s.trade ? s.trade.toLocaleString() : '—'}</td>` : ''}
      ${v.value    ? `<td class="th-num"                  data-col="value"   >${fmtTurnover(s.value)}</td>` : ''}
      ${v.volume   ? `<td class="th-num"                  data-col="volume"  >${fmtVol(s.volume)}</td>` : ''}
    </tr>`;
  }).join('');

  // Inject fav buttons (defined in index.html inline script)
  if (typeof injectFavCells === 'function') injectFavCells();

  footer.textContent = `Showing ${stocks.length} of ${allStocks.length} securities`;
}

function goToCompany(event, code) {
  // Don't navigate if click was on fav cell
  if (event.target.closest('.fav-cell')) return;
  window.location.href = `/company_profile/company.html?code=${encodeURIComponent(code)}`;
}

function escAttrApp(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  document
    .getElementById('theme-toggle-btn')
    .addEventListener('click', toggleTheme);

  document
    .getElementById('search-input')
    .addEventListener('input', filterTable);

  // Nav menu dropdown
  const navMenuBtn = document.getElementById('nav-menu-btn');
  const navMenuPanel = document.getElementById('nav-menu-panel');
  function closeNavMenu() {
    navMenuPanel.classList.remove('open');
    navMenuBtn.setAttribute('aria-expanded', 'false');
  }
  navMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    const opening = !navMenuPanel.classList.contains('open');
    navMenuPanel.classList.toggle('open', opening);
    navMenuBtn.setAttribute('aria-expanded', String(opening));
  });

  // Close column picker / nav menu when clicking outside
  document.addEventListener('click', e => {
    const backdrop = document.getElementById('mkt-col-picker-backdrop');
    const wrap = document.getElementById('mkt-col-picker-wrap');
    // Close modal if clicking outside the button and modal
    if (backdrop && backdrop.classList.contains('open') && !wrap.contains(e.target) && !backdrop.querySelector('.mkt-col-picker-modal').contains(e.target)) {
      backdrop.classList.remove('open');
      document.body.style.overflow = '';
    }
    if (navMenuPanel.classList.contains('open') && !navMenuPanel.contains(e.target) && e.target !== navMenuBtn && !navMenuBtn.contains(e.target)) {
      closeNavMenu();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const rankBackdrop = document.getElementById('rank-modal-backdrop');
    if (rankBackdrop && rankBackdrop.classList.contains('open')) closeRankModal();
    if (navMenuPanel.classList.contains('open')) closeNavMenu();
  });

  loadData();
  buildMktColPicker();

  // Auto-refresh every 5 minutes (interval configurable in /settings)
  if (window.DSESettings) window.DSESettings.everyRefresh(5 * 60 * 1000, loadData);
  else setInterval(loadData, 5 * 60 * 1000);
});

window.loadData           = loadData;
window.filterTable        = filterTable;
window.setFilter          = setFilter;
window.setCategoryFilter  = setCategoryFilter;
window.setSectorFilter    = setSectorFilter;
window.setWatchlistFilter = setWatchlistFilter;
window.sortTable          = sortTable;
window.toggleSort         = toggleSort;
window.goToCompany        = goToCompany;
window.onMktColToggle     = onMktColToggle;
window.resetMktColVis     = resetMktColVis;
window.toggleMktColPicker = toggleMktColPicker;
window.closeMktColModal   = closeMktColModal;
window.openRankModal      = openRankModal;
window.closeRankModal     = closeRankModal;