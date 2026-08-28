/* ════════════════════════════════════════════════════════════
   candlestick-draw.js
   Canvas rendering: chart layout/panes, price-pane base (grid +
   candles/bars/line/area + chart-type variants), volume pane,
   and the shared date axis.

   Indicator-specific overlays and sub-panes (Moving Averages,
   Bollinger Bands, Ichimoku Cloud, Supertrend, MACD, RSI,
   Hilega-Milega) now live in indicators/*.js — this file just
   calls into them at the right point in the layout.

   Depends on : candlestick-data.js, indicators/*.js
   Consumed by: candlestick-ui.js (calls drawChart())
   ════════════════════════════════════════════════════════════ */

// ─── Display-settings bridge ──────────────────────────────────
// shared/chart-theme.js resolves the live --gain / --loss / --sans /
// --mono tokens (which shared/display-settings.js rewrites from the
// user's preferences) into the plain strings canvas needs. Every helper
// takes the authored literal as its fallback, so if that file is not on
// the page these all return exactly what was hardcoded before.
const _dwTheme = window.DSEChartTheme;
const _dwGain  = fb => (_dwTheme ? _dwTheme.gain(fb) : fb);
const _dwLoss  = fb => (_dwTheme ? _dwTheme.loss(fb) : fb);
const _dwAlpha = (c, a, fb) => (_dwTheme ? _dwTheme.alpha(c, a) : fb);
const _dwFont  = spec => (_dwTheme ? _dwTheme.font(spec) : spec);

// ─── Resizable pane heights ───────────────────────────────────
const paneHeights = {
  price:  350,
  volume: 80,
  macd:   100,
  rsi:    100,
  hm:     110,
};
const PANE_MIN = 50;
const HANDLE_H = 6;
const SPACING  = 10;
const COLLAPSED_H     = 28;   // height of a collapsed indicator pane
const PANE_HEIGHT_KEY = { 'MACD': 'macd', 'RSI': 'rsi', 'Hilega-Milega': 'hm' };

let _paneHandles = [];

// Stashed by drawPriceSection() every render — the price pane's real,
// post-margin, post-vertical-zoom price range and pixel bounds. Exposed via
// window._lastRender so tv-drawing-tools.js can convert mouse pixels <-> (index,
// price) using the exact same mapping the candles themselves are drawn with.
let _lastPriceRange = null;

// TradingView-style interactive crosshair: {x, y} in canvas-local pixels,
// set/cleared by candlestick-ui.js's mousemove/mouseleave handlers (only
// while hovering, not while actively panning/resizing). Persists across
// redraws so it stays put through indicator toggles, etc., until cleared.
let _crosshairPixel = null;

function setCrosshairPosition(x, y) {
  _crosshairPixel = { x, y };
  drawChart();
}

function clearCrosshairPosition() {
  if (!_crosshairPixel) return;
  _crosshairPixel = null;
  drawChart();
}

