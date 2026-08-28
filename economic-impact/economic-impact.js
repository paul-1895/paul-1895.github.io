'use strict';

/* ════════════════════════════════════════════════════════════
   economic-impact.js
   Research notes on real-world economic/geopolitical events and
   their read-through to DSE-listed sectors, organized as topics.

   Each topic's narrative facts are dated news facts — see that
   topic's own Sources list for each claim. They are NOT live
   data and are not refreshed.

   The per-company LTP/change figures ARE live — fetched from
   /api/stocks on load — and every code listed in every topic is
   cross-checked against this app's own data/stock-sectors.json
   so nothing named here is a fabricated or delisted ticker.
   ════════════════════════════════════════════════════════════ */

const API = '';

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ────────────────────────────────────────────────────────────
   TOPIC 1 — Bangladesh gas crisis (July 2026)
──────────────────────────────────────────────────────────── */
const GAS_CRISIS_TOPIC = {
  id: 'gas-crisis',
  navLabel: 'গ্যাস সংকট',
  navSub: 'জুলাই ২০২৬',

  sectorGroups: [
    {
      title: 'টেক্সটাইল', sub: 'Textile — ডিএসই-র বৃহত্তম খাত (৫৬টি কোম্পানি), সংকটে সবচেয়ে বেশি আলোচিত ও লেনদেনে শীর্ষে',
      codes: ['SAIHAMTEX', 'SAIHAMCOT', 'FEKDIL', 'ARGONDENIM', 'MLDYEING', 'MALEKSPIN'],
      note: 'উপরের ৬টি এই মুহূর্তে খাতের মধ্যে সর্বোচ্চ লেনদেন হওয়া কোম্পানি — সম্পূর্ণ ৫৬টির তালিকা স্ক্রিনার পাতায় দেখুন।',
    },
    {
      title: 'সিরামিক', sub: 'Ceramics — সরাসরি সংকটে সবচেয়ে বেশি ক্ষতিগ্রস্ত খাত হিসেবে চিহ্নিত (সম্পূর্ণ ৫টি কোম্পানি)',
      codes: ['FUWANGCER', 'SPCERAMICS', 'MONNOCERA', 'RAKCERAMIC', 'STANCERAM'],
    },
    {
      title: 'সিমেন্ট', sub: 'Cement — ভাটা (kiln) চালাতে অবিচ্ছিন্ন গ্যাস প্রয়োজন (সম্পূর্ণ ৭টি কোম্পানি)',
      codes: ['LHB', 'PREMIERCEM', 'CONFIDCEM', 'HEIDELBCEM', 'ARAMITCEM', 'CROWNCEMNT', 'MEGHNACEM'],
    },
    {
      title: 'কাগজ ও মুদ্রণ', sub: 'Paper & Printing — শুকানোর প্রক্রিয়ায় গ্যাসনির্ভর (সম্পূর্ণ ৬টি কোম্পানি)',
      codes: ['MONOSPOOL', 'SONALIPAPR', 'HAKKANIPUL', 'MAGURAPLEX', 'KPPL', 'BPML'],
    },
    {
      title: 'স্টিল / রি-রোলিং', sub: 'Steel — গ্যাস বা বৈদ্যুতিক ফার্নেসনির্ভর উৎপাদন প্রক্রিয়া',
      codes: ['BSRMSTEEL', 'BSRMLTD', 'RSRMSTEEL', 'GPHISPAT', 'SSSTEEL'],
    },
    {
      title: 'চিনি', sub: 'Sugar — সংবাদে উল্লেখিত মেঘনা সুগার রিফাইনারির (অতালিকাভুক্ত) সরাসরি তালিকাভুক্ত প্রতিদ্বন্দ্বী',
      codes: ['SHYAMPSUG'],
    },
    {
      title: 'গ্যাস সরবরাহ ও বিদ্যুৎ', sub: 'Fuel & Power — টিটাস গ্যাস নিজেই এই সংকটের কেন্দ্রে; গ্যাসভিত্তিক বিদ্যুৎকেন্দ্রগুলোর জ্বালানি প্রাপ্যতা ঝুঁকিতে (অনেকগুলোর দ্বৈত-জ্বালানি ব্যবস্থা থাকতে পারে)',
      codes: ['TITASGAS', 'SUMITPOWER', 'BARKAPOWER', 'KPCL', 'DOREENPWR', 'GBBPOWER', 'SAIFPOWER', 'EPGL'],
    },
  ],

  sources: [
    { title: 'Bangladesh gas crisis deepens as LNG terminal outage disrupts industries — IANS', url: 'https://ianslive.in/bangladesh-gas-crisis-deepens-as-lng-terminal-outage-disrupts-industries--20260730183914' },
    { title: 'Industries reel under gas crisis — The Daily Star', url: 'https://www.thedailystar.net/news/bangladesh/news/industries-reel-under-gas-crisis-4232426' },
    { title: 'Gas crisis deepens as LNG disruption hits homes, industries — Dhaka Tribune', url: 'https://www.dhakatribune.com/bangladesh/power-energy/416197/gas-crisis-deepens-as-supply-shortage-disrupts' },
    { title: 'Gas crunch cripples industries, threatens export orders — The Business Standard', url: 'https://tbsnews.net/bangladesh/energy/gas-crunch-cripples-industries-threatens-export-orders-1501656' },
    { title: 'Dhaka stocks slip for third day as energy crisis, global risks weigh — The Business Standard', url: 'https://www.tbsnews.net/economy/stocks/dhaka-stocks-slip-third-day-energy-crisis-global-risks-weigh-1498576' },
    { title: "Bangladesh's Gas Shortage Stalls $750 Million in Industrial Investments — Bloomberg", url: 'https://www.bloomberg.com/news/articles/2026-06-12/gas-supply-woes-are-delaying-bangladesh-s-industrial-dreams' },
    { title: 'Severe Gas Crisis Triggers Sharp Drop in Production, Threatening Industry, Exports and Employment — BDDiGEST', url: 'https://en.bddigest.com/severe-gas-crisis-triggers-sharp-drop-in-production-threatening-industry-exports-and-employment/' },
    { title: 'Bangladesh shuts fertiliser factories as Middle East crisis strains gas supply — Profit by Pakistan Today', url: 'https://profit.pakistantoday.com.pk/2026/03/06/bangladesh-shuts-fertiliser-factories-as-middle-east-crisis-strains-gas-supply/' },
  ],

  disclaimerHtml: '⚠️ এটি সংবাদভিত্তিক একটি খাতগত পর্যবেক্ষণ, বিনিয়োগ পরামর্শ নয়। প্রতিটি কোম্পানির প্রকৃত প্রভাব নির্ভর করে তার নিজস্ব জ্বালানি মিশ্রণ (গ্যাস/ডিজেল/গ্রিড), বিকল্প জেনারেটর সক্ষমতা ও সরকারি গ্যাস-বরাদ্দ অগ্রাধিকারের ওপর — যা এই পাতায় পৃথকভাবে যাচাই করা হয়নি। যেকোনো সিদ্ধান্তের আগে কোম্পানির নিজস্ব প্রান্তিক প্রতিবেদন ও দাপ্তরিক ঘোষণা দেখুন।',

  buildSectionsHtml() {
    return `
      <section class="ei-card">
        <h2>সংকটের সূত্রপাত</h2>
        <p>২১ জুলাই, ২০২৬ তারিখে কারিগরি ত্রুটি ও অগ্নিকাণ্ডের কারণে দেশের দুটি ভাসমান এলএনজি টার্মিনালের (FSRU) একটি বন্ধ হয়ে যায়, যার ফলে দৈনিক প্রায় ৪৫০ মিলিয়ন ঘনফুট গ্যাস সরবরাহ ব্যাহত হয় — যা জাতীয় সরবরাহের প্রায় ১৭%। একই সময়ে কাতারের এলএনজি উৎপাদন সাময়িক বন্ধ এবং ইরান-সংশ্লিষ্ট উত্তেজনার কারণে হরমুজ প্রণালী দিয়ে জ্বালানি জাহাজ চলাচলে বিঘ্ন এই সংকটকে আরও ঘনীভূত করেছে। ফলে পেট্রোবাংলা বর্তমানে জাতীয় চাহিদার মাত্র প্রায় ৫৬% সরবরাহ করতে পারছে।</p>
      </section>

      <section class="ei-card">
        <h2>শিল্পখাতে প্রভাব</h2>
        <ul class="ei-list">
          <li><b>সামগ্রিক চিত্র:</b> প্রায় ৪০০টি গ্যাসনির্ভর কারখানা পূর্ণ সক্ষমতার নিচে চলছে; উৎপাদন গড়ে ৩০–৫০% কমেছে।</li>
          <li><b>সিরামিক:</b> বাংলাদেশ সিরামিক ম্যানুফ্যাকচারার্স অ্যান্ড এক্সপোর্টার্স অ্যাসোসিয়েশনের ৭০টি সদস্য কারখানার মধ্যে ২৫টি ইতিমধ্যে উৎপাদন বন্ধ করে দিয়েছে; গ্যাসচাপ কম থাকায় ভাটার (kiln) মানসম্মত উৎপাদন প্রায় ৯০% থেকে নেমে ১০%-এ ঠেকেছে।</li>
          <li><b>টেক্সটাইল:</b> গ্যাসচাপ প্রয়োজনীয় ৮ PSI থেকে নেমে ২–৩ PSI-তে ঠেকেছে; অনেক কারখানা উৎপাদন ৪০% পর্যন্ত কমিয়েছে এবং জেনারেটর চালাতে লিটারপ্রতি প্রায় ১০ টাকা বাড়তি দামে ডিজেল কিনতে হচ্ছে।</li>
          <li><b>সার কারখানা:</b> সরকারি নির্দেশে চট্টগ্রাম ইউরিয়া সার কারখানা (CUFL) ও কাফকো (KAFCO)-র উৎপাদন সাময়িক বন্ধ রাখা হয়েছে — উভয়ই ডিএসই-তে তালিকাভুক্ত নয়।</li>
          <li><b>চিনি ও কাগজ:</b> মেঘনা সুগার রিফাইনারি প্রায় ২৫% সক্ষমতায় এবং ক্রিয়েটিভ পেপার মিলস তিনটির মধ্যে মাত্র ১–২টি মেশিন চালিয়ে উৎপাদন চালিয়ে যাচ্ছে — দুটোই বেসরকারি, অতালিকাভুক্ত প্রতিষ্ঠান, তবে নিচে একই ধরনের ডিএসই-তালিকাভুক্ত প্রতিদ্বন্দ্বীদের উল্লেখ করা হয়েছে।</li>
        </ul>
      </section>

      <section class="ei-card">
        <h2>শেয়ারবাজারে প্রভাব</h2>
        <div class="ei-stat-row">
          <div class="ei-stat"><div class="ei-stat-val ei-down">−১৯ পয়েন্ট (−০.৩৪%)</div><div class="ei-stat-label">এক কার্যদিবসে DSEX-এর পতন, ৫,৭৮৪-এ নেমে আসে</div></div>
          <div class="ei-stat"><div class="ei-stat-val ei-down">−১১৪ পয়েন্ট</div><div class="ei-stat-label">টানা তিন কার্যদিবসের সম্মিলিত পতন</div></div>
          <div class="ei-stat"><div class="ei-stat-val">১৯.২%</div><div class="ei-stat-label">দৈনিক লেনদেনে টেক্সটাইল খাতের অংশ (শীর্ষে)</div></div>
          <div class="ei-stat"><div class="ei-stat-val ei-down">−২.২%</div><div class="ei-stat-label">সবচেয়ে বেশি দরপতন — মিউচুয়াল ফান্ড খাত</div></div>
        </div>
        <p class="ei-note">সাধারণ বিমা (১১%) ও ওষুধ খাত (১০.৪%) লেনদেনে এরপরের অবস্থানে ছিল। মিউচুয়াল ফান্ডের পর সিরামিক ও আর্থিক প্রতিষ্ঠান খাতেও উল্লেখযোগ্য দরপতন হয়েছে।</p>
      </section>`;
  },
};

