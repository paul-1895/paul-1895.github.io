/* Settings page — every preference lives in window.DSESettings
   (shared/display-settings.js); this file is only the UI around it. */
(function () {
  'use strict';

  const S = window.DSESettings;
  if (!S) { console.error('display-settings.js did not load'); return; }

  const $ = id => document.getElementById(id);

  // ── Build controls from the shared registries ─────────────────────
  const fillSelect = (el, list, label) =>
    el.innerHTML = list.map(x => `<option value="${x.id}">${label(x)}</option>`).join('');

  const fillSeg = (el, list) =>
    el.innerHTML = list.map(x => `<button type="button" data-id="${x.id}">${x.label}</button>`).join('');

  fillSelect($('theme-select'),   S.THEMES,        t => t.label);
  fillSelect($('sans-select'),    S.FAMILIES.sans, f => f.label);
  fillSelect($('mono-select'),    S.FAMILIES.mono, f => f.label);
  fillSelect($('refresh-select'), S.REFRESHES,     r => r.label);

  fillSeg($('density-seg'), S.DENSITIES);
  fillSeg($('radius-seg'),  S.RADII);
  fillSeg($('headers-seg'), S.HEADER_STYLES);
  fillSeg($('borders-seg'), S.BORDER_STYLES);

  $('accent-swatches').innerHTML = S.ACCENTS.map(a => `
    <button type="button" class="swatch" data-id="${a.id}">
      <i style="background:${a.swatch || a.light}"></i><span>${a.label}</span>
    </button>`).join('');

  $('market-options').innerHTML = S.MARKETS.map(m => `
    <button type="button" class="option" data-id="${m.id}">
      <span class="option-bars">
        <i style="background:${(m.swatch && m.swatch.gain) || m.gain.light}"></i>
        <i style="background:${(m.swatch && m.swatch.loss) || m.loss.light}"></i>
      </span>
      <span class="option-text"><b>${m.label}</b><span>${m.note}</span></span>
    </button>`).join('');

  // ── Render state into the controls ────────────────────────────────
  const markActive = (el, value, attr) =>
    el.querySelectorAll('[' + attr + ']').forEach(b =>
      b.classList.toggle('active', b.getAttribute(attr) === String(value)));

  function render(s) {
    $('theme-select').value   = s.theme;
    $('sans-select').value    = s.sans;
    $('mono-select').value    = s.mono;
    $('refresh-select').value = s.refresh;

    $('scale-range').value = Math.round(s.scale * 100);
    $('lh-range').value    = Math.round(s.lineHeight * 100);
    $('ls-range').value    = Math.round(s.letterSpacing * 1000);
    if (document.activeElement !== $('commission-input')) $('commission-input').value = s.commission;

    $('scale-value').textContent = Math.round(s.scale * 100) + '%';
    $('lh-value').textContent    = Math.round(s.lineHeight * 100) + '%';
    $('ls-value').textContent    = s.letterSpacing.toFixed(3).replace(/0$/, '') + 'em';

    markActive($('weight-seg'),      s.weight,        'data-weight');
    markActive($('motion-seg'),      s.motion,        'data-motion');
    markActive($('notif-seg'),       s.notifications, 'data-notif');
    markActive($('density-seg'),     s.density,       'data-id');
    markActive($('radius-seg'),      s.radius,        'data-id');
    markActive($('headers-seg'),     s.tableHeaders,  'data-id');
    markActive($('borders-seg'),     s.tableBorders,  'data-id');
    markActive($('accent-swatches'), s.accent,        'data-id');
    markActive($('market-options'),  s.market,        'data-id');

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
    if (!isNaN(v)) update({ commission: Math.min(10, Math.max(0, v)) });
  });

  const segClick = (id, attr, key, cast) => $(id).addEventListener('click', e => {
    const btn = e.target.closest('[' + attr + ']');
    if (!btn) return;
    const raw = btn.getAttribute(attr);
    update({ [key]: cast ? cast(raw) : raw });
  });

  segClick('weight-seg',      'data-weight', 'weight', Number);
  segClick('motion-seg',      'data-motion', 'motion');
  segClick('notif-seg',       'data-notif',  'notifications');
  segClick('density-seg',     'data-id',     'density');
  segClick('radius-seg',      'data-id',     'radius');
  segClick('headers-seg',     'data-id',     'tableHeaders');
  segClick('borders-seg',     'data-id',     'tableBorders');
  segClick('accent-swatches', 'data-id',     'accent');
  segClick('market-options',  'data-id',     'market');

  // ── About: what is actually in force right now ────────────────────
  function renderAbout(s) {
    const label = (list, id) => (list.find(x => x.id === id) || {}).label || id;
    const changed = Object.keys(S.DEFAULTS).filter(k => s[k] !== S.DEFAULTS[k]).length;
    const rows = [
      ['Settings changed', changed ? changed + ' of ' + Object.keys(S.DEFAULTS).length : 'None — all defaults'],
      ['Active theme',     S.currentTheme() + ' · ' + label(S.THEMES, s.theme)],
      ['Typeface',         label(S.FAMILIES.sans, s.sans) + ' / ' + label(S.FAMILIES.mono, s.mono)],
      ['Price refresh',    label(S.REFRESHES, s.refresh)],
      ['Table chrome',     label(S.DENSITIES, s.density) + ' · ' + label(S.BORDER_STYLES, s.tableBorders) + ' borders'],
      ['Applies to',       '52 pages · stored in this browser'],
    ];
    $('about-list').innerHTML = rows.map(([k, v]) => `
      <div class="option static">
        <span class="option-text"><b>${k}</b><span>${v}</span></span>
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
    for (let i = 0; i < localStorage.length; i++) {
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
          <b>${g.label}</b><span>${g.note} · ${g.keys.length} key${g.keys.length > 1 ? 's' : ''} · ${bytes(g.size)}</span>
        </span>
        <button class="btn small danger" type="button" data-clear="${g.label}">Clear</button>
      </div>`).join('') : '<div class="hint" style="margin:0">Nothing stored yet.</div>';
  }

  $('storage-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-clear]');
    if (!btn) return;
    const group = groupStorage().find(g => g.label === btn.getAttribute('data-clear'));
    if (!group) return;
    if (!confirm(`Clear ${group.label.toLowerCase()}? ${group.keys.length} stored item(s) will be removed. This cannot be undone.`)) return;
    const hadSettings = group.keys.includes(S.KEY);
    group.keys.forEach(k => localStorage.removeItem(k));
    if (hadSettings) render(S.reset());
    renderStorage();
    flash('Cleared');
  });

  // ── Backup ────────────────────────────────────────────────────────
  on('export-btn', 'click', () => {
    const blob = new Blob([JSON.stringify(S.get(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dse-settings.json';
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
        const data = JSON.parse(reader.result);
        const patch = {};
        Object.keys(S.DEFAULTS).forEach(k => { if (k in data) patch[k] = data[k]; });
        if (!Object.keys(patch).length) throw new Error('no recognised settings');
        render(S.save(patch));
        renderStorage();
        flash('Imported');
      } catch (err) {
        alert("Couldn't read that file — " + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  const resetAll = () => {
    if (!confirm('Reset every setting back to its default?')) return;
    render(S.reset());
    renderStorage();
    flash('Reset');
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
                  mono: 'jetbrains', radius: 'sharp', density: 'compact',
                  tableHeaders: 'sticky', tableBorders: 'reduced' } },

    { id: 'floor', name: 'Trading Floor', note: 'Amber on black, tight rows',
      bg: '#0d0f14', fg: '#f59e0b',
      settings: { theme: 'dark', accent: 'amber', mono: 'roboto-mono', scale: 0.95,
                  density: 'compact', tableHeaders: 'sticky', tableBorders: 'none' } },

    { id: 'broadsheet', name: 'Broadsheet', note: 'Roomy, light, readable',
      bg: '#f4f5f7', fg: '#0f1117',
      settings: { theme: 'light', sans: 'source-sans', mono: 'ibm-plex-mono',
                  radius: 'soft', density: 'spacious', scale: 1.05, lineHeight: 1.15 } },

    { id: 'accessible', name: 'Accessible', note: 'Larger, calmer, colour-blind safe',
      bg: '#f4f5f7', fg: '#0072b2',
      settings: { sans: 'inter', scale: 1.2, lineHeight: 1.2, weight: 100,
                  market: 'colorblind', motion: 'reduced', density: 'spacious' } },
  ];

  const fullSettings = look => Object.assign({}, S.DEFAULTS, look.settings);

  const sameLook = (s, look) => {
    const full = fullSettings(look);
    return Object.keys(S.DEFAULTS).every(k => s[k] === full[k]);
  };

  function renderLooks(s) {
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
        <button type="button" class="look" data-look="${look.id}">
          <span class="look-chip" style="background:${look.bg};border-color:${accentHex};border-radius:${radius}">
            <span class="glyph" style="color:${look.fg}">Aa</span>
            <span class="bar" style="background:${accentHex}"></span>
            <span class="tick" style="background:${gain}"></span>
            <span class="tick" style="background:${loss}"></span>
          </span>
          <span class="look-name">${look.name}</span>
          <span class="look-note">${look.note}</span>
        </button>`;
    }).join('');
    $('looks-grid').querySelectorAll('[data-look]').forEach(b => {
      b.classList.toggle('active', sameLook(s, LOOKS.find(l => l.id === b.dataset.look)));
    });
  }

  $('looks-grid').addEventListener('click', e => {
    const btn = e.target.closest('[data-look]');
    if (!btn) return;
    const look = LOOKS.find(l => l.id === btn.dataset.look);
    update(fullSettings(look), look.name);
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
  //  Share — settings travel as a link, for a second browser or device
  // ═══════════════════════════════════════════════════════════════
  const encodeSettings = s => btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/=+$/, '');

  function decodeSettings(token) {
    const padded = token + '==='.slice((token.length + 3) % 4);
    const data = JSON.parse(decodeURIComponent(escape(atob(padded))));
    const patch = {};
    Object.keys(S.DEFAULTS).forEach(k => { if (k in data) patch[k] = data[k]; });
    if (!Object.keys(patch).length) throw new Error('no recognised settings');
    return patch;
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
      render(S.save(patch));
      renderStorage();
      banner.hidden = true;
      history.replaceState(null, '', location.pathname);
      flash('Applied');
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
  // Settings can also change from another tab or programmatically — re-read
  // rather than trusting the last thing this page rendered.
  let syncing = false;
  document.addEventListener('dse-display-applied', () => {
    if (syncing) return;
    syncing = true;
    render(S.get());
    syncing = false;
  });

  // Pasting a share link while already on this page is a same-document
  // navigation — no reload, so watch the hash too.
  window.addEventListener('hashchange', checkSharedLink);

  render(S.get());
  renderStorage();
  checkSharedLink();
  spy();
})();
