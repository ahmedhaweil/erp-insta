# Fuel station (محطات الوقود)

Module: `erp-backend/src/modules/fuel/`, plus two additive account keys in accounting settings.
Permissions module `fuel`, screens `setup` (tanks, pumps, nozzles), `shifts` (actions `read/create/update`, plus `manage` and `costs`), `dips`, `meters` and `reports`.

## What was built

- **Data-driven setup.** Instasoft hard-coded 10 nozzle columns and product codes 1-4.
  - **Tanks**: bilingual name, fuel product, warehouse, capacity and a low-level threshold. Each tank has its own warehouse + product slot, so the tank's book stock is simply the stock of that product in that warehouse. Purchases are received into the tank's warehouse through the normal purchasing flow.
  - **Pumps**: bilingual name and station (`branchId`).
  - **Nozzles**: pump, tank, current meter reading, optional `priceOverride` and an active flag.
  - The pump price is the product sales price (VAT included) unless the nozzle overrides it.
- **Shifts** `FSH-000001`:
  - **Open**: an attendant can have one open shift, and a nozzle can be in only one open shift. The nozzles are the ones given, or every free active nozzle (of the station when `branchId` is given). Each nozzle gets a line with the opening meter (the nozzle's current reading), its tank, its product, and the pump price and VAT rate, which are fixed for the shift.
  - **Close**: needs a closing reading for every nozzle.
    - Each closing reading must be at least the opening reading, unless `meterReset` is set. With a reset, liters = (`rolloverAt` - opening) + closing; `rolloverAt` defaults to the opening reading, which means the meter was replaced.
    - liters = closing - opening. amount = liters x price. The amount is split into net and VAT with the product rate (tax-inclusive price).
    - Payments: coupons/vouchers per nozzle and/or for the whole shift; card amount; credit sales `{customerId, amount, nozzleId|productId}`.
    - **cash expected = amount - coupons - card - credit.** Cash counted (defaults to expected) and the difference are stored.
    - Coupons + card + credit above sales are refused, as is credit above the amount sold of that product.
  - **Margin per nozzle** = net (VAT-exclusive) sales - liters x average cost. Cost and margin fields (`unitCost`, `cost`, `margin`, `totalCost`, `totalMargin`) are removed from every response unless the user has `fuel/shifts/costs`. This replaces Instasoft's check of a hard-coded user name.
  - Closing another attendant's shift needs `fuel/shifts/manage`.
- **On close**:
  - The nozzle meters move to the closing readings.
  - One stock issue is made per tank from its warehouse (`referenceType: fuel_shift`) at average cost.
  - Each credit customer gets a posted sales invoice (see below).
  - The shift sales entry is posted.
- **Credit customers: choice made.** Each credit sale becomes a **posted sales invoice** (`pricesIncludeTax`, liters = amount / pump price, price checks skipped).
  - This was chosen over a raw Dr receivable line because it reuses the sales module's credit-limit check, customer balance update, aging and payment allocation. The customer then pays the invoice like any other.
  - The invoice books its own revenue and VAT, so the shift entry credits only the remaining sales.
  - The receivable recorded on the shift is the invoice total. Liters are rounded to 4 decimals, so the total can differ from the typed amount by a fraction of a cent.
- **Tank dips**: record the measured level (it may not exceed capacity). The dip stores the book quantity and the variance (measured - book). With `adjust: true` and a reason, the variance is booked through `StockService.adjust` (`referenceType: fuel_tank_dip`), which posts the inventory gain or loss.
- **Low-level alerts**: active tanks whose book stock is at or below `minLevel`, with the fill %.
- **Meter adjustment**: an audited correction (old reading, new reading, reason, user) that replaces Instasoft's silent edits. It is refused while the nozzle is in an open shift. `PATCH nozzles/:id` cannot change the reading.
- **Reports**:
  - Shift report: nozzle lines, totals per product, payment split and cash difference.
  - Liters and sales per product or nozzle for closed shifts in a period (by shift date).
  - Tank reconciliation: opening book + receipts - pump sales - other issues = expected, compared with the last dip of the period. The dip adjustments are shown separately.

## Endpoints (`/api/v1/fuel`)

| Area | Endpoints |
|---|---|
| Tanks | `GET/POST /tanks` (`?withStock`), `PATCH /tanks/:id`, `GET /tanks/alerts`, `GET/POST /tanks/:id/dips` |
| Pumps / nozzles | `GET/POST /pumps`, `PATCH /pumps/:id`, `GET/POST /nozzles` (GET returns the effective price), `PATCH /nozzles/:id` |
| Meters | `POST /nozzles/:id/meter-adjustments` `{newReading, reason}`, `GET /meter-adjustments?nozzleId` |
| Shifts | `GET /shifts` (`?status&userId&from&to`), `POST /shifts/open` `{branchId?, nozzleIds?}`, `GET /shifts/:id`, `POST /shifts/:id/close` `{readings[], couponAmount?, cardAmount?, creditSales[]?, cashCounted?, date?}` |
| Reports | `GET /shifts/:id/report`, `GET /reports/sales?from&to&groupBy=product|nozzle`, `GET /reports/tank-reconciliation/:tankId?from&to` |

## Posting rules

| Event | Entry |
|---|---|
| Shift close (`sourceType: fuel_shift`, sale journal) | Dr cash (counted cash when `cashOverShortAccountId` is configured, otherwise expected cash); Dr cashOverShort for a shortage or Cr cashOverShort for an overage; Dr bank (cards); Dr fuelCoupon (coupons/vouchers); Cr sales (net, excluding credit invoices); Cr outputTax (VAT, excluding credit invoices); Dr cogs / Cr inventory (liters x average cost of each tank) |
| Credit customer | Posted sales invoice: Dr receivable / Cr sales / Cr output VAT, and the customer balance increases |
| Dip adjustment | `StockService.adjust`: Dr inventory / Cr stockAdjustment (gain) or the reverse (loss) at average cost |

**New accounting settings keys** (additive): `fuelCouponAccountId` (fuel coupons receivable / clearing) and `cashOverShortAccountId` (cash over and short). They were added to the entity, the DTO and both chart templates: EG `120207` / `540204`, SA `120206` / `630203`.

## Deliberate differences from Instasoft

- Nozzles, tanks and products are data rows, not fixed columns or codes.
- Meter edits are audited.
- Each shift posts proper revenue, VAT, COGS and coupons. Instasoft only added the cash to a treasury and reduced item quantities.
- Credit customers create receivables.
- Cash shortages and overages are visible and posted.
- Cost and margin visibility is permission based.

## Still missing

- No settlement flow for fuel coupons from the issuer. Use a receipt voucher against `fuelCouponAccountId`.
- A card terminal per bank is not modelled: all cards go to the default bank account.
- Shifts cannot be reopened or cancelled once closed. A correction needs a manual entry or a credit note.
- The price is fixed at shift open. A price change in the middle of a shift requires closing the shift and opening a new one.
- Tank temperature/density correction and dip-chart (cm to liters) conversion are not built; dips are entered in liters.
- Attendant hand-over between shifts, and a per-attendant cash custody account, are not modelled.
