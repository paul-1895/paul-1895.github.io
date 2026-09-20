/* ════════════════════════════════════════════════════════════
   ac-legend.js
   TradingView-style in-chart indicator legend.

   The candlestick page shows indicators on TWO surfaces: the
   in-chart legend (#chartLegend — name, params and the live value
   at the hovered bar, but no controls) and a separate full-width
   pill band under the toolbar (#indicatorInstanceBar — eye /
   settings / trash, but no value). TradingView has ONE: a legend
   row inside the chart carrying name, params and value, which
   reveals its action buttons on hover.

   This file makes the Advanced Chart's legend that single surface:

     - decorates every legend row with a hover action pill
       (visibility / settings / remove / more), wired to the exact
       same functions the pill band's buttons call
     - synthesises a row for any active indicator the legend
       dropped this frame, showing "∅" for the value the way
       TradingView does, so an indicator is never unreachable just
       because it has no value at the hovered bar
     - expands the row list by default (the shared legend ships
       collapsed behind a "⌄ N" pill)

   advanced-chart.html then hides #indicatorInstanceBar and
   .strategy-controls, whose content now lives here.

   Row identity comes from the data-instance-id / data-pane-key
   attributes candlestick-legend.js emits on each row.

   Depends on : candlestick-legend.js (renderChartLegend),
                indicator-instances.js (indicatorInstances,
                INDICATOR_DEFS, createIndicatorInstance,
                updateIndicatorInstance),
                indicator-settings-modal.js (_toggleInstanceVisible,
                _removeInstanceFromBar, _toggleSubPaneVisibility,
                _removeSubPaneFromBar, openIndicatorSettings)
   Owns       : window.ACLegend
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  // ── Icons (same paths the pill band uses, so the two read alike) ──
  const ICON = {
    eyeOn:  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 4.22-5.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    gear:   '<path d="M12 2.6l7.4 4.27v8.54L12 19.68l-7.4-4.27V6.87z"/><circle cx="12" cy="11.14" r="2.4"/>',
    trash:  '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/>',
    more:   '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  };
  const svg = (paths, size) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="${size || 14}" height="${size || 14}">${paths}</svg>`;

  // ── Styles ────────────────────────────────────────────────────
  // Scoped to #chartLegend so this can't reach the rest of the shell.
  // advanced-chart.css owns the legend BOX (where it sits over the chart);
  // this owns what the rows look like.
  const CSS = `
/* The pill band is redundant now — the legend rows below carry the same
   controls, in the chart, the way TradingView does. It stays in the DOM
   because indicator-settings-modal.js renders into it by id on every
   change; !important because that render sets display:flex inline. */
#indicatorInstanceBar { display: none !important; }

#chartLegend {
  width: fit-content;
  max-width: min(560px, 60%);
  pointer-events: none;
}
#chartLegend .legend-row {
  pointer-events: auto;
  width: fit-content;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 6px 1px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  line-height: 1.5;
  white-space: nowrap;
}
#chartLegend .legend-indicator { position: relative; }

/* Name, then the muted parameter run, then the values in series colour —
   TradingView splits the label that way, so do the same here. The params are
   whatever trails the first word of the label ("Supertrend 10 3"). */
#chartLegend .legend-ind-name { color: var(--text-primary); font-weight: 500; }
#chartLegend .legend-ind-params { color: var(--text-muted); font-weight: 400; }
#chartLegend .legend-ind-val { font-variant-numeric: tabular-nums; }

/* A hidden indicator greys its whole row and flips the eye to "Show" — the
   row stays legible rather than fading out, so you can still read which
   indicator it is while it is off. */
#chartLegend .legend-indicator-muted .legend-ind-name,
#chartLegend .legend-indicator-muted .legend-ind-val { color: var(--text-muted); }
#chartLegend .legend-indicator-muted .legend-ind-val { opacity: .6; }

