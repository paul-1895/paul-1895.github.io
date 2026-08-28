# DSE Banks — Quarterly Financial Dataset: Methodology

## Scope
36 DSE-listed banks (see `_coverage_matrix.json` for the full list). Target: ~15 years of
quarterly financial data (2011–2026), sourced independently per bank (no links were supplied
by the user — every source below was found and verified via web research).

## Reporting calendar convention (Bangladesh banks)
Bangladeshi banks do not file a standalone "Q4" report. Under BSEC/Bangladesh Bank practice
they publish:
- **Q1** unaudited financial statements (Jan–Mar)
- **Half-Yearly** unaudited/reviewed financial statements (Jan–Jun) — used as the Q2 data point
- **Q3** unaudited financial statements (Jul–Sep)
- **Annual Report** audited financial statements (Jan–Dec)

There is no separate Q4-only filing. This dataset handles Q4 as follows:
- **Q4 balance sheet** = the Dec-31 balance sheet published in the Annual Report. This is
  treated as a **reported** value for that date (it is the only — and correct — source
  document for a Dec-31 position), not an "annual backfill" of a missing quarter.
- **Q4 income-statement flow items** (interest income, net profit, etc.) = Annual figure minus
  the cumulative 9-month (Q1+Q2+Q3) figure. These are always marked
  `"basis": "calculated_annual_minus_9m"` and never presented as directly reported.
- Per the user's explicit instruction, quarters with **no underlying quarterly report at all**
  (i.e., years before a bank began publishing Q1/H1/Q3 statements) are left **unavailable** —
  they are not backfilled from annual data. Only Q4 uses the annual report, because Q4 *is*
  year-end and the annual report is its genuine primary source.

## Source priority (per spec)
1. Official bank website / investor relations
2. DSE (dsebd.org) — in practice only surfaces the *latest* filing per company, used for
   cross-verification of the most recent quarter, not historical archive
3. Bangladesh Bank / regulator
4. Other authoritative source
5. Secondary source (only when nothing above is available)

## Data model
Each bank has:
```
bank_financials/<TICKER>/
  sources.json          # every source document found: period, type, url, retrieval date, priority
  quarterly/<FY>_<Q>.json   # normalized line items for one reporting period
  ratios_timeseries.json    # calculated ratios across all periods
  coverage.json          # per-bank quarter-by-quarter availability status
```

Each line item in a `quarterly/*.json` file preserves:
```
original_metric_name, normalised_metric_name, value, unit, currency,
source_url, source_document, source_page, basis ("reported" | "calculated_annual_minus_9m")
```

## Normalized metric categories
`balance_sheet`, `income_statement`, `asset_quality`, `capital`, `liquidity`, `loan_composition`,
`deposit_composition` — see `_metric_dictionary.json` for the original→normalized mapping as it
grows (mappings are added only after being observed in an actual source document, never assumed).

## Calculated ratio formulas (documented once, applied everywhere)
- Loan-to-Deposit Ratio = Gross Loans / Customer Deposits
- NPL Ratio = Non-Performing Loans / Gross Loans
- Provision Coverage Ratio = Loan-Loss Allowance / Non-Performing Loans
- Credit Cost = Provision Expense (annualized) / Average Gross Loans
- NIM = Net Interest Income (annualized) / Average Earning Assets
- ROA = Net Profit (annualized) / Average Total Assets
- ROE = Net Profit (annualized) / Average Total Equity
- Cost-to-Income = Operating Expense / Total Operating Income
- CET1 / Tier 1 / Capital Adequacy Ratio = as reported (Basel III disclosures); RWA growth = QoQ/YoY % change in Risk-Weighted Assets
- YoY growth (loans/deposits/assets/equity) = (Value_t − Value_t-4q) / Value_t-4q, preferred over QoQ to avoid seasonal distortion

"Annualized" for a single quarter's flow figure = value × 4 (simple annualization), documented
per calculated value so it is never confused with a reported annual figure.

## Data-quality checks applied
- Total Assets ≈ Total Liabilities + Equity (flagged, not silently corrected, if a mismatch >1% appears)
- Duplicate reporting-period detection
- Sign-consistency checks on provisions/impairments
- Any restatement between an original filing and a later comparative figure is recorded, not overwritten

## PDF handling
PDFs are downloaded to a scratch location, text/tables extracted into `quarterly/*.json` and
retained source text, then the PDF itself is deleted per the project's cleanup requirement.
Only structured data, source URLs/metadata, and provenance are kept long-term.
