# erp-insta: coverage vs Egyptian / Saudi SME ERPs

This page compares erp-insta with the feature set of the ERPs it competes with in Egypt and Saudi
Arabia (4S Plus, Hadara Soft, Al-Ameen Soft, SMACC). Their websites could not be fetched from
the build environment, so the reference list is the feature set these products and their market
commonly advertise:

- accounts, treasuries and cheques
- inventory, sales, purchasing and POS
- payroll
- manufacturing
- ETA and ZATCA e-invoicing
- Arabic printing and reports

Details per area, including endpoints, posting rules and the full "Still missing" lists, are in
[`docs/gaps/`](gaps/). The Odoo comparison that started this work is in
[`ODOO_GAP_ANALYSIS.md`](ODOO_GAP_ANALYSIS.md).

Legend: ✅ available · 🟡 partial · ❌ not available.

## Platform

| Capability | Status | Notes |
|---|---|---|
| Multi-company (tenants), branches, cost centers | ✅ | Tenants are isolated. Users only see their own tenant; tenant provisioning is a platform-operator action. |
| Users, roles, permission matrix, branch-limited roles | ✅ | `/users`, `/roles`, and a permission catalogue built from the API itself. |
| 2FA, session revocation, audit trail | ✅ | Every successful change is audited with passwords removed. |
| One database transaction per request | ✅ | A failure rolls back stock, balances and the ledger together. Domain events are sent after commit. |
| Approval workflows (multi-level, amount bands) | ✅ | Covers purchase orders, vendor bills, outbound payments and payment vouchers. |
| Excel/CSV import and export of master data and opening balances | ✅ | The file is validated first, then committed all-or-nothing. |
| Scheduled alerts and in-app notifications | ✅ | 12 alert types. Email is not wired yet. |
| Arabic/English UI (RTL) for every module | ✅ | All menu screens pass a browser check in both languages. |
| Bilingual PDF printing with Arabic shaping | ✅ | Invoices, quotations, delivery notes, purchase orders, vouchers, POS receipts, payslips, statements, cheques, and reports. |
| Offline-capable POS | 🟡 | Sales queue offline and are resent safely. Product data is not cached offline. |

## Accounting and finance

| Capability | Status | Notes |
|---|---|---|
| Egyptian and Saudi chart-of-accounts templates and setup wizard | ✅ | A fresh install posts automatically from day one. |
| Automatic posting from every document | ✅ | Invoices, bills, payments, stock, POS, payroll, assets, cheques. |
| Multi-currency postings, realised and unrealised FX | ✅ | Revaluation auto-reverses. Exchange rates are kept per company. |
| Fiscal years, lock dates, period closing checklist | ✅ | |
| Recurring entries, deferred revenue/expenses | ✅ | |
| Opening balances (accounts, customers, suppliers, stock) | ✅ | |
| Fixed assets with depreciation and disposal | ✅ | |
| Budgets vs actual | ✅ | |
| Treasuries (cash boxes, banks), vouchers, transfers | ✅ | Custodians are enforced; cash boxes cannot go negative. |
| Cheques received and issued (أوراق القبض والدفع) | ✅ | Full lifecycle, due calendar, FX at collection, printing. |
| Bank reconciliation (CSV, MT940) | ✅ | OFX is not supported. |
| Withholding tax on invoices and payments | ✅ | |
| Reports: trial balance, ledger, statements, P&L, balance sheet, cash flow, aged balances, VAT return, sales and purchase analysis | ✅ | Excel and PDF export. Comparative periods are missing. |

## Operations

| Capability | Status | Notes |
|---|---|---|
| Products, alternate units, barcodes, price lists, minimum price | ✅ | |
| Warehouses, transfers, stock counts, negative-stock policy per warehouse | ✅ | |
| Lots, serials and expiry (FEFO), traceability | ✅ | |
| Average-cost valuation | 🟡 | Average cost is per product. Per-warehouse cost, FIFO and landed costs are missing. |
| Sales: quotations, orders, deliveries, invoices, credit notes, returns | ✅ | |
| Sales reps and commissions; instalment sales | ✅ | |
| Purchasing: requisitions, RFQ/PO with approval, receipts, bills, returns, replenishment | ✅ | |
| POS: sessions, cash control, barcode, discounts limit, partial refunds | ✅ | Restaurant features (tables, kitchen screen) are missing. |
| Manufacturing: multi-level BOMs, production orders, costing, MRP to requisitions, un-build | ✅ | Routings and work centers are missing. |
| CRM: pipeline, activities, convert to customer/quotation | ✅ | |

## HR and payroll

| Capability | Status | Notes |
|---|---|---|
| Employees, departments, attendance, leaves (accrual, carry-forward, half day) | ✅ | |
| Payroll: Egyptian social insurance and Law 7/2024 tax (year-to-date), Saudi GOSI | ✅ | Rates are configurable per tenant. |
| Loans and advances, overtime requests, encashment | ✅ | |
| End-of-service provision and final settlement | ✅ | |
| Bank salary files (generic, WPS/Mudad-style CSV) | 🟡 | Bank-specific fixed-width layouts are missing. |
| Employee self-service | ✅ | |
| Official filings (Form 2/6, Form 4, GOSI uploads) | ❌ | |

## Tax compliance

| Capability | Status | Notes |
|---|---|---|
| ETA e-invoice (Egypt): build, sign via external signer, submit, status, cancel | ✅ | Only tested against a mock, because the real API is not reachable from CI. |
| ETA e-receipt (POS) | ✅ | |
| ZATCA phase 1 QR and phase 2 (UBL XML, hash, signing, reporting/clearance) | 🟡 | Validate a sample with the ZATCA SDK before going live. There is no in-app onboarding (CSR/CSID). |
| Automatic submission after posting | ✅ | Opt-in per tenant. |

## Known open items (highest value first)

1. **Database migrations.** The schema is still created by TypeORM `synchronize` in the seed script. Generate migrations before production.
2. **Real-environment checks.** Run ETA/ZATCA preprod validation and the ZATCA SDK hash check.
3. **Inventory valuation.** Per-warehouse average cost, FIFO and landed costs are missing.
4. **Restaurant POS and offline catalogue.** Tables, kitchen screen, and a product cache for offline selling.
5. **Email/SMS notification channels and approver notifications.**
6. **Official HR filings and bank-specific salary files.**
7. **Comparative-period reports and report letterheads.**
