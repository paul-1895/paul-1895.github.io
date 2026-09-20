// Injects a consolidated navigation "Menu" dropdown (mirroring index.html's
// nav menu) into any page's header, so it appears site-wide.
// Self-contained: ships its own CSS (with fallbacks) so it renders reasonably
// even on pages that don't load the main style.css.
(function () {
  const NAV_SECTIONS = [
    {
      label: 'Markets',
      items: [
        { href: '/index.html', label: 'Live Market', icon: '<path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/>' },
        { href: '/candlestick_chart/candlestick.html', label: 'Candlestick', icon: '<rect x="3" y="5" width="4" height="14" rx="1"/><rect x="10" y="3" width="4" height="16" rx="1"/><rect x="17" y="7" width="4" height="12" rx="1"/>' },
        { href: '/advanced-chart/advanced-chart.html', label: 'Advanced Chart', icon: '<path d="M3 17l4-6 4 3 4-8 4 5"/><path d="M3 21h18"/>' },
        { href: '/screener/screener.html', label: 'Screener', icon: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v3h3"/>' },
        { href: '/newspaper/newspaper.html', label: 'Newspaper', icon: '<path d="M4 4h13a2 2 0 0 1 2 2v13a1 1 0 0 0 1 1"/><path d="M4 4v15a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9h-3"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="12" x2="15" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/>' },
        { href: '/economic-impact/economic-impact.html', label: 'Economic Impact', icon: '<line x1="3" y1="21" x2="21" y2="21"/><line x1="5" y1="21" x2="5" y2="10"/><line x1="10" y1="21" x2="10" y2="10"/><line x1="14" y1="21" x2="14" y2="10"/><line x1="19" y1="21" x2="19" y2="10"/><path d="M3 10l9-6 9 6"/>' },
        { href: '/bank-details/bank-details.html', label: 'Bank Details', icon: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7 12 2"/>' },
        { href: '/fi-details/fi-details.html', label: 'NBFI Details', icon: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M3 9h18M7 16v2M12 16v2M17 16v2"/>' },
        { href: '/company_profile/company.html', label: 'Company Profile', icon: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/>' },
        
        
        { href: '/history/history.html', label: 'Price History', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>' },
      ],
    },
    {
      label: 'Strategy',
      items: [
        { href: '/super_model/super-model.html', label: 'Super Model', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>' },
        { href: '/explorer_beta/explorer-beta.html', label: 'Explorer Beta', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M4 4l3 3"/><path d="M20 4l-3 3"/>' },
        { href: '/minervini_model/minervini.html', label: 'Minervini Model', icon: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>' },
        { href: '/macd_strategy1/macd-strategy1.html', label: 'MACD + 50 EMA', icon: '<path d="M3 15l4-5 4 3 3-6 4 5"/><path d="M3 20h18"/><circle cx="7" cy="10" r="1.6"/><circle cx="14" cy="7" r="1.6"/>' },
        { href: '/demo_trade/demo-trade.html', label: 'Demo Trade', icon: '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>' },
        { href: '/random_strategies/random-strategies.html', label: 'Random Strategies', icon: '<circle cx="6" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/><circle cx="6" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/><circle cx="12" cy="12" r="1.6"/>' },
      ],
    },
    {
      label: 'Portfolio',
      items: [
        
        
        
        { href: '/ultimate_report/ultimate-report.html', label: 'Ultimate Report', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>' },
        { href: '/scenario_lab/scenario-lab.html', label: 'Scenario Lab', icon: '<path d="M4 15l4-7 4 3 4-8 4 6"/><path d="M3 20h18"/>' },
        
        { href: '/mutual_fund_portfolio/mf-portfolio.html', label: 'MF Portfolio', icon: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>' },
        { href: '/mutual_fund_portfolio/mf-compare.html', label: 'MF Compare', icon: '<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/>' },
        { href: '/mutual-fund-details/mutual-fund-details.html', label: 'Mutual Fund Stocks Details', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>' },
      ],
    },
    {
      label: 'Tools',
      items: [
        { href: '/calculator/calculator.html', label: 'Calculator', icon: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="9" y2="11"/><line x1="12" y1="11" x2="13" y2="11"/><line x1="16" y1="11" x2="17" y2="11"/><line x1="8" y1="15" x2="9" y2="15"/><line x1="12" y1="15" x2="13" y2="15"/><line x1="16" y1="15" x2="17" y2="15"/><line x1="8" y1="19" x2="9" y2="19"/><line x1="12" y1="19" x2="13" y2="19"/><line x1="16" y1="19" x2="17" y2="19"/>' },
        { href: '/what-if/what-if.html', label: 'What-if Calculator', icon: '<path d="M9 9h.01M15 9h.01M9 15c1 1 5 1 6 0"/><circle cx="12" cy="12" r="9"/>' },
        { href: '/tasks/tasks.html', label: 'Tasks', icon: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/>' },
        
        
        { href: '/investment-process/investment-process.html', label: 'Investment Process', icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
        
        { href: '/learning/learning.html', label: 'Learning', icon: '<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' },
        
        { href: '/growth-ledger/growth-ledger.html', label: 'Growth Ledger', icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
        { href: '/youtube-videos/youtube-videos.html', label: 'YouTube Videos', icon: '<circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8"/>' },
        { href: '/nodes-edges/nodes-edges.html', label: 'Nodes & Edges', icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="7" y1="8" x2="11" y2="16"/><line x1="17" y1="8" x2="13" y2="16"/>' },
      ],
    },
  ];

  const CSS = `
    .gnav-cluster { display: inline-flex; align-items: center; gap: 6px; }
    .gnav-wrap { position: relative; display: inline-flex; }
    .gnav-settings-btn { padding: 6px 10px; text-decoration: none; }
    .gnav-settings-btn:hover { text-decoration: none; }
    .gnav-settings-btn svg { width: 15px; height: 15px; }
    .gnav-notebook-btn { padding: 6px 10px; }
    .gnav-notebook-btn svg { width: 15px; height: 15px; }
    .gnav-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: transparent;
      border: 1px solid var(--border, #e2e5ea);
      border-radius: var(--radius-sm, 6px);
      font-family: var(--sans, -apple-system, sans-serif);
      font-size: 12px; font-weight: 600;
      color: var(--text-secondary, #3b4151);
      cursor: pointer; white-space: nowrap;
      transition: border-color .15s ease, color .15s ease, background .15s ease;
    }
    .gnav-btn:hover, .gnav-btn[aria-expanded="true"] {
      border-color: var(--accent, #1a5cff);
      color: var(--accent, #1a5cff);
      background: var(--accent-dim, rgba(26,92,255,0.08));
    }
    .gnav-btn svg { width: 14px; height: 14px; stroke: currentColor; flex-shrink: 0; }
    .gnav-chevron { width: 10px; height: 10px; margin-left: -1px; transition: transform .18s ease; }
    .gnav-btn[aria-expanded="true"] .gnav-chevron { transform: rotate(180deg); }

    .gnav-panel {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 500;
      display: grid;
      grid-template-columns: repeat(3, minmax(168px, 1fr));
      align-content: start;
      gap: 1px 6px;
      background: var(--bg-card, #ffffff);
      border: 1px solid var(--border, #e2e5ea);
      border-radius: var(--radius-md, 10px);
      padding: 8px;
      box-shadow: 0 16px 40px rgba(15, 17, 23, 0.16);
      min-width: 540px;
      max-height: calc(100vh - 88px);
      overflow-y: auto;
      opacity: 0; visibility: hidden; pointer-events: none;
      transform: translateY(-6px) scale(0.98);
      transform-origin: top right;
      transition: opacity .16s ease, transform .16s ease, visibility .16s;
    }
    .gnav-panel.open { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0) scale(1); }

    .gnav-section-title {
      grid-column: 1 / -1;
      padding: 12px 8px 4px;
      font-family: var(--sans, -apple-system, sans-serif);
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--text-muted, #8a93a6);
    }
    .gnav-section-title:first-child { padding-top: 4px; }

    .gnav-item {
      display: flex; align-items: center; gap: 9px;
      padding: 6px 8px;
      border-radius: var(--radius-sm, 6px);
      font-family: var(--sans, -apple-system, sans-serif);
      font-size: 12.5px; font-weight: 600;
      color: var(--text-secondary, #3b4151);
      text-decoration: none; white-space: nowrap;
      transition: background .12s ease, color .12s ease;
    }
    .gnav-item:hover { background: var(--bg-row-hover, #f8f9fb); color: var(--accent, #1a5cff); text-decoration: none; }
    .gnav-item.active { background: var(--accent-dim, rgba(26,92,255,0.10)); color: var(--accent, #1a5cff); }

    .gnav-icon {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; flex-shrink: 0;
      border-radius: 7px;
      background: var(--bg-row-hover, #f8f9fb);
      color: var(--text-muted, #8a93a6);
      transition: background .12s ease, color .12s ease;
    }
    .gnav-item:hover .gnav-icon, .gnav-item.active .gnav-icon { background: var(--accent, #1a5cff); color: #fff; }
    .gnav-icon svg { width: 14px; height: 14px; stroke: currentColor; flex-shrink: 0; }

    @media (max-width: 860px) {
      .gnav-panel { grid-template-columns: repeat(2, minmax(168px, 1fr)); min-width: 360px; }
    }
    @media (max-width: 600px) {
      .gnav-panel { grid-template-columns: 1fr; min-width: 220px; right: -8px; }
      .gnav-btn span:not(.gnav-chevron) { display: none; }
      .gnav-settings-btn { padding: 6px 8px; }
    }
  `;

  function injectStyle() {
    if (document.getElementById('gnav-style')) return;
    const style = document.createElement('style');
    style.id = 'gnav-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function normalizePath(p) {
    try {
      const path = new URL(p, window.location.origin).pathname;
      return path.replace(/index\.html$/, '').replace(/\/$/, '') || '/';
    } catch {
      return p;
    }
  }

  function buildMenu() {
    const currentPath = normalizePath(window.location.pathname);

    const wrap = document.createElement('div');
    wrap.className = 'gnav-wrap';
    wrap.innerHTML = `
      <button class="gnav-btn" id="gnav-btn" aria-label="Menu" aria-haspopup="true" aria-expanded="false" title="Menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
        <span>Menu</span>
        <svg class="gnav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class="gnav-panel" id="gnav-panel">
        ${NAV_SECTIONS.map(section => `
          <div class="gnav-section-title">${section.label}</div>
          ${section.items.map(item => `
            <a href="${item.href}" class="gnav-item${normalizePath(item.href) === currentPath ? ' active' : ''}">
              <span class="gnav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg></span>
              <span>${item.label}</span>
            </a>
          `).join('')}
        `).join('')}
      </div>
    `;
    return wrap;
  }

  const SETTINGS_HREF = '/settings/settings.html';

  function buildSettingsButton() {
    const a = document.createElement('a');
    a.className = 'gnav-btn gnav-settings-btn';
    a.id = 'gnav-settings-btn';
    a.href = SETTINGS_HREF;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Settings';
    a.setAttribute('aria-label', 'Settings');
    a.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.61.78 1.03 1.42 1.03H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <span>Settings</span>
    `;
    return a;
  }

  function buildNotebookButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gnav-btn gnav-notebook-btn';
    b.id = 'gnav-notebook-btn';
    b.title = 'Notebook';
    b.setAttribute('aria-label', 'Notebook');
    // Backend-persisted (writes to big-data/store/notebooks/notebooks.json)
    // — hidden on the read-only static build via the generic [data-write]
    // hook, same as the watchlist buttons.
    b.setAttribute('data-write', '');
    b.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>
        <path d="M4 6.5h4"/><path d="M4 12h4"/><path d="M4 17.5h4"/>
      </svg>
      <span>Notebook</span>
    `;
    return b;
  }

  function wireNotebookModal(b) {
    if (window.DSENotebookModal) {
      window.DSENotebookModal.wireButton(b);
      return;
    }
    const existing = document.querySelector('script[src="/shared/notebook-modal.js"]');
    if (existing) {
      existing.addEventListener('load', () => window.DSENotebookModal.wireButton(b), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = '/shared/notebook-modal.js';
    s.addEventListener('load', () => window.DSENotebookModal.wireButton(b), { once: true });
    document.head.appendChild(s);
  }

  function wireSettingsModal(a) {
    if (window.DSESettingsModal) {
      window.DSESettingsModal.wireLink(a);
      return;
    }
    const existing = document.querySelector('script[src="/shared/settings-modal.js"]');
    if (existing) {
      existing.addEventListener('load', () => window.DSESettingsModal.wireLink(a), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = '/shared/settings-modal.js';
    s.addEventListener('load', () => window.DSESettingsModal.wireLink(a), { once: true });
    document.head.appendChild(s);
  }

  function findContainer() {
    const selectors = [
      '.header-meta', '.tv-header-nav', '.header-actions',
      '.header-inner', 'header',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function init() {
    if (document.getElementById('gnav-btn')) return;
    injectStyle();

    const menu = buildMenu();
    const cluster = document.createElement('div');
    cluster.className = 'gnav-cluster';
    cluster.appendChild(menu);

    // The Settings page itself opens inside an iframe modal on every other
    // page. Inside that frame the menu must break out to the top window, and
    // a Settings button would only open a second modal inside the first.
    const framed = window.self !== window.top;
    const onSettingsPage = /\/settings\/settings\.html$/i.test(location.pathname);
    if (framed) menu.querySelectorAll('a[href]').forEach(a => { if (!a.target) a.target = '_top'; });

    let settingsBtn = document.getElementById('gnav-settings-btn');
    if (!settingsBtn && !onSettingsPage) {
      settingsBtn = buildSettingsButton();
      cluster.appendChild(settingsBtn);
    }
    if (settingsBtn) wireSettingsModal(settingsBtn);

    let notebookBtn = document.getElementById('gnav-notebook-btn');
    if (!notebookBtn) {
      notebookBtn = buildNotebookButton();
      cluster.appendChild(notebookBtn);
    }
    wireNotebookModal(notebookBtn);

    // A page can opt into an exact position by including <div id="gnav-mount">
    // wherever the menu button should sit; otherwise fall back to prepending
    // into whatever header container we can find.
    const mount = document.getElementById('gnav-mount');
    if (mount) {
      mount.replaceWith(cluster);
    } else {
      const container = findContainer();
      if (container) {
        container.insertBefore(cluster, container.firstChild);
      } else {
        cluster.style.cssText = 'position:fixed; top:12px; right:12px; z-index:1000;';
        document.body.appendChild(cluster);
      }
    }

    const navMenuBtn = document.getElementById('gnav-btn');
    const navMenuPanel = document.getElementById('gnav-panel');

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

    document.addEventListener('click', e => {
      if (navMenuPanel.classList.contains('open') && !navMenuPanel.contains(e.target) && e.target !== navMenuBtn && !navMenuBtn.contains(e.target)) {
        closeNavMenu();
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && navMenuPanel.classList.contains('open')) closeNavMenu();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
