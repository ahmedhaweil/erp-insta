# Printable documents (PDF)

Module `erp-backend/src/modules/printing/`. Every endpoint returns `application/pdf`
(`Content-Disposition: inline`, or `?disposition=attachment`), accepts `?lang=ar|en`
(Arabic, right-to-left by default) and, where noted, `?paper=a4|80mm`. Access reuses the read
permission of the source document. Nothing is written except cheque layouts.

## Arabic rendering

- **Font**: Amiri Regular/Bold (SIL Open Font License 1.1) bundled in `erp-backend/assets/fonts/`
  with `OFL.txt`; Amiri covers Arabic and Latin, so bilingual lines use one font. The production
  Docker image copies `assets/` (`docker/Dockerfile`). `PRINT_FONTS_DIR` overrides the location.
- **Shaping**: PDFKit lays text out with fontkit, which applies the font's OpenType Arabic features
  (initial/medial/final forms, lam-alef ligatures, marks) to each word. This was verified visually
  (PDF -> PNG with `pdftoppm`): letters are joined, lam-alef and Allah ligatures are formed.
- **Ordering**: PDFKit keeps words in logical order, so a sentence would print backwards.
  `engine/bidi-text.ts` runs the Unicode Bidirectional Algorithm (`bidi-js`) on each line and
  draws "visual chunks" left to right: Arabic words in logical order (fontkit shapes and flips
  them), numbers / Latin runs left to right, brackets mirrored. `ltr(value)` wraps dates, numbers
  and codes in an LTR isolate where they follow Arabic words in the same line (otherwise UBA shows
  `2026-10-08` as `08-10-2026`). In English documents an Arabic value keeps its own RTL direction.
- **QR codes**: drawn as vector squares from `qrcode`'s matrix (no raster image).
- New dependencies: `bidi-js@1.0.3`, `qrcode@1.5.4` (pinned in `package.json`).

## Architecture (data driven)

`builders/*` map business records (through plain "views" loaded by `PrintDataService`) to a
`PrintDocument` (title, company header, meta fields, party boxes, tables, totals, amount in
words, QR, references, notes, signatures). The renderers know nothing about invoices:

- `templates/a4-renderer.ts`: letterhead (tenant name, tax number, C.R., address, phone, email,
  branch; remote logos are not downloaded), meta grid, party boxes, tables with page breaks and
  repeated headers, totals + QR, amount in words, notes, signatures, footer on every page
  (page x of y, print time, document number). Portrait or landscape; `renderA4Batch` prints
  several documents in one PDF with their own page numbering.
- `templates/receipt-renderer.ts`: 80 mm thermal layout, page height fitted to the content.
- `templates/cheque-renderer.ts`: cheque fields at configured positions (mm).

Adding a document = one builder function returning a `PrintDocument` + one endpoint.

Company data come from the tenant (name, tax id, address, phone, email); for tax documents the
seller block prefers the compliance settings (taxpayer name, VAT/RIN, C.R., structured address).
Saudi tenants = compliance country `SA` or tenant country `SA`.

## Endpoints

| Method | Path | Document | Permission |
|---|---|---|---|
| GET | `/print/sales-invoices/:id` | Tax invoice / credit note (`?paper=80mm` for a simplified receipt-size invoice) | sales/invoices/read |
| GET | `/print/sales-orders/:id?kind=quotation\|order` | Quotation (draft/sent) or sales order | sales/orders/read |
| GET | `/print/sales-orders/:id/delivery-note?date=` | Delivery note, no prices (`date`: only goods issued that day) | sales/orders/read |
| GET | `/print/purchase-orders/:id` | Purchase order (RFQ while draft/sent) | purchasing/orders/read |
| GET | `/print/treasury-vouchers/:id` | Receipt / payment voucher (سند قبض / صرف) with GL lines | treasury/vouchers/read |
| GET | `/print/payments/:id` | Customer receipt / supplier payment voucher with settled invoices, cheque details, withholding | accounting/payments/read |
| GET | `/print/pos-orders/:id` | POS receipt, 80 mm by default (`?paper=a4`) | pos/orders/read |
| GET | `/print/payroll-lines/:id/payslip` | Payslip | hr/payroll/read |
| GET | `/print/payroll-runs/:id/payslips` | All payslips of a run in one PDF | hr/payroll/read |
| GET | `/print/payroll-runs/:id/register` | Payroll register (landscape) | hr/payroll/read |
| GET | `/print/statements/:customer\|supplier/:partnerId?from=&to=` | Statement of account (reports `PartnerStatementService`, read-only) | reports/partners/read |
| GET | `/print/cheques/:id?layoutId=&lang=` | Issued cheque on the bank layout | treasury/cheques/read |
| GET | `/print/cheque-layouts`, `/print/cheque-layouts/defaults`, `/print/cheque-layouts/:id` | Cheque layouts | treasury/cheques/read |
| POST / PUT / DELETE | `/print/cheque-layouts[/:id]` | Manage layouts | treasury/cheques/update |
| GET | any `/reports/*` endpoint with `?format=pdf` | Report as PDF (landscape when > 7 columns) | the report's permission |

