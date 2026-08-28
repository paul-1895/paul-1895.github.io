/* ═══════════════════════════════════════════════════════════
   topic.js  —  Topic Detail Page
   Manages notes & links for a specific topic.
   YouTube links open in an inline player modal.
═══════════════════════════════════════════════════════════ */
'use strict';

// ──────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────
let currentTopic  = null;
let editingNoteId = null;
let editingLinkId = null;
let deletingItem  = null; // { type: 'note'|'link', id }

// ──────────────────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');
  if (!id) { window.location.href = 'learning.html'; return; }

  const topics = loadTopics();
  currentTopic = topics.find(t => t.id === id);
  if (!currentTopic) { window.location.href = 'learning.html'; return; }

  applyTopicColor(currentTopic.color);
  renderTopicHero();
  renderNotes();
  renderLinks();
  injectYTModal();
});

// ──────────────────────────────────────────────────────────
// YOUTUBE HELPERS
// ──────────────────────────────────────────────────────────

/**
 * Extract the YouTube video ID from any common YouTube URL format:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://m.youtube.com/watch?v=VIDEO_ID
 * Returns null if the URL is not a YouTube link.
 */
function getYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');

    if (host === 'youtu.be') {
      // https://youtu.be/VIDEO_ID?si=…
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com') {
      if (u.pathname.startsWith('/watch')) {
        return u.searchParams.get('v') || null;
      }
      if (u.pathname.startsWith('/embed/')) {
        return u.pathname.split('/')[2] || null;
      }
      if (u.pathname.startsWith('/shorts/')) {
        return u.pathname.split('/')[2] || null;
      }
    }
  } catch { /* invalid URL */ }
  return null;
}

function isYouTube(url) {
  return !!getYouTubeId(url);
}

// ──────────────────────────────────────────────────────────
// YOUTUBE IFRAME PLAYER API  (enables setPlaybackRate)
// ──────────────────────────────────────────────────────────
const YT_PLAYBACK_RATE = 2; // always start at 2×
let ytPlayer      = null;   // YT.Player instance
let ytPlayerReady = false;
let ytPendingId   = null;   // videoId to load once API is ready

// Load the IFrame Player API script once
function loadYTApi() {
  if (window.YT && window.YT.Player) { onYouTubeIframeAPIReady(); return; }
  if (document.getElementById('yt-api-script')) return; // already loading
  const s = document.createElement('script');
  s.id  = 'yt-api-script';
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

// Called automatically by the API script when it finishes loading
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('yt-iframe', {
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
    }
  });
};

function onPlayerReady(event) {
  ytPlayerReady = true;
  document.getElementById('yt-player-wrap').classList.add('loaded');
  // If openYTPlayer was called before the API was ready, load now
  if (ytPendingId) {
    event.target.loadVideoById(ytPendingId);
    ytPendingId = null;
  }
}

function onPlayerStateChange(event) {
  // YT.PlayerState.PLAYING === 1
  // Set 2× as soon as the video starts playing (covers autoplay + manual play)
  if (event.data === 1) {
    event.target.setPlaybackRate(YT_PLAYBACK_RATE);
  }
}

// ──────────────────────────────────────────────────────────
// INJECT YOUTUBE PLAYER MODAL INTO DOM
// ──────────────────────────────────────────────────────────
function injectYTModal() {
  if (document.getElementById('yt-overlay')) return; // already injected

  const overlay = document.createElement('div');
  overlay.className = 'yt-overlay';
  overlay.id = 'yt-overlay';
  overlay.addEventListener('click', closeYTPlayer);
  document.body.appendChild(overlay);

  const modal = document.createElement('div');
  modal.className = 'yt-modal';
  modal.id = 'yt-modal';
  modal.innerHTML = `
    <div class="yt-modal-header">
      <div class="yt-modal-title-wrap">
        <span class="yt-modal-yt-badge">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>
          YouTube
        </span>
        <div class="yt-modal-label" id="yt-modal-label">Video</div>
      </div>
      <div class="yt-modal-header-actions">
        <span class="yt-speed-badge">2× speed</span>
        <a class="yt-ext-link" id="yt-ext-link" href="#" target="_blank" rel="noopener" onclick="event.stopPropagation()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          Open in YouTube
        </a>
        <button class="yt-close-btn" onclick="closeYTPlayer()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="yt-player-wrap" id="yt-player-wrap">
      <!-- div target for YT.Player — the API replaces this with an iframe -->
      <div id="yt-iframe"></div>
    </div>
    <div class="yt-modal-footer">
      <div class="yt-modal-url" id="yt-modal-url"></div>
      <div class="yt-modal-hint">Press <kbd style="font-family:var(--mono);font-size:9px;background:var(--bg-base);border:1px solid var(--border);border-radius:3px;padding:1px 5px">Esc</kbd> to close · playback auto-set to 2×</div>
    </div>`;
  document.body.appendChild(modal);

  // Load the YT IFrame API (creates window.onYouTubeIframeAPIReady callback above)
  loadYTApi();

  // Keyboard close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeYTPlayer();
  });
}

