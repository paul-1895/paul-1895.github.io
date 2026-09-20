// Ticker -> official mobile banking app stats (Play Store), for a small
// badge on the bank-details header. Each entry was individually verified —
// developer name checked against the bank's own legal name, decoy apps
// from unrelated same-named banks/companies excluded — not just matched by
// app title. `rating: null` means the app genuinely has no public star
// rating on its listing (too few reviews for Google to show one), not a
// failed lookup.
//
// Two tickers are absent, not just unfetched:
//   - EXIMBANK:  its Play Store developer account has already been renamed
//                "Sammilito Islami Bank PLC ITD" — the old EXIM app is
//                superseded, not EXIM's own anymore.
//   - ICBIBANK:  its own website links to a package that's been delisted
//                from the Play Store entirely; no live replacement found.
(function (global) {
  const APP_STATS = {
    ABBANK:     { appName: 'AB Direct Internet Banking', rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.brainstation23.ib.abbl' },
    ALARABANK:  { appName: 'aib i-Banking',               rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.bd.aibl.ibapps' },
    BANKASIA:   { appName: 'Bank Asia Zen',                rating: null, downloads: '1M+',   url: 'https://play.google.com/store/apps/details?id=eraapps.bankasia.bdinternetbanking.apps' },
    BRACBANK:   { appName: 'BRAC Bank Astha',              rating: 4.2,  downloads: '1M+',   url: 'https://play.google.com/store/apps/details?id=com.bracbank.astha' },
    CITYBANK:   { appName: 'CityConnect',                  rating: null, downloads: '1K+',   url: 'https://play.google.com/store/apps/details?id=com.citybank.citysuperapp' },
    DHAKABANK:  { appName: 'Dhaka Bank Go Plus',            rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.dbl.goplus' },
    DUTCHBANGL: { appName: 'NexusPay',                     rating: 3.7,  downloads: '10M+',  url: 'https://play.google.com/store/apps/details?id=com.dbbl.nexus.pay' },
    EBL:        { appName: 'EBL SKYBANKING',                rating: 2.6,  downloads: '500K+', url: 'https://play.google.com/store/apps/details?id=com.ebl.skybanking' },
    FIRSTSBANK: { appName: 'FSIB Cloud Banking',            rating: null, downloads: '500K+', url: 'https://play.google.com/store/apps/details?id=com.fsiblbd.fsiblcloud' },
    GIB:        { appName: 'GiB GoFast',                   rating: null, downloads: '50K+',  url: 'https://play.google.com/store/apps/details?id=com.mislbd.globalislamibankbd.gofast' },
    IFIC:       { appName: 'IFIC Aamar Bank',              rating: null, downloads: '500K+', url: 'https://play.google.com/store/apps/details?id=com.ific.mobile' },
    ISLAMIBANK: { appName: 'CellFin',                       rating: 3.9,  downloads: '5M+',   url: 'https://play.google.com/store/apps/details?id=com.ibbl.cellfin' },
    JAMUNABANK: { appName: 'Shadhin',                      rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=jbl.app.shadhin' },
    MERCANBANK: { appName: 'MBL Rainbow',                  rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.konasl.mercantile' },
    MIDLANDBNK: { appName: 'midland online',               rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=net.midlandbankbd.mdbmobileapps' },
    MTB:        { appName: 'MTB Neo',                      rating: 3.7,  downloads: '500K+', url: 'https://play.google.com/store/apps/details?id=com.mtb.mobilebanking' },
    NBL:        { appName: 'NBL Apps',                     rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.cibl.nbl' },
    NCCBANK:    { appName: 'NCC Always',                   rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=bd.com.nccbank.nccalways' },
    NRBBANK:    { appName: 'NRB Click',                    rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.sslwireless.nrbmobapp' },
    NRBCBANK:   { appName: 'NRBC PLANET',                  rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.cibl.plannet' },
    ONEBANKPLC: { appName: 'ONE Bank App',                 rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.cibl.obl' },
    PREMIERBAN: { appName: 'pmoney smart banking',         rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.cibl.pbl' },
    PRIMEBANK:  { appName: 'MyPrime',                      rating: 4.7,  downloads: '500K+', url: 'https://play.google.com/store/apps/details?id=bd.com.primebank.pib.altitudemobile' },
    PUBALIBANK: { appName: 'PI Banking',                   rating: 4.7,  downloads: '1M+',   url: 'https://play.google.com/store/apps/details?id=com.pubali.internet.banking' },
    RUPALIBANK: { appName: 'Rupali eBank',                 rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.rbplc.rupaliebank' },
    SBACBANK:   { appName: 'BanglaPay',                    rating: null, downloads: '50K+',  url: 'https://play.google.com/store/apps/details?id=com.sbac' },
    SHAHJABANK: { appName: 'ShahjalalTouchPay',            rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.cibl.app.shahjalalbankapp' },
    SIBL:       { appName: 'SIBL NOW',                     rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.mislbd.sibl.now' },
    SOUTHEASTB: { appName: 'Southeast Bank Mobile App',    rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.seblit.ssa' },
    STANDBANKL: { appName: 'SBL DigiBanking',              rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.cibl.sblmobilebanking' },
    TRUSTBANK:  { appName: 'Trust Money',                  rating: 3.6,  downloads: '1M+',   url: 'https://play.google.com/store/apps/details?id=com.cibl.tbl' },
    UCB:        { appName: 'UCB One',                      rating: 3.9,  downloads: '500K+', url: 'https://play.google.com/store/apps/details?id=bd.com.ucb.unet' },
    UNIONBANK:  { appName: 'UniON',                        rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.mislbd.ublbd.union' },
    UTTARABANK: { appName: 'Uttara eWallet',               rating: null, downloads: '100K+', url: 'https://play.google.com/store/apps/details?id=com.uttarabank.ublmobile' },
  };

  global.DSEBankAppStats = {
    get(code) { return APP_STATS[String(code || '').toUpperCase()] || null; },
    all: APP_STATS,
  };
})(window);