### Tax invoice content

Seller and buyer names, VAT/tax numbers, C.R., addresses; number, issue date and time, due date,
original invoice (credit notes), order, currency and rate; lines with unit, quantity, unit price,
discount, net, VAT rate, VAT amount and gross (tax-inclusive prices handled); VAT per rate,
total VAT, total, installment interest, withholding (informative), paid and balance due;
amount in words; notes; signatures.

- **Saudi**: title "فاتورة ضريبية" or "فاتورة ضريبية مبسطة" (buyer without VAT number); QR =
  the `qrContent` of the ZATCA `e_invoices` row when the invoice was reported/cleared (signed
  phase-2 QR), else a phase-1 TLV (seller, VAT number, timestamp, total, VAT) built with the
  compliance module's `zatcaQr` (read-only import); ZATCA UUID printed when available.
- **Egypt**: when an ETA `e_invoices` row exists, its print URL is printed as QR and text with the
  ETA UUID and status.
- POS receipt: QR = ETA e-receipt `qrContent` when an e-receipt exists, else (Saudi) the phase-1
  ZATCA TLV. POS line totals (VAT-inclusive, negative on refunds) are converted to net + VAT.

### Amount in words

`engine/number-to-words.ts`: Arabic (التفقيط) and English for EGP (جنيه/قرش, pound/piaster) and
SAR (ريال/هللة, riyal/halala), plus USD, EUR, AED and a generic fallback. Arabic follows the
counted-noun rules (1, 2, 3-10 plural, 11-99 accusative, construct state "مائتا/ألفا/أحد عشر ألف
جنيه") and feminine numerals for halalas: e.g. `فقط اثنا عشر ألفاً وخمسمائة جنيه مصري وخمسة
وسبعون قرشاً لا غير`.

### Cheque layouts

Table `print_cheque_layouts` (tenant): name, bank name, treasury (bank account), default flag,
size (mm), direction, words language, date format (`DD/MM/YYYY`...), amount frame (`#1,250.00#`),
printer offsets (mm), and field positions `{date, payee, amount, amountWords, memo}` each
`{x, y, width, fontSize, align, maxLines, hidden}` in mm. Layout choice: `?layoutId`, else the
layout of the cheque's bank account, else matching bank name, else the tenant default, else a
built-in 175 x 80 mm layout. Only issued cheques print; the payee is the supplier (or customer) of
the cheque, the date is the due date.

## Schema additions

- `print_cheque_layouts` (entity `ChequePrintLayout`).

## Tests

- `engine/number-to-words.spec.ts`: Arabic/English numbers and EGP/SAR amounts (grammar cases).
- `engine/bidi-text.spec.ts`: visual ordering, mirroring, isolates, LTR documents.
- `printing.smoke.spec.ts`: each document type renders a valid PDF from fixtures (A4, 80 mm,
  multi-page tables, batch payslips, cheque, report `format=pdf`), VAT breakdown, ZATCA TLV QR,
  ETA references.
- Live smoke test against a seeded database: every endpoint above returned a valid PDF; pages
  were converted to PNG and inspected (Arabic joined and right-to-left).

## Still missing

- Tenant letterhead on report PDFs (needs the report controllers to pass the company; the
  `respond(..., company)` parameter exists) and logos (remote logo URLs are not downloaded; a
  tenant-uploaded logo file could be embedded).
- Per-tenant template customisation (colours, extra footer text, terms and conditions, hiding
  columns) and a print-settings screen; the frontend print buttons.
- Printing purchase invoices, sales/purchase returns, stock transfers, stock counts and journal
  entries (each is one builder away).
- Direct thermal printing (ESC/POS) to the terminal's `printerIp`; the 80 mm PDF is meant for
  browser printing.
- Arabic-Indic digits option (documents use Western digits, as is common on Egyptian and Saudi
  commercial documents).
