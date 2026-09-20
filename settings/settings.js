/* Settings page — every preference lives in window.DSESettings
   (shared/display-settings.js); this file is only the UI around it. */
(function () {
  'use strict';

  const S = window.DSESettings;
  if (!S) { console.error('display-settings.js did not load'); return; }

  const $ = id => document.getElementById(id);
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;

  // ── Embedded in the shared modal? ─────────────────────────────────
  // Every other page opens this one inside an iframe (shared/settings-modal.js).
  // Links to the rest of the site must then leave the frame instead of
  // navigating the modal itself.
  const embedded = window.self !== window.top;
  if (embedded) {
    document.documentElement.classList.add('embedded');
    document.querySelectorAll('a[href^="/"]:not([target])').forEach(a => { a.target = '_top'; });
  }

  // ── Build controls from the shared registries ─────────────────────
  const fillSelect = (el, list, text) =>
    el.innerHTML = list.map(x => `<option value="${x.id}">${esc(text(x))}</option>`).join('');

  const fillSeg = (el, list) =>
    el.innerHTML = list.map(x =>
      `<button type="button" data-id="${x.id}" aria-pressed="false">${esc(x.label)}</button>`).join('');

  fillSelect($('theme-select'),   S.THEMES,        t => t.label);
  fillSelect($('sans-select'),    S.FAMILIES.sans, f => f.label);
  fillSelect($('mono-select'),    S.FAMILIES.mono, f => f.label);
  fillSelect($('refresh-select'), S.REFRESHES,     r => r.label);

  fillSeg($('density-seg'),  S.DENSITIES);
  fillSeg($('radius-seg'),   S.RADII);
  fillSeg($('headers-seg'),  S.HEADER_STYLES);
  fillSeg($('borders-seg'),  S.BORDER_STYLES);
  fillSeg($('stripes-seg'),  S.STRIPE_STYLES);
  fillSeg($('numerals-seg'), S.NUMERAL_STYLES);
  fillSeg($('motion-seg'),   S.MOTIONS);
  fillSeg($('notif-seg'),    S.NOTIFICATIONS);
  fillSeg($('hidden-seg'),   S.HIDDEN_REFRESHES);

  $('accent-swatches').innerHTML = S.ACCENTS.map(a => `
    <button type="button" class="swatch" data-id="${a.id}" aria-pressed="false">
      <i style="background:${a.swatch || a.light}"></i><span>${esc(a.label)}</span>
    </button>`).join('');

  $('market-options').innerHTML = S.MARKETS.map(m => `
    <button type="button" class="option" data-id="${m.id}" aria-pressed="false">
      <span class="option-bars">
        <i style="background:${(m.swatch && m.swatch.gain) || m.gain.light}"></i>
        <i style="background:${(m.swatch && m.swatch.loss) || m.loss.light}"></i>
      </span>
      <span class="option-text"><b>${esc(m.label)}</b><span>${esc(m.note)}</span></span>
    </button>`).join('');

  // ── Per-row "back to default" ─────────────────────────────────────
  // Each row that owns one setting carries data-key; a small reset chip
  // appears beside its title whenever the value differs from the default.
  const KEY_ROWS = Array.from(document.querySelectorAll('[data-key]'))
    .filter(row => row.dataset.key in S.DEFAULTS);

  KEY_ROWS.forEach(row => {
    const title = row.querySelector('.row-label > b, .row-text > b');
    if (!title) return;
    const name = title.textContent.trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'row-reset';
    btn.title = 'Back to default';
    btn.setAttribute('aria-label', 'Reset ' + name + ' to its default');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>default';
    btn.addEventListener('click', () => update({ [row.dataset.key]: S.DEFAULTS[row.dataset.key] }, 'Reset'));
    title.appendChild(btn);
  });

  // ── Render state into the controls ────────────────────────────────
  const markActive = (el, value, attr) =>
    el.querySelectorAll('[' + attr + ']').forEach(b => {
      const on = b.getAttribute(attr) === String(value);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

  function render(s) {
    $('theme-select').value   = s.theme;
    $('sans-select').value    = s.sans;
    $('mono-select').value    = s.mono;
    $('refresh-select').value = s.refresh;
    $('theme-hint').textContent = (S.THEMES.find(t => t.id === s.theme) || {}).hint || '';

    $('scale-range').value = Math.round(s.scale * 100);
    $('lh-range').value    = Math.round(s.lineHeight * 100);
    $('ls-range').value    = Math.round(s.letterSpacing * 1000);
    if (document.activeElement !== $('commission-input')) $('commission-input').value = s.commission;

    $('scale-value').textContent = Math.round(s.scale * 100) + '%';
    $('lh-value').textContent    = Math.round(s.lineHeight * 100) + '%';
    $('ls-value').textContent    = s.letterSpacing.toFixed(3).replace(/0$/, '') + 'em';

    markActive($('weight-seg'),      s.weight,        'data-weight');
    markActive($('motion-seg'),      s.motion,        'data-id');
    markActive($('notif-seg'),       s.notifications, 'data-id');
    markActive($('hidden-seg'),      s.refreshHidden, 'data-id');
    markActive($('density-seg'),     s.density,       'data-id');
    markActive($('radius-seg'),      s.radius,        'data-id');
    markActive($('headers-seg'),     s.tableHeaders,  'data-id');
    markActive($('borders-seg'),     s.tableBorders,  'data-id');
    markActive($('stripes-seg'),     s.tableStripes,  'data-id');
    markActive($('numerals-seg'),    s.numerals,      'data-id');
    markActive($('accent-swatches'), s.accent,        'data-id');
    markActive($('market-options'),  s.market,        'data-id');

    KEY_ROWS.forEach(row =>
      row.classList.toggle('changed', s[row.dataset.key] !== S.DEFAULTS[row.dataset.key]));

    renderAbout(s);
    renderLooks(s);
    renderContrast();
  }

  // ── Save + feedback ───────────────────────────────────────────────
  let pillTimer = null;
  function flash(text) {
    const pill = $('saved-pill');
    $('saved-text').textContent = text || 'Saved';
    pill.classList.add('show');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => {
      pill.classList.remove('show');
      $('saved-text').textContent = 'Auto-saved';
    }, 1600);
  }

  // Bulk changes (a Look, a reset, an import, a shared link) offer Undo
  // for a few seconds instead of asking "are you sure?" up front.
  let undoState = null, undoTimer = null;
  function offerUndo(prev, what) {
    undoState = prev;
    const b = $('undo-btn');
    b.textContent = 'Undo ' + what;
    b.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(dropUndo, 10000);
  }
  function dropUndo() {
    undoState = null;
    $('undo-btn').hidden = true;
    clearTimeout(undoTimer);
  }
  $('undo-btn').addEventListener('click', () => {
    if (!undoState) return;
    const prev = undoState;
    dropUndo();
    render(S.save(prev));
    renderStorage();
    flash('Undone');
  });

  // Replace the whole set at once (rather than merge a patch), remembering
  // what was there so the change can be undone.
  function replaceAll(next, note, what) {
    const prev = S.get();
    render(S.save(Object.assign({}, S.DEFAULTS, next)));
    renderStorage();
    flash(note);
    offerUndo(prev, what);
  }

  function update(patch, note) {
    render(S.save(patch));
    flash(note);
    renderStorage();
  }

  // ── Wiring ────────────────────────────────────────────────────────
  const on = (id, evt, fn) => $(id).addEventListener(evt, fn);

  on('theme-select',   'change', () => update({ theme: $('theme-select').value }));
  on('sans-select',    'change', () => update({ sans: $('sans-select').value }));
  on('mono-select',    'change', () => update({ mono: $('mono-select').value }));
  on('refresh-select', 'change', () => update({ refresh: $('refresh-select').value }));

  on('scale-range', 'input', () => update({ scale: Number($('scale-range').value) / 100 }));
  on('lh-range',    'input', () => update({ lineHeight: Number($('lh-range').value) / 100 }));
  on('ls-range',    'input', () => update({ letterSpacing: Number($('ls-range').value) / 1000 }));

  on('commission-input', 'input', () => {
    const v = parseFloat($('commission-input').value);
    if (!isNaN(v)) update({ commission: v });   // the engine clamps to 0–10
  });
  // Once editing ends, show what was actually kept (clamped, numeric).
  on('commission-input', 'change', () => { $('commission-input').value = S.get().commission; });

  const segClick = (id, attr, key, cast) => $(id).addEventListener('click', e => {
    const btn = e.target.closest('[' + attr + ']');
    if (!btn) return;
    const raw = btn.getAttribute(attr);
    update({ [key]: cast ? cast(raw) : raw });
  });

  segClick('weight-seg',      'data-weight', 'weight', Number);
  segClick('motion-seg',      'data-id',     'motion');
  segClick('notif-seg',       'data-id',     'notifications');
  segClick('hidden-seg',      'data-id',     'refreshHidden');
  segClick('density-seg',     'data-id',     'density');
  segClick('radius-seg',      'data-id',     'radius');
  segClick('headers-seg',     'data-id',     'tableHeaders');
  segClick('borders-seg',     'data-id',     'tableBorders');
  segClick('stripes-seg',     'data-id',     'tableStripes');
  segClick('numerals-seg',    'data-id',     'numerals');
  segClick('accent-swatches', 'data-id',     'accent');
  segClick('market-options',  'data-id',     'market');

  // ── About: what is actually in force right now ────────────────────
  function renderAbout(s) {
    const keys = Object.keys(S.DEFAULTS);
    const changed = keys.filter(k => s[k] !== S.DEFAULTS[k]).length;
    const rows = [
      ['Settings changed', changed ? changed + ' of ' + keys.length : 'None — all defaults'],
      ['Active theme',     S.currentTheme() + ' · ' + label(S.THEMES, s.theme)],
      ['Typeface',         label(S.FAMILIES.sans, s.sans) + ' / ' + label(S.FAMILIES.mono, s.mono)
                           + (s.numerals === 'tabular' ? ' · tabular digits' : '')],
      ['Price refresh',    label(S.REFRESHES, s.refresh)
                           + (s.refreshHidden === 'pause' ? ' · paused in hidden tabs' : ' · runs in hidden tabs')],
      ['Table chrome',     label(S.DENSITIES, s.density) + ' · ' + label(S.BORDER_STYLES, s.tableBorders).toLowerCase()
                           + ' borders · ' + label(S.STRIPE_STYLES, s.tableStripes).toLowerCase() + ' rows'],
      ['Applies to',       'Every page in the project · stored in this browser'],
    ];
    $('about-list').innerHTML = rows.map(([k, v]) => `
      <div class="option static">
        <span class="option-text"><b>${esc(k)}</b><span>${esc(v)}</span></span>
      </div>`).join('');
  }

  // ── Stored data ───────────────────────────────────────────────────
  // Everything the project persists, grouped so a stray key can't hide.
  const GROUPS = [
    { label: 'Display settings', note: 'This page',               match: k => k === S.KEY || k === 'dse-font-settings' },
    { label: 'Theme',            note: 'Light / dark choice',     match: k => /theme/i.test(k) },
    { label: 'Watchlists',       note: 'Starred tickers',         match: k => /watchlist|^wl-/i.test(k) },
    { label: 'Notifications',    note: 'Price-alert history',     match: k => /notif/i.test(k) },
    { label: 'Chart drawings',   note: 'Candlestick annotations', match: k => /^tv-/i.test(k) },
    { label: 'Column layouts',   note: 'Table column visibility', match: k => /col-vis|colvis/i.test(k) },
    { label: 'Other',            note: 'Everything else',         match: () => true },
  ];

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function groupStorage() {
    const groups = GROUPS.map(g => Object.assign({ keys: [], size: 0 }, g));
    let count = 0;
    try { count = localStorage.length; } catch (e) { return []; }
    for (let i = 0; i < count; i++) {
      const k = localStorage.key(i);
      const g = groups.find(x => x.match(k));
      g.keys.push(k);
      g.size += k.length + (localStorage.getItem(k) || '').length;
    }
    return groups.filter(g => g.keys.length);
  }

  function renderStorage() {
    const groups = groupStorage();
    $('storage-list').innerHTML = groups.length ? groups.map(g => `
      <div class="option static">
        <span class="option-text">
          <b>${esc(g.label)}</b><span>${esc(g.note)} · ${g.keys.length} key${g.keys.length > 1 ? 's' : ''} · ${bytes(g.size)}</span>
        </span>
        <button class="btn small danger" type="button" data-clear="${esc(g.label)}">Clear</button>
      </div>`).join('') : '<div class="hint" style="margin:0">Nothing stored yet.</div>';
  }

  $('storage-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-clear]');
    if (!btn) return;
    const group = groupStorage().find(g => g.label === btn.getAttribute('data-clear'));
    if (!group) return;
    // Not undoable — other pages own these keys — so this one keeps its confirm.
    if (!confirm(`Clear ${group.label.toLowerCase()}? ${group.keys.length} stored item(s) will be removed. This cannot be undone.`)) return;
    const hadSettings = group.keys.includes(S.KEY);
    group.keys.forEach(k => localStorage.removeItem(k));
    if (hadSettings) render(S.reset());
    renderStorage();
    flash('Cleared');
  });

  // ── Backup ────────────────────────────────────────────────────────
  on('export-btn', 'click', () => {
    const blob = new Blob([JSON.stringify(S.exportable(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dse-settings-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flash('Exported');
  });

  on('import-btn', 'click', () => $('import-file').click());

  on('import-file', 'change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const patch = S.importable(JSON.parse(reader.result));
        const prev = S.get();
        render(S.save(patch));
        renderStorage();
        flash('Imported');
        offerUndo(prev, 'import');
      } catch (err) {
        alert("Couldn't read that file — " + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  const resetAll = () => {
    const prev = S.get();
    if (S.isDefault(prev)) { flash('Already default'); return; }
    render(S.reset());
    renderStorage();
    flash('Reset');
    offerUndo(prev, 'reset');
  };
  on('reset-btn', 'click', resetAll);
  on('reset-all-btn', 'click', resetAll);


  // ═══════════════════════════════════════════════════════════════
  //  Looks — curated bundles. Each one is a complete set of values,
  //  not a patch, so switching between them is predictable.
  // ═══════════════════════════════════════════════════════════════
  const LOOKS = [
    { id: 'steel', name: 'Steel', note: 'The project default',
      bg: '#f4f5f7', fg: '#0f1117', settings: {} },

    { id: 'terminal', name: 'Terminal', note: 'Mono, sharp, dense',
      bg: '#0d0f14', fg: '#e8eaf0',
      settings: { theme: 'dark', accent: 'teal', market: 'contrast', sans: 'system',
                  mono: 'jetbrains', radius: 'sharp', density: 'compact', numerals: 'tabular',
                  tableHeaders: 'sticky', tableBorders: 'reduced' } },

    { id: 'floor', name: 'Trading Floor', note: 'Amber on black, tight rows',
      bg: '#0d0f14', fg: '#f59e0b',
      settings: { theme: 'dark', accent: 'amber', mono: 'roboto-mono', scale: 0.95,
                  density: 'compact', tableHeaders: 'sticky', tableBorders: 'none', tableStripes: 'zebra' } },

    { id: 'broadsheet', name: 'Broadsheet', note: 'Roomy, light, readable',
      bg: '#f4f5f7', fg: '#0f1117',
      settings: { theme: 'light', sans: 'source-sans', mono: 'ibm-plex-mono',
                  radius: 'soft', density: 'spacious', scale: 1.05, lineHeight: 1.15, tableStripes: 'zebra' } },

    { id: 'accessible', name: 'Accessible', note: 'Larger, calmer, colour-blind safe',
      bg: '#f4f5f7', fg: '#0072b2',
      settings: { sans: 'inter', scale: 1.2, lineHeight: 1.2, weight: 100, numerals: 'tabular',
                  market: 'colorblind', motion: 'reduced', density: 'spacious', tableStripes: 'zebra' } },
  ];

  const fullSettings = look => Object.assign({}, S.DEFAULTS, look.settings);

  const sameLook = (s, look) => {
    const full = fullSettings(look);
    return Object.keys(S.DEFAULTS).every(k => s[k] === full[k]);
  };

  // The chips describe the Looks themselves, not the current state, so they
  // are built once; render() only moves the active ring.
  let looksBuilt = false;
  function buildLooks() {
    $('looks-grid').innerHTML = LOOKS.map(look => {
      const full = fullSettings(look);
      const accent = (S.ACCENTS.find(a => a.id === full.accent) || {});
      const market = (S.MARKETS.find(m => m.id === full.market) || {});
      const dark = full.theme === 'dark';
      const accentHex = (dark ? accent.dark : accent.light) || accent.swatch || '#1a5cff';
      const gain = (dark ? market.gain && market.gain.dark : market.gain && market.gain.light)
                   || (market.swatch && market.swatch.gain) || '#0f9960';
      const loss = (dark ? market.loss && market.loss.dark : market.loss && market.loss.light)
                   || (market.swatch && market.swatch.loss) || '#d13f3f';
      const radius = { sharp: '2px', soft: '12px' }[full.radius] || '6px';
      return `
        <button type="button" class="look" data-look="${look.id}" aria-pressed="false">
          <span class="look-chip" style="background:${look.bg};border-color:${accentHex};border-radius:${radius}">
            <span class="glyph" style="color:${look.fg}">Aa</span>
            <span class="bar" style="background:${accentHex}"></span>
            <span class="tick" style="background:${gain}"></span>
            <span class="tick" style="background:${loss}"></span>
          </span>
          <span class="look-name">${esc(look.name)}</span>
          <span class="look-note">${esc(look.note)}</span>
        </button>`;
    }).join('');
    looksBuilt = true;
  }

  function renderLooks(s) {
    if (!looksBuilt) buildLooks();
    $('looks-grid').querySelectorAll('[data-look]').forEach(b => {
      const on = sameLook(s, LOOKS.find(l => l.id === b.dataset.look));
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  $('looks-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-look]');
    if (!btn) return;
    const look = LOOKS.find(l => l.id === btn.dataset.look);
    if (sameLook(S.get(), look)) { flash(look.name + ' is on'); return; }
    replaceAll(look.settings, look.name + ' applied', 'look');
  });

  // ═══════════════════════════════════════════════════════════════
  //  Contrast — the colour-blind palette is pointless if the colour
  //  it lands on can't be read, so check it against WCAG here.
  // ═══════════════════════════════════════════════════════════════
  function parseColour(v) {
    if (!v) return null;
    const s = v.trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(s);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = /^#?([0-9a-f]{3})$/i.exec(s);
    if (m) return m[1].split('').map(c => parseInt(c + c, 16));
    m = /rgba?\(([^)]+)\)/i.exec(s);
    if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2]]; }
    return null;
  }

  const channel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const luminance = rgb => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);

  function contrastRatio(a, b) {
    const ca = parseColour(a), cb = parseColour(b);
    if (!ca || !cb) return null;
    const la = luminance(ca), lb = luminance(cb);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function badge(el, ratios) {
    const worst = ratios.filter(r => r !== null).sort((a, b) => a - b)[0];
    if (worst === undefined) { el.textContent = ''; el.className = 'contrast-badge'; return; }
    const grade = worst >= 4.5 ? 'pass' : worst >= 3 ? 'warn' : 'fail';
    const wording = { pass: 'AA', warn: 'AA large', fail: 'low' }[grade];
    el.textContent = worst.toFixed(1) + ':1 ' + wording;
    el.className = 'contrast-badge ' + grade;
    el.title = grade === 'pass'
      ? 'Meets WCAG AA for body text (4.5:1)'
      : 'Below WCAG AA for body text — readable for large text only';
  }

  function renderContrast() {
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg-card') || '#ffffff';
    badge($('accent-contrast'), [contrastRatio(cs.getPropertyValue('--accent'), bg)]);
    badge($('market-contrast'), [
      contrastRatio(cs.getPropertyValue('--gain'), bg),
      contrastRatio(cs.getPropertyValue('--loss'), bg),
    ]);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Share — settings travel as a link, for a second browser or device.
  //  URL-safe base64 of the UTF-8 JSON; decoding also accepts the plain
  //  base64 that older links carried.
  // ═══════════════════════════════════════════════════════════════
  function encodeSettings(s) {
    const bytes = new TextEncoder().encode(JSON.stringify(s));
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeSettings(token) {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return S.importable(JSON.parse(new TextDecoder().decode(bytes)));
  }

  function shareLink() {
    return location.origin + location.pathname + '#s=' + encodeSettings(S.get());
  }

  on('share-btn', 'click', async () => {
    const url = shareLink();
    const hint = $('share-hint');
    hint.hidden = false;
    try {
      await navigator.clipboard.writeText(url);
      hint.textContent = 'Link copied — opening it in another browser applies this exact look.';
      flash('Copied');
    } catch (err) {
      // Clipboard is blocked outside a secure context; show the link to copy by hand.
      hint.textContent = url;
    }
  });

  function checkSharedLink() {
    const m = /^#s=(.+)$/.exec(location.hash);
    if (!m) return;
    let patch;
    try { patch = decodeSettings(m[1]); } catch (e) { return; }
    const banner = $('share-banner');
    const changed = Object.keys(patch).filter(k => patch[k] !== S.DEFAULTS[k]).length;
    $('share-banner-detail').textContent =
      changed + ' non-default setting' + (changed === 1 ? '' : 's') + ' in this link. Applying replaces your current preferences.';
    banner.hidden = false;
    $('share-apply').onclick = () => {
      replaceAll(patch, 'Applied', 'shared look');
      banner.hidden = true;
      history.replaceState(null, '', location.pathname);
    };
    $('share-dismiss').onclick = () => {
      banner.hidden = true;
      history.replaceState(null, '', location.pathname);
    };
  }

  // ── Rail: scroll-spy + smooth jump ────────────────────────────────
  const railItems = Array.from(document.querySelectorAll('.set-rail-item'));
  const sections = railItems.map(a => $(a.dataset.section)).filter(Boolean);

  railItems.forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const target = $(a.dataset.section);
    if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 74, behavior: 'smooth' });
  }));

  function spy() {
    let active = sections[0];
    for (const sec of sections) {
      if (sec.getBoundingClientRect().top - 120 <= 0) active = sec;
    }
    railItems.forEach(a => a.classList.toggle('active', a.dataset.section === (active && active.id)));
  }
  window.addEventListener('scroll', spy, { passive: true });
  window.addEventListener('resize', spy);

  // Another tab changed the settings — keep the controls in step.
  window.addEventListener('storage', e => { if (e.key === S.KEY) render(S.get()); });
  // Settings can also change programmatically (the header theme toggle
  // rewrites a forced theme, for one) — re-read rather than trusting the
  // last thing this page rendered.
  document.addEventListener('dse-display-applied', () => render(S.get()));

  // Pasting a share link while already on this page is a same-document
  // navigation — no reload, so watch the hash too.
  window.addEventListener('hashchange', checkSharedLink);

  render(S.get());
  renderStorage();
  checkSharedLink();
  spy();
})();
