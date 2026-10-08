# Reports and accounting setup

## Accounting setup wizard

- `GET /accounting/setup/templates`, `GET /accounting/setup/templates/:code` (preview)
- `POST /accounting/setup { template: 'eg' | 'sa', fiscalYearStart, baseCurrency? }`
  (permission `accounting/setup/create`); refused (409) when the tenant already has accounts.

It creates a bilingual (Arabic/English) chart of accounts numbered
`1 → 11 → 1101 → 110101`, where only the 6-digit leaves allow posting:

- **eg** – the 1..5 layout used by Egyptian SME software (not the public-sector unified system).
- **sa** – SOCPA style: class 5 cost of revenue, class 6 operating expenses, with zakat, GOSI and
  end-of-service accounts.

It then fills every accounting-settings default account key, opens the fiscal year, creates the
default journals and ensures EGP, SAR, USD, EUR and AED exist (the base currency and template are
stored in `tenants.settings`). The seed runs it for the default tenant: `SEED_CHART=eg|sa|none`
(default `eg`), optional `SEED_FISCAL_YEAR_START`.

## Reports

All accept `?format=xlsx` (Excel download) and `?lang=ar|en` (Arabic default, right-to-left);
permission module `reports`.

| Report | Endpoint | Notes |
|---|---|---|
| Trial balance | `/reports/trial-balance` | Opening / period / closing columns, hierarchy, branch and cost-center filters |
| General ledger | `/reports/general-ledger` | Opening and running balance, source document per line |
| Account statement | `/reports/account-statement` | Includes sub-accounts |
| P&L, balance sheet | `/reports/profit-loss`, `/reports/balance-sheet` | Now exportable |
| Cash flow | `/reports/cash-flow` | Indirect method; reconciles to the cash accounts |
| Cost center / branch P&L | `/reports/cost-center-pnl`, `/reports/branch-pnl` | Branch = line branch or source document branch |
| Partner statement | `/reports/partner-statement` | Invoices, credit notes, payments with allocations; document currency |
| Aged balances | `/reports/aged-receivables`, `/reports/aged-payables` | |
| VAT return | `/reports/vat-return` | Egyptian boxes / ZATCA boxes 1-16; invoices and POS vs bills; GL reconciliation |
| Sales analysis | `/reports/sales-analysis` | By product, customer, category, branch, creator, month, day, invoice; gross profit from stock-move cost |
| Purchase analysis | `/reports/purchase-analysis` | By supplier, product, category, branch, month, invoice |
| Daily summary | `/reports/daily-summary` | Per day and user: invoices, POS cash/card, receipts, payments |
| Budget vs actual | `/reports/budget-vs-actual` | `fiscalYearId` must be a UUID |
| Dashboard | `/reports/dashboard` | Adds receivables/payables with overdue, cash and bank, top products, low-stock count |

No posting rules or schema changes were added.

## Still missing

- PDF export.
- Multi-currency partner statements (shown in document currency).
- VAT categories beyond the rate (exports, exempt, imports, reverse charge) are reported as 0.
- Submitting returns to ETA/ZATCA, comparative periods, merging a template into an existing chart.

## Phase 2

- Sales analysis `groupBy=salesperson` groups by the document's sales
  representative (`sales_invoices.sales_rep_id`, `pos_orders.sales_rep_id`),
  falling back to the user who created the document (keys `rep:<id>` /
  `user:<id>`).
- Sales and purchase analysis quantities are in base units
  (`quantity x unit_factor`), so documents in alternate units add up correctly.
- Commission vs sales per rep: `GET /sales/commission-statements/rep-performance`
  (see `docs/gaps/sales-purchasing.md`).
