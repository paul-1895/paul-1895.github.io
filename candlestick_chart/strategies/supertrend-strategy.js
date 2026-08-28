/* ════════════════════════════════════════════════════════════
   strategies/supertrend-strategy.js
   Supertrend crossover strategy: BUY on the first candle to
   close above the Supertrend line, SELL on the first candle to
   close below it. Self-registers with strategy-engine.js.

   This reads candle.supertrendTrend, which indicators/supertrend.js
   attaches as part of computing the Supertrend line itself — this
   file only derives signals and trade P&L from it; it doesn't
   recompute the indicator.

   Depends on : strategies/strategy-engine.js (registerStrategy),
                indicators/supertrend.js (candle.supertrendTrend,
                  SUPERTREND_COLORS),
                candlestick-legend.js (_legendIndRow)
   ════════════════════════════════════════════════════════════ */

const SUPERTREND_STRATEGY_KEY = 'supertrend-crossover';

// ─── Signal derivation ─────────────────────────────────────────
// A signal fires on the first candle of a new trend run — i.e.
// the first candle to close above the line (trend flips -1 → 1
// = buy) or the first candle to close below it (flips 1 → -1 =
// sell). The seed row (the first valid trend value) never
// signals — there's no prior trend to flip from.
function deriveSupertrendStrategySignals(trend) {
  const signals = new Array(trend.length).fill(null);
  for (let i = 1; i < trend.length; i++) {
    if (trend[i] == null || trend[i - 1] == null) continue;
    if (trend[i] === 1 && trend[i - 1] === -1)      signals[i] = 'buy';
    else if (trend[i] === -1 && trend[i - 1] === 1) signals[i] = 'sell';
  }
  return signals;
}

function attachSupertrendStrategy(data) {
  const trend   = data.map(c => c.supertrendTrend);
  const signals = deriveSupertrendStrategySignals(trend);
  data.forEach((candle, i) => { candle.supertrendSignal = signals[i]; }); // 'buy' | 'sell' | null
}

// ─── Flat signal list (used by the trade pairer) ───────────────
function getSupertrendStrategySignals(data) {
  const out = [];
  data.forEach((candle, i) => {
    if (candle.supertrendSignal) {
      out.push({ index: i, type: candle.supertrendSignal, date: candle.Date, price: candle.Close });
    }
  });
  return out;
}

// ─── Trade pairing + P&L ────────────────────────────────────────
// Pairs each buy with the next sell into a completed trade,
// entering/exiting at that signal candle's Close (the same price
// the crossover itself is judged against). If the most recent
// signal is an unmatched buy, it's reported as an open position
// marked-to-last-close.
function computeSupertrendStrategyTrades(data) {
  const signals = getSupertrendStrategySignals(data);
  const trades  = [];
  let openBuy   = null;

  signals.forEach(sig => {
    if (sig.type === 'buy') {
      openBuy = sig;
    } else if (sig.type === 'sell' && openBuy) {
      const pnl = sig.price - openBuy.price;
      trades.push({
        entryDate: openBuy.date, entryPrice: openBuy.price,
        exitDate:  sig.date,     exitPrice:  sig.price,
        pnl, pnlPct: (pnl / openBuy.price) * 100,
        open: false,
      });
      openBuy = null;
    }
  });

  if (openBuy && data.length > 0) {
    const last = data[data.length - 1];
    const pnl  = last.Close - openBuy.price;
    trades.push({
      entryDate: openBuy.date, entryPrice: openBuy.price,
      exitDate:  null,         exitPrice:  last.Close,
      pnl, pnlPct: (pnl / openBuy.price) * 100,
      open: true,
    });
  }

  return trades;
}

