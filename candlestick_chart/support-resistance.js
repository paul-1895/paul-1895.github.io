'use strict';

/* ════════════════════════════════════════════════════════════
   support-resistance.js
   "Support & Resistance" side panel for candlestick.html —
   automatically detects levels from the stock's own WEEKLY
   candles (reuses candlestick-data.js's aggregateCandlesByWeek()
   on the always-daily chartData, independent of whatever
   timeframe the main chart toggle is set to), via swing-point
   (fractal) detection + clustering, with an explicit minimum-gap
   filter so the final list never bunches two levels unreasonably
   close together.

   Method (disclosed in the panel, not asserted as precise):
     1. A weekly candle is a "swing high"/"swing low" if its
        High/Low is the most extreme point among itself and
        `lookback` candles on each side.
     2. Swing highs/lows within `clusterPct` of each other are
        merged into one zone — its price is the cluster's average,
        its "strength" is how many swings landed in it.
     3. Zones are ranked by strength (then recency) and greedily
        selected, skipping any candidate within `minGapPct` of an
        already-selected level — this is what keeps the final gaps
        reasonable, per the user's explicit requirement.
     4. Zones are classified Support/Resistance by whether they
        sit below or above the current price.

   Entry points : window.openSRModal(), window.closeSRModal()
   Depends on   : candlestick-data.js (chartData, aggregateCandlesByWeek,
                    urlCodeFallback)
   Consumed by  : candlestick.html (right-rail button + modal markup)
   ════════════════════════════════════════════════════════════ */

