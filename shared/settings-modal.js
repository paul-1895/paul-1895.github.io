/* Shared "Settings" modal: loads /settings/settings.html into an
   overlay iframe instead of navigating away. Any link with
   id="settings-btn" already in the page is auto-wired; other callers
   (e.g. nav-menu.js's injected button) use wireLink(el) or open()
   directly once this script has loaded. */
(function () {
  if (window.DSESettingsModal) return;

  const SETTINGS_HREF = '/settings/settings.html';

  const CSS = `
    .dse-settings-backdrop {
      display: none;
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(3px);
      align-items: center; justify-content: center;
      padding: 24px;
    }
    .dse-settings-backdrop.open {
      display: flex;
      animation: dse-settings-backdrop-in 0.2s ease;
    }
    @keyframes dse-settings-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

    .dse-settings-modal {
      position: relative;
      width: 100%; max-width: 1180px; height: 90vh;
      background: var(--bg-card, #ffffff);
      border: 1px solid var(--border, #e2e5ea);
      border-radius: 14px;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      animation: dse-settings-modal-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes dse-settings-modal-in {
      from { opacity: 0; transform: translateY(-20px) scale(0.97); }
      to { opacity: 1; transform: none; }
    }

    .dse-settings-modal iframe {
      width: 100%; height: 100%;
      border: 0; display: block;
      background: var(--bg-card, #ffffff);
    }

    .dse-settings-close {
      position: absolute; top: 10px; right: 10px; z-index: 1;
      width: 30px; height: 30px;
      display: flex; align-items: center; justify-content: center;
      background: var(--bg-card, #ffffff);
      border: 1px solid var(--border, #e2e5ea);
      border-radius: 50%;
      color: var(--text-secondary, #3b4151);
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(15, 17, 23, 0.18);
      transition: color .15s ease, border-color .15s ease;
    }
    .dse-settings-close:hover { color: var(--accent, #1a5cff); border-color: var(--accent, #1a5cff); }
    .dse-settings-close svg { width: 15px; height: 15px; }

    @media (max-width: 600px) {
      .dse-settings-backdrop { padding: 0; }
      .dse-settings-modal { max-width: none; width: 100%; height: 100%; border-radius: 0; }
    }
  `;

  function injectStyle() {
    if (document.getElementById('dse-settings-modal-style')) return;
    const style = document.createElement('style');
    style.id = 'dse-settings-modal-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  let backdrop = null;
  let iframe = null;
  let openerEl = null;

  function build() {
    injectStyle();
    backdrop = document.createElement('div');
    backdrop.className = 'dse-settings-backdrop';
    backdrop.id = 'dse-settings-backdrop';
    backdrop.innerHTML = `
      <div class="dse-settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <button type="button" class="dse-settings-close" title="Close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <iframe title="Settings"></iframe>
      </div>
    `;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.dse-settings-close').addEventListener('click', close);
    document.body.appendChild(backdrop);
    iframe = backdrop.querySelector('iframe');
  }

  function open() {
    if (!backdrop) build();
    if (!iframe.src) iframe.src = SETTINGS_HREF;
    openerEl = document.activeElement;
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    backdrop.querySelector('.dse-settings-close').focus();
  }

  function close() {
    if (!backdrop) return;
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (openerEl && openerEl.focus) openerEl.focus();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop && backdrop.classList.contains('open')) close();
  });

  function wireLink(a) {
    if (!a || a.dataset.settingsModalWired) return;
    a.dataset.settingsModalWired = '1';
    a.removeAttribute('target');
    a.addEventListener('click', e => {
      // Let the browser handle modifier/middle clicks (new tab, new window) as normal.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      open();
    });
  }

  function wireExistingLinks() {
    document.querySelectorAll('#settings-btn').forEach(wireLink);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireExistingLinks);
  } else {
    wireExistingLinks();
  }

  window.DSESettingsModal = { open, close, wireLink };
})();
