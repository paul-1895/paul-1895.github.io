/* ================================================================
   sr-levels.js  —  Support & Resistance price levels
   Attaches to company.html · call initSRLevels(code, ltp)
   ================================================================ */
'use strict';

(function () {
  let srData     = { support: [], resistance: [] };
  let stockCode  = null;
  let currentLTP = 0;

  /* ── INIT ─────────────────────────────────────────────────── */
  window.initSRLevels = async function (code, ltp) {
    stockCode  = code;
    currentLTP = parseFloat(ltp) || 0;
    await fetchSR();
    renderCards();
  };

  /* ── API ──────────────────────────────────────────────────── */
  const API = (path, opts) =>
    fetch(`/api/sr/${encodeURIComponent(stockCode)}${path}`, opts)
      .then(r => r.json());

  async function fetchSR() {
    const data = await API('');
    srData.support    = (data.support    || []).sort((a, b) => a.price - b.price);
    srData.resistance = (data.resistance || []).sort((a, b) => a.price - b.price);
    checkNotifications();
  }

  function checkNotifications() {
    if (!window.DSENotif || !stockCode || !currentLTP) return;
    const all = [
      ...srData.support.map(e => ({ ...e, type: 'support' })),
      ...srData.resistance.map(e => ({ ...e, type: 'resistance' })),
    ];
    window.DSENotif.checkSRHit(stockCode, currentLTP, all);
  }

  async function addLevel(type, price, note) {
    const entry = await API('', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type, price, note })
    });
    srData[type].push(entry);
    srData[type].sort((a, b) => a.price - b.price);
    renderCards();
  }

  async function editLevel(type, id, price, note) {
    const entry = await API(`/${type}/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ price, note })
    });
    const idx = srData[type].findIndex(e => e.id === id);
    if (idx !== -1) srData[type][idx] = entry;
    srData[type].sort((a, b) => a.price - b.price);
    renderCards();
  }

  async function deleteLevel(type, id) {
    await API(`/${type}/${id}`, { method: 'DELETE' });
    srData[type] = srData[type].filter(e => e.id !== id);
    renderCards();
  }

  /* ── NEAREST LOGIC ────────────────────────────────────────── */
  function nearestSupport(arr) {
    const below = arr.filter(e => e.price <= currentLTP);
    return below.length ? below[below.length - 1] : null;
  }
  function nearestResistance(arr) {
    const above = arr.filter(e => e.price >= currentLTP);
    return above.length ? above[0] : null;
  }

  /* ── RENDER ───────────────────────────────────────────────── */
  function renderCards() {
    const container = document.getElementById('sr-levels-section');
    if (!container) return;

    const nearSup = nearestSupport(srData.support);
    const nearRes = nearestResistance(srData.resistance);

    container.innerHTML = `
      <div class="sr-section">
        <div class="sr-section-label">
          <span class="sr-section-label-text">Price Levels</span>
          <span class="sr-section-label-line"></span>
        </div>
        <div class="sr-section-inner">
          ${buildCard('support',    srData.support,    nearSup)}
          ${buildCard('resistance', srData.resistance, nearRes)}
        </div>
      </div>`;

    bindEvents(container);
  }

  /* ── CARD HTML ────────────────────────────────────────────── */
  function fmtP(n) {
    return n.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(price) {
    if (!currentLTP) return null;
    return (((price - currentLTP) / currentLTP) * 100).toFixed(2);
  }

  function buildCard(type, levels, nearLevel) {
    const isSupport  = type === 'support';
    const label      = isSupport ? 'Support' : 'Resistance';
    const watermark  = isSupport ? 'SUP' : 'RES';

    /* Header nearest block */
    let headerHtml;
    if (nearLevel) {
      const pct  = fmtPct(nearLevel.price);
      const sign = pct >= 0 ? '+' : '';
      headerHtml = `
        <div class="sr-nearest-block">
          <div class="sr-nearest-price">৳${fmtP(nearLevel.price)}</div>
          <div class="sr-nearest-meta">
            <span class="sr-nearest-pct">${sign}${pct}%</span>
            <span class="sr-nearest-note">${escHtml(nearLevel.note) || (isSupport ? 'Nearest floor' : 'Nearest ceiling')}</span>
          </div>
        </div>`;
    } else {
      headerHtml = `
        <div class="sr-empty-header">—</div>
        <div class="sr-empty-header-sub">No ${label.toLowerCase()} level ${isSupport ? 'below' : 'above'} LTP</div>`;
    }

    /* Mini cards */
    const miniHtml = levels.length
      ? levels.map((e, idx) => {
          const isNearest = nearLevel && e.id === nearLevel.id;
          const pct       = fmtPct(e.price);
          const sign      = pct >= 0 ? '+' : '';
          return `
            <div class="sr-mini-card${isNearest ? ' sr-nearest' : ''}" data-type="${type}" data-id="${e.id}">
              <div class="sr-mini-rank">${String(idx + 1).padStart(2, '0')}</div>
              <div class="sr-mini-body">
                <div class="sr-mini-price">৳${fmtP(e.price)}</div>
                ${e.note ? `<div class="sr-mini-note">${escHtml(e.note)}</div>` : ''}
              </div>
              ${pct !== null ? `<div class="sr-mini-pct">${sign}${pct}%</div>` : ''}
              <div class="sr-mini-actions">
                <button class="sr-edit-btn" title="Edit"
                  data-type="${type}" data-id="${e.id}"
                  data-price="${e.price}" data-note="${escAttr(e.note)}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button class="sr-del-btn" title="Delete" data-type="${type}" data-id="${e.id}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
            </div>`;
        }).join('')
      : `<div class="sr-list-empty">
           <span class="sr-list-empty-icon">${isSupport ? '🛡' : '⚡'}</span>
           No ${label.toLowerCase()} levels yet
         </div>`;

    return `
      <div class="sr-card" data-type="${type}">

        <!-- Header -->
        <div class="sr-card-top" data-watermark="${watermark}">
          <div class="sr-card-label">
            <span class="sr-type-pill">
              <span class="sr-type-dot"></span>
              ${label}
            </span>
            <span class="sr-count-badge">${levels.length}</span>
          </div>
          ${headerHtml}
        </div>

        <!-- List -->
        <div class="sr-mini-list">${miniHtml}</div>

        <!-- Add -->
        <div class="sr-add-row">
          <input class="sr-price-input" type="number" step="0.01" min="0.01"
            placeholder="Price (৳)" data-type="${type}" />
          <input class="sr-note-input" type="text" maxlength="60"
            placeholder="Note (optional)" data-type="${type}" />
          <button class="sr-add-btn" data-type="${type}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5"  y1="12" x2="19" y2="12"/>
            </svg>
            Add
          </button>
        </div>

        <!-- Inline edit modal -->
        <div class="sr-edit-modal hidden" data-type="${type}">
          <div class="sr-edit-inner">
            <div class="sr-edit-title">Edit ${label} Level</div>
            <input class="sr-price-input" type="number" step="0.01" min="0.01"
              placeholder="Price (৳)" data-field="price" />
            <input class="sr-note-input" type="text" maxlength="60"
              placeholder="Note (optional)" data-field="note" />
            <div class="sr-edit-btns">
              <button class="sr-save-btn"   data-type="${type}">Save</button>
              <button class="sr-cancel-btn">Cancel</button>
            </div>
          </div>
        </div>

      </div>`;
  }

  /* ── EVENTS ───────────────────────────────────────────────── */
  function bindEvents(container) {

    /* Add */
    container.querySelectorAll('.sr-add-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type     = btn.dataset.type;
        const card     = btn.closest('.sr-card');
        const priceInp = card.querySelector(`.sr-price-input[data-type="${type}"]`);
        const noteInp  = card.querySelector(`.sr-note-input[data-type="${type}"]`);
        const price    = parseFloat(priceInp.value);
        if (!price || price <= 0) { priceInp.focus(); shake(priceInp); return; }
        btn.disabled = true;
        try {
          await addLevel(type, price, noteInp.value);
          priceInp.value = '';
          noteInp.value  = '';
        } finally { btn.disabled = false; }
      });
    });

    /* Enter key in price input */
    container.querySelectorAll('.sr-price-input[data-type]').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') inp.closest('.sr-card')?.querySelector('.sr-add-btn')?.click();
      });
    });

    /* Delete */
    container.querySelectorAll('.sr-del-btn').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this level?')) return;
        await deleteLevel(btn.dataset.type, btn.dataset.id);
      });
    });

    /* Open edit */
    container.querySelectorAll('.sr-edit-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const type  = btn.dataset.type;
        const card  = btn.closest('.sr-card');
        const modal = card.querySelector(`.sr-edit-modal[data-type="${type}"]`);
        modal.querySelector('[data-field="price"]').value = btn.dataset.price;
        modal.querySelector('[data-field="note"]').value  = btn.dataset.note;
        modal._editId = btn.dataset.id;
        modal.classList.remove('hidden');
        modal.querySelector('[data-field="price"]').focus();
      });
    });

    /* Save edit */
    container.querySelectorAll('.sr-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const type  = btn.dataset.type;
        const modal = btn.closest('.sr-edit-modal');
        const price = parseFloat(modal.querySelector('[data-field="price"]').value);
        const note  = modal.querySelector('[data-field="note"]').value;
        if (!price || price <= 0) { shake(modal.querySelector('[data-field="price"]')); return; }
        btn.disabled = true;
        try { await editLevel(type, modal._editId, price, note); }
        finally { btn.disabled = false; }
      });
    });

    /* Cancel edit */
    container.querySelectorAll('.sr-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.sr-edit-modal').classList.add('hidden'));
    });
  }

  /* ── UTILS ────────────────────────────────────────────────── */
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function escAttr(s) {
    return String(s || '').replace(/"/g, '&quot;');
  }
  function shake(el) {
    el.classList.remove('sr-shake');
    void el.offsetWidth;
    el.classList.add('sr-shake');
    setTimeout(() => el.classList.remove('sr-shake'), 400);
  }

})();