/* ────────────────────────────────────────────────────────────
   TOPIC 2 — US–Iran war
   Content populated after live WebSearch/WebFetch research (see
   the accompanying research task); each fact below is checked
   against data/stock-sectors.json and its own cited source.
──────────────────────────────────────────────────────────── */
const US_IRAN_WAR_TOPIC = {
  id: 'us-iran-war',
  navLabel: 'যুক্তরাষ্ট্র-ইরান যুদ্ধ',
  navSub: '',

  sectorGroups: [
    {
      title: 'জ্বালানি আমদানি ও বিপণন', sub: 'Fuel & Power — অপরিশোধিত ও পরিশোধিত জ্বালানি আমদানি ব্যয়ের সরাসরি সংস্পর্শে (যাচাইকৃত: জ্বালানি তেলের মূল্যবৃদ্ধি ও ৯৫% জ্বালানি আমদাননির্ভরতা)',
      codes: ['JAMUNAOIL', 'PADMAOIL', 'MPETROLEUM', 'MJLBD', 'SUMITPOWER', 'KPCL'],
      note: 'রেমিট্যান্স, তৈরি পোশাক রপ্তানি ও শিপিং খাতের ওপর সম্ভাব্য প্রভাব সংবাদে উল্লেখ থাকলেও তা এখনো পৃথকভাবে উৎস-যাচাই করা হয়নি বলে এখানে তালিকাভুক্ত করা হয়নি — যাচাই শেষ হলে যুক্ত করা হবে।',
    },
  ],

  sources: [
    { title: '2026 Strait of Hormuz crisis — Wikipedia', url: 'https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis' },
    { title: 'Oil surges as US strikes Iran, reversing return to pre-war prices — Al Jazeera', url: 'https://www.aljazeera.com/news/2026/7/8/oil-prices-surge-as-us-strikes-iran-reversing-fall-to-pre-war-levels' },
    { title: "Iran war updates: Pezeshkian urges Iranians to 'stand firm' — Al Jazeera", url: 'https://www.aljazeera.com/news/liveblog/2026/7/29/iran-war-live-us-accuses-irgc-of-surprise-ballistic-missile-attacks' },
    { title: 'Shipping insurance surges again as attacks intensify over Strait of Hormuz — The National', url: 'https://www.thenationalnews.com/business/2026/07/17/war-risk-shipping-premium-surges-again-as-tensions-escalate-at-strait-of-hormuz/' },
    { title: 'Brent oil jumps back above $90 after Trump threatens to hit Iran hard — CNBC', url: 'https://www.cnbc.com/2026/07/29/oil-prices-today-brent-wti-iran-us-hormuz.html' },
    { title: 'A timeline of how the Iran war shook oil prices — and what comes next — CNBC', url: 'https://www.cnbc.com/2026/04/21/oil-price-iran-war-middle-east.html' },
    { title: 'Bangladesh Hikes Fuel Prices By 10-16% as Iran War In West Asia Drives Up Global Oil Costs — Outlook India', url: 'https://www.outlookindia.com/international/bangladesh-hikes-fuel-prices-by-10-16-as-iran-war-in-west-asia-drives-up-global-oil-costs' },
    { title: 'Stocks shed Tk29,500cr in 17 days as Iran war rattles investor confidence — The Business Standard', url: 'https://www.tbsnews.net/economy/stocks/stocks-shed-tk29500cr-17-days-iran-war-rattles-investor-confidence-1399256' },
    { title: 'Stocks volatile amid war fears; DSEX loses 342 points in a month — Daily Sun', url: 'https://www.daily-sun.com/business/868332' },
  ],

  disclaimerHtml: '⚠️ এটি সংবাদভিত্তিক একটি খাতগত পর্যবেক্ষণ, বিনিয়োগ পরামর্শ নয় — এবং এখনো আংশিকভাবে যাচাইকৃত। প্রতিটি কোম্পানির প্রকৃত প্রভাব নির্ভর করে তার নিজস্ব আমদানি/রপ্তানি কাঠামো, জ্বালানি মজুদ ও ঝুঁকি ব্যবস্থাপনার ওপর — যা এই পাতায় পৃথকভাবে যাচাই করা হয়নি। কিছু পরিসংখ্যান (★ চিহ্নিত) মূল প্রতিবেদনের পাতা সরাসরি লোড করা যায়নি বলে একাধিক স্বতন্ত্র উৎস থেকে ক্রস-চেক করা হয়েছে। যেকোনো সিদ্ধান্তের আগে কোম্পানির নিজস্ব প্রান্তিক প্রতিবেদন ও দাপ্তরিক ঘোষণা দেখুন।',

  buildSectionsHtml() {
    return `
      <section class="ei-card">
        <h2>সংঘাতের সূত্রপাত ও সময়রেখা</h2>
        <ul class="ei-list">
          <li><b>২৮ ফেব্রুয়ারি, ২০২৬:</b> যুক্তরাষ্ট্র ও ইসরায়েল যৌথভাবে ইরানে "অপারেশন এপিক ফিউরি" শুরু করে — সামরিক স্থাপনা, পারমাণবিক স্থাপনা ও নেতৃত্বকে লক্ষ্য করে হামলায় ইরানের সর্বোচ্চ নেতা আলী খামেনি নিহত হন।</li>
          <li><b>১৭ জুন:</b> ট্রাম্প ও ইরানের প্রেসিডেন্ট পেজেশকিয়ান যুদ্ধ বন্ধ ও হরমুজ প্রণালী পুনরায় খুলতে "ইসলামাবাদ স্মারকলিপি" স্বাক্ষর করেন — তবে ৮ জুলাই ইরান ফের জাহাজে হামলা চালানোয় এই সমঝোতা ভেঙে যায়।</li>
          <li><b>১৪ জুলাই:</b> হরমুজ প্রণালীতে তিনটি ট্যাংকারে ইরানের হামলায় একজন ভারতীয় নাবিক নিহত হন।</li>
          <li><b>২৯ জুলাই:</b> পেজেশকিয়ান ইরানিদের "অবিচল থাকার" আহ্বান জানান; ইরান হরমুজ পারাপার নিয়ে ওমানের প্রস্তাব প্রত্যাখ্যান করে এবং যুক্তরাষ্ট্র বিপ্লবী গার্ডের বিরুদ্ধে আকস্মিক ব্যালিস্টিক ক্ষেপণাস্ত্র হামলার অভিযোগ আনে।</li>
          <li><b>বর্তমান অবস্থা:</b> সর্বশেষ প্রাপ্ত প্রতিবেদন অনুযায়ী সংঘাত এখনো চলমান — মাঝেমধ্যে হামলা ও অনিশ্চিত আলোচনার মধ্যে দিয়ে, কোনো নিশ্চিত সমাপ্তি এখনো ঘোষিত হয়নি।</li>
        </ul>
      </section>

      <section class="ei-card">
        <h2>তেলের বাজারে প্রভাব</h2>
        <div class="ei-stat-row">
          <div class="ei-stat"><div class="ei-stat-val ei-down">$১২৬/ব্যারেল</div><div class="ei-stat-label">মার্চ ২০২৬-এ ব্রেন্ট ক্রুডের শীর্ষ মূল্য — ৪ বছরে প্রথমবার $১০০ ছাড়ায়, ইতিহাসের সবচেয়ে বড় মাসিক মূল্যবৃদ্ধি</div></div>
          <div class="ei-stat"><div class="ei-stat-val ei-down">$৭৬.৪৮</div><div class="ei-stat-label">৮ জুলাই — যুক্তরাষ্ট্রের নতুন হামলার পর ব্রেন্ট ক্রুড, ইরানের তেলের ওপর নিষেধাজ্ঞা মওকুফও বাতিল</div></div>
          <div class="ei-stat"><div class="ei-stat-val ei-down">$৯০+</div><div class="ei-stat-label">২৯ জুলাই — ট্রাম্পের হুঁশিয়ারির পর ব্রেন্ট ক্রুড ফের বাড়ে</div></div>
          <div class="ei-stat"><div class="ei-stat-val">+৫৫%</div><div class="ei-stat-label">যুদ্ধ শুরুর পর থেকে ব্রেন্ট ক্রুডের সর্বোচ্চ বৃদ্ধি (এপ্রিল পর্যন্ত হিসাবে)</div></div>
        </div>
        <p class="ei-note">আন্তর্জাতিক জ্বালানি সংস্থা (IEA)-র মতে হরমুজ প্রণালীর অবরোধ ছিল বৈশ্বিক তেল বাজারের ইতিহাসে সবচেয়ে বড় সরবরাহ বিপর্যয়গুলোর একটি, ১৯৭০-এর দশকের তেল সংকটের পর সবচেয়ে বড়।</p>
      </section>

      <section class="ei-card">
        <h2>হরমুজ প্রণালী ও শিপিং সংকট</h2>
        <ul class="ei-list">
          <li>ইরানের বিপ্লবী গার্ড দীর্ঘ সময় ধরে কার্যত হরমুজ প্রণালী অবরুদ্ধ রাখে — ট্যাংকার চলাচল প্রায় শূন্যে নেমে আসে এবং মার্স্ক, সিএমএ সিজিএম, এমএসসি, হাপাগ-লয়েডসহ প্রধান শিপিং কোম্পানিগুলো ট্রানজিট স্থগিত করে।</li>
          <li>যুদ্ধ-ঝুঁকি জাহাজ বিমা প্রিমিয়াম স্বাভাবিক ০.২৫% থেকে বেড়ে জাহাজের মূল্যের ৩–১০%-এ পৌঁছায় — একটি $১০ কোটি মূল্যের ট্যাংকারের জন্য প্রিমিয়াম প্রায় $২.৫ লাখ থেকে বেড়ে $৩০–১০০ লাখে দাঁড়ায়।</li>
          <li>আন্তর্জাতিক সামুদ্রিক সংস্থা (IMO)-র ৮ জুলাইয়ের হালনাগাদ অনুযায়ী অঞ্চলটিতে প্রায় ৬,০০০ নাবিক আটকা পড়েছিলেন।</li>
        </ul>
      </section>

      <section class="ei-card">
        <h2>বাংলাদেশে সরাসরি প্রভাব</h2>
        <ul class="ei-list">
          <li><b>জ্বালানি আমদাননির্ভরতা:</b> বাংলাদেশ তার জ্বালানি চাহিদার প্রায় ৯৫% আমদানি করে, যার বড় অংশ মধ্যপ্রাচ্য থেকে — ফলে দেশটি সরাসরি এই সংকটের ঝুঁকিতে।</li>
          <li><b>জ্বালানি তেলের মূল্যবৃদ্ধি:</b> ১৯ এপ্রিল থেকে কার্যকর হওয়া নতুন দামে পেট্রল ১৯ টাকা বেড়ে ১৩৫ টাকা/লিটার, ডিজেল ১৫ টাকা বেড়ে ১১৫ টাকা/লিটার, অকটেন ২০ টাকা বেড়ে ১৪০ টাকা/লিটার এবং কেরোসিন ১৮ টাকা বেড়ে ১৩০ টাকা/লিটারে দাঁড়ায় (১০–১৬.৬% বৃদ্ধি) — জ্বালানি মন্ত্রণালয় সরাসরি ইরান যুদ্ধ, হরমুজ প্রণালীর বিঘ্ন এবং বর্ধিত মালামাল/বিমা ব্যয়কে কারণ হিসেবে উল্লেখ করেছে।</li>
        </ul>
      </section>

      <section class="ei-card">
        <h2>শেয়ারবাজারে প্রভাব</h2>
        <div class="ei-stat-row">
          <div class="ei-stat"><div class="ei-stat-val ei-down">−৳২৯,৫৩১ কোটি ★</div><div class="ei-stat-label">২৮ ফেব্রুয়ারি যুদ্ধ শুরুর পর থেকে বাজার মূলধনে পতন (শেয়ারে একাই −৳২৭,১৭৬ কোটি)</div></div>
          <div class="ei-stat"><div class="ei-stat-val ei-down">−৩৪২ পয়েন্ট ★</div><div class="ei-stat-label">মার্চের শুরু থেকে ৯ এপ্রিল পর্যন্ত এক মাসে DSEX-এর সম্মিলিত পতন</div></div>
        </div>
        <p class="ei-note">★ চিহ্নিত পরিসংখ্যান দুটির মূল প্রতিবেদনের পাতা সরাসরি লোড করা যায়নি বলে একাধিক স্বতন্ত্র উৎস থেকে ক্রস-চেক করে নিশ্চিত করা হয়েছে। প্রাপ্ত প্রতিবেদনে সুনির্দিষ্ট কোনো ডিএসই-তালিকাভুক্ত কোম্পানির শেয়ারে প্রভাবের কথা উল্লেখ নেই — প্রতিক্রিয়া মূলত সূচক পর্যায়ে নথিভুক্ত।</p>
      </section>`;
  },
};

