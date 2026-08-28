'use strict';

/* ════════════════════════════════════════════════════════════
   candlestick-analysis.js
   Rule-based "Analysis" panel for candlestick.html — a single
   modal that reads out a plain-English technical + fundamental
   summary of the symbol currently on the chart. Every number
   shown is computed live from data already loaded elsewhere on
   this page (chartData/aggregatedData's own indicator fields) or
   fetched from this app's own real APIs (/api/company-details,
   /api/stocks, /api/sectors, /api/news). Nothing is invented:
   whenever there isn't enough history or data to say something,
   the relevant line is simply omitted rather than guessed.

   Sections:
     Trend / Momentum / Volatility / Volume / Last Candles
       — computed from aggregatedData (respects the chart's own
         D/W/M timeframe toggle), feed the overall verdict score.
     Minervini Trend Template
       — always evaluated on raw daily chartData (150/200-day SMA
         concepts don't make sense on a weekly/monthly chart).
         Feeds one consolidated signal into the verdict once a
         full 200+ day history is loaded.
     Sector Comparison, Fundamentals, Seasonality, Recent News
       — informational context pulled from this app's own APIs.
         Only "Relative Strength vs Sector" feeds the verdict;
         fundamentals/seasonality/news are shown as-is, not scored
         (different time horizon / nature of signal).

   Entry points : window.openAnalysisModal(), window.closeAnalysisModal()
   Depends on   : candlestick-data.js (chartData, aggregatedData,
                    urlCodeFallback), indicators/ma.js (calculateSMA),
                    tv-seasonals.js (computeSeasonalData,
                    computeSeasonalMonthStats)
   Consumed by  : candlestick.html (toolbar button + modal markup)
   ════════════════════════════════════════════════════════════ */

