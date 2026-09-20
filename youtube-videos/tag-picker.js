/* ═══════════════════════════════════════════════════════════
   tag-picker.js — reusable ticker/sector multi-tag input widget
   for the "YouTube Videos" Add/Edit form.

   window.YTTagPicker.create(mountEl, { type: "ticker"|"sector", initialValues })
     -> { getValues(): string[], destroy(): void }

   Suggestions come from GET /api/sectors — a flat { TICKER: "Sector
   Name" } map. type "ticker" suggests Object.keys(map); type "sector"
   suggests the map's unique values. The fetch is made once and shared
   across every picker instance on the page (an Add/Edit form mounts
   one of each type at the same time).

   Markup uses the shared .yt-tag-picker / .yt-tag-picker__chip /
   .yt-tag-picker__input classes the page shell styles; the parts this
   widget alone owns (the suggestion dropdown, the chip's remove
   control) carry their own classes and a small self-injected <style>
   block, so the widget looks right even if nothing else has loaded.

   Self-contained: no dependency on any other youtube-videos/*.js file.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const MAX_SUGGESTIONS = 8;

  // ── shared /api/sectors fetch (once per page, not once per picker) ──
  let sectorsMapPromise = null;
  function loadSectorsMap() {
    if (!sectorsMapPromise) {
      sectorsMapPromise = fetch('/api/sectors')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return sectorsMapPromise;
  }

  // ── one-time injected CSS for the parts the page shell doesn't own ──
  function ensureStyle() {
    if (document.getElementById('yt-tag-picker-style')) return;
    const style = document.createElement('style');
    style.id = 'yt-tag-picker-style';
    style.textContent = `
      .yt-tag-picker { position: relative; }
      .yt-tag-picker__chip-remove {
        border: none; background: transparent; cursor: pointer;
        margin-left: 4px; padding: 0 2px; line-height: 1; font-size: 13px;
        color: inherit; opacity: 0.65;
      }
      .yt-tag-picker__chip-remove:hover { opacity: 1; }
      .yt-tag-picker__suggestions {
        position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px;
        z-index: 40; max-height: 190px; overflow-y: auto;
        background: var(--bg-card, var(--card-bg, #fff));
        border: 1px solid var(--border, #d0d5dd);
        border-radius: 6px; box-shadow: 0 6px 16px rgba(0,0,0,0.15);
      }
      .yt-tag-picker__suggestion {
        padding: 6px 10px; cursor: pointer; font-size: 13px;
      }
      .yt-tag-picker__suggestion.is-active,
      .yt-tag-picker__suggestion:hover {
        background: var(--hover-bg, rgba(127,127,127,0.15));
      }
    `;
    document.head.appendChild(style);
  }

  function uniqueSorted(values) {
    const seen = new Set();
    const out = [];
    values.forEach((v) => {
      const key = String(v || '').trim();
      const lower = key.toLowerCase();
      if (!key || seen.has(lower)) return;
      seen.add(lower);
      out.push(key);
    });
    out.sort((a, b) => a.localeCompare(b));
    return out;
  }

  // ── widget ────────────────────────────────────────────────
  function create(mountEl, opts) {
    opts = opts || {};
    const type = opts.type === 'sector' ? 'sector' : 'ticker';
    const normalize = (s) => {
      const trimmed = String(s || '').trim();
      return type === 'ticker' ? trimmed.toUpperCase() : trimmed;
    };

    let destroyed = false;
    let allSuggestions = [];   // populated once /api/sectors resolves
    let highlighted = -1;      // index into the currently-rendered suggestion list

    const values = [];
    (opts.initialValues || []).forEach((v) => {
      const n = normalize(v);
      if (n && !values.some((x) => x.toLowerCase() === n.toLowerCase())) values.push(n);
    });

    ensureStyle();

    // ── DOM scaffold ───────────────────────────────────────
    mountEl.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'yt-tag-picker';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'yt-tag-picker__input';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-label', type === 'ticker' ? 'Add ticker' : 'Add sector');
    input.placeholder = type === 'ticker' ? 'Add ticker…' : 'Add sector…';

    const suggestBox = document.createElement('div');
    suggestBox.className = 'yt-tag-picker__suggestions';
    suggestBox.hidden = true;

    root.appendChild(input);
    root.appendChild(suggestBox);
    mountEl.appendChild(root);

    // ── rendering ────────────────────────────────────────
    function renderChips() {
      root.querySelectorAll('.yt-tag-picker__chip').forEach((el) => el.remove());
      values.forEach((v) => {
        const chip = document.createElement('span');
        chip.className = 'yt-tag-picker__chip';

        const label = document.createElement('span');
        label.textContent = v;

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'yt-tag-picker__chip-remove';
        remove.setAttribute('aria-label', `Remove ${v}`);
        remove.textContent = '×';
        remove.addEventListener('click', (e) => {
          e.preventDefault();
          removeValue(v);
        });

        chip.appendChild(label);
        chip.appendChild(remove);
        root.insertBefore(chip, input);
      });
    }

    function currentSuggestions() {
      const q = input.value.trim().toLowerCase();
      const pool = allSuggestions.filter(
        (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())
      );
      const filtered = q ? pool.filter((s) => s.toLowerCase().includes(q)) : pool;
      return filtered.slice(0, MAX_SUGGESTIONS);
    }

    function renderSuggestions() {
      const list = currentSuggestions();
      suggestBox.innerHTML = '';
      if (!list.length) {
        suggestBox.hidden = true;
        highlighted = -1;
        return;
      }
      if (highlighted >= list.length) highlighted = list.length - 1;
      list.forEach((s, i) => {
        const item = document.createElement('div');
        item.className = 'yt-tag-picker__suggestion' + (i === highlighted ? ' is-active' : '');
        item.textContent = s;
        // mousedown (not click) fires before the input's blur handler hides the box
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          addValue(s);
        });
        suggestBox.appendChild(item);
      });
      suggestBox.hidden = false;
    }

    // ── mutation ─────────────────────────────────────────
    function addValue(raw) {
      const n = normalize(raw);
      input.value = '';
      highlighted = -1;
      if (n && !values.some((v) => v.toLowerCase() === n.toLowerCase())) {
        values.push(n);
        renderChips();
      }
      renderSuggestions();
      input.focus();
    }

    function removeValue(v) {
      const idx = values.indexOf(v);
      if (idx === -1) return;
      values.splice(idx, 1);
      renderChips();
      renderSuggestions();
    }

    // ── input events ─────────────────────────────────────
    input.addEventListener('input', () => {
      highlighted = -1;
      renderSuggestions();
    });

    input.addEventListener('focus', renderSuggestions);

    input.addEventListener('blur', () => {
      // Delay the hide so a suggestion's mousedown still lands first.
      setTimeout(() => { if (!destroyed) suggestBox.hidden = true; }, 120);
    });

    input.addEventListener('keydown', (e) => {
      const list = currentSuggestions();
      if (e.key === 'ArrowDown') {
        if (!list.length) return;
        e.preventDefault();
        highlighted = (highlighted + 1) % list.length;
        renderSuggestions();
      } else if (e.key === 'ArrowUp') {
        if (!list.length) return;
        e.preventDefault();
        highlighted = (highlighted - 1 + list.length) % list.length;
        renderSuggestions();
      } else if (e.key === 'Enter' || e.key === ',') {
        if (highlighted >= 0 && list[highlighted]) {
          e.preventDefault();
          addValue(list[highlighted]);
        } else if (input.value.trim()) {
          e.preventDefault();
          addValue(input.value);
        }
      } else if (e.key === 'Escape') {
        suggestBox.hidden = true;
        highlighted = -1;
      } else if (e.key === 'Backspace' && !input.value && values.length) {
        removeValue(values[values.length - 1]);
      }
    });

    // ── initial render ───────────────────────────────────
    renderChips();
    loadSectorsMap().then((map) => {
      if (destroyed) return;
      const safeMap = map && typeof map === 'object' ? map : {};
      allSuggestions = type === 'ticker'
        ? uniqueSorted(Object.keys(safeMap))
        : uniqueSorted(Object.values(safeMap).filter(Boolean));
    });

    return {
      getValues: () => values.slice(),
      destroy: () => {
        destroyed = true;
        mountEl.innerHTML = '';
      },
    };
  }

  window.YTTagPicker = { create };
})();
