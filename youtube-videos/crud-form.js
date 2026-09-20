/* ═══════════════════════════════════════════════════════════
   crud-form.js — Add/Edit modal for the YouTube Videos page

   Builds a single reusable modal into #videoFormModalRoot (mirrors the
   dynamic-build + `.open` class-toggle convention used by
   learning/guide-videos.js and company_profile/annual-reports.js —
   no static markup, no other modal library).

   Exposes window.YTForm = { openAdd, openEdit } per the page's JS
   global-namespace contract. Talks to:
     - window.YTTagPicker.create(mountEl, { type, initialValues })
       for the ticker / sector multi-tag inputs (called fresh on every
       open so initialValues reflect the video being edited).
     - window.YTGrid.refresh() after a successful save, so the grid
       re-fetches and re-renders.
   POST adds a video, PATCH edits one (url can't be changed after the
   fact — the API only accepts title/category/tickers/sectors on
   PATCH — so the URL field is shown read-only in edit mode).
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = '/api/youtube-videos';
  const CATEGORIES = [
    { value: 'analysis',   label: 'Analysis' },
    { value: 'news',       label: 'News' },
    { value: 'promotion',  label: 'Promotion' },
    { value: 'other',      label: 'Other' },
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── module state ───────────────────────────────────────────
  let built = false;
  let root, modalEl, headingEl, errorEl, formEl;
  let urlField, urlInput, urlHint;
  let titleInput, categorySelect;
  let tickerMount, sectorMount;
  let saveBtn, cancelBtn, closeBtn;

  let tickerPicker = null;
  let sectorPicker = null;
  let mode = 'add';        // 'add' | 'edit'
  let editingId = null;
  let isOpen = false;
  let saving = false;

  // ── build (once) ───────────────────────────────────────────
  function ensureBuilt() {
    if (built) return;
    root = document.getElementById('videoFormModalRoot');
    if (!root) return;

    root.innerHTML = `
      <div class="yt-modal" id="ytFormModal" role="dialog" aria-modal="true" aria-labelledby="ytFormHeading">
        <div class="yt-modal-inner">
          <button type="button" class="yt-modal__close" id="ytFormClose" aria-label="Close">&times;</button>
          <h2 id="ytFormHeading">Add Video</h2>
          <div class="yt-form-error" id="ytFormError" hidden></div>
          <form id="ytVideoForm" novalidate>
            <div class="yt-form-field" id="ytFormUrlField">
              <label for="ytFormUrl">YouTube URL</label>
              <input type="url" id="ytFormUrl" name="url" placeholder="https://www.youtube.com/watch?v=&hellip;" autocomplete="off" />
              <div class="yt-form-hint" id="ytFormUrlHint" hidden>The URL can&rsquo;t be changed after a video is added &mdash; delete and re-add it instead.</div>
            </div>
            <div class="yt-form-field">
              <label for="ytFormTitle">Title</label>
              <input type="text" id="ytFormTitle" name="title" placeholder="Video title" autocomplete="off" />
            </div>
            <div class="yt-form-field">
              <label for="ytFormCategory">Category</label>
              <select id="ytFormCategory" name="category">
                ${CATEGORIES.map(c => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}
              </select>
            </div>
            <div class="yt-form-field">
              <label>Tickers</label>
              <div id="ytFormTickerMount"></div>
            </div>
            <div class="yt-form-field">
              <label>Sectors</label>
              <div id="ytFormSectorMount"></div>
            </div>
            <div class="yt-form-actions">
              <button type="button" class="yt-btn yt-btn-secondary" id="ytFormCancel">Cancel</button>
              <button type="submit" class="yt-btn yt-btn-primary" id="ytFormSave">Add Video</button>
            </div>
          </form>
        </div>
      </div>`;

    modalEl        = document.getElementById('ytFormModal');
    headingEl      = document.getElementById('ytFormHeading');
    errorEl        = document.getElementById('ytFormError');
    formEl         = document.getElementById('ytVideoForm');
    urlField       = document.getElementById('ytFormUrlField');
    urlInput       = document.getElementById('ytFormUrl');
    urlHint        = document.getElementById('ytFormUrlHint');
    titleInput     = document.getElementById('ytFormTitle');
    categorySelect = document.getElementById('ytFormCategory');
    tickerMount    = document.getElementById('ytFormTickerMount');
    sectorMount    = document.getElementById('ytFormSectorMount');
    saveBtn        = document.getElementById('ytFormSave');
    cancelBtn      = document.getElementById('ytFormCancel');
    closeBtn       = document.getElementById('ytFormClose');

    closeBtn.addEventListener('click', () => closeModal());
    cancelBtn.addEventListener('click', () => closeModal());
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
    formEl.addEventListener('submit', e => { e.preventDefault(); handleSave(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) closeModal();
    });

    built = true;
  }

  // ── tag pickers ────────────────────────────────────────────
  function destroyPickers() {
    if (tickerPicker && typeof tickerPicker.destroy === 'function') {
      try { tickerPicker.destroy(); } catch (_) { /* noop */ }
    }
    if (sectorPicker && typeof sectorPicker.destroy === 'function') {
      try { sectorPicker.destroy(); } catch (_) { /* noop */ }
    }
    tickerPicker = null;
    sectorPicker = null;
    if (tickerMount) tickerMount.innerHTML = '';
    if (sectorMount) sectorMount.innerHTML = '';
  }

  function createPickers(tickers, sectors) {
    destroyPickers();
    if (window.YTTagPicker && typeof window.YTTagPicker.create === 'function') {
      tickerPicker = window.YTTagPicker.create(tickerMount, { type: 'ticker', initialValues: tickers || [] });
      sectorPicker = window.YTTagPicker.create(sectorMount, { type: 'sector', initialValues: sectors || [] });
    } else {
      // Tag-picker script not loaded yet — fail soft rather than throw.
      tickerMount.textContent = '';
      sectorMount.textContent = '';
    }
  }

  function currentTickers() {
    return tickerPicker && typeof tickerPicker.getValues === 'function' ? tickerPicker.getValues() : [];
  }
  function currentSectors() {
    return sectorPicker && typeof sectorPicker.getValues === 'function' ? sectorPicker.getValues() : [];
  }

  // ── error banner ───────────────────────────────────────────
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function clearError() {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  // ── open / close ───────────────────────────────────────────
  function openModal() {
    modalEl.classList.add('open');
    document.body.style.overflow = 'hidden';
    isOpen = true;
  }

  function closeModal() {
    if (saving) return; // don't yank the modal out from under an in-flight save
    modalEl.classList.remove('open');
    document.body.style.overflow = '';
    isOpen = false;
    clearError();
    destroyPickers();
    editingId = null;
  }

  function setSaving(state) {
    saving = state;
    saveBtn.disabled = state;
    cancelBtn.disabled = state;
    saveBtn.textContent = state
      ? 'Saving…'
      : (mode === 'edit' ? 'Save Changes' : 'Add Video');
  }

  // ── open for add ───────────────────────────────────────────
  function openAdd() {
    ensureBuilt();
    if (!root) return;
    mode = 'add';
    editingId = null;
    headingEl.textContent = 'Add Video';
    clearError();

    urlInput.value = '';
    urlInput.disabled = false;
    urlField.classList.remove('yt-form-field--readonly');
    urlHint.hidden = true;

    titleInput.value = '';
    categorySelect.value = 'analysis';

    createPickers([], []);
    setSaving(false);
    saveBtn.textContent = 'Add Video';

    openModal();
    setTimeout(() => urlInput.focus(), 30);
  }

  // ── open for edit ──────────────────────────────────────────
  function openEdit(video) {
    ensureBuilt();
    if (!root || !video) return;
    mode = 'edit';
    editingId = video.id;
    headingEl.textContent = 'Edit Video';
    clearError();

    const displayUrl = video.url || (video.videoId ? `https://www.youtube.com/watch?v=${video.videoId}` : '');
    urlInput.value = displayUrl;
    urlInput.disabled = true;
    urlField.classList.add('yt-form-field--readonly');
    urlHint.hidden = false;

    titleInput.value = video.title || '';
    const cat = CATEGORIES.some(c => c.value === video.category) ? video.category : 'other';
    categorySelect.value = cat;

    createPickers(Array.isArray(video.tickers) ? video.tickers.slice() : [],
                  Array.isArray(video.sectors) ? video.sectors.slice() : []);
    setSaving(false);
    saveBtn.textContent = 'Save Changes';

    openModal();
    setTimeout(() => titleInput.focus(), 30);
  }

  // ── save ───────────────────────────────────────────────────
  async function handleSave() {
    if (saving) return;
    clearError();

    const title = (titleInput.value || '').trim();
    if (!title) { showError('Title is required.'); titleInput.focus(); return; }

    const category = categorySelect.value;
    const tickers = currentTickers();
    const sectors = currentSectors();

    let url, method, body;
    if (mode === 'edit' && editingId) {
      url = `${API}/${encodeURIComponent(editingId)}`;
      method = 'PATCH';
      body = { title, category, tickers, sectors };
    } else {
      const ytUrl = (urlInput.value || '').trim();
      if (!ytUrl) { showError('YouTube URL is required.'); urlInput.focus(); return; }
      url = API;
      method = 'POST';
      body = { url: ytUrl, title, category, tickers, sectors };
    }

    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      let data = null;
      try { data = await res.json(); } catch (_) { /* no/invalid body */ }

      if (!res.ok) {
        showError((data && data.error) || `Failed to save video (${res.status}).`);
        setSaving(false);
        return;
      }

      setSaving(false);
      closeModal();
      if (window.YTGrid && typeof window.YTGrid.refresh === 'function') {
        window.YTGrid.refresh();
      }
    } catch (e) {
      setSaving(false);
      showError((e && e.message) || 'Network error — please try again.');
    }
  }

  // ── wire up "+ Add Video" button ────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    ensureBuilt();
    const addBtn = document.getElementById('addVideoBtn');
    if (addBtn) addBtn.addEventListener('click', () => openAdd());
  });

  window.YTForm = { openAdd, openEdit };
})();
