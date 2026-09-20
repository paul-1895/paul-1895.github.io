/* ════════════════════════════════════════════════════════════
   ac-rail.js
   Puts NAMES on the right rail's icons.

   The rail launches every analysis surface on the page — panels
   (All Shares, Watchlist, Details, Bank, News, Funds, Volatility)
   and tools (Analysis, Seasonals, Valuation, S&R, Backtest,
   Portfolio) — but shipped as 14 unlabelled 36px glyphs whose only
   identification was a `title` tooltip, so you had to hover each
   one in turn to find anything. There is a lot of unused vertical
   room in that column (12 visible buttons in a ~950px rail), so
   the names go under the icons instead.

   `title` is kept on every button: the caption is a short name,
   the tooltip still carries the long explanation ("MACD + 50 EMA —
   buy a bullish MACD cross that closes above the 50-EMA…").

   Scoped strictly to #tvRightRail. The LEFT rail shares the
   .tv-rail-btn class but is a drawing-tool palette whose names
   already live in its flyouts, and 14 captions there would eat the
   chart — it stays icon-only.

   Depends on : nothing (pure DOM + CSS)
   Owns       : window.ACRail
   ════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  const RAIL_ID = 'tvRightRail';

  // Short captions, by button id. These are deliberately terser than the
  // tooltips — a caption has ~76px to live in, and the tooltip is still there
  // for the full wording.
  const LABELS = {
    railAllSharesBtn:    'All Shares',
    railWatchlistBtn:    'Watchlist',
    railDetailsBtn:      'Details',
    railBankDetailsBtn:  'Bank',
    railNewsBtn:         'News',
    railMfHoldersBtn:    'Funds',
    railVolatilityBtn:   'Volatility',
    analysisToggleBtn:   'Analysis',
    seasonalsToggleBtn:  'Seasonals',
    valuationToggleBtn:  'Valuation',
    srToggleBtn:         'S & R',
    acSRLevelsBtn:       'Plot S/R',
    srLevelsToggleBtn:   'Plot S/R',
    macdBtToggleBtn:     'Backtest',
    mfPortfolioBtn:      'Portfolio',
  };

  // Anything added to the rail later that isn't in the map still gets a
  // caption, derived from whatever identification it does carry.
  function deriveLabel(btn) {
    const aria = (btn.getAttribute('aria-label') || '').trim();
    const title = (btn.getAttribute('title') || '').trim();
    let text = aria || title;
    if (!text) return '';
    text = text.replace(/^(toggle|open|show|view)\s+/i, '');
    // Drop a trailing explanation: "Intrinsic Value (DCF / DDM…)",
    // "MACD + 50 EMA — buy a bullish…"
    text = text.split(/\s+[—–]\s+/)[0].split(/\s*\(/)[0].trim();
    if (text.length > 14) text = text.slice(0, 13).trim() + '…';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  const CSS = `
/* The rail widens to fit a caption under each glyph. 12 visible buttons at
   ~52px each still sit well inside the ~950px column, so nothing scrolls. */
#${RAIL_ID} {
  flex: 0 0 92px;
  width: 92px;
  gap: 2px;
  padding: 8px 6px;
  align-items: stretch;
}

#${RAIL_ID} .tv-rail-btn {
  width: 100%;
  height: auto;
  min-height: 46px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 6px 3px;
  border-radius: 7px;
  line-height: 1;
}

#${RAIL_ID} .tv-rail-btn svg {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
}

#${RAIL_ID} .tv-rail-label {
  display: block;
  max-width: 100%;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: .1px;
  line-height: 1.15;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Inherit the button's colour so the active/hover states carry the caption
     with them instead of leaving it stranded in the resting colour. */
  color: inherit;
  opacity: .85;
}
#${RAIL_ID} .tv-rail-btn:hover .tv-rail-label,
#${RAIL_ID} .tv-rail-btn.active .tv-rail-label { opacity: 1; }

/* tv-layout.css paints an active rail button as a SOLID accent block
   (background:var(--accent)). At 36px that was a small dot; now that each
   button is a 92px-wide card with a caption, six active panel toggles became
   six saturated slabs dominating the column. Tint the surface and accent the
   content instead — the state still reads at a glance without shouting. */
#${RAIL_ID} .tv-rail-btn.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 32%, transparent);
}
#${RAIL_ID} .tv-rail-btn.active:hover {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
/* color-mix is widely supported, but fall back to a flat tint where it is not
   so the active state never silently disappears. */
@supports not (background: color-mix(in srgb, red 10%, transparent)) {
  #${RAIL_ID} .tv-rail-btn.active { background: var(--bg-hover); color: var(--accent); }
}

#${RAIL_ID} .tv-rail-sep {
  width: 100%;
  margin: 6px 0;
}

/* A button the page hides (Bank Details on a non-bank, Portfolio on a
   non-fund) must not leave its caption behind. */
#${RAIL_ID} .tv-rail-btn[style*="display: none"] .tv-rail-label,
#${RAIL_ID} .tv-rail-btn.tv-na .tv-rail-label { display: none; }

/* Below the sidebar breakpoint the rail is hidden entirely by tv-layout.css;
   nothing to do here. Between 1200px and 1400px, claw the width back. */
@media (max-width: 1400px) {
  #${RAIL_ID} { flex-basis: 78px; width: 78px; }
  #${RAIL_ID} .tv-rail-label { font-size: 9px; }
}`;

  function injectStyle() {
    if (document.getElementById('ac-rail-style')) return;
    const el = document.createElement('style');
    el.id = 'ac-rail-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function labelFor(btn) {
    if (btn.id && LABELS[btn.id]) return LABELS[btn.id];
    return deriveLabel(btn);
  }

  function decorate(rail) {
    rail.querySelectorAll('.tv-rail-btn').forEach((btn) => {
      const existing = btn.querySelector('.tv-rail-label');
      const text = labelFor(btn);
      if (!text) return;
      if (existing) {
        if (existing.textContent !== text) existing.textContent = text;
        return;
      }
      const span = document.createElement('span');
      span.className = 'tv-rail-label';
      span.textContent = text;
      // aria-hidden: the button already has an aria-label, and letting a
      // screen reader read both would announce the name twice.
      span.setAttribute('aria-hidden', 'true');
      btn.appendChild(span);
    });
  }

  function install() {
    const rail = document.getElementById(RAIL_ID);
    if (!rail) return;
    injectStyle();
    decorate(rail);

    // ac-panels.js injects its "Plot S/R" toggle at runtime, tv-sidebar.js can
    // show/hide others, and nav-menu.js mounts late — so keep watching rather
    // than labelling once at boot.
    const mo = new MutationObserver(() => decorate(rail));
    mo.observe(rail, { childList: true, subtree: true });

    window.ACRail = {
      refresh: () => decorate(rail),
      labelFor,
      LABELS,
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();

})();
