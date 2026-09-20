/* ================================================================
   annual-reports.js  —  Annual Reports for company.html
================================================================ */
'use strict';

(function () {
  const API = '/api/annual-reports';
  let _code    = null;
  let _reports = [];

  window.initAnnualReports = async function (code) {
    _code = code;
    _injectShell();
    await _load();
    _render();
    _bindAdd();
  };

  function _injectShell() {
    const sec = document.getElementById('ar-section');
    if (!sec) return;
    sec.innerHTML = `
      <div class="ar-card">
        <div class="ar-header">
          <div class="ar-header-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            Annual Reports
            <span class="ar-count-badge" id="ar-count">0</span>
          </div>
        </div>
        <div class="ar-input-area">
          <input id="ar-year-input" class="ar-year-input" type="number" min="2000" max="2099" placeholder="Year" autocomplete="off"/>
          <input id="ar-url-input" class="ar-url-input" type="url" placeholder="Paste report URL…" autocomplete="off"/>
          <button class="ar-add-btn" id="ar-add-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </div>
        <div class="ar-status" id="ar-status"></div>
        <div class="ar-buttons-grid" id="ar-buttons-grid"></div>
      </div>

      <!-- Edit modal -->
      <div class="ar-edit-overlay" id="ar-edit-overlay">
        <div class="ar-edit-modal">
          <div class="ar-edit-modal-title">Edit Annual Report</div>
          <input id="ar-edit-year" class="ar-year-input" type="number" min="2000" max="2099" placeholder="Year"/>
          <input id="ar-edit-url" class="ar-url-input" type="url" placeholder="URL" style="width:100%;box-sizing:border-box"/>
          <div class="ar-edit-btns">
            <button class="ar-add-btn" id="ar-edit-save">Save</button>
            <button class="ar-add-btn ar-edit-cancel-btn" id="ar-edit-cancel">Cancel</button>
          </div>
        </div>
      </div>`;

    document.getElementById('ar-edit-save').addEventListener('click', _saveEdit);
    document.getElementById('ar-edit-cancel').addEventListener('click', _closeEdit);
    document.getElementById('ar-edit-overlay').addEventListener('click', e => {
      if (e.target === document.getElementById('ar-edit-overlay')) _closeEdit();
    });
  }

  async function _load() {
    try {
      const r = await fetch(`${API}/${encodeURIComponent(_code)}`);
      const d = await r.json();
      _reports = (d.reports || []).sort((a, b) => b.year - a.year);
    } catch { _reports = []; }
  }

  function _render() {
    const grid  = document.getElementById('ar-buttons-grid');
    const badge = document.getElementById('ar-count');
    if (!grid) return;
    if (badge) badge.textContent = _reports.length;

    if (!_reports.length) {
      grid.innerHTML = `
        <div class="ar-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          No annual reports yet.
        </div>`;
      return;
    }

    grid.innerHTML = _reports.map(r => `
      <div class="ar-btn-wrap">
        <!-- Main clickable area -->
        <button class="ar-year-btn" onclick="window._arOpen('${r.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <span class="ar-year-label">${r.year}</span>
        </button>
        <!-- Action row always visible below -->
        <div class="ar-action-row">
          <button class="ar-action-btn ar-action-edit" onclick="window._arEditOpen('${r.id}')" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="ar-action-btn ar-action-del" onclick="window._arDelete('${r.id}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>`).join('');
  }

  /* ── OPEN ────────────────────────────────────────────────── */
  window._arOpen = function (id) {
    const r = _reports.find(x => x.id === id);
    if (r) window.open(r.url, '_blank', 'noopener');
  };

  /* ── EDIT ────────────────────────────────────────────────── */
  let _editId = null;
  window._arEditOpen = function (id) {
    const r = _reports.find(x => x.id === id);
    if (!r) return;
    _editId = r.id;
    document.getElementById('ar-edit-year').value = r.year;
    document.getElementById('ar-edit-url').value  = r.url;
    document.getElementById('ar-edit-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  function _closeEdit() {
    _editId = null;
    document.getElementById('ar-edit-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }
  async function _saveEdit() {
    const year = parseInt(document.getElementById('ar-edit-year').value);
    const url  = (document.getElementById('ar-edit-url').value || '').trim();
    if (!year || year < 2000) { _shake(document.getElementById('ar-edit-year')); return; }
    if (!url || !/^https?:\/\//i.test(url)) { _shake(document.getElementById('ar-edit-url')); return; }
    try {
      const r = await fetch(`${API}/${encodeURIComponent(_code)}/${_editId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, url })
      });
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      const idx = _reports.findIndex(x => x.id === _editId);
      if (idx !== -1) _reports[idx] = d.report;
      _reports.sort((a, b) => b.year - a.year);
      _closeEdit(); _render();
    } catch (e) { _setStatus('Error: ' + e.message, 'error'); }
  }

  /* ── DELETE ──────────────────────────────────────────────── */
  window._arDelete = async function (id) {
    if (!confirm('Delete this annual report?')) return;
    try {
      await fetch(`${API}/${encodeURIComponent(_code)}/${id}`, { method: 'DELETE' });
      _reports = _reports.filter(x => x.id !== id);
      _render();
    } catch (e) { _setStatus('Error: ' + e.message, 'error'); }
  };

  /* ── ADD ─────────────────────────────────────────────────── */
  function _bindAdd() {
    document.getElementById('ar-add-btn')?.addEventListener('click', _add);
    document.getElementById('ar-url-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') _add(); });
  }
  async function _add() {
    const yi   = document.getElementById('ar-year-input');
    const ui   = document.getElementById('ar-url-input');
    const year = parseInt(yi.value);
    const url  = (ui.value || '').trim();
    if (!year || year < 2000 || year > 2099) { _shake(yi); return; }
    if (!url || !/^https?:\/\//i.test(url))   { _shake(ui); return; }
    const btn = document.getElementById('ar-add-btn');
    btn.disabled = true;
    try {
      const r = await fetch(`${API}/${encodeURIComponent(_code)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, url })
      });
      if (r.status === 409) { _setStatus('A report for this year already exists.', 'error'); return; }
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      _reports.unshift(d.report);
      _reports.sort((a, b) => b.year - a.year);
      yi.value = ''; ui.value = '';
      _render();
    } catch (e) { _setStatus('Error: ' + e.message, 'error'); }
    finally { btn.disabled = false; }
  }

  /* ── UTILS ───────────────────────────────────────────────── */
  function _setStatus(msg, type = '') {
    const el = document.getElementById('ar-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'ar-status' + (type ? ' ' + type : '');
    if (msg && type !== 'error') setTimeout(() => { el.className = 'ar-status'; }, 3000);
  }
  function _shake(el) {
    el.classList.remove('sr-shake'); void el.offsetWidth;
    el.classList.add('sr-shake');
    setTimeout(() => el.classList.remove('sr-shake'), 400);
  }

})();