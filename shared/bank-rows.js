/* ================================================================
   bank-rows.js — the metric rows of the bank details grid.

   Shared, not duplicated: the editor (bank-details/bank-details.js)
   writes cells keyed by `key`, and the candlestick sidebar reads them
   back by the same key to find a label. Two copies of this table would
   drift the moment a metric is added, and the reader would silently
   render rows it had no name for.

   Loaded as a classic script on both pages, so it publishes onto
   window rather than exporting.
   ================================================================ */
'use strict';

window.BANK_ROWS = [
  { key: 'branches',        label: 'No. of Branches',          unit: '',    hint: 'integer'     },
  { key: 'sub_branches',    label: 'No. of Sub-Branches',      unit: '',    hint: 'integer'     },
  { key: 'atms',            label: 'No. of ATMs',              unit: '',    hint: 'integer'     },
  { key: 'debit_cards',     label: 'No. of Debit Cards',       unit: '',    hint: 'integer'     },
  { key: 'credit_cards',    label: 'No. of Credit Cards',      unit: '',    hint: 'integer'     },
  { key: 'agents',          label: 'No. of Agents',            unit: '',    hint: 'integer'     },
  { key: 'npl',             label: 'Non Performing Loan',      unit: '%',   hint: 'percentage'  },
  { key: 'employees',       label: 'No. of Employees',         unit: '',    hint: 'integer'     },
  { key: 'total_deposit',   label: 'Total Deposit',            unit: '',    hint: 'integer'     },
  { key: 'paid_up_capital', label: 'Paid Up Capital',          unit: '',    hint: 'integer'     },
  { key: 'auth_capital',    label: 'Authorised Capital',       unit: '',    hint: 'integer'     },
  { key: 'casa_ratio',      label: 'CASA Ratio',               unit: '',    hint: 'float'       },
  { key: 'roa',             label: 'ROA',                      unit: '%',   hint: 'percentage'  },
  { key: 'roe',             label: 'ROE',                      unit: '%',   hint: 'percentage'  },
  { key: 'pe',              label: 'P/E',                      unit: '',    hint: 'float'       },
  { key: 'eps',             label: 'Yearly EPS',               unit: '',    hint: 'float'       },
  { key: 'nocfps',          label: 'Yearly NOCFPS',            unit: '',    hint: 'float'       },
  { key: 'profit',          label: 'Yearly Profit',            unit: '',    hint: 'integer'     },
  { key: 'lt_rating',       label: 'Long Term Credit Rating',  unit: '',    hint: 'text'        },
  { key: 'st_rating',       label: 'Short Term Credit Rating', unit: '',    hint: 'text'        },
  { key: 'app_rating',      label: 'Android App Rating',       unit: '',    hint: 'float'       },
  { key: 'app_downloads',   label: 'Android App Downloads',    unit: '',    hint: 'text'        },
  { key: 'fd_rate',         label: 'FD Interest Rate',         unit: '%',   hint: 'percentage'  },
  { key: 'customers',       label: 'No. of Customers',         unit: '',    hint: 'integer'     },
  { key: 'remittance',      label: 'Remittance Collection',    unit: 'USD', hint: 'integer'     },
];
