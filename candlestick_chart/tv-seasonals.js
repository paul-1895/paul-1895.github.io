'use strict';

/* ════════════════════════════════════════════════════════════
   tv-seasonals.js
   Pure data layer for the "Seasonals" view (TradingView-style
   year x month returns table). No DOM access here — see
   tv-seasonals-ui.js for rendering.

   computeSeasonalData(data) takes the same ascending, deduped
   `chartData` array candlestick-data.js already builds
   ({Date:'YYYY/MM/DD', Close, ...}) and returns, for every
   (year, month) that has at least one real trading day:
     - pct: % change of that month's last trading-day Close vs.
            the immediately preceding populated month's Close
            (chronological, so it correctly skips gaps — a
            delisted/suspended stretch just leaves those months
            absent rather than fabricating a value).
     - abs: the same comparison in raw price terms ("Points").
   The very first populated month in the whole dataset has no
   prior month to compare against and is intentionally left out
   of monthsMatrix (rendered as "—" by the UI).
   ════════════════════════════════════════════════════════════ */

(function () {
  function computeSeasonalData(data) {
    if (!data || !data.length) return { years: [], monthsMatrix: {} };

    // Collapse to one entry per (year, month): the last trading day's
    // Close seen for that month, walking the ascending data in order.
    const monthEntries = []; // [{ year, month, close }]
    let curKey = null;
    for (let i = 0; i < data.length; i++) {
      const d = data[i].Date; // 'YYYY/MM/DD'
      const year = parseInt(d.slice(0, 4), 10);
      const month = parseInt(d.slice(5, 7), 10);
      const key = year * 100 + month;
      if (key !== curKey) {
        monthEntries.push({ year, month, close: data[i].Close });
        curKey = key;
      } else {
        monthEntries[monthEntries.length - 1].close = data[i].Close;
      }
    }

    const monthsMatrix = {}; // year -> month -> { pct, abs }
    const years = new Set();
    if (monthEntries.length) years.add(monthEntries[0].year);

    for (let i = 1; i < monthEntries.length; i++) {
      const cur = monthEntries[i];
      const prev = monthEntries[i - 1];
      years.add(cur.year);
      if (!prev.close) continue; // guard against a zero/garbage baseline (e.g. a fully-suspended month)
      const pct = (cur.close / prev.close - 1) * 100;
      const abs = cur.close - prev.close;
      if (!monthsMatrix[cur.year]) monthsMatrix[cur.year] = {};
      monthsMatrix[cur.year][cur.month] = { pct, abs };
    }

    return {
      years: Array.from(years).sort((a, b) => a - b),
      monthsMatrix,
    };
  }

  // mode: 'pct' | 'abs'. Only years actually passed in `years` are
  // considered — callers filter to the slider-selected sub-range first.
  function computeSeasonalMonthStats(monthsMatrix, years, mode) {
    const stats = {};
    for (let m = 1; m <= 12; m++) {
      const vals = [];
      years.forEach((y) => {
        const cell = monthsMatrix[y] && monthsMatrix[y][m];
        if (cell) vals.push(mode === 'abs' ? cell.abs : cell.pct);
      });
      let up = 0, down = 0, flat = 0;
      vals.forEach((v) => {
        if (Math.abs(v) < 0.005) flat++;
        else if (v > 0) up++;
        else down++;
      });
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const sorted = vals.slice().sort((a, b) => a - b);
      const median = sorted.length
        ? (sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
        : null;
      stats[m] = { count: vals.length, up, down, flat, mean, median };
    }
    return stats;
  }

  window.computeSeasonalData = computeSeasonalData;
  window.computeSeasonalMonthStats = computeSeasonalMonthStats;
})();
