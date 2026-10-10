# Promotions and discounts (العروض والخصومات)

Module: `erp-backend/src/modules/promotions/`. It is integrated into POS orders (`pos.service.ts`) and into sales invoices and sales orders (`sales-invoices.service.ts`, `sales-orders.service.ts`).
Permissions module `promotions`, screens `campaigns`, `bonuses`, `invoice_discounts`, `settings`, `reports` and `evaluate`, plus `discounts/override`.

Ported from Instasoft `disc_item`, `disc_pouns`, `disc_fat` and the `setting_account` discount threshold. Price lists with quantity tiers were already in `sales` (`SalesPricingService`), so this module does **not** add quantity-tier % discounts.

## What was built

- **Engine.** `engine/promotion-engine.ts` holds `evaluatePromotions(context, lines, rules)`, a pure function with no database access. It returns the following:
  - the offer discount for each line and the campaign that gave it
  - bonus quantities
  - the subtotal
  - the invoice discount (manual or rule)
  - the ids of the rules applied
  - the total promotion discount

  The same file holds helpers for rule conditions, time windows, pro-rata allocation and the manual discount ratio. Everything here is unit-tested.
- **Shared rule conditions** apply to every rule type:
  - names in Arabic and English
  - an active flag
  - `validFrom` / `validTo` (inclusive)
  - `appliesTo` set to `sales`, `pos` or `both`
  - an optional branch list, which is **enforced**
  - optional weekdays (0 = Sunday)
  - an optional hour window `startTime`–`endTime`, which may wrap past midnight
- **Item campaign** (`promotion_campaigns`, from disc_item):
  - Targets products and/or categories. Sub-categories are included through the category parent chain.
  - Gives a `percent` discount, or a fixed `amount` per unit. The amount is capped at the line amount.
  - The discount is computed **after the manual line discount**: offer = (qty × price − manual discount) × pct.
  - When several campaigns match a line, the biggest discount wins.
- **Bonus / buy X get Y** (`promotion_bonus_rules`, from disc_pouns):
  - Defined by a product, an optional unit, an optional free product (default: the same product), tiers `{minQty, freeQty}` and `repeat` (default `false`, as in Instasoft).
  - Quantities of the product are summed across the document's lines.
  - The highest tier reached gives its `freeQty`. With `repeat` the free quantity is multiplied by `floor(qty / minQty)`.
  - If several rules match one product, the rule giving the most free units wins.
  - Free units become an extra **zero-price line** (description `Bonus: <rule name>` on sales documents).
- **Invoice-total discount** (`promotion_invoice_discounts`, from disc_fat):
  - A `percent` or `amount` discount.
  - Applies within an inclusive subtotal band `[minSubtotal, maxSubtotal]`. The subtotal is taken after line and offer discounts, before the invoice discount and tax.
  - Has a payment condition: `any`, `cash` or `credit`.
  - When several rules match, the lowest `priority` wins, then the oldest.
  - A **manual invoice discount always wins**: the automatic one applies only when no manual `invoiceDiscount` is sent.
- **Invoice discount spreading.** Both the manual and the automatic invoice discount are spread over the lines in proportion to each line's net amount, and added to the line `discount`. This keeps the document totals, VAT and GL posting unchanged in structure: tax is always computed after every discount, and no new posting accounts are needed.
- **Max total discount %** (`promotion_settings.maxTotalDiscountPercent`, per tenant, null = no limit):
  - The checked ratio is (manual line discounts + manual invoice discount) / gross × 100.
  - Above the limit, the user needs `promotions/discounts/override`. On POS, the existing `pos/discounts/override` also works.
  - **Promotion discounts are excluded from the ratio**, as in Instasoft. Promotions are approved by whoever set up the rule, so a cashier is never blocked because a campaign happens to apply.
  - The POS terminal per-line limit (`maxDiscountPercent`) still applies first, to manual discounts only.