(function () {
  const MODAL_ID = 'analysisModal';
  const BODY_ID  = 'analysisBody';

  let _openId = 0;               // bumped on open/close/symbol-switch to drop stale async renders
  let _state  = null;

  // ─── Formatters ────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function numFrom(v) {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  function fmtPrice(v) {
    return (v == null || isNaN(v)) ? '—' : Number(v).toFixed(2);
  }
  function fmtPct(v) {
    return (v == null || isNaN(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function fmtCompact(n) {
    if (n == null || isNaN(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return Math.round(n).toString();
  }

  function mkSignal(category, label, verdict, detail, weight) {
    return { category, label, verdict, detail, weight: weight || 0 };
  }

  // ─── A. Trend ──────────────────────────────────────────────
  function analyzeTrend(data) {
    const out  = [];
    const last = data[data.length - 1];

    if (last.sma20 != null) {
      const up = last.Close > last.sma20;
      out.push(mkSignal('trend', 'Price vs SMA20', up ? 'bullish' : 'bearish',
        `Close ${fmtPrice(last.Close)} is ${up ? 'above' : 'below'} the 20-period average (${fmtPrice(last.sma20)})`, 1));
    }
    if (last.sma50 != null) {
      const up = last.Close > last.sma50;
      out.push(mkSignal('trend', 'Price vs SMA50', up ? 'bullish' : 'bearish',
        `Close ${fmtPrice(last.Close)} is ${up ? 'above' : 'below'} the 50-period average (${fmtPrice(last.sma50)})`, 1));
    }
    if (last.sma200 != null) {
      const up = last.Close > last.sma200;
      out.push(mkSignal('trend', 'Price vs SMA200', up ? 'bullish' : 'bearish',
        `Close ${fmtPrice(last.Close)} is ${up ? 'above' : 'below'} the 200-period average (${fmtPrice(last.sma200)})`, 1.5));
    }
    if (last.sma20 != null && last.sma50 != null) {
      const up = last.sma20 > last.sma50;
      out.push(mkSignal('trend', 'Short vs long-term average', up ? 'bullish' : 'bearish',
        `20-period average (${fmtPrice(last.sma20)}) is ${up ? 'above' : 'below'} the 50-period average (${fmtPrice(last.sma50)})`, 1));
    }
    if (last.macdLine != null && last.signalLine != null) {
      const up = last.macdLine > last.signalLine;
      out.push(mkSignal('trend', 'MACD vs Signal Line', up ? 'bullish' : 'bearish',
        `MACD (${last.macdLine.toFixed(3)}) is ${up ? 'above' : 'below'} its signal line (${last.signalLine.toFixed(3)})`, 1.5));
    }
    if (last.supertrendTrend != null && last.supertrend != null) {
      const up = last.supertrendTrend === 1;
      out.push(mkSignal('trend', 'Supertrend', up ? 'bullish' : 'bearish',
        `Supertrend is in a${up ? 'n' : ''} ${up ? 'up' : 'down'}trend, currently acting as ${up ? 'support' : 'resistance'} at ${fmtPrice(last.supertrend)}`, 1.5));
    }
    return out;
  }

  // ─── B. Momentum ───────────────────────────────────────────
  function analyzeMomentum(data) {
    const out  = [];
    const last = data[data.length - 1];

    if (last.rsi != null) {
      const r = last.rsi;
      if (r < 30) {
        out.push(mkSignal('momentum', 'RSI(14)', 'bullish', `RSI at ${r.toFixed(1)} is in oversold territory (<30) — often precedes a bounce`, 1));
      } else if (r > 70) {
        out.push(mkSignal('momentum', 'RSI(14)', 'bearish', `RSI at ${r.toFixed(1)} is in overbought territory (>70) — often precedes a pullback`, 1));
      } else if (r >= 55) {
        out.push(mkSignal('momentum', 'RSI(14)', 'bullish', `RSI at ${r.toFixed(1)} is above the neutral 50 midline — positive momentum`, 0.5));
      } else if (r <= 45) {
        out.push(mkSignal('momentum', 'RSI(14)', 'bearish', `RSI at ${r.toFixed(1)} is below the neutral 50 midline — negative momentum`, 0.5));
      } else {
        out.push(mkSignal('momentum', 'RSI(14)', 'neutral', `RSI at ${r.toFixed(1)} is near the neutral 50 midline`, 0.5));
      }
    }

    const hist = data.slice(-4).map(c => c.histogram).filter(v => v != null);
    if (hist.length >= 3) {
      const n = hist.length;
      const rising  = hist[n - 1] > hist[n - 2] && hist[n - 2] > hist[n - 3];
      const falling = hist[n - 1] < hist[n - 2] && hist[n - 2] < hist[n - 3];
      if (rising) {
        out.push(mkSignal('momentum', 'MACD Histogram', 'bullish', 'MACD histogram has risen for 3 straight bars — bullish momentum building', 0.75));
      } else if (falling) {
        out.push(mkSignal('momentum', 'MACD Histogram', 'bearish', 'MACD histogram has fallen for 3 straight bars — bearish momentum building', 0.75));
      } else {
        out.push(mkSignal('momentum', 'MACD Histogram', 'neutral', 'MACD histogram momentum is mixed over the last few bars', 0));
      }
    }
    return out;
  }

  // ─── C. Volatility ─────────────────────────────────────────
  function analyzeVolatility(data) {
    const out  = [];
    const last = data[data.length - 1];

    const withBB = data.filter(c => c.bbUpper != null && c.bbLower != null && c.bbMiddle);
    if (withBB.length >= 20) {
      const last20   = withBB.slice(-20);
      const widths   = last20.map(c => (c.bbUpper - c.bbLower) / c.bbMiddle);
      const avgWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
      const curWidth = widths[widths.length - 1];
      const ratio    = avgWidth > 0 ? curWidth / avgWidth : 1;
      if (ratio <= 0.7) {
        out.push(mkSignal('volatility', 'Bollinger Band Width', 'neutral',
          `Band width is ${(ratio * 100).toFixed(0)}% of its 20-bar average — a volatility squeeze, which often precedes a sharp move`, 0));
      } else if (ratio >= 1.3) {
        out.push(mkSignal('volatility', 'Bollinger Band Width', 'neutral',
          `Band width is ${(ratio * 100).toFixed(0)}% of its 20-bar average — volatility is currently expanding`, 0));
      }
    }

    if (last.bbUpper != null && last.bbLower != null) {
      if (last.Close > last.bbUpper) {
        out.push(mkSignal('volatility', 'Price vs Bollinger Bands', 'bearish',
          `Price ${fmtPrice(last.Close)} is trading above the upper band (${fmtPrice(last.bbUpper)}) — potentially overextended`, 0.5));
      } else if (last.Close < last.bbLower) {
        out.push(mkSignal('volatility', 'Price vs Bollinger Bands', 'bullish',
          `Price ${fmtPrice(last.Close)} is trading below the lower band (${fmtPrice(last.bbLower)}) — potentially oversold`, 0.5));
      } else {
        const range = last.bbUpper - last.bbLower;
        const pos   = range > 0 ? ((last.Close - last.bbLower) / range) * 100 : 50;
        out.push(mkSignal('volatility', 'Price vs Bollinger Bands', 'neutral',
          `Price is trading within its bands, ${pos.toFixed(0)}% of the way from the lower to the upper band`, 0));
      }
    }
    return out;
  }

  // ─── D. Volume ─────────────────────────────────────────────
  function analyzeVolume(data) {
    const out  = [];
    const last = data[data.length - 1];
    const n    = data.length;

    const priorWindow = data.slice(Math.max(0, n - 21), n - 1);
    if (priorWindow.length >= 10 && last.Volume != null) {
      const avgVol = priorWindow.reduce((a, c) => a + (c.Volume || 0), 0) / priorWindow.length;
      const ratio  = avgVol > 0 ? last.Volume / avgVol : null;
      if (ratio != null) {
        const dayUp = last.Close >= last.Open;
        if (ratio >= 1.5) {
          out.push(mkSignal('volume', 'Volume vs 20-bar Average', dayUp ? 'bullish' : 'bearish',
            `Volume ${fmtCompact(last.Volume)} is ${ratio.toFixed(1)}x the recent average (${fmtCompact(avgVol)}) on a${dayUp ? 'n up' : ' down'} candle — strong ${dayUp ? 'buying' : 'selling'} conviction`, 1));
        } else if (ratio <= 0.5) {
          out.push(mkSignal('volume', 'Volume vs 20-bar Average', 'neutral',
            `Volume ${fmtCompact(last.Volume)} is unusually light (${ratio.toFixed(1)}x average) — low conviction move`, 0));
        } else {
          out.push(mkSignal('volume', 'Volume vs 20-bar Average', 'neutral',
            `Volume ${fmtCompact(last.Volume)} is roughly in line with its recent average (${fmtCompact(avgVol)})`, 0));
        }
      }
    }

    if (n >= 6) {
      const recent3 = data.slice(-3).reduce((a, c) => a + (c.Volume || 0), 0) / 3;
      const prior3  = data.slice(-6, -3).reduce((a, c) => a + (c.Volume || 0), 0) / 3;
      if (prior3 > 0) {
        const chg = (recent3 / prior3 - 1) * 100;
        out.push(mkSignal('volume', '3-Day Volume Trend', 'neutral',
          `3-day average volume is ${chg >= 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(0)}% vs the previous 3 days`, 0));
      }
    }
    return out;
  }

  // ─── E. Last-candle patterns ───────────────────────────────
  function analyzePatterns(data) {
    const out = [];
    const n   = data.length;
    const body  = c => Math.abs(c.Close - c.Open);
    const range = c => c.High - c.Low;

    if (n >= 2) {
      const prev = data[n - 2], cur = data[n - 1];
      const prevGreen = prev.Close > prev.Open, prevRed = prev.Close < prev.Open;
      const curGreen  = cur.Close  > cur.Open,  curRed  = cur.Close  < cur.Open;

      if (prevRed && curGreen && cur.Open <= prev.Close && cur.Close >= prev.Open) {
        out.push(mkSignal('patterns', 'Bullish Engulfing', 'bullish',
          'Latest candle fully engulfs the prior red candle — a classic bullish reversal pattern', 1.5));
      } else if (prevGreen && curRed && cur.Open >= prev.Close && cur.Close <= prev.Open) {
        out.push(mkSignal('patterns', 'Bearish Engulfing', 'bearish',
          'Latest candle fully engulfs the prior green candle — a classic bearish reversal pattern', 1.5));
      }

      if (prev.Close > 0) {
        const gapPct = (cur.Open / prev.Close - 1) * 100;
        if (Math.abs(gapPct) >= 1) {
          out.push(mkSignal('patterns', 'Opening Gap', gapPct > 0 ? 'bullish' : 'bearish',
            `Opened ${gapPct >= 0 ? 'up' : 'down'} ${Math.abs(gapPct).toFixed(1)}% from the prior close`, 0.5));
        }
      }
    }

    const last = data[n - 1];
    const bodySz = body(last), rangeSz = range(last);
    if (rangeSz > 0) {
      if (bodySz / rangeSz < 0.1) {
        out.push(mkSignal('patterns', 'Doji', 'neutral', 'Latest candle is a doji (open ≈ close) — signals indecision', 0));
      } else {
        const upperWick = last.High - Math.max(last.Open, last.Close);
        const lowerWick = Math.min(last.Open, last.Close) - last.Low;
        const trendCtx  = n >= 6 ? last.Close - data[n - 6].Close : 0;

        if (lowerWick >= bodySz * 2 && upperWick <= bodySz * 0.5) {
          if (trendCtx < 0) {
            out.push(mkSignal('patterns', 'Hammer', 'bullish',
              'Long lower wick with a small body near the top, after a decline — a hammer, often a bullish reversal signal', 1));
          } else {
            out.push(mkSignal('patterns', 'Long Lower Wick', 'neutral',
              'Small body with a long lower wick, but not preceded by a decline — not read as a hammer reversal', 0));
          }
        } else if (upperWick >= bodySz * 2 && lowerWick <= bodySz * 0.5) {
          if (trendCtx > 0) {
            out.push(mkSignal('patterns', 'Shooting Star', 'bearish',
              'Long upper wick with a small body near the bottom, after a rally — a shooting star, often a bearish reversal signal', 1));
          } else {
            out.push(mkSignal('patterns', 'Long Upper Wick', 'neutral',
              'Small body with a long upper wick, but not preceded by a rally — not read as a shooting star reversal', 0));
          }
        }
      }
    }

    if (n >= 4) {
      const c1 = data[n - 3], c2 = data[n - 2], c3 = data[n - 1];
      if (c3.Close > c2.Close && c2.Close > c1.Close) {
        out.push(mkSignal('patterns', '3 Consecutive Closes', 'bullish', '3 consecutive higher closes in a row', 0.5));
      } else if (c3.Close < c2.Close && c2.Close < c1.Close) {
        out.push(mkSignal('patterns', '3 Consecutive Closes', 'bearish', '3 consecutive lower closes in a row', 0.5));
      }
    }

    if (n >= 5) {
      const last5 = data.slice(-5);
      const highs = last5.map(c => c.High), lows = last5.map(c => c.Low);
      const higherHighs = highs.every((h, i) => i === 0 || h >= highs[i - 1]);
      const higherLows  = lows.every((l, i) => i === 0 || l >= lows[i - 1]);
      const lowerHighs  = highs.every((h, i) => i === 0 || h <= highs[i - 1]);
      const lowerLows   = lows.every((l, i) => i === 0 || l <= lows[i - 1]);
      if (higherHighs && higherLows) {
        out.push(mkSignal('patterns', '5-Candle Structure', 'bullish', 'Higher highs and higher lows over the last 5 candles — clean uptrend structure', 0.75));
      } else if (lowerHighs && lowerLows) {
        out.push(mkSignal('patterns', '5-Candle Structure', 'bearish', 'Lower highs and lower lows over the last 5 candles — clean downtrend structure', 0.75));
      }
    }
    return out;
  }

  function computeTechnical(data) {
    if (!data || data.length < 5) {
      return { trend: [], momentum: [], volatility: [], volume: [], patterns: [], insufficientData: true };
    }
    return {
      trend:      analyzeTrend(data),
      momentum:   analyzeMomentum(data),
      volatility: analyzeVolatility(data),
      volume:     analyzeVolume(data),
      patterns:   analyzePatterns(data),
    };
  }

  // ─── F. Minervini Trend Template (always daily) ────────────
  function pctChangeOver(data, days) {
    const n = data.length;
    if (n <= days) return null;
    const now  = data[n - 1].Close;
    const past = data[n - 1 - days].Close;
    return past > 0 ? (now / past - 1) * 100 : null;
  }

  function computeMinervini(data) {
    if (!data || data.length < 30 || typeof calculateSMA !== 'function') return null;

    const closes = data.map(c => c.Close);
    const sma50Series  = calculateSMA(closes, 50);
    const sma150Series = calculateSMA(closes, 150);
    const sma200Series = calculateSMA(closes, 200);
    const i = data.length - 1;
    const price  = data[i].Close;
    const sma50  = sma50Series[i], sma150 = sma150Series[i], sma200 = sma200Series[i];
    const has50 = sma50 != null, has150 = sma150 != null, has200 = sma200 != null;

    const lookback   = Math.min(data.length, 252);
    const windowData = data.slice(data.length - lookback);
    const high52 = Math.max(...windowData.map(c => c.High));
    const low52  = Math.min(...windowData.map(c => c.Low));

    const criteria = [];
    const crit = (label, pass, detail) => criteria.push({ label, pass, detail });

    crit('Price above 150-day & 200-day SMA',
      has150 && has200 ? (price > sma150 && price > sma200) : null,
      has150 && has200
        ? `Price ${fmtPrice(price)} is ${(price > sma150 && price > sma200) ? 'above' : 'not above'} both the 150-day (${fmtPrice(sma150)}) and 200-day (${fmtPrice(sma200)}) averages`
        : 'Needs 200+ days of price history — not enough loaded yet');

    crit('150-day SMA above 200-day SMA',
      has150 && has200 ? sma150 > sma200 : null,
      has150 && has200
        ? `150-day average (${fmtPrice(sma150)}) is ${sma150 > sma200 ? 'above' : 'below'} the 200-day average (${fmtPrice(sma200)})`
        : 'Needs 200+ days of price history');

    let trend200Up = null, trend200Detail;
    if (has200 && i - 21 >= 0 && sma200Series[i - 21] != null) {
      trend200Up = sma200 > sma200Series[i - 21];
      trend200Detail = `200-day average has ${trend200Up ? 'risen' : 'not risen'} over the last month (${fmtPrice(sma200Series[i - 21])} → ${fmtPrice(sma200)})`;
    } else {
      trend200Detail = 'Needs ~220 days of price history';
    }
    crit('200-day SMA trending up (≥1 month)', trend200Up, trend200Detail);

    crit('50-day SMA above 150-day & 200-day SMA',
      has50 && has150 && has200 ? (sma50 > sma150 && sma50 > sma200) : null,
      has50 && has150 && has200
        ? `50-day average (${fmtPrice(sma50)}) is ${(sma50 > sma150 && sma50 > sma200) ? 'above' : 'not above'} both the 150-day and 200-day averages`
        : 'Needs 200+ days of price history');

    crit('Price above 50-day SMA',
      has50 ? price > sma50 : null,
      has50 ? `Price ${fmtPrice(price)} is ${price > sma50 ? 'above' : 'below'} the 50-day average (${fmtPrice(sma50)})` : 'Needs 50+ days of price history');

    const pctAboveLow = low52 > 0 ? ((price / low52) - 1) * 100 : null;
    crit('At least 25% above 52-week low',
      pctAboveLow != null ? pctAboveLow >= 25 : null,
      pctAboveLow != null ? `Price is ${pctAboveLow.toFixed(1)}% above its ${lookback}-day low of ${fmtPrice(low52)}` : 'No price history available');

    const pctBelowHigh = high52 > 0 ? ((high52 - price) / high52) * 100 : null;
    crit('Within 25% of 52-week high',
      pctBelowHigh != null ? pctBelowHigh <= 25 : null,
      pctBelowHigh != null ? `Price is ${pctBelowHigh.toFixed(1)}% below its ${lookback}-day high of ${fmtPrice(high52)}` : 'No price history available');

    const applicable = criteria.filter(c => c.pass !== null).length;
    const passed     = criteria.filter(c => c.pass === true).length;

    let signal = null;
    if (applicable === criteria.length) {
      const verdict = passed === criteria.length ? 'bullish' : (passed <= 3 ? 'bearish' : 'neutral');
      signal = mkSignal('minervini', 'Minervini Trend Template', verdict,
        `Meets ${passed}/${criteria.length} criteria for a Minervini Stage 2 uptrend`, 1.5);
    }

    return {
      criteria, passed, applicable, total: criteria.length, lookback,
      perf3m:  pctChangeOver(data, 63),
      perf6m:  pctChangeOver(data, 126),
      perf12m: pctChangeOver(data, 252),
      rsNote: 'IBD-style Relative Strength Rating requires ranking this stock’s price performance against every other DSE-listed stock over the trailing year — not computed here (would need each stock’s full historical series). Trailing performance for this stock alone is shown instead.',
      signal,
    };
  }

  // ─── G. Seasonality (from real daily chartData) ────────────
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function computeSeasonality() {
    if (typeof computeSeasonalData !== 'function' || typeof chartData === 'undefined' || !chartData.length) {
      return { available: false };
    }
    const seasonal = computeSeasonalData(chartData);
    if (!seasonal.years.length) return { available: false };
    const statsAll = computeSeasonalMonthStats(seasonal.monthsMatrix, seasonal.years, 'pct');
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const cur = statsAll[curMonth];

    let best = null, worst = null;
    for (let m = 1; m <= 12; m++) {
      const s = statsAll[m];
      if (s.count >= 2 && s.mean != null) {
        if (!best  || s.mean > best.mean)  best  = { month: m, ...s };
        if (!worst || s.mean < worst.mean) worst = { month: m, ...s };
      }
    }
    return {
      available: true,
      monthName: MONTH_NAMES[curMonth - 1],
      cur,
      best:  best  ? { ...best,  name: MONTH_NAMES[best.month - 1] }  : null,
      worst: worst ? { ...worst, name: MONTH_NAMES[worst.month - 1] } : null,
      yearsOfData: seasonal.years.length,
    };
  }

  // ─── H. Fundamentals / Sector / News (async, from app APIs) ─
  function getCurrentCode() {
    if (typeof chartData !== 'undefined' && chartData.length && chartData[0].Symbol) return String(chartData[0].Symbol).toUpperCase();
    if (typeof urlCodeFallback === 'function') return urlCodeFallback();
    return null;
  }

  async function fetchFundamentals(code) {
    try {
      const res = await fetch(`/api/company-details/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: 'ready', data: await res.json() };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  async function fetchSector(code) {
    try {
      const [stocksData, sectorByCode, namesData] = await Promise.all([
        fetch('/api/stocks').then(r => r.json()).catch(() => ({ stocks: [] })),
        fetch('/api/sectors').then(r => r.json()).catch(() => ({})),
        fetch('/api/company-names').then(r => r.json()).catch(() => ({ names: {} })),
      ]);
      const stocks    = stocksData.stocks || [];
      const nameByCode = namesData.names || {};
      const sector = sectorByCode[code];
      if (!sector) return { status: 'ready', sector: null };

      const peers = stocks
        .map(s => {
          const c = String(s.code).toUpperCase();
          return { code: c, name: nameByCode[c] || c, pct: s.ycp ? (s.change / s.ycp) * 100 : null, isCurrent: c === code };
        })
        .filter(p => sectorByCode[p.code] === sector && p.pct != null)
        .sort((a, b) => b.pct - a.pct);

      const rank    = peers.findIndex(p => p.isCurrent) + 1;
      const avg     = peers.length ? peers.reduce((a, p) => a + p.pct, 0) / peers.length : null;
      const current = peers.find(p => p.isCurrent);

      let signal = null;
      if (current != null && avg != null) {
        const diff = current.pct - avg;
        signal = mkSignal('sector', 'Relative Strength vs Sector',
          Math.abs(diff) < 0.05 ? 'neutral' : (diff > 0 ? 'bullish' : 'bearish'),
          `${code} is ${fmtPct(current.pct)} today vs the ${sector} sector average of ${fmtPct(avg)} (${peers.length} peers) — ${diff >= 0 ? 'outperforming' : 'underperforming'} the sector`,
          0.75);
      }
      return { status: 'ready', sector, peers, rank: rank || null, total: peers.length, avg, signal };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  async function fetchNews(code) {
    try {
      const res = await fetch(`/api/news/${encodeURIComponent(code)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { status: 'ready', items: (data.items || []).slice(0, 5) };
    } catch (e) {
      return { status: 'error', error: e.message };
    }
  }

  // ─── Verdict aggregation ────────────────────────────────────
  function computeVerdict(signals) {
    let score = 0, maxScore = 0, bull = 0, bear = 0, neu = 0;
    signals.forEach(s => {
      if (!s.weight) return;
      maxScore += s.weight;
      if (s.verdict === 'bullish') { score += s.weight; bull++; }
      else if (s.verdict === 'bearish') { score -= s.weight; bear++; }
      else neu++;
    });
    const norm = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    let label, cls;
    if (norm >= 40) { label = 'Bullish'; cls = 'bullish'; }
    else if (norm <= -40) { label = 'Bearish'; cls = 'bearish'; }
    else if (norm >= 15) { label = 'Mildly Bullish'; cls = 'bullish-mild'; }
    else if (norm <= -15) { label = 'Mildly Bearish'; cls = 'bearish-mild'; }
    else { label = 'Neutral / Mixed'; cls = 'neutral'; }
    return { score: norm, label, cls, bull, bear, neu };
  }

  // ─── Rendering ───────────────────────────────────────────────
  function dotClass(v) { return v === 'bullish' ? 'an-dot-bull' : v === 'bearish' ? 'an-dot-bear' : 'an-dot-neu'; }

  function renderSignalList(signals) {
    if (!signals || !signals.length) return '<div class="an-empty">Not enough data yet.</div>';
    return '<ul class="an-signal-list">' + signals.map(s => `
      <li class="an-signal-row">
        <span class="an-dot ${dotClass(s.verdict)}"></span>
        <div class="an-signal-text">
          <span class="an-signal-label">${escapeHtml(s.label)}</span>
          <span class="an-signal-detail">${escapeHtml(s.detail)}</span>
        </div>
      </li>`).join('') + '</ul>';
  }

  function renderVerdictBanner(verdict) {
    const pct     = Math.max(-100, Math.min(100, verdict.score));
    const fillPct = (pct + 100) / 2;
    const total   = verdict.bull + verdict.bear + verdict.neu;
    return `
      <div class="an-verdict an-verdict--${verdict.cls}">
        <div class="an-verdict-top">
          <span class="an-verdict-label">${escapeHtml(verdict.label)}</span>
          <span class="an-verdict-score">${pct > 0 ? '+' : ''}${pct}</span>
        </div>
        <div class="an-verdict-bar"><div class="an-verdict-bar-zero"></div><div class="an-verdict-bar-marker an-verdict-bar-marker--${verdict.cls}" style="left:${fillPct}%"></div></div>
        <div class="an-verdict-tally">${verdict.bull} bullish · ${verdict.bear} bearish · ${verdict.neu} neutral signal${total !== 1 ? 's' : ''}</div>
      </div>`;
  }

  function renderMinervini(m) {
    if (!m) {
      return `<h3 class="an-h3">🎯 Minervini Trend Template</h3><div class="an-empty">Not enough daily history loaded to evaluate (need at least a month of data).</div>`;
    }
    const rows = m.criteria.map(c => `
      <li class="an-mn-row ${c.pass === true ? 'an-mn-pass' : c.pass === false ? 'an-mn-fail' : 'an-mn-na'}">
        <span class="an-mn-icon">${c.pass === true ? '✓' : c.pass === false ? '✗' : '–'}</span>
        <div class="an-signal-text">
          <span class="an-signal-label">${escapeHtml(c.label)}</span>
          <span class="an-signal-detail">${escapeHtml(c.detail)}</span>
        </div>
      </li>`).join('');
    const perfParts = [
      m.perf3m  != null ? `3M ${fmtPct(m.perf3m)}`   : null,
      m.perf6m  != null ? `6M ${fmtPct(m.perf6m)}`   : null,
      m.perf12m != null ? `12M ${fmtPct(m.perf12m)}` : null,
    ].filter(Boolean).join('  ·  ');
    return `
      <h3 class="an-h3">🎯 Minervini Trend Template${m.applicable === m.total ? ` <span class="an-h3-badge">${m.passed}/${m.total}</span>` : ''}</h3>
      ${m.applicable < m.total ? `<div class="an-note">Only ${m.lookback} trading days of history loaded — the full ${m.total}-point template needs ~200. Showing what can be evaluated now.</div>` : ''}
      <ul class="an-signal-list an-mn-list">${rows}</ul>
      ${perfParts ? `<div class="an-note">Trailing performance — ${perfParts}</div>` : ''}
      <div class="an-note an-note-muted">${escapeHtml(m.rsNote)}</div>`;
  }

  function factRow(label, value, note) {
    return `<li class="an-fact-row"><span class="an-fact-label">${escapeHtml(label)}</span><span class="an-fact-value">${escapeHtml(String(value))}${note ? ` <span class="an-fact-note">— ${escapeHtml(note)}</span>` : ''}</span></li>`;
  }

  function renderFundamentals(f) {
    if (!f || f.status === 'loading') return `<h3 class="an-h3">💼 Fundamentals</h3><div class="an-loading">Loading fundamentals…</div>`;
    if (f.status === 'error') return `<h3 class="an-h3">💼 Fundamentals</h3><div class="an-empty">Could not load fundamentals (${escapeHtml(f.error || '')}).</div>`;

    const d = f.data || {};
    const price = (typeof chartData !== 'undefined' && chartData.length) ? chartData[chartData.length - 1].Close : null;
    const rows = [];

    if (d.eps != null) rows.push(factRow('EPS', d.eps, numFrom(d.eps) < 0 ? 'negative — trailing loss' : null));
    if (d.pe  != null) rows.push(factRow('P/E', d.pe));

    const nav = numFrom(d.nav);
    if (nav != null && price != null && nav > 0) {
      const ratio = price / nav;
      rows.push(factRow('Price / NAV', ratio.toFixed(2) + 'x', ratio < 1 ? 'trading below net asset value' : null));
    } else if (d.nav != null) {
      rows.push(factRow('NAV / share', d.nav));
    }
    if (d.cashDividend)       rows.push(factRow('Cash dividend', d.cashDividend));
    if (d.dividendYield != null) rows.push(factRow('Dividend yield', d.dividendYield + '%'));
    if (d.beta != null) {
      const b = numFrom(d.beta);
      rows.push(factRow('Beta', d.beta, b > 1 ? 'more volatile than the market' : (b < 1 ? 'less volatile than the market' : null)));
    }
    const hi = numFrom(d.weekHigh52), lo = numFrom(d.weekLow52);
    if (hi != null && lo != null && hi > lo && price != null) {
      const posPct = ((price - lo) / (hi - lo)) * 100;
      rows.push(factRow('52-week range', `${posPct.toFixed(0)}% of range (Low ${lo} – High ${hi})`,
        posPct >= 90 ? 'near its 52-week high' : (posPct <= 10 ? 'near its 52-week low' : null)));
    }
    if (d.marketCap)     rows.push(factRow('Market cap', d.marketCap));
    if (d.paidUpCapital) rows.push(factRow('Paid-up capital', d.paidUpCapital));

    if (!rows.length) return `<h3 class="an-h3">💼 Fundamentals</h3><div class="an-empty">No fundamentals data available for this stock.</div>`;
    return `<h3 class="an-h3">💼 Fundamentals</h3><ul class="an-fact-list">${rows.join('')}</ul>`;
  }

  function renderSector(s) {
    if (!s || s.status === 'loading') return `<h3 class="an-h3">🏭 Sector Comparison</h3><div class="an-loading">Loading sector data…</div>`;
    if (s.status === 'error') return `<h3 class="an-h3">🏭 Sector Comparison</h3><div class="an-empty">Could not load sector data.</div>`;
    if (!s.sector) return `<h3 class="an-h3">🏭 Sector Comparison</h3><div class="an-empty">No sector mapping available for this stock.</div>`;

    const rows = s.peers.slice(0, 6).map(p => `
      <li class="an-peer-row ${p.isCurrent ? 'an-peer-current' : ''}">
        <span class="an-peer-code">${escapeHtml(p.code)}</span>
        <span class="an-peer-pct ${p.pct >= 0 ? 'an-gain' : 'an-loss'}">${fmtPct(p.pct)}</span>
      </li>`).join('');
    return `
      <h3 class="an-h3">🏭 Sector Comparison — ${escapeHtml(s.sector)}</h3>
      <div class="an-note">Ranked ${s.rank || '—'} of ${s.total} in sector today · sector average ${fmtPct(s.avg)}</div>
      <ul class="an-peer-list">${rows}</ul>`;
  }

  function renderSeasonality(se) {
    if (!se || !se.available) return `<h3 class="an-h3">🗓️ Seasonality</h3><div class="an-empty">Not enough price history to compute seasonal patterns.</div>`;
    const c = se.cur;
    const body = (c && c.count >= 2)
      ? `<div class="an-note">In <b>${se.monthName}</b>, this stock has closed higher ${c.up} of ${c.count} years (${((c.up / c.count) * 100).toFixed(0)}%), averaging ${fmtPct(c.mean)} (median ${fmtPct(c.median)}).</div>`
      : `<div class="an-empty">Only ${c ? c.count : 0} year(s) of ${se.monthName} history loaded — too little to compute a seasonal pattern.</div>`;
    const extra = (se.best && se.worst)
      ? `<div class="an-note an-note-muted">Historically strongest month: ${se.best.name} (avg ${fmtPct(se.best.mean)}) · weakest: ${se.worst.name} (avg ${fmtPct(se.worst.mean)}) — across ${se.yearsOfData} years of data.</div>`
      : '';
    return `<h3 class="an-h3">🗓️ Seasonality</h3>${body}${extra}`;
  }

  function renderNews(n) {
    if (!n || n.status === 'loading') return `<h3 class="an-h3">📰 Recent News</h3><div class="an-loading">Loading news…</div>`;
    if (n.status === 'error') return `<h3 class="an-h3">📰 Recent News</h3><div class="an-empty">Could not load news.</div>`;
    if (!n.items.length) return `<h3 class="an-h3">📰 Recent News</h3><div class="an-empty">No recent news articles found for this stock yet.</div>`;

    const rows = n.items.map(it => {
      let dateStr = '';
      try { dateStr = new Date(it.addedAt).toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) {}
      let site = it.site_name;
      if (!site) { try { site = new URL(it.url).hostname.replace('www.', ''); } catch (e) { site = ''; } }
      return `
        <li class="an-news-row">
          <a class="an-news-title" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">${escapeHtml(it.title || it.url)}</a>
          <div class="an-news-meta">${escapeHtml(site || '')}${dateStr ? ' · ' + dateStr : ''}</div>
        </li>`;
    }).join('');
    return `<h3 class="an-h3">📰 Recent News</h3><ul class="an-news-list">${rows}</ul>`;
  }

  function render() {
    const body = document.getElementById(BODY_ID);
    if (!body || !_state) return;

    if (_state.technical.insufficientData) {
      body.innerHTML = `<div class="an-empty an-empty-big">Not enough candles loaded yet to run an analysis.</div>`;
      return;
    }

    const allSignals = [
      ..._state.technical.trend, ..._state.technical.momentum, ..._state.technical.volatility,
      ..._state.technical.volume, ..._state.technical.patterns,
    ];
    if (_state.minervini && _state.minervini.signal) allSignals.push(_state.minervini.signal);
    if (_state.sector && _state.sector.signal) allSignals.push(_state.sector.signal);
    const verdict = computeVerdict(allSignals);

    body.innerHTML = `
      ${renderVerdictBanner(verdict)}
      <div class="an-section"><h3 class="an-h3">📈 Trend</h3>${renderSignalList(_state.technical.trend)}</div>
      <div class="an-section"><h3 class="an-h3">⚡ Momentum</h3>${renderSignalList(_state.technical.momentum)}</div>
      <div class="an-section"><h3 class="an-h3">🌊 Volatility</h3>${renderSignalList(_state.technical.volatility)}</div>
      <div class="an-section"><h3 class="an-h3">📊 Volume</h3>${renderSignalList(_state.technical.volume)}</div>
      <div class="an-section"><h3 class="an-h3">🕯️ Last Candles</h3>${renderSignalList(_state.technical.patterns)}</div>
      <div class="an-section">${renderMinervini(_state.minervini)}</div>
      <div class="an-section">${renderSector(_state.sector)}</div>
      <div class="an-section">${renderFundamentals(_state.fundamentals)}</div>
      <div class="an-section">${renderSeasonality(_state.seasonality)}</div>
      <div class="an-section">${renderNews(_state.news)}</div>
      <div class="an-disclaimer">⚠️ Rule-based read-out generated from this chart's own price/volume data and this app's own scraped fundamentals/news — not a prediction, not financial advice.</div>
    `;
  }

  function runAnalysis() {
    const myId = ++_openId;
    const data = (typeof aggregatedData !== 'undefined' && aggregatedData.length) ? aggregatedData
               : (typeof chartData !== 'undefined' ? chartData : []);
    const dailyData = (typeof chartData !== 'undefined') ? chartData : [];
    const code = getCurrentCode();

    _state = {
      technical:   computeTechnical(data),
      minervini:   computeMinervini(dailyData),
      seasonality: computeSeasonality(),
      fundamentals: { status: 'loading' },
      sector:       { status: 'loading' },
      news:         { status: 'loading' },
    };
    render();

    if (!code) return;
    fetchFundamentals(code).then(r => { if (_openId === myId) { _state.fundamentals = r; render(); } });
    fetchSector(code).then(r      => { if (_openId === myId) { _state.sector = r; render(); } });
    fetchNews(code).then(r        => { if (_openId === myId) { _state.news = r; render(); } });
  }

  // ─── Public entry points ────────────────────────────────────
  window.openAnalysisModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.style.display = 'flex';
    runAnalysis();
  };

  window.closeAnalysisModal = function () {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    _openId++; // invalidate any in-flight async renders
  };

  // ─── Reusable engine surface ─────────────────────────────────
  // Same compute + fetch + render pieces this modal is built from,
  // exposed so other pages (research/research.js, the full-page
  // "Research Report") can assemble their own layout from the exact
  // same rule-based logic instead of duplicating it.
  window.AnalysisEngine = {
    computeTechnical, computeMinervini, computeSeasonality, computeVerdict,
    fetchFundamentals, fetchSector, fetchNews, getCurrentCode,
    renderVerdictBanner, renderSignalList, renderMinervini,
    renderFundamentals, renderSector, renderSeasonality, renderNews,
  };
})();
