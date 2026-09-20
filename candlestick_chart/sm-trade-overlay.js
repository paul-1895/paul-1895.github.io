/* ════════════════════════════════════════════════════════════
   sm-trade-overlay.js
   Draws ONE Super Model simulated trade (entry / stoploss /
   target / exit) onto the price pane, read from URL params.

   This is what lets the Super Model page's "trade footprint"
   modal embed this whole chart page in an iframe and still show
   the trade — instead of reimplementing candles, volume, RSI and
   MACD in its own little SVG. Every real chart feature (all
   indicators, drawing tools, zoom/pan, timeframes, replay,
   seasonals, settings) comes along for free.

   URL params (all optional; nothing draws without smEntryDate):
     smEntryDate=YYYY/MM/DD   smEntry=13.6
     smExitDate=YYYY/MM/DD    smExitPrice=12.8
     smStop=13                smTarget=14.67
     smSide=buy|sell          smOutcome=target|stoploss|breakeven|expired
     smFocus=1                zoom/pan so the trade fills the view

   Coordinate math mirrors tv-trade-markers.js (window._lastRender),
   and the draw hook is called from drawChart() the same way
   drawTradeMarkers() and drawUserAnnotations() are.

   Depends on : candlestick-draw.js (window._lastRender, drawChart),
                candlestick-data.js (zoomLevel, panOffset — bare
                globals, classic-script scope)
   ════════════════════════════════════════════════════════════ */

