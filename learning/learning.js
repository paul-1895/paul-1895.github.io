/* ═══════════════════════════════════════════════════════════
   learning.js  —  Learning Hub (topics list page)
   Storage: 'dse-learning-topics' (topics, shared with topic.html),
            'dse-learning-sort' (sort mode),
            'dse-learning-guide-visits' (reading progress, hub-only)
   Also loaded by topic.html for loadTopics()/saveTopics() —
   everything page-specific stays behind the #learn-grid guard.
═══════════════════════════════════════════════════════════ */
'use strict';

// ──────────────────────────────────────────────────────────
// STORAGE — topics
// ──────────────────────────────────────────────────────────
const STORAGE_KEY = 'dse-learning-topics';
const DEFAULT_COLOR = '#00f5c4';

function loadTopics() {
  let parsed;
  try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
  if (!Array.isArray(parsed)) return [];
  // One corrupt record must not break renderTopics for every other topic.
  return parsed
    .filter(t => t && typeof t.id === 'string' && typeof t.name === 'string')
    .map(t => ({
      ...t,
      category: typeof t.category === 'string' ? t.category : 'Other',
      notes:    Array.isArray(t.notes) ? t.notes : [],
      links:    Array.isArray(t.links) ? t.links : [],
    }));
}

function saveTopics(topics) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(topics)); return true; }
  catch { return false; } // quota full or storage blocked — callers surface it
}

// ──────────────────────────────────────────────────────────
// STORAGE — guide reading progress
// ──────────────────────────────────────────────────────────
const VISITS_KEY = 'dse-learning-guide-visits';

