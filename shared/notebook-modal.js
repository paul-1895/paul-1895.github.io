/* Shared "Notebook" modal: a small CRUD notes app (create / rename /
   delete notepads, rich-text content) opened from the header Notebook
   button injected by shared/nav-menu.js. Content is persisted server-side
   via /api/notebooks (data/notebooks.json) so it survives across devices/
   browsers, same storage style as the Task Board (routes/tasks.js). */
(function () {
  if (window.DSENotebookModal) return;

  const API = '/api/notebooks';

  const CSS = `
    .dse-nb-backdrop {
      display: none;
      position: fixed; inset: 0; z-index: 9998;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(3px);
      align-items: center; justify-content: center;
      padding: 24px;
    }
    .dse-nb-backdrop.open { display: flex; animation: dse-nb-backdrop-in 0.2s ease; }
    @keyframes dse-nb-backdrop-in { from { opacity: 0; } to { opacity: 1; } }

    .dse-nb-modal {
      position: relative;
      width: 100%; max-width: 1040px; height: 88vh; max-height: 720px;
      display: flex; flex-direction: column;
      background: var(--bg-card, #ffffff);
      border: 1px solid var(--border, #e2e5ea);
      border-radius: 14px;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      font-family: var(--sans, -apple-system, sans-serif);
      animation: dse-nb-modal-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes dse-nb-modal-in {
      from { opacity: 0; transform: translateY(-20px) scale(0.97); }
      to { opacity: 1; transform: none; }
    }

    .dse-nb-hd {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border, #e2e5ea);
      flex-shrink: 0;
    }
    .dse-nb-hd h2 {
      margin: 0; font-size: 14px; font-weight: 700;
      color: var(--text-primary, #0f1117);
    }
    .dse-nb-close {
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid var(--border, #e2e5ea);
      border-radius: 50%;
      color: var(--text-secondary, #3b4151);
      cursor: pointer;
      transition: color .15s ease, border-color .15s ease;
    }
    .dse-nb-close:hover { color: var(--accent, #1a5cff); border-color: var(--accent, #1a5cff); }
    .dse-nb-close svg { width: 14px; height: 14px; }

    .dse-nb-banner {
      display: none;
      padding: 8px 18px;
      background: rgba(209,63,63,0.10);
      border-bottom: 1px solid var(--loss, #d13f3f);
      color: var(--loss, #d13f3f);
      font-size: 12px; font-weight: 600;
      flex-shrink: 0;
    }
    .dse-nb-banner.show { display: block; }

    .dse-nb-body { display: flex; flex: 1; min-height: 0; }

    .dse-nb-sidebar {
      width: 240px; flex-shrink: 0;
      display: flex; flex-direction: column;
      border-right: 1px solid var(--border, #e2e5ea);
      background: var(--bg-base, #f4f5f7);
      overflow: hidden;
    }
    .dse-nb-new-btn {
      margin: 12px; padding: 9px 12px;
      display: flex; align-items: center; justify-content: center; gap: 6px;
      background: var(--accent, #1a5cff); color: #fff;
      border: none; border-radius: var(--radius-sm, 6px);
      font-size: 12.5px; font-weight: 700;
      cursor: pointer;
      transition: opacity .15s ease;
    }
    .dse-nb-new-btn:hover { opacity: 0.88; }
    .dse-nb-new-btn svg { width: 13px; height: 13px; }

    .dse-nb-list { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
    .dse-nb-item {
      display: flex; align-items: center; gap: 4px;
      padding: 8px 8px;
      border-radius: var(--radius-sm, 6px);
      cursor: pointer;
      color: var(--text-secondary, #3b4151);
      transition: background .12s ease;
    }
    .dse-nb-item:hover { background: var(--bg-row-hover, #eceff3); }
    .dse-nb-item.active { background: var(--accent-dim, rgba(26,92,255,0.10)); color: var(--accent, #1a5cff); }
    .dse-nb-item-title {
      flex: 1; min-width: 0;
      font-size: 12.5px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dse-nb-item-act {
      width: 22px; height: 22px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: 5px;
      color: var(--text-muted, #8a93a6);
      opacity: 0; transition: opacity .12s ease, color .12s ease, background .12s ease;
    }
    .dse-nb-item:hover .dse-nb-item-act, .dse-nb-item.active .dse-nb-item-act { opacity: 1; }
    .dse-nb-item-act:hover { color: var(--text-primary, #0f1117); background: rgba(0,0,0,0.06); }
    .dse-nb-item-act.del:hover { color: var(--loss, #d13f3f); background: rgba(209,63,63,0.12); }
    .dse-nb-item-act svg { width: 12px; height: 12px; }

    .dse-nb-empty-list {
      padding: 24px 14px; text-align: center;
      color: var(--text-muted, #8a93a6); font-size: 12px;
    }

    .dse-nb-editor { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .dse-nb-editor-hd {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 18px 10px; flex-shrink: 0;
    }
    .dse-nb-editor-title {
      flex: 1; min-width: 0;
      font-size: 15px; font-weight: 700;
      color: var(--text-primary, #0f1117);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dse-nb-btn {
      padding: 7px 13px;
      border-radius: var(--radius-sm, 6px);
      font-size: 12px; font-weight: 700;
      cursor: pointer; white-space: nowrap;
      transition: opacity .15s ease, background .15s ease;
    }
    .dse-nb-btn-save {
      background: var(--text-primary, #0f1117); color: var(--bg-card, #fff);
      border: 1px solid var(--text-primary, #0f1117);
    }
    .dse-nb-btn-save[disabled] { opacity: 0.4; cursor: default; }
    .dse-nb-btn-save:not([disabled]):hover { opacity: 0.85; }
    .dse-nb-btn-danger {
      background: transparent; color: var(--loss, #d13f3f);
      border: 1px solid var(--loss, #d13f3f);
    }
    .dse-nb-btn-danger:hover { background: rgba(209,63,63,0.10); }

    .dse-nb-toolbar {
      display: flex; align-items: center; flex-wrap: wrap; gap: 2px;
      padding: 6px 16px;
      border-top: 1px solid var(--border, #e2e5ea);
      border-bottom: 1px solid var(--border, #e2e5ea);
      flex-shrink: 0;
    }
    .dse-nb-tool-btn {
      min-width: 28px; height: 28px; padding: 0 6px;
      display: flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid transparent; border-radius: 5px;
      color: var(--text-secondary, #3b4151);
      font-size: 13px; font-family: var(--sans, sans-serif);
      cursor: pointer;
      transition: background .12s ease, border-color .12s ease;
    }
    .dse-nb-tool-btn:hover { background: var(--bg-base, #f4f5f7); border-color: var(--border, #e2e5ea); }
    .dse-nb-tool-btn svg { width: 14px; height: 14px; }
    .dse-nb-sep { width: 1px; align-self: stretch; margin: 4px 6px; background: var(--border, #e2e5ea); }
    .dse-nb-heading {
      height: 28px; padding: 0 6px;
      background: transparent; border: 1px solid var(--border, #e2e5ea); border-radius: 5px;
      color: var(--text-secondary, #3b4151); font-size: 11.5px; font-family: var(--sans, sans-serif);
      cursor: pointer;
    }

    .dse-nb-content {
      flex: 1; overflow-y: auto;
      padding: 18px 22px;
      font-size: 13.5px; line-height: 1.65;
      color: var(--text-primary, #0f1117);
      outline: none;
    }
    .dse-nb-content:empty::before {
      content: attr(data-placeholder);
      color: var(--text-muted, #8a93a6);
    }
    .dse-nb-content h1, .dse-nb-content h2, .dse-nb-content h3 { margin: 0.6em 0 0.35em; color: var(--text-primary, #0f1117); }
    .dse-nb-content p { margin: 0 0 0.7em; }
    .dse-nb-content ul, .dse-nb-content ol { margin: 0 0 0.7em; padding-left: 1.4em; }
    .dse-nb-content pre {
      background: var(--bg-base, #f4f5f7); border: 1px solid var(--border, #e2e5ea);
      border-radius: 6px; padding: 10px 12px; overflow-x: auto;
      font-family: var(--mono, monospace); font-size: 12.5px;
    }
    .dse-nb-content a { color: var(--accent, #1a5cff); }
    .dse-nb-content img { max-width: 100%; border-radius: 6px; }

    .dse-nb-blank {
      flex: 1; display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 12px;
      color: var(--text-muted, #8a93a6); font-size: 13px; text-align: center;
    }
    .dse-nb-blank button {
      padding: 8px 16px;
      background: var(--accent, #1a5cff); color: #fff;
      border: none; border-radius: var(--radius-sm, 6px);
      font-size: 12.5px; font-weight: 700; cursor: pointer;
    }

    @media (max-width: 700px) {
      .dse-nb-backdrop { padding: 0; }
      .dse-nb-modal { max-width: none; width: 100%; height: 100%; max-height: none; border-radius: 0; }
      .dse-nb-body { flex-direction: column; }
      .dse-nb-sidebar { width: 100%; max-height: 34%; border-right: none; border-bottom: 1px solid var(--border, #e2e5ea); }
    }
  `;

  function injectStyle() {
    if (document.getElementById('dse-nb-style')) return;
    const style = document.createElement('style');
    style.id = 'dse-nb-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function icon(paths, extra) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${paths}</svg>`;
  }

  const ICONS = {
    plus: icon('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    edit: icon('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    trash: icon('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    ul: icon('<line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>'),
    ol: icon('<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="2" y="8" font-size="6" fill="currentColor" stroke="none">1</text><text x="2" y="14" font-size="6" fill="currentColor" stroke="none">2</text><text x="2" y="20" font-size="6" fill="currentColor" stroke="none">3</text>'),
    indent: icon('<polyline points="3 8 7 12 3 16"/><line x1="21" y1="4" x2="11" y2="4"/><line x1="21" y1="12" x2="11" y2="12"/><line x1="21" y1="20" x2="11" y2="20"/>'),
    outdent: icon('<polyline points="7 8 3 12 7 16"/><line x1="21" y1="4" x2="11" y2="4"/><line x1="21" y1="12" x2="11" y2="12"/><line x1="21" y1="20" x2="11" y2="20"/>'),
    link: icon('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
    image: icon('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
    code: icon('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    close: icon('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  };

  let backdrop = null, sidebarListEl = null, editorEl = null, contentEl = null, bannerEl = null;
  let notebooks = [];
  let activeId = null;
  let dirty = false;
  let openerEl = null;
  let loaded = false;
  let saveTimer = null;
  const AUTOSAVE_DELAY = 900;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  async function apiLoad() {
    const r = await fetch(API);
    if (!r.ok) {
      const err = new Error('load failed');
      err.status = r.status;
      throw err;
    }
    const data = await r.json();
    return Array.isArray(data.notebooks) ? data.notebooks : [];
  }

  async function apiSave() {
    const r = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebooks }),
    });
    if (!r.ok) {
      const err = new Error('save failed');
      err.status = r.status;
      throw err;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function build() {
    injectStyle();
    backdrop = document.createElement('div');
    backdrop.className = 'dse-nb-backdrop';
    backdrop.id = 'dse-nb-backdrop';
    backdrop.innerHTML = `
      <div class="dse-nb-modal" role="dialog" aria-modal="true" aria-label="Notebook">
        <div class="dse-nb-hd">
          <h2>Notebook</h2>
          <button type="button" class="dse-nb-close" title="Close" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="dse-nb-banner"></div>
        <div class="dse-nb-body">
          <div class="dse-nb-sidebar">
            <button type="button" class="dse-nb-new-btn">${ICONS.plus}<span>New Notepad</span></button>
            <div class="dse-nb-list"></div>
          </div>
          <div class="dse-nb-editor"></div>
        </div>
      </div>
    `;
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.dse-nb-close').addEventListener('click', close);
    backdrop.querySelector('.dse-nb-new-btn').addEventListener('click', createNotebook);
    sidebarListEl = backdrop.querySelector('.dse-nb-list');
    editorEl = backdrop.querySelector('.dse-nb-editor');
    bannerEl = backdrop.querySelector('.dse-nb-banner');
    document.body.appendChild(backdrop);
  }

  function showError(message) {
    if (!bannerEl) return;
    bannerEl.textContent = message;
    bannerEl.classList.add('show');
  }

  function clearError() {
    if (!bannerEl) return;
    bannerEl.classList.remove('show');
  }

  function describeError(err, action) {
    if (err && err.status === 401) return "You've been logged out. Log in again, then retry.";
    return action === 'load'
      ? "Couldn't load your notepads — check your connection and reopen Notebook."
      : "Couldn't save — check your connection. Your last edit is still on screen; retry once it's back.";
  }

  async function open() {
    if (!backdrop) build();
    openerEl = document.activeElement;
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!loaded) {
      try {
        notebooks = await apiLoad();
        clearError();
        loaded = true; // only skip re-fetching next open() once a load has actually succeeded
      } catch (err) {
        notebooks = [];
        showError(describeError(err, 'load'));
      }
      if (!activeId && notebooks[0]) activeId = notebooks[0].id;
    }
    renderList();
    renderEditor();
  }

  // Everything autosaves (see markDirty's debounce), so switching notepads
  // or closing the modal only needs to flush any not-yet-fired save rather
  // than ask the user to confirm discarding anything.
  // Returns a promise so callers that are about to issue their own save
  // (createNotebook) can await it and avoid two concurrent PUTs racing each
  // other; callers that just want to close/switch fire-and-forget it.
  function flushAutoSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return dirty ? saveActive() : Promise.resolve();
  }

  function close() {
    if (!backdrop || !backdrop.classList.contains('open')) return;
    flushAutoSave();
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    if (openerEl && openerEl.focus) openerEl.focus();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop && backdrop.classList.contains('open')) close();
  });

  function renderList() {
    if (!notebooks.length) {
      sidebarListEl.innerHTML = `<div class="dse-nb-empty-list">No notepads yet.</div>`;
      return;
    }
    sidebarListEl.innerHTML = notebooks.map(nb => `
      <div class="dse-nb-item${nb.id === activeId ? ' active' : ''}" data-id="${nb.id}">
        <span class="dse-nb-item-title">${escapeHtml(nb.title || 'Untitled Notepad')}</span>
        <button type="button" class="dse-nb-item-act edit" data-id="${nb.id}" title="Rename" aria-label="Rename">${ICONS.edit}</button>
        <button type="button" class="dse-nb-item-act del" data-id="${nb.id}" title="Delete" aria-label="Delete">${ICONS.trash}</button>
      </div>
    `).join('');
    sidebarListEl.querySelectorAll('.dse-nb-item').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.dse-nb-item-act')) return;
        selectNotebook(row.dataset.id);
      });
    });
    sidebarListEl.querySelectorAll('.dse-nb-item-act.edit').forEach(btn => {
      btn.addEventListener('click', () => renameNotebook(btn.dataset.id));
    });
    sidebarListEl.querySelectorAll('.dse-nb-item-act.del').forEach(btn => {
      btn.addEventListener('click', () => deleteNotebook(btn.dataset.id));
    });
  }

  function selectNotebook(id) {
    if (id === activeId) return;
    flushAutoSave();
    activeId = id;
    dirty = false;
    renderList();
    renderEditor();
  }

  function renderEditor() {
    const nb = notebooks.find(n => n.id === activeId);
    if (!nb) {
      editorEl.innerHTML = `
        <div class="dse-nb-blank">
          <div>${notebooks.length ? 'Select a notepad to start writing.' : 'Create your first notepad to start writing.'}</div>
          <button type="button" class="dse-nb-blank-new">${ICONS.plus} New Notepad</button>
        </div>
      `;
      editorEl.querySelector('.dse-nb-blank-new').addEventListener('click', createNotebook);
      contentEl = null;
      return;
    }

    editorEl.innerHTML = `
      <div class="dse-nb-editor-hd">
        <div class="dse-nb-editor-title">${escapeHtml(nb.title || 'Untitled Notepad')}</div>
        <button type="button" class="dse-nb-btn dse-nb-btn-save" disabled>Saved</button>
        <button type="button" class="dse-nb-btn dse-nb-btn-danger">Delete Notepad</button>
      </div>
      <div class="dse-nb-toolbar">
        <button type="button" class="dse-nb-tool-btn" data-cmd="bold" title="Bold"><b>B</b></button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="italic" title="Italic"><i>I</i></button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="underline" title="Underline"><u>U</u></button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
        <span class="dse-nb-sep"></span>
        <button type="button" class="dse-nb-tool-btn" data-cmd="insertUnorderedList" title="Bulleted list">${ICONS.ul}</button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="insertOrderedList" title="Numbered list">${ICONS.ol}</button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="outdent" title="Decrease indent">${ICONS.outdent}</button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="indent" title="Increase indent">${ICONS.indent}</button>
        <span class="dse-nb-sep"></span>
        <select class="dse-nb-heading" title="Paragraph style">
          <option value="P">Paragraph</option>
          <option value="H1">Heading 1</option>
          <option value="H2">Heading 2</option>
          <option value="H3">Heading 3</option>
        </select>
        <span class="dse-nb-sep"></span>
        <button type="button" class="dse-nb-tool-btn" data-cmd="createLink" title="Insert link">${ICONS.link}</button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="insertImage" title="Insert image">${ICONS.image}</button>
        <button type="button" class="dse-nb-tool-btn" data-cmd="formatBlock" data-value="PRE" title="Code block">${ICONS.code}</button>
      </div>
      <div class="dse-nb-content" contenteditable="true" data-placeholder="Start writing..."></div>
    `;

    contentEl = editorEl.querySelector('.dse-nb-content');
    contentEl.innerHTML = nb.content || '';
    contentEl.addEventListener('input', markDirty);
    contentEl.addEventListener('blur', flushAutoSave);

    const toolbar = editorEl.querySelector('.dse-nb-toolbar');
    toolbar.addEventListener('mousedown', e => e.preventDefault());
    toolbar.addEventListener('click', e => {
      const btn = e.target.closest('button[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('Link URL:', 'https://');
        if (url) exec('createLink', url);
        return;
      }
      if (cmd === 'insertImage') {
        const url = prompt('Image URL:', 'https://');
        if (url) exec('insertImage', url);
        return;
      }
      if (cmd === 'formatBlock') {
        exec('formatBlock', btn.dataset.value || 'P');
        return;
      }
      exec(cmd);
    });
    const headingSelect = editorEl.querySelector('.dse-nb-heading');
    headingSelect.addEventListener('mousedown', e => e.stopPropagation());
    headingSelect.addEventListener('change', () => exec('formatBlock', headingSelect.value));

    editorEl.querySelector('.dse-nb-btn-save').addEventListener('click', saveActive);
    editorEl.querySelector('.dse-nb-btn-danger').addEventListener('click', () => deleteNotebook(nb.id));
  }

  function exec(cmd, value) {
    if (!contentEl) return;
    contentEl.focus();
    document.execCommand(cmd, false, value);
    markDirty();
  }

  function markDirty() {
    dirty = true;
    const saveBtn = editorEl.querySelector('.dse-nb-btn-save');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveActive, AUTOSAVE_DELAY);
  }

  async function createNotebook() {
    const title = prompt('Notepad title:', 'Untitled Notepad');
    if (title === null) return;
    await flushAutoSave(); // persist whatever was pending in the notepad we're leaving, before our own save below
    const previousActiveId = activeId;
    const nb = {
      id: uid(),
      title: title.trim() || 'Untitled Notepad',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    notebooks.unshift(nb);
    activeId = nb.id;
    dirty = false;
    try {
      await apiSave();
      clearError();
    } catch (err) {
      notebooks = notebooks.filter(n => n.id !== nb.id);
      activeId = previousActiveId;
      showError(describeError(err, 'save'));
    }
    renderList();
    renderEditor();
    if (contentEl) contentEl.focus();
  }

  async function renameNotebook(id) {
    const nb = notebooks.find(n => n.id === id);
    if (!nb) return;
    const title = prompt('Rename notepad:', nb.title);
    if (title === null || !title.trim()) return;
    const previousTitle = nb.title;
    nb.title = title.trim();
    nb.updatedAt = new Date().toISOString();
    try {
      await apiSave();
      clearError();
    } catch (err) {
      nb.title = previousTitle;
      showError(describeError(err, 'save'));
    }
    renderList();
    if (id === activeId) renderEditor();
  }

  async function deleteNotebook(id) {
    const nb = notebooks.find(n => n.id === id);
    if (!nb) return;
    if (!confirm(`Delete notepad "${nb.title}"? This cannot be undone.`)) return;
    const previousActiveId = activeId;
    const previousDirty = dirty;
    const removedIndex = notebooks.indexOf(nb);
    notebooks = notebooks.filter(n => n.id !== id);
    if (activeId === id) {
      clearTimeout(saveTimer);
      saveTimer = null;
      activeId = notebooks[0] ? notebooks[0].id : null;
      dirty = false;
    }
    try {
      await apiSave();
      clearError();
    } catch (err) {
      notebooks.splice(removedIndex, 0, nb);
      activeId = previousActiveId;
      dirty = previousDirty;
      showError(describeError(err, 'save'));
    }
    renderList();
    renderEditor();
  }

  async function saveActive() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const savingId = activeId;
    const nb = notebooks.find(n => n.id === savingId);
    if (!nb || !contentEl) return;
    const saveBtn = editorEl.querySelector('.dse-nb-btn-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    nb.content = contentEl.innerHTML;
    nb.updatedAt = new Date().toISOString();
    try {
      await apiSave();
      clearError();
      // The user may have switched to a different notepad (or one may have
      // been typed into) while this save was in flight — only touch state
      // that's still about the notepad we just saved.
      if (activeId === savingId) {
        dirty = false;
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saved'; }
      }
    } catch (err) {
      showError(describeError(err, 'save'));
      if (activeId === savingId) {
        dirty = true; // leave it unsaved so retrying (or a later flush) tries again
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
      }
    }
  }

  function wireButton(b) {
    if (!b || b.dataset.notebookModalWired) return;
    b.dataset.notebookModalWired = '1';
    b.addEventListener('click', open);
  }

  window.DSENotebookModal = { open, close, wireButton };
})();