// ─── Entry point ─────────────────────────────────────────────
function drawChart() {
  const canvas = document.getElementById('candleCanvas');
  if (!canvas) return;

  let displayData = aggregatedData.length > 0 ? aggregatedData : chartData;

  // Apply chart type transformations
  if (chartType === 'heikinashi') {
    displayData = calculateHeikinAshi(displayData);
  } else if (chartType === 'renko') {
    displayData = calculateRenko(displayData, renkoBoxSize);
  }

  // ── Replay: cap displayData at replay cursor ──────────────────
  if (replayMode && replayIndex > 0) {
    displayData = displayData.slice(0, replayIndex);
    panOffset   = 0; // lock pan at replay position
  }

  // ── Which sub-panes are active (in user-defined order)? ──────
  const _paneOrderSafe = (typeof paneOrder !== 'undefined') ? paneOrder : ['MACD','RSI','Hilega-Milega'];
  const _collapsedSafe = (typeof collapsedPanes !== 'undefined') ? collapsedPanes : [];
  const activeSubPanes = _paneOrderSafe.filter(k => enabledIndicators.includes(k));

  const width          = Math.max(400, canvas.parentElement.offsetWidth - 40);
  const heightDateAxis = 34;

  // The date axis sits at the TOP of the canvas, not the bottom. With four
  // panes stacked (price, volume, MACD, RSI) a bottom axis ends up hundreds of
  // pixels below the candles and off-screen without scrolling, which makes the
  // dates useless for reading the price action they belong to. TOP is the strip
  // reserved for it; every pane below is laid out from there, so pane handles
  // and sub-pane offsets inherit the shift instead of each needing their own.
  const TOP = heightDateAxis;

  // ── Build pane layout ─────────────────────────────────────────
  _paneHandles = [];
  let nextY = TOP + paneHeights.price;

  _paneHandles.push({ id: 'price-volume', y: nextY + SPACING / 2, above: 'price', below: 'volume' });
  nextY += SPACING + paneHeights.volume;

  // Dynamic sub-pane loop — honours paneOrder and collapsedPanes
  const subPanesMeta = [];
  let prevAboveKey = 'volume';
  activeSubPanes.forEach((key, i) => {
    const hKey      = PANE_HEIGHT_KEY[key];
    const isCollapsed = _collapsedSafe.includes(key);
    const h         = isCollapsed ? COLLAPSED_H : paneHeights[hKey];
    _paneHandles.push({ id: `handle-subpane-${i}`, y: nextY + SPACING / 2, above: prevAboveKey, below: hKey });
    nextY += SPACING;
    subPanesMeta.push({ key, hKey, y: nextY, h, collapsed: isCollapsed });
    nextY += h;
    prevAboveKey = hKey;
  });

  // No bottom reserve any more — the axis strip was moved to the top and is
  // already accounted for by nextY having started at TOP.
  const height = nextY;

  const dpr = window.devicePixelRatio || 1;
  canvas.width  = width  * dpr;
  canvas.height = height * dpr;
  canvas.style.width  = width  + 'px';
  canvas.style.height = height + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim();
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  if (displayData.length === 0) return;

  // TradingView-style faint background watermark — drawn first so
  // everything else (grid, candles, indicators) layers on top of it.
  ctx.save();
  ctx.translate(0, TOP);
  drawWatermark(ctx, width, paneHeights.price, displayData[displayData.length - 1].Symbol);
  ctx.restore();

  // ── Visible window ──────────────────────────────────────────
  // right: 64, not 40 — leaves enough room for the last-price axis tag's
  // background box (text + padding), which is wider than a bare price label.
  const padding    = { top: 20, bottom: 20, left: 60, right: 64 };
  const chartWidth = width - padding.left - padding.right;
  const candleCount = Math.max(5, Math.min(
    displayData.length,
    Math.floor(chartWidth / (8 * zoomLevel))
  ));

  const maxPan = Math.max(0, displayData.length - candleCount);
  if (!isFinite(panOffset)) panOffset = 0;
  panOffset = Math.max(0, Math.min(maxPan, panOffset));

  const endIdx      = displayData.length - panOffset;
  const startIdx    = Math.max(0, endIdx - candleCount);
  const visibleData = displayData.slice(startIdx, endIdx);

  const candleWidth   = chartWidth / visibleData.length;
  const candleSpacing = candleWidth * 0.8;

  // ── Draw panes ──────────────────────────────────────────────
  // The price pane and everything drawn into it (grid, candles, indicator
  // overlays, last-price tag) take their y from `padding.top` and their usable
  // height from `height - padding.top - padding.bottom`. Adding TOP to BOTH
  // shifts the pane down by TOP while leaving that usable height identical, so
  // this one substitution moves the pane without touching any of the ~8
  // functions that draw inside it. _lastPriceRange.paneY0 picks the offset up
  // the same way — which is what keeps tv-drawing-tools.js and
  // tv-trade-markers.js converting mouse pixels to prices correctly.
  const pricePadding = { ...padding, top: padding.top + TOP };
  drawPriceSection(ctx, visibleData, width, paneHeights.price + TOP, candleWidth, candleSpacing, pricePadding, displayData, startIdx);

  const volY = TOP + paneHeights.price + SPACING;
  drawVolumeSection(ctx, visibleData, width, paneHeights.volume, candleWidth, candleSpacing, padding, volY);

  // Dynamic sub-pane draw — ordered and collapsed-aware
  subPanesMeta.forEach(({ key, hKey, y, h, collapsed }) => {
    if (collapsed) {
      _drawCollapsedPane(ctx, key, width, h, y);
    } else if (key === 'MACD') {
      drawMACDSection(ctx, visibleData, width, h, candleWidth, candleSpacing, padding, y);
    } else if (key === 'RSI') {
      drawRSISection(ctx, visibleData, width, h, candleWidth, candleSpacing, padding, y);
    } else if (key === 'Hilega-Milega') {
      drawHMSection(ctx, visibleData, width, h, candleWidth, candleSpacing, padding, y);
    }
  });

  drawDateAxis(ctx, visibleData, width, TOP, candleWidth, padding);

  // ── Expose render geometry for legend/hover lookups ───────────
  window._lastRender = {
    visibleData, candleWidth, padding, width, height,
    displayData, startIdx,
    subPanes: subPanesMeta,   // consumed by pane controls overlay
    priceRange: _lastPriceRange, // consumed by tv-drawing-tools.js
  };

  // ── User-drawn annotations (trend lines, horizontal lines, rectangles,
  // text) — rendered on top of the price pane only, via tv-drawing-tools.js.
  // Clip bound, not a position: these place themselves via priceRange.paneY0
  // (already TOP-aware), so the bound only has to reach the pane's new bottom.
  if (typeof drawUserAnnotations === 'function') drawUserAnnotations(ctx, width, TOP + paneHeights.price);

  // ── Trade markers (entry/exit of trades taken, from trades.html) —
  // rendered on top of the price pane, toggled via tv-trade-markers.js.
  if (typeof drawTradeMarkers === 'function') drawTradeMarkers(ctx, width, TOP + paneHeights.price);

  // ── Replay overlay: vertical cursor line on last visible candle ──
  if (replayMode && replayIndex > 0 && visibleData.length > 0) {
    _drawReplayCursor(ctx, visibleData, width, height, candleWidth, padding, TOP);
  }

  _drawPaneHandles(ctx, width, padding);

  // Crosshair last, on top of everything else — it's a cursor overlay.
  if (_crosshairPixel) _drawCrosshair(ctx, width, height, padding, TOP);

  if (typeof renderChartLegend === 'function') renderChartLegend();
}

