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
- Sales/purchase/POS documents do not yet pass lots or units: they rely on the
  automatic lot on receipt and FEFO on issue. POS refunds of serial products
  get new serials instead of the original ones.
- Average cost is per product (all warehouses), not per warehouse; no FIFO.
- No stock locking during counts (warnings only); no count approval step or
  printed count sheets.
- Goods in transit are not on a separate GL account; the valuation report
  excludes them (see `inTransitValue` on transfers).
- No putaway/removal rules other than FEFO, no multi-step routes, no landed costs.
- Lot attributes beyond number/expiry (manufacturing date, supplier lot) are not stored.
