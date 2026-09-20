/* ═══════════════════════════════════════════════════════════
   RANDOM STRATEGIES — Bank Dividend Ranking (MCDA)

   Same min-max MCDA mechanics as the generic scorer, but scoped to
   the 31 DSE banks with real, computed inputs instead of hand-typed
   sample data:
     - Dividend Yield / Dividend Growth (5Y): data/dividends.json
       (cash dividend %) against the latest close in historical_prices.
     - ROE (5Y avg): bank_financials/_cross_bank.json, excluding
       periods flagged roe_undefined_negative_equity (a near-zero or
       negative equity denominator makes that %  an artifact, not a
       return figure).
     - Asset Growth (5Y): total_assets CAGR from the same file.
     - Asset Quality Score (5Y avg): bank_financials/_quality_scores.json
       dimension_scores.asset_quality — an existing percentile-based
       score (NPL ratio + provision coverage), used here as a real
       stand-in for "earnings quality" since no bank in this dataset
       reports a core-vs-one-off earnings split.
   All five are "higher is better," so unlike the generic scorer there's
   no direction ambiguity to resolve with a mode selector.

   5 Shariah banks merged into Sammilito Islami Bank by Bangladesh Bank
   are excluded from the source data entirely (see build script) rather
   than shown with a dividend yield computed against a suspended,
   zero-volume quote.
═══════════════════════════════════════════════════════════ */

