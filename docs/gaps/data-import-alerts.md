# Data onboarding (import / export) and alerts

Phase 2 gap: SME ERPs in Egypt and Saudi Arabia (4S Plus, Hadara Soft, Al-Ameen Soft,
SMACC) all onboard customers from Excel sheets and send due-date / stock reminders.
erp-insta had no import, no export of master data, and only a low-stock notification.

## 1. Data import (`erp-backend/src/modules/data-import/`)

### What was built

- Bilingual `.xlsx` templates: a `Data` sheet whose headers read `English / العربية`
  (required columns marked `*` and highlighted) and an `Instructions` sheet listing
  every column with its type, allowed values (with Arabic aliases), notes and an example.
- Upload of `.xlsx` (exceljs) or `.csv` (`,` `;` or tab, UTF-8 with or without BOM).
  Headers are matched by the template text, the English label, the Arabic label or the
  machine key; unknown columns are reported as warnings and ignored. The header row is
  detected in the first 10 rows of the first sheet that has one.
- Value parsing: Arabic-Indic digits and separators, `1,500.25`, `(100)` negatives,
  yes/no/نعم/لا, dates `YYYY-MM-DD`, `DD/MM/YYYY` or Excel dates, enum values with Arabic
  aliases (e.g. type `مخزني` / `خدمة`). Up to 20,000 rows and 10 MB per file.
- Two-phase flow with a job record (`data_import_jobs`):
  1. `POST /data-import/:entity/validate` parses and validates every row against the
     file and the database and returns a report (row-level errors and warnings with a
     stable `code`, counts of rows to create / update / skip, a summary). Nothing is
     written except the job. Status `validated` or `invalid`.
  2. `POST /data-import/jobs/:id/commit` re-validates the stored rows against the
     current data, then writes all rows or none. The writes run in a savepoint of the
     request transaction: any failure rolls back every business row while the job keeps
     status `failed` and the error message (it can be committed again after fixing the
     cause). A committed job cannot be committed twice.
  3. `GET /data-import/jobs/:id/errors` downloads the rows having issues with their
     errors and warnings next to the original cells, ready to fix and re-upload.
- Upsert by code (customers, suppliers, products, accounts, employees);
  `updateExisting=false` skips existing codes instead. On update only the columns
  present in the file are changed.
- Exports (`GET /data-import/export/:entity`) use exactly the import columns, so an
  export can be edited and imported back.

### Entities and rules

| Entity | Key | Writes through | Notes |
|---|---|---|---|
| `products` | code | `ProductsService.create/update/upsertUnit` | category by Arabic/English name, unit by symbol or name; `createMissing=true` creates missing categories / units (reported as warnings). Prices, min price, sales/purchase tax %, reorder level/qty, tracking (none/lot/serial), expiry, preferred supplier code, up to 3 alternate units (unit, factor, barcode, price). Barcodes must be unique across products and alternate units (file and database). The base unit of an existing product cannot be changed. |
| `customers` / `suppliers` | code | `CustomersService` / `SuppliersService` | English name defaults to the Arabic one; email format; tax number digits; duplicate tax numbers warned. |
| `accounts` | code | `AccountsService.create/update` | Hierarchy by parent code (parent in the file or existing); parents are created first whatever the row order; missing parents and loops are errors; type defaults to the parent's; accounts that are parents in the file default to non-posting. The parent of an existing account is not moved (warning). |
| `employees` | code (generated when empty) | `EmployeesService.create/update` (HR public service) | branch, department and job title by code or name; housing/transport/other allowance columns; dates checked (birth < hire < contract end). |
| `opening_stock` | product + warehouse | `StockService.receive` | quantity in the base unit or an alternate unit (converted, unit cost divided by the factor); unit cost defaults to the current cost; lot number / expiry for tracked products (required when the product has expiry; serial rows have quantity 1, or no serial for automatic serials); services rejected; existing stock warned (added on top). AVCO cost updated. |
| `opening_customer_balances` | customer code | `SalesInvoicesService.create + post` | positive = receivable (invoice), negative = credit note. |
| `opening_supplier_balances` | supplier code | `PurchaseInvoicesService.create + approve` | positive = payable (bill), negative = vendor refund; vendor reference must be unique per supplier. |

Options (multipart fields): `updateExisting` (default true), `createMissing` (default
false), `date` (opening date, default today), `offsetAccountId` or `offsetAccountCode`.

### Posting rules (opening imports)

- Opening stock: one entry `Dr inventory / Cr offset` for the total value
  (`sourceType = data_import`, `sourceId = job id`). Offset = the account given in the
  request (an opening-equity account), else the stock adjustment account (warning).
- Opening balances: no opening-balance API exists in the codebase, so each row is created
  as an open document through the existing services (so it can be paid, allocated and
  aged): an invoice / credit note (customers) or a bill / refund (suppliers), one
  zero-tax line on the hidden, inactive service product `OPENING-BALANCE` (created on
  first use, category "أرصدة افتتاحية"). Those postings hit sales / purchases, so one
  correcting entry per import moves them to the offset account:
  - customers: `Dr sales / Cr offset` (invoices), `Dr offset / Cr sales return or sales` (credit notes);
  - suppliers: `Dr offset / Cr purchases` (bills), `Dr purchase return or purchases / Cr offset` (refunds).
  Net effect: `Dr receivable / Cr opening equity` and `Dr opening equity / Cr payable`.
  Offset default: retained earnings (warning). Validation checks the posting period
  (preflight), the customer credit limit (posting would be refused) and refuses the
  import while automatic e-invoice submission is enabled (opening invoices must not be
  sent to ETA/ZATCA).