// ─── Interactive crosshair ──────────────────────────────────────
// `top` is the height of the date-axis strip at the top of the canvas. The
// crosshair is the one overlay positioned from RAW MOUSE pixels rather than
// chart coordinates, so its pane-bounds tests have to be shifted by hand —
// everything else inherits the offset through the layout or paneY0.
function _drawCrosshair(ctx, width, height, padding, top = 0) {
  const { x, y } = _crosshairPixel;
  if (x < padding.left || x > width - padding.right) return;

  const r = window._lastRender;
  const isLightMode = document.documentElement.classList.contains('light-mode');
  const lineColor = isLightMode ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.4)';
  const tagBg     = isLightMode ? '#1e293b' : '#e2eaf6';
  const tagText   = isLightMode ? '#ffffff' : '#0f1419';

  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);

  // Vertical line spans every pane, from just under the date axis to the base.
  ctx.beginPath();
  ctx.moveTo(x, top + padding.top);
  ctx.lineTo(x, height - 4);
  ctx.stroke();

  // Horizontal line + price tag, only while hovering inside the price pane.
  const inPricePane = y >= top + padding.top && y <= top + paneHeights.price - padding.bottom;
  if (inPricePane) {
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (inPricePane && _lastPriceRange) {
    const { minPrice, maxPrice, paneHeight, paneY0 } = _lastPriceRange;
    const priceFrac = 1 - (y - paneY0) / paneHeight;
    const price = minPrice + priceFrac * (maxPrice - minPrice);
    _drawAxisTag(ctx, width - padding.right + 2, y, price.toFixed(2), tagBg, tagText, 'left');
  }

  // Date tag on the axis — now the top strip — snapped to the nearest candle.
  if (r && r.visibleData && r.visibleData.length) {
    const idx = Math.max(0, Math.min(r.visibleData.length - 1, Math.floor((x - padding.left) / r.candleWidth)));
    const candle = r.visibleData[idx];
    if (candle) {
      const d = new Date(String(candle.Date).replace(/\//g, '-') + 'T00:00:00');
      const label = isNaN(d)
        ? candle.Date
        : String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear();
      _drawAxisTag(ctx, x, top / 2 - 1, label, tagBg, tagText, 'center');
    }
  }

  ctx.restore();
}

// ─── Replay cursor overlay ────────────────────────────────────
// `top` = height of the date-axis strip. The cursor used to stop short of the
// axis when it sat at the bottom; with the axis moved up it starts below it
// instead and can now run all the way to the base of the last pane.
function _drawReplayCursor(ctx, visibleData, width, height, candleWidth, padding, top = 0) {
  const lastIdx = visibleData.length - 1;
  const x = padding.left + (lastIdx + 0.5) * candleWidth;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,245,196,0.6)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, top + padding.top);
  ctx.lineTo(x, height - 4);
  ctx.stroke();
  // Small triangle pointer, now at the TOP of the cursor just under the axis.
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,245,196,0.8)';
  ctx.beginPath();
  ctx.moveTo(x,     top + padding.top - 2);
  ctx.lineTo(x - 5, top + padding.top - 10);
  ctx.lineTo(x + 5, top + padding.top - 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ─── Resize handle renderer ───────────────────────────────────
function _drawPaneHandles(ctx, width, padding) {
  const isLightMode = document.documentElement.classList.contains('light-mode');
  _paneHandles.forEach(h => {
    const y = h.y;
    ctx.strokeStyle = isLightMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    const dotCount = 5, dotR = 1.5, gap = 6;
    const totalW   = (dotCount - 1) * gap;
    const startX   = width / 2 - totalW / 2;
    ctx.fillStyle  = isLightMode ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.35)';
    for (let d = 0; d < dotCount; d++) {
      ctx.beginPath();
      ctx.arc(startX + d * gap, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ─── Collapsed pane renderer ──────────────────────────────────
// Draws a slim label strip for a pane whose height is COLLAPSED_H.
function _drawCollapsedPane(ctx, key, width, height, startY) {
  const isLight   = document.documentElement.classList.contains('light-mode');
  const bgColor   = isLight ? 'rgba(0,0,0,0.03)'   : 'rgba(255,255,255,0.02)';
  const lineColor = isLight ? 'rgba(0,0,0,0.08)'   : 'rgba(255,255,255,0.06)';
  const textColor = isLight ? 'rgba(0,0,0,0.45)'   : 'rgba(160,174,192,0.5)';

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, startY, width, height);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(0, startY);         ctx.lineTo(width, startY);         ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, startY + height); ctx.lineTo(width, startY + height); ctx.stroke();

  ctx.fillStyle    = textColor;
  ctx.font         = _dwFont('bold 10px "DM Sans", sans-serif');
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(key, width / 2, startY + height / 2);
}

// ─── Shared date axis ─────────────────────────────────────────
// Drawn into the strip reserved at the TOP of the canvas (see TOP in
// drawChart), so `axisHeight` is the strip's own height, not the canvas's:
// labels sit centred in it and the separator rule closes it off along the
// bottom, with the price pane starting immediately below.
function drawDateAxis(ctx, visibleData, width, axisHeight, candleWidth, padding) {
  const isLightMode = document.documentElement.classList.contains('light-mode');
  const lineColor = isLightMode ? 'rgba(0,0,0,0.1)'   : 'rgba(255,255,255,0.08)';
  const textColor = isLightMode ? 'rgba(0,0,0,0.7)'   : 'rgba(160,174,192,0.8)';

  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left,          axisHeight - 0.5);
  ctx.lineTo(width - padding.right, axisHeight - 0.5);
  ctx.stroke();

  ctx.fillStyle    = textColor;
  ctx.font         = _dwFont('10px "DM Sans", sans-serif');
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  const step = Math.max(1, Math.ceil(visibleData.length / Math.floor(width / 70)));

  visibleData.forEach((candle, idx) => {
    if (idx % step !== 0 && idx !== visibleData.length - 1) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const d = new Date(String(candle.Date).replace(/\//g, '-') + 'T00:00:00');
    const label = isNaN(d)
      ? candle.Date
      : String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
    ctx.fillText(label, x, axisHeight / 2 - 1);
  });
}

// ─── Price pane ───────────────────────────────────────────────
function drawPriceSection(ctx, visibleData, width, height, candleWidth, spacing, padding, displayData, startIdx) {
  const isLightMode = document.documentElement.classList.contains('light-mode');

  let minPrice = Infinity, maxPrice = -Infinity;
  visibleData.forEach(c => {
    minPrice = Math.min(minPrice, c.Low);
    maxPrice = Math.max(maxPrice, c.High);
  });

  const range  = maxPrice - minPrice || 1;
  const margin = range * 0.1;
  minPrice -= margin;
  maxPrice += margin;

  const mid      = (minPrice + maxPrice) / 2 + (typeof priceOffset !== 'undefined' ? priceOffset : 0);
  const halfSpan = ((maxPrice - minPrice) / 2) / vZoomLevel;
  minPrice = mid - halfSpan;
  maxPrice = mid + halfSpan;

  const chartHeight = height - padding.top - padding.bottom;
  const y0          = padding.top;

  _lastPriceRange = { minPrice, maxPrice, paneHeight: chartHeight, paneY0: y0, paneHeightFull: height };

  const gridColor = isLightMode ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.1)';
  const textColor = isLightMode ? 'rgba(0,0,0,0.7)'   : 'rgba(160,174,192,0.8)';

  ctx.strokeStyle = gridColor;
  ctx.lineWidth   = 1;
  ctx.font        = _dwFont('10px "DM Sans", sans-serif');
  ctx.fillStyle   = textColor;
  ctx.textAlign   = 'left';  // Changed to 'left' for right-side display

  for (let i = 0; i <= 5; i++) {
    const price = minPrice + (maxPrice - minPrice) * (i / 5);
    const y     = y0 + chartHeight * (1 - (price - minPrice) / (maxPrice - minPrice));
    ctx.beginPath();
    ctx.moveTo(padding.left,          y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    // Draw price label on RIGHT side
    ctx.fillText(price.toFixed(2), width - padding.right + 10, y + 4);
  }

  // ── Indicator overlays ──────────────────────────────────────
  // EMA/SMA/Bollinger Bands/Ichimoku Cloud/Supertrend are now
  // multi-instance (see indicator-instances.js) — each active
  // instance draws itself via drawIndicatorInstancesOverlay(),
  // replacing the old single-toggle drawMAOverlays()/
  // drawBollingerBandsOverlay()/drawIchimokuCloudOverlay()/
  // drawSupertrendOverlay() calls that used to live here.
  if (typeof drawIndicatorInstancesOverlay === 'function') {
    drawIndicatorInstancesOverlay(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice);
  }

  if (chartType === 'line') {
    drawLineChart(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice);
  } else if (chartType === 'area') {
    drawAreaChart(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice);
  } else if (chartType === 'bars') {
    drawBarChart(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice);
  } else if (chartType === 'hollow') {
    drawHollowCandlesticks(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice);
  } else if (chartType === 'renko') {
    drawRenkoCandlesticks(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice);
  } else {
    drawCandlesticks(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice);
  }

  // Strategy markers (independent of any indicator's own on/off
  // toggle — controlled by its own button below the chart) go
  // last, on top of the candles, so they're never hidden behind
  // a candle body.
  drawActiveStrategy(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice);

  // TradingView-style last-price line + axis tag — always reflects the
  // most recent candle in the FULL dataset (not just the visible window),
  // same as a live ticker would, and is simply skipped if that price has
  // been panned/zoomed out of the current price range.
  drawLastPriceLine(ctx, width, height, padding, minPrice, maxPrice, displayData);
}

// ─── Last-price line + axis tag ────────────────────────────────
function drawLastPriceLine(ctx, width, height, padding, minPrice, maxPrice, displayData) {
  if (!displayData || !displayData.length) return;
  const last  = displayData[displayData.length - 1];
  const price = last.Close;
  if (price == null || isNaN(price) || price < minPrice || price > maxPrice) return;

  const prev   = displayData.length > 1 ? displayData[displayData.length - 2] : null;
  const isGain = prev ? price >= prev.Close : price >= last.Open;
  const color  = isGain ? _dwGain('#10b981') : _dwLoss('#ef4444');

  const chartHeight = height - padding.top - padding.bottom;
  const y = padding.top + chartHeight * (1 - (price - minPrice) / (maxPrice - minPrice));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(padding.left, y);
  ctx.lineTo(width - padding.right, y);
  ctx.stroke();
  ctx.setLineDash([]);

  _drawAxisTag(ctx, width - padding.right + 2, y, price.toFixed(2), color, '#ffffff', 'left');
  ctx.restore();
}

// ─── Shared axis-tag renderer (rounded pill, used by the last-price
// tag and the crosshair's price/date tags) ──────────────────────
// align 'left': x is the tag's left edge (used on the right price axis).
// align 'center': x is the tag's horizontal center (used on the date axis).
function _drawAxisTag(ctx, x, y, text, bgColor, textColor, align) {
  ctx.save();
  ctx.font = _dwFont('700 11px "DM Sans", sans-serif');
  const textW = ctx.measureText(text).width;
  const padX = 7, tagH = 18;
  const tagW = textW + padX * 2;
  const tagX = align === 'center' ? x - tagW / 2 : x;
  const tagY = y - tagH / 2;

  ctx.fillStyle = bgColor;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(tagX, tagY, tagW, tagH, 3);
  else ctx.rect(tagX, tagY, tagW, tagH);
  ctx.fill();

  ctx.fillStyle    = textColor;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, tagX + padX, y + 1);
  ctx.restore();
}

// ─── Background watermark (large, faint ticker symbol) ─────────
function drawWatermark(ctx, width, priceHeight, symbol) {
  if (!symbol) return;
  const isLightMode = document.documentElement.classList.contains('light-mode');
  ctx.save();
  let fontSize = 56;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = _dwFont(`700 ${fontSize}px "DM Sans", sans-serif`);
  // Capped at 35% of pane width — the price pane sits in a resizable column
  // that's often only 500-650px wide (not the full browser width), so a
  // looser cap here reads as an oversized label smeared across the candles
  // instead of a subtle background mark.
  const maxW  = width * 0.35;
  const textW = ctx.measureText(symbol).width;
  if (textW > maxW) {
    fontSize = Math.max(14, Math.floor(fontSize * maxW / textW));
    ctx.font = _dwFont(`700 ${fontSize}px "DM Sans", sans-serif`);
  }
  ctx.fillStyle = isLightMode ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.045)';
  ctx.fillText(symbol, width / 2, priceHeight / 2);
  ctx.restore();
}

// ─── Candlestick rendering ──────────────────────────────────────
function drawCandlesticks(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  visibleData.forEach((candle, idx) => {
    const x      = padding.left + (idx + 0.5) * candleWidth;
    const yOpen  = y0 + chartHeight * (1 - (candle.Open  - minPrice) / (maxPrice - minPrice));
    const yClose = y0 + chartHeight * (1 - (candle.Close - minPrice) / (maxPrice - minPrice));
    const yHigh  = y0 + chartHeight * (1 - (candle.High  - minPrice) / (maxPrice - minPrice));
    const yLow   = y0 + chartHeight * (1 - (candle.Low   - minPrice) / (maxPrice - minPrice));
    const isGain = candle.Close >= candle.Open;
    const color  = isGain ? _dwGain('#10b981') : _dwLoss('#ef4444');
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();
    const bodyH = Math.abs(yClose - yOpen) || 2;
    ctx.fillStyle = color;
    ctx.fillRect(x - spacing / 2.5, Math.min(yOpen, yClose), spacing / 1.25, bodyH);
    ctx.strokeRect(x - spacing / 2.5, Math.min(yOpen, yClose), spacing / 1.25, bodyH);
  });
}

// ─── Hollow candlestick rendering ───────────────────────────────
function drawHollowCandlesticks(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  visibleData.forEach((candle, idx) => {
    const x      = padding.left + (idx + 0.5) * candleWidth;
    const yOpen  = y0 + chartHeight * (1 - (candle.Open  - minPrice) / (maxPrice - minPrice));
    const yClose = y0 + chartHeight * (1 - (candle.Close - minPrice) / (maxPrice - minPrice));
    const yHigh  = y0 + chartHeight * (1 - (candle.High  - minPrice) / (maxPrice - minPrice));
    const yLow   = y0 + chartHeight * (1 - (candle.Low   - minPrice) / (maxPrice - minPrice));
    const isGain = candle.Close >= candle.Open;
    const color  = isGain ? _dwGain('#10b981') : _dwLoss('#ef4444');
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.stroke();
    const bodyH = Math.abs(yClose - yOpen) || 2;
    ctx.strokeRect(x - spacing / 2.5, Math.min(yOpen, yClose), spacing / 1.25, bodyH);
  });
}

// ─── Renko candlestick rendering ────────────────────────────────
function drawRenkoCandlesticks(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0  = padding.top;
  const cfg = (typeof renkoSettings !== 'undefined') ? renkoSettings : {};

  // Renko has its own colour pickers (the renko settings modal), and an
  // explicit choice there still wins. RENKO_DEFAULTS is copied wholesale
  // into renkoSettings and persisted verbatim, so cfg.colorUpBars is
  // always populated — "the user picked this" therefore has to mean
  // "differs from the default", not "is set". Untouched slots fall
  // through to the global gain/loss palette instead of the old literal.
  const _rDef  = (typeof RENKO_DEFAULTS !== 'undefined') ? RENKO_DEFAULTS : {};
  const _rPick = key => {
    const v = cfg[key];
    return (v && v !== _rDef[key]) ? v : null;
  };

  const colUpFill  = _rPick('colorUpBars')       || _dwGain('#26a69a');
  const colUpLine  = _rPick('colorUpBarsLine')   || _dwGain('#26a69a');
  const colDnFill  = _rPick('colorDownBars')     || _dwLoss('#ef5350');
  const colDnLine  = _rPick('colorDownBarsLine') || _dwLoss('#ef5350');
  const colPUFill  = _rPick('colorProjUp')       || _dwAlpha(_dwGain('#26a69a'), 0.35, 'rgba(38,166,154,0.35)');
  const colPULine  = _rPick('colorProjUpLine')   || _dwAlpha(_dwGain('#26a69a'), 0.6,  'rgba(38,166,154,0.6)');
  const colPDFill  = _rPick('colorProjDown')     || _dwAlpha(_dwLoss('#ef5350'), 0.35, 'rgba(239,83,80,0.35)');
  const colPDLine  = _rPick('colorProjDownLine') || _dwAlpha(_dwLoss('#ef5350'), 0.6,  'rgba(239,83,80,0.6)');
  const showWicks  = cfg.showWicks !== false;

  function _applyOpacity(hexColor, opacity) {
    if (!hexColor) return hexColor;
    if (hexColor.startsWith('rgba')) return hexColor;
    const pct = (opacity == null ? 100 : opacity) / 100;
    const m   = hexColor.match(/^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
    if (!m) return hexColor;
    return 'rgba(' + parseInt(m[1],16) + ',' + parseInt(m[2],16) + ',' + parseInt(m[3],16) + ',' + pct + ')';
  }

  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));
  const bW  = Math.max(1, spacing * 0.9);

  visibleData.forEach((candle, idx) => {
    const x      = padding.left + (idx + 0.5) * candleWidth;
    const isUp   = candle._renkoUp !== undefined ? candle._renkoUp : (candle.Close >= candle.Open);
    const isProj = candle._projection === true;

    const fillColor = isProj
      ? (isUp ? colPUFill : colPDFill)
      : (isUp
          ? _applyOpacity(colUpFill, cfg.opacityUpBars)
          : _applyOpacity(colDnFill, cfg.opacityDownBars));

    const lineColor = isProj
      ? (isUp ? colPULine : colPDLine)
      : (isUp
          ? _applyOpacity(colUpLine, cfg.opacityUpBarsLine)
          : _applyOpacity(colDnLine, cfg.opacityDownBarsLine));

    const yTop  = toY(Math.max(candle.Open, candle.Close));
    const yBot  = toY(Math.min(candle.Open, candle.Close));
    const bodyH = Math.max(1, yBot - yTop);

    if (showWicks) {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      if (candle.High > Math.max(candle.Open, candle.Close)) {
        ctx.moveTo(x, toY(candle.High));
        ctx.lineTo(x, yTop);
      }
      if (candle.Low < Math.min(candle.Open, candle.Close)) {
        ctx.moveTo(x, yBot);
        ctx.lineTo(x, toY(candle.Low));
      }
      ctx.stroke();
    }

    ctx.fillStyle   = fillColor;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 1;
    ctx.fillRect  (x - bW / 2, yTop, bW, bodyH);
    ctx.strokeRect(x - bW / 2, yTop, bW, bodyH);
  });
}

// ─── Bar chart rendering ────────────────────────────────────────
function drawBarChart(ctx, visibleData, width, height, candleWidth, spacing, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  visibleData.forEach((candle, idx) => {
    const x      = padding.left + (idx + 0.5) * candleWidth;
    const yOpen  = y0 + chartHeight * (1 - (candle.Open  - minPrice) / (maxPrice - minPrice));
    const yClose = y0 + chartHeight * (1 - (candle.Close - minPrice) / (maxPrice - minPrice));
    const yHigh  = y0 + chartHeight * (1 - (candle.High  - minPrice) / (maxPrice - minPrice));
    const yLow   = y0 + chartHeight * (1 - (candle.Low   - minPrice) / (maxPrice - minPrice));
    const isGain = candle.Close >= candle.Open;
    const color  = isGain ? _dwGain('#10b981') : _dwLoss('#ef4444');
    const barW   = spacing / 4;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, yHigh); ctx.lineTo(x, yLow); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - barW, yOpen);  ctx.lineTo(x, yOpen);  ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, yClose); ctx.lineTo(x + barW, yClose); ctx.stroke();
  });
}

