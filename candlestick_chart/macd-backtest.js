'use strict';

/* ════════════════════════════════════════════════════════════
   macd-backtest.js
   "MACD + 50 EMA" backtest side panel for candlestick.html —
   replays the strategy bar by bar over the symbol currently
   loaded and reports what a mechanical trader taking every
   signal would have made.

   ── The strategy ──────────────────────────────────────────
   Trend filter : 50-period EMA (configurable).
   Trigger      : MACD line crossing above its signal line,
                  using whatever MACD the chart is drawing
                  (default 12, 26, 9).

   ENTRY (long only — DSE retail has no short side)
     1. The crossover bar must CLOSE above the 50-EMA. A cross
        that fires below the EMA is counted and reported as
        rejected, not silently dropped.
     2. Buy at the NEXT bar's open. The cross is only known
        once its bar has closed, so filling on that bar itself
        would be look-ahead bias.

   RISK (set once, at entry)
     3. Stop-loss = the lowest low of the last N bars up to and
        including the crossover bar (N configurable, default 10).
     4. Risk = entry − stop. Target = entry + risk × R, with R
        configurable (default 2.0, the top of the 1.5–2 range).
     5. If the entry gaps to or below that stop, risk is zero or
        negative and there is no sane bracket — the signal is
        skipped and counted.

   EXIT — whichever of these comes first
     6. Low touches the stop  → out at the stop.
     7. High touches the target → out at the target.
     8. MACD crosses back below its signal → out at the NEXT
        bar's open.
     When one bar's range covers both stop and target, the stop
     is assumed to have hit first: daily bars don't record the
     intrabar path, and this is the same conservative convention
     routes/super-model-tracking.js already uses.

   Brokerage is charged on BOTH legs (default 0.4% a side), and
   the buy & hold benchmark pays it once each way so the
   comparison stays honest.

   Results are cached per symbol in localStorage so re-opening
   is instant; the panel shows when the cached run happened and
   re-runs on demand. A cache written under different settings
   is shown with a "stale" banner rather than silently presented
   as current.

   Entry points : window.openMACDBacktestModal(),
                  window.closeMACDBacktestModal()
   Depends on   : candlestick-data.js (chartData, aggregatedData,
                    currentTimeframe, urlCodeFallback),
                  indicators/ma.js (calculateEMA),
                  indicators/macd.js (macdParams)
   Consumed by  : candlestick.html (right-rail button + modal markup)
   ════════════════════════════════════════════════════════════ */