/* ────────────────────────────────────────────────────────────
   TOPIC 3 — USD/BDT exchange rate (Taka depreciation)
   Content populated after live WebSearch/WebFetch research (see
   the accompanying research task); each fact below is checked
   against data/stock-sectors.json and its own cited source.
──────────────────────────────────────────────────────────── */
const USD_BDT_TOPIC = {
  id: 'usd-bdt',
  navLabel: 'ডলারের বিপরীতে টাকার দরপতন',
  navSub: '',

  sectorGroups: [],
  sources: [],
  disclaimerHtml: '⚠️ এটি সংবাদভিত্তিক একটি খাতগত পর্যবেক্ষণ, বিনিয়োগ পরামর্শ নয়। প্রতিটি কোম্পানির প্রকৃত প্রভাব নির্ভর করে তার নিজস্ব আমদানি/রপ্তানি অনুপাত, বৈদেশিক ঋণ ও হেজিং কৌশলের ওপর — যা এই পাতায় পৃথকভাবে যাচাই করা হয়নি। যেকোনো সিদ্ধান্তের আগে কোম্পানির নিজস্ব প্রান্তিক প্রতিবেদন ও দাপ্তরিক ঘোষণা দেখুন।',

  buildSectionsHtml() {
    return `
      <section class="ei-card">
        <h2>গবেষণা চলছে</h2>
        <p>মার্কিন ডলারের বিপরীতে বাংলাদেশি টাকার দরপতন ও দেশের শেয়ারবাজারে এর সম্ভাব্য প্রভাব সম্পর্কিত তথ্য যাচাই করা হচ্ছে — সত্যিকারের সংবাদসূত্র থেকে যাচাইকৃত তথ্য পাওয়ার পর এই বিভাগ হালনাগাদ করা হবে।</p>
      </section>`;
  },
};

