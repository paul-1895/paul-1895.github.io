import { initTheme, toggleTheme } from '../../theme/theme.js';
/* ================================================================
   timeline.js — Per-stock timeline CRUD + creative features:
     - Category tags (colour-coded) + filter chips
     - Sentiment (bullish/bearish/neutral)
     - Pin important events to a dedicated "Pinned" section
     - Live search across title + description
     - Sort toggle (newest / oldest first)
     - Year grouping with sticky headers
     - Export / Import as JSON
     - Deep link to a single event (#ev_id) with scroll + flash
     - Undo-able delete (soft delete + toast)
     - "n" keyboard shortcut to add a new event

   Backed by GET/POST/PUT/PATCH/DELETE /api/timeline/:code
   (see timeline-routes.js)
   ================================================================ */
'use strict';

const API = '';

const TAG_COLORS = {
  'Earnings':          '#00e676',
  'Dividend':          '#2E7FF6',
  'Corporate Action':  '#C77DFF',
  'News':              '#8fa3c0',
  'Price Alert':       '#FF6B6B',
  'Management':        '#FFD700',
  'Other':             '#8fa3c0',
};
const SENTIMENT_ICON = { bullish: '📈', bearish: '📉', neutral: '➖', none: '' };

let CODE = null;
let cards = [];        // full in-memory cache
let editingId = null;  // null = creating new
let sortDir = 'desc';  // 'desc' = newest first
let searchTerm = '';
let activeTags = new Set(); // empty = all tags shown
let pendingDelete = null;   // { card, timer } for undo

/* ---------------------------------------------------------------- */
function qs(id) { return document.getElementById(id); }

function getCodeFromURL() {
  const params = new URLSearchParams(window.location.search);
  return (params.get('code') || '').toUpperCase();
}