- Without accounting settings nothing is posted (warning when an offset is given).

### Endpoints (`/api/v1`)

| Method | Path | Permission |
|---|---|---|
| GET | `/data-import/entities` | settings / import / read |
| GET | `/data-import/templates/:entity?lang=ar\|en` | settings / import / read |
| POST | `/data-import/:entity/validate` (multipart `file` + options) | settings / import / create |
| POST | `/data-import/jobs/:id/commit` | settings / import / create |
| GET | `/data-import/jobs?entity&status&limit`, `/data-import/jobs/:id` | settings / import / read |
| GET | `/data-import/jobs/:id/errors?lang` | settings / import / read |
| GET | `/data-import/export/:entity?lang` (all entities except opening ones) | settings / export / read |

`:entity` is one of `products, customers, suppliers, accounts, employees,
opening_stock, opening_customer_balances, opening_supplier_balances`.

## 2. Alerts (`erp-backend/src/modules/alerts/`)

### What was built

- Per-tenant alert rules (`alert_rules`): type, name, active flag, `thresholdDays`,
  `thresholdHours`, type params, recipient users and roles, severity. With no recipient
  the tenant administrators (system role) are notified.
- Alert types (thresholds default in brackets):

| Type | Records |
|---|---|
| `cheques_due` [3 days] | received cheques in portfolio / under collection and issued cheques due within N days or overdue (`params.chequeType`) |
| `cheques_bounced` [7] | cheques bounced in the last N days |
| `overdue_invoices` [0] | posted customer invoices with a balance, due date older than N days (`params.minAmount`) |
| `overdue_installments` [0] | unpaid installments of active plans past due by more than N days |
| `supplier_bills_due` [7] | approved vendor bills with a balance due within N days or overdue |
| `lots_expiring` [30] | lots in stock expiring within N days |
| `expired_stock` | lots in stock past their expiry date |
| `low_stock` | active goods whose on hand - reserved <= reorder level (`params.warehouseId`) |
| `payroll_not_run` [day 25] | no payroll run (not cancelled/reversed) for the month although active employees exist; from day N the current month is checked, before it the previous month |
| `period_not_locked` [10] | the accounting lock date is before the end of the last month that ended more than N days ago (tenants with accounting settings) |
| `einvoice_rejected` [7] | ETA/ZATCA documents invalid / rejected / failed in the last N days |
| `pos_session_open` [12 hours] | POS sessions open longer than X hours |

- Data of other modules is read only, with SQL (`AlertSourcesService`).
- Scan: each active rule finds its records; each recipient receives ONE in-app
  notification per rule listing the records not yet sent to them that day (title = rule
  name, body = count + first 10 records, `data` = type, link of the screen, up to 100
  items). De-duplication: `alert_deliveries` has a unique key (tenant, rule, record,
  user, day) and the scan inserts deliveries first (`ON CONFLICT DO NOTHING RETURNING`),
  so the same record is never notified twice a day, even with concurrent scans.
- Scheduler: `ALERTS_SCAN_INTERVAL_SEC` (> 0 enables it, minimum 60 s, off by default)
  scans every active tenant with active rules sequentially, each tenant in its own
  transaction with `app.current_tenant` set; one failing tenant does not stop the others.
- Notifications module fixes: `GET /notifications/my`, `PATCH /notifications/read-all`
  and `PATCH /notifications/:id/read` used the tenant id as user id (so nobody saw their
  notifications); they now use the authenticated user. Added
  `GET /notifications/my/unread-count`. No email channel: nodemailer is not installed.

### Endpoints (`/api/v1`, permission module `settings`, screen `alerts`)

| Method | Path | Action |
|---|---|---|
| GET | `/alerts/types` | read |
| GET / POST | `/alerts/rules` | read / create |
| POST | `/alerts/rules/defaults` (one rule per missing type) | create |
| GET / PATCH / DELETE | `/alerts/rules/:id` | read / update / delete |
| POST | `/alerts/scan` `{ruleId?, dryRun?}` (dryRun returns matches, notifies nobody) | update |
| GET | `/alerts/deliveries?ruleId&from&limit` | read |

## 3. Schema additions

`data_import_jobs`, `alert_rules`, `alert_deliveries` (created by `npm run seed:run`,
TypeORM synchronize).

## 4. Still missing

- Email / SMS / WhatsApp delivery of alerts (needs nodemailer or a provider; SMTP config
  keys already exist in `configuration.ts`). Per-user language of the notification text
  (titles are the rule name, bodies are language-neutral codes/amounts; the frontend can
  translate with `data.alertType`).
- A real opening-balance API (journal-only opening entry with sub-ledger documents);
  opening documents created by the import show in sales/purchase registers and use one
  correcting entry dated at the import opening date (not each document date).
- Imports of price lists, BOMs, warehouses, opening bank / treasury balances, fixed
  assets and serial-number lists; background (queued) processing of very large files.
- Rows with parse errors are not checked against the database until the parse error is
  fixed (the error file lists the parse errors first).
- The scheduler runs inside every API instance; with several instances use one with
  `ALERTS_SCAN_INTERVAL_SEC` set (daily de-duplication keeps double scans harmless).