// ─── Line chart rendering ───────────────────────────────────────
function drawLineChart(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0 = padding.top;
  ctx.strokeStyle = '#00f5c4';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  let first = true;
  visibleData.forEach((candle, idx) => {
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = y0 + chartHeight * (1 - (candle.Close - minPrice) / (maxPrice - minPrice));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ─── Area chart rendering ───────────────────────────────────────
function drawAreaChart(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0      = padding.top;
  const yBottom = y0 + chartHeight;
  const gradient = ctx.createLinearGradient(0, y0, 0, yBottom);
  gradient.addColorStop(0, 'rgba(0,245,196,0.3)');
  gradient.addColorStop(1, 'rgba(0,245,196,0.05)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(padding.left, yBottom);
  visibleData.forEach((candle, idx) => {
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = y0 + chartHeight * (1 - (candle.Close - minPrice) / (maxPrice - minPrice));
    ctx.lineTo(x, y);
  });
  ctx.lineTo(padding.left + (visibleData.length - 1) * candleWidth + candleWidth / 2, yBottom);
  ctx.fill();
  ctx.strokeStyle = '#00f5c4';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  let first = true;
  visibleData.forEach((candle, idx) => {
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = y0 + chartHeight * (1 - (candle.Close - minPrice) / (maxPrice - minPrice));
    if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ─── Volume pane ──────────────────────────────────────────────
function drawVolumeSection(ctx, visibleData, width, height, candleWidth, spacing, padding, startY) {
  let maxVol = 0;
  visibleData.forEach(c => {
    maxVol = Math.max(maxVol, c.Volume || 0, c.volMA20 || 0);
  });
  if (maxVol === 0) maxVol = 1;

  // Right-axis drag-to-zoom (see paneVZoom in candlestick-data.js) — 0 is a
  // hard floor for volume, so zoom just shrinks the effective max (taller
  // bars); bars past the new max simply clip at the top like a real zoom-in.
  const volZoom = typeof paneVZoom !== 'undefined' ? (paneVZoom.volume || 1) : 1;
  maxVol = maxVol / volZoom;

  const chartHeight = height - 20;
  const isLightMode = document.documentElement.classList.contains('light-mode');
  const gridColor = isLightMode ? 'rgba(0,0,0,0.08)'  : 'rgba(255,255,255,0.05)';
  const textColor = isLightMode ? 'rgba(0,0,0,0.6)'   : 'rgba(160,174,192,0.6)';

  const fmtVol = v => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
    if (v >= 1_000)     return (v / 1_000).toFixed(0) + 'K';
    return Math.round(v).toString();
  };

  ctx.strokeStyle = gridColor;
  ctx.lineWidth   = 1;
  ctx.font        = _dwFont('9px "DM Sans", sans-serif');
  ctx.fillStyle   = textColor;
  ctx.textAlign   = 'left';  // Changed to 'left' for right-side display

  [0, 0.5, 1].forEach(frac => {
    const val = maxVol * frac;
    const y   = startY + chartHeight * (1 - frac);
    ctx.beginPath();
    ctx.moveTo(padding.left,          y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    // Draw volume label on RIGHT side
    ctx.fillText(fmtVol(val), width - padding.right + 10, y + 3);
  });

  ctx.fillStyle = isLightMode ? 'rgba(0,0,0,0.7)' : 'rgba(160,174,192,0.8)';
  ctx.font      = _dwFont('bold 10px "DM Sans", sans-serif');
  ctx.textAlign = 'right';  // Changed to 'right' for right-side display
  ctx.fillText('VOLUME', width - padding.right - 10, startY + 15);

  // Same gain/loss palette as the candles, at 70% — resolved once per
  // render rather than once per bar.
  const volUp = _dwAlpha(_dwGain('#10b981'), 0.7, 'rgba(16,185,129,0.7)');
  const volDn = _dwAlpha(_dwLoss('#ef4444'), 0.7, 'rgba(239,68,68,0.7)');

  visibleData.forEach((candle, idx) => {
    const x         = padding.left + (idx + 0.5) * candleWidth;
    const vol       = candle.Volume || 0;
    const isGain    = candle.Close >= candle.Open;
    const color     = isGain ? volUp : volDn;
    const barHeight = Math.min(chartHeight, (vol / maxVol) * chartHeight);
    ctx.fillStyle = color;
    ctx.fillRect(x - spacing / 2.5, startY + chartHeight - barHeight, spacing / 1.25, barHeight);
  });

  // ── Average volume line — rolling 20-period SMA of volume, tracking
  // over time (candle.volMA20, pre-computed in candlestick-data.js's
  // attachVolumeMA — needs bars before the visible window, same as any
  // other trailing moving average) ─────────────────────────────────
  const volMaColor = '#f5a623';
  const toY = v => startY + chartHeight - Math.min(chartHeight, (v / maxVol) * chartHeight);
  ctx.save();
  ctx.strokeStyle = volMaColor;
  ctx.lineWidth   = 1.5;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  let started = false;
  let lastX = null, lastY = null;
  visibleData.forEach((candle, idx) => {
    if (candle.volMA20 == null) { started = false; return; }
    const x = padding.left + (idx + 0.5) * candleWidth;
    const y = toY(candle.volMA20);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    lastX = x; lastY = y;
  });
  ctx.stroke();

  // Value tag at the line's rightmost (most recent) point
  if (lastY != null) {
    const label  = fmtVol(visibleData[visibleData.length - 1].volMA20);
    ctx.font     = _dwFont('bold 9px "DM Sans", sans-serif');
    const labelW = ctx.measureText(label).width + 10;
    ctx.fillStyle = volMaColor;
    ctx.fillRect(width - padding.right, lastY - 8, labelW, 16);
    ctx.fillStyle = '#1a1100';
    ctx.textAlign = 'center';
    ctx.fillText(label, width - padding.right + labelW / 2, lastY + 3);
  }
  ctx.restore();
}

// ─── Repaint on a display-settings change ─────────────────────
// shared/display-settings.js fires 'dse-display-applied' on document
// whenever the user saves (and on cross-tab storage sync). drawChart()
// is this chart's only render path, so re-running it is what makes the
// new palette / fonts appear without a reload.
if (window.DSEChartTheme) {
  window.DSEChartTheme.onChange(() => {
    if (document.getElementById('candleCanvas')) drawChart();
  });
}
