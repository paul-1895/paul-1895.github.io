/**
 * Header Component - Shared across all DSE Live Market pages
 * Provides: Header HTML injection, theme management, and initialization
 */

/**
 * Inject the fixed header into the page
 * Call this early in your page's script, before any other DOM manipulation
 */
export function injectHeader() {
  const headerHTML = `
    <header class="site-header">
      <div class="header-inner">
        <!-- Logo Block -->
        <div class="logo-block">
          <span class="logo-tag">DSE</span>
          <div class="logo-text">
            <h1>Live Market</h1>
            <p>Dhaka Stock Exchange — All Listed Securities</p>
          </div>
        </div>

        <!-- Header Meta & Navigation -->
        <div class="header-meta">
          <!-- Last Updated -->
          <div class="meta-item">
            <span class="meta-label">LAST UPDATED</span>
            <span class="meta-value" id="last-updated">—</span>
          </div>

          <!-- Total Listed -->
          <div class="meta-item">
            <span class="meta-label">TOTAL LISTED</span>
            <span class="meta-value" id="total-count">—</span>
          </div>

          <!-- Watchlist Button -->
          <button class="wl-toggle-btn has-tooltip" id="wl-toggle-btn" 
                  onclick="openWatchlistPanel()" data-tooltip="Watchlists" aria-label="Watchlists">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span class="wl-count-badge" id="wl-count-badge">0</span>
          </button>

          <!-- Screener Button -->
          <button class="screener-toggle-btn has-tooltip" onclick="openScreener()" 
                  data-tooltip="Screener" aria-label="Screener">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
              <path d="M11 8v3h3"/>
            </svg>
            <span class="screener-badge" id="screener-badge">0</span>
          </button>

          <!-- Portfolio Navigation -->
          
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="14" rx="2"/>
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/>
              <line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
          

          <!-- Learning Navigation -->
          <a href="/learning/learning.html" class="wl-toggle-btn has-tooltip"
             style="text-decoration:none;" data-tooltip="Learning" aria-label="Learning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </a>

          <!-- Candlestick Navigation -->
          <a href="/candlestick_chart/candlestick.html" class="wl-toggle-btn has-tooltip" 
             style="text-decoration:none;" data-tooltip="Candlestick" aria-label="Candlestick">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="5" width="4" height="14" rx="1"/>
              <rect x="10" y="3" width="4" height="16" rx="1"/>
              <rect x="17" y="7" width="4" height="12" rx="1"/>
            </svg>
          </a>

          <!-- Calculator Navigation -->
          <a href="/calculator/calculator.html" class="wl-toggle-btn has-tooltip" 
             style="text-decoration:none;" data-tooltip="Calculator" aria-label="Calculator">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="4" y="2" width="16" height="20" rx="2"/>
              <line x1="8" y1="7" x2="16" y2="7"/>
              <line x1="8" y1="11" x2="9" y2="11"/>
              <line x1="12" y1="11" x2="13" y2="11"/>
              <line x1="16" y1="11" x2="17" y2="11"/>
              <line x1="8" y1="15" x2="9" y2="15"/>
              <line x1="12" y1="15" x2="13" y2="15"/>
              <line x1="16" y1="15" x2="17" y2="15"/>
              <line x1="8" y1="19" x2="9" y2="19"/>
              <line x1="12" y1="19" x2="13" y2="19"/>
              <line x1="16" y1="19" x2="17" y2="19"/>
            </svg>
          </a>

          <!-- Gain Projection Navigation -->
          
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3v18h18"/>
              <path d="M7 12l3-3 3 3 5-6"/>
              <path d="M18 6h3v3" stroke-dasharray="2 2"/>
            </svg>
          

          <!-- Refresh Button -->
          <button class="refresh-btn has-tooltip" id="refresh-btn" 
                  onclick="loadData()" data-tooltip="Refresh" aria-label="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6"/>
              <path d="M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
          </button>

          <!-- Theme Toggle Button -->
          <button class="theme-toggle has-tooltip" id="theme-toggle-btn" 
                  data-tooltip="Toggle light/dark mode" aria-label="Toggle light/dark mode">
            <span class="toggle-icon" id="theme-icon">☀️</span>
            <span id="theme-label">Light</span>
          </button>
        </div>
      </div>
    </header>
  `;

  // Insert header at the very beginning of body
  document.body.insertAdjacentHTML('afterbegin', headerHTML);
}

