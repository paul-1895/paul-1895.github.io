/* ═══════════════════════════════════════════════════════════════════
   DSE — Global display settings
   Loaded in <head> of every page (last, after the stylesheets) so the
   user's preferences are in place before first paint.

   Covers typography, theme, accent + market colours, corner radius,
   table density and motion. Everything is edited from
   /settings/settings.html and persisted in localStorage.

   Three mechanisms, picked per setting:
   1. Custom properties — written !important inline on <html>. Beats
      every :root / [data-theme] block in the project, and the codebase
      already resolves 884 var(--accent), 738 var(--mono), 311
      var(--loss) … through exactly these names.
   2. CSSOM rewrite — for font metrics and cell padding, because those
      are literal px values in the stylesheets with no token to target.
      Authored values are cached per rule, so re-applying never
      compounds.
   3. Injected stylesheet — for reduced motion, which needs a blanket
      !important override.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const KEY        = 'dse-display-settings';
  const LEGACY_KEY = 'dse-font-settings';
  // One key for the light/dark preference, shared with theme/theme.js.
  const THEME_KEY  = 'dse-theme';
  // Retired duplicates. The project used to grow a new theme key per corner
  // (tasks/trades wrote 'dse_theme', newspaper/rgsnapshots 'theme-preference')
  // and this file papered over it by writing all three on every change. The
  // pages now share theme/theme.js, so all that is left is to adopt whatever
  // an existing install has stored — see migrateThemeKeys() below.
  const LEGACY_THEME_KEYS = ['dse_theme', 'theme-preference'];

  const DEFAULTS = {
    // Typography
    sans: 'default',
    mono: 'default',
    scale: 1,             // text size multiplier
    lineHeight: 1,        // line-height multiplier
    weight: 0,            // font-weight offset (-100 | 0 | 100)
    letterSpacing: 0,     // em, added to inherited text
    // Appearance
    theme: 'page',        // page | system | light | dark
    accent: 'default',
    market: 'classic',    // gain / loss palette
    radius: 'default',
    // Layout & motion
    density: 'default',      // table row padding
    tableHeaders: 'default', // default | sticky
    tableBorders: 'default', // default | reduced | none
    motion: 'default',       // default | reduced
    // App behaviour
    refresh: 'default',   // live-price polling: default | off | 30 | 60 | 300 | 600 (seconds)
    commission: 0.4,      // % per side, seeded into the calculators and backtests
    notifications: 'on',  // price-alert toasts and the header bell
  };

  // ── Registries ─────────────────────────────────────────────────────
  const FAMILIES = {
    sans: [
      { id: 'default',       label: 'Page default',   stack: null },
      { id: 'dm-sans',       label: 'DM Sans',        stack: "'DM Sans', system-ui, sans-serif",                              google: 'DM+Sans:wght@300;400;500;600;700' },
      { id: 'inter',         label: 'Inter',          stack: "'Inter', system-ui, sans-serif",                                google: 'Inter:wght@300;400;500;600;700' },
      { id: 'ibm-plex-sans', label: 'IBM Plex Sans',  stack: "'IBM Plex Sans', system-ui, sans-serif",                        google: 'IBM+Plex+Sans:wght@300;400;500;600;700' },
      { id: 'source-sans',   label: 'Source Sans 3',  stack: "'Source Sans 3', system-ui, sans-serif",                        google: 'Source+Sans+3:wght@300;400;500;600;700' },
      { id: 'syne',          label: 'Syne',           stack: "'Syne', system-ui, sans-serif",                                 google: 'Syne:wght@400;500;600;700' },
      { id: 'noto-sans',     label: 'Noto Sans',      stack: "'Noto Sans', system-ui, sans-serif",                            google: 'Noto+Sans:wght@300;400;500;600;700' },
      { id: 'system',        label: 'System UI',      stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
    ],
    mono: [
      { id: 'default',       label: 'Page default',   stack: null },
      { id: 'space-mono',    label: 'Space Mono',     stack: "'Space Mono', 'Menlo', monospace",                              google: 'Space+Mono:wght@400;700' },
      { id: 'ibm-plex-mono', label: 'IBM Plex Mono',  stack: "'IBM Plex Mono', 'Menlo', monospace",                           google: 'IBM+Plex+Mono:wght@300;400;500;600;700' },
      { id: 'jetbrains',     label: 'JetBrains Mono', stack: "'JetBrains Mono', 'Menlo', monospace",                          google: 'JetBrains+Mono:wght@300;400;500;600;700' },
      { id: 'roboto-mono',   label: 'Roboto Mono',    stack: "'Roboto Mono', 'Menlo', monospace",                             google: 'Roboto+Mono:wght@300;400;500;600;700' },
      { id: 'source-mono',   label: 'Source Code Pro',stack: "'Source Code Pro', 'Menlo', monospace",                         google: 'Source+Code+Pro:wght@300;400;500;600;700' },
      { id: 'system',        label: 'System Mono',    stack: "ui-monospace, 'SF Mono', Monaco, Menlo, 'Courier New', monospace" },
    ],
  };

  const THEMES = [
    { id: 'page',   label: 'Per page',  hint: 'Each page keeps its own toggle' },
    { id: 'system', label: 'System',    hint: 'Follow the operating system' },
    { id: 'light',  label: 'Light',     hint: 'Force light on every page' },
    { id: 'dark',   label: 'Dark',      hint: 'Force dark on every page' },
  ];

  // light / dark pairs, mirroring how shared/tokens.css lightens the accent for dark mode
  const ACCENTS = [
    { id: 'default', label: 'Steel Blue', light: null,      dark: null,     swatch: '#1a5cff' },
    { id: 'indigo',  label: 'Indigo',     light: '#4f46e5', dark: '#818cf8' },
    { id: 'teal',    label: 'Teal',       light: '#0d9488', dark: '#2dd4bf' },
    { id: 'violet',  label: 'Violet',     light: '#7c3aed', dark: '#a78bfa' },
    { id: 'amber',   label: 'Amber',      light: '#b45309', dark: '#f59e0b' },
    { id: 'rose',    label: 'Rose',       light: '#e11d48', dark: '#fb7185' },
    { id: 'slate',   label: 'Slate',      light: '#475569', dark: '#94a3b8' },
  ];

  const MARKETS = [
    { id: 'classic',    label: 'Classic',         note: 'Green up · red down',
      gain: { light: null, dark: null }, loss: { light: null, dark: null },
      swatch: { gain: '#0f9960', loss: '#d13f3f' } },
    { id: 'colorblind', label: 'Colour-blind safe', note: 'Blue up · orange down (Okabe–Ito)',
      gain: { light: '#0072b2', dark: '#56b4e9' }, loss: { light: '#d55e00', dark: '#e69f45' } },
    { id: 'contrast',   label: 'High contrast',   note: 'Deeper green · deeper red',
      gain: { light: '#047857', dark: '#34d399' }, loss: { light: '#b91c1c', dark: '#f87171' } },
  ];

  const RADII = [
    { id: 'default', label: 'Default', values: null },
    { id: 'sharp',   label: 'Sharp',   values: { sm: 2,  md: 3,  lg: 4  } },
    { id: 'soft',    label: 'Soft',    values: { sm: 10, md: 16, lg: 22 } },
  ];

  const HEADER_STYLES = [
    { id: 'default', label: 'Default' },
    { id: 'sticky',  label: 'Sticky'  },
  ];

  const BORDER_STYLES = [
    { id: 'default', label: 'Default' },
    { id: 'reduced', label: 'Reduced' },
    { id: 'none',    label: 'None'    },
  ];

  const REFRESHES = [
    { id: 'default', label: 'Page default', seconds: null },
    { id: '30',      label: '30 seconds',   seconds: 30   },
    { id: '60',      label: '1 minute',     seconds: 60   },
    { id: '300',     label: '5 minutes',    seconds: 300  },
    { id: '600',     label: '10 minutes',   seconds: 600  },
    { id: 'off',     label: 'Off',          seconds: 0    },
  ];

  const DENSITIES = [
    { id: 'compact',  label: 'Compact',  factor: 0.6  },
    { id: 'default',  label: 'Default',  factor: 1    },
    { id: 'spacious', label: 'Spacious', factor: 1.45 },
  ];

  const pick = (list, id) => list.find(x => x.id === id) || list[0];
  const family = (kind, id) => FAMILIES[kind].find(f => f.id === id) || FAMILIES[kind][0];

  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round2 = v => Math.round(v * 100) / 100;

  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')';
  }

  // ── State ──────────────────────────────────────────────────────────
  function read() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY)) || {};
    } catch (e) { saved = {}; }
    const s = Object.assign({}, DEFAULTS, saved);
    s.scale         = clamp(num(s.scale, 1), 0.8, 1.5);
    s.lineHeight    = clamp(num(s.lineHeight, 1), 0.85, 1.4);
    s.weight        = clamp(num(s.weight, 0), -100, 100);
    s.letterSpacing = clamp(num(s.letterSpacing, 0), -0.03, 0.08);
    s.commission    = clamp(num(s.commission, DEFAULTS.commission), 0, 10);
    return s;
  }

  function save(patch) {
    const next = Object.assign(read(), patch);
    localStorage.setItem(KEY, JSON.stringify(next));
    apply(next);
    return next;
  }

  function reset() {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
    const d = Object.assign({}, DEFAULTS);
    apply(d);
    return d;
  }

  function isDefault(s) {
    return Object.keys(DEFAULTS).every(k => s[k] === DEFAULTS[k]);
  }

  // ── Web fonts ──────────────────────────────────────────────────────
  function ensureWebFont(def) {
    if (!def || !def.google) return;
    const id = 'dse-webfont-' + def.id;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + def.google + '&display=swap';
    document.head.appendChild(link);
  }

  // ── Theme ──────────────────────────────────────────────────────────
  function systemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function resolveTheme(s) {
    if (s.theme === 'light' || s.theme === 'dark') return s.theme;
    if (s.theme === 'system') return systemTheme();
    return null;   // 'page' — leave each page's own toggle alone
  }

  function writeTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }
  }

  // One-shot migration off the retired keys, run in the <head> of every page
  // before anything reads the theme. A value already under 'dse-theme' wins;
  // otherwise the first legacy value found is adopted so an existing install
  // keeps the theme it was last left on. Either way the old keys are dropped,
  // which is what makes this run exactly once.
  function migrateThemeKeys() {
    let adopted = null;
    try {
      const existing = localStorage.getItem(THEME_KEY);
      LEGACY_THEME_KEYS.forEach(k => {
        const v = localStorage.getItem(k);
        if (v === null) return;
        if (!adopted && (v === 'light' || v === 'dark')) adopted = v;
        localStorage.removeItem(k);
      });
      if (adopted && existing !== 'light' && existing !== 'dark') {
        localStorage.setItem(THEME_KEY, adopted);
        return adopted;
      }
    } catch (e) { /* private mode */ }
    return null;
  }

  // Which palette (light or dark) should the accent and market colours use?
  // Not every page opts into [data-theme]: Candlestick is dark-by-default from
  // :root and switches with a .light-mode class, so trusting the attribute
  // alone picked the LIGHT variants on a near-black page.
  function currentTheme() {
    const root = document.documentElement;
    const attr = root.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;

    const hasClass = name =>
      root.classList.contains(name) || (document.body && document.body.classList.contains(name));
    if (hasClass('light-mode')) return 'light';
    if (hasClass('dark-mode')) return 'dark';

    // Last resort before the OS setting: read what the page actually paints.
    if (document.body) {
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(document.body).backgroundColor);
      if (m) {
        const p = m[1].split(',').map(Number);
        const opaque = p[3] === undefined || p[3] > 0.1;
        if (opaque) return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 < 0.5 ? 'dark' : 'light';
      }
    }
    return systemTheme();
  }

  let applyingTheme = false;

  function applyTheme(s) {
    const forced = resolveTheme(s);
    if (!forced) return;
    applyingTheme = true;
    writeTheme(forced);
    document.documentElement.setAttribute('data-theme', forced);
    applyingTheme = false;
  }

  // A page's own header toggle already persists through theme/theme.js, but a
  // handful of views flip [data-theme] directly without going through it, so
  // keep mirroring the attribute into the key. Also the hook for keeping a
  // forced light/dark Settings choice and the accent/market colours in step.
  function watchThemeChanges() {
    new MutationObserver(() => {
      if (applyingTheme) return;
      const t = document.documentElement.getAttribute('data-theme');
      if (t !== 'light' && t !== 'dark') return;
      writeTheme(t);
      if (current.theme === 'light' || current.theme === 'dark') {
        current.theme = t;
        localStorage.setItem(KEY, JSON.stringify(current));
      }
      applyColors(current);   // accent + market colours differ per theme
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  }

  // ── Custom properties on <html> ────────────────────────────────────
  const root = () => document.documentElement;

  function setVar(name, value) {
    if (value) root().style.setProperty(name, value, 'important');
    else root().style.removeProperty(name);
  }

  function applyFamilies(s) {
    const sans = family('sans', s.sans);
    const mono = family('mono', s.mono);
    ensureWebFont(sans);
    ensureWebFont(mono);

    // --display is Portfolio Manager's heading alias; --np-serif (newspaper
    // masthead) is left alone, it is a deliberate editorial serif.
    setVar('--sans', sans.stack);
    setVar('--display', sans.stack);
    setVar('--mono', mono.stack);

    // Not !important: rules with deliberate tracking (uppercase labels) keep theirs.
    if (s.letterSpacing) root().style.setProperty('letter-spacing', s.letterSpacing + 'em');
    else root().style.removeProperty('letter-spacing');
  }

  function applyColors(s) {
    const dark = currentTheme() === 'dark';
    const accent = pick(ACCENTS, s.accent);
    const a = dark ? accent.dark : accent.light;

    setVar('--accent', a);
    setVar('--accent-dim',    a && rgba(a, dark ? 0.16 : 0.10));
    setVar('--accent-glow',   a && rgba(a, 0.35));
    setVar('--accent-light',  a && rgba(a, 0.55));
    setVar('--accent-border', a && rgba(a, 0.45));
    setVar('--border-glow',   a && rgba(a, 0.30));

    const market = pick(MARKETS, s.market);
    const g = dark ? market.gain.dark : market.gain.light;
    const l = dark ? market.loss.dark : market.loss.light;
    setVar('--gain', g);
    setVar('--loss', l);
    setVar('--gain-bg', g && rgba(g, dark ? 0.18 : 0.12));
    setVar('--loss-bg', l && rgba(l, dark ? 0.18 : 0.12));
  }

  function applyRadius(s) {
    const r = pick(RADII, s.radius).values;
    setVar('--radius-sm', r && r.sm + 'px');
    setVar('--radius-md', r && r.md + 'px');
    setVar('--radius-lg', r && r.lg + 'px');
    setVar('--radius',    r && r.sm + 'px');
  }

  // ── Table chrome ───────────────────────────────────────────────────
  function tableCSS(s) {
    const parts = [];
    if (s.tableHeaders === 'sticky') {
      parts.push('table thead th { position: sticky; top: 0; z-index: 4;' +
                 ' background: var(--bg-card, #fff); }');
    }
    if (s.tableBorders === 'reduced') {
      parts.push('table td, table th { border-left-color: transparent !important;' +
                 ' border-right-color: transparent !important; }');
    } else if (s.tableBorders === 'none') {
      parts.push('table td, table th { border-color: transparent !important; }');
    }
    return parts.join('\n');
  }

  function applyTables(s) {
    const css = tableCSS(s);
    let el = document.getElementById('dse-table-style');
    if (!css) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('style');
      el.id = 'dse-table-style';
      (document.head || root()).appendChild(el);
    }
    el.textContent = css;
  }

  // ── Reduced motion ─────────────────────────────────────────────────
  const MOTION_CSS =
    '*, *::before, *::after {' +
    ' animation-duration: 0.01ms !important;' +
    ' animation-iteration-count: 1 !important;' +
    ' transition-duration: 0.01ms !important;' +
    ' scroll-behavior: auto !important; }';

  function applyMotion(s) {
    const existing = document.getElementById('dse-reduce-motion');
    if (s.motion === 'reduced') {
      if (existing) return;
      const style = document.createElement('style');
      style.id = 'dse-reduce-motion';
      style.textContent = MOTION_CSS;
      (document.head || root()).appendChild(style);
    } else if (existing) {
      existing.remove();
    }
  }

  // ── CSSOM rewrite: font metrics + cell padding ─────────────────────
  const ORIGINAL = new WeakMap();   // CSSStyleRule -> authored values

  function eachStyleRule(node, fn) {
    let rules;
    try { rules = node.cssRules; } catch (e) { return; }   // cross-origin sheet
    if (!rules) return;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.style && r.selectorText) fn(r);
      else if (r.cssRules) eachStyleRule(r, fn);           // @media / @supports / @layer
    }
  }

  const SKIP_FAMILY = /^(inherit|initial|unset|revert|)$/i;
  const CELL_SELECTOR = /(^|[\s,>+~])[.#a-z0-9_-]*\b(td|th)\b/i;

  function remapFamily(value, sansStack, monoStack) {
    if (!value) return null;
    const v = value.trim();
    if (SKIP_FAMILY.test(v) || v.indexOf('var(') !== -1) return null;  // var(--sans) already covered
    const low = v.toLowerCase();
    if (/mono|courier|menlo|consolas/.test(low)) return monoStack;
    if (/serif/.test(low) && !/sans-serif/.test(low)) return null;      // leave deliberate serifs (newspaper)
    return sansStack;
  }

  function normalizeWeight(w) {
    const v = String(w).trim().toLowerCase();
    if (v === 'bold') return 700;
    if (v === 'normal') return 400;
    const n = parseInt(v, 10);
    return isFinite(n) ? n : null;
  }

  // Scales the vertical halves of a padding shorthand ("7px 8px" -> "10px 8px").
  function scalePadding(value, f) {
    const parts = value.trim().split(/\s+/);
    if (!parts.length || parts.length > 4) return null;
    const scaleOne = p => {
      const m = /^([\d.]+)px$/.exec(p);
      return m ? round2(parseFloat(m[1]) * f) + 'px' : p;
    };
    if (parts.length === 1) return scaleOne(parts[0]);
    parts[0] = scaleOne(parts[0]);
    if (parts.length >= 3) parts[2] = scaleOne(parts[2]);
    return parts.join(' ');
  }

  let bodyHasFontSize = false;
  let bodyHasFontFamily = false;

  function applyToRule(rule, s, sansStack, monoStack, density) {
    let orig = ORIGINAL.get(rule);
    if (!orig) {
      orig = {
        fs: rule.style.fontSize,
        lh: rule.style.lineHeight,
        fw: rule.style.fontWeight,
        ff: rule.style.fontFamily,
        pad: rule.style.padding,
        padT: rule.style.paddingTop,
        padB: rule.style.paddingBottom,
      };
      ORIGINAL.set(rule, orig);
    }
    const st = rule.style;

    if (document.body && ((orig.fs && !bodyHasFontSize) || (orig.ff && !bodyHasFontFamily))) {
      let hit = false;
      try { hit = document.body.matches(rule.selectorText); } catch (e) { /* exotic selector */ }
      if (hit) {
        if (orig.fs) bodyHasFontSize = true;
        if (orig.ff) bodyHasFontFamily = true;
      }
    }

    if (orig.fs && s.scale !== 1) {
      const m = /^([\d.]+)px$/.exec(orig.fs.trim());
      if (m) st.setProperty('font-size', round2(parseFloat(m[1]) * s.scale) + 'px', st.getPropertyPriority('font-size'));
    } else if (orig.fs) {
      st.setProperty('font-size', orig.fs, st.getPropertyPriority('font-size'));
    }

    if (orig.lh && s.lineHeight !== 1) {
      const raw = orig.lh.trim();
      const px = /^([\d.]+)px$/.exec(raw);
      const unitless = /^([\d.]+)$/.exec(raw);
      if (px) st.setProperty('line-height', round2(parseFloat(px[1]) * s.lineHeight) + 'px', st.getPropertyPriority('line-height'));
      else if (unitless) st.setProperty('line-height', round2(parseFloat(unitless[1]) * s.lineHeight), st.getPropertyPriority('line-height'));
    } else if (orig.lh) {
      st.setProperty('line-height', orig.lh, st.getPropertyPriority('line-height'));
    }

    if (orig.fw && s.weight !== 0) {
      const w = normalizeWeight(orig.fw);
      if (w !== null) st.setProperty('font-weight', String(clamp(w + s.weight, 100, 900)), st.getPropertyPriority('font-weight'));
    } else if (orig.fw) {
      st.setProperty('font-weight', orig.fw, st.getPropertyPriority('font-weight'));
    }

    if (orig.ff) {
      const remapped = (sansStack || monoStack) ? remapFamily(orig.ff, sansStack, monoStack) : null;
      st.setProperty('font-family', remapped || orig.ff, st.getPropertyPriority('font-family'));
    }

    // Density: table cells only — scaling every padding in the project would
    // reflow layouts that have nothing to do with row height.
    if (orig.pad || orig.padT || orig.padB) {
      const isCell = density !== 1 && CELL_SELECTOR.test(rule.selectorText);
      if (orig.pad) {
        const v = isCell ? scalePadding(orig.pad, density) : null;
        st.setProperty('padding', v || orig.pad, st.getPropertyPriority('padding'));
      }
      if (orig.padT) {
        const v = isCell ? scalePadding(orig.padT, density) : null;
        st.setProperty('padding-top', v || orig.padT, st.getPropertyPriority('padding-top'));
      }
      if (orig.padB) {
        const v = isCell ? scalePadding(orig.padB, density) : null;
        st.setProperty('padding-bottom', v || orig.padB, st.getPropertyPriority('padding-bottom'));
      }
    }
  }

  function applyMetrics(s) {
    const sansStack = family('sans', s.sans).stack;
    const monoStack = family('mono', s.mono).stack;
    const density   = pick(DENSITIES, s.density).factor;
    const sheets    = document.styleSheets;

    bodyHasFontSize = false;
    bodyHasFontFamily = false;
    if (document.body) {
      document.body.style.removeProperty('font-size');
      document.body.style.removeProperty('font-family');
    }

    for (let i = 0; i < sheets.length; i++) {
      eachStyleRule(sheets[i], r => applyToRule(r, s, sansStack, monoStack, density));
    }

    // Some pages never set a body font-size and inherit the browser's 16px —
    // nothing for the pass above to scale, so anchor it here instead.
    if (document.body && !bodyHasFontSize && s.scale !== 1) {
      const base = parseFloat(getComputedStyle(document.body).fontSize) || 16;
      document.body.style.setProperty('font-size', round2(base * s.scale) + 'px');
    }

    // Likewise for pages that declare no body font-family at all (e.g. one
    // whose own stylesheet 404s) — otherwise they sit on the browser serif.
    if (document.body && !bodyHasFontFamily && sansStack) {
      document.body.style.setProperty('font-family', sansStack);
    }
  }

  function needsMetrics(s) {
    return s.scale !== 1 || s.lineHeight !== 1 || s.weight !== 0 ||
           s.sans !== 'default' || s.mono !== 'default' || s.density !== 'default';
  }

  // ── Apply ──────────────────────────────────────────────────────────
  const timers = [];
  let current = read();
  let touched = false;   // did we ever rewrite the CSSOM?

  function apply(s) {
    current = s || read();
    applyTheme(current);
    applyFamilies(current);
    applyColors(current);
    applyRadius(current);
    applyTables(current);
    applyMotion(current);
    if (needsMetrics(current) || touched) {
      touched = true;
      applyMetrics(current);
    }
    timers.forEach(armTimer);
    document.dispatchEvent(new CustomEvent('dse-display-applied', { detail: current }));
  }

  // Stylesheets that arrive after us (injected <style>, lazy <link>).
  let pending = null;
  function reapplySoon() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; if (touched) applyMetrics(current); }, 30);
  }

  function watchLateStyles() {
    new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'STYLE') reapplySoon();
          else if (node.tagName === 'LINK' && node.rel === 'stylesheet') node.addEventListener('load', reapplySoon);
        }
      }
    }).observe(root(), { childList: true, subtree: true });
  }

  migrateThemeKeys();
  apply(current);
  watchThemeChanges();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyMotion(current);
      applyTables(current);
      applyColors(current);   // body exists now — background-based detection can run
      reapplySoon();
      watchLateStyles();
    });
  } else {
    reapplySoon();
    watchLateStyles();
  }
  window.addEventListener('load', reapplySoon);

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (current.theme === 'system') apply(current);
    });
  }

  // Live sync: changing settings in one tab updates every other open tab.
  window.addEventListener('storage', e => { if (e.key === KEY) apply(read()); });

  // ── App behaviour helpers ──────────────────────────────────────────
  // Polling sites call everyRefresh() instead of setInterval() so the
  // interval can be re-armed when the setting changes, without a reload.
  function refreshMs(defaultMs) {
    const r = pick(REFRESHES, current.refresh);
    if (r.seconds === null) return defaultMs;   // 'Page default'
    return r.seconds === 0 ? null : r.seconds * 1000;   // null = off
  }

  function armTimer(t) {
    if (t.handle) { clearInterval(t.handle); t.handle = null; }
    const ms = refreshMs(t.defaultMs);
    if (ms) t.handle = setInterval(t.fn, ms);
  }

  function everyRefresh(defaultMs, fn) {
    const t = { defaultMs, fn, handle: null };
    timers.push(t);
    armTimer(t);
    return { stop() { if (t.handle) clearInterval(t.handle); t.handle = null; } };
  }

  function commission() { return current.commission; }
  function notificationsEnabled() { return current.notifications !== 'off'; }

  window.DSESettings = {
    KEY, DEFAULTS, FAMILIES, THEMES, ACCENTS, MARKETS, RADII, DENSITIES,
    REFRESHES, HEADER_STYLES, BORDER_STYLES,
    get: read, save, apply, reset, isDefault, currentTheme,
    refreshMs, everyRefresh, commission, notificationsEnabled,
  };
})();
