/* ================================================================
   fi-rows.js — the metric rows of the Financial Institutions (NBFI)
   details grid.

   Shared, not duplicated: the editor (fi-details/fi-details.js) writes
   cells keyed by `key`, and any future reader (e.g. a candlestick
   sidebar panel) reads them back by the same key to find a label. Two
   copies of this table would drift the moment a metric is added, and
   the reader would silently render rows it had no name for.

   Loaded as a classic script on the fi-details page, so it publishes
   onto window rather than exporting.
   ================================================================ */
'use strict';

window.FI_ROWS = [
  { key: 'branches',            label: 'No. of Branches',                    unit: '',  hint: 'integer'    },
  { key: 'employees',           label: 'No. of Employees',                   unit: '',  hint: 'integer'    },
  { key: 'paid_up_capital',     label: 'Paid Up Capital',                    unit: '',  hint: 'integer'    },
  { key: 'auth_capital',        label: 'Authorised Capital',                 unit: '',  hint: 'integer'    },
  { key: 'total_loans_leases',  label: 'Total Loans, Leases & Advances',     unit: '',  hint: 'integer'    },
  { key: 'total_deposits',      label: 'Total Term Deposits',                unit: '',  hint: 'integer'    },
  { key: 'disbursement',        label: 'Yearly Disbursement',                unit: '',  hint: 'integer'    },
  { key: 'classified_loans',    label: 'Classified Loans (NPL)',             unit: '%', hint: 'percentage' },
  { key: 'car',                 label: 'Capital Adequacy Ratio (CAR)',       unit: '%', hint: 'percentage' },
  { key: 'net_interest_income', label: 'Net Interest Income',                unit: '',  hint: 'integer'    },
  { key: 'investment_income',   label: 'Investment Income',                  unit: '',  hint: 'integer'    },
  { key: 'roa',                 label: 'ROA',                                unit: '%', hint: 'percentage' },
  { key: 'roe',                 label: 'ROE',                                unit: '%', hint: 'percentage' },
  { key: 'pe',                  label: 'P/E',                                unit: '',  hint: 'float'      },
  { key: 'eps',                 label: 'Yearly EPS',                         unit: '',  hint: 'float'      },
  { key: 'nav',                 label: 'Net Asset Value (NAV) Per Share',    unit: '',  hint: 'float'      },
  { key: 'nocfps',              label: 'Yearly NOCFPS',                      unit: '',  hint: 'float'      },
  { key: 'profit',              label: 'Yearly Net Profit',                  unit: '',  hint: 'integer'    },
  { key: 'dividend',            label: 'Dividend',                           unit: '%', hint: 'percentage' },
  { key: 'lt_rating',           label: 'Long Term Credit Rating',            unit: '',  hint: 'text'       },
  { key: 'st_rating',           label: 'Short Term Credit Rating',           unit: '',  hint: 'text'       },
  { key: 'customers',           label: 'No. of Clients',                     unit: '',  hint: 'integer'    },
];
