'use strict';

/* Runs shared/display-settings.js in a stubbed browser. The engine sits in
   the <head> of every page, so a regression here is not "the settings page
   looks off" — it is every page mis-rendering before first paint. The stub
   carries exactly the DOM surface the engine touches. */

const { test } = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const path   = require('node:path');
const vm     = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, 'display-settings.js'), 'utf8');
const KEY = 'dse-display-settings';

function makeStorage(seed, { readOnly = false } = {}) {
  const map = new Map(Object.entries(seed || {}));
  return {
    get length() { return map.size; },
    key: i => Array.from(map.keys())[i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      if (readOnly) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem: k => { map.delete(k); },
    clear: () => map.clear(),
    _map: map,
  };
}

function makeWindow({ storage = makeStorage(), hidden = false } = {}) {
  const listeners = {};
  const on = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const byId = new Map();

  const styleOf = () => {
    const props = {};
    return {
      _props: props,
      setProperty(n, v) { props[n] = v; },
      removeProperty(n) { delete props[n]; },
      getPropertyPriority: () => '',
    };
  };
  const classListOf = () => {
    const set = new Set();
    return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) };
  };
  const el = tag => ({
    tagName: String(tag || 'div').toUpperCase(),
    id: '', textContent: '', innerHTML: '', attrs: {}, children: [],
    style: styleOf(), classList: classListOf(),
    setAttribute(n, v) { this.attrs[n] = String(v); },
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
    hasAttribute(n) { return n in this.attrs; },
    removeAttribute(n) { delete this.attrs[n]; },
    appendChild(c) { this.children.push(c); if (c.id) byId.set(c.id, c); return c; },
    remove() { byId.delete(this.id); },
    addEventListener() {},
    matches: () => false,
  });

  const intervals = [];
  const document = {
    readyState: 'complete', hidden,
    documentElement: el('html'), head: el('head'), body: el('body'),
    styleSheets: [],
    getElementById: id => byId.get(id) || null,
    createElement: el,
    addEventListener: on,
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach(fn => fn(ev)); return true; },
  };

  const win = {
    document,
    localStorage: storage,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({
      getPropertyValue: () => '',
      backgroundColor: 'rgb(255, 255, 255)',
      fontSize: '16px',
    }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    setInterval(fn, ms) { const id = intervals.length + 1; intervals.push({ id, fn, ms, cleared: false }); return id; },
    clearInterval(id) { const t = intervals.find(x => x.id === id); if (t) t.cleared = true; },
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener: on,
    console,
    // test handles
    _fire: (type, ev) => (listeners[type] || []).forEach(fn => fn(ev || { type })),
    _intervals: intervals,
    _live: () => intervals.filter(t => !t.cleared),
  };
  win.window = win;
  return win;
}

function boot(opts) {
  const win = makeWindow(opts);
  vm.createContext(win);
  vm.runInContext(SRC, win);
  return win;
}

const stored = win => JSON.parse(win.localStorage.getItem(KEY));
// Objects born inside the vm context carry that realm's Object.prototype,
// which deepStrictEqual treats as a different type; flatten before comparing.
const plain = o => JSON.parse(JSON.stringify(o));

// ─── READ / SANITIZE ─────────────────────────────────────────────────────────

test('empty storage yields exactly the defaults', () => {
  const w = boot();
  assert.deepStrictEqual(plain(w.DSESettings.get()), plain(w.DSESettings.DEFAULTS));
});

test('corrupt JSON in storage falls back to the defaults instead of throwing', () => {
  const w = boot({ storage: makeStorage({ [KEY]: '{not json' }) });
  assert.deepStrictEqual(plain(w.DSESettings.get()), plain(w.DSESettings.DEFAULTS));
});

