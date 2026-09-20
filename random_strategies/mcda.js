/* ═══════════════════════════════════════════════════════════
   RANDOM STRATEGIES — MCDA (Multi-Criteria-Decision-Analysis)
   dividend stock scorer.

   Five criteria, 20 points each (100 total), each scored by
   min-max normalization against whatever rows are currently in
   the table — so the ranking always reflects "best of this list",
   same as the source spreadsheet's Value/Max/Min columns.

   Earnings Quality is the one criterion without an obvious
   direction (a Core Earnings Ratio far from 100% can mean either
   one-off gains propping up profit, or one-off losses masking a
   healthy core business) — the mode selector lets the reader pick
   how it should be scored instead of baking in one assumption.
═══════════════════════════════════════════════════════════ */

(function () {
  const ROWS_KEY = 'dse-mcda-rows';
  const MODE_KEY = 'dse-mcda-mode';

  const CRITERIA = [
    { key: 'yield',     label: 'Dividend Yield',  short: 'Yield',   suffix: '%' },
    { key: 'divGrowth', label: 'Dividend Growth (5Y)', short: 'Div Gr.', suffix: '%' },
    { key: 'roe',       label: 'ROE (5Y)',        short: 'ROE',     suffix: '%' },
    { key: 'revGrowth', label: 'Revenue Growth (5Y)', short: 'Rev Gr.', suffix: '%' },
    { key: 'coreRatio', label: 'Core Earnings Ratio', short: 'CER',  suffix: '%' },
  ];

  const SAMPLE_DATA = [
    { name: 'Jamuna Oil PLC.',                                yield: 9.88,  divGrowth: 8.45,   roe: 15.44,  revGrowth: 8.83,   coreRatio: 9.66 },
    { name: 'Meghna Petroleum PLC',                           yield: 9.43,  divGrowth: 5.92,   roe: 20.66,  revGrowth: 7.93,   coreRatio: 23.25 },
    { name: 'Grameenphone Ltd.',                              yield: 8.39,  divGrowth: -4.90,  roe: 58.48,  revGrowth: 2.06,   coreRatio: 114.56 },
    { name: 'Padma Oil PLC.',                                 yield: 8.04,  divGrowth: 5.06,   roe: 17.72,  revGrowth: 10.06,  coreRatio: 18.90 },
    { name: 'Marico Bangladesh Limited',                      yield: 7.62,  divGrowth: 19.81,  roe: 113.07, revGrowth: 12.44,  coreRatio: 105.35 },
    { name: 'LafargeHolcim Bangladesh PLC.',                  yield: 6.94,  divGrowth: 31.95,  roe: 24.05,  revGrowth: 8.82,   coreRatio: 96.65 },
    { name: 'Summit Power Limited',                           yield: 6.36,  divGrowth: -10.15, roe: 10.37,  revGrowth: -1.83,  coreRatio: 151.73 },
    { name: 'Square Textiles PLC.',                           yield: 6.18,  divGrowth: 26.19,  roe: 13.91,  revGrowth: 14.66,  coreRatio: 189.59 },
    { name: 'MJL Bangladesh PLC',                             yield: 5.59,  divGrowth: 2.93,   roe: 16.91,  revGrowth: 15.63,  coreRatio: 102.75 },
    { name: 'Robi Axiata PLC.',                               yield: 5.50,  divGrowth: 28.43,  roe: 6.84,   revGrowth: 5.62,   coreRatio: 166.43 },
    { name: 'Matin Spinning Mills PLC',                       yield: 5.48,  divGrowth: 14.22,  roe: 9.84,   revGrowth: 15.65,  coreRatio: 178.81 },
    { name: 'Square Pharmaceuticals PLC.',                    yield: 5.47,  divGrowth: 20.62,  roe: 18.02,  revGrowth: 11.25,  coreRatio: 80.87 },
    { name: 'United Power Generation & Distribution Company Ltd.', yield: 5.35, divGrowth: -14.83, roe: 29.52, revGrowth: 3.84, coreRatio: 105.79 },
    { name: 'Envoy Textiles Limited',                         yield: 5.33,  divGrowth: 43.10,  roe: 7.52,   revGrowth: 19.67,  coreRatio: 191.89 },
    { name: 'BSRM Steels',                                    yield: 5.31,  divGrowth: 27.23,  roe: 17.62,  revGrowth: 22.92,  coreRatio: 136.10 },
  ];

  const QUALITY_MODES = {
    closest100: { label: 'Closest to 100% scores best', desc: 'Core earnings ≈ reported profit — least reliance on one-off gains/losses.' },
    higher:     { label: 'Higher is better',            desc: 'Treats a bigger core-earnings ratio as stronger underlying quality.' },
    lower:      { label: 'Lower is better',             desc: 'Treats a smaller core-earnings ratio as stronger underlying quality.' },
  };

  let uidCounter = 1;
  let rows = loadRows();
  let mode = localStorage.getItem(MODE_KEY) || 'closest100';
  let inputSort = { col: null, dir: 'asc' };
  let rankSort = { col: 'total', dir: 'desc' };

  function isTextCol(col) { return col === 'name'; }

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

  function loadRows() {
    try {
      const raw = localStorage.getItem(ROWS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed.map(withUid);
      }
    } catch (e) { /* fall through to sample data */ }
    return SAMPLE_DATA.map(withUid);
  }

  function withUid(row) {
    return Object.assign({ _id: 'r' + (uidCounter++) }, row);
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

  /* Min-max normalize a "higher is better" value to a 0-20 score.
     A flat column (max === min) can't discriminate, so every row
     gets full marks rather than dividing by zero. */
  function benefitScore(value, min, max) {
    if (max === min) return 20;
    return clamp(20 * (value - min) / (max - min), 0, 20);
  }

  function computeScores(list, qualityMode) {
    if (!list.length) return [];

    const bounds = {};
    ['yield', 'divGrowth', 'roe', 'revGrowth'].forEach((key) => {
      const vals = list.map((r) => num(r[key]));
      bounds[key] = { min: Math.min(...vals), max: Math.max(...vals) };
    });

    const ratios = list.map((r) => num(r.coreRatio));
    let qualityInput;
    if (qualityMode === 'closest100') {
      qualityInput = ratios.map((r) => -Math.abs(r - 100)); // less deviation = higher (better) input
    } else if (qualityMode === 'lower') {
      qualityInput = ratios.map((r) => -r);
    } else {
      qualityInput = ratios;
    }
    const qMin = Math.min(...qualityInput);
    const qMax = Math.max(...qualityInput);

    return list.map((row, i) => {
      const scores = {
        yield:     benefitScore(num(row.yield), bounds.yield.min, bounds.yield.max),
        divGrowth: benefitScore(num(row.divGrowth), bounds.divGrowth.min, bounds.divGrowth.max),
        roe:       benefitScore(num(row.roe), bounds.roe.min, bounds.roe.max),
        revGrowth: benefitScore(num(row.revGrowth), bounds.revGrowth.min, bounds.revGrowth.max),
        coreRatio: benefitScore(qualityInput[i], qMin, qMax),
      };
      const total = Object.values(scores).reduce((a, b) => a + b, 0);
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

  function render() {
    const root = document.getElementById('mcda-root');
    root.innerHTML = `
      <section class="mcda-card mcda-intro">
        <h2>MCDA Dividend Scorer</h2>
        <p>
          Ranks the companies below across five weighted criteria, <code>20 pts</code> each
          (<code>100</code> total). Each criterion is min-max normalized against whatever rows
          are currently in the table — edit the numbers, add or remove companies, and the
          ranking recalculates live. Nothing here is sourced from the site's own fundamentals
          data; it's a standalone worksheet seeded with a sample list, same as the source
          spreadsheet.
        </p>
      </section>

      <section class="mcda-card">
        <div class="mcda-controls">
          <div class="mcda-controls-group">
            <span class="mcda-label">Earnings Quality scoring</span>
            <select class="mcda-select" id="mcda-mode">
              ${Object.entries(QUALITY_MODES).map(([k, v]) => `<option value="${k}" ${k === mode ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
          </div>
          <div class="mcda-spacer"></div>
          <button class="mcda-btn" id="mcda-add">${ICON_PLUS} Add company</button>
          <button class="mcda-btn mcda-btn-danger" id="mcda-reset">${ICON_RESET} Reset to sample data</button>
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
              <span>${c.key === 'coreRatio' ? QUALITY_MODES[mode].desc : `Min-max normalized: highest value in the list scores 20, lowest scores 0.`}</span>
            </div>`).join('')}
        </div>
      </section>
    `;
    bindEvents();
  }

  function renderInputTable() {
    if (!rows.length) return `<div class="mcda-empty">No companies yet — click "Add company".</div>`;
    const displayRows = sortByCol(rows, inputSort, (row, col) => (isTextCol(col) ? (row[col] || '') : num(row[col])));
    return `
      <table class="mcda-table">
        <thead>
          <tr>
            <th class="mcda-th-left">Sl</th>
            ${sortableTh(inputSort, 'name', 'Company Name', 'mcda-th-left')}
            ${CRITERIA.map((c) => sortableTh(inputSort, c.key, c.label)).join('')}
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${displayRows.map((row, i) => `
            <tr data-id="${row._id}">
              <td class="mcda-sl">${i + 1}</td>
              <td><input class="mcda-input mcda-input-name" data-field="name" value="${escapeAttr(row.name)}" placeholder="Company name" /></td>
              ${CRITERIA.map((c) => `<td><input class="mcda-input" type="number" step="0.01" data-field="${c.key}" value="${row[c.key] ?? ''}" /></td>`).join('')}
              <td><button class="mcda-row-del" data-del="${row._id}" title="Remove row" aria-label="Remove row">${ICON_TRASH}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function rankColValue(r, col) {
    if (col === 'name') return r.row.name || '';
    if (col === 'total') return r.total;
    return r.scores[col] ?? 0;
  }

  function renderRankTable() {
    let ranked = computeScores(rows, mode);
    if (!ranked.length) return `<div class="mcda-empty">Nothing to rank yet.</div>`;
    ranked = sortByCol(ranked, rankSort, rankColValue);
    return `
      <table class="mcda-table">
        <thead>
          <tr>
            <th class="mcda-th-left">#</th>
            ${sortableTh(rankSort, 'name', 'Company', 'mcda-th-left')}
            ${CRITERIA.map((c) => sortableTh(rankSort, c.key, `${c.short} /20`)).join('')}
            ${sortableTh(rankSort, 'total', 'Total /100')}
          </tr>
        </thead>
        <tbody>
          ${ranked.map((r, i) => `
            <tr class="mcda-row-${i + 1}">
              <td class="mcda-td-rank">${i + 1}</td>
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

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function rerenderRank() {
    document.getElementById('mcda-rank-wrap').innerHTML = renderRankTable();
    bindSortHeaders('#mcda-rank-wrap', rankSort, rerenderRank);
  }

  function bindEvents() {
    bindSortHeaders('.mcda-table-wrap:not(#mcda-rank-wrap)', inputSort, render);
    bindSortHeaders('#mcda-rank-wrap', rankSort, rerenderRank);

    document.getElementById('mcda-mode').addEventListener('change', (e) => {
      mode = e.target.value;
      localStorage.setItem(MODE_KEY, mode);
      render();
    });

    document.getElementById('mcda-add').addEventListener('click', () => {
      rows.push(withUid({ name: '', yield: 0, divGrowth: 0, roe: 0, revGrowth: 0, coreRatio: 0 }));
      saveRows();
      render();
    });

    document.getElementById('mcda-reset').addEventListener('click', () => {
      if (!confirm('Reset to the sample 15-company list? This discards your edits.')) return;
      rows = SAMPLE_DATA.map(withUid);
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
        row[field] = field === 'name' ? input.value : num(input.value);
        saveRows();
        rerenderRank();
      });
    });
  }

  render();
})();
