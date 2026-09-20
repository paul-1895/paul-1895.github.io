/* ═══════════════════════════════════════════════════════════
   guide-videos.js — per-section YouTube videos for the study guides

   Every built-in guide (candles, rsi, pharma, …) loads this file. It
   looks up the page by filename, and for each section id listed below
   appends a small "Watch" strip of video cards at the end of that
   section, so the viewing sits next to the text it explains instead of
   in one pile at the bottom. The bottom "Videos" section (created here
   if the page doesn't already have one) becomes an index of everything
   on the page.

   Cards open in an in-page player (same modal as topic.html, styled by
   learning.css) — the link still points at YouTube so middle-click /
   "open in new tab" keep working.

   Every id below was checked against YouTube's oEmbed endpoint when it
   was added; ids that returned 401/403 (embedding disabled) were left
   out. Titles are the uploader's, lightly trimmed. Nothing here is an
   endorsement — the guides' own "Reading it honestly" sections still
   apply to whatever the videos claim.

   Runs synchronously at the point the <script> is placed (end of body,
   before the page's own script) so the section it may add exists before
   the page's scroll-spy queries `.cd-toc a`.
═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── data ───────────────────────────────────────────────
  // V(id, title, by, note)  — note is the one-line "why this one" shown
  // under the title; keep it about what the video adds to the section.
  const V = (id, title, by, note) => ({ id, title, by, note });

  // Shared entries reused across pages.
  const SECTOR_PE      = V('8aIh59slxX4', 'Why different sectors have different P/E ratios', 'Groww', 'Why a cross-sector P/E table needs context before it means anything');
  const SCHWAB_RATIOS  = V('K82DCd1wcpI', 'How to compare stocks using valuation ratios', 'Charles Schwab', 'P/E, P/B and friends, and when each one is the wrong tool');
  const GOOD_CO        = V('ZY_NFQNUr_k', 'Are "good companies" good investments?', 'Ben Felix', 'The evidence that a strong story is usually already in the price');
  const RR_FALLACY     = V('_J8Mhyjcbtw', 'The "good company is a good investment" fallacy', 'The Rational Reminder Podcast', 'Longer discussion of the same point, with the academic literature');
  const NILES          = V('6OrYG07Lf5c', "Don't confuse stock prices with company fundamentals", 'CNBC Television', 'A fund manager on why the two series can drift apart for years');
  const SURVIVOR       = V('-a8orsLT3lM', 'The worst type of survivorship bias in backtesting', 'Enlightened Stock Trading', 'Testing only on stocks that still exist today flatters every result');
  const BACKTEST_LIES  = V('F_HHFVJjNZI', 'Why your backtest lies: survivorship & look-ahead bias', 'QuantInsti', 'Two-minute summary of the two biases every result must be checked for');
  const OVERFIT        = V('Zy4nonUVdZk', 'How quants actually backtest: eliminating overfitting', 'Surbhi Verma', 'In-sample vs out-of-sample, and why tuned parameters flatter themselves');
  const SLIPPAGE       = V('OUXedFzQQGE', 'How much commission & slippage to allow when backtesting', 'Enlightened Stock Trading', 'Why an untaxed gross edge is not an edge — the same trap this app measures');
  const CURVEFIT       = V('kJ_6b_2icBU', 'How to avoid curve fitting during backtesting', 'NetPicks', 'Plain-language version of the overfitting problem');

  const GUIDE_VIDEOS = {

    // ── Technical analysis ─────────────────────────────
    'candles': {
      anatomy: [
        V('72lRNukNfT0', 'Candlestick charts explained', 'The Complete Guide to Everything', 'Open, high, low, close, body and shadow — the vocabulary this whole guide uses'),
        V('pDmYWUFKUJ0', 'Candlestick anatomy & psychology', 'Ganesh Sharma', 'Body-vs-wick as a record of who won the session, and what a long wick means'),
        V('3obFWoqZfDI', 'The man who invented candlestick charts', 'Finance Decipher', 'Munehisa Homma and the 18th-century rice market this notation came from'),
      ],
      single: [
        V('PrDE4SDwC7Q', 'All single-candlestick patterns explained', 'Jibanjyoti Panigrahi', 'Hammer, doji, shooting star and their inverses, one by one'),
        V('g5HImWV8X4U', 'Hammer, hanging man & shooting star', 'FinGrad', 'The same shape means different things depending on the trend it appears in'),
      ],
      multi: [
        V('nYQ6h8xaSvM', 'Morning star & evening star explained', 'Looking at the Markets', 'The three-candle reversal shapes and what the middle candle is supposed to show'),
      ],
      detected: [
        V('VZx9Wz9oHfU', 'Backtesting candlestick patterns in Python', 'Chad Thackray', 'What it takes to turn a pattern name into a rule a program can actually check'),
      ],
      types: [
        V('WU3gHZBpRv4', 'Line, bar and candlestick charts', 'Exness', 'What each chart type keeps and what it throws away'),
        V('u6KwG5hro_g', 'What is the best chart type?', 'Trading 212', 'A short, opinionated comparison'),
      ],
      honest: [
        V('U_jhKw7rdB8', 'I backtested 5,679 candlestick strategies', 'Algovibes', 'What survives when every pattern is tested with walk-forward validation: almost nothing'),
        V('Q3JaarfshV0', 'Engulfing pattern — surprising backtest results', 'Critical Trading', 'One pattern, tested properly, with results that cut both ways'),
      ],
    },

    'heikin-ashi': {
      what: [
        V('Lwrz6Ckbwqw', 'How to read price action using Heikin-Ashi charts', 'The Secret Mindset', 'Why the candles look smoother than the real ones, and what that costs'),
        V('-LAZxnoWRuA', 'Heikin Ashi: a very different way to trade candlestick charts', 'Schwab Coaching', 'A slower, webinar-style walkthrough with real charts'),
      ],
      build: [
        V('nVP5iOpJEzE', 'Heikin-Ashi candlesticks in Google Sheets, with formulas', 'BriskLearningStudio', 'The four formulas built cell by cell — the same maths this app ports'),
      ],
      reading: [
        V('rYL1f0pJIdk', "Beginner's guide to trading with Heikin Ashi", 'Barchart', 'Colour runs, shaved candles and dojis as the three things people look for'),
        V('5qJamGBoSM8', 'Heikin Ashi charts: learn to ride trends', 'Fortune Talks', 'The trend-riding read, argued from the enthusiast side'),
      ],
      strategies: [
        V('2G78zkuQSc0', 'The Heikin Ashi trading strategy', 'TradingLab', 'Pairing the candles with a moving average and a momentum indicator'),
        V('cReaqWRtd_I', 'The best Heikin Ashi trading guide', 'Data Trader', 'Longer guide covering several indicator combinations'),
      ],
      honest: [
        V('G04WlDX1x34', 'Heikin Ashi vs normal candlesticks: which should I use?', 'Royal Trading Strategies', 'The lag and the fake-price problem, stated plainly'),
        V('AOu0_fUInJY', 'The hidden flaw in Heikin Ashi', 'Trading IQ', 'The averaged open is not a price you could have traded at'),
      ],
    },

    'hilega-milega': {
      what: [
        V('Fz1D5dgxqpw', 'Hilega Milega indicator explained', 'Varsity Losal', 'Where the name comes from and the RSI-plus-two-averages construction'),
        V('PV9HZB8Sb8Q', 'Hilega Milega uses, by NK Sir', 'NK Stock Talk', 'From the channel that popularised the setup this pane is modelled on'),
      ],
      build: [
        V('Em2MoKJkesI', 'How to plot Hilega-Milega on TradingView', 'Market Tech N Funda', 'RSI(9), its 21-WMA and 3-EMA added by hand — matches this app\'s pane'),
        V('ZJkK9F4YoEQ', 'Hilega to Milega setup: how to use & plot', 'Financial Tips Academy', 'A second walkthrough of the same three lines, with a user\'s own notes'),
      ],
      zones: [
        V('MCmwDdPaSKQ', 'Basic chart reading: Trend Magic + Hilega Milega', 'NK Stock Talk', 'The above-50 / below-50 zone read, as its originator teaches it'),
      ],
      real_examples: [
        V('0MbS8GWzx4c', 'Live intraday & positional trading with Hilega Milega', 'Upsurge Club', 'Real charts, real time — note how often the lines whipsaw'),
      ],
      evidence: [
        V('tNUicfATYOo', 'Hilega to Milega strategy tested 100 times', 'Trader Insights', 'A hand-tested sample on Nifty; compare with the backtest numbers above'),
      ],
      honest: [
        V('lnE9dh5UwDM', 'Drawbacks of the Hilega Milega indicator', 'Upsurge Club', 'The sideways-market problem, from a channel that otherwise teaches it'),
        V('tMxMQ1fBC6s', 'I tested 200,000 trades to find the best RSI settings', 'Critical Trading', 'Why a 9-period RSI is faster but noisier than 14, measured'),
      ],
    },

    'bollinger-bands': {
      what: [
        V('HGrwded1rqM', "Beginner's guide to Bollinger Bands", 'TrendSpider', 'Middle band, outer bands, and what "volatility envelope" means'),
        V('wQor9mqXt-o', 'John Bollinger on the evolution of trading bands', 'CMT Association', 'The inventor on why standard deviation, and what the bands were meant for'),
      ],
      build: [
        V('oEsFmi8UMa0', 'Using standard deviation & Bollinger Bands', 'Investors Trading Academy', 'The maths behind the band width'),
        V('lYzn_mEpTyg', 'Bollinger Bands and standard deviation', 'UTRADEFX', 'Same idea, shorter'),
      ],
      squeeze: [
        V('--lv7xXEAcA', 'The squeeze breakout', 'Mind Math Money', 'Narrow bands as a volatility-contraction signal, and the breakout trade built on it'),
        V('G6MVccESQqM', 'Bollinger Band squeeze breakout strategy, backtested', 'Trading Tact', 'The same idea with numbers attached'),
      ],
      reading: [
        V('t1cHa5lUA2Y', 'Bollinger Bands trading strategy explained', 'Strike Money', 'The common reads: band tags, walking the band, mean reversion'),
        V('AIG74j1G1V4', 'Bollinger Bands as a mean-reversion indicator', 'The Transparent Trader', 'The fade-the-band read'),
        V('3VZ6GEe6_GU', 'Bollinger Bands and mean reversion', 'Quantra / Ernest Chan', 'A quant\'s framing: bands only mean-revert on series that actually mean-revert'),
      ],
      honest: [
        V('c9-SIpy3dEw', 'Mean reversion strategy explained & backtested', 'Quant Tactics', 'How a band-based rule behaves when tested rather than eyeballed'),
      ],
    },

    'fibonacci': {
      what: [
        V('rQMc9ykHt0Y', 'What is Fibonacci retracement?', 'Aliakbar', 'The sequence, the golden ratio, and how they became chart levels'),
        V('6xRAxcia9mI', 'Fibonacci retracement explained, in Excel', 'NEDL', 'Built by hand in a spreadsheet — the clearest way to see the arithmetic'),
      ],
      ratios: [
        V('MIkMlgMBO24', 'Fibonacci golden ratios: how they work', 'Craig Percoco', 'Where 38.2, 50, 61.8 and 78.6 come from'),
        V('3X8chhWCTTI', 'The 161.8% Fibonacci extension', 'Tradingsim', 'The most-used extension level and what it is measured from'),
      ],
      tools: [
        V('fc_0Nz1I3k4', 'How to draw Fibonacci: retracements, expansions, extensions', 'Matt FXS', 'The tools differ mainly in which two or three points you anchor'),
        V('oVMeymdZwWI', 'Ultimate Fibonacci trading course', 'Wysetrade', 'Longer course covering all three tools'),
        V('GsLJ4I7JP1g', 'Fibonacci extension price-target strategy', 'Mind Math Money', 'The extension tool as a target-setting device'),
      ],
      worked_example: [
        V('C2rSX7w_o2M', 'How to calculate targets with Fibonacci extensions', 'Investoo', 'A numeric walkthrough to compare with the worked example above'),
      ],
      reading: [
        V('dtvqPxMNVMI', 'Fibonacci retracement strategy: the golden zone', 'Mind Math Money', 'The 50–61.8% "golden zone" read most videos teach'),
        V('ZkXUGZthr5E', 'Fibonacci trading: retracements and extensions', 'Stopsaving', 'Retracement for entries, extension for exits — the standard pairing'),
      ],
      honest: [ OVERFIT ],
    },

    'rsi': {
      what: [
        V('hbcCykbX14U', 'How to use the Relative Strength Index', 'Charles Schwab', 'A sober introduction from a broker rather than a signal seller'),
        V('ILs4Qu83q8U', 'From 1978 to 2025: the story of RSI', 'Mubite', 'Wilder\'s original intent, and how the 70/30 convention calcified'),
      ],
      formula: [
        V('O6BYFpXUh5I', 'Relative Strength Index: tutorial', 'TradingView', 'Average gain over average loss, then the 0–100 rescale'),
        V('K22gVblfpJU', 'Introduction to RSI', 'IG', 'Same formula, different presenter'),
      ],
      discrepancy: [
        V('3nMuc7rBOAs', 'The best RSI indicator settings', 'Mind Math Money', 'Why two RSIs with the same period can still disagree: smoothing choice matters'),
      ],
      measured: [
        V('tMxMQ1fBC6s', 'I tested 200,000 trades to find the best RSI settings', 'Critical Trading', 'How much period and smoothing actually change the readings, measured'),
      ],
      levels: [
        V('cxWaX19lZv0', 'Most traders use RSI completely wrong', 'Mind Math Money', '"Overbought" is not a sell signal in a trend'),
        V('e80R9pxyScU', 'The right way to use RSI', 'FxScouts', 'Overbought/oversold as a regime description, not a trigger'),
        V('WhEnQSXjOfw', 'RSI signals most traders misread', 'StockCharts TV', 'Range shifts: why RSI lives in 40–80 in an uptrend and 20–60 in a downtrend'),
      ],
      divergence: [
        V('8i5iWFHV4Ds', 'RSI: bullish & bearish divergence', 'Dan Heilman', 'What divergence is, drawn slowly'),
        V('FVgfEbvTF78', 'RSI divergence explained with examples', 'TrendSpider', 'Regular vs hidden divergence, with the failure cases'),
      ],
      evidence: [
        V('s4xx_9L_uEY', '3 RSI trading strategies backtested with 30 years of data', 'Quantified Strategies', 'Which RSI rules have historically held up, and which have not'),
        V('ualY_K-TPe0', 'Is the RSI strategy profitable or overhyped? 4,000+ trades', 'AlgoTrade Pro', 'A large-sample test to set against the numbers above'),
      ],
      honest: [ SLIPPAGE, BACKTEST_LIES ],
    },

    'smart-money': {
      what: [
        V('QQijkhheJ9g', 'Learn every ICT concept in 17 minutes', 'Pro Trading School', 'Liquidity, FVG, order blocks, displacement — the whole vocabulary in one pass'),
        V('QrYW_qzWmrg', 'ICT smart money concepts explained', 'Com Lucro Trader', 'A second, slower tour of the same ideas'),
      ],
      vocabulary: [
        V('RjR2kTErlq4', 'Combining liquidity sweeps, FVGs & order blocks', 'Smart Risk', 'How the pieces are meant to fit together in one trade'),
        V('hVX3OdkOhB4', 'Order blocks vs fair value gaps', 'Smart Risk', 'Two of the vocabulary words, contrasted'),
      ],
      footprint: [
        V('KObUowoFiK0', 'The only order-flow footprint chart guide you\'ll need', 'deepcharts', 'What a footprint shows — bid/ask volume at each price — and why it needs tick data'),
        V('QFpk0ICyCDA', 'Order flow simplified: footprint charts & CVD', 'Trading Notes', 'Cumulative volume delta, the other thing DSE data cannot give you'),
      ],
      data: [
        V('Rsm5G7tKi90', 'Understanding OHLCV data', 'Mathew K Analytics', 'Exactly what the archive carries, and what is missing from it'),
        V('co7fFdjjJyo', 'Volume profile trading fully explained', 'Raghee Horner', 'The closest thing to order flow you can build from daily volume alone'),
      ],
      fvg: [
        V('aoI1JCbYr0s', 'Master fair value gaps in 21 minutes', 'Trading Notes', 'The three-candle gap definition this app measures — and the fill claim it tests'),
      ],
      sweep: [
        V('rn8Wzgi4Q1w', 'Stop-hunt strategy explained (liquidity sweep)', 'Altrady', 'Sweep-then-reverse, the one SMC signal actually coded here'),
        V('LoIVFD95U08', 'How smart money hunts breakout buyers', 'Mind Math Money', 'The same pattern from the trapped trader\'s side'),
        V('O5bTV2BQVWg', 'Liquidity sweep explained', 'AR Trades', 'Short version'),
      ],
      blocks: [
        V('y_LJ8kVj_tM', 'Block trade: definition, how it works, example', 'Simple Explain', 'What a block trade is and why it prints away from the order book'),
        V('4BeXD0xZfD8', 'Block deal vs bulk deal', 'Pravin Khetan', 'The Indian exchange terminology, which DSE\'s block board closely resembles'),
        V('Y9VPqihnyOI', 'Block deal and bulk deal in the share market', 'Apna Trader', 'How retail investors read a block-deal list'),
      ],
      honest: [ BACKTEST_LIES, V('9f0rdjA0CsE', 'The critical flaw in most TradingView strategy tests', 'TradersPost', 'Why the win rates in SMC videos rarely survive an honest fill model') ],
    },

    // ── Strategy ───────────────────────────────────────
    'macd-ema': {
      what: [
        V('HZtJCCRvgJo', 'MACD explained simply', 'Mind Math Money', 'MACD line, signal line, histogram, crossovers and the zero line in ten minutes'),
        V('dUPtmxJ7bLo', 'Introduction to MACD', 'IG', 'The same parts, introduced more slowly'),
      ],
      build: [
        V('xQYrUSRrLYo', 'MACD trading explained for beginners', 'Capital.com', 'EMA(12) minus EMA(26), then an EMA(9) of that'),
        V('NlNoM4XgbHY', 'The MACD indicator on TradingView', 'TradingView', 'Where the 12/26/9 defaults live and what changing them does'),
        V('Hsh6utsCZGY', 'MACD explained', 'LightningChart', 'A programmer\'s-eye view of the computation'),
      ],
      trend: [
        V('QbZqYw7pm-g', 'MACD + 200 EMA strategy: in-depth backtest', 'FrameworkFX', 'The trend filter this plan uses, tested on its own'),
        V('JbqoJqnrM-Y', 'Simple MACD + 200 EMA strategy tested 900 times', 'TradeSmart', 'A hand-tested sample of the same combination'),
      ],
      crosses: [
        V('Zslbu3ExeTA', 'Why the MACD crossover signal is so important', 'StockCharts TV', 'The signal-line cross as a momentum turn'),
        V('2U7ytV65sqg', 'MACD crossovers: why most traders get it wrong', 'StockCharts TV', 'Crosses far from zero vs near it — not all crosses are equal'),
        V('fhijsAGeIrQ', 'How to use the MACD zero line', 'Joe Rabil', 'The zero-line cross, the second trigger this plan watches'),
      ],
      evidence: [
        V('Ik0ILD0gPHA', 'MACD and EMA trend strategy: a full algorithmic backtest', 'CodeTrading', 'A coded backtest in Python — closest in spirit to this app\'s own'),
        V('Wm1Umq8ItCM', 'I tested this EMA + MACD strategy for 6 years', 'Quant Tactics', 'A long-window test; compare the drawdowns, not just the headline'),
      ],
      honest: [ SLIPPAGE, OVERFIT ],
    },

    'minervini': {
      what: [
        V('e9o9VmQyxTM', 'How Mark Minervini pinpoints Stage 2 super-stocks', 'TheMintCode', 'The trend template as a Stage-2 filter, in Minervini\'s own framing'),
        V('nKtzOA1grfs', 'Mark Minervini trading strategy explained', 'Jack Corsellis', 'Trend template plus VCP, end to end'),
      ],
      shape: [
        V('RyRFMwwgfXA', 'Volatility Contraction Pattern (VCP)', 'Linus Lim', 'The tightening-pullbacks shape the template is meant to precede'),
        V('oCnFNVMiXwA', 'How to trade & scan for VCP setups', 'Jack Corsellis', 'What a scanner can and cannot see of that shape'),
      ],
      criteria: [
        V('LjrOdg9YbOI', 'How to set up the Minervini trend template', 'Stockbee', 'The eight rules as originally published (this app implements seven)'),
        V('9JgBx6E3fmg', 'Minervini trend template tutorial', 'Stocks & Stories', 'Each criterion with the reasoning behind it'),
        V('MdwrjdRu6ww', 'TradingView Pine screener and the trend template', 'LevelUp Tools', 'The same rules coded as a screen'),
      ],
      timeframes: [
        V('k6I04ciE1KE', 'How to use multi-timeframe analysis', 'TheOneLanceB', 'Why the same stock passes on one timeframe and fails on another'),
        V('8Kpxi29fFPo', 'When the weekly timeframe beats the daily', 'VasilyTrader', 'Three cases where the slower chart is the right one'),
      ],
      today: [
        V('BW30zCoMj8Q', 'How to find Stage 2 (uptrending) stocks', 'Rohit Musale, CFA', 'Running a template scan and reading the list it produces'),
        V('7T6UvaVWT4o', 'This setup made 300% returns: Minervini\'s trend template', 'TrendSpider', 'A scan-based walkthrough — treat the headline number as marketing'),
      ],
      evidence: [
        V('9gX--m5Bo30', 'I studied the top 100 stocks (VCP pattern)', 'Financial Wisdom', 'Looking backwards from winners — note the survivorship problem'),
      ],
      caveats: [
        V('rX25L0PBxLc', 'Stan Weinstein stage analysis explained simply', 'Protrader Scans TV', 'The four-stage model Minervini\'s "Stage 2" comes from'),
        V('xZL0bwjzufo', 'Stan Weinstein stage analysis, step by step', 'Jack Corsellis', 'Longer treatment with chart examples'),
      ],
      honest: [ SURVIVOR, OVERFIT ],
    },

    // ── Fundamental analysis: sectors ──────────────────
    'pharma': {
      what: [
        V('xQtDWwriUuY', 'Rise of the pharmaceutical sector in Bangladesh', 'Business Inspection BD', 'How the industry went from importer to 98% self-sufficient (Bangla)'),
        V('qXH43-PstTg', "Bangladesh's pharma industry: how real is the potential?", 'The Business Standard', 'A sceptical look at the export story (Bangla)'),
        V('RHUPYlbyyQw', 'Beximco Pharma: top pharmaceutical company in Bangladesh', 'BEXIMCO Group', 'A listed company\'s own corporate film — useful for the plants, not the claims'),
      ],
      economics: [
        V('aeG2lWxYO_Y', 'How drug prices work', 'The Wall Street Journal', 'The layers between a factory price and a pharmacy price'),
        V('r323eckDm7Y', 'How the U.S. generic drug supply chain works', '60 Minutes', 'Generics as a volume business with thin margins — the model Bangladesh runs'),
        V('rKT7Qo0sQuI', 'What are APIs (active pharmaceutical ingredients)?', 'BOC Sciences', 'The imported input that dominates cost of goods'),
      ],
      patents: [
        V('shTyxnb6KRo', "The case for policy space: Bangladesh's pharma sector and access to medicines", 'Boston University GDP Center', 'The TRIPS waiver, what LDC graduation ends, and who loses'),
        V('Sg3_eH4Oi50', 'How Big Pharma blocks cheaper drugs', "It's Complicated", 'Patent strategy from the originator\'s side'),
        V('vVezKcBz4VA', 'What are the benefits of staying an LDC?', 'The Business Standard', 'LDC graduation and Bangladesh\'s economy (Bangla)'),
      ],
      tension: [ GOOD_CO, NILES ],
      ranking: [ SECTOR_PE, SCHWAB_RATIOS ],
      drivers: [
        V('FNkdoGr0gO0', "The prospect of Bangladesh's pharma industry", 'Coach Kamrul Hasan', 'An industry insider on exports, API parks and pricing'),
        V('08QrO2rR7FY', "Bangladesh's upcoming LDC graduation: implications and challenges", 'NIICE', 'The macro event that changes this sector\'s rules'),
      ],
      honest: [ RR_FALLACY ],
    },

    'insurance': {
      what: [
        V('wR9J7wonvrg', 'Potential of the insurance sector in Bangladesh', 'The Business Standard', 'Penetration, trust and the growth case, from MetLife\'s country head'),
        V('sD7FSsXo-lo', "Why Bangladesh's insurance industry is lagging behind", 'Business Inspection BD', 'The claim-settlement and trust problem (Bangla)'),
        V('BzohIutH8dQ', 'Top 5 insurance companies in Bangladesh', 'Star Express', 'A quick tour of the names on the DSE board'),
      ],
      economics: [
        V('WBOYDnPfkUU', 'Insurance float explained', 'AHealthcareZ', 'Premiums now, claims later — the float that makes insurers investors'),
        V('BZM4WeNCJB8', 'What is the combined ratio?', 'Simple Explain', 'Loss ratio plus expense ratio: the one number for underwriting profit'),
        V('vUWybuhzATk', 'How do insurance companies make money?', 'InsurTech:LA', 'Underwriting income vs investment income, side by side'),
      ],
      split: [
        V('v1dd1gmJffg', 'The difference between general and life insurance', 'Skye Wealth', 'Short-tail vs long-tail liabilities and why the accounting differs'),
        V('13KHVc2IkUI', 'Life insurance vs general insurance', 'Yasser Khan', 'The same split, with more examples'),
      ],
      ranking: [ SECTOR_PE, SCHWAB_RATIOS ],
      drivers: [
        V('JeVFUfYezwQ', 'Inflation, interest rates and the insurance sector', 'FundCalibre', 'Why rates matter more to insurers than to almost any other sector'),
        V('C0BK_Mip9oM', 'Sector rotation: how the economic cycle affects stocks', 'Charles Schwab', 'Where financials sit in the cycle'),
      ],
      honest: [ GOOD_CO ],
    },

    'telecom': {
      what: [
        V('cgoxLpycII4', 'Big changes coming to the mobile network system', 'ATN Bangla News', 'The licensing overhaul reshaping who can do what (Bangla)'),
        V('cYBRRBtyBMc', 'Key factors defining the telecom industry in 2026', 'Omdia', 'The global backdrop: flat ARPU, rising capex, data as the only growth'),
      ],
      three: [
        V('q53K43mQEko', 'Will Telenor keep its social-business promise in Bangladesh?', 'Daily Bonik Barta', 'Grameenphone\'s parent and the ownership question (Bangla)'),
        V('tanjgxJpwwA', 'Allegation: reforms hand the whole business to mobile operators', 'SOMOY TV', 'The operators vs the rest of the value chain (Bangla)'),
      ],
      economics: [
        V('QtxglBtvOx0', 'What does ARPU mean?', 'Business Standard', 'Average revenue per user — the metric every operator is judged on'),
      ],
      ranking: [ SECTOR_PE, SCHWAB_RATIOS ],
      drivers: [
        V('PpP4Vlu8PAk', '"BTRC has been turned into a farce of a commission"', 'Jamuna TV', 'A seminar on regulatory capture — the regulator is the biggest driver here (Bangla)'),
      ],
      honest: [ NILES ],
    },

    'textile': {
      what: [
        V('psmcT91m-UM', 'Overview of the RMG industry of Bangladesh', 'Fibre2Fashion', 'Scale, history and export share of ready-made garments'),
        V('2fMlubnI3E0', 'Evolution of the readymade garment industry in Bangladesh', 'Trade & Investment Bangladesh', 'From Desh Garments to the second-largest exporter'),
      ],
      gap: [
        V('4O6s9nXL9Og', "Navigating the future of Bangladesh's RMG sector", 'LightCastle Partners', 'Who the big exporters are — and why almost none of them are listed'),
        V('ej6uwi2xxA0', "Reimagining the future of Bangladesh's RMG industry", 'Business Mirror', 'The consolidation and compliance trends squeezing small mills'),
      ],
      chain: [
        V('o9w8rVp6kHw', 'How a cotton shirt is made, from field to customer', 'Processly', 'Every stage in order: ginning, spinning, weaving, dyeing, cutting, sewing'),
        V('RDBvmTX19Z4', 'Inside a modern textile mill: raw cotton to woven fabric', 'Inside the Machine', 'The spinning and weaving stages most DSE textile companies actually occupy'),
        V('lCy5DJb24_s', 'Watch 350 balls of cotton turn into a shirt', 'CNN Business', 'Four minutes, whole chain'),
        V('bVjFP8LTa6c', 'Flow chart of the textile manufacturing process', 'Textile Vlog', 'The chain as a diagram'),
      ],
      ranking: [ SECTOR_PE, SCHWAB_RATIOS ],
      drivers: [
        V('LBqulH-jyqw', "Tariff blow to Bangladesh's garment industry", 'WION', 'The 2025 US tariff shock'),
        V('fshx_EFDKa4', 'US–Bangladesh trade deal cuts tariffs to 19%', 'NEWS9', 'The 2026 settlement and the US-cotton clause'),
        V('Itx6Zv2f07s', "Bangladesh's garment industry grapples with the Red Sea crisis", 'Press Xpress', 'Freight and lead-time risk'),
        V('Mq5EmD87rzQ', "Bangladesh's LDC graduation: opportunity or risk?", 'Brand BGMEA', 'The EU duty-free question, from the exporters\' association'),
        V('v3YgKwqlXNg', 'Orders falling: the garment sector in danger', 'EKHON TV', 'The order-book cycle (Bangla)'),
      ],
      honest: [
        V('A3FpvlcIf9E', 'Bangladesh garment factories that supply H&M, Zara in trouble', 'BBC News', 'Why a booming export sector can still be a bad place to own equity'),
      ],
    },

    'paper': {
      what: [
        V('TPGwYWzSrtw', 'Paper industry of Bangladesh, part 1', 'Boishakhi TV', 'A television survey of the mills and their capacity (Bangla)'),
        V('nHm_uvy3QVA', 'Paper industry of Bangladesh, part 3', 'Boishakhi TV', 'Continuation: demand, imports and pricing (Bangla)'),
        V('3DJLXljrsYQ', 'Bashundhara Paper Mills documentary', 'Bashundhara Paper Mills', 'The largest listed producer\'s own corporate film'),
      ],
      economics: [
        V('OsHjdbmVCGM', 'How paper is made: manufacturing process explained', 'PIP Academy', 'Pulp to sheet, and where the energy and chemical costs sit'),
        V('2yqp-kBVJzk', 'How paper is produced at Braviken mill, from pulp to paper', 'Holmen', 'A modern mill floor — the scale a capital-intensive commodity business needs'),
        V('Mh5TVqMyyhI', 'How paper is actually made in factories', 'Simplegyan Engineering', 'A second walkthrough, engineer\'s angle'),
      ],
      tell: [
        V('86Bv4HfO43w', "A challenging time for the paper industry: Bashundhara Paper's revenue falls", 'NEWS24', 'What a down-cycle looks like in the sector leader\'s numbers (Bangla)'),
      ],
      ranking: [ SECTOR_PE, SCHWAB_RATIOS ],
      drivers: [
        V('mVfHycnRudI', 'Suzano earnings: the pulp price rose and profit fell 64%', 'Charged Alpha', 'Imported pulp is the cost line that swings this sector'),
        V('oiPYvybKkvQ', 'Karnaphuli Paper Mills makes paper from waste', 'Desh TV', 'The recycled-fibre route around the pulp-import problem (Bangla)'),
      ],
      honest: [ GOOD_CO ],
    },
  };

  // Section ids in the HTML use hyphens; object keys above use underscores.
  const sectionIdOf = key => key.replace(/_/g, '-');

  // ── helpers ─────────────────────────────────────────────
  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const watchUrl = id => 'https://www.youtube.com/watch?v=' + id;

  function cardHTML(v, tag) {
    return `
      <a class="cd-video-card" href="${watchUrl(v.id)}" target="_blank" rel="noopener"
         data-yt-id="${esc(v.id)}" data-yt-title="${esc(v.title)}">
        <div class="cd-video-thumb">
          <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" />
          <span class="cd-video-play">▶</span>
        </div>
        <div class="cd-video-body">
          ${tag ? `<span class="cd-video-tag">${esc(tag)}</span>` : ''}
          <h4>${esc(v.title)}</h4>
          <p><b>${esc(v.by)}</b>${v.note ? ' — ' + esc(v.note) : ''}</p>
        </div>
      </a>`;
  }

  // ── render ──────────────────────────────────────────────
  const page   = (location.pathname.split('/').pop() || '').replace(/\.html$/i, '');
  const videos = GUIDE_VIDEOS[page];
  if (!videos) return;

  const main = document.querySelector('main.cd-main');
  if (!main) return;

  const all  = [];          // every video on the page, in section order
  const seen = new Set();

  Object.keys(videos).forEach(key => {
    const list = videos[key];
    if (!list || !list.length) return;
    const sec = document.getElementById(sectionIdOf(key));
    if (!sec || !sec.classList.contains('cd-sec')) return;

    const heading = (sec.querySelector('.cd-h2') || {}).textContent || '';
    list.forEach(v => { if (!seen.has(v.id)) { seen.add(v.id); all.push({ ...v, tag: heading.trim() }); } });

    const strip = document.createElement('div');
    strip.className = 'cd-watch';
    strip.innerHTML = `
      <div class="cd-watch-label">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>
        Watch — ${esc(heading.trim().toLowerCase())}
        <span class="cd-watch-count">${list.length} video${list.length === 1 ? '' : 's'}</span>
      </div>
      <div class="cd-watch-row">${list.map(v => cardHTML(v)).join('')}</div>`;
    sec.appendChild(strip);
  });

  // The bottom "Videos" section becomes an index of everything above.
  let videosSec = document.getElementById('videos');
  if (!videosSec) {
    videosSec = document.createElement('section');
    videosSec.id = 'videos';
    videosSec.className = 'cd-sec';
    videosSec.innerHTML = `
      <h2 class="cd-h2">Videos</h2>
      <p class="cd-lead">Every video linked from the sections above, in reading order. Background
        viewing only — nothing here has been tested against DSE data unless the section it came
        from says so.</p>
      <div class="cd-video-grid"></div>`;
    main.appendChild(videosSec);
    const toc = document.querySelector('.cd-toc');
    if (toc && !toc.querySelector('a[href="#videos"]')) {
      const a = document.createElement('a');
      a.href = '#videos';
      a.textContent = 'Videos';
      toc.appendChild(a);
    }
  }
  const grid = videosSec.querySelector('.cd-video-grid');
  if (grid) {
    grid.innerHTML = all.length
      ? all.map(v => cardHTML(v, v.tag)).join('')
      : '<div class="cd-callout">No videos added yet.</div>';
  }

  // ── in-page player (same modal as topic.html; CSS lives in learning.css) ──
  const YT_PLAYBACK_RATE = 2;    // matches topic.html's convention
  let ytPlayer = null, ytPlayerReady = false, ytPendingId = null;

  function injectModal() {
    if (document.getElementById('yt-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'yt-overlay';
    overlay.id = 'yt-overlay';
    overlay.addEventListener('click', closePlayer);
    document.body.appendChild(overlay);

    const modal = document.createElement('div');
    modal.className = 'yt-modal';
    modal.id = 'yt-modal';
    modal.innerHTML = `
      <div class="yt-modal-header">
        <div class="yt-modal-title-wrap">
          <span class="yt-modal-yt-badge">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.7 15.5V8.5l6.3 3.5-6.3 3.5z"/></svg>
            YouTube
          </span>
          <div class="yt-modal-label" id="yt-modal-label">Video</div>
        </div>
        <div class="yt-modal-header-actions">
          <span class="yt-speed-badge">2× speed</span>
          <a class="yt-ext-link" id="yt-ext-link" href="#" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Open in YouTube
          </a>
          <button class="yt-close-btn" id="yt-close-btn" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      <div class="yt-player-wrap" id="yt-player-wrap"><div id="yt-iframe"></div></div>
      <div class="yt-modal-footer">
        <div class="yt-modal-url" id="yt-modal-url"></div>
        <div class="yt-modal-hint">Press <kbd style="font-family:var(--mono);font-size:9px;background:var(--bg-base);border:1px solid var(--border);border-radius:3px;padding:1px 5px">Esc</kbd> to close · playback auto-set to 2×</div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('yt-close-btn').addEventListener('click', closePlayer);
    document.getElementById('yt-ext-link').addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePlayer(); });
    loadApi();
  }

  function loadApi() {
    if (window.YT && window.YT.Player) { onApiReady(); return; }
    if (document.getElementById('yt-api-script')) return;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      if (typeof prev === 'function') { try { prev(); } catch (_) {} }
      onApiReady();
    };
    const s = document.createElement('script');
    s.id  = 'yt-api-script';
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  }

  function onApiReady() {
    if (ytPlayer) return;
    ytPlayer = new YT.Player('yt-iframe', {
      events: {
        onReady: e => {
          ytPlayerReady = true;
          document.getElementById('yt-player-wrap').classList.add('loaded');
          if (ytPendingId) { e.target.loadVideoById(ytPendingId); ytPendingId = null; }
        },
        onStateChange: e => { if (e.data === 1) e.target.setPlaybackRate(YT_PLAYBACK_RATE); },
      },
    });
  }

  function openPlayer(id, label) {
    injectModal();
    document.getElementById('yt-player-wrap').classList.remove('loaded');
    document.getElementById('yt-modal-label').textContent = label || 'YouTube video';
    document.getElementById('yt-ext-link').href           = watchUrl(id);
    document.getElementById('yt-modal-url').textContent   = watchUrl(id);
    document.getElementById('yt-overlay').classList.add('open');
    document.getElementById('yt-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    if (ytPlayerReady && ytPlayer) ytPlayer.loadVideoById(id);
    else ytPendingId = id;
  }

  function closePlayer() {
    if (ytPlayer && ytPlayerReady) { try { ytPlayer.stopVideo(); } catch (_) {} }
    const o = document.getElementById('yt-overlay'), m = document.getElementById('yt-modal');
    if (o) o.classList.remove('open');
    if (m) m.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Plain left-click opens the in-page player; modified clicks and
  // middle-clicks fall through to the real YouTube link.
  main.addEventListener('click', e => {
    const card = e.target.closest('.cd-video-card[data-yt-id]');
    if (!card) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openPlayer(card.dataset.ytId, card.dataset.ytTitle);
  });
})();
