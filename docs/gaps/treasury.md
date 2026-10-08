# Treasury, cheques and banks (الخزائن والبنوك والأوراق التجارية)

Module: `erp-backend/src/modules/treasury/`, plus changes to `erp-backend/src/modules/payments/`.
Permissions module `treasury`, screens `treasuries`, `vouchers`, `transfers`, `cheques`, `reconciliation`.

## What was built

- **Treasuries** (cash boxes and bank accounts). Each one has its own GL account (asset, postable, and not shared with another treasury), a currency (null means base currency), a branch, bank details (bank name and branch, account number, IBAN, SWIFT), an opening balance with date and rate, an active flag and an optional `custodianUserId`. The balance is the sum of posted journal lines on the treasury account. Foreign-currency treasuries also report a balance in their own currency (from `amount_currency`). The opening balance is posted Dr treasury / Cr retained earnings.
- **Receipt and payment vouchers** (سند قبض / سند صرف) for money that is not tied to an invoice. They go to or from a treasury, against any GL account, with a cost center and branch per line. Numbering is `RV-` and `PV-`. Lifecycle: draft, then posted, then cancelled (a cancelled posted voucher gets a reversal entry).
- **Transfers between treasuries** (`TRF-`) cover cash deposits, bank withdrawals and bank-to-bank moves. A transfer can carry a bank fee, which is posted to bank charges. The two treasuries can hold different currencies, with an explicit `rate` or `toAmount`, and `baseRate` gives the base valuation. Lifecycle: draft, posted, cancelled.
- **Cheques / notes** (أوراق قبض / أوراق دفع). A cheque is created by a payment with `method: "cheque"` and `cheque` details (number, bank, drawer, due date). That payment settles invoices like any other payment. The `Cheque` record then drives the rest of the lifecycle:
  - Received cheque: in_portfolio, then deposit, collect, bounce, return, endorse to a supplier, or cancel.
  - Issued cheque: issued, then clear, bounce, or cancel.
  - Every step keeps a history (`history` jsonb).
  - Cheque calendar: `GET /treasury/cheques/due`.
- **Payments improvements**:
  - `treasuryId`: posts to the treasury's own GL account. Without it, the payment falls back to the default cash or bank account.
  - `exchangeRate`: base units per foreign unit, default 1. Realised FX gain or loss is posted when a payment is allocated to an invoice booked at a different rate.
  - `withholdingAmount`: tax withheld at source. The partner is settled for amount + withholding.
  - `chequeId`, `endorsedChequeId`, and a new payment status `bounced`.
- **Bank reconciliation**:
  - Import a statement as JSON lines and/or CSV text. The CSV header holds date, description and reference, plus either an amount column or debit/credit columns; `,`, `;` and tab delimiters are accepted.
  - Auto-match against unreconciled posted journal lines on the bank's GL account. Amounts must be equal, the dates within N days (default 7), and a matching reference is preferred.
  - Manual match (several journal lines can be matched to one statement line) and unmatch.
  - Turn an unmatched line into a posted voucher, which is matched automatically. The account defaults to bank charges for withdrawals.
  - Reconciliation report, and close/reopen of a statement.
  - Matches are stored in `bank_reconciliation_matches`; `journal_lines` is not altered. Vouchers, transfers and cheque deposits that are already matched cannot be cancelled or reversed until they are unmatched.
- **Cash book / movement report** per treasury and date range: opening balance, each movement with its running balance (in the treasury currency and in base currency), totals in and out, and the closing balance.

## Endpoints (`/api/v1`)

