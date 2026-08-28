'use strict';

/* ═══════════════════════════════════════════════════════════════════
   DSE — STATIC SITE SHIM
   Ships as dist/shared/session-guard.js, replacing the live-server
   version. Every page already loads that path as a plain <script> in
   <head>, so this runs before any page script — including the deferred
   type="module" ones — without editing a single HTML file.

   Three jobs:

     1. Point /api/* at the frozen JSON tree the build generated.
     2. Answer a miss with the same empty shape the Express route
        returned, so callers that never expected a 404 keep working.
     3. Refuse every write, visibly, so nothing can appear to save.

   The empty shapes below were read out of the route handlers, not
   guessed. Getting one wrong turns an empty panel into a thrown
   exception, and /api/news/:code is the cautionary tale — it returns
   {items:[]}, not {news:[]}.
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  if (window.__dseStaticShim) return;
  window.__dseStaticShim = true;

  var BASE = '';               // substituted by the build ('' when root-served)

  window.__DSE_STATIC__ = true;
  document.documentElement.setAttribute('data-readonly', '');

  // ─── ROUTE FAMILIES ─────────────────────────────────────────────────────────
  // `upper` marks the capture group the Express handler upper-cased; GitHub
  // Pages is case-sensitive, so the filename only matches if we do the same.
  // `empty` is what the live route answered when it had no row.
  var FAMILIES = [
    // Derived, not snapshotted. /api/history/:code was only ever the raw price
    // file inside a {code, dataPoints, data} wrapper, so shipping both doubled
    // ~150 MB for nothing. `from` names the real file; the shim rebuilds the
    // wrapper the six call sites expect.
    { re: /^\/api\/history\/([^/?]+)$/, upper: 1,
      from: function (c) { return '/historical_prices/json_files/' + c + '.json'; },
      wrap: function (c, raw) {
        return { code: c, dataPoints: raw == null ? 0 : (raw.length || Object.keys(raw).length), data: raw };
      },
      empty: function (c) { return { code: c, dataPoints: 0, data: [] }; } },

    { re: /^\/api\/financials\/([^/?]+)$/, upper: 1,
      empty: function () { return { eps: [], dividend: [], nocfps: [], revenue: [], nav: [] }; } },

    { re: /^\/api\/annual-reports\/([^/?]+)$/, upper: 1,
      empty: function () { return { reports: [] }; } },

    { re: /^\/api\/bank-financials\/([^/?]+)$/, upper: 1,
      empty: function (c) {
        return { bank_id: c, available: false, quarterly: [], ratios: null, insights: null, sources: null };
      } },

    { re: /^\/api\/bank-details-grid\/([^/?]+)$/, upper: 1,
      empty: function () { return { columns: [], cells: {} }; } },

    { re: /^\/api\/sr\/([^/?]+)$/, upper: 1,
      empty: function () { return { support: [], resistance: [] }; } },

    { re: /^\/api\/news\/([^/?]+)$/, upper: 1,
      empty: function () { return { items: [] }; } },

    // Must precede the generic mf-portfolio pattern — "holders" is a literal
    // segment here, not a fund code.
    { re: /^\/api\/mf-portfolio\/holders\/([^/?]+)$/, upper: 1,
      empty: function () { return { holders: [] }; } },

    { re: /^\/api\/mf-portfolio\/([^/?]+)\/(\d{4})\/(\d)$/, upper: 1,
      empty: function (c, y, q) {
        return { code: c, year: parseInt(y, 10), quarter: q, holdings: [],
                 meta: { navPerUnit: 0, totalUnits: 0, date: '' } };
      } },

    { re: /^\/api\/mf-portfolio\/([^/?]+)\/quarters$/, upper: 1,
      empty: function () { return { quarters: [] }; } },

    // Private endpoints that a shipped page still pokes at — the candlestick
    // sidebar asks for watchlists and trade markers. They are deliberately not
    // snapshotted, so answer with the empty shape their callers already handle
    // rather than letting a 404 clutter the console on every chart.
    { re: /^\/api\/watchlists$/, upper: 0, synthetic: true,
      empty: function () { return { watchlists: [] }; } },
    { re: /^\/api\/trades$/, upper: 0, synthetic: true,
      empty: function () { return []; } },

    // company-details has no empty shape on purpose: the live route answers 500
    // when a scrape fails, and every caller already handles that. Inventing a
    // hollow company object would be worse than the error they expect.
    { re: /^\/api\/company-details\/([^/?]+)$/, upper: 1, empty: null },
  ];

  // Fixed endpoints whose last segment LOOKS like a stock code but is a literal.
  // Without this the shim upper-cases "global-tickers" into "GLOBAL-TICKERS" and
  // asks for a file that does not exist. macOS hides the bug — its filesystem is
  // case-insensitive — so it only appears once the site is on Linux. The live
  // server has the same hazard and solves it by mounting /api/news/editions
  // before /api/news; this is that same precedence, stated once.
  var LITERAL = [
    /^\/api\/news\/global-tickers$/,
    /^\/api\/news\/editions$/,
    /^\/api\/bank-financials\/_coverage$/,
  ];

  function isLiteral(p) {
    for (var i = 0; i < LITERAL.length; i++) if (LITERAL[i].test(p)) return true;
    return false;
  }

  // Finite query-string sets, mirrored in scripts/static/api-manifest.js.
  var QUERY_MAP = {
    '/api/screener/macd-crossover': function (params) {
      var tf = params.get('timeframe');
      return '.' + (['daily', 'weekly', 'monthly'].indexOf(tf) >= 0 ? tf : 'daily');
    }
  };


  // ═══════════════════════════════════════════════════════════════════
  // SITE GATE
  // When the build was run with --password, every JSON payload on this
  // site is AES-GCM ciphertext. The password derives the key; the key
  // never leaves this browser. A wrong password fails on the GCM tag,
  // so there is no "close enough" — it decrypts or it does not.
  //
  // Page scripts do not need to know any of this. Their fetches simply
  // wait on unlockPromise, then receive plaintext as usual.
  // ═══════════════════════════════════════════════════════════════════
  var GATED = true;
  // Captured before this script replaces window.fetch, so the gate can load its
  // own settings without going through its own interceptor.
  var originalFetch = window.fetch.bind(window);
  var SESSION_KEY = 'dse-site-key';
  var cryptoKey = null;
  var resolveUnlock;
  var unlockPromise = new Promise(function (r) { resolveUnlock = r; });

  var ENCRYPTED_PREFIX = /^\/(api|historical_prices|data|bank_financials|mf_portfolios|sr_levels|bank_details_grid)\//;

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  async function deriveKey(password, salt, iterations) {
    var material = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      material, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
  }

  async function openSealed(buf, key) {
    var bytes = new Uint8Array(buf);
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  }

  function hideUntilUnlocked() {
    var st = document.createElement('style');
    st.id = 'dse-gate-style';
    st.textContent = 'html.dse-locked body > *:not(#dse-gate){visibility:hidden !important}' +
      'html.dse-locked{background:#0d191d}';
    document.head.appendChild(st);
    document.documentElement.classList.add('dse-locked');
  }

  function gateError(message) {
    var g = document.getElementById('dse-gate');
    if (!g) { renderGate(null, null, message); return; }
    var msg = g.querySelector('.dse-gate-msg');
    if (msg) msg.textContent = message;
  }

  function reveal() {
    document.documentElement.classList.remove('dse-locked');
    var g = document.getElementById('dse-gate');
    if (g) g.remove();
  }

  async function startGate() {
    var conf;
    try {
      // Deliberately NOT nativeFetch: that is assigned further down this file,
      // and startGate can run before it exists. Reading it as undefined threw,
      // the catch below treated the throw as "no gate file", and the whole site
      // unlocked itself. A gate must never fail open.
      var res = await originalFetch(BASE + '/gate.json');
      if (!res.ok) throw new Error('gate.json ' + res.status);
      conf = await res.json();
      if (!conf || !conf.salt || !conf.verifier) throw new Error('gate.json malformed');
    } catch (e) {
      // This build was sealed, so the gate file must exist. If it cannot be
      // read, stay locked and say so rather than revealing the page.
      gateError('Could not load the unlock settings. Reload the page.');
      return;
    }
    var salt = b64ToBytes(conf.salt);

    // A key already in this tab's session — the "stay unlocked for a session"
    // half of the deal. sessionStorage, so closing the tab re-locks it.
    var saved = null;
    try { saved = sessionStorage.getItem(SESSION_KEY); } catch (e) {}
    if (saved) {
      try {
        var k = await crypto.subtle.importKey('raw', b64ToBytes(saved), 'AES-GCM', true, ['decrypt']);
        await openSealed(b64ToBytes(conf.verifier).buffer, k);
        cryptoKey = k; reveal(); resolveUnlock(k); return;
      } catch (e) {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e2) {}
      }
    }
    renderGate(conf, salt);
  }

  function renderGate(conf, salt, initialError) {
    var wrap = document.createElement('div');
    wrap.id = 'dse-gate';
    wrap.innerHTML =
      '<div class="dse-gate-card">' +
        '<div class="dse-gate-tag">DSE</div>' +
        '<h1>Private snapshot</h1>' +
        '<p>This page is encrypted. Enter the password to read it.</p>' +
        '<form><input type="password" autocomplete="current-password" ' +
          'placeholder="Password" aria-label="Password" autofocus />' +
          '<button type="submit">Unlock</button></form>' +
        '<div class="dse-gate-msg" role="alert"></div>' +
        '<small>Stays unlocked until you close this tab.</small>' +
      '</div>';
    (document.body || document.documentElement).appendChild(wrap);

    var form  = wrap.querySelector('form');
    var input = wrap.querySelector('input');
    var btn   = wrap.querySelector('button');
    var msg   = wrap.querySelector('.dse-gate-msg');
    if (initialError) msg.textContent = initialError;

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!conf || !salt) { msg.textContent = 'Unlock settings unavailable — reload the page.'; return; }
      if (!input.value) return;
      btn.disabled = true; btn.textContent = 'Checking…'; msg.textContent = '';
      try {
        var key = await deriveKey(input.value, salt, conf.iterations);
        await openSealed(b64ToBytes(conf.verifier).buffer, key);   // throws if wrong
        var raw = await crypto.subtle.exportKey('raw', key);
        try { sessionStorage.setItem(SESSION_KEY, bytesToB64(new Uint8Array(raw))); } catch (e) {}
        cryptoKey = key;
        reveal();
        resolveUnlock(key);
      } catch (e) {
        msg.textContent = 'That password did not unlock it.';
        btn.disabled = false; btn.textContent = 'Unlock';
        input.select();
      }
    });
    input.focus();
  }

  if (GATED) {
    hideUntilUnlocked();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startGate);
    } else {
      startGate();
    }
  } else {
    resolveUnlock(null);
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // ─── URL MAPPING ────────────────────────────────────────────────────────────
  function mapUrl(raw) {
    var url;
    try { url = new URL(raw, location.href); } catch (e) { return null; }

    // Absorb any lingering hardcoded dev origin rather than letting it escape
    // to whatever machine happens to answer on :3000.
    var isDevOrigin = (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && url.port === '3000';
    if (!isDevOrigin && url.origin !== location.origin) return null;   // real third parties: leave alone

    var path = url.pathname;
    if (BASE && path.indexOf(BASE) === 0) path = path.slice(BASE.length);
    if (path.indexOf('/api/') !== 0) {
      return isDevOrigin ? { url: BASE + path + url.search, path: path, passthrough: true } : null;
    }

    for (var i = 0; !isLiteral(path) && i < FAMILIES.length; i++) {
      var m = path.match(FAMILIES[i].re);
      if (!m) continue;
      var seg = FAMILIES[i].upper;
      var code = seg ? decodeURIComponent(m[seg]).toUpperCase() : '';
      if (seg) path = path.replace(m[seg], code);
      if (FAMILIES[i].synthetic) {
        // No file will ever exist for these — answering from memory keeps a
        // guaranteed 404 out of the network panel on every chart load.
        return { synthetic: FAMILIES[i], path: path };
      }
      if (FAMILIES[i].from) {
        return { url: BASE + FAMILIES[i].from(code), path: path, derived: FAMILIES[i], code: code };
      }
      break;
    }

    var suffix = QUERY_MAP[path] ? QUERY_MAP[path](url.searchParams) : '';
    return { url: BASE + path + suffix + '.json', path: path };
  }

  function emptyFor(path) {
    if (isLiteral(path)) return null;
    for (var i = 0; i < FAMILIES.length; i++) {
      var m = path.match(FAMILIES[i].re);
      if (m && FAMILIES[i].empty) return FAMILIES[i].empty(m[1], m[2], m[3]);
    }
    return null;
  }

  // ─── FETCH ──────────────────────────────────────────────────────────────────
  var nativeFetch = window.fetch;

  window.fetch = function (input, init) {
    init = init || {};
    var raw    = typeof input === 'string' ? input : (input && input.url) || '';
    var method = String(init.method || (input && input.method) || 'GET').toUpperCase();

    // The one POST that is really a read.
    if (method === 'POST' && /\/api\/company-details-batch$/.test(raw)) {
      var wanted = [];
      try { wanted = (JSON.parse(init.body || '{}').codes || []).map(function (c) { return String(c).toUpperCase(); }); }
      catch (e) { /* fall through to an empty result */ }
      return nativeFetch(BASE + '/api/company-details/_index.json')
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (all) {
          var out = {};
          wanted.forEach(function (c) { if (all[c]) out[c] = all[c]; });
          return jsonResponse({ results: out });
        })
        .catch(function () { return jsonResponse({ results: {} }); });
    }

    if (method !== 'GET' && method !== 'HEAD') {
      showReadOnlyToast();
      return Promise.resolve(jsonResponse(
        { error: 'read_only', message: 'This is a published read-only snapshot. Nothing can be saved here.' }, 405));
    }

    var mapped = mapUrl(raw);
    if (!mapped) return nativeFetch(input, init);
    if (mapped.synthetic) return Promise.resolve(jsonResponse(mapped.synthetic.empty()));
    if (mapped.passthrough) return nativeFetch(mapped.url, init);

    // Page scripts start fetching before the visitor has typed anything. Rather
    // than let them fail and render an empty screen, hold every request here
    // until the gate opens — then they proceed as if nothing happened.
    if (GATED) {
      return unlockPromise.then(function () { return fetchSealed(mapped, init); });
    }

    return fetchSealed(mapped, init);
  };

  // Fetch, and if the file lives in an encrypted tree, unseal it before anyone
  // upstream sees it. Everything past this point deals in plaintext.
  function fetchSealed(mapped, init) {
    return nativeFetch(mapped.url, init).then(function (res) {
      if (cryptoKey && res.ok && ENCRYPTED_PREFIX.test(mapped.url.replace(BASE, ''))) {
        return res.arrayBuffer()
          .then(function (buf) { return openSealed(buf, cryptoKey); })
          .then(function (plain) {
            var text = new TextDecoder().decode(plain);
            if (mapped.derived) {
              var raw = JSON.parse(text);
              return jsonResponse(mapped.derived.wrap(mapped.code, raw));
            }
            return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
          })
          .catch(function () {
            var fb = mapped.derived ? mapped.derived.empty(mapped.code) : emptyFor(mapped.path);
            return fb ? jsonResponse(fb) : new Response('', { status: 502 });
          });
      }
      if (mapped.derived) {
        if (!res.ok) return jsonResponse(mapped.derived.empty(mapped.code));
        return res.json()
          .then(function (raw) { return jsonResponse(mapped.derived.wrap(mapped.code, raw)); })
          .catch(function () { return jsonResponse(mapped.derived.empty(mapped.code)); });
      }
      if (res.ok) return res;
      var fallback = emptyFor(mapped.path);
      return fallback ? jsonResponse(fallback) : res;
    });
  }

  // A few older views still use XMLHttpRequest directly.
  var nativeOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open;
  if (nativeOpen) {
    window.XMLHttpRequest.prototype.open = function (method, url) {
      var rest = Array.prototype.slice.call(arguments, 2);
      var isGet = String(method).toUpperCase() === 'GET';
      var mapped = isGet ? mapUrl(url) : null;
      if (!isGet) showReadOnlyToast();
      return nativeOpen.apply(this, [method, mapped ? mapped.url : url].concat(rest));
    };
  }

  // ─── READ-ONLY NOTICES ──────────────────────────────────────────────────────
  var toastTimer = null;
  function showReadOnlyToast() {
    if (!document.body) return;
    var el = document.getElementById('dse-readonly-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dse-readonly-toast';
      el.setAttribute('role', 'status');
      el.textContent = 'Read-only snapshot — nothing is saved here.';
      document.body.appendChild(el);
    }
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 3200);
  }
  window.__dseReadOnlyToast = showReadOnlyToast;

  function addBanner() {
    if (!document.body || document.getElementById('dse-readonly-banner')) return;
    var built = '2026-08-28';
    var bar = document.createElement('div');
    bar.id = 'dse-readonly-banner';
    bar.innerHTML =
      '<span>Read-only snapshot of a personal DSE tracker &middot; data as of <strong>' + built +
      '</strong> &middot; prices are not live</span>' +
      '<button type="button" aria-label="Dismiss">&times;</button>';
    bar.querySelector('button').addEventListener('click', function () {
      bar.remove();
      try { sessionStorage.setItem('dse-banner-dismissed', '1'); } catch (e) {}
    });
    try { if (sessionStorage.getItem('dse-banner-dismissed')) return; } catch (e) {}
    document.body.insertBefore(bar, document.body.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addBanner);
  } else {
    addBanner();
  }
})();
