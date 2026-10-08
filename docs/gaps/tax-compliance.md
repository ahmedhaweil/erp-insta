# Tax compliance: ETA e-invoice / e-receipt and ZATCA (Fatoora)

Scope: `erp-backend/src/modules/compliance/` and new optional env vars in `erp-backend/src/config/`.
Before this work, `EInvoiceService` only stored a `pending` row. The module now integrates with the
Egyptian Tax Authority (e-invoice v1.0 and e-receipt v1.2) and the Saudi ZATCA phase 1 and 2 APIs.
All network I/O goes through one injectable transport (`COMPLIANCE_HTTP_CLIENT`). Unit tests mock it,
and the live smoke test ran against a local mock because the real APIs cannot be reached from here.

## What was built

| Area | Implementation |
|---|---|
| Settings | `compliance_settings` (one row per tenant): country EG/SA, taxpayer RIN/VAT, CRN, branch/activity code, ETA address (country, governate, regionCity, street, buildingNumber, ...), ETA env preprod/prod, client id/secret, signer URL, document version 1.0/0.9, default unit type (`EA`), unit-type map (`units.id` -> ETA code), default VAT subtype (`V009`), POS devices (serial, OS version, model, pre-shared key, optional client credentials), ZATCA env (sandbox/simulation/production), CSID certificate, CSID secret, private key, simplified-by-default. |
| Secrets | `etaClientSecret`, `zatcaCsidSecret`, `zatcaPrivateKey` and device keys are write-only. GET masks them as `********`. They are encrypted with AES-256-GCM when `COMPLIANCE_SECRET_KEY` is set (`enc:v1:` prefix) and are never logged. |
| Item codes | `compliance_item_codes` keyed by `productId`: EGS/GS1 `itemType` + `itemCode`, optional unit type and VAT subtype. The inventory module is not touched. |
| Receivers | `compliance_parties` keyed by `customerId`: receiver type B/P/F, tax id, national id or passport, structured address, and the ZATCA buyer id scheme. Without a profile, the type is inferred from the customer record: 9-digit tax id -> B, foreign country -> F, otherwise P. |
| ETA serialization | `eta/eta-serializer.ts` implements the SDK algorithm exactly: property names in uppercase and quoted; an array name is written once, then again before each element; values are raw (no escaping) and numbers are formatted like `JSON.stringify`. The signed object is the object that is sent. |
| ETA document | `eta/eta-document.builder.ts` builds the issuer, the receiver (B needs a 9-digit RIN and a full address; P needs a 14-digit national id and a name when the total is 50,000 EGP or more; F cannot be in EG) and the lines (unitValue with currencySold/amountEGP/amountSold/rate, salesTotal, discount, netTotal, T1 taxableItems, total). Totals are rounded to 5 decimals. Credit notes are type `C` with `references` = the original document's ETA uuid. |
| Signing | `ExternalSignerService` POSTs `{data: <serialized>, algorithm: "CAdES-BES"}` to `ETA_SIGNER_URL` (or the tenant `etaSignerUrl`), with an optional `Bearer ETA_SIGNER_TOKEN`. It accepts the signature as plain text or JSON `{signature|value|cades}` and stores it in `signatures[{signatureType:'I', value}]`. Version 0.9 documents are not signed (preprod only). |
| ETA API | `EtaAuthService`: client-credentials token from `{idSrv}/connect/token` (scope `InvoicingAPI`, or the POS headers for e-receipts), cached until 60 s before expiry, with concurrent requests de-duplicated. `EtaApiClient`: `POST /api/v1/documentsubmissions`, `GET /api/v1/documentsubmissions/{id}`, `GET /api/v1/documents/{uuid}/details` and `/raw`, `PUT /api/v1.0/documents/state/{uuid}/state` (cancelled/rejected), `POST /api/v1/receiptsubmissions`, `GET /api/v1/receiptsubmissions/{id}/details`. A 401 is retried once with a fresh token. Print/QR URL: `{portal}/print/documents/{uuid}/share/{longId}`. |
| Statuses | `pending`, `submitted`, `valid`, `invalid` (with `validationErrors`), `cancelled`, `rejected`, `reported`, `cleared`, `failed`. `failed` means a transport, auth or 5xx error and is safe to retry. ETA 4xx -> invalid. A rejected document in a 202 -> invalid, with the flattened errors. |
| ETA e-receipt | `eta/eta-receipt.builder.ts` builds a v1.2 receipt from a POS order (sale `S` / return `R` with `referenceUUID`). The uuid is the SHA-256 hex (lowercase) of the serialized receipt with `header.uuid = ""`. `previousUUID` is chained per POS device in `compliance_chains` (row locked FOR UPDATE). The device is chosen by terminal id, or the single unbound device. QR: `{portal}/receipts/search/{uuid}/share/{dateTimeIssued}#Total:{total},IssuerRIN:{rin}`. Payment codes: cash -> C, card -> V, split -> O. |
| ZATCA | `zatca/zatca-tlv.ts` encodes TLV tags 1-5 (phase 1) and 6-9 (hash, signature, public key DER, certificate signature; tag 9 only for simplified invoices). It reproduces the official sample. `zatca/zatca-xml.builder.ts` builds UBL 2.1 XML: 388/381/383, subtype `0100000`/`0200000`, ICV/PIH/QR references, supplier/customer parties, delivery, payment means and the reason (KSA-10) on credit notes, two TaxTotals, LegalMonetaryTotal, lines with discount AllowanceCharge and RoundingAmount, and the XAdES `UBLExtensions` block. The invoice hash is base64(SHA-256(canonical XML without UBLExtensions, cac:Signature and QR)). The signature is ECDSA secp256k1 over the hash with node `crypto`, as in the ZATCA SDK. ICV and PIH are chained per tenant (the first PIH is base64(hex(sha256("0")))). |
| ZATCA API | `POST /invoices/reporting/single` for simplified invoices and `POST /invoices/clearance/single` for standard ones (`Clearance-Status`, `Accept-Version: V2`, Basic auth = binarySecurityToken:secret). Responses map as: 200/202 REPORTED/CLEARED (warnings kept), 400/NOT_* -> invalid, 409 -> already accepted, other -> failed. The cleared XML and its QR are stored. With no CSID configured, a phase-1 XML and QR are generated locally and the record stays `pending`. |
| Polling | `POST /compliance/e-invoices/refresh-pending`. An optional in-process poller runs when `COMPLIANCE_POLL_INTERVAL_SEC` > 0 (it covers all tenants). |

