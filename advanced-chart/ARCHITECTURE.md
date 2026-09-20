# Advanced Chart — architecture contract

The Advanced Chart page is **feature-parity with `candlestick_chart/candlestick.html`,
rendered with TradingView Lightweight Charts v5 instead of a hand-rolled `<canvas>`.**

The whole design rests on one observation: almost nothing in the candlestick page is
actually coupled to the canvas. The data layer, the indicator math, the indicator
*instance* system, and every analysis panel talk to two globals — `chartData` and
`drawChart()` — plus one geometry bridge, `window._lastRender`. So this page **loads the
exact same module files** out of `../candlestick_chart/` and swaps out only the renderer:

```
candlestick.html : candlestick-data.js + indicators/* + panels …  +  candlestick-draw.js   (canvas)
advanced-chart   : candlestick-data.js + indicators/* + panels …  +  ac-render.js          (LWC v5)
```

**Do not fork or copy the shared modules.** If something in `../candlestick_chart/*.js`
does not work here, fix the adapter in `ac-*.js`, or (last resort) make a null-safe,
backwards-compatible change in the shared file — never a divergent copy.

## Load order (fixed — `advanced-chart.html` owns it)

```
lightweight-charts@5.2.1 standalone (CDN)
../color-picker/color-picker.js ← the Renko swatches and both settings modals open it
/shared/display-settings.js, /shared/session-guard.js, /shared/bank-logos.js, /shared/chart-theme.js
ac-theme-bridge.js              ← must run before any chart CSS reads a token
../candlestick_chart/candlestick-data.js       ← state + loader + timeframes (unmodified)
../candlestick_chart/indicators/*.js           ← indicator math (unmodified)
../candlestick_chart/strategies/*.js
../candlestick_chart/indicator-instances.js    ← INDICATOR_DEFS + instance store (unmodified)
../candlestick_chart/indicator-settings-modal.js, indicators/macd-settings-modal.js
ac-render.js                    ← THE RENDERER: defines drawChart(), ACChart, _lastRender
ac-ind-overlay.js               ← price-pane indicator instances → LWC series
ac-ind-subpane.js               ← oscillator sub-panes → LWC panes
../candlestick_chart/candlestick-legend.js     ← hover legend (unmodified)
ac-ui.js                        ← toolbar, menus, indicator modal, pane controls
ac-drawings.js                  ← overlay-canvas + pointer routing adapter
../candlestick_chart/tv-drawing-tools.js, tv-drawing-settings-modal.js   (unmodified)
../candlestick_chart/tv-trade-markers.js, sm-trade-overlay.js            (unmodified)
ac-replay.js, ac-range-bar.js
../candlestick_chart/stock-search.js, /shared/bank-rows.js, tv-sidebar.js
ac-sidebar.js                   ← sidebar/search glue + mobile sheet
../candlestick_chart/candlestick-analysis.js, valuation.js, support-resistance.js,
   macd-backtest.js, tv-seasonals.js, tv-seasonals-ui.js, tv-volatility.js  (unmodified)
ac-panels.js                    ← Analysis / Valuation / Support-Resistance wiring
ac-tools.js                     ← MACD backtest / Seasonals / Volatility wiring
ac-boot.js                      ← init sequence
```

`candlestick-data.js` declares the globals everything else reads (`chartData`,
`aggregatedData`, `currentTimeframe`, `chartType`, `enabledIndicators`, `paneOrder`,
`collapsedPanes`, `replayMode`, `replayIndex`, `renkoSettings`, `AVAILABLE_INDICATORS`,
`_loadPref`, `_savePref`, …). It has **no top-level DOM work**, so it is safe to load.
It calls `drawChart()`, `setupChartInteractions()`, `updateInfoCards()`,
`attachStrategies()` and `_updateStrategyTable()` — `ac-render.js`/`ac-ui.js` must define
all of those.

## `window.ACChart` — the renderer API (defined in `ac-render.js`)

Every `ac-*` module renders through this. It exists as soon as `ac-render.js` has run;
`ACChart.ready()` is `true` once the chart is created.