/* ────────────────────────────────────────────────────────────
   TOPIC 4 — AI impact on the Bangladesh economy / DSE
   Content populated after live WebSearch/WebFetch research (see
   the accompanying research task); each fact below is checked
   against data/stock-sectors.json and its own cited source.
──────────────────────────────────────────────────────────── */
const AI_IMPACT_TOPIC = {
  id: 'ai-impact',
  navLabel: 'এআই-এর প্রভাব',
  navSub: '',

  sectorGroups: [],
  sources: [],
  disclaimerHtml: '⚠️ এটি সংবাদভিত্তিক একটি খাতগত পর্যবেক্ষণ, বিনিয়োগ পরামর্শ নয়। প্রতিটি কোম্পানির প্রকৃত প্রভাব নির্ভর করে তার নিজস্ব প্রযুক্তি গ্রহণের গতি, স্বয়ংক্রিয়করণের সংস্পর্শ ও প্রতিযোগীদের অবস্থানের ওপর — যা এই পাতায় পৃথকভাবে যাচাই করা হয়নি। যেকোনো সিদ্ধান্তের আগে কোম্পানির নিজস্ব প্রান্তিক প্রতিবেদন ও দাপ্তরিক ঘোষণা দেখুন।',

  buildSectionsHtml() {
    return `
      <section class="ei-card">
        <h2>গবেষণা চলছে</h2>
        <p>কৃত্রিম বুদ্ধিমত্তা (AI)-র প্রভাব ও বাংলাদেশের শেয়ারবাজারে এর সম্ভাব্য প্রভাব সম্পর্কিত তথ্য যাচাই করা হচ্ছে — সত্যিকারের সংবাদসূত্র থেকে যাচাইকৃত তথ্য পাওয়ার পর এই বিভাগ হালনাগাদ করা হবে।</p>
      </section>`;
  },
};

