# Frontend wiring of the phase-2 backend endpoints

All screens are bilingual (Arabic RTL default / English). New cross-cutting
code lives in a `platform` area: `src/services/platform.service.ts`,
`src/components/platform/*`, `src/components/layout/nav/platform.ts`,
`src/i18n/messages/{ar,en}/platform.json` (namespaces `platform`, `appr`, `imp`, `alerts`).

## Finance
- Journal entries: journal dropdown from `GET /accounting/journals` (no more guessing / typing ids),
  currency selector with the rate suggested from `GET /accounting/exchange-rates`, cost center per line.
- `/accounting/cost-centers` (GET/POST/PATCH, parent tree guard), `/accounting/currencies`
  (currencies + rates history, `POST /accounting/exchange-rates`).
- Payments / vouchers / transfers prefill the exchange rate (latest rate on or before the date).
- Payment allocation uses `GET /payments/open-documents` (refunds can be allocated to credit notes / supplier refunds).
- Branch editing (`PATCH /branches/:id`, only changed fields). Accounting settings send `null` for cleared accounts.
- Report center: cost center filter (trial balance, GL, account statement, P&L by branch), PDF button next to
  Excel (`?format=pdf&lang=`), partner statement print.
- Accounting depth pages: recurring entries, deferrals, FX revaluation (preview / post / reverse),
  opening balances (accounts + partners), period closing (checklist, lock, reopen, history).

## Operations
- POS: the terminal's open session is found with `GET /pos/sessions?terminalId&status=open` and resumed;
  sessions history with X/Z report, orders, cash moves; `/pos/orders` search (number / reference, dates,
  sales / refunds, customer, server paging) with partial refunds (into any open session), e-receipt
  submission and 80mm receipts; `/pos/orders/:id` detail.
- Categories / units editing, warehouse PATCH sends only changed fields, stock movements date filters and
  limit/offset paging. Landed costs page (`/purchasing/landed-costs`: PO multi-select, charges with accounts,
  split preview, post, cancel).

## People
- Payroll pay, loan disbursement and final settlement payment take an optional cash box / bank
  (`treasuryId`, list from `GET /treasury/treasuries?usableOnly=true`); API errors (insufficient balance,
  not custodian) are shown as is.
- New pages: leave encashments, overtime requests (approve / reject), EOS provisions (run, reverse, GL accounts),
  final settlements (create, post, pay, cancel); payroll bank file (generic / WPS CSV); employee cost center;
  leave type accrual / carry-forward / half-day / encashable fields; half-day leave requests;
  self-service `/hr/me` (payslips, balances, leave requests, loans, overtime).

## Printing, approvals, import, alerts
- Print / PDF buttons (blob URL opened in a new tab with the auth header): sales invoices, quotations /
  orders / delivery notes, purchase orders, treasury vouchers, payments, POS receipts (80mm / A4),
  payslips and payroll register, customer / supplier statements, issued cheques, every report.
- Approvals: rules with levels (`/approvals/rules`), inbox / my requests / all (`/approvals/requests`),
  request detail with approve / reject / comment / withdraw. A 409 with `error.approvalRequestId` shows a toast
  linking to the request (axios interceptor + `ApprovalListener`).
- Data import wizard (`/settings/import`: entity, template ar/en, upload, validation report, commit, error file,
  history) and Export / import menus on products, customers, suppliers, accounts and employees.
- Alert rules admin (`/settings/alerts`: types, defaults, recipients, params, scan now / dry run) and deliveries;
  header notifications bell with the unread count (`GET /notifications/my/unread-count`, polled every minute).

## Still missing / backend follow-ups
- Multipart booleans in `POST /data-import/:entity/validate` are parsed after implicit conversion, so
  `"false"` becomes `true` (`updateExisting=false` cannot be sent); the UI only sends true flags.
- `GET /pos/orders` cannot filter by `refundedOrderId` and `GET /pos/orders/:id` does not return the session /
  terminal: the order page loads refunds (limit 500) and sessions to show them.
- Self-service has no PDF payslip (the print endpoint needs HR payroll read); `/hr/me/payslips/:runId` is shown on screen.
- Create customer requires `phone`; create supplier requires `phone`, `address`, `city`, `country`.
