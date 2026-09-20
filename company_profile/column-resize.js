/* ================================================================
   column-resize.js — Drag-to-resize the 3/4-column terminal layout
   on the company profile page. Only the left/right/search columns
   are resizable; the middle chart column is minmax(0, 1fr) and
   absorbs whatever space the others don't use.
   ================================================================ */
'use strict';

(function () {
  const LIMITS = {
    left:   { min: 220, max: 420 },
    right:  { min: 260, max: 460 },
    search: { min: 220, max: 420 },
  };
  const STORAGE_KEY = 'dse-company-col-widths';

  function loadSavedWidths() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  function applySavedWidths(columns) {
    const saved = loadSavedWidths();
    Object.keys(LIMITS).forEach(target => {
      if (saved[target]) columns.style.setProperty(`--col-${target}`, saved[target] + 'px');
    });
  }

  function saveWidth(target, px) {
    const saved = loadSavedWidths();
    saved[target] = px;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const columns = document.querySelector('.profile-columns');
    if (!columns) return;

    applySavedWidths(columns);

    let dragging = null; // { target, startX, startWidth }

    columns.querySelectorAll('.col-resize-handle').forEach(handle => {
      handle.addEventListener('mousedown', (e) => {
        const target = handle.dataset.target;
        const current = parseFloat(getComputedStyle(columns).getPropertyValue(`--col-${target}`)) || 300;
        dragging = { target, startX: e.clientX, startWidth: current };
        handle.classList.add('resizing');
        document.body.classList.add('col-resizing');
        e.preventDefault();
      });
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const deltaX = e.clientX - dragging.startX;
      // "left" grows when dragged right; "right"/"search" sit to the right
      // of the flexible middle column, so they grow when dragged left.
      const signedDelta = dragging.target === 'left' ? deltaX : -deltaX;
      const limits = LIMITS[dragging.target];
      const newWidth = Math.min(limits.max, Math.max(limits.min, dragging.startWidth + signedDelta));
      columns.style.setProperty(`--col-${dragging.target}`, newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      const width = parseFloat(getComputedStyle(columns).getPropertyValue(`--col-${dragging.target}`));
      saveWidth(dragging.target, Math.round(width));
      columns.querySelectorAll('.col-resize-handle.resizing').forEach(h => h.classList.remove('resizing'));
      document.body.classList.remove('col-resizing');
      dragging = null;
    });
  });
})();
