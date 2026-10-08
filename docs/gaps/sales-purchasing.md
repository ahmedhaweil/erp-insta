# Sales and purchasing extensions

Scope: `erp-backend/src/modules/sales`, `erp-backend/src/modules/purchasing`, the shared
`document-totals.util.ts`, and one column on the product entity (`min_sell_price`).
All routes are under `/api/v1`. Permissions use modules `sales` and `purchasing`.

## 1. Sales returns and purchase returns

| Endpoint | Permission |
| --- | --- |
| `POST /sales/returns` (`post: true` validates in the same request) | sales/returns/create |
| `GET /sales/returns?customerId=&invoiceId=`, `GET /sales/returns/:id` | sales/returns/read |
| `POST /sales/returns/:id/post`, `POST /sales/returns/:id/cancel` (drafts only) | sales/returns/update |
| `POST /purchasing/returns`, `GET /purchasing/returns?supplierId=&billId=`, `GET /purchasing/returns/:id` | purchasing/returns/create, read |
| `POST /purchasing/returns/:id/post`, `POST /purchasing/returns/:id/cancel` | purchasing/returns/update |

- Return against an original document: `originalInvoiceId` / `originalBillId`, with lines that
  reference `invoiceLineId`. Prices, prorated discounts, tax rates, tax-inclusive mode and
  currency come from the original document. The returned quantity cannot exceed the invoiced
  quantity minus the quantity already returned. This is checked when the return is created
  and again when it is posted, and is tracked in `qty_returned` on invoice and bill lines.
- Return without an original document (cash return): `customerId` or `supplierId` plus
  explicit `productId` and `unitPrice` on each line.
- `restock: false` on a line skips the stock move, for example for damaged goods.
- `refundMethod: credit` (the default) leaves the credit note or vendor refund on the
  account, where it settles the original invoice or bill if that is still open.
  `refundMethod: cash` also pays it out in cash.

Posting rules:

- **Sales return.** Goods go back into the chosen warehouse through `StockService.receive`, at
  the cost recorded when they were delivered. That cost is the weighted average of the
  `sales_order` OUT stock moves of the originating order. When no delivery cost exists, the
  current average cost is used. The entry is **Dr inventory / Cr COGS** (source
  `sales_return`). The credit note is created and posted through the existing flow:
  **Dr salesReturn (or sales if not configured) + Dr output VAT / Cr receivable**. For cash
  returns, **Dr receivable / Cr cash** (source `sales_return_refund`).
- **Purchase return.** Goods leave stock through `StockService.issue`. The vendor refund is
  created and approved through the existing flow: **Dr payable / Cr inventory** (goods),
  **Cr purchaseReturn (or purchase)** (non-stock items), **Cr input VAT**. The difference
  between the refund value and the average cost of the goods leaving stock is posted
  **inventory <-> stockAdjustment** when that account is configured (source
  `purchase_return`). For cash refunds, **Dr cash / Cr payable** (source
  `purchase_return_refund`).
- Credit notes now always debit `salesReturnAccountId` when it is set, which also covers
  `POST /sales/invoices/:id/credit-note`. Vendor refunds of non-stock items credit
  `purchaseReturnAccountId` when it is set.

## 2. Price lists

