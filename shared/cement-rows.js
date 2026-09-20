/* ================================================================
   cement-rows.js — the metric rows of the cement details grid.

   Shared, not duplicated: the editor (cement-details/cement-details.js)
   writes cells keyed by `key`, and any future reader (e.g. a candlestick
   sidebar panel) reads them back by the same key to find a label. Two
   copies of this table would drift the moment a metric is added.

   Loaded as a classic script, so it publishes onto window rather than
   exporting. Mirrors shared/bank-rows.js's shape but swaps banking
   operational metrics (branches, ATMs, NPL, deposits) for manufacturing
   ones (production capacity, capacity utilization, sales volume).
   ================================================================ */
'use strict';

window.CEMENT_ROWS = [
  { key: 'paid_up_capital',      label: 'Paid Up Capital',              unit: '',   hint: 'integer'    },
  { key: 'auth_capital',         label: 'Authorised Capital',           unit: '',   hint: 'integer'    },
  { key: 'employees',            label: 'No. of Employees',             unit: '',   hint: 'integer'    },
  { key: 'plants',               label: 'No. of Plants/Factories',      unit: '',   hint: 'integer'    },
  { key: 'installed_capacity',   label: 'Installed Production Capacity', unit: 'MT', hint: 'integer'   },
  { key: 'capacity_utilization', label: 'Capacity Utilization',         unit: '%',  hint: 'percentage' },
  { key: 'sales_volume',         label: 'Sales Volume',                 unit: 'MT', hint: 'integer'    },
  { key: 'revenue',              label: 'Revenue / Turnover',           unit: '',   hint: 'integer'    },
  { key: 'gross_profit',         label: 'Gross Profit',                 unit: '',   hint: 'integer'    },
  { key: 'operating_profit',     label: 'Operating Profit',             unit: '',   hint: 'integer'    },
  { key: 'profit',               label: 'Net Profit After Tax',         unit: '',   hint: 'integer'    },
  { key: 'eps',                  label: 'Yearly EPS',                   unit: '',   hint: 'float'      },
  { key: 'nav',                  label: 'Net Asset Value Per Share',    unit: '',   hint: 'float'      },
  { key: 'nocfps',               label: 'Yearly NOCFPS',                unit: '',   hint: 'float'      },
  { key: 'roe',                  label: 'ROE',                          unit: '%',  hint: 'percentage' },
  { key: 'roa',                  label: 'ROA',                          unit: '%',  hint: 'percentage' },
  { key: 'pe',                   label: 'P/E',                          unit: '',   hint: 'float'      },
  { key: 'dividend',             label: 'Dividend',                     unit: '%',  hint: 'percentage' },
  { key: 'lt_rating',            label: 'Long Term Credit Rating',      unit: '',   hint: 'text'       },
  { key: 'st_rating',            label: 'Short Term Credit Rating',     unit: '',   hint: 'text'       },
];