test('unknown ids, out-of-range numbers and stray keys are sanitised on read', () => {
  const w = boot({ storage: makeStorage({ [KEY]: JSON.stringify({
    theme: 'sepia',          // not a registry id -> default
    accent: 'teal',          // valid -> kept
    scale: 9,                // above the cap -> clamped
    weight: 40,              // not a whole step -> snapped
    letterSpacing: 'abc',    // not a number -> default
    commission: -1,          // below the floor -> clamped
    tableBorders: 'none',    // valid -> kept
    bogus: 1,                // not a setting -> dropped
  }) }) });
  const s = w.DSESettings.get();
  assert.strictEqual(s.theme, 'page');
  assert.strictEqual(s.accent, 'teal');
  assert.strictEqual(s.scale, 1.5);
  assert.strictEqual(s.weight, 0);
  assert.strictEqual(s.letterSpacing, 0);
  assert.strictEqual(s.commission, 0);
  assert.strictEqual(s.tableBorders, 'none');
  assert.ok(!('bogus' in s));
});

test('numeric strings from a hand-edited file are accepted', () => {
  const w = boot();
  assert.deepStrictEqual(plain(w.DSESettings.sanitize({ scale: '1.2', weight: '-100' })), { scale: 1.2, weight: -100 });
});

test('every registry id round-trips through sanitize', () => {
  const S = boot().DSESettings;
  const lists = {
    theme: S.THEMES, sans: S.FAMILIES.sans, mono: S.FAMILIES.mono, accent: S.ACCENTS,
    market: S.MARKETS, radius: S.RADII, density: S.DENSITIES, tableHeaders: S.HEADER_STYLES,
    tableBorders: S.BORDER_STYLES, tableStripes: S.STRIPE_STYLES, numerals: S.NUMERAL_STYLES,
    motion: S.MOTIONS, refresh: S.REFRESHES, refreshHidden: S.HIDDEN_REFRESHES,
    notifications: S.NOTIFICATIONS,
  };
  for (const [k, list] of Object.entries(lists)) {
    for (const item of list) {
      assert.deepStrictEqual(plain(S.sanitize({ [k]: item.id })), { [k]: item.id }, `${k}=${item.id}`);
    }
    assert.ok(list.some(x => x.id === S.DEFAULTS[k]), `default for ${k} must be in its registry`);
  }
});

// ─── SAVE ────────────────────────────────────────────────────────────────────

test('save() merges a patch, persists it, and drops an invalid value from the patch', () => {
  const w = boot();
  const S = w.DSESettings;
  S.save({ density: 'compact', refresh: '60' });
  assert.strictEqual(stored(w).density, 'compact');
  assert.strictEqual(S.get().refresh, '60');

  const next = S.save({ density: 'huge' });
  assert.strictEqual(next.density, 'compact', 'an unknown id must not replace a good value');
});

test('save() survives a read-only localStorage', () => {
  const S = boot({ storage: makeStorage({}, { readOnly: true }) }).DSESettings;
  let next;
  assert.doesNotThrow(() => { next = S.save({ scale: 1.2 }); });
  assert.strictEqual(next.scale, 1.2, 'the in-memory result still applies for this page load');
});

test('reset() clears both the current and the legacy key', () => {
  const w = boot({ storage: makeStorage({ [KEY]: '{"scale":1.3}', 'dse-font-settings': '{"scale":1.1}' }) });
  assert.strictEqual(w.DSESettings.get().scale, 1.3);
  w.DSESettings.reset();
  assert.strictEqual(w.localStorage.getItem(KEY), null);
  assert.strictEqual(w.localStorage.getItem('dse-font-settings'), null);
  assert.strictEqual(w.DSESettings.get().scale, 1);
});

// ─── BACKUP FORMAT ───────────────────────────────────────────────────────────

test('exportable() wraps the settings; importable() unwraps the envelope, a bare object, and rejects junk', () => {
  const S = boot().DSESettings;
  const env = S.exportable({ accent: 'rose', scale: 1.1 });
  assert.strictEqual(env.app, 'dse-settings');
  assert.strictEqual(env.version, S.EXPORT_VERSION);
  assert.deepStrictEqual(plain(S.importable(env)), { accent: 'rose', scale: 1.1 });
  assert.deepStrictEqual(plain(S.importable({ accent: 'rose' })), { accent: 'rose' });
  assert.throws(() => S.importable({ foo: 1 }), /no recognised settings/);
  assert.throws(() => S.importable('nope'), /no recognised settings/);
  assert.throws(() => S.importable({ accent: 'not-a-colour' }), /no recognised settings/);
});

