/**
 * DSE Task Board — tasks.js
 * Data is persisted as JSON in localStorage under the key "dse_tasks_data".
 *
 * Schema:
 * {
 *   groups: [{ id, name, color, createdAt }],
 *   tasks:  [{ id, groupId, title, desc, priority, color, due, done, createdAt, updatedAt }]
 * }
 */

'use strict';

/* ── STORAGE ──────────────────────────────────────────────────── */
const STORAGE_KEY = 'dse_tasks_data';

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { groups: [], tasks: [] };
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Export JSON download helper
function exportJSON() {
  const data = loadData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dse-tasks-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── STATE ────────────────────────────────────────────────────── */
let db            = loadData();
let activeFilter  = 'all';
let searchQuery   = '';
let editingTaskId = null;
let editingGroupId= null;
let selectedTaskColor  = 'default';
let selectedGroupColor = 'cyan';
let pendingDeleteFn    = null;

/* ── GROUP COLORS ─────────────────────────────────────────────── */
const GROUP_COLORS = {
  cyan:   '#00bcd4',
  green:  '#22c47e',
  amber:  '#f59e0b',
  rose:   '#e05c5c',
  purple: '#9c6fde',
  slate:  '#7b8fa1',
};

/* ── UTILS ────────────────────────────────────────────────────── */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso + 'T00:00:00') < new Date(new Date().toDateString());
}

/* ── RENDER ───────────────────────────────────────────────────── */
function render() {
  db = loadData();
  renderStats();
  renderBoard();
}

function renderStats() {
  const tasks = db.tasks;
  document.getElementById('stat-total').textContent = tasks.length;
  document.getElementById('stat-open').textContent  = tasks.filter(t => !t.done).length;
  document.getElementById('stat-done').textContent  = tasks.filter(t =>  t.done).length;
  document.getElementById('stat-high').textContent  = tasks.filter(t => t.priority === 'high' && !t.done).length;
}

