# erp-insta vs Odoo: business-logic gap analysis

This document records the comparison of erp-insta's backend business logic with
Odoo's standard flows (Accounting/Invoicing, Sales, Purchase, Inventory, Point of
Sale), what was implemented to close the gaps, and what remains.

> Odoo reference: the standard Community/Enterprise business flows as they exist
> in recent releases (17 → 19). Features specific to a newer release were not
> verified against its source code.

## 1. Summary

| Area | Odoo behaviour | erp-insta before | erp-insta now |
|---|---|---|---|
| Document totals | Computed server-side from lines | Trusted client `lineTotal` / PO totals | Recomputed server-side; client totals ignored; discounts/tax validated |
| Numbering | `ir.sequence`, gap-free per company | `count + 1` (duplicates under concurrency) | Atomic per-tenant `sequences` table |
| Security | Every route authenticated | **No auth guard registered**: tenant was undefined | Global JWT + RBAC guards; system roles are superusers |
| Journal posting | Period/lock-date checks, postable accounts | Only "an open fiscal year exists" | Date must be inside an open fiscal year and after the lock date; accounts must exist, be active and allow posting; one side per line |
| Automatic accounting | Invoices, payments, stock, POS create entries | None (GL never moved) | `AutoPostingService` posts every document; enabled per tenant via accounting settings |
| Reversal | Posted entries immutable; reverse instead | Reversal left as draft, could reverse twice | Reversal posted and linked; double reversal blocked; draft entries cancellable |
| Customer invoices | Draft → Posted → Paid; credit notes | Balance raised on draft; full payment only | Post (credit-limit check, journal entry, balance); partial payments; credit notes (full/partial) auto-reconciled; cancel with reversal |
| Vendor bills | Draft → Posted; bill control | No totals computed, no balance, no journal | Totals computed; posting to inventory/expense + input VAT + payable; duplicate vendor reference check; refunds; cancel |
| Payments | `account.payment`, reconciliation | None | Payments module: inbound/outbound, partial, FIFO auto-allocation, advances, refunds of credit notes, cancel/un-reconcile |
| Payment terms | Due date from terms | Manual due date | `paymentTermDays` on customers/suppliers drives due dates |
| Sales flow | Quotation → Sent → SO → Delivery → Invoice | Confirm/cancel only | Send, expiry (validity date), credit limit at confirmation, stock reservation, partial deliveries with COGS, invoice ordered or delivered quantities, safe cancellation |
| Purchase flow | RFQ → PO → Receipt → Bill | Confirm/cancel only | Send, partial receipts, AVCO cost update, bill on received quantities (goods) / ordered (services), safe cancellation |
| Replenishment | Min/max reordering rules | Low-stock notification only | Forecast (on hand − reserved + incoming) vs reorder level; draft RFQs per preferred vendor |
| Inventory valuation | AVCO/FIFO with valuation layers | Product cost never changed | AVCO on receipt; unit cost stored on moves; valuation report; adjustments post gain/loss |
| Reservations | Reserved quantities per move | `reservedQty` column unused | Reserve on SO confirm, consume on delivery, release on cancel; adjustments cannot go below reserved |
| Master data | Warehouses, categories, UoM, branches | No endpoints (frontend warehouses page called a missing route) | CRUD endpoints added |
| POS | Stock, accounting, cash control, refunds | User id = tenant id bug; no stock/accounting | Stock issued from terminal warehouse, sales/VAT/COGS postings, split payments, cash check, refunds with restock, closing cash count with expected cash and difference, terminal management |
| Fixed assets | Depreciation board, posting, disposal | Entity only | Straight-line and declining-then-linear schedules, idempotent monthly posting, disposal with gain/loss |
| Fiscal year closing | Lock dates / closing | None | Overlap validation; close posts P&L to retained earnings and locks the year |
| Reports | Aged balances, budgets | TB, P&L, BS (BS did not balance), GL | Aged receivables/payables; budget vs actual; BS includes current earnings; P&L excludes closing entries; accrual-based dashboard revenue |

## 2. Configuration needed for automatic accounting

Save the default accounts once per tenant (`PUT /accounting/settings`):
receivable, payable, sales, purchase (expense), inventory, COGS, stock
adjustment, output VAT, input VAT, cash, bank, retained earnings, depreciation
expense, accumulated depreciation, and asset disposal accounts, plus an optional
`lockDate`. Until settings exist, operational flows keep working without
journal entries. Once settings exist, a missing account fails the operation
**before** it changes anything (a pre-flight check), so the ledger never drifts
from the sub-ledgers.

