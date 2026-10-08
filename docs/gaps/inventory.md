# Inventory extensions

Scope: `erp-backend/src/modules/inventory/`. Permissions use module `inventory`,
screens `transfers`, `stocktaking`, `lots`, `units`, `reports` (plus the existing
`stock`, `products`, `warehouses`).

## What was built

### Warehouse transfers (تحويل مخزني)
Document `stock_transfers` / `stock_transfer_lines` (number `TRF-000001`).
`draft -> in_transit (ship) -> done (receive)`, or one step (`direct: true` on
create, or `POST :id/validate`).
- Ship issues the stock from the source at the current average cost (stored on
  the line) and records the lots shipped (FEFO unless lots are given; expired
  lots move only when named explicitly).
- Receive is full or partial (per line, optional lots among those shipped,
  FEFO otherwise); goods are received at the shipping cost, so there is no P&L
  impact. Done when everything shipped is received.
- Cancel: drafts, or shipments with nothing received yet (stock and lots go
  back to the source).
- Line quantities may be given in an alternate unit (`unitId`).
- The list/detail return `inTransitQty` / `inTransitValue`.

Posting: none when both warehouses are in the same branch. Different branches:
each receipt posts Dr inventory (destination branch tag) / Cr inventory
(source branch tag), `sourceType = stock_transfer`.

The old one-line `POST /inventory/stock/transfer` still works (now moves lots).

### Stocktaking (جرد)
`stock_counts` / `stock_count_lines` (number `CNT-000001`).
- Create snapshots the system quantity of a warehouse, optionally one category
  (sub-categories included) or a product list; tracked products get one line per
  lot plus a line for any untracked remainder. By default only products with a
  stock record are listed (`includeAllProducts` lists every active good).
- `PUT :id/lines` enters counted quantities in bulk by line id, product (+ lot)
  or barcode (alternate unit barcodes are converted); `accumulate` adds to the
  previous count; unknown lots/products are added as new lines.
- Detail shows difference qty/value per line, gain/loss/net summary, and
  warnings: lines moved since the snapshot (no locking) and other open counts on
  the same warehouse.
- Validate adjusts each line to its counted quantity against the stock at
  validation time (uncounted lines skipped, or zero with `zeroUncounted`), using
  `StockService.adjust` without per-line posting, then posts the net value once:
  gain Dr inventory / Cr stockAdjustment, loss the reverse (`sourceType = stock_count`).

### Lots, batches, expiry and serial numbers
- Product flags `trackingType` (`none|lot|serial`) and `hasExpiry` (requires tracking).
- `stock_lots` (product, warehouse, lot number, expiry, quantity) and
  `stock_lot_movements` (lot journal for traceability, linked to the stock movement).
  `stocks` stays the warehouse total; stock received before tracking was
  enabled is the untracked remainder.
- Incoming: `StockService.receive` accepts optional `lots`. The explicit API
  `POST /inventory/stock/receive` (manual receipt, posts Dr inventory / Cr
  stockAdjustment) rejects tracked products without lots and lots without
  expiry for `hasExpiry` products. For backward compatibility the generic
  receive path (purchase receipts, POS refunds, returns) auto-creates a lot named
  after the reference (last token of the description, e.g. `PO-000012`), or
  serials `PO-000012-001...` for serial products.
- Outgoing: `issue` consumes lots FEFO automatically (expired lots skipped for
  sales/POS/transfers, included for negative adjustments) unless lots are given;
  returns the consumed lots. Serial numbers are unique per product in stock and
  always quantity 1.
- Reports: lots list, expiring within N days (default tenant `expiryAlertDays`, 30),
  expired stock with value, lot trace (origin, every move, balances).

### Units of measure
`product_units` (product, unit, factor to base unit, barcode, optional sell price).
`ProductsService.toBaseQuantity(tenantId, productId, qty, unitId?)` /
`unitFactor(...)` (also `StockService.toBaseQuantity`) for sales/purchasing; falls
back to the global `units.base_unit_id/conversion_factor`. Barcode lookup searches
product barcodes, then alternate unit barcodes, then code/SKU, and returns
product, unit, factor and price (unit price or product price x factor). Barcodes
are unique across products and product units.

### Item card (كارت الصنف)
Per product (+ optional warehouse) and date range: opening qty/value, each
movement with in/out, unit cost, value, running qty, value and average cost,
period totals and closing balance. Values use the cost stored on each move.

### Reports
Stock balance by warehouse with value; slow-moving (in stock, no issue in N
days, `noMovement` when nothing moved at all); negative stock check (negative
quantities and lots exceeding the warehouse quantity); reorder report
(available <= reorder level, suggested qty = max(reorder qty, level - available)).

### Negative stock setting
Previously negative stock was always blocked. Now a tenant option
`tenants.settings.inventory.allowNegativeStock` (default false, so behaviour is
unchanged) is read by issue, transfer and adjustment.

## Endpoints (`/api/v1`)
- `POST|GET /inventory/transfers`, `GET /inventory/transfers/:id`,
  `POST /inventory/transfers/:id/ship|receive|validate|cancel`
- `POST|GET /inventory/stock-counts`, `GET /inventory/stock-counts/:id`,
  `PUT /inventory/stock-counts/:id/lines`, `POST /inventory/stock-counts/:id/validate|cancel`
- `POST /inventory/stock/receive` (explicit lots), `POST /inventory/stock/adjust`
  and `/stock/transfer` accept optional `lots`
