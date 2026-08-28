/* ════════════════════════════════════════════════════════════
   strategies/strategy-engine.js
   Generic strategy registry + the on/off toggle button and
   results table that sit below the chart. Strategy-specific
   logic (signal math, marker drawing, trade pairing) lives in
   its own file under strategies/ and self-registers here via
   registerStrategy(...) — this file knows nothing about any
   particular strategy, so adding a new one never requires
   touching this file.

   A strategy definition looks like:
     {
       key:    'supertrend-crossover',   // unique id
       label:  'Supertrend Crossover',   // button text
       description: 'Buy when...',       // (optional) plain-English
                                           // rule, shown as a button
                                           // tooltip and above the
                                           // results table
       attach(data)                      — writes signal fields
                                            onto every candle
       draw(ctx, visibleData, width, height,
            candleWidth, padding, minPrice, maxPrice)
                                          — draws markers on the
                                            price pane
       legendRow(candle)                 — (optional) extra
                                            legend HTML
       computeTrades(data)               — returns [{ entryDate,
                                            entryPrice, exitDate,
                                            exitPrice, pnl, pnlPct,
                                            open }]
     }

   Depends on : candlestick-data.js (global: chartData, aggregatedData),
                candlestick-draw.js (drawChart)
   Consumed by: candlestick-data.js (attachStrategies, called from
                  processChartData / changeTimeframe),
                candlestick-draw.js (drawActiveStrategy),
                candlestick-legend.js (legendRowsActiveStrategy),
                strategies/*.js (registerStrategy)
   ════════════════════════════════════════════════════════════ */

const STRATEGIES = {};       // key -> strategy definition
let activeStrategyKey = null;

// ─── Registration ──────────────────────────────────────────────
function registerStrategy(def) {
  STRATEGIES[def.key] = def;
}

// ─── Called from candlestick-data.js whenever a dataset is (re)built ──
function attachStrategies(data) {
  Object.values(STRATEGIES).forEach(s => s.attach(data));
}

// ─── Called from candlestick-draw.js's drawPriceSection ───────────────
function drawActiveStrategy(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice) {
  if (!activeStrategyKey) return;
  const strat = STRATEGIES[activeStrategyKey];
  if (strat) strat.draw(ctx, visibleData, width, height, candleWidth, padding, minPrice, maxPrice);
}

// ─── Called from candlestick-legend.js's renderChartLegend ────────────
function legendRowsActiveStrategy(candle) {
  if (!activeStrategyKey) return '';
  const strat = STRATEGIES[activeStrategyKey];
  return (strat && typeof strat.legendRow === 'function') ? strat.legendRow(candle) : '';
}

// ─── Toggle button ──────────────────────────────────────────────
function toggleStrategy(key) {
  activeStrategyKey = (activeStrategyKey === key) ? null : key;
  _updateStrategyButtonsUI();
  _updateStrategyTable();
  drawChart();
}

function renderStrategyButtons() {
  const container = document.getElementById('strategyButtons');
  if (!container) return;
  container.innerHTML = Object.values(STRATEGIES).map(s =>
    `<button class="strategy-btn" data-strategy-key="${s.key}" onclick="toggleStrategy('${s.key}')" title="${s.description || ''}">${s.label}</button>`
  ).join('');
  _updateStrategyButtonsUI();
}

function _updateStrategyButtonsUI() {
  document.querySelectorAll('.strategy-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.strategyKey === activeStrategyKey);
  });
}

// ─── Results table ──────────────────────────────────────────────
function _updateStrategyTable() {
  const wrap = document.getElementById('strategyTableWrap');
  if (!wrap) return;

  if (!activeStrategyKey) {
    wrap.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  const strat = STRATEGIES[activeStrategyKey];
  if (!strat) { wrap.style.display = 'none'; return; }

  // The table reports against the full history for the current
  // timeframe (not just the zoomed-in visible window) — it's a
  // performance report, not a viewport-dependent overlay.
  const dataset = aggregatedData.length > 0 ? aggregatedData : chartData;
  const trades  = strat.computeTrades(dataset);

  wrap.innerHTML      = _renderStrategyTable(strat.label, trades, strat.description);
  wrap.style.display  = 'block';
}

function _renderStrategyTable(label, trades, description) {
  const descHtml = description
    ? `<div class="strategy-table-description">${description}</div>`
    : '';

  if (trades.length === 0) {
    return `<div class="strategy-table-card">
      <div class="strategy-table-header"><span>${label}</span></div>
      ${descHtml}
      <div class="strategy-table-empty">No completed signals in this history yet.</div>
    </div>`;
  }

  let totalPnl = 0, wins = 0;
  const rows = trades.map((t, i) => {
    totalPnl += t.pnl;
    if (t.pnl >= 0) wins++;
    const pnlClass = t.pnl >= 0 ? 'gain' : 'loss';
    const sign     = t.pnl >= 0 ? '+' : '';
    return `<tr>
      <td>${i + 1}</td>
      <td>${t.entryDate}</td>
      <td>${t.entryPrice.toFixed(2)}</td>
      <td>${t.exitDate ? t.exitDate : '— (open)'}</td>
      <td>${t.exitPrice.toFixed(2)}</td>
      <td class="${pnlClass}">${sign}${t.pnl.toFixed(2)} (${sign}${t.pnlPct.toFixed(2)}%)</td>
    </tr>`;
  }).join('');

  const winRate    = ((wins / trades.length) * 100).toFixed(1);
  const totalClass = totalPnl >= 0 ? 'gain' : 'loss';
  const totalSign  = totalPnl >= 0 ? '+' : '';

  return `<div class="strategy-table-card">
    <div class="strategy-table-header">
      <span>${label}</span>
      <span class="strategy-table-summary">
        ${trades.length} trade${trades.length === 1 ? '' : 's'} ·
        ${winRate}% win rate ·
        <span class="${totalClass}">${totalSign}${totalPnl.toFixed(2)} total</span>
      </span>
    </div>
    ${descHtml}
    <table class="strategy-table">
      <thead>
        <tr><th>#</th><th>Buy Date</th><th>Buy Price</th><th>Sell Date</th><th>Sell Price</th><th>P/L</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ─── Render the toggle buttons once everything has self-registered ────
// Deferred to window 'load' (not run inline here) because this file
// loads *before* the individual strategy files that call
// registerStrategy() — by the time 'load' fires, every strategy
// module has already registered itself, regardless of file order.
window.addEventListener('load', () => {
  if (typeof renderStrategyButtons === 'function') renderStrategyButtons();
});