| Endpoint | Permission |
| --- | --- |
| `POST/GET /sales/price-lists`, `GET/PATCH /sales/price-lists/:id`. With PATCH, `rules` replaces all rules | sales/price_lists/* |
| `POST /sales/price-lists/:id/rules`, `DELETE /sales/price-lists/:id/rules/:ruleId` | sales/price_lists/update |
| `GET /sales/pricing/price?productId=&customerId=&quantity=&date=&priceListId=` | sales/price_lists/read |
| `PATCH /sales/pricing/products/:productId/min-price` `{minSellPrice}` | sales/price_lists/update |
| `POST/GET /sales/customer-categories`, `PATCH /sales/customer-categories/:id` | sales/customers/* |

- A price list has a name, an optional currency, validity dates and an active flag. Each rule
  applies to a product, to a product category (including its sub-categories) or to all
  products. A rule is `fixed` (unit price), `discount` (% off the product sales price) or
  `markup` (% on the average cost), and has an optional `minQuantity` tier and its own
  validity dates.
- The price list is resolved in this order: explicit `priceListId`, then
  `customer.priceListId`, then the price list of the customer category. An expired or
  inactive list falls back to the product sales price.
- The rule is chosen in this order: product rule, then the closest category rule, then a
  global rule. Within the same scope, the highest quantity tier reached wins.
- Sales orders and invoices price every line sent without `unitPrice`, and store
  `priceListId`. Invoices created from an order keep the order prices.
- Minimum selling price: `products.min_sell_price` is compared with the net unit price
  (after discount, excluding VAT, in base currency). A price below it returns 403 unless the
  user has **sales/price_override/update**. The check runs on sales order creation and on
  direct invoices. It is skipped for credit notes, returns and invoices created from orders.
- Customers have new fields `categoryId`, `priceListId` and `salesRepId`.

## 3. Sales representatives and commissions

| Endpoint | Permission |
| --- | --- |
| `POST/GET /sales/reps`, `GET/PATCH /sales/reps/:id` | sales/reps/* |
| `POST/GET /sales/commission-rules`, `PATCH /sales/commission-rules/:id` | sales/commissions/* |
| `GET /sales/commission-statements/preview?salesRepId=&periodFrom=&periodTo=` | sales/commissions/read |
| `POST /sales/commission-statements`, `GET` list and by id, `POST :id/post`, `POST :id/cancel` | sales/commissions/* |

- A rep can be linked to a `userId` and an `employeeId`. `salesRepId` is stored on
  customers, orders and invoices. It defaults from the customer and is carried from the
  order to the invoice, and from the invoice to its credit notes and returns.
- Each rule has a `basis`:
  - `collected`: payments allocated to the rep's invoices, with the payment dated in the
    period. Only the untaxed share counts (subtotal / total).
  - `invoiced`: the untaxed amount of the rep's posted invoices dated in the period, minus
    its credit notes.
  A rule can be limited to a product category and to a rep. The most specific scope wins.
  `targetAmount` defines tiers: the tier with the highest target that the rep's period
  total reaches applies.
- Statements cannot overlap for the same rep. Posting a statement accrues the commission:
  **Dr commissionExpense / Cr commissionPayable** (source `commission_statement`).
  Cancelling it reverses the entry.

## 4. Installment sales

| Endpoint | Permission |
| --- | --- |
| `POST /sales/installment-plans` `{invoiceId, startDate, firstDueDate, downPayment, numberOfInstallments, frequency: monthly or weekly, interestRate}` | sales/installments/create |
| `GET /sales/installment-plans?customerId=&invoiceId=&status=`, `GET /sales/installment-plans/:id` | sales/installments/read |
| `POST /sales/installment-plans/:id/recompute`, `POST /sales/invoices/:id/installments/recompute`, `POST /sales/installment-plans/:id/cancel` | sales/installments/update |
| `GET /sales/installments/due?asOf=&dueTo=&status=&customerId=` (due and overdue report) | sales/installments/read |
| `GET /sales/customers/:id/installment-statement?asOf=` | sales/installments/read |

- A plan covers the invoice residual at creation, split into an optional down payment
  (sequence 0, due on the start date) and n equal installments. The rounding remainder goes
  on the last installment. Monthly due dates are clamped to the end of the month.
- Financing uses the **simple (flat) method**: interest = (residual − down payment) × rate.
  It is recognised in full when the plan is created: **Dr receivable / Cr
  installmentInterest** (source `installment_plan`). The interest is added to the invoice
  `totalAmount` and `installmentInterest`, so that the customer's normal payments on the
  invoice settle it. Cancelling a plan with no collections reverses the entry.
- Payments are linked to installments by due date. Each time an amount is applied to the
  invoice (`SalesInvoicesService.applyPayment`, which PaymentsService also calls), the paid
  amount since the plan was created is allocated to installments by due date. Installment
  statuses are due, partial, paid and overdue, and overdue is recomputed when the plan is
  read. The recompute endpoints do the same allocation on demand.

## 5. Purchase approval and requisitions

| Endpoint | Permission |
| --- | --- |
| `GET/PUT /purchasing/settings` `{poApprovalThreshold, requisitionApprovalRequired}` (table `purchasing_settings`) | purchasing/settings/* |
| `POST /purchasing/orders/:id/approve`, `POST /purchasing/orders/:id/reject {reason}` | purchasing/po_approval/approve |
| `POST/GET /purchasing/requisitions`, `GET :id`, `POST :id/submit`, `POST :id/cancel` | purchasing/requisitions/* |
| `POST /purchasing/requisitions/:id/approve`, `POST :id/reject` | purchasing/requisitions/approve |
| `POST /purchasing/requisitions/:id/convert {supplierId?, date?}` | purchasing/orders/create |

- Confirming a purchase order whose total in base currency is above the threshold sets the
  order to `to_approve`. A user who has purchasing/po_approval/approve skips that step: the
  order is approved and confirmed at once. The order stores `approvedBy`, `approvedAt` and
  `rejectionReason`.
- A requisition moves through draft, submitted, approved (or rejected), then converted. One
  RFQ is created per vendor. The vendor is the explicit one, else the line vendor, else the
  product's preferred supplier. The price is the estimated price, else the average cost.
  The RFQ carries `requisitionId`.

## 6. Withholding tax

- Sales invoices and vendor bills have `withholdingRate` (document rate) and
  `withholdingAmount`. Each line has an optional `withholdingRate` that overrides the
  document rate. The amount is computed on the untaxed line totals by
  `computeWithholding()`. Credit notes and refunds inherit the rates. The document total is
  not reduced. The payments module reads `withholdingAmount` and posts it to
  `withholdingTaxReceivable` or `withholdingTaxPayable` at payment time.

## 7. Tax-inclusive prices

- `pricesIncludeTax` is a flag on sales orders, sales invoices, purchase orders, vendor bills
  and returns. `computeLine(line, { taxIncluded: true })` treats the unit price and discount
  as amounts that include VAT, and splits each line into net = gross / (1 + rate) and
  tax = gross − net, so that net + tax always equals the price shown. The flag is carried
  from orders to invoices and bills, and from invoices to credit notes and returns.

## Schema additions (synchronize)

New tables: `customer_categories`, `price_lists`, `price_list_rules`, `sales_reps`,
`commission_rules`, `commission_statements`, `sales_returns`, `sales_return_lines`,
`installment_plans`, `installments`, `purchasing_settings`, `purchase_requisitions`,
`purchase_requisition_lines`, `purchase_returns`, `purchase_return_lines`.

New columns:

| Table | Columns |
| --- | --- |
| `customers` | `category_id`, `price_list_id`, `sales_rep_id` |
| `sales_orders` | `sales_rep_id`, `price_list_id`, `prices_include_tax` |
| `sales_invoices` | the three `sales_orders` columns, plus `withholding_rate`, `withholding_amount`, `installment_interest`, `sales_return_id` |
| `sales_invoice_lines` | `withholding_rate`, `qty_returned` |
| `purchase_orders` | `prices_include_tax`, `approved_by`, `approved_at`, `rejection_reason`, `requisition_id`; enum value `to_approve` |
| `purchase_invoices` | `prices_include_tax`, `withholding_rate`, `withholding_amount`, `purchase_return_id` |
| `purchase_invoice_lines` | `withholding_rate`, `qty_returned` |
| `products` | `min_sell_price` |

## Still missing

- A sales return against an invoice that was not delivered through a sales order still puts
  the goods back into stock, at the current average cost.
- `CreateProductDto` (owned by inventory) does not accept `minSellPrice`. Use
  `PATCH /sales/pricing/products/:id/min-price` until the inventory DTO adds it.
- Price list currency is informative only. Prices are not converted between the list
  currency and the document currency.
- Interest is recognised in full when the plan is created, using the flat method. There is
  no deferred or effective-interest recognition and no late-payment penalties.
- Commission payout (Dr commissionPayable / Cr cash) is left to payroll or the treasury
  module.
- Multi-level approvals for purchase orders and vendor bills come from the approvals module (see `accounting-approvals.md`). Requisitions have no
  department master; they use `departmentId` / `departmentName` as free text.

## Phase 2: units, lots, return cancellation, POS sales reps

- **Alternate units and lots** on orders, invoices, bills, returns and POS: see
  `docs/gaps/inventory.md` ("Phase 2"). New line columns `unit_id`,
  `unit_factor` on `sales_order_lines`, `sales_invoice_lines`,
  `sales_return_lines`, `purchase_order_lines`, `purchase_invoice_lines`,
  `purchase_return_lines`, `pos_order_lines`; jsonb `lots` on
  `sales_order_lines` (+ `lots_returned`), `purchase_order_lines`,
  `sales_return_lines`, `purchase_return_lines`, `pos_order_lines`
  (+ `lots_refunded`).
- **Cancelling posted returns** (`POST /sales/returns/:id/cancel`,
  `POST /purchasing/returns/:id/cancel`, now also for posted returns):
  - Refused when the credit note / vendor refund was settled by anything other
    than the return itself (`paidAmount - appliedAmount - refundedAmount > 0`,
    e.g. a payment or refund through the payments module).
  - Sales return: the goods leave stock again with the same lots/serials
    (refused when they are no longer available, whatever the negative-stock
    policy), `sales_return` (Dr inventory / Cr COGS) and
    `sales_return_refund` entries are reversed, the customer balance is
    restored, the credit note is un-reconciled from the original invoice and
    cancelled (its `sales_invoice` entry reversed), `qty_returned` and the
    order line `lots_returned` are released.
  - Purchase return: the goods come back with their lots at the cost they
    left at, `purchase_return` (valuation difference) and
    `purchase_return_refund` entries reversed, the vendor refund
    un-reconciled from the bill and cancelled, `qty_returned` released.
  - New columns on `sales_returns` / `purchase_returns`: `applied_amount`
    (reconciled with the original document at posting), `refunded_amount`
    (cash), `cancelled_at`. Returns posted before this change have 0 there,
    so they can only be cancelled while their credit note is unpaid.
- **POS sales rep**: `pos_orders.sales_rep_id`, from the request, else the
  customer's rep, else the rep linked to the cashier's user.
- **Rep commission vs sales**: `GET /sales/commission-statements/rep-performance?from&to&salesRepId`
  (sales/commissions/read): per rep, untaxed invoiced sales net of credit notes
  (base currency), POS sales net of refunds, commission and collected amounts
  of posted statements whose period lies in the range, effective commission
  rate; documents without a rep on an "Unassigned" row.
- Vendor bill approval itself is unchanged (`approve()` untouched); only bill
  creation accepts units.

### Still missing (phase 2)
- A sales return cancellation re-issues stock at the current average cost while
  the reversed entry uses the original cost (no valuation-difference posting).
- Purchase returns do not default to the lots received on the original bill
  (FEFO unless lots are given).
- Units are not converted on price list rules (rules are per base unit).

## Landed costs

`POST /purchasing/landed-costs {date, purchaseOrderIds[], splitMethod: by_value|by_quantity|equal, charges[{description, amount, accountId?}]}`
creates a draft. `GET .../:id/preview` shows the split; `POST .../:id/post` posts it and `POST .../:id/cancel` reverses it.
Permission: `purchasing/landed_costs`.

- Charges are spread over the goods received on the purchase orders. The basis is the stock movements of the
  receipts: the value or quantity received per product, or an equal share.
- Shares are rounded to the cent, and the last share absorbs the difference.
- Average costing: the part of a product's share matching units still on hand (capped at the received quantity)
  raises the product's average cost. Posting: Dr inventory. The part matching units already sold or consumed
  goes to Dr cost of goods sold. Each charge's account is credited (default: the purchase account, where a freight
  or customs service bill was booked).
- Cancelling reverses the entry and takes the capitalised amount back out of the average cost of the stock on hand.
- Not built: allocation by weight or volume, landed costs in foreign currency, and per-warehouse costs (average
  cost is per product).