// ─── Badge: width pinned to the candle's own width; text is rotated
// 90° so a multi-letter word can still fit inside that narrow column.
// direction 'up'   → tail points up at tipY, badge body sits below it
//                     (used for Buy, anchored under the candle's Low)
// direction 'down' → tail points down at tipY, badge body sits above it
//                     (used for Sell, anchored above the candle's High)
function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _drawSignalBadge(ctx, x, tipY, text, color, direction, candleWidth) {
  const padAlong = 4;   // padding above/below the rotated text, inside the box
  const tailW    = Math.min(8, candleWidth * 0.7);
  const tailH    = 5;
  const radius   = 3;
  // Font shrinks on narrow candles so the rotated glyphs still fit
  // within boxW, but never gets smaller than legible.
  const fontSize = Math.max(7, Math.min(11, candleWidth - 2));
  const fillColor = _hexToRgba(color, 0.05); // 95% transparent background

  ctx.font = `bold ${fontSize}px "DM Sans", sans-serif`;
  const textLen = ctx.measureText(text).width; // becomes the box's height once rotated

  const boxW = candleWidth;
  const boxH = textLen + padAlong * 2;

  const boxLeft = x - boxW / 2;
  const boxTop  = direction === 'up' ? tipY + tailH : tipY - tailH - boxH;

  // Rounded-rect badge body — near-transparent fill, thin solid border
  // so the pill shape still reads even though it barely tints what's
  // behind it.
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(boxLeft, boxTop, boxW, boxH, radius);
  } else {
    const r = radius;
    ctx.moveTo(boxLeft + r, boxTop);
    ctx.lineTo(boxLeft + boxW - r, boxTop);
    ctx.arcTo(boxLeft + boxW, boxTop, boxLeft + boxW, boxTop + r, r);
    ctx.lineTo(boxLeft + boxW, boxTop + boxH - r);
    ctx.arcTo(boxLeft + boxW, boxTop + boxH, boxLeft + boxW - r, boxTop + boxH, r);
    ctx.lineTo(boxLeft + r, boxTop + boxH);
    ctx.arcTo(boxLeft, boxTop + boxH, boxLeft, boxTop + boxH - r, r);
    ctx.lineTo(boxLeft, boxTop + r);
    ctx.arcTo(boxLeft, boxTop, boxLeft + r, boxTop, r);
    ctx.closePath();
  }
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Pointer tail connecting the badge to the signal candle
  ctx.beginPath();
  if (direction === 'up') {
    ctx.moveTo(x, tipY);
    ctx.lineTo(x - tailW / 2, boxTop);
    ctx.lineTo(x + tailW / 2, boxTop);
  } else {
    ctx.moveTo(x, tipY);
    ctx.lineTo(x - tailW / 2, boxTop + boxH);
    ctx.lineTo(x + tailW / 2, boxTop + boxH);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.stroke();

  // Label text, rotated 90° (reads bottom-to-top) so it fits the
  // narrow column instead of running sideways out of it.
  ctx.save();
  ctx.translate(x, boxTop + boxH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}

// ─── Compact fallback: plain triangle, used only when a candle is so
// narrow that even the rotated text wouldn't be legible. ───────────
function _drawSignalTriangle(ctx, x, tipY, color, direction) {
  const size = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (direction === 'up') {
    ctx.moveTo(x, tipY);
    ctx.lineTo(x - size, tipY + size);
    ctx.lineTo(x + size, tipY + size);
  } else {
    ctx.moveTo(x, tipY);
    ctx.lineTo(x - size, tipY - size);
    ctx.lineTo(x + size, tipY - size);
  }
  ctx.closePath();
  ctx.fill();
}

// ─── Markers: "Buy"/"Sell" badges, pointer-anchored to Low/High ────
// Drawn last by drawActiveStrategy() (called after candles render
// in drawPriceSection), so they're never tucked behind a candle body.
// Each badge's width is pinned to candleWidth, so it can never spill
// across neighboring candles regardless of zoom level. Only when a
// candle is too narrow for even the rotated text to stay legible
// does it fall back to a small triangle.
function drawSupertrendStrategySignals(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  const chartHeight = height - padding.top - padding.bottom;
  const y0  = padding.top;
  const toY = v => y0 + chartHeight * (1 - (v - minPrice) / (maxPrice - minPrice));

  const gap = 4;
  const useCompactMarker = candleWidth < 8;

  visibleData.forEach((candle, idx) => {
    if (!candle.supertrendSignal) return;
    const x = padding.left + (idx + 0.5) * candleWidth;
    const isBuy = candle.supertrendSignal === 'buy';
    const color = isBuy ? SUPERTREND_COLORS.up : SUPERTREND_COLORS.down;
    const tipY  = isBuy ? toY(candle.Low) + gap : toY(candle.High) - gap;

    if (useCompactMarker) {
      _drawSignalTriangle(ctx, x, tipY, color, isBuy ? 'up' : 'down');
    } else if (isBuy) {
      _drawSignalBadge(ctx, x, tipY, 'Buy', color, 'up', candleWidth);
    } else {
      _drawSignalBadge(ctx, x, tipY, 'Sell', color, 'down', candleWidth);
    }
  });
}

// ─── Legend tag on the signal candle itself ─────────────────────
function legendRowSupertrendStrategy(candle) {
  if (!candle.supertrendSignal) return '';
  const color = candle.supertrendSignal === 'buy' ? SUPERTREND_COLORS.up : SUPERTREND_COLORS.down;
  return _legendIndRow('Supertrend Strategy', [
    { val: candle.supertrendSignal.toUpperCase(), color },
  ]);
}

// ─── Self-register ───────────────────────────────────────────────
registerStrategy({
  key:           SUPERTREND_STRATEGY_KEY,
  label:         'Supertrend Crossover',
  attach:        attachSupertrendStrategy,
  draw:          drawSupertrendStrategySignals,
  legendRow:     legendRowSupertrendStrategy,
  computeTrades: computeSupertrendStrategyTrades,
});