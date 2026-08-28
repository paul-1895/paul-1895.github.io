/* ════════════════════════════════════════════════════════════
   stock-search.js
   Stock symbol search modal for candlestick chart.
   Click on stock symbol in legend to search and load any DSE stock.
   
   Depends on: candlestick-data.js, stock-categories.json
   Consumed by: candlestick.html (included via script tag)
════════════════════════════════════════════════════════════ */

let _allStockSymbols = [];

// ─── Initialize stock search on page load ───────────────────
function initStockSearch() {
  loadStockSymbols();
  setupStockSearchModal();
  setupSymbolClickHandler();
}

// ─── Load stock symbols from stock-categories.json ─────────────
async function loadStockSymbols() {
  try {
    const paths = [
      '/data/stock-categories.json',
      '../data/stock-categories.json',
      './data/stock-categories.json'
    ];
    
    for (const path of paths) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const data = await response.json();
          _allStockSymbols = Object.keys(data.categories || {}).sort();
          console.log(`[StockSearch] Loaded ${_allStockSymbols.length} symbols from ${path}`);
          return;
        }
      } catch (e) {
        // Continue to next path
      }
    }
    console.warn('[StockSearch] Could not load stock-categories.json from any path');
  } catch (err) {
    console.error('[StockSearch] Error loading symbols:', err);
  }
}

// ─── Setup stock search modal HTML ───────────────────────────
function setupStockSearchModal() {
  if (document.getElementById('stockSearchModal')) return;
  
  const html = `
<div id="stockSearchModal" class="modal stock-search-modal" style="display:none;">
  <div class="modal-overlay" onclick="closeStockSearchModal()"></div>
  <div class="modal-content stock-search-content">
    <div class="modal-header">
      <h2>Search DSE Stocks</h2>
      <button class="modal-close" onclick="closeStockSearchModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    
    <div class="stock-search-container">
      <div class="stock-search-box">
        <svg class="stock-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input 
          type="text" 
          id="stockSearchInput" 
          class="stock-search-input" 
          placeholder="Search symbol (e.g., EBL, BPML)…"
          onkeyup="filterStockList()" 
          onkeydown="handleStockSearchKeydown(event)"
          autocomplete="off"
        />
        <button 
          class="stock-search-clear" 
          id="stockSearchClear" 
          onclick="clearStockSearch()" 
          style="display:none;" 
          title="Clear search"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      
      <div id="stockList" class="stock-list"></div>
      <div class="stock-search-empty" style="display:none;">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p>No stocks found</p>
        </div>
      </div>
    </div>
  </div>
</div>`;
  
  document.body.insertAdjacentHTML('beforeend', html);
}

// ─── Setup click handler for stock symbol in legend ──────────
function setupSymbolClickHandler() {
  document.addEventListener('click', (e) => {
    // Check if clicked on legend symbol name or toolbar ticker
    const legendName = e.target.closest('.legend-name');
    const tvTicker = e.target.closest('.tv-ticker');
    
    if (legendName || tvTicker) {
      e.stopPropagation();
      openStockSearchModal();
    }
  });
}

// ─── Open stock search modal ─────────────────────────────────
function openStockSearchModal() {
  const modal = document.getElementById('stockSearchModal');
  const input = document.getElementById('stockSearchInput');
  
  if (modal) {
    modal.style.display = 'flex';
    
    if (input) {
      input.value = '';
      input.focus();
    }
    
    // Show first 30 stocks on open
    populateStockList(_allStockSymbols.slice(0, 30));
  }
}

// ─── Close stock search modal ────────────────────────────────
function closeStockSearchModal() {
  const modal = document.getElementById('stockSearchModal');
  if (modal) modal.style.display = 'none';
}

// ─── Filter and display stock list ───────────────────────────
function filterStockList() {
  const input = document.getElementById('stockSearchInput');
  const query = input.value.trim().toUpperCase();
  const clearBtn = document.getElementById('stockSearchClear');
  
  // Toggle clear button visibility
  if (clearBtn) {
    clearBtn.style.display = query ? 'flex' : 'none';
  }
  
  // Show all if empty
  if (!query) {
    populateStockList(_allStockSymbols.slice(0, 30));
    return;
  }
  
  // Filter symbols that include the query
  const filtered = _allStockSymbols.filter(symbol => {
    return symbol.includes(query);
  });
  
  populateStockList(filtered);
}

