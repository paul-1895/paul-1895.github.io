/**
 * youtube-videos/grid.js
 * ─────────────────────────────────────────────────────────────
 * Renders the 3-per-row video card grid into #videoGrid.
 *
 * window.YTGrid.refresh() re-fetches GET /api/youtube-videos, applies
 * window.YTFilters.getActive() (category / ticker / sector) client-side,
 * and re-renders the cards. Runs once on its own on DOMContentLoaded for
 * the initial render, and is called again by filters.js / crud-form.js
 * whenever the list needs to change.
 *
 * Plain vanilla JS, no imports/exports — attaches window.YTGrid.
 */
'use strict';

(function () {

  const CATEGORY_LABELS = {
    analysis: 'Analysis',
    news: 'News',
    promotion: 'Promotion',
    other: 'Other',
  };

  // Same escaping convention used elsewhere in this codebase
  // (e.g. trades/trade-analysis.js) — round-trip through textContent.
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function matchesFilter(video, active) {
    const a = active || {};

    if (a.category && video.category !== a.category) return false;

    if (a.ticker) {
      const tickers = Array.isArray(video.tickers) ? video.tickers : [];
      const wanted = String(a.ticker).toUpperCase();
      if (!tickers.some((t) => String(t).toUpperCase() === wanted)) return false;
    }

    if (a.sector) {
      const sectors = Array.isArray(video.sectors) ? video.sectors : [];
      const wanted = String(a.sector).toLowerCase();
      if (!sectors.some((s) => String(s).toLowerCase() === wanted)) return false;
    }

    return true;
  }

  function tagChipsHtml(video) {
    const tickers = Array.isArray(video.tickers) ? video.tickers : [];
    const sectors = Array.isArray(video.sectors) ? video.sectors : [];
    const chips = tickers
      .map((t) => `<span class="yt-video-card__tag yt-video-card__tag--ticker">${escapeHtml(t)}</span>`)
      .concat(sectors.map((s) => `<span class="yt-video-card__tag yt-video-card__tag--sector">${escapeHtml(s)}</span>`));
    return chips.join('');
  }

  function cardHtml(video) {
    const cat      = CATEGORY_LABELS[video.category] ? video.category : 'other';
    const catLabel = CATEGORY_LABELS[cat];
    const thumbUrl = `https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`;

    return `
      <div class="yt-video-card" data-id="${escapeHtml(video.id)}">
        <div class="yt-video-card__thumb">
          <img src="${thumbUrl}" alt="${escapeHtml(video.title)}" loading="lazy" />
          <span class="yt-category-badge yt-category-badge--${cat}">${catLabel}</span>
        </div>
        <div class="yt-video-card__title">${escapeHtml(video.title)}</div>
        <div class="yt-video-card__meta">${tagChipsHtml(video)}</div>
        <div class="yt-video-card__actions">
          <button type="button" class="yt-video-card__edit-btn" data-action="edit">Edit</button>
          <button type="button" class="yt-video-card__delete-btn" data-action="delete">Delete</button>
        </div>
      </div>
    `;
  }

  function emptyStateHtml(hasAnyVideos) {
    const msg = hasAnyVideos
      ? 'No videos match the current filters.'
      : 'No videos yet — click “+ Add Video” to add the first one.';
    return `<div class="yt-video-grid-empty" style="grid-column:1/-1;text-align:center;padding:48px 16px;color:var(--text-secondary,#8a96a3);">${escapeHtml(msg)}</div>`;
  }

  // Last fetched, unfiltered list — kept so click handlers (edit/delete/play)
  // can look a video back up by id without a second round trip.
  let allVideos = [];

  function render(filtered) {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    if (!filtered.length) {
      grid.innerHTML = emptyStateHtml(allVideos.length > 0);
      return;
    }

    grid.innerHTML = filtered.map(cardHtml).join('');
  }

  function handleGridClick(e) {
    const card = e.target.closest('.yt-video-card');
    if (!card) return;

    const video = allVideos.find((v) => v.id === card.getAttribute('data-id'));
    if (!video) return;

    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.getAttribute('data-action');

      if (action === 'edit') {
        if (window.YTForm && typeof window.YTForm.openEdit === 'function') {
          window.YTForm.openEdit(video);
        }
        return;
      }

      if (action === 'delete') {
        if (!confirm(`Delete "${video.title}"?`)) return;
        fetch(`/api/youtube-videos/${encodeURIComponent(video.id)}`, { method: 'DELETE' })
          .then((res) => {
            if (!res.ok) throw new Error(`Delete failed (${res.status})`);
            return refresh();
          })
          .catch((err) => {
            console.error('Failed to delete video', err);
            alert('Failed to delete video.');
          });
        return;
      }

      return;
    }

    // Card body click (not an action button) — open the player.
    // Referenced here (call time), not captured at parse time, so
    // script load order doesn't matter — by the time a click can
    // happen, player.js has finished loading.
    if (window.YTPlayer && typeof window.YTPlayer.open === 'function') {
      window.YTPlayer.open(video.videoId);
    }
  }

  function showError() {
    const grid = document.getElementById('videoGrid');
    if (grid) {
      grid.innerHTML = '<div class="yt-video-grid-empty" style="grid-column:1/-1;text-align:center;padding:48px 16px;color:var(--text-secondary,#8a96a3);">Failed to load videos.</div>';
    }
  }

  function refresh() {
    return fetch('/api/youtube-videos')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch videos (${res.status})`);
        return res.json();
      })
      .then((data) => {
        allVideos = Array.isArray(data.videos) ? data.videos : [];
        const active = window.YTFilters ? window.YTFilters.getActive() : {};
        const filtered = allVideos.filter((v) => matchesFilter(v, active));
        render(filtered);
      })
      .catch((err) => {
        console.error('Failed to load YouTube videos', err);
        showError();
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('videoGrid');
    if (grid) grid.addEventListener('click', handleGridClick);
    refresh();
  });

  window.YTGrid = { refresh };

})();
