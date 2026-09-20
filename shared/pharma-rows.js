/* ================================================================
   pharma-rows.js — the metric rows of the pharma details grid.

   Shared, not duplicated: the editor (pharma-details/pharma-details.js)
   writes cells keyed by `key`, and any future reader (e.g. a candlestick
   sidebar panel) reads them back by the same key to find a label. Two
   copies of this table would drift the moment a metric is added.

   Loaded as a classic script, so it publishes onto window rather than
   exporting. Mirrors shared/cement-rows.js's shape but swaps
   manufacturing-capacity metrics (production capacity, sales volume)
   for the ones that actually distinguish Pharmaceuticals & Chemicals
   companies (manufacturing units, export revenue) — this DSE sector
   spans drug makers, agrochemicals and consumer-products businesses,
   several of which report meaningful export earnings.
   ================================================================ */
'use strict';

window.PHARMA_ROWS = [
  { key: 'paid_up_capital',      label: 'Paid Up Capital',              unit: '',   hint: 'integer'    },
  { key: 'auth_capital',         label: 'Authorised Capital',           unit: '',   hint: 'integer'    },
  { key: 'employees',            label: 'No. of Employees',             unit: '',   hint: 'integer'    },
  { key: 'manufacturing_units',  label: 'No. of Manufacturing Units',   unit: '',   hint: 'integer'    },
  { key: 'export_revenue',       label: 'Export Revenue',               unit: '',   hint: 'integer'    },
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