(function () {
  const _smTheme = window.DSEChartTheme;
  const _smFont = spec => (_smTheme ? _smTheme.font(spec) : spec);
  const _smGain = fb => (_smTheme ? _smTheme.gain(fb) : fb);
  const _smLoss = fb => (_smTheme ? _smTheme.loss(fb) : fb);

  const ACCENT = '#7c5cff';   // entry — distinct from gain/loss so it reads as "the plan", not an outcome

  const qs = new URLSearchParams(window.location.search);
  const numParam = k => { const v = parseFloat(qs.get(k)); return isFinite(v) ? v : null; };

  // ?embed=1 — drop the site banner/nav when this page is inside an iframe
  // (the Super Model trade modal). The trading toolbar stays: indicator
  // toggles, timeframes and drawing tools are the point of embedding the
  // real chart rather than a picture of one. Applied for embed=1 regardless
  // of trade params, so a bare embedded chart works too.
  if (qs.get('embed') === '1') {
    const hide = () => {
      const h = document.querySelector('.site-header');
      if (h) h.style.display = 'none';
      document.documentElement.classList.add('sm-embedded');
      collapseSidebar();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hide);
    else hide();
  }

  // Right sidebar starts collapsed when embedded: in a modal the chart is
  // the point, and the watchlist / key-stats cards eat ~290px of it. The
  // icon RAIL stays, so every panel is one click away — this is a different
  // default, not a removed feature.
  //
  // Each panel is hidden individually (rather than hiding their shared
  // container) precisely so those rail buttons keep working: tv-sidebar.js's
  // wireRailToggle reads each panel's own display to decide which way to
  // toggle, and de-activating the buttons here keeps their state honest.
  // The sidebar column is then shrunk to the rail's width, and restored the
  // moment any panel is toggled back on.
  const SIDEBAR_PANEL_IDS = ['tvWatchlist', 'tvSymbolInfo', 'tvNewsPanel', 'tvMfHolders', 'tvBankDetails'];
  const RAIL_BTN_IDS = ['railWatchlistBtn', 'railDetailsBtn', 'railNewsBtn', 'railMfHoldersBtn', 'railBankDetailsBtn'];
  const RAIL_ONLY_WIDTH = 52 + 16;   // .tv-right-rail flex-basis + its margin-left

  function anyPanelVisible() {
    return SIDEBAR_PANEL_IDS.some(id => {
      const el = document.getElementById(id);
      return el && el.style.display !== 'none';
    });
  }

  function syncSidebarWidth(shell, fullWidth) {
    if (!shell) return;
    shell.style.setProperty('--tv-sidebar-width', (anyPanelVisible() ? fullWidth : RAIL_ONLY_WIDTH) + 'px');
    if (typeof drawChart === 'function') drawChart();
  }

  function collapseSidebar() {
    const shell = document.querySelector('.tv-page-shell');
    if (!shell) return;
    // Whatever width the sidebar would have had (default or user-resized) is
    // what we restore to when a panel comes back.
    const fullWidth = parseInt(
      getComputedStyle(shell).getPropertyValue('--tv-sidebar-width'), 10) || 344;

    SIDEBAR_PANEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    RAIL_BTN_IDS.forEach(id => {
      const b = document.getElementById(id);
      if (b) b.classList.remove('active');
    });
    shell.style.setProperty('--tv-sidebar-width', RAIL_ONLY_WIDTH + 'px');

    // tv-sidebar.js owns the click handlers; this listener runs after them
    // in the same bubble phase, so it sees the post-toggle display values.
    RAIL_BTN_IDS.forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', () => setTimeout(() => syncSidebarWidth(shell, fullWidth), 0));
    });
  }

  const trade = {
    entryDate: qs.get('smEntryDate'),
    exitDate: qs.get('smExitDate'),
    entry: numParam('smEntry'),
    exitPrice: numParam('smExitPrice'),
    stop: numParam('smStop'),
    target: numParam('smTarget'),
    side: (qs.get('smSide') || 'buy').toLowerCase(),
    outcome: (qs.get('smOutcome') || '').toLowerCase(),
  };

  const active = !!(trade.entryDate && trade.entry != null);
  if (!active) return;   // no params → this file is inert, page behaves exactly as before

  const outcomeColor = () =>
    trade.outcome === 'target' || trade.outcome === 'breakeven' ? _smGain('#10b981')
      : trade.outcome === 'stoploss' ? _smLoss('#ef4444')
        : 'rgba(160,174,192,0.9)';

  // Index of the candle on-or-before a date, in whatever the current
  // displayData is — daily, weekly or monthly. Same fallback shape as
  // tv-trade-markers.js's nearestIndex: a trade dated inside a weekly
  // bucket resolves to that bucket rather than vanishing.
  function indexForDate(displayData, dateStr) {
    if (!displayData || !displayData.length || !dateStr) return null;
    const target = String(dateStr).replace(/-/g, '/');
    let onOrBefore = -1;
    for (let i = 0; i < displayData.length; i++) {
      const d = String(displayData[i].Date).replace(/-/g, '/');
      if (d === target) return i;
      if (d <= target) onOrBefore = i;
    }
    return onOrBefore !== -1 ? onOrBefore : null;
  }

  function dataToPixel(index, price) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return null;
    const x = r.padding.left + (index - r.startIdx + 0.5) * r.candleWidth;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    const y = paneY0 + paneHeight * (1 - (price - minPrice) / (maxPrice - minPrice));
    return { x, y };
  }

  function priceToY(price) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return null;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    return paneY0 + paneHeight * (1 - (price - minPrice) / (maxPrice - minPrice));
  }

  // ── Level line + right-edge tag ───────────────────────────────
  function drawLevel(ctx, width, price, color, label, fromX) {
    const y = priceToY(price);
    if (y == null || !isFinite(y)) return;
    const r = window._lastRender;
    const right = width - r.padding.right;
    if (y < r.priceRange.paneY0 - 2 || y > r.priceRange.paneY0 + r.priceRange.paneHeight + 2) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.max(fromX, r.padding.left), y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tag sits just inside the right edge, like the chart's own last-price tag.
    ctx.font = _smFont('600 10px "DM Sans", sans-serif');
    const text = `${label} ${price}`;
    const tw = ctx.measureText(text).width;
    const bx = right - tw - 10, by = y - 8;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, tw + 8, 16, 3); ctx.fill(); }
    else ctx.fillRect(bx, by, tw + 8, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 4, y);
    ctx.restore();
  }

  function drawTriangle(ctx, x, y, dir, color) {
    const s = 7;
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (dir === 'up') { ctx.moveTo(x, y - s); ctx.lineTo(x - s, y + s); ctx.lineTo(x + s, y + s); }
    else { ctx.moveTo(x, y + s); ctx.lineTo(x - s, y - s); ctx.lineTo(x + s, y - s); }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ── Main draw hook — called from drawChart() ──────────────────
  window.drawSuperModelTrade = function (ctx, width, priceHeight) {
    const r = window._lastRender;
    if (!r || !r.priceRange || !r.displayData) return;

    const entryIdx = indexForDate(r.displayData, trade.entryDate);
    if (entryIdx == null) return;
    const exitIdx = trade.exitDate ? indexForDate(r.displayData, trade.exitDate) : null;

    const entryPt = dataToPixel(entryIdx, trade.entry);
    const isBuy = trade.side !== 'sell';

    // Levels start at the entry candle and run to the right edge — the plan
    // didn't exist before the signal, so drawing them earlier would imply
    // knowledge the model didn't have.
    const fromX = entryPt ? entryPt.x : r.padding.left;
    if (trade.target != null) drawLevel(ctx, width, trade.target, _smGain('#10b981'), 'Target', fromX);
    if (trade.stop != null) drawLevel(ctx, width, trade.stop, _smLoss('#ef4444'), 'Stop', fromX);
    drawLevel(ctx, width, trade.entry, ACCENT, 'Entry', fromX);

    // Shaded hold period between entry and exit.
    if (exitIdx != null && entryPt) {
      const exitPt = dataToPixel(exitIdx, trade.exitPrice != null ? trade.exitPrice : trade.entry);
      if (exitPt) {
        ctx.save();
        ctx.fillStyle = ACCENT;
        ctx.globalAlpha = 0.07;
        ctx.fillRect(entryPt.x, r.priceRange.paneY0, exitPt.x - entryPt.x, r.priceRange.paneHeight);
        ctx.restore();
      }
    }

    // Entry marker: triangle pointing the way the trade expects price to go.
    if (entryPt) drawTriangle(ctx, entryPt.x, entryPt.y + (isBuy ? 14 : -14), isBuy ? 'up' : 'down', ACCENT);

    // Exit marker: filled dot, coloured by how the trade actually ended.
    if (exitIdx != null && trade.exitPrice != null) {
      const p = dataToPixel(exitIdx, trade.exitPrice);
      if (p) {
        ctx.save();
        ctx.fillStyle = outcomeColor();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  };

  // ── Auto-focus: frame the trade instead of the latest bars ────
  // panOffset counts candles back from the right edge (see drawChart), so
  // parking the exit a few candles in from the right puts the whole hold
  // period on screen. Runs once, after the first successful render.
  function focusTrade() {
    if (qs.get('smFocus') !== '1') return;
    const r = window._lastRender;
    if (!r || !r.displayData || !r.displayData.length) return;
    const data = r.displayData;
    const entryIdx = indexForDate(data, trade.entryDate);
    if (entryIdx == null) return;
    const exitIdx = trade.exitDate ? (indexForDate(data, trade.exitDate) ?? entryIdx) : entryIdx;

    const held = Math.max(1, exitIdx - entryIdx);
    // Show the hold period plus roughly equal breathing room on each side.
    const want = Math.max(30, Math.round(held * 2.2) + 20);
    const chartWidth = r.width - r.padding.left - r.padding.right;
    // Inverse of drawChart's candleCount = chartWidth / (8 * zoomLevel).
    if (typeof zoomLevel !== 'undefined') {
      zoomLevel = Math.max(0.2, Math.min(8, chartWidth / (8 * want)));
    }
    const padAfter = Math.max(4, Math.round(want * 0.18));
    if (typeof panOffset !== 'undefined') {
      panOffset = Math.max(0, data.length - (exitIdx + 1 + padAfter));
    }
    if (typeof drawChart === 'function') drawChart();
  }

  // processChartData() ends with drawChart(), so _lastRender exists by the
  // time this fires; poll briefly rather than racing the fetch.
  let tries = 0;
  const t = setInterval(() => {
    if (window._lastRender && window._lastRender.displayData && window._lastRender.displayData.length) {
      clearInterval(t);
      focusTrade();
    } else if (++tries > 120) {
      clearInterval(t);
    }
  }, 50);
})();
