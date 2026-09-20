'use strict';

// header-component.js is an ES module Node's require(esm) support loads
// directly (like theme.test.js / curated-data.test.js), but at MODULE LOAD
// TIME (not just inside functions) it reads `window.openWatchlistPanel` etc.
// and installs stub globals when they're missing — so a fake `window` must
// exist on the Node global object *before* the very first require(). We
// therefore bust the require cache and rebuild the fake globals in
// beforeEach so each test gets a clean module instance and DOM.
//
// Note this file's own theme functions (toggleTheme/applyTheme/
// getCurrentTheme/isLightMode) use a DIFFERENT mechanism than theme.js: a
// `light-mode` class on <html>, not a `data-theme` attribute. The two aren't
// used on the same page, so that's not a bug, just a second, older
// convention this component only.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const TARGET_PATH = require.resolve('./header-component.js');

function makeElement(overrides = {}) {
  return { textContent: '', ...overrides };
}

function makeClassList(initial = []) {
  const classes = new Set(initial);
  return {
    classes,
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };
}

function makeFakeGlobals({ elements = {}, storage = {}, lightMode = false } = {}) {
  const store = { ...storage };
  const bodyHtml = { inserted: null };
  global.window = {};
  global.document = {
    documentElement: { classList: makeClassList(lightMode ? ['light-mode'] : []) },
    body: { insertAdjacentHTML: (pos, html) => { bodyHtml.inserted = { pos, html }; } },
    getElementById: (id) => elements[id] || null,
    querySelector: (sel) => (sel === '.site-header' ? elements.header || null : null),
  };
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
  };
  return { store, bodyHtml };
}

function load() {
  delete require.cache[TARGET_PATH];
  return require('./header-component.js');
}

beforeEach(() => {
  delete require.cache[TARGET_PATH];
  delete global.window;
  delete global.document;
  delete global.localStorage;
});

describe('module load (global stubs)', () => {
  test('installs default stubs for openWatchlistPanel/closeWatchlistPanel/openScreener/loadData when absent', () => {
    makeFakeGlobals();
    load();
    for (const fn of ['openWatchlistPanel', 'closeWatchlistPanel', 'openScreener', 'loadData']) {
      assert.equal(typeof global.window[fn], 'function', `${fn} should be stubbed`);
    }
  });

  test('does not clobber a page-defined function of the same name', () => {
    makeFakeGlobals();
    let called = false;
    global.window.openWatchlistPanel = () => { called = true; };
    load();
    global.window.openWatchlistPanel();
    assert.equal(called, true);
  });
});

describe('injectHeader', () => {
  test('inserts the header markup at the start of the body', () => {
    const { bodyHtml } = makeFakeGlobals();
    const { injectHeader } = load();
    injectHeader();
    assert.equal(bodyHtml.inserted.pos, 'afterbegin');
    assert.match(bodyHtml.inserted.html, /site-header/);
    assert.match(bodyHtml.inserted.html, /theme-toggle-btn/);
  });
});

describe('destroyHeader', () => {
  test('removes the header element if present', () => {
    let removed = false;
    const header = { remove: () => { removed = true; } };
    makeFakeGlobals({ elements: { header } });
    const { destroyHeader } = load();
    destroyHeader();
    assert.equal(removed, true);
  });

  test('is a no-op when no header is in the DOM', () => {
    makeFakeGlobals();
    const { destroyHeader } = load();
    assert.doesNotThrow(() => destroyHeader());
  });
});

describe('getCurrentTheme / isLightMode', () => {
  test('report dark by default (no light-mode class)', () => {
    makeFakeGlobals();
    const { getCurrentTheme, isLightMode } = load();
    assert.equal(getCurrentTheme(), 'dark');
    assert.equal(isLightMode(), false);
  });

  test('report light when the light-mode class is present', () => {
    makeFakeGlobals({ lightMode: true });
    const { getCurrentTheme, isLightMode } = load();
    assert.equal(getCurrentTheme(), 'light');
    assert.equal(isLightMode(), true);
  });
});

