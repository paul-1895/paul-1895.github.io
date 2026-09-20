// Ticker -> brand accent color, extracted from each bank's own logo file
// (shared/bank-logos/*), for pages that want to reflect a bank's real
// visual identity instead of the site's default blue accent.
//
// Extraction is automatic (dominant saturated color in the logo image,
// rendered to a canvas and bucketed by hue), not hand-picked — occasional
// picks may not match a designer's eye exactly (e.g. a logo where a small
// vivid accent shape outweighs a larger but less-saturated wordmark).
// Two safety adjustments are applied on top of the raw extraction: colors
// lighter than roughly 60% lightness are darkened (several UI spots put
// white text/icons directly on this color) and colors under ~35%
// saturation are boosted slightly (raw picks that faint read as muddy
// gray rather than a color). Deliberately NOT nudged away from the site's
// --loss/--gain red/green hues — an earlier version did that and collapsed
// several distinctly red- or green-branded banks into one identical shade,
// which defeated the point. Every one of the 34 tickers with a logo
// (see bank-logos.js) produced a usable color; none needed to fall back.
(function (global) {
  const BANK_COLORS = {
    ABBANK: '#fa0000',
    ALARABANK: '#6e9646',
    BANKASIA: '#1e64b4',
    BRACBANK: '#006eb4',
    CITYBANK: '#f01e28',
    DHAKABANK: '#0a50a0',
    DUTCHBANGL: '#009646',
    EBL: '#ffd20a',
    EXIMBANK: '#00a03c',
    FIRSTSBANK: '#00783c',
    GIB: '#fff000',
    ICBIBANK: '#323296',
    IFIC: '#008c3c',
    ISLAMIBANK: '#14461e',
    JAMUNABANK: '#3c328c',
    MERCANBANK: '#50aa32',
    MIDLANDBNK: '#f01e28',
    MTB: '#d21e5a',
    NBL: '#007846',
    NCCBANK: '#325aaa',
    NRBBANK: '#e60028',
    NRBCBANK: '#0a7846',
    ONEBANKPLC: '#e60a14',
    PREMIERBAN: '#008246',
    PRIMEBANK: '#1e96d2',
    PUBALIBANK: '#f01e28',
    RUPALIBANK: '#b43c32',
    SBACBANK: '#82288c',
    SHAHJABANK: '#0a5aa0',
    SOUTHEASTB: '#0082c8',
    STANDBANKL: '#003214',
    TRUSTBANK: '#006e46',
    UCB: '#e61e28',
    UNIONBANK: '#005a50',
  };

  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  global.DSEBankColors = {
    get(code) { return BANK_COLORS[String(code || '').toUpperCase()] || null; },
    // Translucent version of the same color, for tinted backgrounds
    // (mirrors the site's --accent-dim convention, ~0.10-0.14 alpha).
    getDim(code, alpha) {
      const rgb = hexToRgb(this.get(code));
      if (!rgb) return null;
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha == null ? 0.12 : alpha})`;
    },
    all: BANK_COLORS,
  };
})(window);
