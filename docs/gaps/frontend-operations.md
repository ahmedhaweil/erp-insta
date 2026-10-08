# Frontend: operations screens (inventory, sales, purchasing, POS, compliance)

Scope: `erp-frontend/` only. Every screen is bilingual (Arabic RTL default,
English); texts live in `src/i18n/messages/{ar,en}/operations.json` under the
`ops.*` namespace plus the `nav.*` labels of the menu items.

## Structure
- Services: `src/services/operations-*.service.ts` (thin wrappers over `api`,
  unwrapping `{success, data}`), `operations-api.ts` (`ops.get/post/...`,
  `apiError`).
- Hooks: `src/hooks/use-operations.ts` (`useOpsQuery`, `useOpsMutation` with
  translated toasts and query invalidation, shared lookup lists).
- Components: `src/components/operations/` (config-driven `EntityForm`,
  `LinesEditor` for document lines, `LineQtyModal` for partial operations,
  `LotsInput`, status badges, tabs, cards, POS and compliance helpers).
- Menu: `src/components/layout/nav/operations.ts`.

## Screens
Inventory (`/inventory/...`)
- `products`: full product form (type, tracking none/lot/serial, expiry flag,
  cost/sell/minimum sell price, sales/purchase tax rates, reorder level/qty,
  preferred supplier) and an "units & barcodes" dialog for alternate units.
- `categories`: categories and units of measure (with reference unit/factor).
- `warehouses`, `stock` (balance per warehouse with value, movements, manual
  adjustment and receipt with lots), `transfers` (create incl. lots/direct,
  ship, receive partially, validate, cancel), `stock-counts` and
  `stock-counts/[id]` (barcode entry with accumulate, manual counts,
  extra lot lines, differences and gain/loss values, validate with
  "zero uncounted", cancel), `lots` (all / expiring / expired / trace),
  `item-card`, `reports` (slow moving, negative stock + lot mismatches,
  reorder), `settings`.

Sales (`/sales/...`)
- `customers` (category, price list, sales rep, credit limit, payment terms,
  balance highlighted above the limit), `customer-categories`,
  `price-lists` (rules by product / category / all with min quantity and
  validity, plus a price checker calling `GET /sales/pricing/price`),
  `reps` (reps, commission rules, statement preview / create / post / cancel),
  `orders` (quotation -> sent -> confirmed -> deliver from a chosen warehouse,
  partial by line -> invoice by ordered/delivered policy), `invoices` (direct
  invoice, post, register payment through `POST /payments`, mark paid, credit
  note by line, cancel, return, installment plan), `returns` (from an invoice
  or cash return without invoice, post, cancel), `installments` (plans with
  schedule, recompute/cancel, due & overdue list, customer statement).

Purchasing (`/purchasing/...`)
- `suppliers`, `requisitions` (submit, approve/reject with reason, convert to
  RFQs with a default supplier), `orders` (RFQ, send, confirm -> `to_approve`
  when above the threshold, approve/reject, receive partially into a
  warehouse, bill), `invoices` (vendor bills: direct bill, approve, register
  payment, mark paid, refund by line, cancel, return), `returns`,
  `replenishment` (suggestions + generate RFQs for all or selected products),
  `settings` (PO approval threshold, requisition approval).

POS (`/pos`, `/pos/terminals`)
- Till: terminal picker and opening cash; product grid with category chips
  and search; barcode input (local barcode/code first, then
  `GET /inventory/products/barcode/:code`, alternate-unit barcodes add the
  unit's factor at the unit price); cart with qty +/-, price and discount %
  (warning above the terminal `maxDiscountPercent`); cash / card / split
  payment with quick-cash buttons and change; walk-in or named customer.
- Every sale gets a `clientReference` (`crypto.randomUUID`, with a fallback
  for non-secure contexts). If the server is unreachable the sale is stored in
  `localStorage` (`ops.pos.queue`) and resent on the `online` event, every 30 s
  and on page load; server-side rejections stay in the queue flagged with the
  error (retry / discard). The backend dedupes by `clientReference`, so
  resending is safe. Closing the session is blocked while sales are queued.
- Session orders with partial refunds by line and e-receipt submission, cash
  in/out, X report, close with counted cash and the Z report (printable).
- The open session is kept in `localStorage` (`ops.pos.session`); a session
  can be resumed by ID.
- Terminals admin (branch, warehouse, max discount %, devices, active).

Compliance (`/compliance/...`)
- `settings`: country EG/SA, taxpayer and address, ETA (environment, client
  id, signer URL, document version, default unit/tax subtype, unit-code map,
  POS devices) or ZATCA (environment, certificate, simplified default).
  Secrets (`etaClientSecret`, `zatcaCsidSecret`, `zatcaPrivateKey`, device
  pre-shared key / client secret) are write-only: the page only shows
  "a value is stored", an empty input keeps it and a checkbox clears it.
- `tax-config`, `item-codes` (mapped / products without code), `tax-profiles`
  (receiver type, identifier, address per customer), `e-invoices` (server-side
  filters and paging, submit with preview, refresh, refresh all pending,
  cancel with reason, QR / print view, authority messages), `e-receipts`.

## Still missing / backend gaps found
- No `GET /pos/sessions` (current open session of a terminal / session list):
  a till whose browser storage was cleared can only resume by session ID, and
  there is no session history screen.
- No global POS order list (`GET /pos/orders`): refunds and e-receipts are only
  reachable from the current session.
- Categories and units have no update / delete endpoints.
- `PATCH /sales/customers/:id`, `/purchasing/suppliers/:id` and
  `/inventory/products/:id` take `Partial<CreateDto>` (a TS type), so their
  bodies are not validated or whitelisted.
- `GET /compliance/e-invoices/preview/:id` has no invoice-type parameter, so
  the UI previews sales documents only.
- Backend warnings / error messages are English only.
- Stock movements have no date filter or paging.