// ─── POLLING ─────────────────────────────────────────────────────────────────

test('refreshMs maps the setting onto the caller\'s page default', () => {
  const S = boot().DSESettings;
  assert.strictEqual(S.refreshMs(5000), 5000);
  S.save({ refresh: '60' });
  assert.strictEqual(S.refreshMs(5000), 60000);
  S.save({ refresh: 'off' });
  assert.strictEqual(S.refreshMs(5000), null);
});

test('everyRefresh re-arms when the setting changes but never after stop()', () => {
  const w = boot();
  const S = w.DSESettings;
  const h = S.everyRefresh(5000, () => {});
  assert.deepStrictEqual(w._live().map(t => t.ms), [5000]);

  S.save({ refresh: '30' });
  assert.deepStrictEqual(w._live().map(t => t.ms), [30000], 'old interval cleared, new one armed');

  h.stop();
  assert.deepStrictEqual(w._live(), [], 'stop() clears the interval');
  S.save({ refresh: '60' });
  assert.deepStrictEqual(w._live(), [], 'a later save must not resurrect a stopped timer');
});

test('a hidden tab skips the poll and runs the missed tick once when shown', () => {
  const w = boot({ hidden: true });
  const S = w.DSESettings;
  let calls = 0;
  S.everyRefresh(1000, () => { calls++; });

  w._live()[0].fn();
  assert.strictEqual(calls, 0, 'hidden: the poll is held');

  w.document.hidden = false;
  w._fire('visibilitychange');
  assert.strictEqual(calls, 1, 'shown: the missed tick catches up');
  w._fire('visibilitychange');
  assert.strictEqual(calls, 1, 'a second visibility event must not double-fire');

  w.document.hidden = true;
  S.save({ refreshHidden: 'continue' });
  w._live()[0].fn();
  assert.strictEqual(calls, 2, '"Keep polling" ignores visibility');
});

// ─── THEME ───────────────────────────────────────────────────────────────────

test('legacy theme keys are folded into dse-theme once and then removed', () => {
  const w = boot({ storage: makeStorage({ dse_theme: 'dark' }) });
  assert.strictEqual(w.localStorage.getItem('dse-theme'), 'dark');
  assert.strictEqual(w.localStorage.getItem('dse_theme'), null);
});

test('an existing dse-theme wins over a legacy value', () => {
  const w = boot({ storage: makeStorage({ 'dse-theme': 'light', 'theme-preference': 'dark' }) });
  assert.strictEqual(w.localStorage.getItem('dse-theme'), 'light');
  assert.strictEqual(w.localStorage.getItem('theme-preference'), null);
});

test('a dse-theme change in another tab flips [data-theme] here, but only on pages that use it', () => {
  const w = boot();
  w.document.documentElement.setAttribute('data-theme', 'light');
  w._fire('storage', { key: 'dse-theme', newValue: 'dark' });
  assert.strictEqual(w.document.documentElement.getAttribute('data-theme'), 'dark');

  const c = boot();   // Candlestick-style page: no [data-theme] at all
  c._fire('storage', { key: 'dse-theme', newValue: 'dark' });
  assert.ok(!c.document.documentElement.hasAttribute('data-theme'));
});

// ─── INJECTED SHEET ──────────────────────────────────────────────────────────

test('tabular numerals and zebra stripes inject a sheet; all-default removes it', () => {
  const w = boot();
  const S = w.DSESettings;
  const sheet = () => w.document.getElementById('dse-table-style');

  assert.strictEqual(sheet(), null, 'defaults inject nothing');
  S.save({ numerals: 'tabular' });
  assert.match(sheet().textContent, /tabular-nums/);
  assert.doesNotMatch(sheet().textContent, /nth-child/);

  S.save({ numerals: 'default', tableStripes: 'zebra' });
  assert.match(sheet().textContent, /nth-child\(even\)/);
  assert.doesNotMatch(sheet().textContent, /tabular-nums/);

  S.save({ tableStripes: 'default' });
  assert.strictEqual(sheet(), null);
});
