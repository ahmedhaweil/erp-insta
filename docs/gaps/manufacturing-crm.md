# Manufacturing (التصنيع / المحاسبة الصناعية) and CRM

Two new backend modules: `erp-backend/src/modules/manufacturing` and
`erp-backend/src/modules/crm`. Permissions: module `manufacturing` (screens
`boms`, `production`) and module `crm` (screens `leads`, `activities`).

## Manufacturing

### What was built
- **Bills of materials** (`mfg_boms`, `mfg_bom_lines`): finished product, output
  quantity, components (quantity per output quantity, scrap %), optional
  by-products with a cost share %, fixed labour and overhead cost per finished
  unit, numbered versions with one active version per product (activate,
  deactivate, copy to a new version). Cycles through active sub-BOMs are rejected.
- **Multi-level explosion**: a component that has its own active BOM is replaced,
  recursively, by its components (scrap included), adding its labour/overhead.
  Used by the explode endpoint, MRP-lite and production orders created with
  `explode: true`.
- **Production orders** (`mfg_production_orders`, `..._lines`, `mfg_production_records`):
  draft -> confirmed (availability check in the source warehouse, refuses if short
  unless `allowShortage`, optional reservation through `StockService.reserve`,
  standard cost frozen at current average costs) -> in progress -> done, or
  cancelled (only before any production; releases reservations).
  `produce` records partial runs: components are issued from the source warehouse
  pro rata to the produced quantity, or with the actual quantities given
  (`consumption`, the variance); finished goods are received into the destination
  warehouse through `StockService.receive` at
  `(components + labour + overhead - by-product share) / produced qty`, which
  updates AVCO. By-products are received at their cost share. The order closes
  when the planned quantity is reached or with `finish`; leftover reservations are
  released. Service components are costed at their cost price and absorbed through
  the overhead account.
- **Scrap** (`mfg_scraps`): goods written off at average cost, optionally on a
  production order (consumes that order's reservation and is tracked as
  `scrapCost`).
- **Reports**: production cost per order (standard vs actual, per component usage
  and price variance), BOM cost roll-up at current costs (sub-assemblies at their
  rolled-up cost), production cost summary by period, and MRP-lite component
  requirements for a planned quantity (required vs on hand vs free vs open order
  demand vs to buy, rounded up to the product reorder quantity, with preferred
  supplier and estimated cost).

### Posting rules (AutoPostingService, journal type general)
| Event | Debit | Credit |
|---|---|---|
| Production run | `inventoryAccountId` (finished goods + by-products, total cost) | `inventoryAccountId` (components at average cost); `manufacturingOverheadAccountId` (labour + overhead + service components absorbed) |
| Scrap | `stockAdjustmentAccountId` | `inventoryAccountId` |

Source types: `production_order` (source id = production run record id) and
`mfg_scrap`. Preflight runs before any stock move. Skipped when the tenant has no
accounting settings.

### Endpoints (`/api/v1/manufacturing/...`)
- `POST|GET boms`, `GET|PATCH|DELETE boms/:id`, `POST boms/:id/activate`,
  `POST boms/:id/deactivate`, `POST boms/:id/new-version?activate=`,
  `GET boms/:id/explode?quantity=&multiLevel=`, `GET boms/:id/cost?quantity=`
- `POST|GET production-orders` (`?status=&productId=`), `GET|DELETE production-orders/:id`,
  `GET production-orders/:id/availability`, `POST production-orders/:id/confirm`
  `{reserve, allowShortage}`, `POST .../start`, `POST .../produce`
  `{quantity, date?, consumption?: [{productId, quantity}], finish?}`,
  `POST .../finish`, `POST .../cancel`, `GET .../cost`, `GET .../runs`
- `POST|GET scraps`
- `GET reports/requirements?bomId|productId&quantity&warehouseId&explode`
- `GET reports/production-costs?from&to`

### Still missing
- Work centers, routings/operations, capacity planning and time-based labour costing
  (labour/overhead are fixed amounts per unit).
- MRP does not plan by date (no lead times / scheduling).
- Work-in-progress account (production posts directly from components to finished
  goods).
- Quality checks and subcontracting.

## CRM

### What was built
- **Pipeline stages** (`crm_stages`) per tenant with sequence, default probability
  and a won flag; a default pipeline (New 10%, Qualified 30%, Proposition 60%,
  Negotiation 80%, Won 100%) is created on first use. Deleting a used stage archives it.
- **Leads / opportunities** (`crm_leads`): number `LEAD-`, type lead/opportunity,
  status open/won/lost, stage and probability (follows the stage, overridable),
  expected revenue and close date, source, salesperson (default creator), customer
  link or prospect contact info, lost reason. Actions: move stage, won, lost
  (reason required), reopen, convert to opportunity, convert to customer (creates
  the customer through the sales `CustomersService`, code from sequence `CUST`, or
  links an existing one), create quotation (draft sales order through
  `SalesOrdersService.create`, converting to a customer first if needed).