- **Minimum selling price** (sales) is checked against manual discounts only. Bonus lines and promotion discounts do not trigger `sales/price_override`.
- **Usage log** (`promotion_usages`): one row per rule per document, written when the document is created. A row holds the rule type and id, the document type (`pos_order`, `sales_invoice` or `sales_order`) and id, the date, the discount amount and the bonus quantity. For a bonus, the amount is the value of the free units at the document price of the purchased product (or the free product's list price when it differs). Cancelling a sales invoice or sales order sets `isVoid`, which removes it from the report.
- **Cost report**: promotion cost per rule for a period, with the number of documents, the discount amount and the bonus quantity.
- **Price check** (Instasoft PriceCheckForm), by product id, barcode or code. It returns the following:
  - the list price
  - the price after the best active campaign right now (branch and channel aware), and the campaign itself
  - the bonus offers running on the product
  - up to 5 cheaper active products in the same category, closest price first

## Integration

| Document | When | Payment condition | Notes |
|---|---|---|---|
| POS order (`POST /pos/orders`) | Always, unless `applyPromotions: false` | Always `cash`, because POS sales are settled at the till; card counts as paid immediately | Branch = terminal branch, time = server time. Bonus lines are issued from the terminal warehouse like any line, so their AVCO cost goes to COGS (Instasoft left it out of profit). New DTO fields: `applyPromotions` (default true) and `invoiceDiscount`. |
| Sales invoice (`POST /sales/invoices`) | New invoices only: not credit notes, not invoices created from an order (`orderId`), not when `skipPriceChecks` is set | `cash` when the effective due date (`dueDate`, or date + customer payment terms) is on or before the invoice date, otherwise `credit`. This is the cleanest signal available on a draft, because payment is registered later. | New DTO fields: `applyPromotions` and `invoiceDiscount`. Hour windows apply only when the invoice is dated today. Cancelling the invoice voids its usages. |
| Sales order (`POST /sales/orders`) | Always, unless `applyPromotions: false` | `cash` when the customer has no payment terms (`paymentTermDays = 0`), otherwise `credit` | Bonus lines are reserved and delivered like normal lines, so the stock issue and COGS happen at delivery. An invoice created from the order copies the discounted lines and is not re-promoted. Cancelling the order voids its usages. |

## Endpoints (`/api/v1`)

| Area | Endpoints |
|---|---|
| Evaluate | `POST /promotions/evaluate`: a preview for tills and price checkers. Body: `channel`, `date`, `time`, `branchId`, `paymentCondition`, `invoiceDiscount`, `lines[{productId, quantity, unitPrice?, discount?, unitId?}]`. Nothing is saved, and the discount limit is not enforced. |
| Price check | `GET /promotions/price-check?productId|code&branchId&channel` |
| Campaigns | `GET/POST /promotions/campaigns` (`?activeOnly=true`), `GET/PATCH/DELETE /promotions/campaigns/:id`, `POST /promotions/campaigns/:id/activate`, `POST /promotions/campaigns/:id/deactivate` |
| Bonus rules | `GET/POST /promotions/bonus-rules`, `GET/PATCH/DELETE /promotions/bonus-rules/:id`, `POST …/:id/activate`, `POST …/:id/deactivate` |
| Invoice discounts | `GET/POST /promotions/invoice-discounts`, `GET/PATCH/DELETE /promotions/invoice-discounts/:id`, `POST …/:id/activate`, `POST …/:id/deactivate` |
| Settings | `GET/PUT /promotions/settings` (`maxTotalDiscountPercent`) |
| Reports | `GET /promotions/reports/cost?from&to`, `GET /promotions/usages?documentType&documentId` |

A rule that has been used on a document cannot be deleted (409). Deactivate it instead.

## Posting rules

There are no new journal entries. Promotion and invoice discounts reduce the line amounts, so revenue is posted net (Cr sales = subtotal after all discounts) and output VAT is posted on the discounted amount. Bonus units are posted only through COGS: Dr cogs / Cr inventory at AVCO, on the POS sale or the sales order delivery. The promotion cost is reported from `promotion_usages`, not from a separate GL account.

## Deliberate differences from Instasoft

- The campaign discount type (percent or amount per unit) is honoured. Instasoft always treated it as a percent.
- The campaign branch is enforced. Instasoft stored it but never checked it.
- Bonus goods are issued from stock, and their cost is counted in COGS and profit.
- Bonus `repeat` (per multiple of minQty) is optional. The default keeps Instasoft's non-cumulative behaviour.
- Weekdays and hour windows were added as optional conditions.
- With several invoice-discount rules, the winner is deterministic: priority first, then the oldest rule.
- The manual invoice discount is explicit (`invoiceDiscount`) and always takes precedence over the automatic one.

## Still missing

- POS refunds do not reduce the promotion usage (the refunded share of a promoted sale still counts in the cost report).
- Rules cannot target customers or customer categories. Loyalty points ("خصم النقاط") are not covered.
- Hour windows use server-local time. There is no tenant time zone yet.
- Bonus rules work in the product base unit, because document lines carry no unit. `unitId` matches only lines that state one.
- Multi-buy mixes (buy A + B, get C) and coupon codes are not supported.
- A POS or sales line has no flag marking it as a bonus line. A bonus line is recognised by its zero price (and its description on sales documents).
