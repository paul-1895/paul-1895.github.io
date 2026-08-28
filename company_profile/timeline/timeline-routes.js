/* ================================================================
   timeline-routes.js
   Express routes for the per-stock Timeline feature.

   Storage: one JSON file per stock at data/timeline/<CODE>.json
     { "cards": [ { id, title, date, description, links:[{url,label}], images:[url,...], createdAt, updatedAt } ] }

   Mount in your existing server.js like:

     const registerTimelineRoutes = require('./timeline-routes');
     registerTimelineRoutes(app);

   ================================================================ */
'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data', 'timeline');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Only allow safe file names — stock codes are alphanumeric plus a few symbols
function safeCode(code) {
  const c = String(code || '').toUpperCase().trim();
  if (!/^[A-Z0-9._-]{1,30}$/.test(c)) return null;
  return c;
}

function filePath(code) {
  return path.join(DATA_DIR, `${code}.json`);
}

function readTimeline(code) {
  ensureDir();
  const fp = filePath(code);
  if (!fs.existsSync(fp)) return { cards: [] };
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.cards)) parsed.cards = [];
    return parsed;
  } catch (err) {
    console.error(`[timeline] Failed to read ${fp}:`, err.message);
    return { cards: [] };
  }
}

function writeTimeline(code, data) {
  ensureDir();
  fs.writeFileSync(filePath(code), JSON.stringify(data, null, 2), 'utf8');
}

function makeId() {
  return 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const ALLOWED_TAGS = ['Earnings', 'Dividend', 'Corporate Action', 'News', 'Price Alert', 'Management', 'Other'];
const ALLOWED_SENTIMENT = ['bullish', 'bearish', 'neutral', 'none'];

function sanitizeCard(body) {
  const title = String(body.title || '').trim().slice(0, 200);
  const date  = String(body.date || '').trim().slice(0, 10);
  const description = String(body.description || '').trim().slice(0, 5000);

  const links = Array.isArray(body.links)
    ? body.links
        .filter(l => l && typeof l.url === 'string' && l.url.trim())
        .slice(0, 20)
        .map(l => ({
          url: l.url.trim().slice(0, 1000),
          label: String(l.label || '').trim().slice(0, 100),
        }))
    : [];

  const images = Array.isArray(body.images)
    ? body.images
        .filter(src => typeof src === 'string' && src.trim())
        .slice(0, 20)
        .map(src => src.trim().slice(0, 1000))
    : [];

  const tag = ALLOWED_TAGS.includes(body.tag) ? body.tag : 'Other';
  const sentiment = ALLOWED_SENTIMENT.includes(body.sentiment) ? body.sentiment : 'none';
  const pinned = body.pinned === true;

  return { title, date, description, links, images, tag, sentiment, pinned };
}

function registerTimelineRoutes(app) {
  // GET all events for a stock
  app.get('/api/timeline/:code', (req, res) => {
    const code = safeCode(req.params.code);
    if (!code) return res.status(400).json({ error: 'Invalid stock code' });
    const data = readTimeline(code);
    res.json(data);
  });

  // CREATE a new event
  app.post('/api/timeline/:code', (req, res) => {
    const code = safeCode(req.params.code);
    if (!code) return res.status(400).json({ error: 'Invalid stock code' });

    const clean = sanitizeCard(req.body || {});
    if (!clean.title || !clean.date) {
      return res.status(400).json({ error: 'title and date are required' });
    }

    const data = readTimeline(code);
    const now = new Date().toISOString();
    const card = { id: makeId(), ...clean, createdAt: now, updatedAt: now };
    data.cards.push(card);
    writeTimeline(code, data);

    res.status(201).json({ card });
  });

  // UPDATE an existing event
  app.put('/api/timeline/:code/:id', (req, res) => {
    const code = safeCode(req.params.code);
    if (!code) return res.status(400).json({ error: 'Invalid stock code' });

    const data = readTimeline(code);
    const idx = data.cards.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Event not found' });

    const clean = sanitizeCard(req.body || {});
    if (!clean.title || !clean.date) {
      return res.status(400).json({ error: 'title and date are required' });
    }

    data.cards[idx] = {
      ...data.cards[idx],
      ...clean,
      updatedAt: new Date().toISOString(),
    };
    writeTimeline(code, data);

    res.json({ card: data.cards[idx] });
  });

  // TOGGLE pinned state only (used by the star button — no full form needed)
  app.patch('/api/timeline/:code/:id/pin', (req, res) => {
    const code = safeCode(req.params.code);
    if (!code) return res.status(400).json({ error: 'Invalid stock code' });

    const data = readTimeline(code);
    const idx = data.cards.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Event not found' });

    data.cards[idx].pinned = !data.cards[idx].pinned;
    data.cards[idx].updatedAt = new Date().toISOString();
    writeTimeline(code, data);

    res.json({ card: data.cards[idx] });
  });

  // DELETE an event
  app.delete('/api/timeline/:code/:id', (req, res) => {
    const code = safeCode(req.params.code);
    if (!code) return res.status(400).json({ error: 'Invalid stock code' });

    const data = readTimeline(code);
    const before = data.cards.length;
    data.cards = data.cards.filter(c => c.id !== req.params.id);
    if (data.cards.length === before) return res.status(404).json({ error: 'Event not found' });

    writeTimeline(code, data);
    res.json({ success: true });
  });
}

module.exports = registerTimelineRoutes;
