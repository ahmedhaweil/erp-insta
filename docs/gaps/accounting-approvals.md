# Accounting depth and approvals (phase 2)

Closes the accounting gaps listed in `ODOO_GAP_ANALYSIS.md` section 5 (recurring entries,
deferred revenue/expenses, unrealised FX revaluation, approval workflows), plus opening balances
and a monthly closing checklist. All routes are under `/api/v1`.

## Recurring journal entries

Tables `recurring_entries`, `recurring_entry_lines`, `recurring_entry_runs` (unique on
tenant + template + run date).

- A template has balanced lines, a frequency (`monthly`, `quarterly`, `yearly`, `days` with
  `intervalDays`), a start date, an optional end date, `autoPost` (post, or leave drafts for
  review), and an optional journal and currency/rate. Lines in a foreign currency are converted
  like automatic postings.
- Occurrences are counted from the start date, so day-of-month clamping never drifts
  (31 Jan, 28 Feb, 31 Mar...).
- `run-due` generates every occurrence up to `asOf`. It is idempotent: the run log refuses a
  second entry for the same date. A template that cannot post (locked period, inactive account)
  is reported in `error` and stays due; the other templates still run.
- Entries carry `source_type = recurring_entry`, `source_id = template id`.
- Optional in-process scheduler: set `RECURRING_RUN_INTERVAL_SEC` (off by default). Each tick
  runs recurring entries and deferral recognitions for every tenant with due items, one
  transaction per tenant.

Endpoints (`accounting/recurring` permissions):
`GET|POST /accounting/recurring-entries`, `GET|PATCH /accounting/recurring-entries/:id`
(GET includes the next 6 dates and the generated runs; PATCH can pause/resume with `status`),
`POST /accounting/recurring-entries/run-due {asOf?}`, `POST /accounting/recurring-entries/:id/run {asOf?}`.

## Deferred revenue and prepaid expenses

Tables `deferral_schedules`, `deferral_schedule_lines`.

- A schedule is created from the type (`revenue` | `expense`), amount, deferral account
  (deferred-revenue liability or prepaid asset), P&L account, start date and number of months.
  Lines are equal month-end amounts from the start month; the last month absorbs rounding.
- Optional `counterpartAccountId` posts the initial entry on the start date:
  revenue Dr counterpart / Cr deferral; expense Dr deferral / Cr counterpart.
- Monthly recognition: revenue Dr deferral / Cr revenue; expense Dr expense / Cr prepaid
  (`source_type = deferral`). `run-due` posts each planned line dated up to `asOf` once (the
  line keeps its entry id).
- Cancel: planned lines are cancelled. With `recognizeRemaining: true` the rest is recognised in
  one entry on `date` and the schedule is completed.

Endpoints (`accounting/deferrals`): `GET|POST /accounting/deferrals` (`?type=`),
`GET /accounting/deferrals/:id` (schedule with lines), `POST /accounting/deferrals/run-due`,
`POST /accounting/deferrals/:id/cancel`.

## Unrealised FX revaluation

Table `fx_revaluations` (date, reversal date, rates, computed items, entry and reversal ids).

- Items: open sales invoices / credit notes and vendor bills / refunds with a non-base currency,
  `exchange_rate <> 1` and a residual, grouped per currency (credit notes and refunds count
  negative); and active foreign-currency treasuries, whose currency balance and base balance are
  read from the treasury GL account (read-only, same formula as the treasury ledger).
- Rates: the request's `rates[]`, otherwise the latest `exchange_rates` row on or before the
  date (base units per foreign unit). Currencies without a rate are skipped with a warning.
- Difference = residual x closing rate - residual x document rate (treasury: balance x rate -
  base balance). Posting (`source_type = fx_revaluation`, general journal, all lines with
  `amount_currency = 0` so currency balances do not move):
  - receivable up: Dr receivable / Cr fxGain; down: Dr fxLoss / Cr receivable;
  - payable up: Dr fxLoss / Cr payable; down: Dr payable / Cr fxGain;
  - treasury like receivables, on the treasury's own account.
- The entry is reversed on the first day of the next period (or `reversalDate`), Odoo-style, so
  realised differences on payment keep being computed from document rates. If that period is not
  open the revaluation stays `posted` with a warning; reverse it later with the reverse endpoint.
  A new revaluation is refused while one is unreversed or its reversal date is after the new date.

Endpoints (`accounting/revaluation`): `POST /accounting/fx-revaluations/preview {date, rates?}`
(computation only), `POST /accounting/fx-revaluations {date, rates?, reversalDate?}`,
`GET /accounting/fx-revaluations[/:id]`, `POST /accounting/fx-revaluations/:id/reverse {date?}`.

## Opening balances

Table `opening_balances` (kind `accounts` | `customer` | `supplier`, document, entry, equity account).

- `POST /accounting/opening-balances/accounts {date, equityAccountId?, lines[]}`: one entry; the
  difference between debits and credits goes to the chosen opening-balance equity account or to
  retained earnings (`source_type = opening_balance`). Lines on the receivable/payable control
  accounts are refused (open them per partner) unless `allowControlAccounts`.