- **Activities** (`crm_activities`): call / meeting / task / email with due date on
  a lead and/or customer, assigned user (default: lead salesperson), done (with
  result) / cancelled, computed state `overdue` / `today` / `planned` / `done` /
  `cancelled`, and a my-activities endpoint.
- **Pipeline report**: per stage count, pipeline and weighted value; won/lost counts
  and values; win rate (won / (won + lost)); the same by salesperson; lost reasons.

### Endpoints (`/api/v1/crm/...`)
- `GET|POST stages`, `PATCH|DELETE stages/:id`
- `GET|POST leads` (`?status&type&stageId&assignedUserId&customerId&source&search`),
  `GET|PATCH|DELETE leads/:id`, `POST leads/:id/stage {stageId}`, `POST leads/:id/won`,
  `POST leads/:id/lost {reason}`, `POST leads/:id/reopen`,
  `POST leads/:id/convert-to-opportunity`, `POST leads/:id/convert-to-customer`,
  `POST leads/:id/quotation {lines, date?, validityDate?, warehouseId?, notes?}`
- `GET|POST activities` (`?leadId&customerId&assignedUserId&status&state`),
  `GET activities/my?state=`, `GET|PATCH|DELETE activities/:id`,
  `POST activities/:id/done {result?}`, `POST activities/:id/cancel`
- `GET reports/pipeline?from&to&assignedUserId`

No accounting postings in CRM.

### Still missing
- Email/WhatsApp integration and activity reminders/notifications.
- Lead scoring, duplicate detection, merge, campaigns and web-form capture.
- Linking the quotation outcome back automatically (won when the order is confirmed).
- Sales teams and targets.

## Manufacturing phase 2

- **MRP netting**: `GET manufacturing/reports/requirements` nets the free stock
  of each sub-assembly (on hand - reserved - open production demand, in the
  warehouse) before exploding it; only the uncovered quantity is exploded
  (`netSubAssemblies=false` to disable). The response lists
  `subAssembliesFromStock`. `BomsService.explode(..., { availableStock })`.
- **Shortages -> purchase requisition**:
  `POST manufacturing/reports/requirements/requisition`
  `{bomId|productId, quantity, warehouseId?, explode?, netSubAssemblies?, departmentName?, requiredDate?, notes?, submit?}`
  (permission purchasing/requisitions/create) creates a draft requisition
  through the purchasing `PurchaseRequisitionsService`: one line per shortage
  at the suggested quantity (reorder quantity rounding), estimated at average
  cost, with the preferred supplier; `submit: true` submits it.
- **Lots on production**: `produce` accepts `consumption[].lots` and `lots`
  (finished product); runs store the lots consumed/produced
  (`moves[].lots`, `output_lots`).
- **Un-build / reverse a run**: `POST manufacturing/production-orders/:id/runs/:runId/reverse {date?, reason?}`
  (manufacturing/production/update). Refused when the produced goods (finished
  product and by-products) are no longer available in the destination
  warehouse (already sold/consumed/reserved), whatever the negative-stock
  policy, or when the run is already reversed. Finished goods and by-products
  leave stock with their recorded lots, components return to the source
  warehouse with their lots at the cost they were consumed at, the
  `production_order` entry of the run is reversed, and the difference between
  the current average cost taken out and the recorded run cost is posted
  Dr/Cr stockAdjustment vs inventory (`production_unbuild`). Order quantities
  and actual costs are reduced; a done order reopens (in progress, or
  confirmed when nothing is left produced). New columns on
  `mfg_production_records`: `output_lots`, `reversed_at`, `reversed_by`,
  `reversal_difference`.

## Frontend (phase 2)

Bilingual screens (Arabic RTL default, English), menu groups "Manufacturing" (order 55) and "CRM"
(order 45) in `src/components/layout/nav/people.ts`.

- Manufacturing (`/manufacturing/...`): BOM list and editor (components with scrap %, by-products
  with cost share %, labour/overhead per unit, activate/deactivate, new version, delete), structure
  tree (multi-level explosion) and cost roll-up tabs; production orders (create from product/BOM,
  availability, confirm with reserve / allow shortage, start, partial production with actual
  consumption per line and optional close, finish, cancel, delete draft, cost/variance report,
  production runs, scrap); scrap list/entry; MRP requirements report; production cost report.
- CRM (`/crm/...`): kanban pipeline by stage with native HTML5 drag and drop calling
  `POST /crm/leads/:id/stage` (optimistic update, rollback on error), quick add per stage; leads list
  with filters; lead form with won/lost (reason)/reopen, convert to opportunity, convert to customer
  (new or existing), create quotation (lines), lead activities; my activities with
  overdue/today/planned/done/cancelled tabs (done with result, cancel), stages admin, pipeline report.

Known backend issue found by the UI: `GET /crm/leads` returns 500 ("Cannot read properties of
undefined (reading 'databaseName')") because `CrmLeadsService.findAll` orders by the column name
`l.created_at` together with joins and `take()`; it must order by the property path
`l.createdAt`. The pipeline, leads list and activities lead lookup depend on it.
