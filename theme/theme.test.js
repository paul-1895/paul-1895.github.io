'use strict';

// theme.js is an ES module that Node's require(esm) support loads directly
// (like curated-data.test.js), but it references the bare browser globals
// `document`, `window` and `localStorage` inside its functions with no
// injection point. Those are free identifiers resolved against the Node
// global object at call time (not at require-time — nothing here touches
// them at module scope), so installing minimal fakes on `global` *before*
// each call is enough; no jsdom or vm sandbox needed.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const TARGET_PATH = require.resolve('./theme.js');

function makeElement() {
  return { textContent: '' };
}

function makeFakeGlobals({ prefersDark = false, storage = {}, elements = {} } = {}) {
  const attrs = {};
  const store = { ...storage };
  global.window = { matchMedia: (q) => ({ matches: q.includes('dark') && prefersDark }) };
  global.document = {
    documentElement: {
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => { attrs[k] = v; },
    },
    getElementById: (id) => elements[id] || null,
  };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  return { attrs, store };
}

beforeEach(() => {
  delete require.cache[TARGET_PATH];
  delete global.window;
  delete global.document;
  delete global.localStorage;
});

describe('THEME_KEY', () => {
  test('is the single shared localStorage key', () => {
    const { THEME_KEY } = require('./theme.js');
    assert.equal(THEME_KEY, 'dse-theme');
  });
});

describe('initTheme', () => {
  test('uses a valid saved preference over the OS preference', () => {
    makeFakeGlobals({ prefersDark: true, storage: { 'dse-theme': 'light' } });
    const { initTheme } = require('./theme.js');
    const theme = initTheme();
    assert.equal(theme, 'light');
    assert.equal(global.document.documentElement.getAttribute('data-theme'), 'light');
  });

  test('falls back to the OS dark preference when nothing is saved', () => {
    makeFakeGlobals({ prefersDark: true });
    const { initTheme } = require('./theme.js');
    assert.equal(initTheme(), 'dark');
  });

  test('falls back to light when nothing is saved and the OS has no dark preference', () => {
    makeFakeGlobals({ prefersDark: false });
    const { initTheme } = require('./theme.js');
    assert.equal(initTheme(), 'light');
  });

  test('ignores a garbage stored value and falls back to the OS preference', () => {
    makeFakeGlobals({ prefersDark: false, storage: { 'dse-theme': 'sepia' } });
    const { initTheme } = require('./theme.js');
    assert.equal(initTheme(), 'light');
  });

  test('updates the optional icon/label elements when present', () => {
    const icon = makeElement(), label = makeElement();
    makeFakeGlobals({ storage: { 'dse-theme': 'light' }, elements: { 'theme-icon': icon, 'theme-label': label } });
    const { initTheme } = require('./theme.js');
    initTheme();
    assert.equal(icon.textContent, '🌙');
    assert.equal(label.textContent, 'Dark');
  });

  test('tolerates a localStorage that throws (private-browsing mode)', () => {
    makeFakeGlobals({ prefersDark: false });
    global.localStorage.getItem = () => { throw new Error('SecurityError'); };
    const { initTheme } = require('./theme.js');
    assert.equal(initTheme(), 'light');
  });
});

describe('toggleTheme', () => {
  test('flips light to dark and persists it', () => {
    makeFakeGlobals({ storage: { 'dse-theme': 'light' } });
    global.document.documentElement.setAttribute('data-theme', 'light');
    const { toggleTheme } = require('./theme.js');
    const result = toggleTheme();
    assert.equal(result, 'dark');
    assert.equal(global.document.documentElement.getAttribute('data-theme'), 'dark');
  });

  test('flips dark to light (absent attribute counts as dark)', () => {
    makeFakeGlobals();
    const { toggleTheme } = require('./theme.js');
    assert.equal(toggleTheme(), 'light');
  });

  test('invokes the onThemeChange callback with the new theme, ignoring a non-function arg', () => {
    makeFakeGlobals();
    const { toggleTheme } = require('./theme.js');
    let seen;
    toggleTheme((t) => { seen = t; });
    assert.equal(seen, 'light');
    assert.doesNotThrow(() => toggleTheme({ type: 'click' })); // event object, not a callback
  });

  test('tolerates a localStorage.setItem that throws', () => {
    makeFakeGlobals();
    global.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    const { toggleTheme } = require('./theme.js');
    assert.doesNotThrow(() => toggleTheme());
  });
});