/* Hovering a row raises it into a pill and swaps its VALUES for its ACTIONS,
   which is what TradingView does — the row keeps its name and stays roughly
   the same width instead of growing sideways under the cursor. */
#chartLegend .legend-indicator:hover,
#chartLegend .legend-indicator.is-menu-open {
  background: var(--ac-legend-pill-bg);
  border-color: var(--ac-legend-pill-border);
  box-shadow: 0 2px 10px var(--ac-legend-pill-shadow);
  padding: 1px 6px 1px 8px;
}
#chartLegend .legend-indicator:hover .legend-ind-val,
#chartLegend .legend-indicator.is-menu-open .legend-ind-val { display: none; }

#chartLegend .legend-actions {
  display: none;
  align-items: center;
  gap: 1px;
  margin-left: 2px;
}
#chartLegend .legend-indicator:hover .legend-actions,
#chartLegend .legend-indicator.is-menu-open .legend-actions { display: flex; }

#chartLegend .legend-act {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 24px; padding: 0;
  border: 0; border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
#chartLegend .legend-act:hover { background: var(--ac-legend-act-hover); color: var(--text-primary); }
#chartLegend .legend-act-danger:hover { color: var(--loss); }
#chartLegend .legend-act.is-active { color: var(--text-primary); background: var(--ac-legend-act-hover); }

/* Tooltip — the dark chip TradingView floats above the icon. */
#chartLegend .legend-act { position: relative; }
#chartLegend .legend-act::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--ac-legend-tip-bg);
  color: var(--ac-legend-tip-fg);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease .3s;
}
#chartLegend .legend-act:hover::after { opacity: 1; }

/* "More" menu */
#chartLegend .legend-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  min-width: 168px;
  padding: 4px;
  border-radius: 8px;
  background: var(--ac-legend-pill-bg);
  border: 1px solid var(--ac-legend-pill-border);
  box-shadow: 0 8px 24px var(--ac-legend-pill-shadow);
}
#chartLegend .legend-menu button {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 7px 10px;
  border: 0; border-radius: 5px;
  background: transparent;
  color: var(--text-primary);
  font: inherit; font-size: 12px; text-align: left;
  cursor: pointer;
}
#chartLegend .legend-menu button:hover { background: var(--ac-legend-act-hover); }
#chartLegend .legend-menu button.is-danger:hover { color: var(--loss); }

/* Collapse chevron — TradingView keeps it as a small square under the rows. */
#chartLegend .legend-toggle {
  pointer-events: auto;
  width: 28px; height: 22px;
  justify-content: center;
  border-radius: 5px;
  background: var(--ac-legend-pill-bg);
  border: 1px solid var(--ac-legend-pill-border);
  cursor: pointer;
  color: var(--text-secondary);
}
#chartLegend .legend-toggle:hover { color: var(--text-primary); }

