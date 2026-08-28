'use strict';

/* ════════════════════════════════════════════════════════════
   tv-range-bar.js
   Bottom "visible range" shortcuts (1D/5D/1M/3M/6M/YTD/1Y/5Y/All),
   distinct from the top D/W/M candle-interval toggle: these just
   move zoomLevel/panOffset (both globals from candlestick-data.js)
   to show the last N trading days of whatever's already loaded —
   no new data fetch, same idea as scrolling/zooming by hand.

   Also drives the live date/time readout next to the buttons.
   ════════════════════════════════════════════════════════════ */

(function () {
  const buttonsEl = document.getElementById('tvRangeButtons');
  const dateTimeEl = document.getElementById('tvRangeDateTime');
  if (!buttonsEl && !dateTimeEl) return; // not on this page

  const TARGET_COUNTS = {
    '1D': 1,
    '5D': 5,
    '1M': 21,
    '3M': 63,
    '6M': 126,
    '1Y': 252,
    '5Y': 1260,
  };

  function getDisplayData() {
    if (typeof aggregatedData !== 'undefined' && aggregatedData.length > 0) return aggregatedData;
    return (typeof chartData !== 'undefined') ? chartData : [];
  }

  function computeTargetCount(rangeKey, data) {
    if (!data.length) return 1;
    if (rangeKey === 'All') return data.length;
    if (rangeKey === 'YTD') {
      const lastDate = data[data.length - 1].Date; // 'YYYY/MM/DD'
      const jan1 = lastDate.slice(0, 4) + '/01/01';
      let count = 0;
      for (let i = data.length - 1; i >= 0 && data[i].Date >= jan1; i--) count++;
      return Math.max(1, count);
    }
    return Math.min(TARGET_COUNTS[rangeKey] || data.length, data.length);
  }

  function applyRange(rangeKey) {
    const canvas = document.getElementById('candleCanvas');
    if (!canvas || typeof drawChart !== 'function') return;

    const data = getDisplayData();
    if (!data.length) return;

    const targetCount = computeTargetCount(rangeKey, data);
    const width = Math.max(400, canvas.parentElement.offsetWidth - 40);
    const chartWidth = width - 60 - 40; // padding.left + padding.right, matches candlestick-draw.js

    // Wider bounds than the manual scroll-wheel zoomIn()/zoomOut() buttons
    // (which cap at 0.3-4 for incremental-scroll usability): this is a
    // deliberate jump-to-view action, and needs to reach much lower zoom
    // levels for "All" on deep-history symbols (e.g. BPML's ~1900 candles)
    // and much higher zoom levels to approximate short ranges like "1D"/"5D".
    let newZoom = chartWidth / (8 * targetCount);
    newZoom = Math.max(0.02, Math.min(50, newZoom));

    zoomLevel = newZoom;
    panOffset = 0; // pin to the most recent candle
    drawChart();

    buttonsEl.querySelectorAll('.tv-range-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.range === rangeKey);
    });
  }

  if (buttonsEl) {
    buttonsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.tv-range-btn');
      if (btn) applyRange(btn.dataset.range);
    });
  }

  // ── Live date/time readout ─────────────────────────────────────
  function tickClock() {
    if (!dateTimeEl) return;
    const now = new Date();
    dateTimeEl.textContent = now.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
  }
  tickClock();
  setInterval(tickClock, 1000);

  window.applyTVRange = applyRange; // exposed for debugging/console use
})();
