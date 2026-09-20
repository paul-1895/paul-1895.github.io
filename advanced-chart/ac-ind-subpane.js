/* ════════════════════════════════════════════════════════════
   ac-ind-subpane.js
   Oscillator sub-panes → Lightweight Charts v5 panes.

   The canvas page draws every oscillator itself:
     indicators/subpane-framework.js  — the generic framework, one
       pane per INDICATOR_DEFS entry with `isSubPane: true`
     indicators/macd.js / rsi.js / hilega-milega.js — three LEGACY
       bespoke panes that predate the framework and still ride the
       single-instance `enabledIndicators` on/off model

   Here, ac-render.js has already reconciled the LWC panes to
   ['price','volume', ...paneOrder ∩ enabledIndicators] before the
   render hooks run, so this module never creates or orders a pane —
   it only fills whichever sub-panes are open this pass, via
   ACChart.series(key, type, opts, paneKey) so the renderer's cache
   garbage-collects a series the moment its indicator goes away.

   Canvas → LWC translation of the framework's pane chrome:
     grid + y-axis labels      → the pane's own right price scale
     end-of-line value labels  → `lastValueVisible` axis tags
     refLines / zeroLine       → series.createPriceLine(), tracked per
                                 pane so re-renders replace rather than
                                 stack them
     pane title (top-left)     → LightweightCharts.createTextWatermark()
     RSI's OB/OS shading and   → BaselineSeries with a price `baseValue`
       Hilega-Milega's 50-fill    (fills exactly the band between the
                                  line and that level)
     rangeMode                 → autoscaleInfoProvider (see pinning note
                                 at `providerFor`)

   Depends on : ac-render.js (ACChart, GENERIC_SUBPANE_KEYS),
                indicator-instances.js (INDICATOR_DEFS, indicatorInstances,
                _hexToRgba), indicators/macd.js (macdParams),
                indicators/rsi.js (RSI_COLOR),
                indicators/hilega-milega.js (HM_COLORS),
                lightweight-charts v5
   Consumed by: ac-ui.js / pane-control UI via window.ACSubPanes
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  if (!window.ACChart) {
    console.warn('[AC] ac-ind-subpane.js loaded before ac-render.js — sub-panes disabled');
    return;
  }

  const AC = window.ACChart;

  // ─── Small helpers ────────────────────────────────────────────
  function LWC() { return window.LightweightCharts || {}; }

  function lineStyle(name) {
    const L = LWC().LineStyle || {};
    if (name === 'dashed') return L.Dashed != null ? L.Dashed : 2;
    if (name === 'dotted') return L.Dotted != null ? L.Dotted : 1;
    return L.Solid != null ? L.Solid : 0;
  }
  function dashed() { const L = LWC().LineStyle || {}; return L.Dashed != null ? L.Dashed : 2; }
  function solid()  { const L = LWC().LineStyle || {}; return L.Solid  != null ? L.Solid  : 0; }

  // LWC only renders integer line widths 1..4; the canvas defs carry
  // fractional widths (1.5 / 2.5), so they are rounded into range.
  function widthOf(w, fallback) {
    const n = Math.round(Number(w) || fallback || 1);
    return Math.max(1, Math.min(4, n));
  }

  function rgba(hex, a) {
    if (typeof _hexToRgba === 'function') {
      const out = _hexToRgba(hex, a);
      if (out) return out;
    }
    if (typeof AC.alpha === 'function') return AC.alpha(hex, a);
    return hex;
  }

  const TRANSPARENT = 'rgba(0,0,0,0)';

  function themeColors() {
    try { return AC.colors(); } catch (e) {
      return { bg: '#0d1117', text: '#8a93a6', textMuted: '#6b7280', grid: 'rgba(255,255,255,0.06)' };
    }
  }

  // Muted chrome colour for reference / zero lines, theme-aware the same
  // way the canvas framework picks rgba(255,255,255,0.10-0.12) vs its
  // light-mode equivalents.
  function chromeColor(strength) {
    const light = document.documentElement.classList.contains('light-mode');
    return light ? `rgba(0,0,0,${strength * 2})` : `rgba(255,255,255,${strength})`;
  }

  // ─── Def lookup: paneKey → INDICATOR_DEFS entry ───────────────
  // INDICATOR_DEFS is static, so this is built once.
  let _defByPane = null;
  function defByPaneKey(paneKey) {
    if (_defByPane === null) {
      _defByPane = new Map();
      if (typeof INDICATOR_DEFS !== 'undefined') {
        Object.keys(INDICATOR_DEFS).forEach((typeId) => {
          const def = INDICATOR_DEFS[typeId];
          if (def && def.isSubPane && def.paneKey && !_defByPane.has(def.paneKey)) {
            _defByPane.set(def.paneKey, def);
          }
        });
      }
    }
    return _defByPane.get(paneKey) || null;
  }

  function instancesFor(paneKey) {
    if (typeof indicatorInstances === 'undefined' || typeof INDICATOR_DEFS === 'undefined') return [];
    return indicatorInstances.filter((inst) => {
      const def = INDICATOR_DEFS[inst.typeId];
      return def && def.isSubPane && def.paneKey === paneKey;
    });
  }

  function isGenericPane(paneKey) {
    if (typeof GENERIC_SUBPANE_KEYS !== 'undefined' && GENERIC_SUBPANE_KEYS.indexOf(paneKey) >= 0) return true;
    return !!defByPaneKey(paneKey);
  }

  // ─── Series data builders ─────────────────────────────────────
  // nulls become whitespace points ({time, value: undefined}) so the line
  // breaks over an indicator's warm-up instead of bridging it.
  function lineData(field) {
    const data = AC.displayData();
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = data[i][field];
      out[i] = (v == null || !isFinite(v))
        ? { time: AC.timeOfIndex(i), value: undefined }
        : { time: AC.timeOfIndex(i), value: v };
    }
    return out;
  }

  function histData(field, upColor, downColor, opacity) {
    const data = AC.displayData();
    const up = rgba(upColor, opacity);
    const down = rgba(downColor, opacity);
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const v = data[i][field];
      out[i] = (v == null || !isFinite(v))
        ? { time: AC.timeOfIndex(i), value: undefined }
        : { time: AC.timeOfIndex(i), value: v, color: v >= 0 ? up : down };
    }
    return out;
  }

  function constData(value) {
    const data = AC.displayData();
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = { time: AC.timeOfIndex(i), value };
    return out;
  }

  // ─── Range pinning ────────────────────────────────────────────
  // NOTE — `autoScale: false` is deliberately NOT used. IPriceScaleApi has
  // no range setter, so switching a scale to manual just freezes it at
  // whatever it happened to hold; the only way to *pin* a range in LWC is
  // an autoscaleInfoProvider evaluated while autoScale is on. So the pane
  // keeps autoScale:true and the provider returns the exact range:
  //   'fixed'      → the def's fixedRange verbatim (RSI/Stoch stay 0-100)
  //   'auto'       → LWC's own range, forced to include 0, +15% pad
  //                  (the canvas framework's MACD convention)
  //   'auto-tight' → LWC's own range, untouched
  // Providers are memoised so applyOptions() sees a stable function
  // identity across renders instead of a new closure every frame.
  const _providers = new Map();
  function providerFor(mode, lo, hi) {
    const key = mode + ':' + lo + ':' + hi;
    let fn = _providers.get(key);
    if (fn) return fn;

    if (mode === 'fixed') {
      fn = () => ({ priceRange: { minValue: lo, maxValue: hi } });
    } else if (mode === 'auto') {
      fn = (original) => {
        const res = original();
        if (!res || !res.priceRange) return res;
        let minValue = Math.min(res.priceRange.minValue, 0);
        let maxValue = Math.max(res.priceRange.maxValue, 0);
        const pad = (maxValue - minValue || 1) * 0.15;
        return { priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } };
      };
    } else {
      fn = (original) => original();
    }
    _providers.set(key, fn);
    return fn;
  }

  function providerForDef(def) {
    const mode = (def && def.rangeMode) || 'auto-tight';
    if (mode === 'fixed' && Array.isArray(def.fixedRange)) {
      return providerFor('fixed', def.fixedRange[0], def.fixedRange[1]);
    }
    return providerFor(mode === 'auto' ? 'auto' : 'auto-tight', 0, 0);
  }

  // Applied once per pane (off the pane's anchor series) and redone after a
  // pane rebuild — not every frame, so a user's own scale nudges survive.
  const _scaleTuned = new Set();
  function tunePaneScale(paneKey, anchorApi) {
    if (!anchorApi || _scaleTuned.has(paneKey)) return;
    try {
      anchorApi.priceScale().applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.12 },
      });
      _scaleTuned.add(paneKey);
    } catch (e) { /* price-scale tuning is advisory */ }
  }

  // ─── Price lines (refLines / zeroLine), one set per pane ──────
  // Anchored on the pane's first series. Re-renders replace the set only
  // when the spec or the anchor series changed, so nothing stacks up.
  const _paneLines = new Map(); // paneKey -> { api, sig, lines: [] }

  function dropPaneLines(paneKey) {
    const reg = _paneLines.get(paneKey);
    if (!reg) return;
    reg.lines.forEach((l) => { try { reg.api.removePriceLine(l); } catch (e) {} });
    _paneLines.delete(paneKey);
  }

  function applyPaneLines(paneKey, anchorApi, specs) {
    if (!anchorApi) { dropPaneLines(paneKey); return; }
    const sig = JSON.stringify(specs);
    const reg = _paneLines.get(paneKey);
    if (reg && reg.api === anchorApi && reg.sig === sig) return;
    if (reg) {
      // A different anchor means the old one may already be gone (pane
      // rebuild purges every cached series) — removing then is a no-op.
      reg.lines.forEach((l) => { try { reg.api.removePriceLine(l); } catch (e) {} });
      _paneLines.delete(paneKey);
    }
    const c = themeColors();
    const lines = [];
    specs.forEach((s) => {
      try {
        lines.push(anchorApi.createPriceLine({
          price: s.price,
          color: s.color,
          lineWidth: s.lineWidth || 1,
          lineStyle: s.style === 'solid' ? solid() : dashed(),
          axisLabelVisible: s.axisLabelVisible !== false,
          // The guide line itself is deliberately faint (the canvas draws
          // these at ~0.12 alpha), but its axis tag has to stay readable —
          // so the tag gets an opaque background of its own.
          axisLabelColor: s.labelColor || c.textMuted,
          axisLabelTextColor: c.bg,
          title: s.title != null ? s.title : '',
        }));
      } catch (e) { /* a removed series rejects price lines */ }
    });
    _paneLines.set(paneKey, { api: anchorApi, sig, lines });
  }

  // ─── Pane rebuild detection ───────────────────────────────────
  // ac-render's syncPanes() rebuilds every pane (and purges every cached
  // series) whenever the pane SET or ORDER changes — and only then. So the
  // ordered pane-key list is an exact signal that everything attached to a
  // pane (watermarks, price lines, price-scale tuning) has to be redone.
  let _paneSig = null;

  function onPanesRebuilt() {
    _labels.forEach((reg) => { try { reg.api.detach(); } catch (e) {} });
    _labels.clear();
    _paneLines.forEach((reg) => { reg.lines.forEach(l => { try { reg.api.removePriceLine(l); } catch (e) {} }); });
    _paneLines.clear();
    _scaleTuned.clear();
  }

  // ─── Pane labels (v5 text watermark, top-left) ────────────────
  const _labels = new Map(); // paneKey -> { api, text }

  function dropLabel(paneKey) {
    const reg = _labels.get(paneKey);
    if (!reg) return;
    try { reg.api.detach(); } catch (e) {}
    _labels.delete(paneKey);
  }

  function ensureLabel(paneKey, text) {
    const create = LWC().createTextWatermark;
    if (typeof create !== 'function') return; // v4 fallback: no pane watermark API
    const idx = AC.paneIndex(paneKey);
    if (idx < 0) { dropLabel(paneKey); return; }
    const pane = AC.chart().panes()[idx];
    if (!pane) { dropLabel(paneKey); return; }

    const c = themeColors();
    const reg = _labels.get(paneKey);
    if (reg) {
      if (reg.text === text) return;
      try { reg.api.applyOptions({ lines: [{ text, color: c.textMuted, fontSize: 11 }] }); reg.text = text; return; }
      catch (e) { try { reg.api.detach(); } catch (e2) {} _labels.delete(paneKey); }
    }
    try {
      const api = create(pane, {
        horzAlign: 'left',
        vertAlign: 'top',
        lines: [{ text, color: c.textMuted, fontSize: 11 }],
      });
      _labels.set(paneKey, { api, text });
    } catch (e) { /* watermark is cosmetic */ }
  }

  // ═══ LEGACY PANE 1 — MACD ═════════════════════════════════════
  // Values attached by attachMACD(): candle.macdLine / .signalLine /
  // .histogram. Every toggle, colour and width comes from the global
  // `macdParams` the macd-settings-modal writes.
  const MACD_FALLBACK = {
    fastLength: 12, slowLength: 26, signalLength: 9,
    macdColor: '#FF9C00', signalColor: '#0891B2',
    histUpColor: '#10B981', histDownColor: '#EF4444',
    macdWidth: 2.5, signalWidth: 2.5,
    showMACD: true, showSignal: true, showHistogram: true, showZero: true,
  };
  function macdOpts() {
    return (typeof macdParams !== 'undefined' && macdParams) ? macdParams : MACD_FALLBACK;
  }

  function renderMACDPane() {
    const p = macdOpts();
    const provider = providerFor('auto', 0, 0);
    // macd.js labels its lines with toFixed(3); the default 2-decimal price
    // format would round a small MACD to a flat 0.00 on the axis.
    const fmt3 = { type: 'price', precision: 3, minMove: 0.001 };
    let anchor = null;

    // Histogram first so the two lines draw on top of it (LWC z-orders by
    // creation order, exactly like the canvas paint order in macd.js).
    if (p.showHistogram !== false) {
      const h = AC.series('sp:macd:hist', 'histogram', {
        base: 0,
        priceFormat: fmt3,
        priceLineVisible: false,
        lastValueVisible: false,
        autoscaleInfoProvider: provider,
      }, 'macd');
      if (h) {
        // macd.js paints every bar at 0.4 alpha of the sign colour.
        h.setData(histData('histogram', p.histUpColor || '#10B981', p.histDownColor || '#EF4444', 0.4));
        anchor = anchor || h;
      }
    }

    if (p.showMACD !== false) {
      const m = AC.series('sp:macd:line', 'line', {
        color: p.macdColor || '#FF9C00',
        lineWidth: widthOf(p.macdWidth, 2.5),
        lineStyle: solid(),
        priceFormat: fmt3,
        priceLineVisible: false,
        lastValueVisible: true,
      }, 'macd');
      if (m) {
        m.applyOptions({ autoscaleInfoProvider: provider });
        m.setData(lineData('macdLine'));
        anchor = anchor || m;
      }
    }

    if (p.showSignal !== false) {
      const s = AC.series('sp:macd:signal', 'line', {
        color: p.signalColor || '#0891B2',
        lineWidth: widthOf(p.signalWidth, 2.5),
        lineStyle: dashed(),            // macd.js dashes the signal line [5,3]
        priceFormat: fmt3,
        priceLineVisible: false,
        lastValueVisible: true,
      }, 'macd');
      if (s) {
        s.applyOptions({ autoscaleInfoProvider: provider });
        s.setData(lineData('signalLine'));
        anchor = anchor || s;
      }
    }

    tunePaneScale('macd', anchor);
    applyPaneLines('macd', anchor, (p.showZero !== false)
      ? [{ price: 0, color: chromeColor(0.15), title: '0' }]
      : []);
    ensureLabel('macd', `MACD ${p.fastLength || 12},${p.slowLength || 26},${p.signalLength || 9}`);
  }

  // ═══ LEGACY PANE 2 — RSI ══════════════════════════════════════
  // Values attached by attachRSI(): candle.rsi. Fixed 0-100 scale, 30/70
  // guides, and the two shaded bands rsi.js fills with fillRect —
  // reproduced here as BaselineSeries pinned to a price base, which fills
  // exactly the region between a constant line and that level.
  // Prefer the user's settings (ac-pane-settings.js) over rsi.js's `const`,
  // which cannot be reassigned from outside that file.
  function rsiColor() {
    const p = window.acRsiParams;
    if (p && p.color) return p.color;
    return (typeof RSI_COLOR !== 'undefined' && RSI_COLOR) ? RSI_COLOR : '#D77FFF';
  }
  function rsiLevels() {
    const p = window.acRsiParams || {};
    const ob = Number(p.overbought); const os = Number(p.oversold);
    return {
      ob: Number.isFinite(ob) ? ob : 70,
      os: Number.isFinite(os) ? os : 30,
    };
  }
  function rsiLength() {
    const n = Number((window.acRsiParams || {}).period);
    return Number.isFinite(n) && n >= 2 ? n : 14;
  }

  function renderRSIPane() {
    const provider = providerFor('fixed', 0, 100);
    const band = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineWidth: 1, autoscaleInfoProvider: provider };

    // Overbought band 70→100, rgba(239,68,68,0.08) in rsi.js.
    const ob = AC.series('sp:rsi:band-ob', 'baseline', Object.assign({
      baseValue: { type: 'price', price: rsiLevels().ob },
      topLineColor: TRANSPARENT, bottomLineColor: TRANSPARENT,
      topFillColor1: 'rgba(239,68,68,0.08)', topFillColor2: 'rgba(239,68,68,0.08)',
      bottomFillColor1: TRANSPARENT, bottomFillColor2: TRANSPARENT,
    }, band), 'rsi');
    if (ob) ob.setData(constData(100));

    // Oversold band 0→30, rgba(16,185,129,0.08).
    const os = AC.series('sp:rsi:band-os', 'baseline', Object.assign({
      baseValue: { type: 'price', price: rsiLevels().os },
      topLineColor: TRANSPARENT, bottomLineColor: TRANSPARENT,
      topFillColor1: TRANSPARENT, topFillColor2: TRANSPARENT,
      bottomFillColor1: 'rgba(16,185,129,0.08)', bottomFillColor2: 'rgba(16,185,129,0.08)',
    }, band), 'rsi');
    if (os) os.setData(constData(0));

    const line = AC.series('sp:rsi:line', 'line', {
      color: rsiColor(),
      lineWidth: 1,
      lineStyle: solid(),
      priceLineVisible: false,
      lastValueVisible: true,   // the axis tag rsi.js draws by hand
    }, 'rsi');
    if (line) {
      line.applyOptions({ autoscaleInfoProvider: provider });
      line.setData(lineData('rsi'));
    }

    const anchor = line || ob || os;
    tunePaneScale('rsi', anchor);
    const lv = rsiLevels();
    applyPaneLines('rsi', anchor, [
      { price: lv.ob, color: chromeColor(0.14), title: String(lv.ob), labelColor: '#EF4444' },
      { price: lv.os, color: chromeColor(0.14), title: String(lv.os), labelColor: '#10B981' },
    ]);
    ensureLabel('rsi', 'RSI ' + rsiLength());
  }

  // ═══ LEGACY PANE 3 — Hilega-Milega ════════════════════════════
  // Values attached by attachHilegaMilega(): candle.hmRsi / .hmWma21 /
  // .hmEma3, on a fixed 0-100 scale.
  //   RSI(9)         — line, filled to the 50 level: warm above, cool
  //                    below (hilega-milega.js's per-segment polygons) →
  //                    one BaselineSeries with baseValue price 50
  //   Strength WMA21 — drawn as dots per bar → line series with
  //                    lineVisible:false + point markers
  //   Price EMA3     — plain line
  //   Line-50        — solid green guide → a price line
  const HM_FALLBACK = { line50: '#4caf50', rsi: '#26c6da', strength: '#f57c00', price: '#1e88e5' };
  function hmColors() {
    const base = (typeof HM_COLORS !== 'undefined' && HM_COLORS) ? HM_COLORS : HM_FALLBACK;
    const p = window.acHmParams;
    if (!p) return base;
    return {
      rsi:      p.colorRsi      || base.rsi,
      strength: p.colorStrength || base.strength,
      price:    p.colorPrice    || base.price,
      line50:   p.colorLine50   || base.line50,
    };
  }

  function renderHMPane() {
    const c = hmColors();
    const provider = providerFor('fixed', 0, 100);

    const rsiSeries = AC.series('sp:hm:rsi', 'baseline', {
      baseValue: { type: 'price', price: 50 },
      topLineColor: c.rsi, bottomLineColor: c.rsi,
      lineWidth: 1,
      topFillColor1: 'rgba(255,140,80,0.45)', topFillColor2: 'rgba(255,140,80,0.45)',
      bottomFillColor1: 'rgba(100,210,255,0.35)', bottomFillColor2: 'rgba(100,210,255,0.35)',
      priceLineVisible: false,
      lastValueVisible: true,
    }, 'hm');
    if (rsiSeries) {
      rsiSeries.applyOptions({ autoscaleInfoProvider: provider });
      rsiSeries.setData(lineData('hmRsi'));
    }

    const strength = AC.series('sp:hm:wma21', 'line', {
      color: c.strength,
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
    }, 'hm');
    if (strength) {
      strength.applyOptions({ autoscaleInfoProvider: provider });
      strength.setData(lineData('hmWma21'));
    }

    const price = AC.series('sp:hm:ema3', 'line', {
      color: c.price,
      lineWidth: 1,
      lineStyle: solid(),
      priceLineVisible: false,
      lastValueVisible: true,
    }, 'hm');
    if (price) {
      price.applyOptions({ autoscaleInfoProvider: provider });
      price.setData(lineData('hmEma3'));
    }

    const anchor = rsiSeries || strength || price;
    tunePaneScale('hm', anchor);
    applyPaneLines('hm', anchor, [
      { price: 50, color: c.line50, style: 'solid', title: '50', labelColor: c.line50 },
      { price: 70, color: chromeColor(0.12), title: '70' },
      { price: 30, color: chromeColor(0.12), title: '30' },
    ]);
    ensureLabel('hm', 'HILEGA-MILEGA');
  }

  // ═══ GENERIC FRAMEWORK PANES ══════════════════════════════════
  // One pane per indicator TYPE; every instance of that type emits one
  // LWC series per entry in its def's `seriesStyle`.
  function renderGenericPane(paneKey) {
    const all = instancesFor(paneKey);
    const def = (all.length ? (INDICATOR_DEFS[all[0].typeId]) : defByPaneKey(paneKey));
    if (!def) return;

    const visible = all.filter((inst) => inst.style && inst.style.visible);
    const provider = providerForDef(def);
    let anchor = null;

    // The framework's escape hatch: a def whose shape isn't a plain
    // line/histogram set paints itself onto the overlay canvas instead.
    if (typeof def.drawPane === 'function') {
      registerDrawPaneFallback(paneKey, def);
      ensureLabel(paneKey, def.paneLabel || def.label || paneKey);
      return;
    }
    unregisterDrawPaneFallback(paneKey);

    visible.forEach((instance) => {
      const styleKeys = Object.keys(def.seriesStyle || {});
      styleKeys.forEach((computeKey) => {
        const spec = def.seriesStyle[computeKey];
        const field = instance.id + '_' + computeKey;
        const key = 'sp:' + paneKey + ':' + instance.id + ':' + computeKey;
        const st = instance.style || {};

        if (spec.type === 'histogram') {
          const api = AC.series(key, 'histogram', {
            base: 0,
            priceLineVisible: false,
            lastValueVisible: false,   // the framework skips labelling bars
            autoscaleInfoProvider: provider,
          }, paneKey);
          if (!api) return;
          // subpane-framework.js fills histogram bars at 0.55 alpha.
          api.setData(histData(field, st[spec.upColorKey], st[spec.downColorKey], 0.55));
          anchor = anchor || api;
        } else {
          const api = AC.series(key, 'line', {
            color: st[spec.colorKey] || '#8a93a6',
            lineWidth: widthOf(st.lineWidth, 1.5),
            lineStyle: lineStyle(st.lineStyle),
            priceLineVisible: false,
            lastValueVisible: true,    // ≡ the framework's end-of-line labels
          }, paneKey);
          if (!api) return;
          api.applyOptions({ autoscaleInfoProvider: provider });
          api.setData(lineData(field));
          anchor = anchor || api;
        }
      });
    });

    tunePaneScale(paneKey, anchor);

    const specs = [];
    (def.refLines || []).forEach((level) => {
      specs.push({ price: level, color: chromeColor(0.14), title: String(level) });
    });
    if (def.zeroLine) specs.push({ price: 0, color: chromeColor(0.15), title: '0' });
    applyPaneLines(paneKey, anchor, specs);

    ensureLabel(paneKey, def.paneLabel || def.label || paneKey);
  }

  // ─── drawPane escape-hatch fallback ───────────────────────────
  // No def in indicator-instances.js currently sets drawPane, so this path
  // is dormant — but the framework contract allows it, so a def that opts
  // in still renders: it paints onto ACChart's overlay canvas with the same
  // geom object subpane-framework.js hands drawPane(), derived from
  // _lastRender + the pane's own box.
  const _drawPanePainters = new Set();

  function paneRangeFor(def, visible, visibleData) {
    if (def.rangeMode === 'fixed' && Array.isArray(def.fixedRange)) {
      return { minVal: def.fixedRange[0], maxVal: def.fixedRange[1] };
    }
    let maxVal = def.rangeMode === 'auto-tight' ? -Infinity : 0;
    let minVal = def.rangeMode === 'auto-tight' ? Infinity : 0;
    visible.forEach((instance) => {
      Object.keys(def.seriesStyle || {}).forEach((k) => {
        const field = instance.id + '_' + k;
        visibleData.forEach((c) => {
          const v = c[field];
          if (v != null) { maxVal = Math.max(maxVal, v); minVal = Math.min(minVal, v); }
        });
      });
    });
    if (!isFinite(maxVal) || !isFinite(minVal)) { maxVal = 1; minVal = 0; }
    const pad = ((maxVal - minVal) || 1) * 0.15;
    return { minVal: minVal - pad, maxVal: maxVal + pad };
  }

  function registerDrawPaneFallback(paneKey, def) {
    const name = 'subpane:' + paneKey;
    if (_drawPanePainters.has(name)) return;
    _drawPanePainters.add(name);
    AC.addOverlayPainter(name, (ctx) => {
      const r = window._lastRender;
      if (!r || AC.paneIndex(paneKey) < 0) return;
      const visible = instancesFor(paneKey).filter(i => i.style && i.style.visible);
      if (!visible.length) return;
      const startY = AC.paneTop(paneKey);
      const height = AC.paneHeight(paneKey);
      const chartHeight = Math.max(1, height - 20);
      const { minVal, maxVal } = paneRangeFor(def, visible, r.visibleData);
      const valueToY = v => startY + chartHeight * (1 - (v - minVal) / ((maxVal - minVal) || 1));
      const geom = {
        width: r.width, height, candleWidth: r.candleWidth, spacing: r.candleWidth,
        padding: r.padding, startY, chartHeight, valueToY,
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, startY, r.width, height);
      ctx.clip();
      visible.forEach(inst => { try { def.drawPane(ctx, r.visibleData, inst, geom); } catch (e) {} });
      ctx.restore();
    });
  }

  function unregisterDrawPaneFallback(paneKey) {
    const name = 'subpane:' + paneKey;
    if (!_drawPanePainters.has(name)) return;
    _drawPanePainters.delete(name);
    AC.removeOverlayPainter(name);
  }

  // ═══ The render hook ══════════════════════════════════════════
  function renderSubPanes() {
    if (!AC.ready() || !AC.displayData().length) return;

    const keys = AC.paneKeys();
    const sig = keys.join('|');
    if (sig !== _paneSig) { onPanesRebuilt(); _paneSig = sig; }

    const open = keys.filter(k => k !== 'price' && k !== 'volume');
    const openSet = new Set(open);

    open.forEach((paneKey) => {
      try {
        if (paneKey === 'macd') renderMACDPane();
        else if (paneKey === 'rsi') renderRSIPane();
        else if (paneKey === 'hm') renderHMPane();
        else if (isGenericPane(paneKey)) renderGenericPane(paneKey);
      } catch (e) {
        console.warn('[AC] sub-pane', paneKey, e);
      }
    });

    // Chrome for panes that closed since the last pass. (Their series are
    // garbage-collected by ac-render's endRender on its own.)
    [..._paneLines.keys()].forEach(k => { if (!openSet.has(k)) dropPaneLines(k); });
    [..._labels.keys()].forEach(k => { if (!openSet.has(k)) dropLabel(k); });
    [..._drawPanePainters].forEach((name) => {
      const k = name.slice('subpane:'.length);
      if (!openSet.has(k)) unregisterDrawPaneFallback(k);
    });
  }

  AC.addRenderHook('subpane-indicators', renderSubPanes);

  // ═══ Public API (agent 6's pane-control UI) ═══════════════════
  function paneLabelFor(paneKey) {
    if (paneKey === 'price')  return 'Price';
    if (paneKey === 'volume') return 'Volume';
    if (paneKey === 'macd') {
      const p = macdOpts();
      return `MACD ${p.fastLength || 12},${p.slowLength || 26},${p.signalLength || 9}`;
    }
    if (paneKey === 'rsi') return 'RSI 14';
    if (paneKey === 'hm')  return 'HILEGA-MILEGA';
    const def = defByPaneKey(paneKey);
    return def ? (def.paneLabel || def.label || paneKey) : null;
  }

  function refresh() {
    if (typeof drawChart === 'function') drawChart();
    else if (typeof window.__acRender === 'function') window.__acRender();
  }

  window.ACSubPanes = { refresh, paneLabelFor };

})();
