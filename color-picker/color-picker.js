/* ════════════════════════════════════════════════════════════
   color-picker.js  —  TradingView-style color picker
   Self-contained. No dependencies.

   Usage:
     ColorPicker.open(anchorEl, currentHex, opacity, callback)
       anchorEl   — element to position below (the swatch button)
       currentHex — '#rrggbb' initial color
       opacity    — 0–100 initial opacity
       callback   — fn({ hex, opacity, rgba }) called on every change

     ColorPicker.close()
   ════════════════════════════════════════════════════════════ */

const ColorPicker = (() => {
  'use strict';

  /* ── Palette (matches TradingView's grid exactly) ─────────── */
  const PALETTE = [
    // Row 1 — greys
    '#ffffff','#d1d4dc','#b2b5be','#868993','#676a74','#4c4f56','#363a45','#2a2e39','#1c2030','#000000',
    // Row 2 — vivid
    '#f23645','#ff9800','#ffd700','#4caf50','#00897b','#00bcd4','#2196f3','#3949ab','#9c27b0','#e91e63',
    // Row 3 — pastel row 1
    '#ffcdd2','#ffe0b2','#fff9c4','#c8e6c9','#b2dfdb','#b2ebf2','#bbdefb','#c5cae9','#e1bee7','#fce4ec',
    // Row 4 — pastel row 2
    '#ef9a9a','#ffcc80','#fff176','#a5d6a7','#80cbc4','#80deea','#90caf9','#9fa8da','#ce93d8','#f48fb1',
    // Row 5 — mid
    '#e57373','#ffa726','#ffee58','#66bb6a','#26a69a','#26c6da','#42a5f5','#5c6bc0','#ab47bc','#ec407a',
    // Row 6 — strong
    '#f44336','#ff9800','#ffeb3b','#4caf50','#009688','#00bcd4','#2196f3','#3f51b5','#9c27b0','#e91e63',
    // Row 7 — dark
    '#b71c1c','#e65100','#f57f17','#1b5e20','#004d40','#006064','#0d47a1','#1a237e','#4a148c','#880e4f',
    // Row 8 — darkest
    '#7f0000','#7f3000','#7f6000','#1a3300','#00332d','#003333','#0a1f4a','#0d0f40','#260a40','#40071e',
  ];

  /* ── Recent colors (persisted in localStorage) ────────────── */
  let _recent = (() => {
    try { return JSON.parse(localStorage.getItem('cp_recent') || '[]'); } catch { return []; }
  })();
  function _saveRecent(hex) {
    _recent = [hex, ..._recent.filter(c => c !== hex)].slice(0, 8);
    try { localStorage.setItem('cp_recent', JSON.stringify(_recent)); } catch {}
  }

  /* ── State ─────────────────────────────────────────────────── */
  let _callback  = null;
  let _hex       = '#26a69a';
  let _opacity   = 100;
  let _panel     = null;
  let _anchor    = null;

  /* ── Build panel DOM (once) ─────────────────────────────────── */
  function _build() {
    if (_panel) return;

    _panel = document.createElement('div');
    _panel.id        = 'tv-color-picker';
    _panel.className = 'tvcp-panel';
    _panel.innerHTML = `
      <!-- Top: two large preview swatches (like TV: fill + border) -->
      <div class="tvcp-previews" id="tvcp-previews">
        <div class="tvcp-preview-swatch tvcp-preview-active" id="tvcp-preview-swatch"></div>
      </div>

      <!-- Palette grid -->
      <div class="tvcp-grid" id="tvcp-grid"></div>

      <!-- Recent colors row -->
      <div class="tvcp-recent-wrap">
        <div class="tvcp-recent-row" id="tvcp-recent-row"></div>
        <button class="tvcp-add-btn" id="tvcp-add-btn" title="Enter custom hex">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <!-- Custom hex input (hidden until + clicked) -->
      <div class="tvcp-hex-row" id="tvcp-hex-row" style="display:none">
        <span class="tvcp-hash">#</span>
        <input class="tvcp-hex-input" id="tvcp-hex-input" maxlength="6" placeholder="26a69a" spellcheck="false">
        <button class="tvcp-hex-ok" id="tvcp-hex-ok">OK</button>
      </div>

      <!-- Divider -->
      <div class="tvcp-divider"></div>

      <!-- Opacity row -->
      <div class="tvcp-opacity-row">
        <span class="tvcp-opacity-label">Opacity</span>
        <div class="tvcp-slider-wrap">
          <div class="tvcp-slider-track" id="tvcp-slider-track">
            <div class="tvcp-slider-fill" id="tvcp-slider-fill"></div>
            <div class="tvcp-slider-thumb" id="tvcp-slider-thumb"></div>
          </div>
        </div>
        <input class="tvcp-opacity-input" id="tvcp-opacity-input" type="text" maxlength="4" value="100%">
      </div>
    `;
    document.body.appendChild(_panel);

    /* Palette cells */
    const grid = _panel.querySelector('#tvcp-grid');
    PALETTE.forEach(color => {
      const cell = document.createElement('div');
      cell.className       = 'tvcp-cell';
      cell.style.background = color;
      cell.dataset.color   = color;
      cell.addEventListener('click', () => _pickColor(color));
      grid.appendChild(cell);
    });

    /* + button toggles hex input */
    _panel.querySelector('#tvcp-add-btn').addEventListener('click', _toggleHexInput);

    /* Hex input OK */
    _panel.querySelector('#tvcp-hex-ok').addEventListener('click', _commitHex);
    _panel.querySelector('#tvcp-hex-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') _commitHex();
    });
    _panel.querySelector('#tvcp-hex-input').addEventListener('input', e => {
      const val = e.target.value.replace(/[^0-9a-fA-F]/g, '');
      e.target.value = val;
      if (val.length === 6) _pickColor('#' + val, false);
    });

    /* Opacity slider drag */
    _initSlider();

    /* Opacity text input */
    const opIn = _panel.querySelector('#tvcp-opacity-input');
    opIn.addEventListener('change', () => {
      let v = parseInt(opIn.value) || 100;
      v = Math.max(0, Math.min(100, v));
      _opacity = v;
      _updateSlider();
      _emit();
    });
    opIn.addEventListener('keydown', e => { if (e.key === 'Enter') opIn.blur(); });

    /* Close on outside click */
    document.addEventListener('mousedown', _onOutside, true);
  }

  function _initSlider() {
    const track = _panel.querySelector('#tvcp-slider-track');
    let dragging = false;

    const update = clientX => {
      const rect = track.getBoundingClientRect();
      let pct    = (clientX - rect.left) / rect.width;
      pct        = Math.max(0, Math.min(1, pct));
      _opacity   = Math.round(pct * 100);
      _updateSlider();
      _emit();
    };

    track.addEventListener('mousedown', e => {
      dragging = true;
      update(e.clientX);
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => { if (dragging) update(e.clientX); });
    document.addEventListener('mouseup',   () => { dragging = false; });

    track.addEventListener('touchstart', e => {
      dragging = true;
      update(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (dragging) update(e.touches[0].clientX);
    }, { passive: true });
    document.addEventListener('touchend', () => { dragging = false; });
  }

  function _updateSlider() {
    if (!_panel) return;
    const pct   = _opacity / 100;
    const fill  = _panel.querySelector('#tvcp-slider-fill');
    const thumb = _panel.querySelector('#tvcp-slider-thumb');
    const opIn  = _panel.querySelector('#tvcp-opacity-input');
    if (fill)  fill.style.width  = (pct * 100) + '%';
    if (thumb) thumb.style.left  = (pct * 100) + '%';
    if (opIn)  opIn.value        = _opacity + '%';
    /* Update the checkerboard/gradient track background */
    const track = _panel.querySelector('#tvcp-slider-track');
    if (track) {
      track.style.background =
        `linear-gradient(to right, transparent, ${_hex}),
         repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 0 0 / 8px 8px`;
    }
  }

  function _updatePreview() {
    if (!_panel) return;
    const swatch = _panel.querySelector('#tvcp-preview-swatch');
    if (swatch) swatch.style.background = _hex;
    /* Highlight matching cell */
    _panel.querySelectorAll('.tvcp-cell').forEach(c => {
      c.classList.toggle('tvcp-cell-active', c.dataset.color === _hex);
    });
    _updateRecentRow();
  }

  function _updateRecentRow() {
    const row = _panel.querySelector('#tvcp-recent-row');
    if (!row) return;
    row.innerHTML = '';
    _recent.forEach(color => {
      const d = document.createElement('div');
      d.className        = 'tvcp-recent-dot';
      d.style.background = color;
      d.title            = color;
      d.addEventListener('click', () => _pickColor(color));
      row.appendChild(d);
    });
  }

  function _pickColor(hex, addToRecent = true) {
    _hex = hex.toLowerCase();
    if (addToRecent) _saveRecent(_hex);
    _updatePreview();
    _updateSlider();
    _emit();
    /* Sync hex input if visible */
    const inp = _panel && _panel.querySelector('#tvcp-hex-input');
    if (inp) inp.value = _hex.replace('#', '');
  }

  function _toggleHexInput() {
    const row = _panel.querySelector('#tvcp-hex-row');
    if (!row) return;
    const hidden = row.style.display === 'none';
    row.style.display = hidden ? 'flex' : 'none';
    if (hidden) {
      const inp = _panel.querySelector('#tvcp-hex-input');
      inp.value = _hex.replace('#', '');
      inp.focus();
      inp.select();
    }
  }

  function _commitHex() {
    const inp = _panel.querySelector('#tvcp-hex-input');
    if (!inp) return;
    const val = inp.value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(val)) {
      _pickColor('#' + val);
    }
    _panel.querySelector('#tvcp-hex-row').style.display = 'none';
  }

  function _emit() {
    if (!_callback) return;
    const a = _opacity / 100;
    const r = parseInt(_hex.slice(1,3), 16);
    const g = parseInt(_hex.slice(3,5), 16);
    const b = parseInt(_hex.slice(5,7), 16);
    _callback({ hex: _hex, opacity: _opacity, rgba: `rgba(${r},${g},${b},${a})` });
  }

  function _onOutside(e) {
    if (_panel && !_panel.contains(e.target) && _anchor && !_anchor.contains(e.target)) {
      close();
    }
  }

  /* ── Position panel below anchor ─────────────────────────────── */
  function _position() {
    if (!_panel || !_anchor) return;
    const r  = _anchor.getBoundingClientRect();
    const pw = _panel.offsetWidth  || 250;
    const ph = _panel.offsetHeight || 400;
    let left = r.left;
    let top  = r.bottom + 6;
    /* Keep within viewport */
    if (left + pw > window.innerWidth  - 8) left = window.innerWidth  - pw - 8;
    if (top  + ph > window.innerHeight - 8) top  = r.top - ph - 6;
    if (left < 8) left = 8;
    _panel.style.left = left + 'px';
    _panel.style.top  = top  + 'px';
  }

  /* ── Public API ──────────────────────────────────────────────── */
  function open(anchorEl, hexColor, opacity, cb) {
    _build();
    _anchor   = anchorEl;
    _callback = cb;
    _hex      = (hexColor || '#26a69a').toLowerCase();
    _opacity  = Math.max(0, Math.min(100, opacity !== undefined ? opacity : 100));

    _panel.querySelector('#tvcp-hex-row').style.display = 'none';
    _panel.querySelector('#tvcp-hex-input').value = _hex.replace('#', '');
    _updatePreview();
    _updateSlider();

    _panel.style.display = 'block';
    _position();
  }

  function close() {
    if (_panel) _panel.style.display = 'none';
    _anchor   = null;
    _callback = null;
  }

  return { open, close };
})();