/* ═══════════════════════════════════════════════════════════
   filters.js — category / ticker / sector filter bar for the
   "YouTube Videos" page.

   Renders three plain <select> dropdowns into #filterBar on
   DOMContentLoaded:
     - Category: static options (All / Analysis / News / Promotion / Other)
     - Ticker:   distinct values actually present across every stored
                 video's `tickers` tag list
     - Sector:   distinct values actually present across every stored
                 video's `sectors` tag list

   The ticker/sector option lists come from this file's own GET of
   /api/youtube-videos (NOT /api/sectors — only tags actually in use on
   a video should be offered here, not the whole DSE ticker universe).

   Exposes window.YTFilters.getActive() -> { category, ticker, sector },
   each null when its dropdown is left on "All".

   Every dropdown change calls window.YTGrid.refresh() when it exists —
   guarded, since script tag order across the page's files is only
   guaranteed by the time DOMContentLoaded handlers actually run, not
   at parse time.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CATEGORY_OPTIONS = [
    { value: '', label: 'All categories' },
    { value: 'analysis', label: 'Analysis' },
    { value: 'news', label: 'News' },
    { value: 'promotion', label: 'Promotion' },
    { value: 'other', label: 'Other' },
  ];

  let categorySelect = null;
  let tickerSelect = null;
  let sectorSelect = null;

  // ── helpers ─────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function optionsHTML(opts) {
    return opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  }

  function buildField(id, labelText) {
    const wrap = document.createElement('div');
    wrap.className = 'yt-form-field';
    wrap.innerHTML = `
      <label for="${esc(id)}">${esc(labelText)}</label>
      <select id="${esc(id)}"></select>`;
    return wrap;
  }

  function notifyGrid() {
    if (window.YTGrid && typeof window.YTGrid.refresh === 'function') {
      window.YTGrid.refresh();
    }
  }

  // Distinct, sorted ticker/sector values actually used across all videos.
  function collectDistinctTags(videos) {
    const tickers = new Set();
    const sectors = new Set();
    (Array.isArray(videos) ? videos : []).forEach((v) => {
      (Array.isArray(v && v.tickers) ? v.tickers : []).forEach((t) => {
        if (t) tickers.add(t);
      });
      (Array.isArray(v && v.sectors) ? v.sectors : []).forEach((s) => {
        if (s) sectors.add(s);
      });
    });
    return {
      tickers: Array.from(tickers).sort((a, b) => a.localeCompare(b)),
      sectors: Array.from(sectors).sort((a, b) => a.localeCompare(b)),
    };
  }

  function populateSelect(select, values) {
    if (!select) return;
    const prev = select.value;
    select.innerHTML = optionsHTML(
      [{ value: '', label: 'All' }].concat(values.map((v) => ({ value: v, label: v })))
    );
    // Keep whatever the user had picked, if that value still exists.
    if (values.includes(prev)) select.value = prev;
  }

  function loadTagOptions() {
    fetch('/api/youtube-videos')
      .then((r) => (r.ok ? r.json() : { videos: [] }))
      .then((data) => {
        const { tickers, sectors } = collectDistinctTags(data && data.videos);
        populateSelect(tickerSelect, tickers);
        populateSelect(sectorSelect, sectors);
      })
      .catch(() => {
        // Leave ticker/sector dropdowns at "All" only — nothing to offer.
      });
  }

  // ── render ──────────────────────────────────────────────
  function render() {
    const bar = document.getElementById('filterBar');
    if (!bar) return;
    bar.classList.add('yt-filter-bar');

    const categoryField = buildField('ytFilterCategory', 'Category');
    const tickerField = buildField('ytFilterTicker', 'Ticker');
    const sectorField = buildField('ytFilterSector', 'Sector');

    bar.appendChild(categoryField);
    bar.appendChild(tickerField);
    bar.appendChild(sectorField);

    categorySelect = categoryField.querySelector('select');
    tickerSelect = tickerField.querySelector('select');
    sectorSelect = sectorField.querySelector('select');

    categorySelect.innerHTML = optionsHTML(CATEGORY_OPTIONS);
    tickerSelect.innerHTML = optionsHTML([{ value: '', label: 'All' }]);
    sectorSelect.innerHTML = optionsHTML([{ value: '', label: 'All' }]);

    [categorySelect, tickerSelect, sectorSelect].forEach((sel) => {
      sel.addEventListener('change', notifyGrid);
    });

    loadTagOptions();
  }

  document.addEventListener('DOMContentLoaded', render);

  // ── public API ──────────────────────────────────────────
  window.YTFilters = {
    getActive() {
      return {
        category: categorySelect && categorySelect.value ? categorySelect.value : null,
        ticker: tickerSelect && tickerSelect.value ? tickerSelect.value : null,
        sector: sectorSelect && sectorSelect.value ? sectorSelect.value : null,
      };
    },
  };
})();