const TOPICS = [GAS_CRISIS_TOPIC, US_IRAN_WAR_TOPIC, USD_BDT_TOPIC, AI_IMPACT_TOPIC];
let activeTopicId = TOPICS[0].id;

function buildTabsHtml() {
  return `<div class="ei-topic-tabs" role="tablist">
    ${TOPICS.map(t => `
      <button class="ei-topic-tab${t.id === activeTopicId ? ' active' : ''}" data-topic-id="${t.id}" role="tab" aria-selected="${t.id === activeTopicId}">
        <span class="ei-topic-tab-label">${escHtml(t.navLabel)}</span>
        ${t.navSub ? `<span class="ei-topic-tab-sub">${escHtml(t.navSub)}</span>` : ''}
      </button>`).join('')}
  </div>`;
}

function buildTopicPanelHtml(topic) {
  return `
    <div class="ei-topic-panel${topic.id === activeTopicId ? ' active' : ''}" data-topic-id="${topic.id}">
      ${topic.buildSectionsHtml()}

      ${topic.sectorGroups.length ? `
      <section class="ei-card">
        <h2>কোন ডিএসই-তালিকাভুক্ত খাত ও শেয়ার ঝুঁকিতে থাকতে পারে</h2>
        <p class="ei-note">নিচের তালিকা এই অ্যাপের নিজস্ব খাত-শ্রেণীবিভাগ (data/stock-sectors.json) থেকে যাচাই করা প্রকৃত ডিএসই কোড। মূল্য ও পরিবর্তন লাইভ ডেটা।</p>
        <div id="ei-sectors-${topic.id}"></div>
      </section>` : ''}

      ${topic.disclaimerHtml ? `<div class="ei-disclaimer">${topic.disclaimerHtml}</div>` : ''}

      ${topic.sources.length ? `
      <section class="ei-card ei-sources">
        <h2>তথ্যসূত্র</h2>
        <ol>
          ${topic.sources.map(s => `<li><a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(s.title)}</a></li>`).join('')}
        </ol>
      </section>` : ''}
    </div>`;
}