function setStatus(msg, type) {
  const el = qs('tl-status');
  if (!msg) { el.className = 'tl-status'; el.textContent = ''; return; }
  el.className = `tl-status ${type || ''}`;
  el.textContent = msg;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function yearOf(iso) {
  const y = (iso || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? y : 'Undated';
}

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

function uid() {
  return 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ----------------------------------------------------------------
   DATA LOAD / SAVE
---------------------------------------------------------------- */
async function loadTimeline() {
  setStatus('Loading timeline…', 'loading');
  try {
    const res = await fetch(`${API}/api/timeline/${encodeURIComponent(CODE)}`);
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    const data = await res.json();
    cards = Array.isArray(data.cards) ? data.cards : [];
    renderTagFilters();
    renderAll();
    setStatus('');
    handleDeepLink();
  } catch (err) {
    setStatus(`Could not load timeline: ${err.message}`, 'error');
    cards = [];
    renderAll();
  }
}

async function createCard(payload) {
  const res = await fetch(`${API}/api/timeline/${encodeURIComponent(CODE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create failed (${res.status})`);
  return res.json();
}

async function updateCard(id, payload) {
  const res = await fetch(`${API}/api/timeline/${encodeURIComponent(CODE)}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
  return res.json();
}

async function togglePinAPI(id) {
  const res = await fetch(`${API}/api/timeline/${encodeURIComponent(CODE)}/${encodeURIComponent(id)}/pin`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error(`Pin toggle failed (${res.status})`);
  return res.json();
}

async function deleteCardAPI(id) {
  const res = await fetch(`${API}/api/timeline/${encodeURIComponent(CODE)}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status})`);
  return res.json();
}

/* ----------------------------------------------------------------
   FILTER / SORT PIPELINE
---------------------------------------------------------------- */
function getVisibleCards() {
  let list = cards.slice();

  if (searchTerm) {
    const t = searchTerm.toLowerCase();
    list = list.filter(c =>
      (c.title || '').toLowerCase().includes(t) ||
      (c.description || '').toLowerCase().includes(t)
    );
  }

  if (activeTags.size) {
    list = list.filter(c => activeTags.has(c.tag || 'Other'));
  }

  list.sort((a, b) => sortDir === 'desc'
    ? (b.date || '').localeCompare(a.date || '')
    : (a.date || '').localeCompare(b.date || ''));

  return list;
}

/* ----------------------------------------------------------------
   RENDER — top-level orchestration
---------------------------------------------------------------- */
function renderAll() {
  const visible = getVisibleCards();
  const pinned = visible.filter(c => c.pinned);
  const rest = visible.filter(c => !c.pinned);

  renderStats();
  renderPinned(pinned);
  renderStack(rest);
}

function renderStats() {
  const bar = qs('tl-stats-bar');
  if (!cards.length) { bar.innerHTML = ''; return; }
  const thisYear = new Date().getFullYear().toString();
  const thisYearCount = cards.filter(c => yearOf(c.date) === thisYear).length;
  const pinnedCount = cards.filter(c => c.pinned).length;
  const latest = cards.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

  bar.innerHTML = `
    <span class="tl-stat-pill">Total <strong>${cards.length}</strong></span>
    <span class="tl-stat-pill">${thisYear} <strong>${thisYearCount}</strong></span>
    <span class="tl-stat-pill">📌 Pinned <strong>${pinnedCount}</strong></span>
    ${latest ? `<span class="tl-stat-pill">Latest <strong>${fmtDate(latest.date)}</strong></span>` : ''}
  `;
}

function renderTagFilters() {
  const wrap = qs('tl-tag-filters');
  const usedTags = [...new Set(cards.map(c => c.tag || 'Other'))];
  if (!usedTags.length) { wrap.innerHTML = ''; return; }

  wrap.innerHTML = usedTags.map(tag => {
    const color = TAG_COLORS[tag] || '#8fa3c0';
    const active = activeTags.has(tag) ? ' active' : '';
    return `<button class="tl-tag-chip${active}" style="--tag-color:${color}" data-tag="${escHtml(tag)}">${escHtml(tag)}</button>`;
  }).join('');

  wrap.querySelectorAll('.tl-tag-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
      renderTagFilters();
      renderAll();
    });
  });
}

function renderPinned(pinnedList) {
  const section = qs('tl-pinned-section');
  const stack = qs('tl-pinned-stack');
  if (!pinnedList.length) { section.style.display = 'none'; stack.innerHTML = ''; return; }
  section.style.display = 'block';
  stack.classList.add('has-items');
  stack.innerHTML = pinnedList.map(c => cardHTML(c, true)).join('');
}

function renderStack(list) {
  const stack = qs('tl-stack');
  const empty = qs('tl-empty');
  qs('tl-count').textContent = `${cards.length} event${cards.length === 1 ? '' : 's'}`;

  if (!cards.length) {
    stack.classList.remove('has-items');
    stack.innerHTML = '';
    stack.appendChild(empty);
    empty.style.display = 'flex';
    return;
  }

  if (!list.length) {
    stack.classList.remove('has-items');
    stack.innerHTML = `<div class="tl-empty" style="display:flex">No events match your search/filter.</div>`;
    return;
  }

  stack.classList.add('has-items');

  // Group by year, preserving sort order
  let html = '';
  let currentYear = null;
  list.forEach(c => {
    const y = yearOf(c.date);
    if (y !== currentYear) {
      html += `<div class="tl-year-header">${y}</div>`;
      currentYear = y;
    }
    html += cardHTML(c, false);
  });
  stack.innerHTML = html;
}

function cardHTML(c, inPinnedSection) {
  const links = Array.isArray(c.links) ? c.links.filter(l => l && l.url) : [];
  const images = Array.isArray(c.images) ? c.images.filter(Boolean) : [];
  const tag = c.tag || 'Other';
  const tagColor = TAG_COLORS[tag] || '#8fa3c0';
  const sentIcon = SENTIMENT_ICON[c.sentiment] || '';
  const pinned = !!c.pinned;

  const linksHTML = links.length ? `
    <div class="tl-card-links">
      ${links.map(l => `
        <a class="tl-link-chip" href="${escHtml(l.url)}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          ${escHtml(l.label || l.url)}
        </a>`).join('')}
    </div>` : '';

  const imagesHTML = images.length ? `
    <div class="tl-card-images">
      ${images.map(src => `<img src="${escHtml(src)}" alt="" loading="lazy" onclick="window.__tlOpenLightbox('${escHtml(src)}')" onerror="this.style.display='none'"/>`).join('')}
    </div>` : '';

  return `
    <div class="tl-card${pinned ? ' is-pinned' : ''}" data-id="${escHtml(c.id)}" id="${escHtml(c.id)}">
      <div class="tl-dot"></div>
      <div class="tl-card-inner">
        <div class="tl-card-hd" onclick="window.__tlToggle('${escHtml(c.id)}')">
          <div class="tl-card-hd-main">
            <div class="tl-card-date">
              ${fmtDate(c.date)}
              <span class="tl-tag-badge" style="--tag-color:${tagColor}">${escHtml(tag)}</span>
              ${sentIcon ? `<span class="tl-sentiment-icon" title="${escHtml(c.sentiment)}">${sentIcon}</span>` : ''}
            </div>
            <div class="tl-card-title">${escHtml(c.title)}</div>
          </div>
          <div class="tl-card-actions">
            <button class="tl-icon-btn pin${pinned ? ' pinned' : ''}" title="${pinned ? 'Unpin' : 'Pin to top'}" onclick="event.stopPropagation(); window.__tlTogglePin('${escHtml(c.id)}')">
              <svg viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 2l1.5 5.5L19 9l-4 3.5L16 18l-4-2.5L8 18l1-5.5L5 9l5.5-1.5z"/></svg>
            </button>
            <button class="tl-icon-btn edit" title="Edit" onclick="event.stopPropagation(); window.__tlEdit('${escHtml(c.id)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="tl-icon-btn del" title="Delete" onclick="event.stopPropagation(); window.__tlDelete('${escHtml(c.id)}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
            <button class="tl-icon-btn chevron" title="Expand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
          </div>
        </div>
        <div class="tl-card-body">
          <div class="tl-card-body-inner">
            <div class="tl-card-desc">${escHtml(c.description)}</div>
            ${linksHTML}
            ${imagesHTML}
          </div>
        </div>
      </div>
    </div>`;
}

window.__tlToggle = function (id) {
  document.querySelectorAll(`.tl-card[data-id="${cssEscape(id)}"]`).forEach(el => {
    const body = el.querySelector('.tl-card-body');
    const isOpen = el.classList.toggle('open');
    body.style.maxHeight = isOpen ? body.scrollHeight + 40 + 'px' : '0';
  });
};

window.__tlOpenLightbox = function (src) {
  qs('tl-lightbox-img').src = src;
  qs('tl-lightbox').classList.add('open');
};

/* ----------------------------------------------------------------
   PIN TOGGLE
---------------------------------------------------------------- */
window.__tlTogglePin = async function (id) {
  try {
    const { card } = await togglePinAPI(id);
    cards = cards.map(c => c.id === id ? { ...c, pinned: card.pinned } : c);
    renderAll();
  } catch (err) {
    setStatus(err.message, 'error');
  }
};

/* ----------------------------------------------------------------
   DELETE with UNDO
---------------------------------------------------------------- */
window.__tlDelete = function (id) {
  const card = cards.find(c => c.id === id);
  if (!card) return;

  // Optimistically remove from UI
  cards = cards.filter(c => c.id !== id);
  renderTagFilters();
  renderAll();

  // If a previous pending delete exists, commit it immediately
  if (pendingDelete) commitPendingDelete();

  showUndoToast(`"${card.title}" deleted.`, () => {
    // Undo — restore to list, cancel the pending API delete
    cards.push(card);
    renderTagFilters();
    renderAll();
  });

  pendingDelete = {
    card,
    timer: setTimeout(async () => {
      try { await deleteCardAPI(id); } catch (err) { setStatus(err.message, 'error'); }
      pendingDelete = null;
    }, 5000),
  };
};

function commitPendingDelete() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timer);
  deleteCardAPI(pendingDelete.card.id).catch(() => {});
  pendingDelete = null;
}

function showUndoToast(msg, onUndo) {
  const toast = qs('tl-toast');
  qs('tl-toast-msg').textContent = msg;
  toast.classList.add('show');

  const undoBtn = qs('tl-toast-undo');
  const cleanup = () => {
    toast.classList.remove('show');
    undoBtn.onclick = null;
  };

  undoBtn.onclick = () => {
    if (pendingDelete) clearTimeout(pendingDelete.timer);
    pendingDelete = null;
    onUndo();
    cleanup();
  };

  clearTimeout(showUndoToast._hideTimer);
  showUndoToast._hideTimer = setTimeout(cleanup, 5000);
}

/* ----------------------------------------------------------------
   MODAL — add / edit form
---------------------------------------------------------------- */
function openModal(card) {
  editingId = card ? card.id : null;
  qs('tl-modal-title').textContent = card ? 'Edit Event' : 'Add Event';
  qs('tl-form-id').value = card ? card.id : '';
  qs('tl-form-title').value = card ? card.title || '' : '';
  qs('tl-form-date').value = card ? card.date || '' : '';
  qs('tl-form-tag').value = card ? (card.tag || 'Other') : 'Other';
  qs('tl-form-desc').value = card ? card.description || '' : '';
  qs('tl-form-pinned').checked = card ? !!card.pinned : false;
  setSentimentPicker(card ? (card.sentiment || 'none') : 'none');

  renderDynRows('tl-links-list', (card && card.links) || [], linkRowHTML);
  renderDynRows('tl-images-list', (card && card.images) || [], imageRowHTML);

  qs('tl-modal-backdrop').classList.add('open');
  qs('tl-form-title').focus();
}

function closeModal() {
  qs('tl-modal-backdrop').classList.remove('open');
  editingId = null;
}

function setSentimentPicker(val) {
  qs('tl-sentiment-picker').dataset.value = val;
  qs('tl-sentiment-picker').querySelectorAll('.tl-sent-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === val);
  });
}

function linkRowHTML(link) {
  const url = link && typeof link === 'object' ? link.url : (link || '');
  const label = link && typeof link === 'object' ? (link.label || '') : '';
  return `
    <div class="tl-dyn-row" data-kind="link">
      <input type="url" class="tl-input tl-link-url" placeholder="https://…" value="${escHtml(url)}" />
      <input type="text" class="tl-input tl-link-label" placeholder="Label (optional)" style="max-width:140px" value="${escHtml(label)}" />
      <button type="button" class="tl-dyn-row-remove" onclick="this.closest('.tl-dyn-row').remove()">✕</button>
    </div>`;
}

function imageRowHTML(src) {
  return `
    <div class="tl-dyn-row" data-kind="image">
      <input type="url" class="tl-input tl-image-url" placeholder="https://image-url.jpg" value="${escHtml(src || '')}" />
      <button type="button" class="tl-dyn-row-remove" onclick="this.closest('.tl-dyn-row').remove()">✕</button>
    </div>`;
}

function renderDynRows(containerId, items, rowFn) {
  qs(containerId).innerHTML = items.map(rowFn).join('');
}

function collectLinks() {
  return Array.from(qs('tl-links-list').querySelectorAll('.tl-dyn-row')).map(row => ({
    url: row.querySelector('.tl-link-url').value.trim(),
    label: row.querySelector('.tl-link-label').value.trim(),
  })).filter(l => l.url);
}

function collectImages() {
  return Array.from(qs('tl-images-list').querySelectorAll('.tl-dyn-row'))
    .map(row => row.querySelector('.tl-image-url').value.trim())
    .filter(Boolean);
}

/* ----------------------------------------------------------------
   SAVE / EDIT HANDLERS
---------------------------------------------------------------- */
window.__tlEdit = function (id) {
  const card = cards.find(c => c.id === id);
  if (card) openModal(card);
};

async function handleSave() {
  const title = qs('tl-form-title').value.trim();
  const date  = qs('tl-form-date').value;
  if (!title) { setStatus('Title is required.', 'error'); return; }
  if (!date)  { setStatus('Date is required.', 'error'); return; }

  const payload = {
    title,
    date,
    description: qs('tl-form-desc').value.trim(),
    tag: qs('tl-form-tag').value,
    sentiment: qs('tl-sentiment-picker').dataset.value || 'none',
    pinned: qs('tl-form-pinned').checked,
    links: collectLinks(),
    images: collectImages(),
  };

  try {
    if (editingId) {
      const saved = await updateCard(editingId, payload);
      cards = cards.map(c => c.id === editingId ? saved.card || { ...c, ...payload } : c);
      setStatus('Event updated.', 'success');
    } else {
      const saved = await createCard(payload);
      const newCard = saved.card || { id: uid(), ...payload };
      cards.push(newCard);
      setStatus('Event added.', 'success');
    }
    renderTagFilters();
    renderAll();
    closeModal();
    setTimeout(() => setStatus(''), 2000);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

/* ----------------------------------------------------------------
   EXPORT / IMPORT
---------------------------------------------------------------- */
function handleExport() {
  const blob = new Blob([JSON.stringify({ cards }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${CODE}-timeline.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch { setStatus('Invalid JSON file.', 'error'); return; }

    const incoming = Array.isArray(parsed.cards) ? parsed.cards : Array.isArray(parsed) ? parsed : null;
    if (!incoming) { setStatus('JSON must contain a "cards" array.', 'error'); return; }

    setStatus(`Importing ${incoming.length} event(s)…`, 'loading');
    let ok = 0, fail = 0;
    for (const item of incoming) {
      try {
        const saved = await createCard({
          title: item.title || 'Untitled',
          date: item.date || '',
          description: item.description || '',
          tag: item.tag || 'Other',
          sentiment: item.sentiment || 'none',
          pinned: !!item.pinned,
          links: item.links || [],
          images: item.images || [],
        });
        cards.push(saved.card);
        ok++;
      } catch { fail++; }
    }
    renderTagFilters();
    renderAll();
    setStatus(`Imported ${ok} event(s)${fail ? `, ${fail} failed` : ''}.`, fail ? 'error' : 'success');
    setTimeout(() => setStatus(''), 3000);
  };
  reader.readAsText(file);
}

/* ----------------------------------------------------------------
   DEEP LINK — #ev_xxx scrolls to & flashes a specific event
---------------------------------------------------------------- */
function handleDeepLink() {
  const hash = window.location.hash.replace('#', '');
  if (!hash) return;
  const card = cards.find(c => c.id === hash);
  if (!card) return;

  // Make sure filters don't hide it
  searchTerm = '';
  qs('tl-search').value = '';
  activeTags.clear();
  renderTagFilters();
  renderAll();

  requestAnimationFrame(() => {
    const el = document.getElementById(hash);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.__tlToggle(hash);
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1700);
  });
}

/* ----------------------------------------------------------------
   INIT
---------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  qs('theme-toggle-btn').addEventListener('click', toggleTheme);

  qs('tl-lightbox').addEventListener('click', () => {
    qs('tl-lightbox').classList.remove('open');
    qs('tl-lightbox-img').src = '';
  });

  CODE = getCodeFromURL();
  if (!CODE) {
    setStatus('No company code specified in the URL (?code=TICKER).', 'error');
  } else {
    qs('tl-code').textContent = CODE;
    document.title = `${CODE} — Timeline`;
    qs('hdr-sub').textContent = `Company milestones & events · ${CODE}`;
    qs('back-to-company-btn').href = `/company_profile/company.html?code=${encodeURIComponent(CODE)}`;
    loadTimeline();
  }

  qs('tl-add-btn').addEventListener('click', () => openModal(null));
  qs('tl-cancel-btn').addEventListener('click', closeModal);
  qs('tl-modal-close').addEventListener('click', closeModal);
  qs('tl-modal-backdrop').addEventListener('click', closeModal);
  qs('tl-save-btn').addEventListener('click', handleSave);
  qs('tl-add-link-row').addEventListener('click', () => {
    qs('tl-links-list').insertAdjacentHTML('beforeend', linkRowHTML({}));
  });
  qs('tl-add-image-row').addEventListener('click', () => {
    qs('tl-images-list').insertAdjacentHTML('beforeend', imageRowHTML(''));
  });

  qs('tl-sentiment-picker').addEventListener('click', e => {
    const btn = e.target.closest('.tl-sent-opt');
    if (!btn) return;
    setSentimentPicker(btn.dataset.val);
  });

  // Search
  let searchDebounce;
  qs('tl-search').addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = e.target.value.trim();
      renderAll();
    }, 150);
  });

  // Sort toggle
  qs('tl-sort-btn').addEventListener('click', () => {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    qs('tl-sort-label').textContent = sortDir === 'desc' ? 'Newest' : 'Oldest';
    renderAll();
  });

  // Export / Import
  qs('tl-export-btn').addEventListener('click', handleExport);
  qs('tl-import-btn').addEventListener('click', () => qs('tl-import-input').click());
  qs('tl-import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) handleImportFile(file);
    e.target.value = '';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeModal();
      qs('tl-lightbox').classList.remove('open');
    }
    // "n" opens Add Event modal, unless focus is in an input/textarea or modal already open
    if (e.key === 'n' || e.key === 'N') {
      const tag = document.activeElement.tagName;
      const modalOpen = qs('tl-modal-backdrop').classList.contains('open');
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !modalOpen) {
        openModal(null);
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (pendingDelete) commitPendingDelete();
  });
});