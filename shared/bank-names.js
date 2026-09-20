// Ticker -> display-friendly bank name, for headers/cards that show a bank's
// actual name rather than just its DSE code. Scoped to the 36 tickers tracked
// under bank_financials/ and bank_details_grid/.
//
// MERGING_BANKS: Bangladesh Bank is resolving these 5 crisis-hit Shariah
// banks into a new state-owned entity, Sammilito Islami Bank PLC (began
// independent operations 18-Aug-2026) — see
// ~/.claude/projects/-Users-sukarnapaul-Downloads-DSE-Analysis/memory/project_sammilito_islami_bank_merger.md.
// The name shown is still each bank's own pre-merger name, since the
// financial history on file belongs to that entity, not the new merged one —
// callers should pair it with a distinct "merging" badge rather than a plain
// "DSE Listed" one.
(function (global) {
  const BANK_NAMES = {
    ABBANK:     'AB Bank',
    ALARABANK:  'Al-Arafah Islami Bank',
    BANKASIA:   'Bank Asia',
    BRACBANK:   'BRAC Bank',
    CITYBANK:   'The City Bank',
    DHAKABANK:  'Dhaka Bank',
    DUTCHBANGL: 'Dutch-Bangla Bank',
    EBL:        'Eastern Bank',
    EXIMBANK:   'EXIM Bank',
    FIRSTSBANK: 'First Security Islami Bank',
    GIB:        'Global Islami Bank',
    ICBIBANK:   'ICB Islamic Bank',
    IFIC:       'IFIC Bank',
    ISLAMIBANK: 'Islami Bank Bangladesh',
    JAMUNABANK: 'Jamuna Bank',
    MERCANBANK: 'Mercantile Bank',
    MIDLANDBNK: 'Midland Bank',
    MTB:        'Mutual Trust Bank',
    NBL:        'National Bank',
    NCCBANK:    'NCC Bank',
    NRBBANK:    'NRB Bank',
    NRBCBANK:   'NRBC Bank',
    ONEBANKPLC: 'ONE Bank',
    PREMIERBAN: 'Premier Bank',
    PRIMEBANK:  'Prime Bank',
    PUBALIBANK: 'Pubali Bank',
    RUPALIBANK: 'Rupali Bank',
    SBACBANK:   'SBAC Bank',
    SHAHJABANK: 'Shahjalal Islami Bank',
    SIBL:       'Social Islami Bank',
    SOUTHEASTB: 'Southeast Bank',
    STANDBANKL: 'Standard Islami Bank',
    TRUSTBANK:  'Trust Bank',
    UCB:        'United Commercial Bank',
    UNIONBANK:  'Union Bank',
    UTTARABANK: 'Uttara Bank',
  };

  const MERGING_BANKS = new Set(['EXIMBANK', 'FIRSTSBANK', 'GIB', 'SIBL', 'UNIONBANK']);

  global.DSEBankNames = {
    get(code) { return BANK_NAMES[String(code || '').toUpperCase()] || null; },
    isMerging(code) { return MERGING_BANKS.has(String(code || '').toUpperCase()); },
    all: BANK_NAMES,
  };
})(window);
