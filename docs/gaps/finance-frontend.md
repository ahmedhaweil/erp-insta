# Finance frontend (administration, accounting, treasury, payments, reports, dashboard)

Bilingual (Arabic RTL default / English) screens in `erp-frontend` for the phase-1/2 finance backend.

## Built
- **Settings** (`/settings/...`): users (create, edit, activate/deactivate, roles per branch, reset password),
  roles with a permission matrix (module / screen / action, allow / deny) driven by `GET /roles/permissions/catalog`,
  audit log viewer (user, module, record, dates) with request-data detail, my profile (change password, 2FA
  enrolment showing the secret and otpauth link - no QR library is installed), company info (`/tenants/current`,
  `PATCH /tenants/:id`), branches.
- **Accounting**: setup wizard (`/accounting/setup`, eg/sa template with tree preview, fiscal year start, base
  currency; the dashboard shows a call to action when the tenant has no accounts), accounting settings (every
  default account as a searchable account picker + lock date), fiscal years (create, close), fixed assets
  (create, depreciation schedule, depreciation run, dispose/sell), budgets, journal entries (balanced entry editor
  with account picker, save draft / save and post, post, reverse, cancel, manual/automatic filter, foreign
  currency rate and amount-in-currency display).
- **Treasury** (`/treasury/...`): cash boxes / banks with balances and cash book, receipt / payment vouchers
  (multi-line), transfers (cross-currency rate, fee), cheques list + monthly due calendar + lifecycle actions
  (deposit, collect, endorse, return, bounce, clear, cancel) with history, bank statements import (CSV paste or
  upload), statement lines with auto-match, manual match against unreconciled book lines, voucher from a line,
  reconciliation report, mark reconciled / reopen.
- **Payments** (`/treasury/payments`): customer receipts and supplier payments with treasury, cheque details or
  endorsement of a portfolio cheque, withholding tax, exchange rate (foreign treasuries), refunds, allocation to
  open invoices (oldest first or manual) and later allocation, cancel.
- **Reports** (`/reports`, `/reports/<key>`): report center with filters and Excel download (`?format=xlsx&lang=`)
  for trial balance (hierarchy toggle), general ledger, account statement, P&L, balance sheet, cash flow, cost
  center / branch P&L, budget vs actual, partner statement, aged AR/AP, VAT return, sales / purchase analysis,
  daily summary.
- **Dashboard**: revenue/expenses/profit, receivables and payables with aging, cash and bank balances, top
  products, low-stock alert, recent orders.

## Still missing (needs backend endpoints)
- `GET /accounting/journals` (the JE form derives journals from existing entries), `GET /currencies`,
  `GET /cost-centers` (no cost center filter / picker), `PATCH /branches/:id`, `GET /inventory/...` low-stock list
  on the dashboard (only a count is returned).
- Clearing a default account in accounting settings is not possible (the PUT ignores empty values).
- QR rendering for 2FA (no QR library installed).
