// Ticker -> official logo path, for headers/cards that want a bank's real
// brand mark instead of a generic placeholder tile. Fetched from each
// bank's own corporate website; not every tracked ticker has an entry —
// callers must fall back gracefully (e.g. a plain letter tile) when
// DSEBankLogos.get(code) returns null.
//
// Two tickers are deliberately absent, not just unfetched:
//   - SIBL:       the only logo asset on its live site is a composite that
//                 embeds Sammilito Islami Bank's mark alongside SIBL's own
//                 (see project_sammilito_islami_bank_merger.md) — using it
//                 would misrepresent SIBL's own branding.
//   - UTTARABANK: its entire site is gated behind a Cloudflare Turnstile
//                 challenge; no asset above favicon size is reachable.
(function (global) {
  const BANK_LOGOS = {
    ABBANK: '/shared/bank-logos/ABBANK.png',
    ALARABANK: '/shared/bank-logos/ALARABANK.png',
    BANKASIA: '/shared/bank-logos/BANKASIA.png',
    BRACBANK: '/shared/bank-logos/BRACBANK.svg',
    CITYBANK: '/shared/bank-logos/CITYBANK.png',
    DHAKABANK: '/shared/bank-logos/DHAKABANK.png',
    DUTCHBANGL: '/shared/bank-logos/DUTCHBANGL.png',
    EBL: '/shared/bank-logos/EBL.png',
    EXIMBANK: '/shared/bank-logos/EXIMBANK.gif',
    FIRSTSBANK: '/shared/bank-logos/FIRSTSBANK.jpg',
    GIB: '/shared/bank-logos/GIB.jpg',
    ICBIBANK: '/shared/bank-logos/ICBIBANK.png',
    IFIC: '/shared/bank-logos/IFIC.png',
    ISLAMIBANK: '/shared/bank-logos/ISLAMIBANK.png',
    JAMUNABANK: '/shared/bank-logos/JAMUNABANK.svg',
    MERCANBANK: '/shared/bank-logos/MERCANBANK.jpg',
    MIDLANDBNK: '/shared/bank-logos/MIDLANDBNK.png',
    MTB: '/shared/bank-logos/MTB.png',
    NBL: '/shared/bank-logos/NBL.png',
    NCCBANK: '/shared/bank-logos/NCCBANK.png',
    NRBBANK: '/shared/bank-logos/NRBBANK.png',
    NRBCBANK: '/shared/bank-logos/NRBCBANK.png',
    ONEBANKPLC: '/shared/bank-logos/ONEBANKPLC.png',
    PREMIERBAN: '/shared/bank-logos/PREMIERBAN.png',
    PRIMEBANK: '/shared/bank-logos/PRIMEBANK.png',
    PUBALIBANK: '/shared/bank-logos/PUBALIBANK.jpg',
    RUPALIBANK: '/shared/bank-logos/RUPALIBANK.png',
    SBACBANK: '/shared/bank-logos/SBACBANK.png',
    SHAHJABANK: '/shared/bank-logos/SHAHJABANK.jpg',
    SOUTHEASTB: '/shared/bank-logos/SOUTHEASTB.jpg',
    STANDBANKL: '/shared/bank-logos/STANDBANKL.svg',
    TRUSTBANK: '/shared/bank-logos/TRUSTBANK.svg',
    UCB: '/shared/bank-logos/UCB.png',
    UNIONBANK: '/shared/bank-logos/UNIONBANK.jpg',
  };

  global.DSEBankLogos = {
    get(code) { return BANK_LOGOS[String(code || '').toUpperCase()] || null; },
    all: BANK_LOGOS,
    // Several pages keep their own { code: logoUrl } map sourced from
    // data/stock-logos.json — generic colored-initial avatars covering
    // every ticker, not just banks. Call this right after loading that map
    // so any bank we have a real logo for uses it instead of the
    // placeholder; every other ticker's entry is left untouched.
    applyOverrides(logoMap) {
      if (!logoMap) return logoMap;
      Object.keys(BANK_LOGOS).forEach(code => { logoMap[code] = BANK_LOGOS[code]; });
      return logoMap;
    },
  };
})(window);
