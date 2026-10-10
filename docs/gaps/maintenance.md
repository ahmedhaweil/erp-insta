# Maintenance / repair service center (الصيانة)

Module: `erp-backend/src/modules/maintenance/`.
Permissions module `maintenance`, screens `technicians`, `tickets`, `settings`, `reports`. Invoicing also needs `sales/invoices/create`.

## What was built

- **Technicians** (`nameAr`, `nameEn`, phone, optional `employeeId` / `userId`, active flag).
- **Maintenance settings** (one row per tenant): default labour service product, default parts warehouse, walk-in customer used to invoice tickets with no customer, and `pricesIncludeTax` (ticket prices passed to the invoice as VAT inclusive).
- **Repair tickets** `RPR-000001`:
  - Customer: an optional `customerId`, plus free-text name, phone and address for walk-ins.
  - Type `in_shop` / `on_site`.
  - Device: name, brand, model, serial number, accessories received.
  - Problem and diagnosis.
  - Dates: received, promised, appointment.
  - Technician.
  - Cost control: estimated cost, `maxApprovedCost` ceiling, `customerApproved` flag with its date.
  - Warranty flag and warranty end date. Notes. Optional warehouse.
- **Status machine** (Instasoft had a free-text status). It lives in `services/ticket-status.ts`:

  | From | Allowed to |
  |---|---|
  | received | diagnosing, cancelled, rescheduled |
  | diagnosing | awaiting_approval, in_repair, ready (nothing to repair), cancelled, rescheduled |
  | awaiting_approval | diagnosing, in_repair, cancelled, rescheduled |
  | in_repair | awaiting_approval (extra work), ready, cancelled, rescheduled |
  | ready | in_repair (rework), delivered, cancelled, rescheduled |
  | rescheduled | only back to the state it was parked from, or cancelled, or rescheduled again |
  | delivered, cancelled | final |

  - Entering `in_repair`, except as rework from `ready`, needs the customer approval, unless the ticket is under warranty.
  - `delivered` needs a linked, non-cancelled sales invoice, unless the ticket is under warranty or its total is zero.
  - `cancelled` releases the stock reservations. It is refused while a valid invoice is linked; cancel the invoice with a credit note first.
  - `rescheduled` is set through `POST tickets/:id/reschedule`. That call sets the new appointment date (and optionally the promised date) and stores `previousStatus`. Resuming works through the normal status endpoint.
  - Every change, approval and invoicing writes a **status history** row with the user, time, from, to and a note.
- **Parts and labour lines**:
  - Part lines take a product and quantity. Price and tax rate default from the product. `reserve: true` reserves the quantity in the ticket or default warehouse; the reservation is released when the line is removed or the ticket is cancelled, and consumed when the parts are issued.
  - Labour lines take a description and amount, plus an optional service product and technician.
  - Adding a line that would push the ticket total above `maxApprovedCost` is refused. Update the approval first with `POST tickets/:id/approval`, which refuses a ceiling below the current total.
  - Lines are locked once the ticket is invoiced, delivered or cancelled.
- **Invoice** (`POST tickets/:id/invoice`):
  - Creates a sales invoice through `SalesInvoicesService.create` with `skipPriceChecks`, and posts it unless `post: false`.
  - The invoice is for the ticket customer, or the walk-in customer from the settings.
  - It has one line per part, and one line per labour entry on the line's own service product or the settings labour product. Labour without a service product is refused.
  - The ticket stores `salesInvoiceId`, `invoicedAmount` and `invoicedAt`. **A second invoice is refused** while the linked invoice is not cancelled. Instasoft never wrote the link back, which allowed double invoicing.
  - The parts are issued from stock and costed when the ticket is invoiced. If the ticket is delivered without an invoice (warranty or zero cost), they are issued on delivery instead. They are issued only once (`partsIssued`).
- **Calendar and control**:
  - `GET calendar?from&to` lists open tickets by appointment date, or by promised date when there is no appointment.
  - `GET overdue` lists tickets whose promised date has passed and which are not ready or delivered.
  - `GET workload` gives open and overdue tickets per technician, split by status.
- **Report** (`GET reports/summary?from&to`): tickets received by status, delivered count, average turnaround in days (received date to delivery time), and revenue per technician (invoice totals by invoicing date).

## Endpoints (`/api/v1/maintenance`)

| Area | Endpoints |
|---|---|
| Technicians | `GET/POST /technicians` (`?activeOnly`), `PATCH /technicians/:id` |
| Settings | `GET/PUT /settings` |
| Tickets | `GET/POST /tickets` (`?status&technicianId&customerId&from&to&search`), `GET/PATCH /tickets/:id` |
| Workflow | `POST /tickets/:id/status` `{status, note}`, `POST /tickets/:id/reschedule` `{appointmentDate, promisedDate?, note?}`, `POST /tickets/:id/approval` `{approved, maxApprovedCost?, note?}` |
| Lines | `POST /tickets/:id/parts`, `DELETE /tickets/:id/parts/:partId`, `POST /tickets/:id/labour`, `DELETE /tickets/:id/labour/:labourId` |
| Invoice | `POST /tickets/:id/invoice` `{date?, post?}` |
| Calendar / reports | `GET /calendar?from&to`, `GET /overdue`, `GET /workload`, `GET /reports/summary?from&to` |

## Posting rules

| Event | Entry |
|---|---|
| Ticket invoiced | Sales invoice posting (Dr receivable / Cr sales / Cr output VAT), done by the sales module, which also updates the customer balance |
| Parts issued (on invoice, or on delivery when not invoiced) | Dr cogs / Cr inventory at average cost (`sourceType: maintenance_ticket`) |

## Deliberate differences from Instasoft

- The status is a validated workflow with history, not free text.
- The invoice is linked back to the ticket and can only be issued once.
- Delivery is blocked until the ticket is invoiced, unless it is warranty or zero cost.
- A cost ceiling is approved by the customer and enforced.
- Spare parts actually leave stock and are costed.

## Still missing

- No printable job card or receipt, and no SMS or WhatsApp notification when the device is ready.
- Parts are priced and costed only; serial or lot selection for tracked parts relies on the stock defaults (FEFO).
- Customer deposits or advance payments on a ticket are not modelled. Use a customer receipt.
- Warranty claims against suppliers or manufacturers are not tracked.
- Technician commission on labour is not computed.