Retry rules: `pending`, `invalid` and `failed` may be resubmitted; anything else returns 409.
A `failed` ZATCA invoice or e-receipt is re-sent unchanged because its chain position is already used.
A ZATCA `invalid` invoice is regenerated with a new ICV, and the chain includes every generated invoice.
ZATCA invoices cannot be cancelled; issue a credit note (381) instead.

## Endpoints (`/api/v1`, permission module `compliance`)

| Method | Path | Screen / action |
|---|---|---|
| GET / PUT | `/compliance/settings` | settings read / update |
| GET / POST | `/compliance/item-codes` (POST upserts by productId) | settings read / create |
| GET / PUT / DELETE | `/compliance/item-codes/:id` | settings read / update / delete |
| GET / PUT | `/compliance/parties/:customerId` | settings read / update |
| GET / POST | `/compliance/tax-configs` (existing, screen renamed to `settings`) | settings |
| GET | `/compliance/e-invoices?provider&status&from&to&search&page&limit&order` | e_invoices read |
| POST | `/compliance/e-invoices/submit` `{invoiceId}`: ETA or ZATCA by tenant country | e_invoices create |
| GET | `/compliance/e-invoices/preview/:invoiceId`: ETA JSON + serialization, or ZATCA XML, without submitting | e_invoices read |
| GET | `/compliance/e-invoices/:id` | e_invoices read |
| POST | `/compliance/e-invoices/:id/refresh` | e_invoices update |
| POST | `/compliance/e-invoices/refresh-pending` | e_invoices update |
| POST | `/compliance/e-invoices/:id/cancel` `{reason}` (ETA) | e_invoices update |
| POST | `/compliance/e-invoices/received/:uuid/reject` `{reason}` (ETA, as receiver) | e_invoices update |
| GET | `/compliance/e-invoices/:id/qr`: ETA print URL, or ZATCA TLV with decoded fields | e_invoices read |
| GET / POST | `/compliance/e-receipts`, `/compliance/e-receipts/submit` `{posOrderId}` | e_receipts read / create |
| GET | `/compliance/e-receipts/preview/:posOrderId`, `/:id`, `/:id/qr` | e_receipts read |
| POST | `/compliance/e-receipts/:id/refresh` | e_receipts update |