// ──────────────────────────────────────────────────────────
// OPEN / CLOSE PLAYER
// ──────────────────────────────────────────────────────────
function openYTPlayer(url, label) {
  const videoId = getYouTubeId(url);
  if (!videoId) return;

  // Reset shimmer
  document.getElementById('yt-player-wrap').classList.remove('loaded');

  // Populate header/footer
  document.getElementById('yt-modal-label').textContent = label || 'YouTube Video';
  document.getElementById('yt-ext-link').href           = url;
  document.getElementById('yt-modal-url').textContent   = url;

  // Show modal first (player needs to be visible to initialise properly)
  document.getElementById('yt-overlay').classList.add('open');
  document.getElementById('yt-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  if (ytPlayerReady && ytPlayer) {
    // Player already initialised — just swap the video
    ytPlayer.loadVideoById(videoId);
    // Rate will be applied in onPlayerStateChange when playback starts
  } else {
    // API still loading — store id and let onPlayerReady handle it
    ytPendingId = videoId;
  }
}

function closeYTPlayer() {
  if (ytPlayer && ytPlayerReady) {
    try { ytPlayer.stopVideo(); } catch (_) {}
  }

  document.getElementById('yt-overlay').classList.remove('open');
  document.getElementById('yt-modal').classList.remove('open');
  document.body.style.overflow = '';
}

// ──────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────
function persistTopic() {
  const topics = loadTopics();
  const idx    = topics.findIndex(t => t.id === currentTopic.id);
  if (idx !== -1) topics[idx] = currentTopic;
  else topics.push(currentTopic);
  // saveTopics returns false instead of throwing when storage is full or
  // blocked — callers must surface that, or the item renders as saved and
  // silently vanishes on the next load.
  return saveTopics(topics);
}

function warnSaveFailed() {
  alert("Couldn't save — storage is full or blocked. Your change is shown but won't survive a reload.");
}

