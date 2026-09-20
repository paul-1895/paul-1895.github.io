'use strict';

const { test, describe, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// timeline-routes.js hardcodes its data directory as
//   path.join(__dirname, 'data', 'timeline')
// with no injectable override. To exercise the real route-handler logic
// without ever touching this project's real timeline archive, we redirect
// fs calls whose path falls under that exact real directory onto a
// throwaway temp directory, and pass every other path straight through to
// the original fs implementation untouched.
const DATA_DIR = path.join(__dirname, 'data', 'timeline');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-routes-test-'));

const orig = {
  existsSync:    fs.existsSync.bind(fs),
  readFileSync:  fs.readFileSync.bind(fs),
  writeFileSync: fs.writeFileSync.bind(fs),
};

function remap(p) {
  return typeof p === 'string' && p.startsWith(DATA_DIR) ? p.replace(DATA_DIR, tempDir) : p;
}

before(() => {
  mock.method(fs, 'existsSync',    (p, ...rest) => orig.existsSync(remap(p), ...rest));
  mock.method(fs, 'readFileSync',  (p, ...rest) => orig.readFileSync(remap(p), ...rest));
  mock.method(fs, 'writeFileSync', (p, ...rest) => orig.writeFileSync(remap(p), ...rest));
});

after(() => {
  mock.reset();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  if (orig.existsSync(tempDir)) {
    for (const f of fs.readdirSync(tempDir)) fs.unlinkSync(path.join(tempDir, f));
  }
});

const registerTimelineRoutes = require('./timeline-routes.js');

// timeline-routes.js registers directly onto an Express `app` (app.get/post/
// put/patch/delete) rather than returning a Router, so we hand it a minimal
// fake app that just records each handler by "METHOD path", then invoke
// handlers directly with a plain req/res — the same style used for the
// Router-based route tests elsewhere in this suite.
function createFakeApp() {
  const handlers = {};
  const app = {};
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    app[m] = (routePath, handler) => { handlers[`${m} ${routePath}`] = handler; };
  }
  app._handlers = handlers;
  return app;
}

const app = createFakeApp();
registerTimelineRoutes(app);

function findHandler(method, routePath) {
  const handler = app._handlers[`${method} ${routePath}`];
  if (!handler) throw new Error(`No route registered for ${method.toUpperCase()} ${routePath}`);
  return handler;
}

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function invoke(handler, req) {
  const res = createRes();
  handler({ params: {}, body: {}, ...req }, res, () => {});
  return res;
}

const getHandler    = findHandler('get', '/api/timeline/:code');
const postHandler   = findHandler('post', '/api/timeline/:code');
const putHandler    = findHandler('put', '/api/timeline/:code/:id');
const pinHandler    = findHandler('patch', '/api/timeline/:code/:id/pin');
const deleteHandler = findHandler('delete', '/api/timeline/:code/:id');

describe('stock code validation', () => {
  test('rejects an invalid code on every verb', () => {
    for (const code of ['', 'bad code!', 'x'.repeat(31)]) {
      assert.equal(invoke(getHandler, { params: { code } }).statusCode, 400);
      assert.equal(invoke(postHandler, { params: { code }, body: { title: 'T', date: '2025-01-01' } }).statusCode, 400);
    }
  });

  test('a lowercase code is accepted and normalized to uppercase', () => {
    invoke(postHandler, { params: { code: 'aci' }, body: { title: 'T', date: '2025-01-01' } });
    const res = invoke(getHandler, { params: { code: 'ACI' } });
    assert.equal(res.body.cards.length, 1);
  });
});

describe('GET /api/timeline/:code', () => {
  test('returns an empty cards list when no file exists yet', () => {
    const res = invoke(getHandler, { params: { code: 'ACI' } });
    assert.deepEqual(res.body, { cards: [] });
  });

  test('a corrupted file is treated as empty rather than crashing', () => {
    fs.writeFileSync(path.join(tempDir, 'ACI.json'), 'not valid json {{{');
    const res = invoke(getHandler, { params: { code: 'ACI' } });
    assert.deepEqual(res.body, { cards: [] });
  });
});

