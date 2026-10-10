# Restaurant: tables, tickets, kitchen and delivery (المطاعم)

Module: `erp-backend/src/modules/restaurant/`, plus a small additive change to `erp-backend/src/modules/pos/services/pos.service.ts`.
Permissions module `restaurant`, screens `areas`, `tables`, `zones`, `drivers`, `apps`, `stations`, `modifiers`, `settings`, `tickets` (create/read/update/void/pay, plus `discount`, which is checked in code), `kitchen` and `reports`.

Before this module, the POS could only record an immediate, paid sale (`PosService.createOrder`). It had no open tickets, tables or kitchen.

## What was built

- **Master data**
  - Dining areas: name ar/en, branch, sort order.
  - Tables: the name is unique per tenant. Each table has an area, a number of seats, an optional minimum charge and an active flag.
  - Delivery zones: name and fee.
  - Drivers: name, phone, commission % with a basis of `sales` or `delivery_fee`, and an optional `employeeId`.
  - Delivery apps (aggregators): commission %, plus a per-app price list (`{appId, productId, price}`) that overrides the list price.
  - Kitchen stations: optional printer name. Routing goes product → station(s) or category → station(s). A product route overrides its category route.
- **Modifiers and combos**
  - `addon` modifiers add a price. They can also consume a stock product (quantity per unit) when the ticket is paid.
  - `without` modifiers lower the price (by an amount ≥ 0) and can name the ingredient that is left out.
  - Combo products have choice groups (min/max picks). Each choice is a component product with an extra price and a quantity per combo.
  - The combo line carries the combo price. Each component becomes a child line at its extra price.
  - At payment, stock is issued for the components and not for the combo product.
- **Settings** (per tenant):
  - Service charge %, applied to dine-in only.
  - The service charge product and the delivery fee product. These are service-type products, and the charges go onto the sale as lines with their own tax rate.
  - Whether dine-in requires a table.
  - KDS thresholds: 5/10/15 minutes by default.
  - Display-number reset: `global`, `daily` or `session`.
- **Tickets** (`REST-000001`, plus a short display number):
  - Order types:
    - `dine_in` needs a table, depending on the setting.
    - `takeaway`.
    - `pickup`.
    - `delivery` needs a customer, an address (defaults to the customer address) and a zone. The fee defaults to the zone fee and can be edited. A driver is optional.
  - Optional delivery app. It needs an app reference, and the app's prices replace list prices.
  - Statuses are `open`, `paid` and `void`.
  - Line unit price = list or app price + addons − withouts, with a floor of 0.
  - A line keeps a snapshot of its modifiers, its note, a combo parent/child link, a line discount, a tax rate and `sentQty`.
  - Lines with the same product, modifiers and note are merged (combos never merge).
  - Table occupancy is derived: a table is occupied while an open ticket references it. A second open ticket on an occupied table is refused.
  - Totals are computed on the server and stored on the ticket after every change:
    - Items before discounts.
    - Line discounts plus the invoice discount. The invoice discount is spread over the lines in proportion to their amounts.
    - Items net.
    - Service charge (dine-in).
    - Delivery fee (delivery).
    - Tax per line rate, applied after discounts.
    - Total.
  - Operations:
    - Add, update and remove lines. Removing or reducing below the quantity already sent to the kitchen needs `restaurant/tickets/void` and writes a void-log row: user, time, ticket, product, qty, price, reason.
    - Transfer to a free table.
    - Merge A into B: the lines move, and A is voided as merged with `mergedIntoId`. A's invoice discount is added to B's.
    - Split: the selected quantities move to a new ticket on the same table, together with their sent quantity, their share of the discounts and their combo components. The new ticket is then paid on its own. An equal-split preview is also available.
    - Assign a driver.
    - Void (permission plus reason, open tickets only). Every item goes to the void log, and items already sent to the kitchen are cancelled there.
- **Payment** (`POST tickets/:id/pay`):
  - Changes not yet sent to the kitchen (new items and cancellations) are sent first.
  - The sale is then recorded through `PosService.createOrder`, with:
    - Explicit unit prices, tax rates and per-line discounts that include the invoice-discount share.
    - A zero-price line for each addon stock product.
    - The service charge and the delivery fee as lines on their products.
    - `clientReference = restaurant-ticket-<id>`, so a retried payment is idempotent.
    - `applyPromotions: false`, because ticket prices are final.
  - Stock, COGS, VAT and the cash/card posting reuse the POS logic. Stock is deducted only here, once.
  - The ticket stores `posOrderId`. The sale must equal the ticket total, otherwise the request fails and is rolled back.
  - A partial payment works by splitting the ticket. Each payment then settles a whole ticket.
- **Kitchen**
  - `send-to-kitchen` creates one kitchen ticket per station containing only the delta (qty − sentQty) per line. Cancellations of items already sent go on separate tickets (`isCancellation`).
  - `sentQty` is saved, so a second send prints nothing new.
  - Lines reduced to 0 are deleted once their cancellation has been sent.
  - Statuses are `new → preparing → ready → served` and `cancelled`, with timestamps. Moving forward skips steps and fills in the timestamps that were skipped.
  - The KDS lists active tickets per station, each with its age, a colour level (green/yellow/orange/red) and a `late` flag (ready, or now, minus created ≥ the red threshold).
  - The events `restaurant.kitchen.created` and `restaurant.kitchen.updated` are emitted to the tenant room through the realtime gateway. Emission is best-effort.