| Area | Endpoints |
|---|---|
| Treasuries | `GET/POST /treasury/treasuries` (`?type&activeOnly&withBalance`), `GET /treasury/treasuries/:id?asOf`, `PATCH /treasury/treasuries/:id`, `GET /treasury/treasuries/:id/movements?from&to` |
| Vouchers | `GET/POST /treasury/vouchers` (`?type&treasuryId&from&to`, body `post:true` posts immediately), `GET/PATCH /treasury/vouchers/:id`, `POST /treasury/vouchers/:id/post`, `POST /treasury/vouchers/:id/cancel` |
| Transfers | `GET/POST /treasury/transfers`, `GET /treasury/transfers/:id`, `POST /treasury/transfers/:id/post`, `POST /treasury/transfers/:id/cancel` |
| Cheques | `GET /treasury/cheques` (`?type&status&partnerId&dueFrom&dueTo`), `GET /treasury/cheques/due?from&to&type`, `GET /treasury/cheques/:id`, `POST /treasury/cheques/:id/deposit`, `POST /treasury/cheques/:id/collect`, `POST /treasury/cheques/:id/clear`, `POST /treasury/cheques/:id/bounce`, `POST /treasury/cheques/:id/return`, `POST /treasury/cheques/:id/endorse`, `POST /treasury/cheques/:id/cancel` |
| Reconciliation | `GET/POST /treasury/bank-statements`, `GET/DELETE /treasury/bank-statements/:id`, `GET /treasury/bank-statements/:id/report`, `POST /treasury/bank-statements/:id/auto-match`, `POST /treasury/bank-statements/:id/close`, `POST /treasury/bank-statements/:id/reopen`, `POST /treasury/bank-statements/lines/:lineId/match`, `POST /treasury/bank-statements/lines/:lineId/unmatch`, `POST /treasury/bank-statements/lines/:lineId/voucher` |
| Payments | `POST /payments` now accepts `treasuryId`, `exchangeRate`, `withholdingAmount`, `cheque{chequeNumber,bankName,bankBranch,drawer,dueDate,issueDate,notes}` and `endorsedChequeId`. `GET /payments?treasuryId` is also supported. |

## Posting rules

| Event | Entry |
|---|---|
| Treasury opening balance | Dr treasury / Cr retainedEarnings (reversed when negative) |
| Customer receipt (cash/bank) | Dr treasury account (or cash/bank) net + Dr withholdingTaxReceivable / Cr receivable gross |
| Supplier payment (cash/bank) | Dr payable gross / Cr treasury net + Cr withholdingTaxPayable |
| Cheque received | Dr notesReceivable / Cr receivable (invoices settled, customer balance reduced) |
| Cheque deposited | Dr chequesUnderCollection / Cr notesReceivable |
| Cheque collected | Dr bank treasury / Cr chequesUnderCollection (Cr notesReceivable if cashed from the portfolio) |
| Cheque bounced | Reversal of the deposit entry (if any) and of the payment entries. Net effect: Dr receivable / Cr notesReceivable or chequesUnderCollection. Invoices re-open and the customer owes again. Optional charge: Dr bankCharges (or receivable when `chargeToCustomer`) / Cr bank. |
| Cheque returned to customer | Reversal of the payment entries |
| Cheque endorsed to supplier | A supplier payment: Dr payable / Cr notesReceivable (it can settle bills) |
| Endorsed cheque bounced | Both the endorsement payment and the original receipt are reversed |
| Cheque issued | Dr payable / Cr notesPayable |
| Issued cheque cleared | Dr notesPayable / Cr bank treasury |
| Issued cheque bounced / cancelled | Reversal of the payment (the supplier is owed again) |
| Receipt voucher | Dr treasury / Cr each line account (with cost center and branch) |
| Payment voucher | Dr each line account / Cr treasury |
| Transfer | Dr destination (value amount x baseRate, amount in currency = toAmount) + Dr bankCharges (fee x baseRate) / Cr source (amount + fee). Cancelling a transfer posts a mirror entry. |
| FX on allocation | Gain: Dr receivable or payable / Cr fxGain. Loss: Dr fxLoss / Cr receivable or payable. The amount is allocated amount x (payment rate - invoice rate); the sign depends on the direction of the money. The entry is posted in base currency under the payment, so cancelling the payment reverses it. |

## Schema additions

- New tables: `treasuries`, `treasury_vouchers`, `treasury_voucher_lines`, `treasury_transfers`, `cheques`, `bank_statements`, `bank_statement_lines`, `bank_reconciliation_matches`.
- `payments` gains `withholding_amount`, `exchange_rate`, `treasury_id` and `cheque_id`; the status enum gains `bounced`.

## Still missing

- Restricting users to their own treasury. `custodianUserId` is stored but not enforced.
- No rule against a cash box going negative.
- Cheques that are a partial payment of an invoice work. Splitting one payment into several cheques is not supported (use one payment per cheque).
- An FX revaluation of an open cheque between receipt and collection is not posted: notes move at the cheque's original rate.
- Bank charges on a bounced issued cheque have to be entered as a payment voucher.
- Bank statement import reads JSON and simple CSV only (no MT940 or OFX). Dates must be `YYYY-MM-DD`.
- The generic `JournalEntriesService.reverse` (accounting module) drops `amount_currency` on reversal lines. The treasury ledger works around this by deriving the currency amount as base / entry rate, and transfers are cancelled with an explicit mirror entry. Fixing `reverse` itself would be cleaner.
- Cheque printing is done (`GET /print/cheques/:id` with per-bank layouts, see `printing.md`). Promissory notes with installment schedules, and post-dated cheque reminders or notifications are not built.