:root, :root.dark-mode {
  --ac-legend-row-hover: rgba(255,255,255,.05);
  --ac-legend-pill-bg: #1e222d;
  --ac-legend-pill-border: rgba(255,255,255,.10);
  --ac-legend-pill-shadow: rgba(0,0,0,.45);
  --ac-legend-act-hover: rgba(255,255,255,.09);
  --ac-legend-tip-bg: #2a2e39;
  --ac-legend-tip-fg: #d1d4dc;
}
:root.light-mode {
  --ac-legend-row-hover: rgba(0,0,0,.04);
  --ac-legend-pill-bg: #ffffff;
  --ac-legend-pill-border: rgba(0,0,0,.10);
  --ac-legend-pill-shadow: rgba(0,0,0,.14);
  --ac-legend-act-hover: rgba(0,0,0,.06);
  --ac-legend-tip-bg: #2a2e39;
  --ac-legend-tip-fg: #ffffff;
}`;

  function injectStyle() {
    if (document.getElementById('ac-legend-style')) return;
    const el = document.createElement('style');
    el.id = 'ac-legend-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ── Which indicators are live right now ───────────────────────
  // Sub-panes that are single-instance: their legend rows come from the
  // indicator modules, and only MACD passes a paneKey, so the rest are
  // matched by the label prefix their legendRows* function emits.
  const SUB_PANES = [
    { key: 'MACD',          prefix: 'MACD',          settings: 'openMACDSettings' },
    { key: 'RSI',           prefix: 'RSI',           settings: null },
    { key: 'Hilega-Milega', prefix: 'Hilega-Milega', settings: null },
  ];

  function activeSubPanes() {
    if (typeof enabledIndicators === 'undefined') return [];
    return SUB_PANES.filter(d => enabledIndicators.includes(d.key));
  }

  function activeInstances() {
    return (typeof indicatorInstances !== 'undefined') ? indicatorInstances : [];
  }

  function instanceLabel(inst) {
    const def = (typeof INDICATOR_DEFS !== 'undefined') ? INDICATOR_DEFS[inst.typeId] : null;
    const name = def ? def.label : inst.typeId;
    const i = inst.inputs || {};
    const params = i.length != null ? String(i.length)
      : i.tenkan != null ? `${i.tenkan} ${i.kijun} ${i.senkouB}`
      : (i.atrPeriod != null && i.factor != null) ? `${i.atrPeriod} ${i.factor}`
      : Object.values(i).filter(v => typeof v === 'number').join(' ');
    return { name, params };
  }

  // ── Row identification ────────────────────────────────────────
  function rowOwner(row) {
    const id = row.getAttribute('data-instance-id');
    if (id) return { kind: 'instance', id };
    const pane = row.getAttribute('data-pane-key');
    if (pane) return { kind: 'subpane', key: pane };
    // Fall back to the label prefix for the sub-panes whose legendRows*
    // helper passes no opts at all (RSI, Hilega-Milega).
    const nameEl = row.querySelector('.legend-ind-name');
    const label = nameEl ? nameEl.textContent.trim() : '';
    const hit = SUB_PANES.find(d => label === d.prefix || label.startsWith(d.prefix + ' '));
    if (hit) return { kind: 'subpane', key: hit.key };
    return null;
  }

  // ── Split "Supertrend 10 3" into name + muted params ──────────
  function splitName(row) {
    const el = row.querySelector('.legend-ind-name');
    if (!el || el.querySelector('.legend-ind-params')) return;
    const text = el.textContent.trim();
    const m = /^(\D[^\d]*?)\s+([\d.\s]+)$/.exec(text);
    if (!m) return;
    el.textContent = '';
    el.appendChild(document.createTextNode(m[1].trim() + ' '));
    const span = document.createElement('span');
    span.className = 'legend-ind-params';
    span.textContent = m[2].trim();
    el.appendChild(span);
  }

  // ── Action pill ───────────────────────────────────────────────
  function actionButton(cls, tip, paths, onClick) {
    const b = document.createElement('button');
    b.className = 'legend-act' + (cls ? ' ' + cls : '');
    b.type = 'button';
    b.setAttribute('data-tip', tip);
    b.setAttribute('aria-label', tip);
    b.innerHTML = svg(paths);
    b.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onClick(); });
    return b;
  }

  function call(fn, ...args) {
    if (typeof window[fn] === 'function') { window[fn](...args); return true; }
    return false;
  }

  function closeMenus() {
    document.querySelectorAll('#chartLegend .legend-menu').forEach(m => m.remove());
    document.querySelectorAll('#chartLegend .legend-indicator.is-menu-open')
      .forEach(r => r.classList.remove('is-menu-open'));
  }

  function openMenu(row, group, owner) {
    const alreadyOpen = !!row.querySelector('.legend-menu');
    closeMenus();
    if (alreadyOpen) return;

    const menu = document.createElement('div');
    menu.className = 'legend-menu';
    const item = (label, danger, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (danger) b.className = 'is-danger';
      b.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); fn(); });
      menu.appendChild(b);
    };

    if (owner.kind === 'instance') {
      const inst = typeof getIndicatorInstance === 'function' ? getIndicatorInstance(owner.id) : null;
      item('Settings…', false, () => call('openIndicatorSettings', owner.id));
      item(inst && inst.style.visible === false ? 'Show' : 'Hide', false,
        () => call('_toggleInstanceVisible', owner.id));
      item('Duplicate', false, () => duplicateInstance(owner.id));
      item('Remove', true, () => call('_removeInstanceFromBar', owner.id));
    } else {
      const def = SUB_PANES.find(d => d.key === owner.key);
      const collapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(owner.key);
      if (def && def.settings) item('Settings…', false, () => call(def.settings));
      item(collapsed ? 'Expand pane' : 'Collapse pane', false,
        () => call('_toggleSubPaneVisibility', owner.key));
      item('Remove', true, () => call('_removeSubPaneFromBar', owner.key));
    }

    row.appendChild(menu);
    row.classList.add('is-menu-open');
  }

  function duplicateInstance(id) {
    if (typeof getIndicatorInstance !== 'function' || typeof createIndicatorInstance !== 'function') return;
    const src = getIndicatorInstance(id);
    if (!src) return;
    const copy = createIndicatorInstance(src.typeId);
    if (!copy) return;
    updateIndicatorInstance(copy.id, {
      inputs: { ...src.inputs },
      style:  { ...src.style },
    });
    if (typeof renderIndicatorInstanceBar === 'function') renderIndicatorInstanceBar();
    if (typeof drawChart === 'function') drawChart();
  }

  function decorateRow(row) {
    if (row.querySelector('.legend-actions')) return;
    const owner = rowOwner(row);
    if (!owner) return;
    splitName(row);

    const group = document.createElement('div');
    group.className = 'legend-actions';

    if (owner.kind === 'instance') {
      const inst = typeof getIndicatorInstance === 'function' ? getIndicatorInstance(owner.id) : null;
      const visible = !inst || inst.style.visible !== false;
      group.appendChild(actionButton(visible ? '' : 'is-active', visible ? 'Hide' : 'Show',
        visible ? ICON.eyeOn : ICON.eyeOff,
        () => call('_toggleInstanceVisible', owner.id)));
      group.appendChild(actionButton('', 'Settings', ICON.gear,
        () => call('openIndicatorSettings', owner.id)));
      group.appendChild(actionButton('legend-act-danger', 'Remove', ICON.trash,
        () => call('_removeInstanceFromBar', owner.id)));
    } else {
      const def = SUB_PANES.find(d => d.key === owner.key);
      const collapsed = (typeof collapsedPanes !== 'undefined') && collapsedPanes.includes(owner.key);
      group.appendChild(actionButton(collapsed ? 'is-active' : '', collapsed ? 'Show' : 'Hide',
        collapsed ? ICON.eyeOff : ICON.eyeOn,
        () => call('_toggleSubPaneVisibility', owner.key)));
      if (def && def.settings) {
        group.appendChild(actionButton('', 'Settings', ICON.gear, () => call(def.settings)));
      }
      group.appendChild(actionButton('legend-act-danger', 'Remove', ICON.trash,
        () => call('_removeSubPaneFromBar', owner.key)));
    }

    group.appendChild(actionButton('', 'More', ICON.more, () => openMenu(row, group, owner)));
    row.appendChild(group);
  }

  // ── Rows the shared legend dropped ────────────────────────────
  // _legendIndRow() returns '' when every value at the hovered bar is null
  // (warm-up bars, a hidden instance). TradingView keeps the row and shows
  // "∅" instead — and since the pill band is gone, a dropped row would mean
  // an indicator you can see on the chart but cannot reach. So re-add them.
  function addMissingRows(el) {
    const have = new Set();
    el.querySelectorAll('.legend-indicator').forEach((row) => {
      const o = rowOwner(row);
      if (o) have.add(o.kind === 'instance' ? 'i:' + o.id : 'p:' + o.key);
    });

    const toggle = el.querySelector('.legend-toggle');
    const make = (attr, value, name, params, color) => {
      const row = document.createElement('div');
      row.className = 'legend-row legend-indicator';
      row.setAttribute(attr, value);
      row.innerHTML =
        `<span class="legend-ind-name">${name} <span class="legend-ind-params">${params}</span></span>` +
        `<span class="legend-ind-val" style="color:${color}">∅</span>`;
      if (toggle) el.insertBefore(row, toggle); else el.appendChild(row);
      return row;
    };

    activeInstances().forEach((inst) => {
      if (have.has('i:' + inst.id)) return;
      const { name, params } = instanceLabel(inst);
      const color = (inst.style && (inst.style.color || inst.style.colorUp)) || 'currentColor';
      decorateRow(make('data-instance-id', inst.id, name, params, color));
    });

    activeSubPanes().forEach((def) => {
      if (have.has('p:' + def.key)) return;
      decorateRow(make('data-pane-key', def.key, def.prefix, '', 'currentColor'));
    });
  }

  // ── Wire into every legend render ─────────────────────────────
  function decorate() {
    const el = document.getElementById('chartLegend');
    if (!el) return;
    el.querySelectorAll('.legend-indicator').forEach(decorateRow);
    addMissingRows(el);
  }

  function install() {
    injectStyle();

    // renderChartLegend() rewrites innerHTML wholesale, so the decoration has
    // to run again after every call. It is a top-level function declaration in
    // candlestick-legend.js, so assigning through window replaces the same
    // binding the bare `renderChartLegend()` calls resolve to.
    const original = window.renderChartLegend;
    if (typeof original === 'function' && !window.__acLegendWrapped) {
      window.renderChartLegend = function acRenderChartLegend() {
        // An open "More" menu is a transient popup that lives INSIDE
        // #chartLegend, and the shared renderer rewrites that element's
        // innerHTML wholesale — on every crosshair move, among other things.
        // Moving the pointer onto the menu would therefore destroy it before
        // it could be clicked, so hold the re-render until it closes.
        if (document.querySelector('#chartLegend .legend-menu')) return undefined;
        const out = original.apply(this, arguments);
        try { decorate(); } catch (e) { console.warn('[ACLegend] decorate failed', e); }
        return out;
      };
      window.__acLegendWrapped = true;
    }

    // The shared legend ships collapsed behind a "⌄ N" pill. TradingView shows
    // the rows, and they are now the only place an indicator's controls live —
    // so default to expanded, without overriding a choice the user has made.
    //
    // It has to go through toggleLegendExpanded(): `_legendExpanded` is a
    // top-level `let` in candlestick-legend.js, which lives in the global
    // LEXICAL environment and is therefore not a property of `window` —
    // assigning `window._legendExpanded` silently creates an unrelated
    // variable and the legend stays collapsed, with every row falling back to
    // the "∅" placeholder this file synthesises.
    try {
      const firstVisit = localStorage.getItem('legendExpanded') === null;
      const collapsed = (typeof _legendExpanded !== 'undefined') && _legendExpanded === false;
      if (firstVisit && collapsed && typeof toggleLegendExpanded === 'function') {
        toggleLegendExpanded();
      }
    } catch (e) { /* storage unavailable — legend just starts collapsed */ }

    // Pointer movement over the legend must not reach the chart container's
    // mousemove handler, which calls updateLegendHover() -> renderChartLegend().
    // Without this the legend re-renders on every pixel of travel across its
    // own rows, so the hover pill is rebuilt under the cursor as you reach for
    // a button. Freezing the readout while the pointer is on the legend is
    // also what TradingView does.
    const legendEl = document.getElementById('chartLegend');
    if (legendEl) {
      ['mousemove', 'mouseover'].forEach((type) => {
        legendEl.addEventListener(type, e => e.stopPropagation());
      });
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#chartLegend .legend-actions, #chartLegend .legend-menu')) closeMenus();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

    decorate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

  window.ACLegend = { decorate, closeMenus, install };

})();