describe('POST /api/timeline/:code', () => {
  test('rejects a missing title or date', () => {
    for (const body of [{ date: '2025-01-01' }, { title: 'T' }]) {
      assert.equal(invoke(postHandler, { params: { code: 'ACI' }, body }).statusCode, 400);
    }
  });

  test('creates a card with an id and timestamps', () => {
    const res = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'Q1 results', date: '2025-01-01' } });
    assert.equal(res.statusCode, 201);
    assert.ok(res.body.card.id);
    assert.ok(res.body.card.createdAt);
    assert.equal(res.body.card.updatedAt, res.body.card.createdAt);
  });

  test('defaults an unrecognized tag to Other and sentiment to none', () => {
    const res = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'T', date: '2025-01-01', tag: 'Nonsense', sentiment: 'euphoric' } });
    assert.equal(res.body.card.tag, 'Other');
    assert.equal(res.body.card.sentiment, 'none');
  });

  test('accepts a whitelisted tag and sentiment as-is', () => {
    const res = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'T', date: '2025-01-01', tag: 'Earnings', sentiment: 'bullish' } });
    assert.equal(res.body.card.tag, 'Earnings');
    assert.equal(res.body.card.sentiment, 'bullish');
  });

  test('truncates long fields to their caps', () => {
    const res = invoke(postHandler, {
      params: { code: 'ACI' },
      body: { title: 'x'.repeat(500), date: '2025-01-01', description: 'y'.repeat(6000) },
    });
    assert.equal(res.body.card.title.length, 200);
    assert.equal(res.body.card.description.length, 5000);
  });

  test('filters out malformed links/images and caps the list at 20', () => {
    const links = [
      { url: 'https://x.com/1' },
      { url: '' },          // dropped: empty url
      { label: 'no url' },  // dropped: missing url
      ...Array.from({ length: 25 }, (_, i) => ({ url: `https://x.com/extra${i}` })),
    ];
    const images = ['https://x.com/a.png', '', 42, 'https://x.com/b.png'];
    const res = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'T', date: '2025-01-01', links, images } });
    assert.equal(res.body.card.links.length, 20);
    assert.equal(res.body.card.images.length, 2);
  });

  test('pinned only becomes true for an exact boolean true', () => {
    const res = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'T', date: '2025-01-01', pinned: 'true' } });
    assert.equal(res.body.card.pinned, false);
  });
});

describe('PUT /api/timeline/:code/:id', () => {
  test('404s for an unknown card id', () => {
    const res = invoke(putHandler, { params: { code: 'ACI', id: 'nope' }, body: { title: 'T', date: '2025-01-01' } });
    assert.equal(res.statusCode, 404);
  });

  test('rejects a missing title or date', () => {
    const { body: { card } } = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'T', date: '2025-01-01' } });
    const res = invoke(putHandler, { params: { code: 'ACI', id: card.id }, body: { date: '2025-01-01' } });
    assert.equal(res.statusCode, 400);
  });

  test('replaces the sanitized fields and refreshes updatedAt without touching createdAt', () => {
    const { body: { card } } = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'Old', date: '2025-01-01' } });
    const res = invoke(putHandler, { params: { code: 'ACI', id: card.id }, body: { title: 'New', date: '2025-02-01' } });
    assert.equal(res.body.card.title, 'New');
    assert.equal(res.body.card.date, '2025-02-01');
    assert.equal(res.body.card.createdAt, card.createdAt); // preserved, not reset
    assert.ok(res.body.card.updatedAt); // re-stamped (may equal createdAt at millisecond resolution)
  });
});

describe('PATCH /api/timeline/:code/:id/pin', () => {
  test('404s for an unknown card id', () => {
    assert.equal(invoke(pinHandler, { params: { code: 'ACI', id: 'nope' } }).statusCode, 404);
  });

  test('toggles pinned on each call', () => {
    const { body: { card } } = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'T', date: '2025-01-01' } });
    assert.equal(card.pinned, false);
    const once = invoke(pinHandler, { params: { code: 'ACI', id: card.id } });
    assert.equal(once.body.card.pinned, true);
    const twice = invoke(pinHandler, { params: { code: 'ACI', id: card.id } });
    assert.equal(twice.body.card.pinned, false);
  });
});

describe('DELETE /api/timeline/:code/:id', () => {
  test('404s for an unknown card id', () => {
    assert.equal(invoke(deleteHandler, { params: { code: 'ACI', id: 'nope' } }).statusCode, 404);
  });

  test('removes only the matching card', () => {
    invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'A', date: '2025-01-01' } });
    const { body: { card } } = invoke(postHandler, { params: { code: 'ACI' }, body: { title: 'B', date: '2025-01-02' } });
    const res = invoke(deleteHandler, { params: { code: 'ACI', id: card.id } });
    assert.deepEqual(res.body, { success: true });
    const remaining = invoke(getHandler, { params: { code: 'ACI' } });
    assert.deepEqual(remaining.body.cards.map(c => c.title), ['A']);
  });
});