## 3. New/changed API endpoints (prefix `/api/v1/v1`)

- Accounting: `GET|PUT /accounting/settings`, `GET|POST /accounting/fiscal-years`,
  `POST /accounting/fiscal-years/:id/close`, `GET|POST /accounting/fixed-assets`,
  `POST /accounting/fixed-assets/depreciate`, `GET /accounting/fixed-assets/:id/schedule`,
  `POST /accounting/fixed-assets/:id/dispose`, `GET|POST /accounting/budgets`,
  `POST /accounting/journal-entries/:id/cancel`
- Sales: `POST /sales/orders/:id/send|deliver|invoice`,
  `POST /sales/invoices/:id/post|cancel|credit-note`
- Purchasing: `POST /purchasing/orders/:id/send|receive|bill`,
  `POST /purchasing/invoices/:id/cancel|refund`,
  `GET /purchasing/replenishment`, `POST /purchasing/replenishment/generate`
- Payments: `GET|POST /payments`, `GET /payments/:id`, `POST /payments/:id/allocate|cancel`
- Inventory: `GET|POST /inventory/warehouses`, `PATCH /inventory/warehouses/:id`,
  `GET|POST /inventory/categories`, `GET|POST /inventory/units`,
  `GET /inventory/stock/movements`, `GET /inventory/stock/valuation`
- Branches: `GET|POST /branches`
- POS: `GET|POST /pos/terminals`, `POST /pos/orders/:id/refund`
- Reports: `GET /reports/aged-receivables`, `GET /reports/aged-payables`,
  `GET /reports/budget-vs-actual?fiscalYearId=`

## 4. Schema changes

New tables: `sequences`, `accounting_settings`, `payments`, `payment_allocations`.
New columns on orders/lines (delivered/invoiced/received/billed/reserved
quantities, warehouse, statuses), invoices (`move_type`, `reversed_invoice_id`,
`posted_at`, `supplier_reference`), partners (`payment_term_days`), products
(`preferred_supplier_id`, default tax rates), stock moves (`unit_cost`), journal
entries (`source_type`, `source_id`, `reversed_entry_id`), fixed assets,
POS terminals/sessions/orders.

The schema is now managed by migrations (`src/database/migrations`): start the
API with `DB_RUN_MIGRATIONS=true` (or run `npm run migration:run`) and seed with
`SEED_SYNC=false`. In development, `npm run seed:run` still synchronizes the
schema from the entities.

## 5. Remaining gaps (not implemented)

Odoo apps with no counterpart in erp-insta yet. Each is a module-sized effort:

- **CRM** (leads, pipeline, activities), **HR / Payroll / Attendance / Leaves**,
  **Manufacturing (MRP, BoM, work orders)**, **Project / Timesheets**,
  **Helpdesk**, **eCommerce / Website**, **Subscriptions**, **Rental**, **Fleet**.

Deeper accounting/inventory features still missing:

- Database transactions around multi-step operations (pre-flight checks narrow,
  but do not remove, the partial-failure window).
- Multi-currency: exchange-rate conversion of postings and unrealised FX
  revaluation (amounts are stored with a rate but posted in document currency).
- Bank statements and bank reconciliation; cheque management.
- Pricelists, discounts by customer group, promotions and loyalty.
- Lots/serial numbers, expiry dates, multi-step routes (pick/pack/ship),
  landed costs, FIFO valuation, customer/vendor returns that restock.
- Tax engine with tax groups, tax-included prices and withholding
  (rates are per line percentages).
- Recurring entries, deferred revenue and expenses, analytic distribution beyond
  cost-center tagging.
- Approval workflows (PO double validation, budget control).

## 6. Pre-existing issues noticed (not changed)

- The global prefix `api/v1` combined with URI versioning yields routes under
  `/api/v1/v1/...`, while the frontend's API base URL has no prefix.
- `TenantContextMiddleware` runs before authentication, so `req.user` is not yet
  set and the PostgreSQL RLS session variable is never applied; it also sets it
  on a separate connection.
- `POST /tenants` now requires authentication because all routes are guarded;
  mark it `@Public()` if self-service tenant sign-up is intended.