function buildSectorChip(stock) {
  if (!stock) return '';
  const dir = stock.change > 0 ? 'up' : stock.change < 0 ? 'dn' : 'fl';
  const sgn = stock.change > 0 ? '+' : '';
  const pct = stock.ycp ? ((stock.change / stock.ycp) * 100).toFixed(1) : '0.0';
  return `
    <a class="ei-chip" href="/candlestick_chart/candlestick.html?code=${encodeURIComponent(stock.code)}">
      <span class="ei-chip-code">${escHtml(stock.code)}</span>
      <span class="ei-chip-ltp">৳${stock.ltp.toFixed(1)}</span>
      <span class="ei-chip-chg ei-chip-chg--${dir}">${sgn}${pct}%</span>
    </a>`;
}

function renderTopicSectors(topic, stocksByCode) {
  const el = document.getElementById(`ei-sectors-${topic.id}`);
  if (!el) return;
  el.innerHTML = topic.sectorGroups.map(group => `
    <div class="ei-sector-block">
      <div class="ei-sector-hd">
        <span class="ei-sector-title">${escHtml(group.title)}</span>
        <span class="ei-sector-sub">${escHtml(group.sub)}</span>
      </div>
      <div class="ei-chip-row">
        ${group.codes.map(code => buildSectorChip(stocksByCode[code]) || `<span class="ei-chip ei-chip--missing">${escHtml(code)}</span>`).join('')}
      </div>
      ${group.note ? `<div class="ei-sector-note">${escHtml(group.note)}</div>` : ''}
    </div>`).join('');
}

function applyActiveTopic() {
  document.querySelectorAll('.ei-topic-tab').forEach(b => {
    const on = b.dataset.topicId === activeTopicId;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.ei-topic-panel').forEach(p => p.classList.toggle('active', p.dataset.topicId === activeTopicId));
}

function render() {
  const root = document.getElementById('ei-page-root');
  if (!root) return;
  root.innerHTML = buildTabsHtml() + `<div id="ei-topic-panels">${TOPICS.map(buildTopicPanelHtml).join('')}</div>`;
  root.querySelectorAll('.ei-topic-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTopicId = btn.dataset.topicId;
      applyActiveTopic();
    });
  });
}

async function init() {
  render();
  try {
    const res = await fetch(`${API}/api/stocks`);
    const data = await res.json();
    const byCode = {};
    (data.stocks || []).forEach(s => { byCode[s.code] = s; });
    TOPICS.forEach(topic => renderTopicSectors(topic, byCode));
  } catch {
    TOPICS.forEach(topic => {
      const el = document.getElementById(`ei-sectors-${topic.id}`);
      if (el) el.innerHTML = '<div class="ei-note">লাইভ মূল্য লোড করা যায়নি — সার্ভার সংযোগ পরীক্ষা করুন।</div>';
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