- `GET /inventory/lots`, `/inventory/lots/expiring?days=`, `/inventory/lots/expired`,
  `/inventory/lots/trace?productId=&lotNumber=`
- `GET|POST /inventory/products/:id/units`, `DELETE /inventory/products/:id/units/:productUnitId`,
  `GET /inventory/products/:id/convert?quantity=&unitId=`, `GET /inventory/products/barcode/:code`
- `GET /inventory/reports/item-card?productId=&warehouseId=&from=&to=`,
  `/inventory/reports/stock-balance`, `/slow-moving?days=`, `/negative-stock`, `/reorder`
- `GET|PUT /inventory/settings` (`allowNegativeStock`, `expiryAlertDays`)

## StockService compatibility
All public signatures are unchanged; additions are optional: `lots` on move
requests, an `options` argument on `receive`, `issue` and `adjust`, `lots` in the
`issue` result, and the new `manualReceipt`, `toBaseQuantity` and
`allowNegativeStock` methods.

## Still missing
- Lots received automatically (no explicit lots) are not recorded on the
  purchase order line, so purchase returns of those goods use FEFO.
- Cancelling a sales return / un-building issues the goods at the current
  average cost (AVCO is per product); the difference to the recorded cost is
  posted to stock adjustment only for un-builds.
- Average cost is per product (all warehouses), not per warehouse; no FIFO.
- No stock locking during counts (warnings only); no count approval step or
  printed count sheets.
- Goods in transit are not on a separate GL account; the valuation report
  excludes them (see `inTransitValue` on transfers).
- No putaway/removal rules other than FEFO, no multi-step routes. Landed costs are built in purchasing (`/purchasing/landed-costs`, see sales-purchasing.md).
- Lot attributes beyond number/expiry (manufacturing date, supplier lot) are not stored.

## Phase 2: units and lots on documents (operations integration)

### Alternate units on document lines
Sales orders, sales invoices (and credit notes), purchase orders, vendor bills (and
refunds), sales/purchase returns and POS lines accept an optional `unitId` (an
alternate unit from `product_units`, or a global unit converting to the base
unit). The line keeps `quantity` and `unitPrice` in that unit and stores
`unit_id` and `unit_factor` (base units per line unit; 1 for the base unit).
All tracked quantities of the line (`qty_delivered`, `qty_invoiced`,
`qty_received`, `qty_billed`, `qty_returned`, `refunded_qty`) are in the line
unit; `sales_order_lines.qty_reserved` is a stock reservation in base units.
Stock moves, reservations and costs use `quantity x unit_factor`. Costs
(`unit_cost` on return/POS lines, receipt costs) are per base unit; a receipt
of 2 cartons at 96 updates AVCO at 8 per piece.
- Pricing: lines without a price in an alternate unit are priced from the
  price list on the base quantity times the factor; with no price list the
  unit's own `sell_price` is used when set. Minimum selling prices are checked
  per base unit.
- Documents derived from others (order -> invoice, invoice -> credit note,
  order -> bill, bill -> refund, invoice/bill -> return) carry the unit and
  the stored factor.
- POS: a line can give `barcode` instead of `productId`; the inventory barcode
  lookup sets the product, the scanned unit and its price (unit price, else
  product price x factor). Refund lines take `lineId`, or `productId` (+
  `unitId`) with quantities in the unit of the sale line.

### Lots/serials on documents
Optional `lots: [{lotNumber, quantity (base unit), expiryDate?}]` on:
sales order delivery lines (`POST /sales/orders/:id/deliver`), purchase order
receipt lines (`POST /purchasing/orders/:id/receive`), POS lines and refund
lines, sales/purchase return lines, production runs (`consumption[].lots` for
components consumed and by-products produced, `lots` for the finished
product). Without lots the previous behaviour applies (FEFO on issue,
automatic lot named after the document on receipt).
- The lots actually issued are stored on the document: `sales_order_lines.lots`,
  `pos_order_lines.lots`, `purchase_order_lines.lots` (received),
  `sales_return_lines.lots` / `purchase_return_lines.lots`,
  `mfg_production_records.moves[].lots` and `output_lots`.
- **Restoring the original lots**: POS refunds and sales returns of tracked
  products put back the lots/serials recorded on the sale (sales return: the
  sales order delivery behind the invoice line), minus those already brought
  back (`sales_order_lines.lots_returned`, `pos_order_lines.lots_refunded`).
  Explicit lots on a refund/return must be among them (an unknown serial is
  refused). When nothing was recorded (sold before lots were tracked, invoice
  not delivered through an order) the automatic lot is used as before.

### Per-warehouse negative stock
`warehouses.allow_negative_stock` (true / false / null = tenant setting) is
honoured by every issue, transfer and adjustment (`StockService` passes the
warehouse to `InventorySettingsService.allowNegativeStock(tenantId,
warehouseId)`), hence by all document paths above. Un-building and cancelling
a sales return additionally require the goods to be available regardless of
the policy. Set it with `POST/PATCH /inventory/warehouses` (`allowNegativeStock`).

New helpers: `services/document-units.util.ts` (`resolveLineUnits`, `toBaseQty`),
`services/document-lots.util.ts` (`pickReturnLots`, `addLots`, `subtractLots`),
`ProductsService.resolveLineUnit`, `StockService.availableQuantity`.