// ─── Clear search input ──────────────────────────────────────
function clearStockSearch() {
  const input = document.getElementById('stockSearchInput');
  if (input) {
    input.value = '';
    input.focus();
    filterStockList();
  }
}

// ─── Populate stock list in modal ────────────────────────────
function populateStockList(symbols) {
  const list = document.getElementById('stockList');
  const empty = document.querySelector('.stock-search-empty');
  
  if (!list) return;
  
  // Clear previous list
  list.innerHTML = '';
  
  // Show empty state if no results
  if (symbols.length === 0) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  
  if (empty) empty.style.display = 'none';
  
  // Limit to 100 results for performance
  const displaySymbols = symbols.slice(0, 100);
  
  displaySymbols.forEach((symbol, idx) => {
    const item = document.createElement('div');
    item.className = 'stock-item';
    item.tabIndex = idx;
    
    item.innerHTML = `
      <span class="stock-symbol">${symbol}</span>
      <span class="stock-action">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </span>`;
    
    // Click to load stock
    item.addEventListener('click', () => {
      loadStockChart(symbol);
    });
    
    // Keyboard navigation
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        loadStockChart(symbol);
      } else if (e.key === 'ArrowDown' && idx < displaySymbols.length - 1) {
        e.preventDefault();
        list.children[idx + 1]?.focus();
      } else if (e.key === 'ArrowUp' && idx > 0) {
        e.preventDefault();
        list.children[idx - 1]?.focus();
      }
    });
    
    list.appendChild(item);
  });
  
  // Do NOT auto-focus the first item — that steals focus from the search input while typing.
  // The user can press ArrowDown to navigate into the list.
}

// ─── Handle keyboard navigation in search input ───────────────
function handleStockSearchKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const firstItem = document.querySelector('.stock-item');
    if (firstItem) firstItem.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeStockSearchModal();
  }
}

// ─── Load chart for selected stock ──────────────────────
function loadStockChart(symbol) {
  if (!symbol) return;
  
  console.log(`[StockSearch] Loading chart for: ${symbol}`);
  
  // Close modal first
  closeStockSearchModal();
  
  // Use the centralized reload function if available
  if (typeof window.reloadChartForSymbol === 'function') {
    window.reloadChartForSymbol(symbol);
  } else {
    // Fallback for when reloadChartForSymbol is not yet loaded
    const upperSymbol = symbol.toUpperCase();
    const url = new URL(window.location);
    url.searchParams.set('code', upperSymbol);
    window.history.pushState({code: symbol}, '', url.toString());
    
    chartData = [];
    aggregatedData = [];
    replayMode = false;
    replayIndex = 0;
    zoomLevel = 1;
    vZoomLevel = 1;
    paneVZoom = { volume: 1, macd: 1, rsi: 1, hm: 1 };
    panOffset = 0;
    currentTimeframe = 'daily';
    
    const loadingEl = document.getElementById('loadingState');
    const canvas = document.getElementById('candleCanvas');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (canvas) canvas.style.display = 'none';
    
    document.querySelectorAll('.tv-ticker, .legend-name').forEach(el => {
      el.textContent = upperSymbol;
    });
    if (document.getElementById('headerLogoTag')) {
      document.getElementById('headerLogoTag').textContent = upperSymbol;
    }
    document.title = `${upperSymbol} Candlestick Chart — Professional Trading View`;
    
    setTimeout(() => {
      if (typeof loadData === 'function') {
        loadData();
      }
    }, 100);
  }
}

// ─── Initialize on DOM ready ────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure stock-categories.json is accessible
  setTimeout(initStockSearch, 500);
});

// Fallback for cases where DOMContentLoaded already fired
window.addEventListener('load', () => {
  if (_allStockSymbols.length === 0) {
    initStockSearch();
  }
});