/**
 * Initialize all header functionality
 * Attach event listeners, load theme preferences, etc.
 */
export function initHeaderFunctionality() {
  // Theme toggle
  const themeToggle = document.getElementById('theme-toggle-btn');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Load and apply saved theme
  loadSavedTheme();
}

/**
 * Toggle between light and dark theme
 */
function toggleTheme() {
  const root = document.documentElement;
  const currentTheme = root.classList.contains('light-mode') ? 'dark' : 'light';
  applyTheme(currentTheme);
}

/**
 * Apply theme and save to localStorage
 */
function applyTheme(theme) {
  const root = document.documentElement;
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');

  if (!icon || !label) return;

  if (theme === 'light') {
    root.classList.add('light-mode');
    icon.textContent = '🌙';
    label.textContent = 'Dark';
    localStorage.setItem('dse-theme', 'light');
  } else {
    root.classList.remove('light-mode');
    icon.textContent = '☀️';
    label.textContent = 'Light';
    localStorage.setItem('dse-theme', 'dark');
  }
}

/**
 * Load saved theme preference from localStorage
 */
function loadSavedTheme() {
  try {
    const savedTheme = localStorage.getItem('dse-theme') || 'dark';
    applyTheme(savedTheme);
  } catch (e) {
    console.warn('Could not load saved theme preference:', e);
    applyTheme('dark');
  }
}

/**
 * Update header meta information
 * @param {Object} data - Data object with keys: lastUpdated, totalCount
 */
export function updateHeaderMeta(data = {}) {
  const lastUpdated = document.getElementById('last-updated');
  const totalCount = document.getElementById('total-count');

  if (lastUpdated && data.lastUpdated) {
    lastUpdated.textContent = data.lastUpdated;
  }

  if (totalCount && data.totalCount) {
    totalCount.textContent = data.totalCount;
  }
}

/**
 * Update watchlist count badge
 * @param {number} count - Number of items in watchlist
 */
export function updateWatchlistBadge(count = 0) {
  const badge = document.getElementById('wl-count-badge');
  if (badge) {
    badge.textContent = count;
  }
}

/**
 * Update screener badge count
 * @param {number} count - Number of screened items
 */
export function updateScreenerBadge(count = 0) {
  const badge = document.getElementById('screener-badge');
  if (badge) {
    badge.textContent = count;
  }
}

/**
 * Get current theme
 * @returns {string} 'light' or 'dark'
 */
export function getCurrentTheme() {
  return document.documentElement.classList.contains('light-mode') ? 'light' : 'dark';
}

/**
 * Check if currently in light mode
 * @returns {boolean}
 */
export function isLightMode() {
  return document.documentElement.classList.contains('light-mode');
}

/**
 * Cleanup/destroy header (rarely needed)
 */
export function destroyHeader() {
  const header = document.querySelector('.site-header');
  if (header) {
    header.remove();
  }
}

/* ── Global Stubs ────────────────────────────────────────────────── */
/* These should be defined in your page-specific scripts, but we provide defaults */

if (typeof window.openWatchlistPanel === 'undefined') {
  window.openWatchlistPanel = function() {
    console.log('openWatchlistPanel() not implemented on this page');
  };
}

if (typeof window.closeWatchlistPanel === 'undefined') {
  window.closeWatchlistPanel = function() {
    console.log('closeWatchlistPanel() not implemented on this page');
  };
}

if (typeof window.openScreener === 'undefined') {
  window.openScreener = function() {
    console.log('openScreener() not implemented on this page');
  };
}

if (typeof window.loadData === 'undefined') {
  window.loadData = function() {
    console.log('loadData() not implemented on this page');
  };
}