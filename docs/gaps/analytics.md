# Business analytics, insights and alerts (التحليلات والتنبيهات)

Scope: `erp-backend/src/modules/analytics/` (`AnalyticsModule`), ported from Instasoft
`module/analytics.vb`, `setting_alert` and `QustAlerts`. Permission module `analytics`, screens
`dashboard`, `insights`, `alerts`; profit/cost figures need `analytics/profit/read`.

## What was built

### Scope and data
- Every endpoint takes `from` / `to` (default first of the month → today), optional `branchId` and
  `warehouseId`. The comparison period has the same length and ends the day before `from`.
- Sales come from the reports module (`SalesAnalysisService.salesFacts`, not duplicated): posted
  sales invoices net of credit notes + POS orders net of refunds, untaxed, base currency, cost
  from the delivering stock moves (product cost fallback). A document with a negative net is a
  return (credit note / POS refund). `salesFacts` gained an optional `warehouseId` filter
  (invoice → its sales order's warehouse, POS → terminal warehouse) and a per-line `discount`.
- Stock: `stocks` in the warehouses in scope (branch → its warehouses), valued at product cost
  price like the inventory reports. Purchases reuse `purchaseAnalysis` totals. Expenses are
  posted GL lines on `expense` accounts minus the COGS / purchases / purchase returns / sales
  returns / sales discount default accounts, closing entries excluded (`ledger-sql.ts` helpers).

### Computations (pure functions in `services/analytics-calculator.ts`, unit-tested)
| # | Item | Rule |
|---|---|---|
| 1 | KPI | sales, returns, net sales, cost, gross profit, margin %, qty sold, distinct items, invoice count, average invoice, purchases, expenses — each with previous value and change % (0 when previous = 0); stock value, out-of-stock, low / slow / overstock counts |
| 2 | Slow-moving | on hand > 0 and never sold (`daysSinceLastSale = null`) or last sale ≥ `stagnationDays` ago (all-time last sale vs today); sorted by stock value |
| 3 | Low stock | `dailyRate = qtySold / days`, `daysCover = onHand / dailyRate`; status `out_of_stock` (≤ 0), `below_minimum` (≤ reorder level), `running_out` (cover ≤ `lowCoverDays`, 14) |
| 4 | Overstock | on hand > 0, sold > 0, cover ≥ `overstockDays` (90) |
| 5 | Items | per product vs previous period; top selling, top profit, high-sales-low-margin (sales ≥ median, margin < average), high-margin-low-sales, declining (prev > 0 and change < 0, including items not sold any more = −100%), profit losers (profit decreased) |
| 6 | Categories | same metrics by category, with share of sales |
| 7 | Purchase suggestions | `ceil(dailyRate × coverDays − (onHand + open PO qty))`, expected cost = qty × cost price; `coverDays` 30. Separate from the min/max replenishment in purchasing |
| 8 | Customers | top (count, sales, profit, last purchase, days since, prev sales, change %), lost (bought in previous period, nothing now), stagnant (active, nothing in the period; last purchase ever), concentration (top / top-5 share) |
| 9 | Returns, daily trend, users | returns per product with return % of sales; per-day sales/returns/profit/average; per user count, sales, returns, discounts, average |
| 10 | Insights | cards `{code, severity, title{ar,en}, message{ar,en}, action, target, value}` sorted critical → warning → info → good; one "good" card when nothing fires |
| 11 | Alerts | live evaluation + notifications (below) |

Insight rules (thresholds in `analytics_settings`, defaults): sales change ≤ −5% warning / ≥ +5%
good; gross profit change ≤ −5% critical with causes (sales down, margin down, returns up); margin
drop > 2 points warning; out of stock critical; low stock warning; slow stock warning (critical
when slow value > 25% of stock value); overstock info; high-margin-low-sales good;
high-sales-low-margin warning; top item ≥ 30% warning; top customer ≥ 25% warning; lost
customers warning; returns ≥ 5% of sales warning; expenses ≥ gross profit critical, ≥ 60%
warning; reorder suggestions info; POS session cash difference (sum of |difference| per user of
sessions closed in the period) ≥ 1 critical; negative cash/bank treasury balance (GL) critical.

### Alerts
Rules with toggle + threshold in `analytics_settings`: customer over credit limit; customer
balance above threshold; supplier balance above threshold; month-to-date expenses above threshold;
negative treasury balance; negative stock; lots expiring within N days (30; expired lots make it
critical); installments overdue / due today / due within N days (7) on active plans; received
cheques in portfolio / under collection and issued cheques due within N days (3) or overdue.
A threshold of 0 disables the balance / expense rules.

`POST /analytics/alerts/run` creates one notification per alert code and recipient per day
(`notifications.data.dedupKey = analytics:<code>:<date>`, items in `data.items`). Recipients:
`notifyUserIds`, or every active user holding `analytics/alerts/read`.
Optional background job (same pattern as the compliance poller, no new infrastructure):
`ANALYTICS_ALERTS_INTERVAL_SEC > 0` runs the alerts of tenants with `autoNotify` on; the daily
de-duplication makes any interval at most daily.

### Profit visibility
Without `analytics/profit/read`: cost, profit, margin, stock value and expected-cost fields are
removed (JSON and Excel columns), the margin-based item lists are empty, and profit / margin /
expense-vs-profit / margin-quadrant insight rules are skipped.

## Endpoints (`/api/v1/analytics`)
List endpoints accept `?format=xlsx&lang=ar|en` (reports export helper).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard` | dashboard/read | KPI + top 5 items/customers + daily trend |
| GET | `/kpi` | dashboard/read | |
| GET | `/slow-moving` | dashboard/read | `stagnationDays` |
| GET | `/low-stock` | dashboard/read | `lowCoverDays` |
| GET | `/overstock` | dashboard/read | `overstockDays` |
| GET | `/items` | dashboard/read | `limit` for derived lists |
| GET | `/categories` | dashboard/read | |
| GET | `/purchase-suggestions` | dashboard/read | `coverDays` |
| GET | `/customers` | dashboard/read | |
| GET | `/returns` | dashboard/read | |
| GET | `/daily-sales` | dashboard/read | |
| GET | `/users` | dashboard/read | |
| GET | `/insights` | insights/read | |
| GET | `/alerts` | alerts/read | live |
| POST | `/alerts/run` | alerts/create | creates notifications |
| GET / PUT | `/settings` | alerts/read / alerts/update | thresholds and alert rules |

## Posting rules
None (read-only module).

## Schema additions
- `analytics_settings` (one row per tenant): list defaults, insight thresholds, alert toggles and
  thresholds, `auto_notify`, `notify_user_ids`.

## Deliberate differences from Instasoft
- Proper median (Instasoft took the upper middle value); average margin = mean of item margins of
  items sold in the period.
- Returns are netted per document; sales change uses net sales; slow-moving uses all-time last
  sale while respecting branch/warehouse scope.
- Out-of-stock only counts products stocked in scope, with a reorder level, or sold in the period
  (Instasoft counted every item, including never-stocked ones).
- Purchase suggestions deduct open purchase-order quantities.
- The alert settings are actually evaluated (Instasoft stored p1..p14 but never used them).

## Still missing
- Product-level `stagnationDays` and a maximum stock level (no such product columns; the
  above-maximum list is therefore not provided; the threshold comes from settings / query).
- Warehouse filter does not apply to purchases, expenses and invoices without a sales order.
- Treasury, shift and attendance analytics tabs of Instasoft (treasury movement, shift
  summary, employee costs) — partly covered by treasury / POS / HR reports.
- Per-item alert notifications (alerts are grouped per code).