function filterTasks(tasks) {
  return tasks.filter(t => {
    // filter pill
    if (activeFilter === 'open' && t.done) return false;
    if (activeFilter === 'done' && !t.done) return false;
    if (activeFilter === 'high' && (t.priority !== 'high' || t.done)) return false;
    // search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const hit = t.title.toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });
}

function renderBoard() {
  const board  = document.getElementById('board');
  const empty  = document.getElementById('board-empty');

  // Remove existing group sections
  board.querySelectorAll('.group-section').forEach(el => el.remove());

  if (db.groups.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  db.groups.forEach(group => {
    const groupTasks    = db.tasks.filter(t => t.groupId === group.id);
    const visibleTasks  = filterTasks(groupTasks);
    const section       = buildGroupSection(group, groupTasks.length, visibleTasks);
    board.appendChild(section);
  });
}

function buildGroupSection(group, totalCount, visibleTasks) {
  const section = document.createElement('div');
  section.className = 'group-section';
  section.dataset.groupId = group.id;

  const dotColor = GROUP_COLORS[group.color] || GROUP_COLORS.cyan;

  section.innerHTML = `
    <div class="group-hd">
      <div class="group-dot" style="background:${dotColor};box-shadow:0 0 8px ${dotColor}66;"></div>
      <span class="group-name">${escHtml(group.name)}</span>
      <span class="group-count">${totalCount}</span>
      <div class="group-actions">
        <button class="grp-btn grp-btn-add" title="Add task" onclick="openAddTask('${group.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button class="grp-btn" title="Edit group" onclick="openEditGroup('${group.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="grp-btn grp-btn-del" title="Delete group" onclick="confirmDeleteGroup('${group.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
        <button class="grp-btn grp-collapse-btn" title="Collapse" onclick="toggleGroupCollapse(this)">
          <svg class="grp-collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
    </div>
    <div class="notes-grid" id="grid-${group.id}"></div>
  `;

  const grid = section.querySelector(`#grid-${group.id}`);

  if (visibleTasks.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'notes-empty';
    emptyMsg.textContent = totalCount === 0
      ? 'No tasks yet. Click + to add one.'
      : 'No tasks match the current filter.';
    grid.appendChild(emptyMsg);
  } else {
    visibleTasks
      .sort((a, b) => {
        // high priority first, then by created desc
        const pa = a.priority === 'high' ? 0 : a.priority === 'normal' ? 1 : 2;
        const pb = b.priority === 'high' ? 0 : b.priority === 'normal' ? 1 : 2;
        if (pa !== pb) return pa - pb;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .forEach(task => grid.appendChild(buildNoteCard(task)));
  }

  return section;
}

function buildNoteCard(task) {
  const card = document.createElement('div');
  card.className = 'note-card' + (task.done ? ' done' : '');
  card.dataset.taskId = task.id;
  if (task.color && task.color !== 'default') card.dataset.color = task.color;

  const overdue = isOverdue(task.due) && !task.done;

  card.innerHTML = `
    <div class="note-pin"></div>
    <div class="note-hd">
      <button class="note-check${task.done ? ' checked' : ''}" title="${task.done ? 'Mark open' : 'Mark done'}" onclick="toggleDone('${task.id}')"></button>
      <span class="note-title">${escHtml(task.title)}</span>
      <div class="note-actions">
        <button class="note-act-btn" title="Edit" onclick="openEditTask('${task.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="note-act-btn del" title="Delete" onclick="confirmDeleteTask('${task.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>
    ${task.desc ? `<div class="note-desc">${escHtml(task.desc)}</div>` : ''}
    <div class="note-meta">
      <span class="note-priority ${task.priority}">${task.priority}</span>
      ${task.due ? `<span class="note-due${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue!' : ''}">📅 ${formatDate(task.due)}</span>` : ''}
    </div>
  `;
  return card;
}

function escHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── GROUP MODAL ──────────────────────────────────────────────── */
function openAddGroup() {
  editingGroupId = null;
  selectedGroupColor = 'cyan';
  document.getElementById('group-modal-title').textContent = 'New Group';
  document.getElementById('group-name-inp').value = '';
  setGroupColorActive('cyan');
  showModal('group-modal-backdrop');
  setTimeout(() => document.getElementById('group-name-inp').focus(), 80);
}

function openEditGroup(id) {
  const group = db.groups.find(g => g.id === id);
  if (!group) return;
  editingGroupId = id;
  selectedGroupColor = group.color || 'cyan';
  document.getElementById('group-modal-title').textContent = 'Edit Group';
  document.getElementById('group-name-inp').value = group.name;
  setGroupColorActive(selectedGroupColor);
  showModal('group-modal-backdrop');
  setTimeout(() => document.getElementById('group-name-inp').focus(), 80);
}

function saveGroup() {
  const name = document.getElementById('group-name-inp').value.trim();
  if (!name) { document.getElementById('group-name-inp').focus(); return; }

  if (editingGroupId) {
    const idx = db.groups.findIndex(g => g.id === editingGroupId);
    if (idx !== -1) { db.groups[idx].name = name; db.groups[idx].color = selectedGroupColor; }
  } else {
    db.groups.push({ id: uid(), name, color: selectedGroupColor, createdAt: new Date().toISOString() });
  }
  saveData(db);
  hideModal('group-modal-backdrop');
  render();
}

function setGroupColorActive(color) {
  selectedGroupColor = color;
  document.querySelectorAll('#group-color-row .clr-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
}

/* ── TASK MODAL ───────────────────────────────────────────────── */
function openAddTask(groupId) {
  editingTaskId = null;
  selectedTaskColor = 'default';
  document.getElementById('task-modal-title').textContent = 'New Task';
  document.getElementById('task-title-inp').value = '';
  document.getElementById('task-desc-inp').value  = '';
  document.getElementById('task-priority-sel').value = 'normal';
  document.getElementById('task-due-inp').value   = '';
  populateGroupSelect(groupId);
  setTaskColorActive('default');
  showModal('task-modal-backdrop');
  setTimeout(() => document.getElementById('task-title-inp').focus(), 80);
}

function openEditTask(id) {
  const task = db.tasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  selectedTaskColor = task.color || 'default';
  document.getElementById('task-modal-title').textContent = 'Edit Task';
  document.getElementById('task-title-inp').value         = task.title;
  document.getElementById('task-desc-inp').value          = task.desc || '';
  document.getElementById('task-priority-sel').value      = task.priority || 'normal';
  document.getElementById('task-due-inp').value           = task.due || '';
  populateGroupSelect(task.groupId);
  setTaskColorActive(selectedTaskColor);
  showModal('task-modal-backdrop');
  setTimeout(() => document.getElementById('task-title-inp').focus(), 80);
}

function populateGroupSelect(selectedGroupId) {
  const sel = document.getElementById('task-group-sel');
  sel.innerHTML = db.groups.map(g =>
    `<option value="${g.id}" ${g.id === selectedGroupId ? 'selected' : ''}>${escHtml(g.name)}</option>`
  ).join('');
}

function saveTask() {
  const title = document.getElementById('task-title-inp').value.trim();
  if (!title) { document.getElementById('task-title-inp').focus(); return; }

  const groupId  = document.getElementById('task-group-sel').value;
  const desc     = document.getElementById('task-desc-inp').value.trim();
  const priority = document.getElementById('task-priority-sel').value;
  const due      = document.getElementById('task-due-inp').value;

  if (editingTaskId) {
    const idx = db.tasks.findIndex(t => t.id === editingTaskId);
    if (idx !== -1) {
      Object.assign(db.tasks[idx], { title, desc, priority, due, color: selectedTaskColor, groupId, updatedAt: new Date().toISOString() });
    }
  } else {
    db.tasks.push({
      id: uid(), groupId, title, desc, priority,
      color: selectedTaskColor, due,
      done: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  saveData(db);
  hideModal('task-modal-backdrop');
  render();
}

function setTaskColorActive(color) {
  selectedTaskColor = color;
  document.querySelectorAll('#task-color-row .clr-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
}

/* ── CRUD ACTIONS ─────────────────────────────────────────────── */
function toggleDone(id) {
  const task = db.tasks.find(t => t.id === id);
  if (!task) return;
  task.done = !task.done;
  task.updatedAt = new Date().toISOString();
  saveData(db);
  render();
}

function deleteTask(id) {
  db.tasks = db.tasks.filter(t => t.id !== id);
  saveData(db);
  render();
}

function deleteGroup(id) {
  db.groups = db.groups.filter(g => g.id !== id);
  db.tasks  = db.tasks.filter(t => t.groupId !== id);
  saveData(db);
  render();
}

/* ── CONFIRM MODAL ────────────────────────────────────────────── */
function confirmDeleteTask(id) {
  const task = db.tasks.find(t => t.id === id);
  if (!task) return;
  document.getElementById('confirm-msg').textContent = `Delete "${task.title}"? This cannot be undone.`;
  pendingDeleteFn = () => deleteTask(id);
  showModal('confirm-modal-backdrop');
}

function confirmDeleteGroup(id) {
  const group = db.groups.find(g => g.id === id);
  if (!group) return;
  const count = db.tasks.filter(t => t.groupId === id).length;
  document.getElementById('confirm-msg').textContent =
    `Delete group "${group.name}" and its ${count} task${count !== 1 ? 's' : ''}? This cannot be undone.`;
  pendingDeleteFn = () => deleteGroup(id);
  showModal('confirm-modal-backdrop');
}

/* ── COLLAPSE ─────────────────────────────────────────────────── */
function toggleGroupCollapse(btn) {
  const section = btn.closest('.group-section');
  section.classList.toggle('collapsed');
  const grid = section.querySelector('.notes-grid');
  grid.classList.toggle('collapsed-grid', section.classList.contains('collapsed'));
}

/* ── MODAL HELPERS ────────────────────────────────────────────── */
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

/* ── FILTER & SEARCH ──────────────────────────────────────────── */
function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.fpill').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
  render();
}

/* ── THEME ────────────────────────────────────────────────────── */
/* Handled by the shared theme module, wired up in tasks.html. */

/* ── BOOT ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  render();

  // Header buttons
  document.getElementById('add-group-btn').addEventListener('click', openAddGroup);
  document.getElementById('add-task-btn').addEventListener('click', () => {
    if (db.groups.length === 0) { openAddGroup(); return; }
    openAddTask(db.groups[0].id);
  });

  // Task modal
  document.getElementById('task-modal-save').addEventListener('click', saveTask);
  document.getElementById('task-modal-cancel').addEventListener('click', () => hideModal('task-modal-backdrop'));
  document.getElementById('task-modal-close').addEventListener('click',  () => hideModal('task-modal-backdrop'));
  document.getElementById('task-modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('task-modal-backdrop')) hideModal('task-modal-backdrop');
  });

  // Group modal
  document.getElementById('group-modal-save').addEventListener('click', saveGroup);
  document.getElementById('group-modal-cancel').addEventListener('click', () => hideModal('group-modal-backdrop'));
  document.getElementById('group-modal-close').addEventListener('click',  () => hideModal('group-modal-backdrop'));
  document.getElementById('group-modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('group-modal-backdrop')) hideModal('group-modal-backdrop');
  });

  // Confirm modal
  document.getElementById('confirm-ok').addEventListener('click', () => {
    if (pendingDeleteFn) { pendingDeleteFn(); pendingDeleteFn = null; }
    hideModal('confirm-modal-backdrop');
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => { pendingDeleteFn = null; hideModal('confirm-modal-backdrop'); });
  document.getElementById('confirm-modal-close').addEventListener('click', () => { pendingDeleteFn = null; hideModal('confirm-modal-backdrop'); });
  document.getElementById('confirm-modal-backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('confirm-modal-backdrop')) { pendingDeleteFn = null; hideModal('confirm-modal-backdrop'); }
  });

  // Color swatches – task
  document.querySelectorAll('#task-color-row .clr-swatch').forEach(s => {
    s.addEventListener('click', () => setTaskColorActive(s.dataset.color));
  });

  // Color swatches – group
  document.querySelectorAll('#group-color-row .clr-swatch').forEach(s => {
    s.addEventListener('click', () => setGroupColorActive(s.dataset.color));
  });

  // Filter pills
  document.querySelectorAll('.fpill').forEach(b => {
    b.addEventListener('click', () => setFilter(b.dataset.filter));
  });

  // Search
  document.getElementById('task-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    render();
  });

  // Enter key in modals
  document.getElementById('group-name-inp').addEventListener('keydown', e => { if (e.key === 'Enter') saveGroup(); });
  document.getElementById('task-title-inp').addEventListener('keydown', e => { if (e.key === 'Enter') saveTask(); });

  // Keyboard: Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['task-modal-backdrop','group-modal-backdrop','confirm-modal-backdrop'].forEach(id => hideModal(id));
    }
  });
});

/* Expose functions called from inline HTML handlers */
window.openAddTask        = openAddTask;
window.openEditTask       = openEditTask;
window.openEditGroup      = openEditGroup;
window.confirmDeleteTask  = confirmDeleteTask;
window.confirmDeleteGroup = confirmDeleteGroup;
window.toggleDone         = toggleDone;
window.toggleGroupCollapse= toggleGroupCollapse;
window.exportJSON         = exportJSON;