```js
ACChart.chart()                // the LWC IChartApi
ACChart.ready()                // bool
ACChart.container()            // the div the chart lives in

// ── Data ────────────────────────────────────────────────────────────────
ACChart.displayData()          // candles currently on screen-space (post timeframe,
                               //   post chart-type transform, post replay slice)
ACChart.toTime(candle, i)      // candle → LWC time for THIS render pass
ACChart.timeOfIndex(i)         // index into displayData → LWC time

// ── Keyed series cache (the ONLY way indicator modules create series) ───
// Same key returns the same series across renders: no flicker, no leaks.
// `type` is a string: 'line' | 'area' | 'histogram' | 'baseline' | 'candlestick' | 'bar'
ACChart.series(key, type, options, paneKey)   // → ISeriesApi, created or reused
ACChart.dropSeries(key)                       // explicit removal
ACChart.touch(key)                            // mark as still-in-use this render

// ── Panes ───────────────────────────────────────────────────────────────
// paneKey is 'price' | 'volume' | a sub-pane key ('macd','rsi','hm', or any
// GENERIC_SUBPANE_KEYS entry). Panes are reconciled once per drawChart() to
// match ['price','volume', ...activeSubPanes] in paneOrder sequence.
ACChart.paneIndex(paneKey)     // → number, or -1 if that pane is not open
ACChart.paneTop(paneKey)       // → y offset of the pane inside the container, CSS px
ACChart.paneHeight(paneKey)

// ── Overlay canvas (#candleCanvas — transparent, on top of the chart) ───
ACChart.overlay()              // the <canvas id="candleCanvas">
ACChart.overlayCtx()           // its 2D context, already DPR-scaled to CSS px
ACChart.repaintOverlay()       // clear + run every overlay painter
ACChart.addOverlayPainter(name, fn)   // fn(ctx, width, priceBottom) each repaint

// ── Render hooks ────────────────────────────────────────────────────────
// Registered painters run inside drawChart(), after the price/volume series
// are set and the panes are reconciled. Order: 'overlay-indicators',
// 'subpane-indicators', then anything else, alphabetically.
ACChart.addRenderHook(name, fn)       // fn() — use ACChart.series(...) inside
ACChart.removeRenderHook(name)
```

### Render pass

`drawChart()` (global, defined in `ac-render.js`) does, in order:

1. Build `displayData` — `aggregatedData || chartData`, then Heikin-Ashi / Renko
   transform if `chartType` says so, then the replay slice.
2. Reconcile panes to `['price','volume', ...paneOrder.filter(k => enabledIndicators.includes(k))]`.
3. Set price series (per `chartType`) and volume series.
4. `ACChart.beginRender()` → run render hooks → `ACChart.endRender()`
   (endRender removes every cached series that no hook touched).
5. Recompute `window._lastRender`.
6. `ACChart.repaintOverlay()`.
7. `renderChartLegend()`.

`drawChart()` is called constantly by the shared modules — it must be **cheap and
idempotent**. Never create a series outside `ACChart.series()`.

`_lastRender` is *also* recomputed (and the overlay repainted) on every pan/zoom, via
`timeScale().subscribeVisibleLogicalRangeChange` — without a full `drawChart()`.

## `window._lastRender` — the geometry bridge

Synthesised from the LWC time scale / price scale so that the unmodified
`tv-drawing-tools.js`, `tv-trade-markers.js`, `sm-trade-overlay.js` and
`candlestick-legend.js` keep working verbatim. Shape (identical to
`candlestick-draw.js:228`):

```js
window._lastRender = {
  visibleData,        // displayData.slice(startIdx, endIdx) — what's on screen now
  startIdx,           // first visible index into displayData
  displayData,
  candleWidth,        // px per bar  = logicalToCoordinate(i+1) - logicalToCoordinate(i)
  padding,            // { left, right, top, bottom } — left = x(startIdx) - candleWidth/2
  width, height,      // overlay canvas CSS size
  subPanes,           // [{ key, hKey, y, h, collapsed }] — for the pane-control overlay
  priceRange: { minPrice, maxPrice, paneHeight, paneY0 },
};
```

The consumers' mapping (do not change it — mirror it):

```js
index = startIdx + (px - padding.left) / candleWidth - 0.5
x     = padding.left + (index - startIdx + 0.5) * candleWidth
price = minPrice + (1 - (py - paneY0) / paneHeight) * (maxPrice - minPrice)
y     = paneY0 + paneHeight * (1 - (price - minPrice) / (maxPrice - minPrice))
```

`minPrice`/`maxPrice` come from `priceSeries.coordinateToPrice()` at the price pane's
bottom/top edge, so drawings track LWC's own auto-scaling exactly.

## Theme

`candlestick-chart.css` / `tv-layout.css` are dark-default and keyed on
`html.light-mode` / `html.dark-mode`, while the rest of the site uses `theme/theme.js`
with `html[data-theme]`. `ac-theme-bridge.js` keeps both in sync in both directions, so
the shared chart CSS works unchanged *and* a theme picked anywhere else on the site
carries over. Canvas-side colours go through `/shared/chart-theme.js`
(`window.DSEChartTheme`), same as the candlestick page.

## Ground rules for every agent

- **Never edit** `../candlestick_chart/**` except for a genuinely null-safe,
  backwards-compatible guard, and say so loudly in your report if you do.
- Only touch the files your task assigns you. Another agent owns every other file.
- No `git add`/`commit`/`checkout`/`stash` — the repo is shared with other agents.
- The page must work with `LightweightCharts` v5 API: `chart.addSeries(LightweightCharts.LineSeries, opts, paneIndex)`,
  `chart.addPane()`, `chart.panes()`, `LightweightCharts.createSeriesMarkers(series, markers)`.
  There is no `addLineSeries`/`series.setMarkers` in v5.
- Dev server: `DSE_AUTH_TRUST_LOCALHOST=true PORT=3111 node server.js`, then
  `http://localhost:3111/advanced-chart/advanced-chart.html?code=BPML`.
- Verify with `node --check <file>` at minimum; a headless Puppeteer console-error check
  is better (`puppeteer` is already a devDependency).
