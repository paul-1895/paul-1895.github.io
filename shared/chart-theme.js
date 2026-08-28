/* ═══════════════════════════════════════════════════════════════════
   DSE — Canvas chart theme bridge

   shared/display-settings.js applies the user's preferences by writing
   CSS custom properties (--gain, --loss, --accent, --sans, --mono …)
   onto <html>. Canvas has no access to those: every fillStyle and
   ctx.font is a JS string, so chart surfaces silently ignored every
   colour and font setting the rest of the page honoured.

   This module is the bridge. Canvas code keeps its authored literal as
   the argument, and this returns the token-resolved equivalent:

     ctx.fillStyle = DSEChartTheme.gain('#10b981');
     ctx.font      = DSEChartTheme.font('700 11px "DM Sans", sans-serif');

   Two properties make that safe to sprinkle around:
   • If a token is unset or unreadable the authored literal comes back
     untouched, so a page that never loads display-settings.js — or one
     where this file itself is missing — renders exactly as before.
   • Resolution is cached and invalidated on 'dse-display-applied' and
     on any <html> attribute change (the theme toggle, the inline custom
     properties), so a pan loop asking 40 times a frame costs one
     getComputedStyle per settings change, not per call.

   Load in <head>, straight after display-settings.js.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const root = document.documentElement;

  // ── Token resolution (cached) ──────────────────────────────────────
  let cache = null;

  function textScale() {
    try {
      if (!window.DSESettings) return 1;
      const s = window.DSESettings.get();
      const n = s && typeof s.scale === 'number' ? s.scale : 1;
      return isFinite(n) && n > 0 ? n : 1;
    } catch (e) { return 1; }
  }

  function tokens() {
    if (cache) return cache;
    let cs = null;
    try { cs = getComputedStyle(root); } catch (e) { /* detached document */ }
    const v = n => {
      if (!cs) return '';
      try { return (cs.getPropertyValue(n) || '').trim(); } catch (e) { return ''; }
    };
    cache = {
      gain:   v('--gain'),
      loss:   v('--loss'),
      accent: v('--accent'),
      sans:   v('--sans'),
      mono:   v('--mono'),
      scale:  textScale(),
    };
    return cache;
  }

  function invalidate() { cache = null; }

  // ── Colours ────────────────────────────────────────────────────────
  // `fallback` is the call site's authored literal and is returned
  // whenever the token is missing, so nothing can render "undefined".
  function color(name, fallback) {
    const key = String(name).replace(/^--/, '');
    const t = tokens();
    return (Object.prototype.hasOwnProperty.call(t, key) ? t[key] : '') || fallback || '';
  }

  const gain = fb => color('gain', fb);
  const loss = fb => color('loss', fb);

  // Up/down in one call — the shape most candle/bar/volume code wants.
  function marketColors(upFallback, downFallback) {
    return { up: gain(upFallback), down: loss(downFallback) };
  }

  // Re-alpha a resolved token. Volume bars, Supertrend fills and Renko
  // projections are all "the gain/loss colour at N% opacity", which used
  // to be baked into a literal rgba() string.
  function alpha(colorStr, a) {
    if (!colorStr) return colorStr;
    const s = String(colorStr).trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      const h = m[1];
      return 'rgba(' + parseInt(h[0] + h[0], 16) + ',' + parseInt(h[1] + h[1], 16) +
             ',' + parseInt(h[2] + h[2], 16) + ',' + a + ')';
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
    if (m) return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')';
    return s;   // named colour / color-mix()/ gradient — leave alone
  }

  // ── Fonts ──────────────────────────────────────────────────────────
  // Canvas needs a CSS font shorthand, so the authored literal is parsed
  // rather than rebuilt: the family half is swapped for the resolved
  // --sans / --mono stack and the px size is multiplied by the text-size
  // setting. Anything that doesn't parse is returned verbatim.
  const FONT_RE = /^\s*(.*?)(\d*\.?\d+)px\s+(.+?)\s*$/;
  const MONO_RE = /mono|courier|menlo|consolas/i;

  function family(kind, fallback) {
    const t = tokens();
    return (kind === 'mono' ? t.mono : t.sans) || fallback || '';
  }

  function font(spec, kindOverride) {
    if (!spec) return spec;
    const m = FONT_RE.exec(String(spec));
    if (!m) return spec;
    const prefix   = m[1] || '';
    const size     = parseFloat(m[2]);
    const authored = m[3];
    if (!isFinite(size)) return spec;

    const kind = kindOverride || (MONO_RE.test(authored) ? 'mono' : 'sans');
    const stack = family(kind, authored);
    const px = Math.round(size * tokens().scale * 100) / 100;
    return prefix + px + 'px ' + stack;
  }

  // ── Change notification ────────────────────────────────────────────
  // Charts subscribe with their existing redraw function; calls are
  // coalesced into one frame so a settings save that touches several
  // properties still redraws once.
  const subscribers = [];
  let queued = false;

  function flush() {
    queued = false;
    for (let i = 0; i < subscribers.length; i++) {
      try { subscribers[i](); } catch (e) { console.warn('[chart-theme] redraw failed', e); }
    }
  }

  function notify() {
    invalidate();
    if (queued || !subscribers.length) return;
    queued = true;
    // rAF coalesces to one repaint per frame, but it is paused in a hidden
    // tab — and a cross-tab settings change arrives precisely when this tab
    // is in the background, so fall back to a timeout there.
    if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(flush);
    else setTimeout(flush, 0);
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function () {
      const i = subscribers.indexOf(fn);
      if (i >= 0) subscribers.splice(i, 1);
    };
  }

  document.addEventListener('dse-display-applied', notify);

  // The per-page theme toggle flips [data-theme] / .light-mode without
  // going through DSESettings, and display-settings writes its custom
  // properties to the inline style attribute — both change what the
  // tokens resolve to, so both have to drop the cache.
  try {
    new MutationObserver(invalidate).observe(root, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme'],
    });
  } catch (e) { /* no MutationObserver — cache simply stays warm */ }

  window.DSEChartTheme = {
    color, gain, loss, marketColors, alpha,
    font, family, scale: () => tokens().scale,
    onChange, refresh: invalidate,
  };
})();