(function () {
  const MODAL_ID = 'srModal';
  const BODY_ID  = 'srBody';

  let _openId = 0;
  let _ctx    = null; // { code, price, support: [...], resistance: [...] }

  const state = {
    lookback:  2,   // candles on each side that must be less extreme, for a swing point
    clusterPct: 1.5, // % tolerance to merge nearby swing points into one zone
    minGapPct: 3,   // minimum % separation enforced between two FINAL levels
    maxLevels: 4,   // max support levels shown (same cap applied to resistance)
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function fmtBDT(v) {
    return (v == null || isNaN(v)) ? '—' : '৳' + v.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ─── Swing-point detection ──────────────────────────────────
  function findSwingPoints(weekly, lookback) {
    const highs = [], lows = [];
    for (let i = lookback; i < weekly.length - lookback; i++) {
      const c = weekly[i];
      let isHigh = true, isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (weekly[j].High >= c.High) isHigh = false;
        if (weekly[j].Low <= c.Low) isLow = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) highs.push({ price: c.High, date: c.Date });
      if (isLow) lows.push({ price: c.Low, date: c.Date });
    }
    return { highs, lows };
  }

  // ─── Cluster nearby swing points into zones ─────────────────
  function clusterPoints(points, tolerancePct) {
    const sorted = [...points].sort((a, b) => a.price - b.price);
    const clusters = [];
    for (const p of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(p.price - last.avgPrice) / last.avgPrice * 100 <= tolerancePct) {
        last.points.push(p);
        last.avgPrice = last.points.reduce((s, x) => s + x.price, 0) / last.points.length;
        last.touches = last.points.length;
        if (p.date > last.lastDate) last.lastDate = p.date;
      } else {
        clusters.push({ avgPrice: p.price, points: [p], touches: 1, lastDate: p.date });
      }
    }
    return clusters;
  }

  // ─── Greedy selection enforcing a minimum gap between levels ─
  function selectSpacedLevels(clusters, maxCount, minGapPct) {
    const ranked = [...clusters].sort((a, b) => b.touches - a.touches || (a.lastDate < b.lastDate ? 1 : -1));
    const selected = [];
    for (const c of ranked) {
      const tooClose = selected.some((s) => Math.abs(c.avgPrice - s.avgPrice) / s.avgPrice * 100 < minGapPct);
      if (!tooClose) selected.push(c);
      if (selected.length >= maxCount) break;
    }
    return selected;
  }

  function computeLevels(weekly, price) {
    if (!weekly || weekly.length < state.lookback * 2 + 3) {
      return { error: `Not enough weekly history yet (need at least ${state.lookback * 2 + 3} weeks, have ${weekly ? weekly.length : 0}).` };
    }
    const { highs, lows } = findSwingPoints(weekly, state.lookback);
    if (!highs.length && !lows.length) {
      return { error: 'No clear swing highs/lows found in the available weekly history.' };
    }

    const highClusters = clusterPoints(highs, state.clusterPct);
    const lowClusters   = clusterPoints(lows, state.clusterPct);

    const resistanceCandidates = highClusters.filter((c) => c.avgPrice > price);
    const supportCandidates    = lowClusters.filter((c) => c.avgPrice < price);

    const resistance = selectSpacedLevels(resistanceCandidates, state.maxLevels, state.minGapPct)
      .sort((a, b) => a.avgPrice - b.avgPrice); // nearest to price first when listed just above
    const support = selectSpacedLevels(supportCandidates, state.maxLevels, state.minGapPct)
      .sort((a, b) => b.avgPrice - a.avgPrice); // nearest to price first when listed just below

    return { support, resistance, weeksAnalyzed: weekly.length };
  }

  // ─── Data loading ──────────────────────────────────────────
  function getCurrentCode() {
    if (typeof chartData !== 'undefined' && chartData.length && chartData[0].Symbol) return String(chartData[0].Symbol).toUpperCase();
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return null;
  }

  function loadContext() {
    const code = getCurrentCode();
    if (!code || typeof chartData === 'undefined' || !chartData.length) return null;
    // A handful of scrape-gap days in the archive have High/Low/Open all 0
    // (only Close/YCP populated) — a Low of 0 would always win as "the
    // lowest low in any window", so left in, this stock would show a fake
    // ৳0 support level. Excluded here only, not from chartData itself, so
    // the actual price chart still renders those days' Close normally.
    const validCandles = chartData.filter(c => c.High > 0 && c.Low > 0);
    const weekly = (typeof aggregateCandlesByWeek === 'function') ? aggregateCandlesByWeek(validCandles) : null;
    const price = chartData[chartData.length - 1].Close;
    const result = computeLevels(weekly, price);
    return { code, price, weekly, ...result };
  }

  // ─── Rendering ───────────────────────────────────────────────
  function levelRow(level, price, kind) {
    const distPct = ((level.avgPrice - price) / price) * 100;
    return `
      <div class="sr-level-row sr-level-row--${kind}">
        <div class="sr-level-main">
          <span class="sr-level-price">${fmtBDT(level.avgPrice)}</span>
          <span class="sr-level-dist">${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}% from LTP</span>
        </div>
        <div class="sr-level-meta">
          <span class="sr-level-strength" title="Number of weekly swing points merged into this zone">${level.touches} touch${level.touches === 1 ? '' : 'es'}</span>
          <span class="sr-level-date">last ${escapeHtml(level.lastDate)}</span>
        </div>
      </div>`;
  }

  function render() {
    const body = document.getElementById(BODY_ID);
    if (!body || !_ctx) return;

    if (_ctx.error) {
      body.innerHTML = `<div class="val-warn">${escapeHtml(_ctx.error)}</div>`;
      return;
    }

    const resistanceHtml = _ctx.resistance.length
      ? _ctx.resistance.slice().reverse().map((l) => levelRow(l, _ctx.price, 'resistance')).join('')
      : '<div class="sr-empty">No resistance zone found above the current price within the available history.</div>';

    const supportHtml = _ctx.support.length
      ? _ctx.support.map((l) => levelRow(l, _ctx.price, 'support')).join('')
      : '<div class="sr-empty">No support zone found below the current price within the available history.</div>';

    body.innerHTML = `
      <div class="sr-price-strip">
        <span>Current price (LTP)</span>
        <span class="sr-price-value">${fmtBDT(_ctx.price)}</span>
      </div>

      <div class="sr-section">
        <div class="sr-section-hd sr-section-hd--resistance">🔴 Resistance (above price)</div>
        ${resistanceHtml}
      </div>

      <div class="sr-section">
        <div class="sr-section-hd sr-section-hd--support">🟢 Support (below price)</div>
        ${supportHtml}
      </div>

      <div class="sr-settings">
        <div class="sr-settings-hd">Detection settings</div>
        <div class="val-inputs">
          <div class="val-input-row"><label for="sr-mingap">Min gap between levels (%)</label><input type="number" id="sr-mingap" value="${state.minGapPct}" step="0.5" min="0.5" /></div>
          <div class="val-input-row"><label for="sr-maxlevels">Max levels per side</label><input type="number" id="sr-maxlevels" value="${state.maxLevels}" step="1" min="1" /></div>
          <div class="val-input-row"><label for="sr-lookback">Swing lookback (weeks)</label><input type="number" id="sr-lookback" value="${state.lookback}" step="1" min="1" /></div>
          <div class="val-input-row"><label for="sr-cluster">Cluster tolerance (%)</label><input type="number" id="sr-cluster" value="${state.clusterPct}" step="0.5" min="0.5" /></div>
        </div>
      </div>

      <div class="val-disclaimer">⚠️ Detected from ${_ctx.weeksAnalyzed} weeks of this stock's own price history — a swing-point/clustering heuristic, not a guarantee that price will react at these levels. "Touches" counts how many historical weekly swings fall inside each zone; higher generally means a more-tested level. Not financial advice.</div>
    `;
    wireInputs();
  }

  function wireInputs() {
    const bind = (id, key, isInt) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = isInt ? parseInt(el.value, 10) : parseFloat(el.value);
        if (!isNaN(v) && v > 0) {
          state[key] = v;
          recompute();
        }
      });
    };
    bind('sr-mingap', 'minGapPct');
    bind('sr-maxlevels', 'maxLevels', true);
    bind('sr-lookback', 'lookback', true);
    bind('sr-cluster', 'clusterPct');
  }

  function recompute() {
    if (!_ctx || !_ctx.weekly) return;
    const result = computeLevels(_ctx.weekly, _ctx.price);
    _ctx = { ..._ctx, ...result, error: result.error || null };
    render();
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT') active.focus();
  }

  function runSR() {
    const myId = ++_openId;
    const body = document.getElementById(BODY_ID);
    const ctx = loadContext();
    if (!ctx) {
      if (body) body.innerHTML = '<div class="val-warn">No chart data loaded yet.</div>';
      return;
    }
    if (_openId !== myId) return;
    _ctx = ctx;
    render();
  }

  // ─── Public entry points ────────────────────────────────────
  window.openSRModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = 'flex';
    runSR();
  };

  window.closeSRModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    _openId++;
  };
})();
