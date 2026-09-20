/* ================================================================
   notifications.js  —  Notification system for DSE market app
   Handles: storage, SR price-hit detection, badge, modal, toasts
   ================================================================ */
'use strict';

(function () {

  /* ── STORAGE KEY & HELPERS ─────────────────────────────────── */
  const STORE_KEY = 'dse-notifications';
  const SEEN_KEY  = 'dse-notif-seen-today'; // {code_price_type: "YYYY-MM-DD"}

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  }

  function save(list) {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
    catch { return {}; }
  }

  function saveSeen(map) {
    localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  }

  /* ── DEDUP: one notification per (code, price, type) per day ── */
  function alreadySeenToday(code, price, type) {
    const map = loadSeen();
    const key = `${code}_${price}_${type}`;
    return map[key] === today();
  }

  function markSeen(code, price, type) {
    const map = loadSeen();
    const key = `${code}_${price}_${type}`;
    map[key] = today();
    // Prune old entries (keep only today's)
    Object.keys(map).forEach(k => { if (map[k] !== today()) delete map[k]; });
    saveSeen(map);
  }

  /* ── ADD NOTIFICATION ──────────────────────────────────────── */
  function addNotification({ title, body, type, code, price, level }) {
    // Muted from /settings — drop the alert instead of storing it.
    if (window.DSESettings && !window.DSESettings.notificationsEnabled()) return null;

    const list = load();
    const notif = {
      id:        crypto.randomUUID(),
      title,
      body,
      type,       // 'support' | 'resistance' | 'info'
      code,
      price,
      level,
      read:      false,
      createdAt: new Date().toISOString(),
    };
    list.unshift(notif);
    // Keep max 100 notifications
    if (list.length > 100) list.splice(100);
    save(list);
    updateBadge();
    showToast(notif);
    return notif;
  }

  /* ── PUBLIC: called from sr-levels.js ─────────────────────── */
  window.DSENotif = {
    /**
     * Check if LTP has hit a support or resistance level.
     * Called whenever LTP is loaded on company page.
     * @param {string} code   - Stock trading code
     * @param {number} ltp    - Last traded price
     * @param {Array}  levels - Array of {price, note, type}
     */
    checkSRHit(code, ltp, levels) {
      if (!code || !ltp || !levels?.length) return;
      const tolerance = ltp * 0.003; // 0.3% tolerance band

      levels.forEach(({ price, note, type }) => {
        if (alreadySeenToday(code, price, type)) return;
        if (Math.abs(ltp - price) <= tolerance) {
          markSeen(code, price, type);
          const isSupport = type === 'support';
          addNotification({
            title: `${code} hit ${isSupport ? 'Support' : 'Resistance'}`,
            body:  `LTP ৳${fmt(ltp)} reached ${isSupport ? 'support' : 'resistance'} at ৳${fmt(price)}${note ? ' — ' + note : ''}`,
            type,
            code,
            price,
            level: note || '',
          });
        }
      });
    },

    /** Manually create an info notification */
    push(title, body) {
      addNotification({ title, body, type: 'info' });
    },
  };

  /* ── BADGE ─────────────────────────────────────────────────── */
  function updateBadge() {
    const unread = load().filter(n => !n.read).length;
    const badge  = document.getElementById('notif-badge');
    const btn    = document.getElementById('notif-btn');
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : unread;
    badge.classList.toggle('visible', unread > 0);
    if (unread > 0 && btn) {
      btn.classList.remove('ring');
      void btn.offsetWidth;
      btn.classList.add('ring');
    }
  }

  /* ── TOAST ─────────────────────────────────────────────────── */
  function showToast(notif) {
    let wrap = document.getElementById('notif-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'notif-toast-wrap';
      wrap.className = 'notif-toast-wrap';
      document.body.appendChild(wrap);
    }

    const icon = notif.type === 'support' ? '🛡️' : notif.type === 'resistance' ? '⚡' : '🔔';
    const el = document.createElement('div');
    el.className = `notif-toast ${notif.type}`;
    el.innerHTML = `
      <div class="notif-toast-icon">${icon}</div>
      <div class="notif-toast-body">
        <div class="notif-toast-title">${esc(notif.title)}</div>
        <div class="notif-toast-msg">${esc(notif.body)}</div>
      </div>
      <button class="notif-toast-close" title="Dismiss">✕</button>`;
    el.querySelector('.notif-toast-close').onclick = () => dismissToast(el);
    wrap.appendChild(el);
    setTimeout(() => dismissToast(el), 6000);
  }

  function dismissToast(el) {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateY(10px)';
    setTimeout(() => el.remove(), 300);
  }

  /* ── MODAL ─────────────────────────────────────────────────── */
  let activeFilter = 'all';

  function openModal() {
    markAllRead();
    renderPanel();
    document.getElementById('notif-backdrop').classList.add('open');
    document.getElementById('notif-backdrop').addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEsc);
  }

  function closeModal() {
    document.getElementById('notif-backdrop').classList.remove('open');
    document.removeEventListener('keydown', handleEsc);
    updateBadge();
  }

  function handleBackdropClick(e) {
    if (e.target === document.getElementById('notif-backdrop')) closeModal();
  }
  function handleEsc(e) { if (e.key === 'Escape') closeModal(); }

  function markAllRead() {
    const list = load().map(n => ({ ...n, read: true }));
    save(list);
    updateBadge();
  }

  function renderPanel() {
    const all   = load();
    const shown = activeFilter === 'all'        ? all
                : activeFilter === 'support'    ? all.filter(n => n.type === 'support')
                : activeFilter === 'resistance' ? all.filter(n => n.type === 'resistance')
                : all;

    // Update unread count label
    const unread = all.filter(n => !n.read).length;
    const countEl = document.getElementById('notif-unread-count');
    if (countEl) {
      countEl.textContent = unread > 0 ? `${unread} unread` : 'All read';
    }

    // Update filter tab counts
    document.querySelectorAll('.notif-filter-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.filter === activeFilter);
    });

    const list = document.getElementById('notif-list');
    if (!list) return;

    if (!shown.length) {
      list.innerHTML = `
        <div class="notif-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <div class="notif-empty-title">All quiet</div>
          <div>No ${activeFilter === 'all' ? '' : activeFilter + ' '}notifications yet</div>
        </div>`;
      return;
    }

    list.innerHTML = shown.map(n => {
      const icon   = n.type === 'support' ? '🛡️' : n.type === 'resistance' ? '⚡' : '🔔';
      const timeAgo = relTime(n.createdAt);
      const dateStr = new Date(n.createdAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      return `
        <div class="notif-item${n.read ? '' : ' unread'}" data-id="${n.id}">
          <div class="notif-icon ${n.type}">${icon}</div>
          <div class="notif-content">
            <div class="notif-content-top">
              <div class="notif-title">${esc(n.title)}</div>
              <div class="notif-time" title="${dateStr}">${timeAgo}</div>
            </div>
            <div class="notif-body">${formatBody(n)}</div>
            <div class="notif-tags">
              ${n.type !== 'info' ? `<span class="notif-tag ${n.type}">${n.type.toUpperCase()}</span>` : ''}
              ${n.code ? `<span class="notif-tag info" style="color:#58a6ff;border-color:rgba(88,166,255,.3);background:rgba(88,166,255,.08)">${esc(n.code)}</span>` : ''}
            </div>
          </div>
          <button class="notif-del" data-id="${n.id}" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>`;
    }).join('');

    // Bind delete buttons
    list.querySelectorAll('.notif-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteNotif(btn.dataset.id);
      });
    });
  }

  function formatBody(n) {
    if (!n.code || !n.price) return esc(n.body);
    return n.body
      .replace(n.code, `<span class="notif-code">${esc(n.code)}</span>`)
      .replace(`৳${fmt(n.price)}`, `<span class="notif-price ${n.type}">৳${fmt(n.price)}</span>`);
  }

  function deleteNotif(id) {
    const list = load().filter(n => n.id !== id);
    save(list);
    renderPanel();
    updateBadge();
  }

  function clearAll() {
    if (!confirm('Clear all notifications?')) return;
    save([]);
    renderPanel();
    updateBadge();
  }

  /* ── TIME HELPERS ──────────────────────────────────────────── */
  function relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m    = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function fmt(n) {
    return parseFloat(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── BUILD DOM ─────────────────────────────────────────────── */
  function buildPanelDOM() {
    // Backdrop + panel
    const backdrop = document.createElement('div');
    backdrop.id        = 'notif-backdrop';
    backdrop.className = 'notif-backdrop';
    backdrop.innerHTML = `
      <div class="notif-panel">
        <div class="notif-panel-hd">
          <div class="notif-panel-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            NOTIFICATIONS
            <span class="notif-unread-count" id="notif-unread-count">0 unread</span>
          </div>
          <div class="notif-hd-actions">
            <button class="notif-hd-btn" id="notif-clear-btn">Clear all</button>
            <button class="notif-close-btn" id="notif-close-btn">✕</button>
          </div>
        </div>
        <div class="notif-filters">
          <button class="notif-filter-tab active" data-filter="all">All</button>
          <button class="notif-filter-tab" data-filter="support">Support</button>
          <button class="notif-filter-tab" data-filter="resistance">Resistance</button>
        </div>
        <div class="notif-list" id="notif-list"></div>
        <div class="notif-panel-ft">
          <span><span class="notif-ft-dot"></span>Price alerts active</span>
          <span id="notif-ft-count">0 total</span>
        </div>
      </div>`;

    document.body.appendChild(backdrop);

    document.getElementById('notif-close-btn').addEventListener('click', closeModal);
    document.getElementById('notif-clear-btn').addEventListener('click', clearAll);

    backdrop.querySelectorAll('.notif-filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeFilter = tab.dataset.filter;
        renderPanel();
      });
    });
  }

  /* ── INJECT BELL BUTTON ────────────────────────────────────── */
  function injectBellButton() {
    const meta = document.querySelector('.header-meta');
    if (!meta) return;

    const btn = document.createElement('button');
    btn.id        = 'notif-btn';
    btn.className = 'notif-btn';
    btn.title     = 'Notifications';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span class="notif-badge" id="notif-badge"></span>`;
    btn.addEventListener('click', openModal);

    // Insert before the theme toggle (last button in header-meta)
    const themeBtn = meta.querySelector('.theme-toggle');
    themeBtn ? meta.insertBefore(btn, themeBtn) : meta.appendChild(btn);
  }

  /* ── INIT ──────────────────────────────────────────────────── */
  function init() {
    injectBellButton();
    buildPanelDOM();
    updateBadge();

    // Update footer count whenever modal closes
    const observer = new MutationObserver(() => {
      const ftCount = document.getElementById('notif-ft-count');
      if (ftCount) ftCount.textContent = `${load().length} total`;
    });
    const backdrop = document.getElementById('notif-backdrop');
    if (backdrop) observer.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