## Schema additions

New tables: `compliance_settings`, `compliance_item_codes`, `compliance_parties`, `compliance_chains`, `e_receipts`.
`e_invoices` was reworked. Added: provider/documentType/subtype, internal id, date, total, submission uuid, uuid,
longId, hash, previous hash, ICV, payload (jsonb), XML, QR, validation errors, warnings, attempts and timestamps,
plus a unique index (tenant, provider, invoice). The status enum was extended. There are no migrations: the schema
is synchronized by `npm run seed:run`.

## Configuration (all optional; empty strings allowed)

`ETA_ID_SRV_URL`, `ETA_SIGNER_URL`, `ETA_SIGNER_TOKEN`, `ZATCA_API_URL`, `COMPLIANCE_SECRET_KEY`,
`COMPLIANCE_HTTP_TIMEOUT_MS` (30000), `COMPLIANCE_POLL_INTERVAL_SEC` (0 = off).
`ETA_API_URL`, `ETA_ID_SRV_URL` and `ZATCA_API_URL` override only the production hosts. Preprod and
sandbox always use the official hosts. Per-tenant settings take precedence over `ETA_CLIENT_ID` and
`ETA_CLIENT_SECRET`.

## Posting rules

None. This module creates no journal entries: it only reports documents that were already posted.

## Automatic submission

No "sales invoice posted" event exists, so nothing listens yet. `EInvoiceService.submitIfEnabled(tenantId, userId, invoiceId)`
is exported. It submits only when the settings have `isEnabled` and `autoSubmit` set, and it never throws.
To wire it up, either emit `sales.invoice.posted` from `SalesInvoicesService.post()` and add an `@OnEvent` handler in this
module (events are delivered after commit, so a failure cannot roll back posting), or call the method from the sales controller.

## Known limitations / still missing

- **Canonicalization**: the builder emits XML that is already canonical (no inter-element whitespace, no self-closing tags,
  root namespaces only, C14N escaping), and it hashes the same rendering without the excluded blocks. This matches
  C14N 1.1 for XML produced here. XML from elsewhere, or edited XML, needs a real C14N engine. The signed-properties
  digest follows the ZATCA SDK template. Validate a sample with the ZATCA SDK (`fatoora -validate`) before going live.
- No ZATCA onboarding flow (CSR generation, compliance CSID, compliance invoice checks, production CSID exchange).
  `ZatcaApiClient.complianceCheck` exists, but the certificate and secret must be obtained outside the ERP and pasted
  into the settings.
- The ETA line discount is sent as `discount.amount` with `rate: 0`. There are no T2-T20 taxes, no withholding (T4),
  no `extraDiscountAmount` and no debit notes (D) because the sales module has none.
- The e-receipt uuid is lowercase hex, and fields such as `orderdeliveryMode` and the contractor/beneficiary blocks are
  not sent. Receipt buyers are always `P`; there is no 150,000 EGP B2C identification rule yet.
- The ETA token cache is in-process, so each instance fetches its own token.
- The ZATCA issue time is derived from `postedAt` in Riyadh time (UTC+3). Foreign-currency invoices are converted to
  SAR using the invoice exchange rate.
- The printed invoice / POS receipt PDFs (see `printing.md`) render the ZATCA TLV QR or ETA print-URL QR; no frontend screens yet.
