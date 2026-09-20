/* ================================================================
   telecom-rows.js — the metric rows of the telecom details grid.

   Shared, not duplicated: the editor (telecom-details/telecom-details.js)
   writes cells keyed by `key`, and any future reader (e.g. a candlestick
   sidebar panel) reads them back by the same key to find a label. Two
   copies of this table would drift the moment a metric is added.

   Loaded as a classic script, so it publishes onto window rather than
   exporting. Mirrors shared/cement-rows.js's shape but swaps manufacturing
   operational metrics (production capacity, sales volume) for mobile/
   telecom-operator ones (subscribers, ARPU, network sites, data users).
   ================================================================ */
'use strict';

window.TELECOM_ROWS = [
  { key: 'paid_up_capital',   label: 'Paid Up Capital',              unit: '',        hint: 'integer'    },
  { key: 'auth_capital',      label: 'Authorised Capital',           unit: '',        hint: 'integer'    },
  { key: 'employees',         label: 'No. of Employees',             unit: '',        hint: 'integer'    },
  { key: 'subscribers',       label: 'Total Subscribers',            unit: 'mn',      hint: 'float'      },
  { key: 'market_share',      label: 'Subscriber Market Share',      unit: '%',       hint: 'percentage' },
  { key: 'network_sites',     label: 'No. of Network Sites',         unit: '',        hint: 'integer'    },
  { key: 'data_subscribers',  label: 'Internet/Data Subscribers',    unit: 'mn',      hint: 'float'      },
  { key: 'arpu',              label: 'ARPU',                         unit: 'Tk/mo',   hint: 'float'      },
  { key: 'capex',             label: 'Capital Expenditure',          unit: '',        hint: 'integer'    },
  { key: 'revenue',           label: 'Revenue / Turnover',           unit: '',        hint: 'integer'    },
  { key: 'ebitda',            label: 'EBITDA',                       unit: '',        hint: 'integer'    },
  { key: 'ebitda_margin',     label: 'EBITDA Margin',                unit: '%',       hint: 'percentage' },
  { key: 'operating_profit',  label: 'Operating Profit',             unit: '',        hint: 'integer'    },
  { key: 'profit',            label: 'Net Profit After Tax',         unit: '',        hint: 'integer'    },
  { key: 'eps',               label: 'Yearly EPS',                   unit: '',        hint: 'float'      },
  { key: 'nav',               label: 'Net Asset Value Per Share',    unit: '',        hint: 'float'      },
  { key: 'nocfps',            label: 'Yearly NOCFPS',                unit: '',        hint: 'float'      },
  { key: 'roe',               label: 'ROE',                          unit: '%',       hint: 'percentage' },
  { key: 'roa',               label: 'ROA',                          unit: '%',       hint: 'percentage' },
  { key: 'pe',                label: 'P/E',                          unit: '',        hint: 'float'      },
  { key: 'dividend',          label: 'Dividend',                     unit: '%',       hint: 'percentage' },
  { key: 'lt_rating',         label: 'Long Term Credit Rating',      unit: '',        hint: 'text'       },
  { key: 'st_rating',         label: 'Short Term Credit Rating',     unit: '',        hint: 'text'       },
];