function applyTopicColor(color) {
  document.documentElement.style.setProperty('--topic-color', color || '#00f5c4');
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────────────────
// HERO
// ──────────────────────────────────────────────────────────
function renderTopicHero() {
  const t = currentTopic;
  document.title = `${t.name} — DSE Learning`;
  document.getElementById('topic-title-header').textContent = t.name;
  document.getElementById('topic-cat-header').textContent   = `${t.category} · Learning Hub`;
  document.getElementById('topic-badge').textContent        = t.category.toUpperCase();
  document.getElementById('topic-title-main').textContent   = t.name;
  document.getElementById('topic-desc-main').textContent    = t.description || 'No description.';
  document.getElementById('topic-created-date').textContent = fmtDate(t.createdAt);
  updateCounts();
}

function updateCounts() {
  const noteCount = (currentTopic.notes || []).length;
  const linkCount = (currentTopic.links || []).length;
  document.getElementById('topic-notes-count').textContent = noteCount;
  document.getElementById('topic-links-count').textContent = linkCount;
  document.getElementById('notes-badge').textContent       = noteCount;
  document.getElementById('links-badge').textContent       = linkCount;
}

// ──────────────────────────────────────────────────────────
// NOTES
// ──────────────────────────────────────────────────────────
function renderNotes() {
  const list  = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');
  const notes = currentTopic.notes || [];

  list.querySelectorAll('.note-card').forEach(el => el.remove());

  if (notes.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const sorted = [...notes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  sorted.forEach(n => {
    const div = document.createElement('div');
    div.className = 'note-card';
    div.dataset.id = n.id;
    div.innerHTML = `
      <div class="note-card-header">
        <div class="note-card-title">${esc(n.title)}</div>
        <div class="note-card-actions">
          <button class="note-action-btn edit" title="Edit" onclick="openNoteModal('${n.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="note-action-btn del" title="Delete" onclick="openItemDel('note','${n.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="note-card-content">${esc(n.content)}</div>
      <div class="note-card-meta">
        ${n.tag ? `<span class="note-card-tag">${esc(n.tag)}</span>` : ''}
        <span class="note-card-date">${fmtDate(n.createdAt)}</span>
      </div>`;
    list.appendChild(div);
  });

  updateCounts();
}

function openNoteModal(editId) {
  editingNoteId = editId || null;
  if (editId) {
    const n = (currentTopic.notes || []).find(x => x.id === editId);
    if (!n) return;
    document.getElementById('note-modal-title').textContent = 'Edit Note';
    document.getElementById('note-title-input').value   = n.title;
    document.getElementById('note-content-input').value = n.content;
    document.getElementById('note-tag-input').value     = n.tag || '';
  } else {
    document.getElementById('note-modal-title').textContent = 'Add Note';
    document.getElementById('note-title-input').value   = '';
    document.getElementById('note-content-input').value = '';
    document.getElementById('note-tag-input').value     = '';
  }
  showNoteModal();
  setTimeout(() => document.getElementById('note-title-input')?.focus(), 60);
}

function showNoteModal() {
  document.getElementById('note-overlay').classList.add('open');
  document.getElementById('note-modal').style.display = 'flex';
  document.getElementById('note-modal').classList.add('open');
}

function closeNoteModal() {
  document.getElementById('note-overlay').classList.remove('open');
  document.getElementById('note-modal').style.display = 'none';
  document.getElementById('note-modal').classList.remove('open');
  editingNoteId = null;
}

function saveNote() {
  const title   = document.getElementById('note-title-input').value.trim();
  const content = document.getElementById('note-content-input').value.trim();
  const tag     = document.getElementById('note-tag-input').value.trim();

  if (!title)   { shakeEl(document.getElementById('note-title-input'));   return; }
  if (!content) { shakeEl(document.getElementById('note-content-input')); return; }

  if (!currentTopic.notes) currentTopic.notes = [];

  if (editingNoteId) {
    const n = currentTopic.notes.find(x => x.id === editingNoteId);
    if (n) { n.title = title; n.content = content; n.tag = tag; }
  } else {
    currentTopic.notes.push({
      id: Date.now().toString(), title, content, tag,
      createdAt: new Date().toISOString()
    });
  }

  if (!persistTopic()) { warnSaveFailed(); return; } // keep the modal open
  closeNoteModal();
  renderNotes();
}

// ──────────────────────────────────────────────────────────
// LINKS  (YouTube-aware)
// ──────────────────────────────────────────────────────────
function renderLinks() {
  const list  = document.getElementById('links-list');
  const empty = document.getElementById('links-empty');
  const links = currentTopic.links || [];

  list.querySelectorAll('.link-card').forEach(el => el.remove());

  if (links.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const sorted = [...links].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  sorted.forEach(lk => {
    const ytId  = getYouTubeId(lk.url);
    const isYT  = !!ytId;

    const div = document.createElement('div');
    div.className = 'link-card' + (isYT ? ' is-youtube' : '');
    div.dataset.id = lk.id;

    // YouTube thumbnail preview strip
    const thumbHtml = isYT
      ? `<div class="yt-thumb-wrap">
           <img class="yt-thumb" src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" alt="" loading="lazy" />
           <div class="yt-thumb-play">
             <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
           </div>
         </div>`
      : '';

    // Type badge: override with YouTube badge if applicable
    const typeBadge = isYT
      ? `<span class="yt-play-badge">
           <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>
           Watch inline
         </span>`
      : `<span class="link-card-type">${esc(lk.type || 'Link')}</span>`;

    // Open button: for YouTube open player; for others open in tab
    const openBtnHtml = isYT
      ? `<button class="note-action-btn yt-open-btn" title="Play video" onclick="event.stopPropagation();openYTPlayer('${esc(lk.url)}','${esc(lk.label)}')">
           <svg viewBox="0 0 24 24" fill="currentColor" style="color:#ff4444"><path d="M8 5v14l11-7z"/></svg>
         </button>`
      : `<a class="note-action-btn" href="${esc(lk.url)}" target="_blank" rel="noopener" title="Open" onclick="event.stopPropagation()">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
             <polyline points="15 3 21 3 21 9"/>
             <line x1="10" y1="14" x2="21" y2="3"/>
           </svg>
         </a>`;

    div.innerHTML = `
      ${thumbHtml}
      <div class="link-card-content-wrap">
        <div class="link-card-header">
          <div class="link-card-label">${esc(lk.label)}</div>
          <div class="link-card-actions">
            <button class="note-action-btn edit" title="Edit" onclick="event.stopPropagation();openLinkModal('${lk.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="note-action-btn del" title="Delete" onclick="event.stopPropagation();openItemDel('link','${lk.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
              </svg>
            </button>
            ${openBtnHtml}
          </div>
        </div>
        <span class="link-card-url">${esc(lk.url)}</span>
        ${lk.note ? `<div class="link-card-note">${esc(lk.note)}</div>` : ''}
        <div class="link-card-meta">
          ${typeBadge}
          <span class="link-card-date">${fmtDate(lk.createdAt)}</span>
        </div>
      </div>`;

    // Click handler: YouTube → player, others → new tab
    div.addEventListener('click', e => {
      if (e.target.closest('.link-card-actions')) return;
      if (isYT) {
        openYTPlayer(lk.url, lk.label);
      } else {
        window.open(lk.url, '_blank', 'noopener');
      }
    });

    list.appendChild(div);
  });

  updateCounts();
}

function openLinkModal(editId) {
  editingLinkId = editId || null;
  if (editId) {
    const lk = (currentTopic.links || []).find(x => x.id === editId);
    if (!lk) return;
    document.getElementById('link-modal-title').textContent = 'Edit Link';
    document.getElementById('link-url-input').value   = lk.url;
    document.getElementById('link-label-input').value = lk.label;
    document.getElementById('link-note-input').value  = lk.note || '';
    document.getElementById('link-type-input').value  = lk.type || 'Article';
  } else {
    document.getElementById('link-modal-title').textContent = 'Add Link';
    document.getElementById('link-url-input').value   = '';
    document.getElementById('link-label-input').value = '';
    document.getElementById('link-note-input').value  = '';
    document.getElementById('link-type-input').value  = 'Article';
  }
  showLinkModal();
  setTimeout(() => document.getElementById('link-url-input')?.focus(), 60);
}

// Auto-detect YouTube when URL is pasted and pre-fill type
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('link-url-input');
  if (urlInput) {
    urlInput.addEventListener('input', () => {
      const url = urlInput.value.trim();
      if (isYouTube(url)) {
        const typeSelect = document.getElementById('link-type-input');
        if (typeSelect) typeSelect.value = 'Video';
      }
    });
  }
});

function showLinkModal() {
  document.getElementById('link-overlay').classList.add('open');
  document.getElementById('link-modal').style.display = 'flex';
  document.getElementById('link-modal').classList.add('open');
}

function closeLinkModal() {
  document.getElementById('link-overlay').classList.remove('open');
  document.getElementById('link-modal').style.display = 'none';
  document.getElementById('link-modal').classList.remove('open');
  editingLinkId = null;
}

function saveLink() {
  const url   = document.getElementById('link-url-input').value.trim();
  const label = document.getElementById('link-label-input').value.trim();
  const note  = document.getElementById('link-note-input').value.trim();
  const type  = document.getElementById('link-type-input').value;

  if (!url || !/^https?:\/\//i.test(url)) { shakeEl(document.getElementById('link-url-input'));   return; }
  if (!label)                              { shakeEl(document.getElementById('link-label-input')); return; }

  if (!currentTopic.links) currentTopic.links = [];

  if (editingLinkId) {
    const lk = currentTopic.links.find(x => x.id === editingLinkId);
    if (lk) { lk.url = url; lk.label = label; lk.note = note; lk.type = type; }
  } else {
    currentTopic.links.push({
      id: Date.now().toString(), url, label, note, type,
      createdAt: new Date().toISOString()
    });
  }

  if (!persistTopic()) { warnSaveFailed(); return; } // keep the modal open
  closeLinkModal();
  renderLinks();
}

// ──────────────────────────────────────────────────────────
// DELETE (item)
// ──────────────────────────────────────────────────────────
function openItemDel(type, id) {
  deletingItem = { type, id };
  const overlay = document.getElementById('item-del-overlay');
  const modal   = document.getElementById('item-del-modal');
  if (overlay) { overlay.style.display = 'block'; overlay.classList.add('open'); }
  if (modal)   { modal.style.display = 'flex'; modal.classList.add('open'); }
}

function closeItemDel() {
  const overlay = document.getElementById('item-del-overlay');
  const modal   = document.getElementById('item-del-modal');
  if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('open'); }
  if (modal)   { modal.style.display = 'none'; modal.classList.remove('open'); }
  deletingItem = null;
}

function confirmItemDelete() {
  if (!deletingItem) return;
  const { type, id } = deletingItem;
  if (type === 'note') {
    currentTopic.notes = (currentTopic.notes || []).filter(x => x.id !== id);
    if (!persistTopic()) warnSaveFailed();
    renderNotes();
  } else if (type === 'link') {
    currentTopic.links = (currentTopic.links || []).filter(x => x.id !== id);
    if (!persistTopic()) warnSaveFailed();
    renderLinks();
  }
  closeItemDel();
}

// ──────────────────────────────────────────────────────────
// UTIL
// ──────────────────────────────────────────────────────────
function shakeEl(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = 'learnShake 0.35s ease';
  setTimeout(() => el.style.animation = '', 400);
}

// Expose globals
window.openNoteModal     = openNoteModal;
window.closeNoteModal    = closeNoteModal;
window.saveNote          = saveNote;
window.openLinkModal     = openLinkModal;
window.closeLinkModal    = closeLinkModal;
window.saveLink          = saveLink;
window.openItemDel       = openItemDel;
window.closeItemDel      = closeItemDel;
window.confirmItemDelete = confirmItemDelete;
window.openYTPlayer      = openYTPlayer;
window.closeYTPlayer     = closeYTPlayer;