- `POST /accounting/opening-balances/partners {date, equityAccountId?, documents[]}`: one posted
  document per line: customer amount > 0 gives an invoice `OB-INV-…` (Dr receivable / Cr equity),
  < 0 a credit note; supplier amount > 0 gives a bill `OB-BILL-…` (Dr equity / Cr payable),
  < 0 a vendor refund. Foreign currency with `currencyId` + `exchangeRate`. Partner balances are
  updated. The documents have no lines and `subtotal = 0` (never revenue/expense in reports) and
  use the normal `move_type`, so they age, are paid/allocated through `POST /payments` and cancel
  through the normal cancel (entries use `source_type` sales_invoice / purchase_invoice).
- `GET /accounting/opening-balances?kind=`.
- They are written with the sales/purchasing repositories, not through `SalesInvoicesService` /
  `PurchaseInvoicesService`, which require product lines. Cleaner long term: an `is_opening`
  flag (or `move_type = opening`) on both invoice tables, accepted by the payments
  `openDocuments` query.

## Period closing

Table `period_closings` (lock / reopen log with warnings).

- `GET /accounting/period-closing/checklist?period=YYYY-MM|date=`: counts of draft journal
  entries, draft invoices, draft bills, draft vouchers, unreconciled bank statements, open POS
  sessions, recurring entries due, deferral lines due and pending approvals up to the date.
- `POST /accounting/period-closing/lock {period | date, notes?}` sets `accounting_settings.lock_date`
  to the month end (must be later than the current lock); open items come back as `warnings`
  and do not block. `POST /accounting/period-closing/reopen {date?}` moves the lock back or
  removes it. `GET /accounting/period-closing/history`. Requires accounting settings.

## Approval engine (`approvals` module)

Tables `approval_rules`, `approval_rule_levels`, `approval_requests`, `approval_actions`.

- Rule: document type (`purchase_order`, `vendor_bill`, `payment`, `treasury_voucher`,
  `sales_discount`, `sales_order`, `journal_entry`, `other`), amount band (applies strictly above
  `minAmount`, up to `maxAmount` inclusive, base currency), `priority`, `allowSelfApproval`
  (default false) and ordered levels (role and/or users, `minApprovers` distinct approvers).
  The rule with the highest matching `minAmount` wins.
- Request: number `APR-…`, snapshot of the levels, status pending / approved / rejected /
  cancelled, current level, history of submit / approve / reject / cancel / comment actions.
  Members of a system (superuser) role may act on any level. Requesters cannot decide their own
  requests unless the rule allows it. Rejection requires a comment.
- Guarded actions call `ApprovalsService.ensureApproved`. When a rule applies and nothing is
  approved yet, the pending request is committed in its own transaction (`REQUIRES_NEW`) and the
  HTTP request fails with **409** and the message
  `Approval required: approval request APR-000001 is pending [approvalRequestId=<uuid>]`.
  Calling again returns the same request. Modules register handlers that run when the last level
  approves.

Integrations (all no-ops when the tenant has no matching active rule):

| Document | Hook | On final approval |
|---|---|---|
| Vendor bill (`POST /purchasing/invoices/:id/approve`, bills only) | 409 + request | the bill is posted by the approver |
| Outbound payment (`POST /payments`, direction outbound) | 409 + request holding the payment payload (same payload = same request) | the payment is created for the requester; the request gets its id |
| Payment voucher (`POST /treasury/vouchers/:id/post`) | 409 + request | the voucher is posted |
| Payment voucher created with `post: true` | saved as draft; the response has `approvalRequestId` | the voucher is posted |
| Purchase order (`POST /purchasing/orders/:id/confirm`) | if any active `purchase_order` rule exists the engine replaces `purchasing_settings.poApprovalThreshold`: the order goes to `to_approve` with a request | the order is confirmed; rejection/cancel sends it back to draft |

The legacy PO approve/reject endpoints answer 409 for orders that have a pending engine request.
A bill created and approved in the same call (`POST /purchasing/orders/:id/bill` with
`post: true`) gets a 409 asking to save it as a draft first, because the bill would be rolled
back together with the request.

Endpoints: `GET|POST /approvals/rules`, `GET|PATCH|DELETE /approvals/rules/:id` (delete
deactivates), `GET /approvals/requests?documentType&documentId&status&requestedBy`,
`GET /approvals/requests/mine/pending`, `GET /approvals/requests/:id`,
`POST /approvals/requests` (manual request for types without a hook),
`POST /approvals/requests/:id/approve|reject|cancel|comment`,
`GET /approvals/history/:documentType/:documentId`.
Permissions: `approvals/rules` (read, create, update, delete), `approvals/requests` (read,
create, approve, update).

## Still missing

- `sales_discount`, `sales_order` and `journal_entry` rules have no automatic hook yet (manual
  requests only). Budget control is not part of the engine.
- The exception filter only returns `message`, so the request id is embedded in the message
  text; a structured `approvalRequestId` field needs a change in `common/filters`.
- No notifications to approvers (an `approval.requested` event plus a notifications listener
  would close this), no delegation or escalation timeouts.
- Payments created internally (cheque replacement) and vouchers created by bank reconciliation
  bypass approvals by design.
- FX revaluation does not cover open cheques (notes receivable/payable) or foreign-currency
  advances (unallocated payments). Partner statements stay in document currency.
- Deferrals are equal monthly amounts (no daily prorata) and are not created automatically from
  invoice lines; recurring entries cannot vary amounts per run.
- Opening documents are recognisable only by their `OB-` number and `opening_balances` row; see
  the suggested `is_opening` flag above.