describe('initHeaderFunctionality / loadSavedTheme / applyTheme (via toggle)', () => {
  test('loads a saved light theme on init and updates icon/label/localStorage', () => {
    const icon = makeElement(), label = makeElement();
    const { store } = makeFakeGlobals({
      storage: { 'dse-theme': 'light' },
      elements: { 'theme-icon': icon, 'theme-label': label },
    });
    const { initHeaderFunctionality } = load();
    initHeaderFunctionality();
    assert.equal(global.document.documentElement.classList.contains('light-mode'), true);
    assert.equal(icon.textContent, '🌙');
    assert.equal(label.textContent, 'Dark');
    assert.equal(store['dse-theme'], 'light');
  });

  test('defaults to dark when nothing is saved', () => {
    const icon = makeElement(), label = makeElement();
    makeFakeGlobals({ elements: { 'theme-icon': icon, 'theme-label': label } });
    const { initHeaderFunctionality } = load();
    initHeaderFunctionality();
    assert.equal(global.document.documentElement.classList.contains('light-mode'), false);
    assert.equal(icon.textContent, '☀️');
    assert.equal(label.textContent, 'Light');
  });

  test('falls back to dark when localStorage.getItem throws', () => {
    const icon = makeElement(), label = makeElement();
    makeFakeGlobals({ elements: { 'theme-icon': icon, 'theme-label': label } });
    global.localStorage.getItem = () => { throw new Error('SecurityError'); };
    const { initHeaderFunctionality } = load();
    assert.doesNotThrow(() => initHeaderFunctionality());
    assert.equal(icon.textContent, '☀️');
  });

  test('wires the theme-toggle button to flip the theme on click', () => {
    let clickHandler;
    const toggleBtn = { addEventListener: (evt, fn) => { if (evt === 'click') clickHandler = fn; } };
    const icon = makeElement(), label = makeElement();
    const { store } = makeFakeGlobals({
      elements: { 'theme-toggle-btn': toggleBtn, 'theme-icon': icon, 'theme-label': label },
    });
    const { initHeaderFunctionality } = load();
    initHeaderFunctionality(); // starts dark (nothing saved)
    assert.equal(typeof clickHandler, 'function');

    clickHandler();
    assert.equal(global.document.documentElement.classList.contains('light-mode'), true);
    assert.equal(store['dse-theme'], 'light');

    clickHandler();
    assert.equal(global.document.documentElement.classList.contains('light-mode'), false);
    assert.equal(store['dse-theme'], 'dark');
  });

  test('applyTheme (via toggle) is a no-op when the icon/label elements are missing', () => {
    makeFakeGlobals(); // no theme-icon/theme-label registered
    const { initHeaderFunctionality } = load();
    assert.doesNotThrow(() => initHeaderFunctionality());
    assert.equal(global.document.documentElement.classList.contains('light-mode'), false);
  });
});

describe('updateHeaderMeta', () => {
  test('updates last-updated and total-count text when both are present and truthy', () => {
    const lastUpdated = makeElement(), totalCount = makeElement();
    makeFakeGlobals({ elements: { 'last-updated': lastUpdated, 'total-count': totalCount } });
    const { updateHeaderMeta } = load();
    updateHeaderMeta({ lastUpdated: '10:00 AM', totalCount: 412 });
    assert.equal(lastUpdated.textContent, '10:00 AM');
    assert.equal(totalCount.textContent, 412);
  });

  test('leaves existing text alone when a field is absent from the data', () => {
    const lastUpdated = makeElement({ textContent: 'unchanged' });
    makeFakeGlobals({ elements: { 'last-updated': lastUpdated } });
    const { updateHeaderMeta } = load();
    updateHeaderMeta({});
    assert.equal(lastUpdated.textContent, 'unchanged');
  });

  test('tolerates missing elements and a missing data argument entirely', () => {
    makeFakeGlobals();
    const { updateHeaderMeta } = load();
    assert.doesNotThrow(() => updateHeaderMeta());
  });
});

describe('updateWatchlistBadge / updateScreenerBadge', () => {
  test('set the badge text to the given count', () => {
    const wlBadge = makeElement(), scBadge = makeElement();
    makeFakeGlobals({ elements: { 'wl-count-badge': wlBadge, 'screener-badge': scBadge } });
    const { updateWatchlistBadge, updateScreenerBadge } = load();
    updateWatchlistBadge(7);
    updateScreenerBadge(3);
    assert.equal(wlBadge.textContent, 7);
    assert.equal(scBadge.textContent, 3);
  });

  test('default to 0 when called with no argument', () => {
    const wlBadge = makeElement({ textContent: 'x' });
    makeFakeGlobals({ elements: { 'wl-count-badge': wlBadge } });
    const { updateWatchlistBadge } = load();
    updateWatchlistBadge();
    assert.equal(wlBadge.textContent, 0);
  });

  test('tolerate a missing badge element', () => {
    makeFakeGlobals();
    const { updateWatchlistBadge, updateScreenerBadge } = load();
    assert.doesNotThrow(() => { updateWatchlistBadge(5); updateScreenerBadge(5); });
  });
});
