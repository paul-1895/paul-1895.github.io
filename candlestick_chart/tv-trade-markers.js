/* ════════════════════════════════════════════════════════════
   tv-trade-markers.js
   Show/hide markers for trades actually taken (recorded on
   trades.html, served from /api/trades) directly on the price
   pane — entry marker, exit marker (if closed), a dotted line
   connecting them, and a hover tooltip with the trade details.

   Coordinate math reuses window._lastRender the same way
   tv-drawing-tools.js does. Toggled via #tradeMarkersBtn in the
   top toolbar; called from drawChart() in candlestick-draw.js
   exactly like drawUserAnnotations().

   Depends on : candlestick-draw.js (window._lastRender, drawChart,
                _crosshairPixel — all bare globals, classic-script scope)
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --gain / --loss / --sans /
// --mono tokens for canvas, falling back to the authored literal when
// that file isn't on the page. See candlestick-draw.js.
const _tmTheme = window.DSEChartTheme;
const _tmFont  = spec => (_tmTheme ? _tmTheme.font(spec) : spec);
const _tmGain  = fb => (_tmTheme ? _tmTheme.gain(fb) : fb);
const _tmLoss  = fb => (_tmTheme ? _tmTheme.loss(fb) : fb);

(function () {
  let allTrades     = null;                                   // cached /api/trades response
  let tradesVisible = localStorage.getItem('tv-trades-visible') !== '0'; // default ON
  let _hitTargets   = [];                                      // rebuilt every draw pass

  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  async function loadTrades() {
    try {
      const res = await fetch('/api/trades');
      allTrades = res.ok ? await res.json() : [];
    } catch {
      allTrades = [];
    }
    if (tradesVisible && typeof drawChart === 'function') drawChart();
  }

  function parseTradeDate(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (!m) return null;
    const monIdx = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (monIdx === -1) return null;
    const d = new Date(parseInt(m[3], 10), monIdx, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // Index (into the FULL displayData, not the visible slice) of the candle
  // on-or-before the given date; falls back to the closest candle overall
  // if the trade date is outside the loaded history.
  function nearestIndex(displayData, date) {
    if (!displayData || !displayData.length || !date) return null;
    const target = date.getTime();
    let best = 0, bestDiff = Infinity, onOrBefore = -1, onOrBeforeDiff = Infinity;
    for (let i = 0; i < displayData.length; i++) {
      const d = new Date(String(displayData[i].Date).replace(/\//g, '-') + 'T00:00:00');
      if (isNaN(d.getTime())) continue;
      const diff = Math.abs(d.getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
      if (d.getTime() <= target && diff < onOrBeforeDiff) { onOrBeforeDiff = diff; onOrBefore = i; }
    }
    return onOrBefore !== -1 ? onOrBefore : best;
  }

  function dataToPixel(index, price) {
    const r = window._lastRender;
    if (!r || !r.priceRange) return null;
    const x = r.padding.left + (index - r.startIdx + 0.5) * r.candleWidth;
    const { minPrice, maxPrice, paneHeight, paneY0 } = r.priceRange;
    const y = paneY0 + paneHeight * (1 - (price - minPrice) / (maxPrice - minPrice));
    return { x, y };
  }

  function currentSymbol() {
    const r = window._lastRender;
    if (!r || !r.displayData || !r.displayData.length) return null;
    return String(r.displayData[r.displayData.length - 1].Symbol || '').toUpperCase();
  }

  function tradesForCurrentSymbol() {
    const sym = currentSymbol();
    if (!sym || !allTrades) return [];
    return allTrades.filter(t => String(t.company || '').toUpperCase() === sym);
  }

  // ── Marker glyph ─────────────────────────────────────────────
  function drawTriangle(ctx, x, y, direction, color) {
    const size = 6;
    ctx.save();
    ctx.fillStyle   = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    if (direction === 'up') {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x - size, y + size);
      ctx.lineTo(x + size, y + size);
    } else {
      ctx.moveTo(x, y + size);
      ctx.lineTo(x - size, y - size);
      ctx.lineTo(x + size, y - size);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ── Tooltip ───────────────────────────────────────────────────
  function fmtDate(d) {
    return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  function drawTooltip(ctx, width, priceHeight, mx, my, trade) {
    const entryDate  = parseTradeDate(trade.entryDate);
    const exitDate   = parseTradeDate(trade.exitDate);
    const entryPrice = parseFloat(trade.entry);
    const exitPrice  = parseFloat(trade.exit);
    const isShort    = trade.side === 'short';
    const hasExit    = exitDate && !isNaN(exitPrice) && exitPrice > 0;

    const lines = [`${trade.company}  •  ${isShort ? 'SHORT' : 'LONG'}`];
    if (hasExit) {
      lines.push(`${fmtDate(entryDate)} @ ${entryPrice}  →  ${fmtDate(exitDate)} @ ${exitPrice}`);
      const pct = isShort
        ? ((entryPrice - exitPrice) / entryPrice) * 100
        : ((exitPrice - entryPrice) / entryPrice) * 100;
      const unitTxt = trade.unit ? `${trade.unit} shares  •  ` : '';
      lines.push(`${unitTxt}${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`);
    } else {
      lines.push(`Entry ${fmtDate(entryDate)} @ ${entryPrice}  •  open position`);
      if (trade.unit) lines.push(`${trade.unit} shares`);
    }
    if (trade.observation) {
      const obs = String(trade.observation);
      lines.push(obs.length > 70 ? obs.slice(0, 67) + '…' : obs);
    }

    ctx.save();
    ctx.font = _tmFont('600 11px "DM Sans", sans-serif');
    const padX = 9, padY = 7, lineH = 15;
    const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2;
    const boxH = lines.length * lineH + padY * 2;

    let bx = mx + 14, by = my - boxH - 10;
    if (bx + boxW > width - 10) bx = mx - boxW - 14;
    if (by < 4) by = my + 14;
    if (by + boxH > priceHeight - 4) by = priceHeight - boxH - 4;

    const isLight = document.documentElement.classList.contains('light-mode');
    ctx.fillStyle = isLight ? 'rgba(30,41,59,0.96)' : 'rgba(15,20,25,0.96)';
    ctx.strokeStyle = 'rgba(160,174,192,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, 4);
    else ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle    = '#e2eaf6';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      ctx.fillStyle = i === 0 ? '#ffffff' : '#c3ccd8';
      ctx.fillText(line, bx + padX, by + padY + lineH * i + lineH / 2);
    });
    ctx.restore();
  }

  // ── Main render, called from drawChart() ────────────────────
  window.drawTradeMarkers = function (ctx, width, priceHeight) {
    if (!tradesVisible) return;
    const r = window._lastRender;
    if (!r || !r.priceRange || !r.displayData) return;
    const trades = tradesForCurrentSymbol();
    _hitTargets = [];
    if (!trades.length) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, priceHeight);
    ctx.clip();

    trades.forEach(trade => {
      const entryDate  = parseTradeDate(trade.entryDate);
      const entryPrice = parseFloat(trade.entry);
      if (!entryDate || isNaN(entryPrice)) return;
      const isShort = trade.side === 'short';

      const entryIdx = nearestIndex(r.displayData, entryDate);
      if (entryIdx == null) return;
      const entryPx = dataToPixel(entryIdx, entryPrice);
      if (!entryPx) return;

      let exitPx = null;
      const exitDate  = parseTradeDate(trade.exitDate);
      const exitPrice = parseFloat(trade.exit);
      if (exitDate && !isNaN(exitPrice) && exitPrice > 0) {
        const exitIdx = nearestIndex(r.displayData, exitDate);
        if (exitIdx != null) exitPx = dataToPixel(exitIdx, exitPrice);
      }

      if (exitPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(160,174,192,0.5)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(entryPx.x, entryPx.y);
        ctx.lineTo(exitPx.x, exitPx.y);
        ctx.stroke();
        ctx.restore();
      }

      // Matches the candle up/down colours, which now come from the
      // global gain/loss palette (see candlestick-draw.js).
      const buyColor  = _tmGain('#26a69a');
      const sellColor = _tmLoss('#ef5350');
      drawTriangle(ctx, entryPx.x, entryPx.y, isShort ? 'down' : 'up', isShort ? sellColor : buyColor);
      _hitTargets.push({ x: entryPx.x, y: entryPx.y, trade });

      if (exitPx) {
        drawTriangle(ctx, exitPx.x, exitPx.y, isShort ? 'up' : 'down', isShort ? buyColor : sellColor);
        _hitTargets.push({ x: exitPx.x, y: exitPx.y, trade });
      }
    });

    ctx.restore();

    // Hover tooltip — reuses the crosshair's tracked mouse position (bare
    // global from candlestick-draw.js), so no extra mousemove listener needed.
    const cp = (typeof _crosshairPixel !== 'undefined') ? _crosshairPixel : null;
    if (cp) {
      let hit = null, hitDist = 12;
      _hitTargets.forEach(h => {
        const dist = Math.hypot(h.x - cp.x, h.y - cp.y);
        if (dist <= hitDist) { hit = h.trade; hitDist = dist; }
      });
      if (hit) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, priceHeight);
        ctx.clip();
        drawTooltip(ctx, width, priceHeight, cp.x, cp.y, hit);
        ctx.restore();
      }
    }
  };

  window.toggleTradeMarkers = function () {
    tradesVisible = !tradesVisible;
    localStorage.setItem('tv-trades-visible', tradesVisible ? '1' : '0');
    updateTradeMarkersBtn();
    if (tradesVisible) loadTrades();
    else if (typeof drawChart === 'function') drawChart();
  };

  function updateTradeMarkersBtn() {
    const btn = document.getElementById('tradeMarkersBtn');
    if (btn) btn.classList.toggle('active', tradesVisible);
  }

  updateTradeMarkersBtn();
  loadTrades();
})();