- **Reports**
  - Driver commission statement: delivery tickets, sales (net of tax, excluding the fee), delivery fees and commission on the driver's basis.
  - Delivery-app sales and the commission due (% of net item sales).
  - Void log, filtered by date, user and ticket.
  - Table turnover (tickets, guests, sales and average stay per table) plus a summary of the tickets open right now by order type.
  - Kitchen preparation times per station: average wait, average and maximum preparation time, and late count.

## Endpoints (`/api/v1/restaurant`)

| Area | Endpoints |
|---|---|
| Areas / tables | `GET/POST /areas`, `PATCH /areas/:id`, `GET /tables?areaId` (with `occupied` and `openTickets`), `POST /tables`, `PATCH /tables/:id` |
| Zones / drivers | `GET/POST /zones`, `PATCH /zones/:id`, `GET/POST /drivers`, `PATCH /drivers/:id` |
| Delivery apps | `GET/POST /apps`, `PATCH /apps/:id`, `GET/PUT /apps/:id/prices`, `DELETE /apps/:id/prices/:productId` |
| Stations / routing | `GET/POST /stations`, `PATCH /stations/:id`, `GET /kitchen-routes`, `PUT /kitchen-routes` (`{productId or categoryId, stationIds[]}`) |
| Modifiers / combos | `GET /modifiers?productId`, `POST /modifiers`, `PATCH/DELETE /modifiers/:id`, `GET /combo-groups?comboProductId`, `POST /combo-groups`, `PATCH/DELETE /combo-groups/:id` |
| Settings | `GET/PATCH /settings` |
| Tickets | `GET /tickets` (`?status&orderType&tableId&driverId&from&to`), `POST /tickets`, `GET/PATCH /tickets/:id`, `POST /tickets/:id/lines`, `PATCH/DELETE /tickets/:id/lines/:lineId` (`?reason`), `POST /tickets/:id/transfer`, `POST /tickets/:id/merge`, `POST /tickets/:id/split`, `GET /tickets/:id/split-preview?ways=n`, `POST /tickets/:id/driver`, `POST /tickets/:id/void`, `POST /tickets/:id/send-to-kitchen`, `GET /tickets/:id/kitchen-tickets`, `POST /tickets/:id/pay` |
| Kitchen | `GET /kitchen/kds?stationId`, `POST /kitchen/tickets/:id/status` |
| Reports | `GET /reports/driver-commissions?from&to&driverId`, `GET /reports/delivery-apps?from&to`, `GET /reports/void-log?from&to&userId&ticketId`, `GET /reports/table-turnover?from&to`, `GET /reports/kitchen-times?from&to` |

## Posting rules

The restaurant module posts nothing itself. Paying a ticket creates a POS sale, and `PosService` posts it as usual:

| Event | Entry |
|---|---|
| Ticket paid | Dr cash and/or bank / Cr sales (items, service charge line, delivery fee line, all net of discounts) + Cr output VAT; Dr COGS / Cr inventory for components, addon stock products and plain items issued from the terminal warehouse. The combo product itself is not issued. |
| Ticket voided / items removed | No entry (nothing was sold or issued). |

To refund a paid ticket, use the POS refund of its `posOrderId`.

## Change to the POS (shared file)

`PosService.createOrder(tenantId, actor, dto, options?)` takes a new optional `PosOrderOptions`:

- `trustedPrices`: skips the terminal discount limit and the tenant manual-discount limit of the promotions engine. The caller has already authorized the prices, for example zero-priced combo components, addon stock lines or a discount given by a user with `restaurant/tickets/discount`.
- `skipStockLines`: indexes of `dto.lines` whose product is not issued from stock. This is used for the combo product.

Existing callers are unaffected.

## Deliberate differences from Instasoft

- The service charge applies to dine-in only. Instasoft also charged it on pickup.
- Stock is deducted once, at payment. Instasoft deducted it on every hold or save, so stock was deducted twice.
- The quantity sent to the kitchen is saved on the line (`sentQty`). Instasoft kept it in memory and printed items again.
- Driver commission is computed on sales or on delivery fees. Instasoft used profit, which was always 0.
- Tax is computed per product rate after discounts. The service charge and the delivery fee carry their own products' tax rate.
- Table occupancy is derived from open tickets instead of a status flag that could drift.
- Voiding a ticket or removing items already sent is controlled by a permission and logged, with the reason.

## Still missing

- **Table minimum charge.** It is stored but not enforced or charged.
- **Recipe consumption.** A `without` ingredient is recorded for information only. The POS issues the sold product itself and has no recipe/BOM explosion, so there is no ingredient consumption to skip yet.
- **Discount permission in the role editor.** `restaurant/tickets/discount` is checked in code, like `pos/discounts/override`, so it does not appear in the permission catalog, which is built from the decorators. It has to be added to roles by name.
- **Partial payments on one ticket.** A ticket is paid in full. To pay in parts, split it first.
- **Delivery app settlement.** The aggregator receivable and its commission are not posted. The report gives the amount due, and the sale is posted as cash/card at payment.
- **Driver cash and commission postings.** Driver cash custody and posting the commission to payroll (through `employeeId`) are not built.
- **Kitchen printing.** Only the printer name is stored. The KDS polls and receives the realtime events.
- **Reservations.** There are no reservations or table layouts (coordinates and shapes).
