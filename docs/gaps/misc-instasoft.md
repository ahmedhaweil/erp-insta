# Smaller Instasoft gaps (write-offs, settlement discount, stock issues, credit, customers, installments, opening balances)

Modules touched: `payments` (write-offs, discount, opening balances), `inventory` (stock issues), `sales` (credit check, customer flags/addresses, installments), `pos` (blocked customer), `reports` (partner statement), `accounting` (settings keys + chart templates).

## Found existing vs added

| # | Instasoft feature | Already in erp-insta | Added |
|---|---|---|---|
| 1 | Partner balance write-off (`writeoff.vb`) | Nothing (no write-off document; fixed assets have their own disposal "write-off") | `WO-` document for customers and suppliers, draft → posted → cancelled |
| 1 | Allowed discount on receipt (`account_cash.cash_desc`) | `salesDiscountAccountId` existed in settings/templates but was unused; payments had `withholdingAmount` only | `discountAllowed` on payments (allowed to customers / received from suppliers), new `purchaseDiscountAccountId` |
| 2 | Damage / charity issues (`item_damage`, `item_charity`) | Stock adjustment with a free-text reason (single line, always stock adjustment account, today's date) and manufacturing scrap (`SCRAP-`, single product, stock adjustment account) | Multi-line `ISS-` document with type `damage / donation / internal_use / sample`, lots, units, per-type expense account, cancel with goods returned |
| 3 | Credit limit block + soft balance threshold | Hard block on invoice post and order confirm (balance + document > limit), no warning level, no override | `balanceWarningThreshold` on customer and customer category (warning in the response), override permission `sales/credit_limit_override/update`, Instasoft formula balance + invoice − already paid |
| 4 | Rejected customer (`acc_field8`) | Only `isActive` (archived) | `isBlocked` + `blockReason`, enforced on sales orders, invoices and POS orders with a customer |
| 4 | Several delivery addresses | Single `address`/`city` on the customer | `customer_addresses` table with CRUD |
| 5 | Installments: payment spill-over | Exists: invoice payments are allocated to installments by due date (`InstallmentScheduleService.allocate`) | Test added only |
| 5 | Installments: due/overdue list | Exists: `GET /sales/installments/due` with `daysOverdue` | `upcomingDays` filter (overdue + due within N days), `daysLate`, `daysUntilDue`, `bucket`, guarantor contact on rows |
| 5 | Installments: guarantor | Missing | Guarantor name/phone/national id/optional customer on the plan (on create and `PUT .../guarantor`) |
| 5 | Installments: reschedule | Missing | `POST .../reschedule` with a new installment amount or count |
| 6 | Partner opening balances (`first_balance`) | Missing (only treasury opening balances) | `OB-` document creating opening open items |

## What was built

- **Write-offs** (`partner_write_offs`, `partner_write_off_lines`, number `WO-000001`). One document per partner. Lines name open invoices (customer) or bills (supplier) with an amount ≤ residual; without lines, `amount` (default: the whole open residual) is spread oldest-first. `kind`: `write_off` (bad debt expense / write-off income), `discount` (discount allowed / received) or `custom` (with `accountId`, must be active and postable). Posting re-validates residuals, then reconciles each document through `SalesInvoicesService.applyPayment` / `PurchaseInvoicesService.applyPayment` (status, installment sync) and lowers the partner balance, exactly like a payment allocation. Documents in different currencies/rates get one entry per currency/rate group at the document rate. Cancelling a posted write-off reverses the entries, re-opens the documents and restores the balance. Write-offs appear on the partner statement.
- **Settlement discount on payments**: `discountAllowed` on `POST /payments` (customer receipts and supplier payments only, refused on refunds). The partner is settled for `amount + withholdingAmount + discountAllowed`; allocations and `autoAllocate` use that gross amount; cancel restores it. The partner statement now shows payments at their gross settled amount (it showed the net amount before, so withholding was missing from statements).
- **Stock issues** (`stock_issues`, `stock_issue_lines`, `ISS-000001`): type, warehouse, date, reason, beneficiary, optional `expenseAccountId`; lines with product, quantity in an optional alternate unit (stored in base unit), optional lots. Posting issues each line through `StockService.issue` at average cost (damage may consume expired lots), stores cost and lots, and posts Dr expense / Cr inventory. Cancelling a posted issue receives the goods back at the issued cost into the same lots and reverses the entry.
- **Credit check** (`CustomerCreditService`, used by invoice post and order confirm): exposure = balance + document − already paid. Above `creditLimit` (> 0): `403` unless the user holds `sales/credit_limit_override/update` (then posted with an "overridden" warning). Above `balanceWarningThreshold` (customer, else its category): posted, the response carries `warnings: string[]`.
- **Blocked customers**: `POST /sales/customers/:id/block {reason}` / `unblock`. Blocked customers cannot get new sales orders, invoices (credit notes are still allowed) or POS orders; the error carries the reason.
- **Customer addresses**: label, address, city, delivery zone, phone, default flag. The first address becomes the default, setting a new default clears the previous one, deleting the default promotes the oldest remaining address.
- **Installments**: guarantor fields; reschedule keeps paid installments, reduces a partially paid installment to its paid part and spreads the full unpaid balance (including those partial remainders, which Instasoft lost) over new installments starting at `firstDueDate` (default: first unpaid due date, never before the last installment with payments). The plan total is unchanged; `rescheduleCount` is incremented.
- **Partner opening balances** (`partner_opening_balances`, lines; `OB-000001`): multi-line, customers and suppliers mixed, signed amounts (negative = advance/credit balance), optional original date (ageing), due date and reference. Posting creates per line a line-less posted sales invoice / credit note or approved vendor bill / refund (`invoiceNumber = OB-000001/n`, `openingBalanceId` set), updates partner balances and posts one entry against the opening balance equity account. Aged receivables/payables, statements, payment allocation and write-offs then treat opening balances like normal documents. These open items cannot be cancelled from the invoice endpoints; cancelling the OB document is allowed only while none of its items has been settled.

## Endpoints (`/api/v1`)

| Area | Endpoints | Permission |
|---|---|---|
| Customer write-offs | `GET/POST /sales/writeoffs` (`?partnerId&status`), `GET /sales/writeoffs/:id`, `POST /sales/writeoffs/:id/post`, `POST /sales/writeoffs/:id/cancel` | `sales/writeoffs/*` |
| Supplier write-offs | `GET/POST /purchasing/writeoffs`, `GET /purchasing/writeoffs/:id`, `POST .../:id/post`, `POST .../:id/cancel` | `purchasing/writeoffs/*` |
| Payments | `POST /payments` accepts `discountAllowed` | unchanged |
| Opening balances | `GET/POST /partner-opening-balances` (`?status`), `GET /partner-opening-balances/:id`, `POST .../:id/post`, `POST .../:id/cancel` | `accounting/opening_balances/*` |
| Stock issues | `GET/POST /inventory/issues` (`?type&status&warehouseId`), `GET /inventory/issues/:id`, `POST .../:id/post`, `POST .../:id/cancel` | `inventory/stock_issues/*` |
| Customers | `POST /sales/customers/:id/block`, `POST /sales/customers/:id/unblock`, `GET/POST /sales/customers/:id/addresses`, `PATCH/DELETE /sales/customers/:id/addresses/:addressId`; `balanceWarningThreshold` on customers and customer categories | `sales/customers/*` |
| Credit override | (no endpoint) | `sales/credit_limit_override/update` |
| Installments | `PUT /sales/installment-plans/:id/guarantor`, `POST /sales/installment-plans/:id/reschedule`, `guarantor{}` on create, `GET /sales/installments/due?upcomingDays=7` | `sales/installments/*` |

All create endpoints accept `post: true` to post immediately.

## Posting rules

| Event | Entry |
|---|---|
| Customer write-off | Dr badDebtExpense (kind `discount`: salesDiscount; `custom`: accountId) / Cr receivable |
| Supplier write-off | Dr payable / Cr writeOffIncome (kind `discount`: purchaseDiscount; `custom`: accountId) |
| Customer receipt with discount | Dr treasury (net) + Dr withholding + Dr salesDiscount / Cr receivable (gross) |
| Supplier payment with discount | Dr payable (gross) / Cr treasury (net) + Cr withholding + Cr purchaseDiscount |
| Stock issue | Dr expense (damage, internal_use, sample: stockAdjustment; donation: donationsExpense; or `expenseAccountId`) / Cr inventory, at average cost |
| Opening balances | Dr receivable (customer debit balances) / Cr payable (supplier credit balances), net to Cr/Dr openingBalanceEquity (falls back to retainedEarnings) |
| Cancellations | `reverseSource` of the document's entries |

New accounting settings keys: `purchaseDiscountAccountId`, `badDebtExpenseAccountId`, `writeOffIncomeAccountId`, `donationsExpenseAccountId`, `openingBalanceEquityAccountId`. Chart templates map them (EG: 540201, 420104, 420105, 540204, 330103; SA: 630201, 420104, 420105, 630203, 330103).

## Deliberate differences from Instasoft

- Write-offs reconcile specific invoices, so aged balances and statements stay consistent. Instasoft only moved the account balance.
- The credit check counts amounts already paid on the invoice, and the hard block can be overridden by permission instead of being absolute.
- Rescheduling keeps the unpaid remainder of partially paid installments (Instasoft dropped it).
- Opening balances are open items, not just a balance figure, so they can be aged, paid and written off.
- Cancelling a stock issue returns the goods at the cost they were issued at, into the same lots.

## Still missing

- Writing off credit balances (open credit notes / vendor refunds, or unallocated advances).
- Foreign-currency opening balances: lines are in base currency.
- The settlement discount is not split per invoice for tax. VAT on the discount is not adjusted; use a credit note when that is needed.
- No customer address is linked to sales orders or deliveries yet (there is no `addressId` on orders).
- Rescheduling adds no extra financing interest.
- No permission catalog/seed was updated, because the repo has none; the new screens are listed above.