(function () {
  const ROWS_KEY = 'dse-mcda-banks-rows';
  const DATA_URL = 'mcda-banks-data.json';

  const CRITERIA = [
    { key: 'yield',        label: 'Cash Dividend Yield',           short: 'Yield' },
    { key: 'divGrowth',    label: 'Cash Dividend Growth (5Y)',     short: 'Div Gr.' },
    { key: 'roe',          label: 'ROE (5Y avg)',             short: 'ROE' },
    { key: 'assetGrowth',  label: 'Asset Growth (5Y)',        short: 'Asset Gr.' },
    { key: 'assetQuality', label: 'Asset Quality Score (5Y avg)', short: 'Asset Qual.' },
  ];

  let uidCounter = 1;
  let rows = [];
  let meta = null;
  let inputSort = { col: null, dir: 'asc' };
  let rankSort = { col: 'total', dir: 'desc' };

  function isTextCol(col) { return col === 'ticker' || col === 'name'; }

  function sortIndicator(state, col) {
    if (state.col !== col) return '';
    return state.dir === 'asc' ? ' ▴' : ' ▾';
  }

  function sortableTh(state, col, label, extraClass) {
    return `<th class="mcda-th-sort${extraClass ? ' ' + extraClass : ''}" data-sort-col="${col}">${label}${sortIndicator(state, col)}</th>`;
  }

  function toggleSort(state, col) {
    if (state.col === col) {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.col = col;
      state.dir = isTextCol(col) ? 'asc' : 'desc';
    }
  }

  function sortByCol(list, state, getValue) {
    if (!state.col) return list;
    const dir = state.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = getValue(a, state.col);
      const bv = getValue(b, state.col);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
  }

  function bindSortHeaders(containerSelector, state, onSorted) {
    document.querySelectorAll(`${containerSelector} th[data-sort-col]`).forEach((th) => {
      th.addEventListener('click', () => {
        toggleSort(state, th.dataset.sortCol);
        onSorted();
      });
    });
  }

  function withUid(row) {
    return Object.assign({ _id: 'b' + (uidCounter++) }, row);
  }

  function saveRows() {
    const plain = rows.map(({ _id, ...rest }) => rest);
    localStorage.setItem(ROWS_KEY, JSON.stringify(plain));
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function benefitScore(value, min, max) {
    if (max === min) return 20;
    return clamp(20 * (value - min) / (max - min), 0, 20);
  }

  function computeScores(list) {
    if (!list.length) return [];
    const bounds = {};
    CRITERIA.forEach(({ key }) => {
      const vals = list.map((r) => num(r[key]));
      bounds[key] = { min: Math.min(...vals), max: Math.max(...vals) };
    });
    return list.map((row) => {
      const scores = {};
      let total = 0;
      CRITERIA.forEach(({ key }) => {
        const s = benefitScore(num(row[key]), bounds[key].min, bounds[key].max);
        scores[key] = s;
        total += s;
      });
      return { row, scores, total };
    });
  }

  function fmt(n, d = 1) { return n.toFixed(d); }

  function svgIcon(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${path}"/></svg>`;
  }
  const ICON_TRASH = svgIcon('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13');
  const ICON_PLUS  = svgIcon('M12 5v14M5 12h14');
  const ICON_RESET = svgIcon('M3 12a9 9 0 1 0 3-6.7M3 4v5h5');

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function fetchRealData() {
    const res = await fetch(DATA_URL);
    const data = await res.json();
    meta = {
      generatedAt: data.generatedAt, source: data.source,
      warnings: data.warnings || [], methodologyNotes: data.methodologyNotes || [],
    };
    return data.banks.map((b) => withUid({
      ticker: b.ticker, name: b.name,
      yield: b.yield, divGrowth: b.divGrowth, roe: b.roe,
      assetGrowth: b.assetGrowth, assetQuality: b.assetQuality,
    }));
  }

  function loadRows() {
    try {
      const raw = localStorage.getItem(ROWS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(withUid);
      }
    } catch (e) { /* fall through to fetch */ }
    return null;
  }

  function render() {
    const root = document.getElementById('mcda-banks-root');
    root.innerHTML = `
      <section class="mcda-card mcda-intro">
        <h2>Bank Dividend Ranking</h2>
        <p>
          Ranks DSE-listed banks across five weighted criteria, <code>20 pts</code> each
          (<code>100</code> total) &mdash; all real, computed values, not hand-typed samples.
          Min-max normalized against whichever rows are currently in the table, so editing a
          number or adding/removing a bank recalculates the ranking live.
        </p>
        ${meta ? renderMethodologyNotes() : ''}
        ${meta ? renderCaveats() : ''}
      </section>

      <section class="mcda-card">
        <div class="mcda-controls">
          <span class="mcda-label">${rows.length} banks</span>
          <div class="mcda-spacer"></div>
          <button class="mcda-btn" id="mcda-add">${ICON_PLUS} Add bank</button>
          <button class="mcda-btn mcda-btn-danger" id="mcda-reset">${ICON_RESET} Reset to real data</button>
        </div>

        <div class="mcda-section-hd">Raw metrics (editable)</div>
        <div class="mcda-table-wrap">${renderInputTable()}</div>
      </section>

      <section class="mcda-card">
        <div class="mcda-section-hd">Ranking</div>
        <div class="mcda-table-wrap" id="mcda-rank-wrap">${renderRankTable()}</div>
        <div class="mcda-legend-grid">
          ${CRITERIA.map((c) => `
            <div class="mcda-legend-item">
              <strong><span class="mcda-legend-weight">20 pts</span> — ${c.label}</strong>
              <span>Min-max normalized: highest value in the list scores 20, lowest scores 0.</span>
            </div>`).join('')}
        </div>
      </section>
    `;
    bindEvents();
  }

  function renderMethodologyNotes() {
    if (!meta.methodologyNotes || !meta.methodologyNotes.length) return '';
    return meta.methodologyNotes.map((n) => `<p class="mcda-methodology-note">${escapeHtml(n)}</p>`).join('');
  }

  function renderCaveats() {
    if (!meta.warnings.length) return '';
    return `
      <details class="mcda-caveats">
        <summary>Data caveats (${meta.warnings.length}) — generated ${meta.generatedAt}</summary>
        <ul>${meta.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </details>`;
  }

  function renderInputTable() {
    if (!rows.length) return `<div class="mcda-empty">No banks yet — click "Add bank".</div>`;
    const displayRows = sortByCol(rows, inputSort, (row, col) => (isTextCol(col) ? (row[col] || '') : num(row[col])));
    return `
      <table class="mcda-table">
        <thead>
          <tr>
            <th class="mcda-th-left">Sl</th>
            ${sortableTh(inputSort, 'ticker', 'Ticker', 'mcda-th-left')}
            ${sortableTh(inputSort, 'name', 'Bank Name', 'mcda-th-left')}
            ${CRITERIA.map((c) => sortableTh(inputSort, c.key, c.label)).join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${displayRows.map((row, i) => `
            <tr data-id="${row._id}">
              <td class="mcda-sl">${i + 1}</td>
              <td><input class="mcda-input" style="min-width:90px;text-align:left;font-weight:600;color:var(--accent)" data-field="ticker" value="${escapeHtml(row.ticker)}" /></td>
              <td><input class="mcda-input mcda-input-name" data-field="name" value="${escapeHtml(row.name)}" placeholder="Bank name" /></td>
              ${CRITERIA.map((c) => `<td><input class="mcda-input" type="number" step="0.01" data-field="${c.key}" value="${row[c.key] ?? ''}" /></td>`).join('')}
              <td><button class="mcda-row-del" data-del="${row._id}" title="Remove row" aria-label="Remove row">${ICON_TRASH}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function rankColValue(r, col) {
    if (col === 'ticker') return r.row.ticker || '';
    if (col === 'name') return r.row.name || '';
    if (col === 'total') return r.total;
    return r.scores[col] ?? 0;
  }

  function renderRankTable() {
    let ranked = computeScores(rows);
    if (!ranked.length) return `<div class="mcda-empty">Nothing to rank yet.</div>`;
    ranked = sortByCol(ranked, rankSort, rankColValue);
    return `
      <table class="mcda-table">
        <thead>
          <tr>
            <th class="mcda-th-left">#</th>
            ${sortableTh(rankSort, 'ticker', 'Ticker', 'mcda-th-left')}
            ${sortableTh(rankSort, 'name', 'Bank', 'mcda-th-left')}
            ${CRITERIA.map((c) => sortableTh(rankSort, c.key, `${c.short} /20`)).join('')}
            ${sortableTh(rankSort, 'total', 'Total /100')}
          </tr>
        </thead>
        <tbody>
          ${ranked.map((r, i) => `
            <tr class="mcda-row-${i + 1}">
              <td class="mcda-td-rank">${i + 1}</td>
              <td class="mcda-td-company" style="color:var(--accent)">${escapeHtml(r.row.ticker)}</td>
              <td class="mcda-td-company">${escapeHtml(r.row.name) || '(unnamed)'}</td>
              ${CRITERIA.map((c) => `<td class="mcda-td-score">${fmt(r.scores[c.key])}</td>`).join('')}
              <td>
                <div class="mcda-bar-cell">
                  <span class="mcda-td-total">${fmt(r.total)}</span>
                  <div class="mcda-bar-track"><div class="mcda-bar-fill" style="width:${clamp(r.total, 0, 100)}%"></div></div>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function rerenderRank() {
    document.getElementById('mcda-rank-wrap').innerHTML = renderRankTable();
    bindSortHeaders('#mcda-rank-wrap', rankSort, rerenderRank);
  }

  function bindEvents() {
    bindSortHeaders('.mcda-table-wrap:not(#mcda-rank-wrap)', inputSort, render);
    bindSortHeaders('#mcda-rank-wrap', rankSort, rerenderRank);

    document.getElementById('mcda-add').addEventListener('click', () => {
      rows.push(withUid({ ticker: '', name: '', yield: 0, divGrowth: 0, roe: 0, assetGrowth: 0, assetQuality: 0 }));
      saveRows();
      render();
    });

    document.getElementById('mcda-reset').addEventListener('click', async () => {
      if (!confirm('Reset to the real computed bank data? This discards your edits.')) return;
      rows = await fetchRealData();
      saveRows();
      render();
    });

    document.querySelectorAll('.mcda-row-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        rows = rows.filter((r) => r._id !== btn.dataset.del);
        saveRows();
        render();
      });
    });

    document.querySelectorAll('.mcda-input').forEach((input) => {
      input.addEventListener('input', () => {
        const tr = input.closest('tr');
        const row = rows.find((r) => r._id === tr.dataset.id);
        if (!row) return;
        const field = input.dataset.field;
        row[field] = (field === 'name' || field === 'ticker') ? input.value : num(input.value);
        saveRows();
        rerenderRank();
      });
    });
  }

  async function init() {
    const stored = loadRows();
    if (stored) {
      rows = stored;
      // Load meta (caveats) in the background even when using stored edits.
      fetch(DATA_URL).then((r) => r.json()).then((data) => {
        meta = {
          generatedAt: data.generatedAt, source: data.source,
          warnings: data.warnings || [], methodologyNotes: data.methodologyNotes || [],
        };
        render();
      }).catch(() => {});
    } else {
      rows = await fetchRealData();
    }
    render();
  }

  init();
})();