(function () {
  const MODAL_ID  = 'macdBtModal';
  const BODY_ID   = 'macdBtBody';
  // v1 = pure crossover in/out. v2 = added brokerage. v3 = EMA trend filter
  // plus stop/target bracket. Each bump changes what a stored trade MEANS, so
  // older caches are discarded rather than re-labelled.
  const STORE_VER = 3;
  const storeKey  = sym => `tv-macd-bt-${sym}`;

  // Strategy + cost settings. Properties of the trader and the broker rather
  // than of any one stock, so they are stored globally, not per symbol.
  const CFG_KEY = 'tv-macd-s1-config';
  const CFG_DEFAULT = {
    commissionPct: 0.4,  // charged on each side
    emaPeriod:     50,   // long-term trend filter
    stopLookback:  10,   // bars scanned back for the "recent low"
    targetR:       2,    // target = risk × R
  };
  const CFG_BOUNDS = {
    commissionPct: [0, 10],
    emaPeriod:     [2, 400],
    stopLookback:  [1, 200],
    targetR:       [0.1, 20],
  };

  function loadConfig() {
    const cfg = Object.assign({}, CFG_DEFAULT);
    try {
      const raw = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        Object.keys(CFG_DEFAULT).forEach(k => {
          const v = parseFloat(raw[k]);
          const [lo, hi] = CFG_BOUNDS[k];
          if (!isNaN(v) && v >= lo && v <= hi) cfg[k] = v;
        });
      } else {
        // Carry over the standalone commission value this panel used before
        // the other settings existed, so a customised rate isn't lost.
        const legacy = parseFloat(localStorage.getItem('tv-macd-bt-commission'));
        if (!isNaN(legacy) && legacy >= 0 && legacy <= 10) cfg.commissionPct = legacy;
        else if (window.DSESettings) cfg.commissionPct = window.DSESettings.commission();
      }
    } catch (e) {}
    return cfg;
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  let _result = null; // the run currently on screen

  // ─── Helpers ────────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function fmtBDT(v) {
    return (v == null || isNaN(v)) ? '—' : '৳' + v.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(v, dp) {
    if (v == null || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(dp == null ? 2 : dp) + '%';
  }
  function pnlCls(v) {
    return v == null || isNaN(v) ? '' : v > 0 ? 'mbt-pos' : v < 0 ? 'mbt-neg' : '';
  }
  function fmtWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function getCurrentCode() {
    if (typeof chartData !== 'undefined' && chartData.length && chartData[0].Symbol) return String(chartData[0].Symbol).toUpperCase();
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return null;
  }

  // The candles the chart is currently drawing. aggregatedData is kept in
  // step with the timeframe toggle (and equals chartData on daily), and
  // attachIndicators() has already written macdLine/signalLine onto it.
  function activeCandles() {
    if (typeof aggregatedData !== 'undefined' && aggregatedData && aggregatedData.length) return aggregatedData;
    if (typeof chartData !== 'undefined' && chartData && chartData.length) return chartData;
    return [];
  }

  function currentParams() {
    const p = (typeof macdParams !== 'undefined' && macdParams) ? macdParams : {};
    return {
      fast:   p.fastLength   || 12,
      slow:   p.slowLength   || 26,
      signal: p.signalLength || 9,
      source: p.source       || 'Close',
    };
  }

  function currentTf() {
    return (typeof currentTimeframe !== 'undefined' && currentTimeframe) ? currentTimeframe : 'daily';
  }

  const EXIT_LABEL = { target: 'Target', stop: 'Stop', macd: 'MACD', open: 'Open' };
  const EXIT_CLS   = { target: 'mbt-exit--target', stop: 'mbt-exit--stop', macd: 'mbt-exit--macd', open: 'mbt-exit--open' };

  // ─── The backtest ───────────────────────────────────────────
  function runBacktest() {
    const data   = activeCandles();
    const params = currentParams();
    const tf     = currentTf();
    const cfg    = loadConfig();

    // Brokerage on both legs: paid on top of what you spend buying, taken out
    // of what you receive selling. A trade must clear ~2× the rate to break even.
    const c = cfg.commissionPct / 100;
    const netPnl   = (entry, exit) => {
      const basis = entry * (1 + c), proceeds = exit * (1 - c);
      return ((proceeds - basis) / basis) * 100;
    };
    const grossPnl = (entry, exit) => ((exit - entry) / entry) * 100;

    // The EMA has to be warm too, not just the MACD — calculateEMA() seeds
    // from prices[0] rather than returning nulls, so early values of both are
    // seeding artifacts rather than real readings.
    const warmup = Math.max(params.slow + params.signal, cfg.emaPeriod);
    if (data.length <= warmup + 2) {
      return { error: `Not enough candles on this timeframe to backtest (need more than ${warmup + 2}, have ${data.length}).` };
    }
    if (data[warmup] && data[warmup].macdLine == null) {
      return { error: 'MACD values are not attached to the current candles yet. Let the chart finish loading and try again.' };
    }
    if (typeof calculateEMA !== 'function') {
      return { error: 'calculateEMA() is unavailable — indicators/ma.js did not load.' };
    }

    const ema = calculateEMA(data.map(x => x.Close), cfg.emaPeriod);

    const trades = [];
    let openTrade = null;
    let pendingSignal = null;           // a cross on the very last bar can't be filled yet
    const rejected = { trend: 0, badStop: 0 };

    const closeTrade = (t, exitPrice, exitDate, exitIdx, reason) => {
      const realisedR = t.risk > 0 ? (exitPrice - t.entryPrice) / t.risk : null;
      trades.push({
        entryDate:   t.entryDate,
        entryPrice:  t.entryPrice,
        stop:        t.stop,
        target:      t.target,
        exitDate,
        exitPrice,
        exitReason:  reason,
        bars:        exitIdx - t.entryIdx,
        pnlPct:      Math.round(netPnl(t.entryPrice, exitPrice) * 100) / 100,
        grossPnlPct: Math.round(grossPnl(t.entryPrice, exitPrice) * 100) / 100,
        r:           realisedR == null ? null : Math.round(realisedR * 100) / 100,
        open:        false,
      });
    };

    for (let i = warmup + 1; i < data.length; i++) {
      const prev = data[i - 1], cur = data[i];
      if (prev.macdLine == null || prev.signalLine == null || cur.macdLine == null || cur.signalLine == null) continue;

      const prevDiff = prev.macdLine - prev.signalLine;
      const curDiff  = cur.macdLine  - cur.signalLine;
      const bullish  = prevDiff <= 0 && curDiff > 0;
      const bearish  = prevDiff >= 0 && curDiff < 0;

      // ── Holding: look for a way out ──────────────────────────
      if (openTrade) {
        if (i < openTrade.entryIdx) continue; // entry fills at the open of entryIdx
        const bar = data[i];
        const stopHit   = bar.Low  <= openTrade.stop;
        const targetHit = bar.High >= openTrade.target;

        // Intrabar levels resolve during the session, before the close where a
        // MACD cross is confirmed — so they take precedence on the same bar.
        if (stopHit || targetHit) {
          closeTrade(openTrade,
            stopHit ? openTrade.stop : openTrade.target,
            bar.Date, i,
            stopHit ? 'stop' : 'target');
          openTrade = null;
          continue;
        }
        if (bearish) {
          const fillBar = data[i + 1];
          if (!fillBar) { pendingSignal = { kind: 'sell', date: cur.Date }; break; }
          closeTrade(openTrade, fillBar.Open || fillBar.Close, fillBar.Date, i + 1, 'macd');
          openTrade = null;
        }
        continue;
      }

      // ── Flat: look for an entry ──────────────────────────────
      if (!bullish) continue;

      // Rule 1 — the crossover bar must close above the 50-EMA.
      if (!(cur.Close > ema[i])) { rejected.trend++; continue; }

      const fillBar = data[i + 1];
      if (!fillBar) { pendingSignal = { kind: 'buy', date: cur.Date }; break; }
      const entryPrice = fillBar.Open || fillBar.Close;

      // Rule 3 — stop under the recent low.
      let recentLow = Infinity;
      for (let k = Math.max(0, i - cfg.stopLookback + 1); k <= i; k++) {
        if (data[k].Low > 0) recentLow = Math.min(recentLow, data[k].Low);
      }

      // Rule 5 — an entry at or below its own stop has no workable bracket.
      if (!isFinite(recentLow) || recentLow >= entryPrice) { rejected.badStop++; continue; }

      const risk = entryPrice - recentLow;
      openTrade = {
        entryDate:  fillBar.Date,
        entryPrice,
        entryIdx:   i + 1,
        stop:       recentLow,
        target:     entryPrice + risk * cfg.targetR,
        risk,
      };
    }

    // Still holding at the end of the data — shown, but kept out of the
    // realized stats so a running position can't flatter the win rate.
    let openPosition = null;
    if (openTrade) {
      const last = data[data.length - 1];
      openPosition = {
        entryDate:   openTrade.entryDate,
        entryPrice:  openTrade.entryPrice,
        stop:        openTrade.stop,
        target:      openTrade.target,
        exitDate:    last.Date,
        exitPrice:   last.Close,
        exitReason:  'open',
        bars:        (data.length - 1) - openTrade.entryIdx,
        // Marked as if closed at the last close, commission both legs included,
        // so it is comparable with the settled trades above it.
        pnlPct:      Math.round(netPnl(openTrade.entryPrice, last.Close) * 100) / 100,
        grossPnlPct: Math.round(grossPnl(openTrade.entryPrice, last.Close) * 100) / 100,
        r:           openTrade.risk > 0 ? Math.round(((last.Close - openTrade.entryPrice) / openTrade.risk) * 100) / 100 : null,
        open:        true,
      };
    }

    return {
      version:   STORE_VER,
      symbol:    getCurrentCode(),
      timeframe: tf,
      params,
      cfg,
      ranAt:     new Date().toISOString(),
      warmup,
      barsAnalyzed: data.length - warmup,
      firstDate: data[warmup].Date,
      lastDate:  data[data.length - 1].Date,
      trades,
      openPosition,
      pendingSignal,
      rejected,
      stats: computeStats(trades, data, warmup, c),
    };
  }

  function computeStats(trades, data, warmup, c) {
    const n = trades.length;
    const pnls = trades.map(t => t.pnlPct);
    const wins = pnls.filter(p => p > 0);
    const losses = pnls.filter(p => p < 0);
    const sum = arr => arr.reduce((a, b) => a + b, 0);

    // Compounded equity: ৳100 in, each trade re-investing the full balance.
    // Run twice — net and gross — so the panel can show what commission cost
    // over the whole run, the part that's easy to underestimate.
    let equity = 100, peak = 100, maxDD = 0, grossEquity = 100;
    const curve = [];
    trades.forEach(t => {
      equity *= (1 + t.pnlPct / 100);
      grossEquity *= (1 + (t.grossPnlPct != null ? t.grossPnlPct : t.pnlPct) / 100);
      peak = Math.max(peak, equity);
      maxDD = Math.min(maxDD, ((equity - peak) / peak) * 100);
      curve.push(Math.round(equity * 100) / 100);
    });

    const sorted = [...pnls].sort((a, b) => a - b);
    const grossWin = sum(wins);
    const grossLoss = Math.abs(sum(losses));
    const rs = trades.map(t => t.r).filter(v => v != null);

    // Same-period buy & hold, charged the same commission once each way —
    // charging the strategy but not the benchmark would tilt the comparison.
    const bhEntryBar = data[warmup + 1];
    const bhEntry = bhEntryBar ? (bhEntryBar.Open || bhEntryBar.Close) : null;
    const bhExit = data[data.length - 1].Close;
    const buyHoldPct = bhEntry
      ? Math.round((((bhExit * (1 - c)) - (bhEntry * (1 + c))) / (bhEntry * (1 + c))) * 100 * 100) / 100
      : null;

    const r2 = v => (v == null || isNaN(v) ? null : Math.round(v * 100) / 100);
    const countBy = k => trades.filter(t => t.exitReason === k).length;

    return {
      trades: n,
      wins: wins.length,
      losses: losses.length,
      hitTarget: countBy('target'),
      stopped: countBy('stop'),
      macdExit: countBy('macd'),
      winRate: n ? r2((wins.length / n) * 100) : null,
      avgPnl: n ? r2(sum(pnls) / n) : null,
      medianPnl: n ? r2(sorted[Math.floor(n / 2)]) : null,
      bestPnl: n ? r2(sorted[n - 1]) : null,
      worstPnl: n ? r2(sorted[0]) : null,
      avgWin: wins.length ? r2(sum(wins) / wins.length) : null,
      avgLoss: losses.length ? r2(sum(losses) / losses.length) : null,
      avgR: rs.length ? r2(sum(rs) / rs.length) : null,
      avgBars: n ? r2(sum(trades.map(t => t.bars)) / n) : null,
      // Left null rather than Infinity when nothing lost: JSON.stringify turns
      // Infinity into null, so a cached run would render differently from the
      // fresh one. The display derives "∞" from wins/losses instead.
      profitFactor: grossLoss > 0 ? r2(grossWin / grossLoss) : null,
      totalReturn: n ? r2(equity - 100) : null,
      grossReturn: n ? r2(grossEquity - 100) : null,
      commissionDrag: n ? r2((equity - 100) - (grossEquity - 100)) : null,
      finalEquity: n ? r2(equity) : null,
      maxDrawdown: n ? r2(maxDD) : null,
      equityCurve: curve,
      buyHoldPct,
    };
  }

  // ─── Persistence ────────────────────────────────────────────
  function loadStored(sym) {
    if (!sym) return null;
    try {
      const raw = localStorage.getItem(storeKey(sym));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORE_VER) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function save(result) {
    if (!result || !result.symbol || result.error) return;
    try { localStorage.setItem(storeKey(result.symbol), JSON.stringify(result)); } catch (e) {}
  }

  // A cached run made under different settings is not wrong, but it isn't what
  // the chart is showing either — say so rather than passing it off as current.
  function stalenessOf(result) {
    if (!result || result.error) return null;
    const p = currentParams(), tf = currentTf(), cfg = loadConfig();
    const bits = [];
    if (result.timeframe !== tf) bits.push(`timeframe <strong>${escapeHtml(result.timeframe)}</strong> (chart is on <strong>${escapeHtml(tf)}</strong>)`);
    const rp = result.params || {};
    if (rp.fast !== p.fast || rp.slow !== p.slow || rp.signal !== p.signal || rp.source !== p.source) {
      bits.push(`MACD <strong>${rp.fast},${rp.slow},${rp.signal}</strong> on ${escapeHtml(rp.source)} (chart is on <strong>${p.fast},${p.slow},${p.signal}</strong> on ${escapeHtml(p.source)})`);
    }
    const rc = result.cfg || {};
    const LBL = { commissionPct: 'commission %', emaPeriod: 'EMA period', stopLookback: 'stop lookback', targetR: 'target R' };
    Object.keys(CFG_DEFAULT).forEach(k => {
      if (rc[k] !== cfg[k]) bits.push(`${LBL[k]} <strong>${rc[k]}</strong> (now <strong>${cfg[k]}</strong>)`);
    });
    return bits.length ? bits : null;
  }

  // ─── Rendering ──────────────────────────────────────────────
  function statCell(label, value, cls, title) {
    return `<div class="mbt-stat"${title ? ` title="${escapeHtml(title)}"` : ''}>
      <span class="mbt-stat-label">${escapeHtml(label)}</span>
      <span class="mbt-stat-value ${cls || ''}">${value}</span>
    </div>`;
  }

  // Date over price in one cell — the panel is only 460px wide, and a
  // one-column-per-field layout pushed P&L (the point of the table) off-screen.
  function tradeRow(t, i, equityCurve) {
    const eq = t.open ? null : equityCurve[i];
    const bracket = `Stop ${fmtBDT(t.stop)} · Target ${fmtBDT(t.target)}`
      + (t.r != null ? ` · realised ${t.r > 0 ? '+' : ''}${t.r}R` : '')
      + ` · held ${t.bars} bar${t.bars === 1 ? '' : 's'}`;
    return `<tr class="${t.open ? 'mbt-row-open' : ''}" title="${escapeHtml(bracket)}">
      <td class="mbt-num mbt-idx">${t.open ? '—' : i + 1}</td>
      <td class="mbt-cell2">
        <span class="mbt-mono mbt-cell2-date">${escapeHtml(t.entryDate)}</span>
        <span class="mbt-mono mbt-cell2-price">${fmtBDT(t.entryPrice)}</span>
      </td>
      <td class="mbt-cell2">
        <span class="mbt-mono mbt-cell2-date">${t.open ? '—' : escapeHtml(t.exitDate)}</span>
        <span class="mbt-mono mbt-cell2-price">${fmtBDT(t.exitPrice)}</span>
      </td>
      <td><span class="mbt-exit ${EXIT_CLS[t.exitReason] || ''}">${EXIT_LABEL[t.exitReason] || '—'}</span></td>
      <td class="mbt-num mbt-mono ${pnlCls(t.pnlPct)}"${t.grossPnlPct != null
        ? ` title="${fmtPct(t.grossPnlPct)} before commission"` : ''}>${fmtPct(t.pnlPct)}</td>
      <td class="mbt-num mbt-mono mbt-bal">${eq == null ? '—' : eq.toFixed(2)}</td>
    </tr>`;
  }

  function numRow(id, label, value, step, min, max) {
    return `<div class="val-input-row">
      <label for="${id}">${escapeHtml(label)}</label>
      <input type="number" id="${id}" value="${value}" step="${step}" min="${min}" max="${max}" />
    </div>`;
  }

  function render() {
    const body = document.getElementById(BODY_ID);
    if (!body) return;

    if (!_result) {
      body.innerHTML = '<div class="val-warn">No chart data loaded yet.</div>';
      return;
    }

    const cfg = loadConfig();
    const settingsHtml = `
      <div class="mbt-settings">
        <div class="mbt-settings-hd">Strategy settings</div>
        <div class="val-inputs">
          ${numRow('mbt-ema',   'Trend filter — EMA period',      cfg.emaPeriod,     1,    2,   400)}
          ${numRow('mbt-look',  'Stop — recent low lookback (bars)', cfg.stopLookback, 1,    1,   200)}
          ${numRow('mbt-r',     'Target — risk multiple (R)',     cfg.targetR,       0.25, 0.1, 20)}
          ${numRow('mbt-fee',   'Broker commission (% per side)', cfg.commissionPct, 0.05, 0,   10)}
        </div>
      </div>`;

    if (_result.error) {
      body.innerHTML = `<div class="val-warn">${escapeHtml(_result.error)}</div>
        ${settingsHtml}
        <div class="mbt-actions"><button class="mbt-rerun" id="mbt-rerun">↻ Re-run backtest</button></div>`;
      wireActions();
      return;
    }

    const s = _result.stats;
    const p = _result.params;
    const rc = _result.cfg || CFG_DEFAULT;
    const stale = stalenessOf(_result);
    const allRows = [..._result.trades];
    if (_result.openPosition) allRows.push(_result.openPosition);
    const rej = _result.rejected || { trend: 0, badStop: 0 };

    const beatsBH = s.totalReturn != null && s.buyHoldPct != null ? s.totalReturn - s.buyHoldPct : null;

    body.innerHTML = `
      <div class="mbt-meta">
        <div class="mbt-meta-row">
          <span class="mbt-meta-sym">${escapeHtml(_result.symbol || '—')}</span>
          <span class="mbt-meta-tag">${escapeHtml(_result.timeframe)}</span>
          <span class="mbt-meta-tag">MACD ${p.fast},${p.slow},${p.signal}</span>
          <span class="mbt-meta-tag">EMA ${rc.emaPeriod}</span>
          <span class="mbt-meta-tag">${rc.targetR}R</span>
          <span class="mbt-meta-tag mbt-meta-tag--fee">${rc.commissionPct}% / side</span>
        </div>
        <div class="mbt-meta-sub">
          ${escapeHtml(_result.firstDate)} → ${escapeHtml(_result.lastDate)} · ${_result.barsAnalyzed} bars tested
          · last run ${escapeHtml(fmtWhen(_result.ranAt))}
        </div>
      </div>

      <div class="mbt-rules">
        <strong>Buy</strong> when MACD crosses above signal <em>and</em> the bar closes above the ${rc.emaPeriod}-EMA
        → fill at next open. <strong>Stop</strong> = lowest low of the last ${rc.stopLookback} bars.
        <strong>Target</strong> = ${rc.targetR}× that risk. <strong>Exit</strong> on stop, target, or a bearish MACD cross.
      </div>

      ${stale ? `<div class="mbt-stale">⚠ This saved run used ${stale.join(', ')}. Re-run to match.</div>` : ''}

      ${!allRows.length ? `<div class="val-warn">No signal passed every rule over this history.${
        rej.trend || rej.badStop ? ` ${rej.trend} crossover${rej.trend === 1 ? '' : 's'} were rejected by the EMA trend filter and ${rej.badStop} for having no workable stop.` : ''
      }</div>` : `
      <div class="mbt-headline ${pnlCls(s.totalReturn)}">
        <span class="mbt-headline-value">${fmtPct(s.totalReturn)}</span>
        <span class="mbt-headline-label">after commission, compounded over ${s.trades} completed trade${s.trades === 1 ? '' : 's'}
          — ৳100 would have become ৳${s.finalEquity == null ? '—' : s.finalEquity.toFixed(2)}</span>
      </div>

      <div class="mbt-fee">
        <span>Before commission</span>
        <span class="mbt-mono ${pnlCls(s.grossReturn)}">${fmtPct(s.grossReturn)}</span>
        <span class="mbt-fee-drag">${s.commissionDrag == null ? '' :
          `${rc.commissionPct}% × 2 per trade cost <strong class="mbt-neg">${fmtPct(s.commissionDrag)}</strong> over ${s.trades} round trip${s.trades === 1 ? '' : 's'}`}</span>
      </div>

      <div class="mbt-bh ${beatsBH == null ? '' : beatsBH > 0 ? 'mbt-bh-win' : 'mbt-bh-lose'}"
           title="Buy once at the first tradeable bar and sell at the end — one round trip of commission, not ${s.trades}.">
        <span>Buy &amp; hold, same period &amp; commission</span>
        <span class="mbt-mono ${pnlCls(s.buyHoldPct)}">${fmtPct(s.buyHoldPct)}</span>
        <span class="mbt-bh-verdict">${beatsBH == null ? '' :
          beatsBH > 0 ? `this strategy won by ${fmtPct(beatsBH)}` : `just holding won by ${fmtPct(-beatsBH)}`}</span>
      </div>

      <div class="mbt-stats">
        ${statCell('Trades', s.trades)}
        ${statCell('Win rate', s.winRate == null ? '—' : s.winRate.toFixed(1) + '%', pnlCls(s.winRate != null && s.winRate >= 50 ? 1 : -1))}
        ${statCell('Won / Lost', `${s.wins} / ${s.losses}`)}
        ${statCell('Hit target', s.hitTarget, 'mbt-pos', 'Exited because price reached the profit target.')}
        ${statCell('Stopped out', s.stopped, 'mbt-neg', 'Exited because price touched the stop-loss.')}
        ${statCell('MACD exit', s.macdExit, '', 'Exited on a bearish MACD cross before either bracket level was reached.')}
        ${statCell('Avg P&L', fmtPct(s.avgPnl), pnlCls(s.avgPnl))}
        ${statCell('Median P&L', fmtPct(s.medianPnl), pnlCls(s.medianPnl))}
        ${statCell('Avg R', s.avgR == null ? '—' : (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(2) + 'R', pnlCls(s.avgR),
          'Average realised reward-to-risk: how many multiples of the initial risk each trade returned, before commission.')}
        ${statCell('Best', fmtPct(s.bestPnl), 'mbt-pos')}
        ${statCell('Worst', fmtPct(s.worstPnl), 'mbt-neg')}
        ${statCell('Avg win', fmtPct(s.avgWin), 'mbt-pos')}
        ${statCell('Avg loss', fmtPct(s.avgLoss), 'mbt-neg')}
        ${statCell('Profit factor',
          s.profitFactor != null ? s.profitFactor.toFixed(2) : (s.losses === 0 && s.wins > 0 ? '∞' : '—'),
          s.profitFactor != null ? (s.profitFactor > 1 ? 'mbt-pos' : 'mbt-neg') : (s.losses === 0 && s.wins > 0 ? 'mbt-pos' : ''),
          'Gross profit divided by gross loss. Above 1 means the winners outweighed the losers.')}
        ${statCell('Max drawdown', s.maxDrawdown == null ? '—' : s.maxDrawdown.toFixed(2) + '%', 'mbt-neg',
          'Deepest fall of the compounded balance from a previous peak, measured trade by trade.')}
        ${statCell('Avg bars held', s.avgBars == null ? '—' : s.avgBars.toFixed(1))}
      </div>

      ${(rej.trend || rej.badStop) ? `<div class="mbt-rejected">
        Filtered out: <strong>${rej.trend}</strong> bullish cross${rej.trend === 1 ? '' : 'es'} closed below the
        ${rc.emaPeriod}-EMA${rej.badStop ? `, and <strong>${rej.badStop}</strong> opened at or below their own stop` : ''}.
      </div>` : ''}

      ${_result.pendingSignal ? `<div class="mbt-pending">
        A <strong>${_result.pendingSignal.kind === 'buy' ? 'bullish' : 'bearish'}</strong> cross printed on the final bar
        (${escapeHtml(_result.pendingSignal.date)}) — it has no next bar to fill against yet, so it is not counted above.
      </div>` : ''}

      <div class="mbt-table-wrap">
        <table class="mbt-table">
          <thead><tr>
            <th>#</th><th>Bought</th><th>Sold</th><th>Exit</th><th>P&amp;L</th><th title="Compounded balance after this trade, starting from ৳100">Bal.</th>
          </tr></thead>
          <tbody>${allRows.map((t, i) => tradeRow(t, i, s.equityCurve)).join('')}</tbody>
        </table>
      </div>
      `}

      ${settingsHtml}

      <div class="mbt-actions">
        <button class="mbt-rerun" id="mbt-rerun">↻ Re-run backtest</button>
        <span class="mbt-actions-note">Saved for this symbol — reopening shows this run instantly.</span>
      </div>

      <div class="val-disclaimer">⚠️ Entries fill at the <strong>next bar's open</strong> (the cross is only known once its bar
        has closed); stop and target fill at their exact levels with no allowance for a gap through them, and when one bar's range
        covers both, the <strong>stop is assumed to have hit first</strong> — daily bars don't record the intrabar path. The first
        ${_result.warmup} bars are discarded as MACD/EMA warm-up. Brokerage of <strong>${rc.commissionPct}% is charged on both the
        buy and the sell</strong> (~${(rc.commissionPct * 2).toFixed(2)}% per round trip), and buy &amp; hold is charged the same
        once each way. Tax and slippage are not modelled, and fills are assumed available at any size — real results would be worse.
        Past behaviour of a mechanical rule is not a forecast. Not financial advice.</div>
    `;
    wireActions();
  }

  function rerun() {
    _result = runBacktest();
    save(_result);
    render();
  }

  function wireActions() {
    const btn = document.getElementById('mbt-rerun');
    if (btn) {
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Running…';
        // Yield a frame so the button paints its disabled state before the
        // synchronous replay blocks the thread.
        setTimeout(rerun, 16);
      });
    }

    // Each setting re-runs on change, debounced: a value is typed a digit at a
    // time, and replaying on every keystroke would also blow away the input.
    let typing = null;
    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        const [lo, hi] = CFG_BOUNDS[key];
        if (isNaN(v) || v < lo || v > hi) return;
        clearTimeout(typing);
        typing = setTimeout(() => {
          const cfg = loadConfig();
          cfg[key] = v;
          saveConfig(cfg);
          rerun();
          // render() replaces the inputs, so focus has to be restored by id.
          // No setSelectionRange — it throws on type="number".
          const again = document.getElementById(id);
          if (again) again.focus();
        }, 450);
      });
    };
    bind('mbt-ema',  'emaPeriod');
    bind('mbt-look', 'stopLookback');
    bind('mbt-r',    'targetR');
    bind('mbt-fee',  'commissionPct');
  }

  // ─── Public entry points ────────────────────────────────────
  window.openMACDBacktestModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = 'flex';

    const sym = getCurrentCode();
    const cached = loadStored(sym);
    if (cached) {
      _result = cached;
      render();
      return;
    }
    // Nothing stored for this symbol — run it once, then keep it.
    const body = document.getElementById(BODY_ID);
    if (body) body.innerHTML = '<div class="val-loading">Replaying MACD + 50 EMA…</div>';
    setTimeout(rerun, 16);
  };

  window.closeMACDBacktestModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
  };
})();
