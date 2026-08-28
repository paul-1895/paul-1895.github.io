'use strict';

// ─── Newspaper feed: fetch aggregate news + stock names, render articles ─────

(function () {
  const statusEl = document.getElementById('np-status');
  const articlesEl = document.getElementById('np-articles');
  const datelineEl = document.getElementById('np-dateline');
  const filterBarEl = document.getElementById('np-filter-bar');
  const stockSelectEl = document.getElementById('np-filter-stock');
  const sectorSelectEl = document.getElementById('np-filter-sector');
  const sourceSelectEl = document.getElementById('np-filter-source');
  const scopeSelectEl = document.getElementById('np-filter-scope');
  const searchInputEl = document.getElementById('np-filter-search');
  const dateFromEl = document.getElementById('np-filter-date-from');
  const dateToEl = document.getElementById('np-filter-date-to');
  const sortSelectEl = document.getElementById('np-sort-date');
  const filterCountEl = document.getElementById('np-filter-count');
  const todayBtnEl = document.getElementById('np-today-btn');
  const bookmarksBtnEl = document.getElementById('np-bookmarks-btn');
  const dayPrevBtnEl = document.getElementById('np-day-prev');
  const dayNextBtnEl = document.getElementById('np-day-next');
  const dayNavLabelEl = document.getElementById('np-day-nav-label');
  const clearFiltersBtnEl = document.getElementById('np-clear-filters-btn');
  const scanBarEl = document.getElementById('np-scan-bar');
  const scanBtnEl = document.getElementById('np-scan-btn');
  const scanStatusEl = document.getElementById('np-scan-status');
  const trendingStripEl = document.getElementById('np-trending-strip');

  const modalBackdropEl = document.getElementById('np-article-modal-backdrop');
  const modalCloseEl = document.getElementById('np-article-modal-close');
  const modalBookmarkBtnEl = document.getElementById('np-modal-bookmark-btn');
  const modalImageEl = document.getElementById('np-modal-image');
  const modalHeadlineEl = document.getElementById('np-modal-headline');
  const modalBylineEl = document.getElementById('np-modal-byline');
  const modalDescEl = document.getElementById('np-modal-desc');
  const modalLinkEl = document.getElementById('np-modal-link');
  const modalRelatedEl = document.getElementById('np-modal-related');
  const translateBtnEl = document.getElementById('np-translate-btn');
  const translateNoteEl = document.getElementById('np-translate-note');
  const translateRevertBtnEl = document.getElementById('np-translate-revert-btn');

  // "My newspaper" — edition bar, picking tray, composer and editions list
  const editionBarEl = document.getElementById('np-edition-bar');
  const composeToggleEl = document.getElementById('np-compose-toggle');
  const editionHintEl = document.getElementById('np-edition-hint');
  const editionsBtnEl = document.getElementById('np-editions-btn');
  const pickTrayEl = document.getElementById('np-pick-tray');
  const pickCountEl = document.getElementById('np-pick-count');
  const pickFillEl = document.getElementById('np-pick-fill');
  const pickClearEl = document.getElementById('np-pick-clear');
  const pickPublishEl = document.getElementById('np-pick-publish');
  const pickExitEl = document.getElementById('np-pick-exit');
  const composeBackdropEl = document.getElementById('np-compose-backdrop');
  const composeCloseEl = document.getElementById('np-compose-close');
  const composeTitleEl = document.getElementById('np-compose-title');
  const edNameEl = document.getElementById('np-ed-name');
  const edDateEl = document.getElementById('np-ed-date');
  const edTaglineEl = document.getElementById('np-ed-tagline');
  const edNoteEl = document.getElementById('np-ed-note');
  const edStoriesEl = document.getElementById('np-ed-stories');
  const edStoryCountEl = document.getElementById('np-ed-story-count');
  const edStatusEl = document.getElementById('np-ed-status');
  const edPublishEl = document.getElementById('np-ed-publish');
  const editionsBackdropEl = document.getElementById('np-editions-backdrop');
  const editionsCloseEl = document.getElementById('np-editions-close');
  const editionsListEl = document.getElementById('np-editions-list');

  let allItems = [];
  let allItemsById = new Map();
  // /api/news (the aggregate feed) is capped to the 100 most-recent articles
  // across every stock, so a stock whose real, correctly-dated articles are
  // older than that cutoff (e.g. a 5-year historical backfill) would silently
  // vanish when filtered to — even though /api/news/:code has no such limit
  // and genuinely has them. Fetched lazily per stock code and merged in.
  let stockNewsCache = new Map(); // code -> items[]
  let renderedItemsByUrl = new Map();
  let renderedItemsById = new Map();
  let codeToName = {};
  let codeToSector = {};
  // Bucket international stories that aren't about one identifiable company
  // (kept in sync with WORLD_CODE in routes/news-scraper/global-tickers.js).
  const WORLD_SENTINEL = 'WORLD';
  let showSavedOnly = false;
  let currentFilteredItems = [];
  let currentModalItem = null;
  let currentModalIndex = -1;
  let currentModalLang = 'en'; // 'en' | 'bn' — which text the article modal is currently showing

  // Bookmarks and "already opened" tracking persist locally per browser —
  // no backend change needed, and nothing here is ever sent to the server.
  function loadIdSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
    catch { return new Set(); }
  }
  function saveIdSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage unavailable — ignore */ }
  }
  let bookmarkIds = loadIdSet('np-bookmarks');
  let readIds = loadIdSet('np-read-ids');

  // Edition composer state. `editionStories` holds frozen snapshots rather than
  // references into the feed, so an edition reopened for editing composes the
  // same way as a fresh one even though its stories are long out of the feed.
  const DRAFT_KEY = 'np-edition-draft';
  const MAX_STORIES = 40;
  let pickMode = false;
  let editionStories = [];
  let editingEditionId = null;

  function getItemId(item) {
    return item && item.id != null ? String(item.id) : '';
  }

  if (datelineEl) {
    datelineEl.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(value) {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.display = message ? 'block' : 'none';
    statusEl.classList.toggle('np-status--error', !!isError);
  }

  function getItemCode(item) {
    const code = item.stock_code || item.stockCode || '';
    return code ? String(code).toUpperCase() : '';
  }

  function getTodayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function parseDateStr(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateInput(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function shiftNavDay(delta) {
    const isSingleDay = dateFromEl.value && dateToEl.value && dateFromEl.value === dateToEl.value;
    const base = isSingleDay ? parseDateStr(dateFromEl.value) : new Date();
    base.setDate(base.getDate() + delta);
    const newStr = formatDateInput(base);
    dateFromEl.value = newStr;
    dateToEl.value = newStr;
    applyFiltersAndRender();
  }

  function getItemTimestamp(item) {
    const raw = item.addedAt || item.added_at;
    const d = raw ? new Date(raw) : null;
    return d && !isNaN(d.getTime()) ? d.getTime() : 0;
  }

  function buildCodeNameMap(stocks) {
    const map = {};
    (stocks || []).forEach((s) => {
      if (s && s.code) map[String(s.code).toUpperCase()] = s.name || null;
    });
    return map;
  }

  function buildCodeSectorMap(sectors) {
    const map = {};
    if (sectors && typeof sectors === 'object') {
      Object.keys(sectors).forEach((code) => {
        map[code.toUpperCase()] = sectors[code];
      });
    }
    return map;
  }

  function getItemSiteName(item) {
    return (item.site_name || item.siteName || '').trim();
  }

  // 'world' = international market news; anything else (including rows saved
  // before the scope column existed) is Dhaka-listed coverage.
  function getItemScope(item) {
    return (item && item.scope) === 'world' ? 'world' : 'local';
  }

  function populateFilterOptions(items) {
    if (!stockSelectEl || !sectorSelectEl) return;

    // The Stock dropdown spans every known DSE code (from /api/stocks), not
    // just codes present in the currently-loaded (capped, most-recent) news
    // feed — otherwise a stock whose real news is older than the feed's
    // cutoff (e.g. a multi-year historical backfill) could never be selected
    // in the first place, even though /api/news/:code has it.
    const feedCodes = items.map(getItemCode).filter(Boolean);
    const codes = Array.from(new Set([...feedCodes, ...Object.keys(codeToName)])).sort();
    const sectors = Array.from(new Set(
      codes.map((c) => codeToSector[c]).filter(Boolean)
    )).sort();
    const sources = Array.from(new Set(items.map(getItemSiteName).filter(Boolean))).sort();

    stockSelectEl.innerHTML = '<option value="all">All Stocks</option>' + codes.map((c) => {
      const label = codeToName[c] ? `${c} — ${codeToName[c]}` : c;
      return `<option value="${escapeHtml(c)}">${escapeHtml(label)}</option>`;
    }).join('');

    sectorSelectEl.innerHTML = '<option value="all">All Sectors</option>' + sectors.map((s) =>
      `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
    ).join('');

    if (sourceSelectEl) {
      sourceSelectEl.innerHTML = '<option value="all">All Sources</option>' + sources.map((s) =>
        `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`
      ).join('');
    }
  }

  function buildBylineParts(item) {
    const code = getItemCode(item);
    const companyName = code ? codeToName[code] : null;
    const parts = [];

    if (getItemScope(item) === 'world') {
      parts.push('<span class="np-world-tag">World</span>');
    }
    // The WORLD sentinel is the "no identifiable company" bucket — showing it
    // as a ticker next to the World tag would just say the same thing twice.
    if (code === WORLD_SENTINEL) {
      if (item.site_name || item.siteName) parts.push(escapeHtml(item.site_name || item.siteName));
      const worldDate = formatDate(item.addedAt || item.added_at);
      if (worldDate) parts.push(escapeHtml(worldDate));
      return parts;
    }

    if (code) {
      parts.push(
        `<span class="np-stock-code">${escapeHtml(code)}</span>` +
        (companyName ? ` &middot; ${escapeHtml(companyName)}` : '')
      );
    }
    if (item.site_name || item.siteName) {
      parts.push(escapeHtml(item.site_name || item.siteName));
    }
    const dateStr = formatDate(item.addedAt || item.added_at);
    if (dateStr) parts.push(escapeHtml(dateStr));

    return parts;
  }

  function renderArticles(items, emptyMessage) {
    renderedItemsByUrl = new Map(items.filter((i) => i.url).map((i) => [i.url, i]));
    renderedItemsById = new Map(items.filter((i) => getItemId(i)).map((i) => [getItemId(i), i]));

    if (!items.length) {
      setStatus(emptyMessage, false);
      articlesEl.innerHTML = '';
      return;
    }

    setStatus('', false);

    const picked = pickedIdSet();

    function renderCard(item) {
      const bylineParts = buildBylineParts(item);
      const id = getItemId(item);
      const isSaved = id && bookmarkIds.has(id);
      const isRead = id && readIds.has(id);
      const isPicked = id && picked.has(id);

      const imageHtml = item.image
        ? `<img class="np-article-image" src="${escapeHtml(item.image)}" alt="" loading="lazy" onerror="this.remove();">`
        : '';

      const descHtml = item.description
        ? `<p class="np-article-desc">${escapeHtml(item.description)}</p>`
        : '';

      const href = item.url ? escapeHtml(item.url) : '#';
      const cardClass = `np-article${isRead ? ' np-article--read' : ''}${isPicked ? ' np-article--picked' : ''}`;
      const bookmarkBtn = id
        ? `<button type="button" class="np-bookmark-btn${isSaved ? ' active' : ''}" data-id="${escapeHtml(id)}" aria-label="${isSaved ? 'Remove bookmark' : 'Save article'}" title="${isSaved ? 'Remove bookmark' : 'Save article'}">&#9733;</button>`
        : '';
      const pickBtn = (pickMode && id)
        ? `<button type="button" class="np-pick-btn${isPicked ? ' active' : ''}" data-id="${escapeHtml(id)}" aria-label="${isPicked ? 'Remove from my newspaper' : 'Add to my newspaper'}" title="${isPicked ? 'Remove from my newspaper' : 'Add to my newspaper'}">${isPicked ? '&#10003; In my paper' : '&#43; Add to my paper'}</button>`
        : '';

      return `
        <a class="${cardClass}" href="${href}" data-url="${href}" data-id="${escapeHtml(id)}">
          ${bookmarkBtn}
          ${pickBtn}
          ${imageHtml}
          <h2 class="np-article-headline">${escapeHtml(item.title)}</h2>
          <div class="np-article-byline">${bylineParts.join('<span>&bull;</span>')}</div>
          ${descHtml}
        </a>
      `;
    }

    function renderSectionHead(label, count, isWorld) {
      return `<div class="np-section-head${isWorld ? ' np-section-head--world' : ''}">
        <span class="np-section-label">${label}</span>
        <span class="np-section-count">${count} ${count === 1 ? 'story' : 'stories'}</span>
      </div>`;
    }

    const localItems = items.filter((i) => getItemScope(i) !== 'world');
    const worldItems = items.filter((i) => getItemScope(i) === 'world');

    // A physical section break only makes sense when the current view actually
    // mixes both — if the Coverage filter already narrowed to one side, a lone
    // header would just repeat what the filter dropdown already says.
    if (localItems.length && worldItems.length) {
      articlesEl.innerHTML =
        renderSectionHead('Bangladesh Markets', localItems.length, false) +
        localItems.map(renderCard).join('') +
        renderSectionHead('International', worldItems.length, true) +
        worldItems.map(renderCard).join('');
    } else {
      articlesEl.innerHTML = items.map(renderCard).join('');
    }
  }

  function toggleBookmark(id) {
    if (!id) return;
    if (bookmarkIds.has(id)) bookmarkIds.delete(id); else bookmarkIds.add(id);
    saveIdSet('np-bookmarks', bookmarkIds);
    if (modalBookmarkBtnEl && modalBookmarkBtnEl.dataset.id === id) {
      modalBookmarkBtnEl.classList.toggle('active', bookmarkIds.has(id));
    }
    applyFiltersAndRender();
  }

  function renderTrendingStrip(items, stockFilter) {
    if (!trendingStripEl) return;

    if (stockFilter !== 'all' || !items.length) {
      trendingStripEl.style.display = 'none';
      trendingStripEl.innerHTML = '';
      return;
    }

    const counts = new Map();
    items.forEach((item) => {
      const code = getItemCode(item);
      // The WORLD bucket would out-count every real company on volume alone
      // and says nothing about what's trending, so it's left out.
      if (!code || code === WORLD_SENTINEL) return;
      counts.set(code, (counts.get(code) || 0) + 1);
    });

    const top = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6);

    if (!top.length) {
      trendingStripEl.style.display = 'none';
      trendingStripEl.innerHTML = '';
      return;
    }

    trendingStripEl.style.display = 'flex';
    trendingStripEl.innerHTML = '<span class="np-trending-label">Trending</span>' + top.map(([code, count]) =>
      `<button type="button" class="np-trending-chip" data-code="${escapeHtml(code)}">${escapeHtml(code)} <span class="np-trending-count">${count}</span></button>`
    ).join('');
  }

  function estimateReadTime(item) {
    const text = item.content || item.description || '';
    const words = (text.match(/\S+/g) || []).length;
    if (!words) return null;
    return Math.max(1, Math.round(words / 200));
  }

  function renderRelatedCoverage(item) {
    if (!modalRelatedEl) return;
    const code = getItemCode(item);
    const id = getItemId(item);

    const related = code
      ? allItems
          .filter((i) => getItemCode(i) === code && getItemId(i) !== id)
          .sort((a, b) => getItemTimestamp(b) - getItemTimestamp(a))
          .slice(0, 5)
      : [];

    if (!related.length) {
      modalRelatedEl.style.display = 'none';
      modalRelatedEl.innerHTML = '';
      return;
    }

    modalRelatedEl.style.display = 'block';
    const label = codeToName[code] ? `More on ${escapeHtml(codeToName[code])}` : `More on ${escapeHtml(code)}`;
    modalRelatedEl.innerHTML = `<div class="np-modal-related-label">${label}</div>` +
      related.map((r) =>
        `<button type="button" class="np-modal-related-item" data-id="${escapeHtml(getItemId(r))}">${escapeHtml(r.title)}</button>`
      ).join('');
  }

  // Fills in the headline + body from either the item's original English
  // fields or its cached Bengali translation (item._bnTitle/_bnBody, set
  // once by translateCurrentModal()). Shared by openArticleModal() and the
  // translate/revert toggle so both stay in sync with the same markup.
  function renderModalText(item, lang) {
    const title = lang === 'bn' && item._bnTitle != null ? item._bnTitle : (item.title || '');
    const bodyText = lang === 'bn' && item._bnBody != null ? item._bnBody : (item.content || item.description || '');
    const bodyLabel = item.content ? 'Full article' : 'Summary';

    modalHeadlineEl.textContent = title;

    modalDescEl.innerHTML = '';
    if (bodyText) {
      const note = document.createElement('div');
      note.className = 'np-modal-desc-note';
      note.textContent = bodyLabel;
      modalDescEl.appendChild(note);
      bodyText.split('\n\n').forEach((para) => {
        if (!para.trim()) return;
        const p = document.createElement('p');
        p.textContent = para;
        modalDescEl.appendChild(p);
      });
      modalDescEl.style.display = '';
    } else {
      modalDescEl.style.display = 'none';
    }
  }

  async function translateCurrentModal() {
    const item = currentModalItem;
    if (!item || !translateBtnEl) return;

    if (item._bnTitle != null || item._bnBody != null) {
      currentModalLang = 'bn';
      renderModalText(item, 'bn');
      if (translateNoteEl) translateNoteEl.style.display = 'flex';
      translateBtnEl.style.display = 'none';
      return;
    }

    translateBtnEl.disabled = true;
    translateBtnEl.textContent = 'Translating…';
    try {
      const bodyText = item.content || item.description || '';
      const [titleRes, bodyRes] = await Promise.all([
        item.title ? fetchJson(`/api/translate?text=${encodeURIComponent(item.title)}&to=bn`) : Promise.resolve({ translated: '' }),
        bodyText ? fetchJson(`/api/translate?text=${encodeURIComponent(bodyText)}&to=bn`) : Promise.resolve({ translated: '' }),
      ]);
      item._bnTitle = titleRes.translated || item.title;
      item._bnBody = bodyRes.translated || bodyText;

      if (currentModalItem !== item) return; // user moved to a different article while this was in flight

      currentModalLang = 'bn';
      renderModalText(item, 'bn');
      if (translateNoteEl) translateNoteEl.style.display = 'flex';
      translateBtnEl.style.display = 'none';
    } catch (err) {
      translateBtnEl.disabled = false;
      translateBtnEl.textContent = 'বাংলা অনুবাদ · Translate to Bengali';
      alert('Translation failed: ' + err.message);
    }
  }

  function revertModalToOriginal() {
    const item = currentModalItem;
    if (!item) return;
    currentModalLang = 'en';
    renderModalText(item, 'en');
    if (translateNoteEl) translateNoteEl.style.display = 'none';
    if (translateBtnEl) {
      translateBtnEl.style.display = '';
      translateBtnEl.disabled = false;
      translateBtnEl.textContent = 'বাংলা অনুবাদ · Show Bengali translation';
    }
  }

  function openArticleModal(item) {
    if (!modalBackdropEl) return;

    currentModalItem = item;
    currentModalIndex = currentFilteredItems.findIndex((i) => getItemId(i) === getItemId(item));
    currentModalLang = 'en';

    const id = getItemId(item);
    if (id && !readIds.has(id)) {
      readIds.add(id);
      saveIdSet('np-read-ids', readIds);
      const card = articlesEl.querySelector(`.np-article[data-id="${CSS.escape(id)}"]`);
      if (card) card.classList.add('np-article--read');
    }

    if (modalBookmarkBtnEl) {
      modalBookmarkBtnEl.dataset.id = id;
      modalBookmarkBtnEl.classList.toggle('active', id && bookmarkIds.has(id));
    }

    if (item.image) {
      modalImageEl.src = item.image;
      modalImageEl.style.display = 'block';
      modalImageEl.onerror = () => { modalImageEl.style.display = 'none'; };
    } else {
      modalImageEl.removeAttribute('src');
      modalImageEl.style.display = 'none';
    }

    const modalBylineParts = buildBylineParts(item);
    const readMinutes = estimateReadTime(item);
    if (readMinutes) modalBylineParts.push(`${readMinutes} min read`);
    modalBylineEl.innerHTML = modalBylineParts.join('<span>&bull;</span>');

    renderModalText(item, 'en');
    if (translateNoteEl) translateNoteEl.style.display = 'none';
    if (translateBtnEl) {
      translateBtnEl.style.display = (item.title || item.content || item.description) ? '' : 'none';
      translateBtnEl.disabled = false;
      translateBtnEl.textContent = 'বাংলা অনুবাদ · Translate to Bengali';
    }

    modalLinkEl.href = item.url || '#';
    renderRelatedCoverage(item);

    modalBackdropEl.classList.add('open');
  }

  function closeArticleModal() {
    if (modalBackdropEl) modalBackdropEl.classList.remove('open');
  }

  // Switches the stock filter to `code`, loading its complete article history
  // if not already cached, and clears the date range — otherwise the default
  // "today only" view would hide a stock whose real news predates today.
  async function selectStock(code) {
    if (stockSelectEl) stockSelectEl.value = code;
    if (code !== 'all') {
      if (dateFromEl) dateFromEl.value = '';
      if (dateToEl) dateToEl.value = '';
      await ensureStockNewsLoaded(code);
    }
    applyFiltersAndRender();
  }

  async function ensureStockNewsLoaded(code) {
    if (code === 'all' || stockNewsCache.has(code)) return;
    try {
      const data = await fetchJson(`/api/news/${encodeURIComponent(code)}`);
      stockNewsCache.set(code, (data && Array.isArray(data.items)) ? data.items : []);
    } catch {
      stockNewsCache.set(code, []); // avoid refetching on every filter change after a failed request
    }
  }

  // When filtered to one stock, use that stock's complete (unlimited) article
  // list merged with whatever's already in the capped aggregate feed, instead
  // of just the capped feed alone.
  function getEffectiveItems(stockFilter) {
    if (stockFilter === 'all' || !stockNewsCache.has(stockFilter)) return allItems;
    const merged = new Map(allItems.map((i) => [getItemId(i), i]));
    stockNewsCache.get(stockFilter).forEach((i) => merged.set(getItemId(i), i));
    return Array.from(merged.values());
  }

  function applyFiltersAndRender() {
    const stockFilter = stockSelectEl ? stockSelectEl.value : 'all';
    const sectorFilter = sectorSelectEl ? sectorSelectEl.value : 'all';
    const sourceFilter = sourceSelectEl ? sourceSelectEl.value : 'all';
    const scopeFilter = scopeSelectEl ? scopeSelectEl.value : 'all';
    const sortOrder = sortSelectEl ? sortSelectEl.value : 'desc';
    const searchQuery = searchInputEl ? searchInputEl.value.trim().toLowerCase() : '';

    const fromTime = (dateFromEl && dateFromEl.value)
      ? new Date(dateFromEl.value + 'T00:00:00').getTime() : -Infinity;
    const toTime = (dateToEl && dateToEl.value)
      ? new Date(dateToEl.value + 'T23:59:59.999').getTime() : Infinity;

    const sourceItems = getEffectiveItems(stockFilter);
    const filtered = sourceItems.filter((item) => {
      const code = getItemCode(item);
      if (stockFilter !== 'all' && code !== stockFilter) return false;
      if (sectorFilter !== 'all' && codeToSector[code] !== sectorFilter) return false;
      if (sourceFilter !== 'all' && getItemSiteName(item) !== sourceFilter) return false;
      if (scopeFilter !== 'all' && getItemScope(item) !== scopeFilter) return false;
      if (showSavedOnly && !bookmarkIds.has(getItemId(item))) return false;
      const ts = getItemTimestamp(item);
      if (ts < fromTime || ts > toTime) return false;
      if (searchQuery) {
        const haystack = `${item.title || ''} ${item.description || ''} ${item.content || ''}`.toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    }).sort((a, b) => {
      const diff = getItemTimestamp(a) - getItemTimestamp(b);
      return sortOrder === 'asc' ? diff : -diff;
    });

    currentFilteredItems = filtered;
    renderArticles(filtered, sourceItems.length ? 'No articles match the selected filters.' : 'No news articles yet.');
    renderTrendingStrip(filtered, stockFilter);

    if (filterCountEl) {
      filterCountEl.textContent = sourceItems.length
        ? `Showing ${filtered.length} of ${sourceItems.length} article${sourceItems.length === 1 ? '' : 's'}`
        : '';
    }

    const todayStr = getTodayStr();

    if (todayBtnEl) {
      const isTodayOnly = dateFromEl && dateToEl && dateFromEl.value === todayStr && dateToEl.value === todayStr;
      todayBtnEl.classList.toggle('active', !!isTodayOnly);
    }

    if (dayNavLabelEl) {
      const isSingleDay = dateFromEl && dateToEl && dateFromEl.value && dateFromEl.value === dateToEl.value;
      const effectiveStr = isSingleDay ? dateFromEl.value : todayStr;

      if (isSingleDay) {
        dayNavLabelEl.textContent = effectiveStr === todayStr
          ? 'Today'
          : parseDateStr(effectiveStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } else {
        dayNavLabelEl.textContent = 'All dates';
      }

      if (dayNextBtnEl) dayNextBtnEl.disabled = effectiveStr >= todayStr;
    }

    if (scanBtnEl && !scanBtnEl.disabled) {
      const hasRange = dateFromEl && dateToEl && dateFromEl.value && dateToEl.value;
      scanBtnEl.textContent = hasRange
        ? `Scan sources for ${dateFromEl.value === dateToEl.value ? dateFromEl.value : `${dateFromEl.value} to ${dateToEl.value}`}`
        : 'Scan sources for more news';
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} responded with ${res.status}`);
    return res.json();
  }

  // ─── MY NEWSPAPER ──────────────────────────────────────────────────────────
  // Pick stories out of the fetched feed, arrange them, and publish them as a
  // dated front page of your own (rendered by edition.html).

  let editionMeta = { name: '', tagline: '', editionDate: '', editorNote: '' };

  function pickedIdSet() {
    return new Set(editionStories.map((s) => s.newsId).filter(Boolean));
  }

  function storyCountLabel(n) {
    return `${n} ${n === 1 ? 'story' : 'stories'}`;
  }

  // First pick fronts the paper, the next few run as features, the rest fall
  // into the briefs column — the same shape a real front page has, so an
  // auto-filled edition already looks composed before any manual tweaking.
  function defaultSlotForIndex(index) {
    if (index === 0) return 'lead';
    return index <= 6 ? 'feature' : 'brief';
  }

  function storyFromItem(item, slot) {
    const code = getItemCode(item);
    return {
      newsId:      getItemId(item) || null,
      slot,
      scope:       getItemScope(item),
      headline:    item.title || '',
      note:        '',
      url:         item.url || null,
      description: item.description || null,
      content:     item.content || null,
      image:       item.image || null,
      siteName:    getItemSiteName(item) || null,
      stockCode:   code || null,
      stockName:   (code && codeToName[code]) || null,
      publishedAt: item.addedAt || item.added_at || null,
    };
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        editingEditionId,
        meta: editionMeta,
        stories: editionStories,
      }));
    } catch { /* storage unavailable — the draft just won't survive a reload */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  function loadDraft() {
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
    catch { draft = null; }

    if (draft && Array.isArray(draft.stories)) {
      editionStories = draft.stories.slice(0, MAX_STORIES);
      editingEditionId = draft.editingEditionId || null;
      if (draft.meta) editionMeta = { ...editionMeta, ...draft.meta };
    }

    if (!editionMeta.name) {
      // Masthead outlives any single draft — keep it as the default next time.
      try { editionMeta.name = localStorage.getItem('np-edition-masthead') || ''; }
      catch { /* ignore */ }
    }
    if (!editionMeta.editionDate) editionMeta.editionDate = getTodayStr();
  }

  function updateEditionBar() {
    if (composeToggleEl) {
      composeToggleEl.classList.toggle('active', pickMode);
      composeToggleEl.innerHTML = pickMode ? '&#9998; Picking stories…' : '&#9998; Build my newspaper';
    }
    if (editionHintEl) {
      editionHintEl.textContent = editionStories.length
        ? `${storyCountLabel(editionStories.length)} in your draft${editingEditionId ? ' · editing a published edition' : ''}`
        : 'Pick stories from the feed below, then publish your own front page.';
    }
  }

  function updatePickTray() {
    if (pickTrayEl) pickTrayEl.classList.toggle('open', pickMode);
    document.body.classList.toggle('np-picking', pickMode);
    if (pickCountEl) {
      pickCountEl.textContent = editionStories.length
        ? `${storyCountLabel(editionStories.length)} picked`
        : 'No stories picked yet';
    }
    if (pickPublishEl) pickPublishEl.disabled = !editionStories.length;
    if (pickClearEl) pickClearEl.disabled = !editionStories.length;
    updateEditionBar();
  }

  function setPickMode(on) {
    pickMode = on;
    updatePickTray();
    applyFiltersAndRender(); // cards re-render with (or without) their pick button
  }

  function togglePick(id) {
    const existing = editionStories.findIndex((s) => s.newsId === id);
    if (existing >= 0) {
      editionStories.splice(existing, 1);
    } else {
      if (editionStories.length >= MAX_STORIES) {
        alert(`An edition holds at most ${MAX_STORIES} stories.`);
        return;
      }
      const item = renderedItemsById.get(id) || allItemsById.get(id);
      if (!item) return;
      editionStories.push(storyFromItem(item, defaultSlotForIndex(editionStories.length)));
    }
    saveDraft();
    updatePickTray();
    applyFiltersAndRender();
  }

  // Bulk-add whatever the current filters are showing — the one-click path from
  // "scan the web for news" to "publish today's paper".
  function fillFromCurrentView() {
    const picked = pickedIdSet();
    let added = 0;
    for (const item of currentFilteredItems) {
      if (editionStories.length >= MAX_STORIES) break;
      const id = getItemId(item);
      if (!id || picked.has(id)) continue;
      editionStories.push(storyFromItem(item, defaultSlotForIndex(editionStories.length)));
      picked.add(id);
      added++;
    }
    saveDraft();
    updatePickTray();
    applyFiltersAndRender();
    if (!added && pickCountEl) {
      pickCountEl.textContent = currentFilteredItems.length
        ? 'Everything in this view is already picked'
        : 'Nothing in this view to add';
    }
  }

  function setEdStatus(message, variant) {
    if (!edStatusEl) return;
    edStatusEl.textContent = message || '';
    edStatusEl.classList.toggle('np-scan-status--error', variant === 'error');
    edStatusEl.classList.toggle('np-scan-status--ok', variant === 'ok');
  }

  function syncMetaFromInputs() {
    editionMeta = {
      name:       edNameEl ? edNameEl.value.trim() : '',
      tagline:    edTaglineEl ? edTaglineEl.value.trim() : '',
      editionDate: (edDateEl && edDateEl.value) || getTodayStr(),
      editorNote: edNoteEl ? edNoteEl.value.trim() : '',
    };
  }

  function applyMetaToInputs() {
    if (edNameEl) edNameEl.value = editionMeta.name || '';
    if (edTaglineEl) edTaglineEl.value = editionMeta.tagline || '';
    if (edDateEl) edDateEl.value = editionMeta.editionDate || getTodayStr();
    if (edNoteEl) edNoteEl.value = editionMeta.editorNote || '';
  }

  // Values go in through .value rather than into the HTML string: escapeHtml()
  // leaves quotes alone, and headlines routinely contain them.
  function buildStoryRow(story, index) {
    const row = document.createElement('div');
    row.className = 'np-ed-story';
    row.dataset.index = String(index);
    row.innerHTML = `
      <div class="np-ed-story-head">
        <span class="np-ed-story-num">${index + 1}</span>
        <select class="np-ed-slot" aria-label="Placement on the page">
          <option value="lead">Lead story</option>
          <option value="feature">Feature</option>
          <option value="brief">In brief</option>
        </select>
        <span class="np-ed-story-code"></span>
        <span class="np-ed-story-src"></span>
        <div class="np-ed-story-tools">
          <button type="button" class="np-ed-tool" data-act="up" title="Move up" aria-label="Move up">&#8593;</button>
          <button type="button" class="np-ed-tool" data-act="down" title="Move down" aria-label="Move down">&#8595;</button>
          <button type="button" class="np-ed-tool np-ed-tool--danger" data-act="remove" title="Remove from edition" aria-label="Remove from edition">&times;</button>
        </div>
      </div>
      <input type="text" class="np-ed-headline" maxlength="500" aria-label="Headline" placeholder="Headline" />
      <input type="text" class="np-ed-note" maxlength="1000" aria-label="Editor's note on this story" placeholder="Your note on this story (optional)" />
    `;

    row.querySelector('.np-ed-slot').value = story.slot || 'feature';
    row.querySelector('.np-ed-headline').value = story.headline || '';
    row.querySelector('.np-ed-note').value = story.note || '';

    const codeEl = row.querySelector('.np-ed-story-code');
    if (story.stockCode) codeEl.textContent = story.stockCode; else codeEl.remove();

    const srcEl = row.querySelector('.np-ed-story-src');
    if (story.siteName) srcEl.textContent = story.siteName; else srcEl.remove();

    row.querySelector('[data-act="up"]').disabled = index === 0;
    row.querySelector('[data-act="down"]').disabled = index === editionStories.length - 1;

    return row;
  }

  function renderComposerStories() {
    if (!edStoriesEl) return;
    edStoriesEl.innerHTML = '';

    if (!editionStories.length) {
      const empty = document.createElement('div');
      empty.className = 'np-ed-empty';
      empty.textContent = 'No stories yet — close this and pick some from the feed.';
      edStoriesEl.appendChild(empty);
    } else {
      editionStories.forEach((story, i) => edStoriesEl.appendChild(buildStoryRow(story, i)));
    }

    if (edStoryCountEl) {
      const leads = editionStories.filter((s) => s.slot === 'lead').length;
      const briefs = editionStories.filter((s) => s.slot === 'brief').length;
      edStoryCountEl.textContent = editionStories.length
        ? `${storyCountLabel(editionStories.length)} · ${leads} lead · ${editionStories.length - leads - briefs} feature · ${briefs} brief`
        : '';
    }
    if (edPublishEl) edPublishEl.disabled = !editionStories.length;
  }

  function openComposer() {
    if (!composeBackdropEl) return;
    if (!editionMeta.name) editionMeta.name = 'My DSE Newspaper';
    if (!editionMeta.editionDate) editionMeta.editionDate = getTodayStr();
    applyMetaToInputs();
    renderComposerStories();
    setEdStatus('');
    if (composeTitleEl) {
      composeTitleEl.textContent = editingEditionId ? 'Re-publish this edition' : 'Publish your own edition';
    }
    if (edPublishEl) {
      edPublishEl.disabled = !editionStories.length;
      edPublishEl.textContent = editingEditionId ? 'Re-publish edition' : 'Publish edition';
    }
    composeBackdropEl.classList.add('open');
  }

  function closeComposer() {
    if (!composeBackdropEl) return;
    syncMetaFromInputs();
    saveDraft();
    composeBackdropEl.classList.remove('open');
    updateEditionBar();
  }

  async function publishEdition() {
    syncMetaFromInputs();

    if (!editionStories.length) {
      setEdStatus('Pick at least one story first.', 'error');
      return;
    }

    const payload = {
      name:       editionMeta.name || 'My DSE Newspaper',
      tagline:    editionMeta.tagline || null,
      editionDate: editionMeta.editionDate || getTodayStr(),
      editorNote: editionMeta.editorNote || null,
      stories:    editionStories,
    };

    const isUpdate = !!editingEditionId;
    if (edPublishEl) edPublishEl.disabled = true;
    setEdStatus(isUpdate ? 'Re-publishing…' : 'Publishing…');

    try {
      const res = await fetch(
        isUpdate ? `/api/news/editions/${encodeURIComponent(editingEditionId)}` : '/api/news/editions',
        {
          method: isUpdate ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `responded with ${res.status}`);

      try { localStorage.setItem('np-edition-masthead', payload.name); } catch { /* ignore */ }

      setEdStatus('Published — opening your edition…', 'ok');
      editionStories = [];
      editingEditionId = null;
      clearDraft();
      window.location.href = `edition.html?id=${encodeURIComponent(data.edition.id)}`;
    } catch (err) {
      console.error('[newspaper] Publish failed:', err);
      setEdStatus('Could not publish: ' + err.message, 'error');
      if (edPublishEl) edPublishEl.disabled = false;
    }
  }

  function buildEditionRow(edition) {
    const row = document.createElement('div');
    row.className = 'np-edition-row';
    row.innerHTML = `
      <div class="np-edition-row-main">
        <a class="np-edition-row-name" target="_blank" rel="noopener"></a>
        <div class="np-edition-row-meta"></div>
        <div class="np-edition-row-lead"></div>
      </div>
      <div class="np-edition-row-tools">
        <button type="button" class="np-ed-tool" data-act="edit" title="Reopen in the composer">Edit</button>
        <button type="button" class="np-ed-tool np-ed-tool--danger" data-act="delete" title="Delete this edition">Delete</button>
      </div>
    `;
    row.dataset.id = edition.id;

    const nameEl = row.querySelector('.np-edition-row-name');
    nameEl.textContent = edition.name;
    nameEl.href = `edition.html?id=${encodeURIComponent(edition.id)}`;

    const metaBits = [edition.editionDate, storyCountLabel(Number(edition.storyCount) || 0)];
    if (edition.tagline) metaBits.push(edition.tagline);
    row.querySelector('.np-edition-row-meta').textContent = metaBits.join(' · ');

    const leadEl = row.querySelector('.np-edition-row-lead');
    if (edition.leadHeadline) leadEl.textContent = edition.leadHeadline; else leadEl.remove();

    return row;
  }

  function renderEditionsList(editions) {
    if (!editionsListEl) return;
    editionsListEl.innerHTML = '';
    if (!editions.length) {
      const empty = document.createElement('div');
      empty.className = 'np-ed-empty';
      empty.textContent = 'Nothing published yet. Build one from the feed and it will show up here.';
      editionsListEl.appendChild(empty);
      return;
    }
    editions.forEach((e) => editionsListEl.appendChild(buildEditionRow(e)));
  }

  async function openEditionsModal() {
    if (!editionsBackdropEl) return;
    editionsBackdropEl.classList.add('open');
    editionsListEl.innerHTML = '<div class="np-ed-empty">Loading your editions…</div>';
    try {
      const data = await fetchJson('/api/news/editions');
      renderEditionsList(Array.isArray(data.editions) ? data.editions : []);
    } catch (err) {
      console.error('[newspaper] Could not load editions:', err);
      editionsListEl.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'np-ed-empty np-ed-empty--error';
      errEl.textContent = 'Could not load your editions: ' + err.message;
      editionsListEl.appendChild(errEl);
    }
  }

  async function deleteEdition(id) {
    if (!confirm('Delete this edition? The articles themselves stay in the feed.')) return;
    try {
      const res = await fetch(`/api/news/editions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `responded with ${res.status}`);
      }
      if (editingEditionId === id) {
        editingEditionId = null; // it no longer exists — a re-publish would 404
        saveDraft();
        updateEditionBar();
      }
      await openEditionsModal();
    } catch (err) {
      alert('Could not delete that edition: ' + err.message);
    }
  }

  async function editEdition(id) {
    try {
      const data = await fetchJson(`/api/news/editions/${encodeURIComponent(id)}`);
      const edition = data.edition;
      editionStories = Array.isArray(edition.stories) ? edition.stories : [];
      editingEditionId = edition.id;
      editionMeta = {
        name:        edition.name || '',
        tagline:     edition.tagline || '',
        editionDate: edition.editionDate || getTodayStr(),
        editorNote:  edition.editorNote || '',
      };
      saveDraft();
      if (editionsBackdropEl) editionsBackdropEl.classList.remove('open');
      setPickMode(true);
      openComposer();
    } catch (err) {
      alert('Could not open that edition: ' + err.message);
    }
  }

  function wireEditionUi() {
    if (composeToggleEl) composeToggleEl.addEventListener('click', () => setPickMode(!pickMode));
    if (editionsBtnEl) editionsBtnEl.addEventListener('click', openEditionsModal);
    if (pickExitEl) pickExitEl.addEventListener('click', () => setPickMode(false));
    if (pickFillEl) pickFillEl.addEventListener('click', fillFromCurrentView);
    if (pickPublishEl) pickPublishEl.addEventListener('click', openComposer);
    if (composeCloseEl) composeCloseEl.addEventListener('click', closeComposer);
    if (edPublishEl) edPublishEl.addEventListener('click', publishEdition);

    if (pickClearEl) {
      pickClearEl.addEventListener('click', () => {
        if (!editionStories.length) return;
        if (!confirm('Clear every picked story from this draft?')) return;
        editionStories = [];
        editingEditionId = null;
        clearDraft();
        updatePickTray();
        applyFiltersAndRender();
      });
    }

    if (composeBackdropEl) {
      composeBackdropEl.addEventListener('click', (e) => {
        if (e.target === composeBackdropEl) closeComposer();
      });
    }

    if (editionsBackdropEl) {
      editionsBackdropEl.addEventListener('click', (e) => {
        if (e.target === editionsBackdropEl) editionsBackdropEl.classList.remove('open');
      });
    }
    if (editionsCloseEl) {
      editionsCloseEl.addEventListener('click', () => editionsBackdropEl.classList.remove('open'));
    }
    if (editionsListEl) {
      editionsListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.np-ed-tool');
        if (!btn) return;
        const id = btn.closest('.np-edition-row').dataset.id;
        if (btn.dataset.act === 'delete') deleteEdition(id);
        else if (btn.dataset.act === 'edit') editEdition(id);
      });
    }

    if (edStoriesEl) {
      // Reordering and removal re-render the list; headline/note edits must not,
      // or the input being typed into would lose focus on every keystroke.
      edStoriesEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.np-ed-tool');
        if (!btn) return;
        const index = Number(btn.closest('.np-ed-story').dataset.index);
        const act = btn.dataset.act;

        if (act === 'remove') {
          editionStories.splice(index, 1);
        } else if (act === 'up' && index > 0) {
          [editionStories[index - 1], editionStories[index]] = [editionStories[index], editionStories[index - 1]];
        } else if (act === 'down' && index < editionStories.length - 1) {
          [editionStories[index + 1], editionStories[index]] = [editionStories[index], editionStories[index + 1]];
        } else {
          return;
        }

        saveDraft();
        renderComposerStories();
        updatePickTray();
        applyFiltersAndRender();
      });

      edStoriesEl.addEventListener('change', (e) => {
        const select = e.target.closest('.np-ed-slot');
        if (!select) return;
        const index = Number(select.closest('.np-ed-story').dataset.index);
        if (!editionStories[index]) return;
        editionStories[index].slot = select.value;
        saveDraft();
        renderComposerStories();
      });

      edStoriesEl.addEventListener('input', (e) => {
        const row = e.target.closest('.np-ed-story');
        if (!row) return;
        const index = Number(row.dataset.index);
        if (!editionStories[index]) return;
        if (e.target.classList.contains('np-ed-headline')) {
          editionStories[index].headline = e.target.value;
        } else if (e.target.classList.contains('np-ed-note')) {
          editionStories[index].note = e.target.value;
        } else {
          return;
        }
        saveDraft();
      });
    }

    [edNameEl, edTaglineEl, edDateEl, edNoteEl].forEach((el) => {
      if (el) el.addEventListener('input', () => { syncMetaFromInputs(); saveDraft(); });
    });
  }

  function setScanStatus(message, variant) {
    if (!scanStatusEl) return;
    scanStatusEl.textContent = message;
    scanStatusEl.classList.toggle('np-scan-status--error', variant === 'error');
    scanStatusEl.classList.toggle('np-scan-status--ok', variant === 'ok');
  }

  function indexAllItems() {
    allItemsById = new Map(allItems.filter((i) => getItemId(i)).map((i) => [getItemId(i), i]));
  }

  async function reloadArticles() {
    const newsData = await fetchJson('/api/news');
    allItems = (newsData && Array.isArray(newsData.items)) ? newsData.items : [];
    indexAllItems();
    populateFilterOptions(allItems);
    applyFiltersAndRender();
  }

  async function runScan() {
    if (!scanBtnEl) return;
    const hasRange = dateFromEl && dateToEl && dateFromEl.value && dateToEl.value;
    const body = hasRange ? { from: dateFromEl.value, to: dateToEl.value } : {};

    scanBtnEl.disabled = true;
    setScanStatus(hasRange ? 'Scanning sources for that range — this can take a minute…' : 'Scanning sources…', null);

    try {
      const res = await fetch('/api/news/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const summary = await res.json();
      if (!res.ok) throw new Error(summary.error || `responded with ${res.status}`);

      if (summary.saved > 0) {
        const world = summary.savedWorld || 0;
        const worldNote = world ? ` (${world} international)` : '';
        setScanStatus(`Found ${summary.saved} new article${summary.saved === 1 ? '' : 's'}${worldNote}.`, 'ok');
      } else {
        setScanStatus('No new articles found.', null);
      }
      if (summary.errors && summary.errors.length) {
        console.warn('[newspaper] Scan completed with source errors:', summary.errors);
      }

      await reloadArticles();
    } catch (err) {
      console.error('[newspaper] Scan failed:', err);
      setScanStatus('Scan failed: ' + err.message, 'error');
    } finally {
      scanBtnEl.disabled = false;
      applyFiltersAndRender();
    }
  }

  async function init() {
    setStatus('Loading the latest news…', false);

    let newsData = null;

    try {
      newsData = await fetchJson('/api/news');
    } catch (err) {
      console.error('[newspaper] Failed to load news feed:', err);
      setStatus('Could not load the news feed right now. Please try again later.', true);
      return;
    }

    const [stocksData, sectorsData, globalData] = await Promise.all([
      fetchJson('/api/stocks').catch(() => null),          // name lookup is best-effort
      fetchJson('/api/sectors').catch(() => null),         // sector lookup is best-effort
      fetchJson('/api/news/global-tickers').catch(() => null) // world ticker names, best-effort
    ]);

    allItems = (newsData && Array.isArray(newsData.items)) ? newsData.items : [];
    indexAllItems();
    // DSE names are layered on top: if a global ticker ever collided with a
    // real DSE code, the Dhaka-listed company is the one that owns that code.
    codeToName = {
      ...((globalData && globalData.names) || {}),
      ...buildCodeNameMap(stocksData && stocksData.stocks),
    };
    codeToSector = buildCodeSectorMap(sectorsData);

    if (filterBarEl) filterBarEl.style.display = allItems.length ? 'flex' : 'none';
    if (scanBarEl) scanBarEl.style.display = 'flex';
    if (editionBarEl) editionBarEl.style.display = 'flex';
    populateFilterOptions(allItems);

    loadDraft();
    wireEditionUi();
    // A draft with stories means the last visit was mid-composition — come back
    // in picking mode so the tray (and the way back to the composer) is there.
    pickMode = editionStories.length > 0;
    updatePickTray();

    // Default view is today's news, not the full unfiltered feed.
    const defaultTodayStr = getTodayStr();
    if (dateFromEl) dateFromEl.value = defaultTodayStr;
    if (dateToEl) dateToEl.value = defaultTodayStr;

    [sectorSelectEl, sourceSelectEl, scopeSelectEl, dateFromEl, dateToEl, sortSelectEl].forEach((el) => {
      if (el) el.addEventListener('change', applyFiltersAndRender);
    });

    if (stockSelectEl) {
      stockSelectEl.addEventListener('change', () => selectStock(stockSelectEl.value));
    }

    if (searchInputEl) searchInputEl.addEventListener('input', applyFiltersAndRender);

    if (bookmarksBtnEl) {
      bookmarksBtnEl.addEventListener('click', () => {
        showSavedOnly = !showSavedOnly;
        bookmarksBtnEl.classList.toggle('active', showSavedOnly);
        applyFiltersAndRender();
      });
    }

    if (trendingStripEl) {
      trendingStripEl.addEventListener('click', (e) => {
        const chip = e.target.closest('.np-trending-chip');
        if (!chip || !stockSelectEl) return;
        selectStock(chip.dataset.code);
      });
    }

    if (todayBtnEl) {
      todayBtnEl.addEventListener('click', () => {
        const todayStr = getTodayStr();
        const isTodayOnly = dateFromEl.value === todayStr && dateToEl.value === todayStr;
        dateFromEl.value = isTodayOnly ? '' : todayStr;
        dateToEl.value = isTodayOnly ? '' : todayStr;
        applyFiltersAndRender();
      });
    }

    if (dayPrevBtnEl) dayPrevBtnEl.addEventListener('click', () => shiftNavDay(-1));
    if (dayNextBtnEl) dayNextBtnEl.addEventListener('click', () => shiftNavDay(1));
    if (scanBtnEl) scanBtnEl.addEventListener('click', runScan);

    if (clearFiltersBtnEl) {
      clearFiltersBtnEl.addEventListener('click', () => {
        if (stockSelectEl) stockSelectEl.value = 'all';
        if (sectorSelectEl) sectorSelectEl.value = 'all';
        if (sourceSelectEl) sourceSelectEl.value = 'all';
        if (scopeSelectEl) scopeSelectEl.value = 'all';
        if (searchInputEl) searchInputEl.value = '';
        if (dateFromEl) dateFromEl.value = '';
        if (dateToEl) dateToEl.value = '';
        if (sortSelectEl) sortSelectEl.value = 'desc';
        showSavedOnly = false;
        if (bookmarksBtnEl) bookmarksBtnEl.classList.remove('active');
        applyFiltersAndRender();
      });
    }

    applyFiltersAndRender();
  }

  // Article cards open a modal on a plain click; ctrl/cmd/shift-click and
  // middle-click still fall through to the browser's native open-in-new-tab.
  // The bookmark star is a nested button inside that same link, so it must
  // stop propagation or every star click would also open the modal.
  articlesEl.addEventListener('click', (e) => {
    const bookmarkBtn = e.target.closest('.np-bookmark-btn');
    if (bookmarkBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleBookmark(bookmarkBtn.dataset.id);
      return;
    }

    const pickBtn = e.target.closest('.np-pick-btn');
    if (pickBtn) {
      e.preventDefault();
      e.stopPropagation();
      togglePick(pickBtn.dataset.id);
      return;
    }

    const card = e.target.closest('.np-article');
    if (!card) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;

    const item = renderedItemsById.get(card.dataset.id) || renderedItemsByUrl.get(card.dataset.url);
    if (!item) return;

    e.preventDefault();
    openArticleModal(item);
  });

  if (modalCloseEl) modalCloseEl.addEventListener('click', closeArticleModal);
  if (translateBtnEl) translateBtnEl.addEventListener('click', translateCurrentModal);
  if (translateRevertBtnEl) translateRevertBtnEl.addEventListener('click', revertModalToOriginal);
  if (modalBookmarkBtnEl) {
    modalBookmarkBtnEl.addEventListener('click', () => {
      if (modalBookmarkBtnEl.dataset.id) toggleBookmark(modalBookmarkBtnEl.dataset.id);
    });
  }
  if (modalRelatedEl) {
    modalRelatedEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.np-modal-related-item');
      if (!btn) return;
      const relatedItem = allItemsById.get(btn.dataset.id);
      if (relatedItem) openArticleModal(relatedItem);
    });
  }
  if (modalBackdropEl) {
    modalBackdropEl.addEventListener('click', (e) => {
      if (e.target === modalBackdropEl) closeArticleModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && composeBackdropEl && composeBackdropEl.classList.contains('open')) {
      closeComposer();
      return;
    }
    if (e.key === 'Escape' && editionsBackdropEl && editionsBackdropEl.classList.contains('open')) {
      editionsBackdropEl.classList.remove('open');
      return;
    }

    if (!modalBackdropEl || !modalBackdropEl.classList.contains('open')) return;

    if (e.key === 'Escape') {
      closeArticleModal();
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (currentModalIndex < 0 || !currentFilteredItems.length) return;
      const nextIndex = currentModalIndex + (e.key === 'ArrowRight' ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= currentFilteredItems.length) return;
      e.preventDefault();
      openArticleModal(currentFilteredItems[nextIndex]);
    }
  });

  init();
})();