function loadVisits() {
  try {
    const parsed = JSON.parse(localStorage.getItem(VISITS_KEY));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function markVisited(base) {
  if (!base || !KNOWN_GUIDES.includes(base)) return;
  const now = new Date().toISOString();
  // A hand-edited or foreign-format store could hold a non-object entry
  // (e.g. a bare number) — assigning .n onto that would throw under
  // 'use strict' and poison this guide's entry forever.
  const prev  = visits[base];
  const entry = (prev && typeof prev === 'object' && !Array.isArray(prev)) ? prev : { n: 0, first: now };
  entry.n = (typeof entry.n === 'number' ? entry.n : 0) + 1;
  entry.last = now;
  visits[base] = entry;
  // Sync write — must complete before a click's navigation unloads the page.
  try { localStorage.setItem(VISITS_KEY, JSON.stringify(visits)); } catch { /* progress is a nicety, never block */ }
  refreshReadUI();
}

function relTime(iso) {
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ──────────────────────────────────────────────────────────
// STATE
// ──────────────────────────────────────────────────────────
let topics        = loadTopics();
let visits        = loadVisits();
let editingId     = null;
let deletingId    = null;
let selectedColor = DEFAULT_COLOR;
let activeChip    = '*'; // deliberately NOT persisted — an invisible sticky
                         // filter would make guides "disappear" next session
let KNOWN_GUIDES  = []; // built at init from the 14 card hrefs
let KNOWN_GUIDE_PATHS = new Set(); // full pathnames — a basename alone can
                                    // collide with a same-named file elsewhere
                                    // in the app (e.g. minervini_model/minervini.html)
let guideNameOf   = {}; // base -> display name, for the Up Next rail

const baseOf = href => { try { return new URL(href, location.href).pathname.split('/').pop(); } catch { return ''; } };

// ──────────────────────────────────────────────────────────
// STATS
// ──────────────────────────────────────────────────────────
function updateStats() {
  if (!document.getElementById('stat-topics')) return;

  let totalNotes = 0, totalLinks = 0;
  topics.forEach(t => {
    totalNotes += (t.notes || []).length;
    totalLinks += (t.links || []).length;
  });

  const setStat = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.classList.toggle('is-zero', val === 0);
  };
  setStat('stat-topics', topics.length);
  setStat('stat-notes',  totalNotes);
  setStat('stat-links',  totalLinks);

  const topicCount = document.getElementById('topic-count');
  if (topicCount) topicCount.textContent = topics.length;
}

// One-shot count-up on first load; later updateStats calls set values directly.
function countUpStats() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  ['stat-topics', 'stat-notes', 'stat-links'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const target = parseInt(el.textContent, 10) || 0;
    if (!target) return;
    const t0 = performance.now();
    const tick = now => {
      const p = Math.min(1, (now - t0) / 500);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ──────────────────────────────────────────────────────────
// READING-PROGRESS UI (ring, read flags, badge, Up Next)
// ──────────────────────────────────────────────────────────
const RING_C = 2 * Math.PI * 26; // r=26 → ≈163.36

function readCount() {
  return KNOWN_GUIDES.filter(b => visits[b]).length;
}

function applyReadStates() {
  document.querySelectorAll('.learn-card--guide').forEach(card => {
    const entry = visits[baseOf(card.href)];
    card.dataset.read = entry ? 'true' : 'false';
    const flag = card.querySelector('.learn-read-flag');
    if (!flag) return;
    if (entry) {
      flag.innerHTML =
        `<svg class="learn-read-check" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>` +
        // sr-only text comes first and stands alone in the accessible name —
        // the abbreviated visible time ("3d ago") is hidden from AT rather
        // than mangled ("three d ago") or left dangling before "read".
        `<span class="sr-only">, read</span>` +
        `<span class="learn-read-time" aria-hidden="true">${escH(relTime(entry.last))}</span>`;
    } else {
      flag.innerHTML = `<span class="sr-only">, unread</span>`;
    }
  });
}

function updateRing() {
  const ring = document.getElementById('learn-ring');
  if (!ring) return;
  const total = KNOWN_GUIDES.length || 14;
  const read  = readCount();
  document.getElementById('ring-read').textContent = read;
  ring.querySelector('.learn-ring-total').textContent = `/${total}`;
  ring.setAttribute('aria-label', `${read} of ${total} guides read`);
  ring.classList.toggle('is-done', read === total);
  const fill = ring.querySelector('.learn-ring-fill');
  const offset = RING_C * (1 - (total ? read / total : 0));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    fill.style.transition = 'none';
    fill.style.strokeDashoffset = offset;
  } else {
    // Next frame so the transition animates from the previous value on load.
    requestAnimationFrame(() => { fill.style.strokeDashoffset = offset; });
  }

  const badge = document.getElementById('guide-read-badge');
  if (badge) {
    badge.hidden = read === 0;
    badge.textContent = `${read} read`;
  }
}

function renderUpNext() {
  const rail = document.getElementById('learn-upnext');
  if (!rail) return;
  const total = KNOWN_GUIDES.length;
  const read  = readCount();

  const linkCard = (kicker, base, meta) => `
    <a class="learn-upnext-card" href="${escH(base)}">
      <span class="learn-upnext-body">
        <span class="learn-upnext-kicker">${kicker}</span>
        <span class="learn-upnext-name">${escH(guideNameOf[base] || base)}</span>
        <span class="learn-upnext-meta">${escH(meta)}</span>
      </span>
      <svg class="learn-guide-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </a>`;

  if (read === 0) {
    const first = KNOWN_GUIDES[0];
    rail.innerHTML = linkCard('Start here', first, `Guide 1 of ${total} — the curated starting point`);
    return;
  }

  if (read === total) {
    rail.innerHTML = `
      <div class="learn-upnext-card learn-upnext-done">
        <span class="learn-upnext-body">
          <span class="learn-upnext-kicker learn-upnext-kicker--done">
            <svg class="learn-read-check" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
            All ${total} guides read
          </span>
          <span class="learn-upnext-meta">The library is yours — turn what you learned into your own notes.</span>
        </span>
        <button type="button" class="learn-add-btn" id="upnext-capture-btn">Capture it in a topic</button>
      </div>`;
    document.getElementById('upnext-capture-btn')?.addEventListener('click', openAddModal);
    return;
  }

  const lastOpened = KNOWN_GUIDES
    .filter(b => visits[b])
    .sort((a, b) => new Date(visits[b].last) - new Date(visits[a].last))[0];
  const firstUnread = KNOWN_GUIDES.find(b => !visits[b]); // DOM (curated) order
  let html = linkCard('Continue', lastOpened, `opened ${relTime(visits[lastOpened].last)}`);
  if (firstUnread) html += linkCard('Next unread', firstUnread, guideCatOf(firstUnread));
  rail.innerHTML = html;
}

let guideCats = {}; // base -> category, for Up Next meta
function guideCatOf(base) { return guideCats[base] || ''; }

// Idempotent — safe to double-fire (DOMContentLoaded + pageshow both call it).
function refreshReadUI() {
  applyReadStates();
  updateRing();
  renderUpNext();
  filterTopics(); // re-runs filterGuides → chip counts + Unread filter stay truthful
}

// ──────────────────────────────────────────────────────────
// RENDER GRID
// ──────────────────────────────────────────────────────────
// Stored colors reach inline styles; a corrupted or hand-imported
// localStorage entry must not be able to inject markup through them.
function safeColorOf(t) {
  return /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : DEFAULT_COLOR;
}

function renderTopics(list) {
  const grid = document.getElementById('learn-grid');
  if (!grid) return;

  grid.innerHTML = list.map(t => {
    const noteCount = (t.notes || []).length;
    const linkCount = (t.links || []).length;
    const color     = safeColorOf(t);
    const initial   = (t.name.trim().charAt(0) || '?').toUpperCase();
    return `
      <div class="learn-card" style="--topic-color:${color}">
        <span class="learn-topic-mono" aria-hidden="true" style="--tc:${color}">${escH(initial)}</span>
        <div class="learn-card-body">
          <a class="learn-card-link" href="topic.html?id=${encodeURIComponent(t.id)}">
            <div class="learn-card-name">${escH(t.name)}</div>
          </a>
          <div class="learn-card-cat" style="color:${color}">${escH(t.category)}</div>
          ${t.description ? `<div class="learn-card-desc">${escH(t.description)}</div>` : ''}
        </div>
        <div class="learn-card-footer">
          <div class="learn-card-stats">
            <div class="learn-card-stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <strong>${noteCount}</strong>&nbsp;note${noteCount !== 1 ? 's' : ''}
            </div>
            <div class="learn-card-stat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              <strong>${linkCount}</strong>&nbsp;link${linkCount !== 1 ? 's' : ''}
            </div>
          </div>
          <div class="learn-card-actions">
            <button type="button" class="learn-card-btn edit" title="Edit" aria-label="Edit ${escH(t.name)}" data-action="edit" data-id="${escH(t.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button type="button" class="learn-card-btn del" title="Delete" aria-label="Delete ${escH(t.name)}" data-action="del" data-id="${escH(t.id)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  updateStats();
}

const SORT_KEY = 'dse-learning-sort';
let currentSort = localStorage.getItem(SORT_KEY) || 'name-asc';

function sortTopics(list, mode) {
  const sorted = list.slice();
  switch (mode) {
    case 'name-asc':  sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'name-desc': sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
    case 'newest':    sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)); break;
    case 'oldest':    sorted.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)); break;
    case 'notes':     sorted.sort((a, b) => (b.notes || []).length - (a.notes || []).length); break;
    case 'links':     sorted.sort((a, b) => (b.links || []).length - (a.links || []).length); break;
    case 'category':  sorted.sort((a, b) => (a.category || '').localeCompare(b.category || '')); break;
    default: break;
  }
  return sorted;
}

// ──────────────────────────────────────────────────────────
// SEARCH / FILTER PIPELINE
// filterTopics() is the single orchestrator: it narrows the
// user topics, applies the chosen sort on top, filters the
// static guide cards against search AND the active chip,
// then reconciles the empty/no-results states.
// ──────────────────────────────────────────────────────────
function filterTopics() {
  const q = (document.getElementById('learn-search')?.value || '').toLowerCase();
  const filtered = q
    ? topics.filter(t => t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q) || t.category.toLowerCase().includes(q))
    : topics.slice();
  renderTopics(sortTopics(filtered, currentSort));
  const shownGuides = filterGuides(q);
  updateEmptyStates(q, filtered.length, shownGuides);
}

function chipMatches(card, chip) {
  if (chip === '*') return true;
  if (chip === 'unread') return card.dataset.read !== 'true';
  return card.dataset.cat === chip;
}

// Guides are filtered in the DOM (static markup, never re-rendered) against
// the data-search text precomputed at init — name + description + category,
// deliberately NOT the words "built-in guide". Chips filter guides only.
// Returns how many guides remain visible.
function filterGuides(q) {
  let total = 0;
  const chipCounts = { '*': 0, 'unread': 0, 'Technical Analysis': 0, 'Strategy': 0, 'Fundamental Analysis': 0 };

  document.querySelectorAll('.learn-guide-group').forEach(group => {
    let shown = 0;
    group.querySelectorAll('.learn-card--guide').forEach(card => {
      const matchesSearch = !q || (card.dataset.search || '').includes(q);
      if (matchesSearch) {
        // Live intersection feedback: each chip shows how many guides it
        // would reveal given the CURRENT query.
        chipCounts['*']++;
        if (card.dataset.read !== 'true') chipCounts['unread']++;
        if (card.dataset.cat in chipCounts) chipCounts[card.dataset.cat]++;
      }
      const hit = matchesSearch && chipMatches(card, activeChip);
      card.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    // Hide the whole group (subhead included) rather than leaving an
    // orphaned category heading over nothing.
    group.style.display = shown ? '' : 'none';
    total += shown;
  });

  document.querySelectorAll('.learn-chip').forEach(chip => {
    const n = chip.querySelector('.learn-chip-n');
    if (n) n.textContent = chipCounts[chip.dataset.chip] ?? 0;
  });

  // With All active, the section hides when nothing matches (the topics
  // no-results block speaks for the whole page). With a chip active, the
  // section stays visible and explains itself — filters must never produce
  // a silent blank.
  const section = document.getElementById('guides-section');
  const nonePanel = document.getElementById('learn-guides-none');
  if (activeChip === '*') {
    if (section) section.style.display = total ? '' : 'none';
    if (nonePanel) nonePanel.hidden = true;
  } else {
    if (section) section.style.display = '';
    if (nonePanel) {
      nonePanel.hidden = total > 0;
      if (total === 0) {
        const label = document.querySelector(`.learn-chip[data-chip="${CSS.escape(activeChip)}"]`)?.textContent.trim().split(/\s/)[0] || activeChip;
        document.getElementById('guides-none-msg').textContent =
          q ? `No ${label} guides match “${q}”` : `No ${label} guides`;
        const clearBtn = document.getElementById('guides-none-clear');
        if (clearBtn) clearBtn.hidden = !q;
      }
    }
  }
  return total;
}

function chipLabel(chip) {
  return document.querySelector(`.learn-chip[data-chip="${CSS.escape(chip)}"]`)
    ?.textContent.trim().split(/\s+/).slice(0, -1).join(' ') || chip;
}

function setActiveChip(chip) {
  // Forgiving toggle: clicking the active chip reverts to All.
  activeChip = (chip === activeChip) ? '*' : chip;
  document.querySelectorAll('.learn-chip').forEach(b => {
    b.setAttribute('aria-pressed', b.dataset.chip === activeChip ? 'true' : 'false');
  });
  filterTopics();
}

function updateEmptyStates(q, topicMatches, guideMatches) {
  const empty = document.getElementById('learn-empty');
  if (empty) empty.hidden = !(topics.length === 0 && !q);

  // Topics no-results: shown when the user's topics have no match — and also
  // when NOTHING at all matches with no chip narrowing (a zero-topic user
  // searching a non-guide term must not watch the page go blank). With a
  // chip active, the guides-none panel explains the guide side instead.
  const noresults = document.getElementById('learn-noresults');
  const showNoResults = !!q && topicMatches === 0 &&
    (topics.length > 0 || (guideMatches === 0 && activeChip === '*'));
  if (noresults) {
    noresults.hidden = !showNoResults;
    if (showNoResults) {
      const qEl = document.getElementById('noresults-q');
      if (qEl) qEl.textContent = q;
      const heading = document.getElementById('noresults-h');
      const prefix  = document.getElementById('noresults-prefix');
      const allBlank = guideMatches === 0 && activeChip === '*';
      if (heading) heading.textContent = allBlank ? 'No matches' : 'No topics match';
      if (prefix)  prefix.textContent  = allBlank ? 'Nothing matches' : 'Nothing in your topics matches';
    }
  }

  const status = document.getElementById('learn-results-status');
  if (status) {
    if (q || activeChip !== '*') {
      const chipNote = activeChip !== '*' ? ` (${chipLabel(activeChip)})` : '';
      status.textContent = `${guideMatches} guide${guideMatches !== 1 ? 's' : ''}${chipNote} and ${topicMatches} topic${topicMatches !== 1 ? 's' : ''} match`;
    } else {
      status.textContent = '';
    }
  }
}

function setSortMode(mode) {
  currentSort = mode;
  localStorage.setItem(SORT_KEY, mode);
  filterTopics();
}

// ──────────────────────────────────────────────────────────
// DIALOG HELPERS (shared by the add/edit and delete modals)
// ──────────────────────────────────────────────────────────
let dialogState = null; // { modal, overlay, opener, keyHandler }

function openDialog(modal, overlay, initialFocusEl) {
  if (dialogState) closeDialog();
  const opener = document.activeElement;

  overlay.classList.add('open');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const keyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; }
    if (e.key !== 'Tab') return;
    // offsetParent filter: without it Tab can stick on the other,
    // currently-hidden modal's fields.
    const els = Array.from(modal.querySelectorAll('button, [href], input, select, textarea'))
      .filter(el => el.offsetParent !== null);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', keyHandler);

  dialogState = { modal, overlay, opener, keyHandler };
  if (initialFocusEl) initialFocusEl.focus();
}

function closeDialog() {
  if (!dialogState) return;
  const { modal, overlay, opener, keyHandler } = dialogState;
  document.removeEventListener('keydown', keyHandler);
  modal.classList.remove('open');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  dialogState = null;
  editingId  = null;
  deletingId = null;

  // The opener may have been destroyed by a grid re-render (save/delete call
  // filterTopics() before closing) or hidden (the empty-state button after
  // the first topic is created). Fall back to the re-rendered equivalent of
  // the same button, then to a stable control — never drop focus to <body>.
  const alive = el => el && el.isConnected && el.offsetParent !== null;
  let target = alive(opener) ? opener : null;
  if (!target && opener?.dataset?.action && opener?.dataset?.id) {
    const requeried = document.querySelector(
      `[data-action="${CSS.escape(opener.dataset.action)}"][data-id="${CSS.escape(opener.dataset.id)}"]`);
    if (alive(requeried)) target = requeried;
  }
  if (!target) target = document.getElementById('learn-add-btn');
  if (target && typeof target.focus === 'function') target.focus();
}

// ──────────────────────────────────────────────────────────
// ADD / EDIT MODAL
// ──────────────────────────────────────────────────────────
function syncColorRadios() {
  // selectedColor can come from storage unvalidated; a value with quotes or
  // backslashes would make the selector below throw and kill the modal open.
  const match = /^#[0-9a-fA-F]{6}$/.test(selectedColor)
    ? document.querySelector(`input[name="topic-color"][value="${selectedColor}"]`)
    : null;
  if (match) match.checked = true;
  // A legacy topic whose stored color isn't in the palette keeps it via the
  // selectedColor fallback in saveTopic — just show no swatch as selected.
  else document.querySelectorAll('input[name="topic-color"]').forEach(i => { i.checked = false; });
}

function openAddModal() {
  editingId = null;
  selectedColor = DEFAULT_COLOR;

  document.getElementById('modal-title').textContent    = 'New Topic';
  document.getElementById('modal-save-btn').textContent = 'Create Topic';
  document.getElementById('modal-topic-name').value  = '';
  document.getElementById('modal-topic-desc').value  = '';
  document.getElementById('modal-topic-cat').value   = 'Technical Analysis';
  syncColorRadios();
  clearTitleError();

  openDialog(
    document.getElementById('learn-modal'),
    document.getElementById('learn-overlay'),
    document.getElementById('modal-topic-name')
  );
}

function openEditModal(id) {
  const t = topics.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  selectedColor = t.color || DEFAULT_COLOR;

  document.getElementById('modal-title').textContent    = 'Edit Topic';
  document.getElementById('modal-save-btn').textContent = 'Save Changes';
  document.getElementById('modal-topic-name').value  = t.name;
  document.getElementById('modal-topic-desc').value  = t.description || '';
  document.getElementById('modal-topic-cat').value   = t.category || 'Other';
  syncColorRadios();
  clearTitleError();

  openDialog(
    document.getElementById('learn-modal'),
    document.getElementById('learn-overlay'),
    document.getElementById('modal-topic-name')
  );
}

function closeModal() {
  closeDialog();
}

// ── Title validation ──
function showTitleError() {
  const input = document.getElementById('modal-topic-name');
  const error = document.getElementById('topic-name-error');
  input.classList.add('learn-input--error');
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', 'topic-name-error');
  if (error) error.hidden = false;
  input.focus();
}

function clearTitleError() {
  const input = document.getElementById('modal-topic-name');
  const error = document.getElementById('topic-name-error');
  if (!input) return;
  input.classList.remove('learn-input--error');
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  if (error) error.hidden = true;
}

function saveTopic() {
  const name = document.getElementById('modal-topic-name').value.trim();
  const desc = document.getElementById('modal-topic-desc').value.trim();
  const cat  = document.getElementById('modal-topic-cat').value;
  selectedColor = document.querySelector('input[name="topic-color"]:checked')?.value || selectedColor;

  if (!name) {
    showTitleError();
    return;
  }

  if (editingId) {
    const idx = topics.findIndex(t => t.id === editingId);
    if (idx !== -1) {
      topics[idx].name        = name;
      topics[idx].description = desc;
      topics[idx].category    = cat;
      topics[idx].color       = selectedColor;
    }
  } else {
    topics.push({
      id:          Date.now().toString(),
      name,
      description: desc,
      category:    cat,
      color:       selectedColor,
      notes:       [],
      links:       [],
      createdAt:   new Date().toISOString()
    });
  }

  if (!saveTopics(topics)) {
    showToast("Couldn't save — storage is full or blocked");
    return; // keep the modal open so nothing typed is lost
  }
  // Re-render BEFORE closing so closeDialog can restore focus to the
  // re-rendered card's button instead of a destroyed node.
  filterTopics();
  closeModal();
}

// ──────────────────────────────────────────────────────────
// DELETE + UNDO
// ──────────────────────────────────────────────────────────
function openDelModal(id) {
  deletingId = id;
  const t = topics.find(x => x.id === id);
  document.getElementById('del-topic-name').textContent = t ? t.name : 'this topic';

  // Initial focus on CANCEL, never the destructive button —
  // a stray Enter must not destroy data.
  openDialog(
    document.getElementById('del-modal'),
    document.getElementById('del-overlay'),
    document.getElementById('del-cancel-btn')
  );
}

function closeDelModal() {
  closeDialog();
}

function confirmDelete() {
  if (!deletingId) return;
  const idx = topics.findIndex(t => t.id === deletingId);
  if (idx === -1) { closeDelModal(); return; }
  const removed = topics[idx];

  topics.splice(idx, 1);
  const saved = saveTopics(topics);
  // Re-render first — the card is gone, so closeDialog's focus restore
  // falls back to a stable control instead of a destroyed button.
  filterTopics();
  closeDelModal();

  if (!saved) {
    showToast("Couldn't save — storage is full or blocked");
    return;
  }
  // Deletion is persisted immediately; undo re-inserts and re-saves, so
  // closing the page mid-countdown keeps the confirmed delete.
  showToast(`Deleted "${removed.name}"`, () => {
    topics.splice(Math.min(idx, topics.length), 0, removed);
    saveTopics(topics);
    filterTopics();
  });
}

// ── Toast ──
let toastTimer = null;
let toastUndo  = null;
const TOAST_MS = 8000;

function showToast(msg, onUndo) {
  const toast   = document.getElementById('learn-toast');
  const msgEl   = document.getElementById('learn-toast-msg');
  const undoBtn = document.getElementById('learn-toast-undo');
  if (!toast) return;
  msgEl.textContent = msg; // never innerHTML — msg contains user topic names
  // The visual toast is display:none while hidden, which live regions don't
  // announce from — mirror the message into the always-rendered sr-only
  // status region instead.
  const status = document.getElementById('learn-toast-status');
  if (status) status.textContent = onUndo ? `${msg}. Undo available.` : msg;
  toastUndo = onUndo || null;
  undoBtn.hidden = !onUndo;
  toast.hidden = false;
  restartToastTimer();
}

function restartToastTimer(ms = TOAST_MS) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  const toast = document.getElementById('learn-toast');
  if (toast) toast.hidden = true;
  const status = document.getElementById('learn-toast-status');
  if (status) status.textContent = '';
  toastUndo = null;
  clearTimeout(toastTimer);
}

// ──────────────────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────────────────
function escH(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────────────────
// INIT (runs on learning.html — topic.html loads this file
// too, for loadTopics/saveTopics, and must skip all of this)
// ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('learn-grid');
  if (!grid) return;

  topics = loadTopics();
  visits = loadVisits();

  // Guide metadata is computed from the DOM, never hardcoded — a 15th guide
  // must not desync counts, the ring, or the Up Next rail.
  const guideCards = document.querySelectorAll('.learn-card--guide');
  KNOWN_GUIDES = [...guideCards].map(c => baseOf(c.href));
  KNOWN_GUIDE_PATHS = new Set([...guideCards].map(c => new URL(c.href, location.href).pathname));
  guideCards.forEach((card, i) => {
    const base = baseOf(card.href);
    guideNameOf[base] = card.querySelector('.learn-card-name')?.textContent || base;
    guideCats[base]   = card.dataset.cat || '';
    card.style.setProperty('--i', i); // staggered entrance order
    // Precompute search text. Without this, category search would stop
    // matching now that the per-card category label is gone.
    const desc = card.querySelector('.learn-card-desc')?.textContent || '';
    card.dataset.search = `${guideNameOf[base]} ${desc} ${card.dataset.cat || ''}`.toLowerCase();
  });
  const guideCount = document.getElementById('guide-count');
  if (guideCount) guideCount.textContent = guideCards.length;
  document.querySelectorAll('.learn-guide-group').forEach(g => {
    const c = g.querySelector('.learn-subhead-count');
    if (c) c.textContent = g.querySelectorAll('.learn-card--guide').length;
  });

  // ── Reading-progress recording ──
  // (1)+(2) Any activation of a guide-linking card records a visit before
  //     navigation (capture phase: left-click, ctrl/cmd+click, keyboard
  //     Enter, and middle-click via auxclick). Attached to both the guide
  //     grid and the Up Next rail — the rail's own START HERE/CONTINUE/NEXT
  //     UNREAD links are real navigations too and must count the same way.
  function recordVisitFrom(e, selector) {
    const card = e.target.closest(selector);
    if (card) markVisited(baseOf(card.href));
  }
  const guidesSection = document.getElementById('guides-section');
  const upNextRail    = document.getElementById('learn-upnext');
  [[guidesSection, '.learn-card--guide'], [upNextRail, '.learn-upnext-card[href]']].forEach(([root, sel]) => {
    root?.addEventListener('click',    e => recordVisitFrom(e, sel), true);
    root?.addEventListener('auxclick', e => { if (e.button === 1) recordVisitFrom(e, sel); }, true);
  });
  // (3) Referrer catch: credits Back-button returns from a guide reached any
  //     other way (bookmark, direct URL). Matched by full same-origin
  //     pathname, not just the filename — other app sections can ship a
  //     same-named file (e.g. minervini_model/minervini.html) that must
  //     never be mistaken for this guide. Throttled so a bounce within 5
  //     minutes doesn't double-count.
  try {
    const ref = new URL(document.referrer);
    if (ref.origin === location.origin && KNOWN_GUIDE_PATHS.has(ref.pathname)) {
      const refBase = ref.pathname.split('/').pop();
      const entry = visits[refBase];
      if (!entry || (Date.now() - new Date(entry.last).getTime()) > 5 * 60 * 1000) {
        markVisited(refBase); // calls refreshReadUI itself
      }
    }
  } catch { /* no referrer, or an opaque origin (e.g. file://) */ }
  // (4) bfcache restores skip DOMContentLoaded — pageshow is what makes a
  //     guide's check appear live the moment you come Back to the hub.
  //     Guarded on event.persisted: pageshow ALSO fires after every normal
  //     load, and without the guard this duplicated the init render (a
  //     visible re-flash of the Up Next entrance and hero counters). On a
  //     real bfcache restore, focus may be sitting on the very link that
  //     was just clicked to leave the page (an Up Next or topic card) —
  //     refreshReadUI rebuilds that markup via innerHTML, so we capture the
  //     focused link's href first and re-focus its rebuilt equivalent.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    visits = loadVisits(); // pick up a read recorded elsewhere while cached
    const active = document.activeElement;
    const activeHref = (active && active.tagName === 'A') ? active.getAttribute('href') : null;
    refreshReadUI();
    if (activeHref) {
      const restored = [...document.querySelectorAll('a[href]')]
        .find(a => a.getAttribute('href') === activeHref);
      if (restored) restored.focus();
    }
  });

  // ── Filter chips ──
  document.querySelectorAll('.learn-chip').forEach(chip => {
    chip.addEventListener('click', () => setActiveChip(chip.dataset.chip));
  });
  document.getElementById('guides-none-showall')?.addEventListener('click', () => {
    setActiveChip('*');
    // The panel this button sits in hides itself once guides reappear —
    // hiding the focused element would otherwise drop focus to <body>.
    document.querySelector('.learn-chip[data-chip="*"]')?.focus();
  });
  document.getElementById('guides-none-clear')?.addEventListener('click', () => {
    const search = document.getElementById('learn-search');
    if (search) search.value = '';
    filterTopics();
    search?.focus();
  });

  // ── '/' focuses search; Escape in the field clears it ──
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !dialogState && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) {
      e.preventDefault();
      const search = document.getElementById('learn-search');
      search?.focus();
      search?.select();
    }
  });
  const searchInput = document.getElementById('learn-search');
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchInput.value) {
      searchInput.value = '';
      filterTopics();
    }
  });

  // ── Cursor spotlight on guide cards (pointer + full-motion only) ──
  if (matchMedia('(hover: hover)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let spotRaf = 0;
    document.querySelector('.learn-guide-wrap')?.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.learn-card--guide');
      if (!card || spotRaf) return;
      spotRaf = requestAnimationFrame(() => {
        spotRaf = 0;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });
  }

  // ── One delegated listener for the edit/delete buttons in topic cards ──
  // The buttons are siblings of the stretched card link (layered above its
  // ::after), so a button click never reaches the anchor.
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    (btn.dataset.action === 'edit' ? openEditModal : openDelModal)(btn.dataset.id);
  });

  document.getElementById('topic-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTopic();
  });

  document.getElementById('modal-color-row')?.addEventListener('change', (e) => {
    if (e.target.name === 'topic-color') selectedColor = e.target.value;
  });

  document.getElementById('modal-topic-name')?.addEventListener('input', clearTitleError);

  document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

  document.getElementById('noresults-clear')?.addEventListener('click', () => {
    const search = document.getElementById('learn-search');
    if (search) search.value = '';
    filterTopics();
    search?.focus();
  });

  document.getElementById('learn-toast-undo')?.addEventListener('click', () => {
    if (toastUndo) toastUndo();
    hideToast();
  });

  // Don't dismiss the toast out from under someone reading it or tabbing
  // toward Undo; resume a short countdown when they leave.
  const toast = document.getElementById('learn-toast');
  if (toast) {
    toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    toast.addEventListener('focusin',   () => clearTimeout(toastTimer));
    toast.addEventListener('mouseleave', () => { if (!toast.hidden) restartToastTimer(3000); });
    toast.addEventListener('focusout',   () => { if (!toast.hidden) restartToastTimer(3000); });
  }

  const sortSelect = document.getElementById('learn-sort');
  if (sortSelect) sortSelect.value = currentSort;

  refreshReadUI(); // applies read states, ring, Up Next, and runs filterTopics
  countUpStats();
});

// Expose globals (inline handlers on learning.html, plus
// loadTopics/saveTopics for topic.js)
window.openAddModal   = openAddModal;
window.closeModal     = closeModal;
window.saveTopic      = saveTopic;
window.closeDelModal  = closeDelModal;
window.confirmDelete  = confirmDelete;
window.filterTopics   = filterTopics;
window.setSortMode    = setSortMode;
window.loadTopics     = loadTopics;
window.saveTopics     = saveTopics;
