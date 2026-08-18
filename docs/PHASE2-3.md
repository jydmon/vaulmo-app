# Phase 2 & 3 — Digital Vault + AI Document Intelligence

Built on the Phase 1 foundation. Everything here is gated to **internal testers** during
alpha and is exercised end-to-end by `apps/api/tests/phase2_3.e2e.ts` (30 checks).

## Phase 2 — Digital Vault

**Catalogue.** `apps/api/src/lib/catalogue.ts` is the source of truth for document *types*
(passport, driving licence, home/life insurance, will, birth certificate, …). Each type
declares its country scope, whether it's recommended, its metadata schema, and the signals
the AI uses (classification keywords + extraction patterns). It's seeded into
`document_types` so the API and admin can query it.

**Country-specific config.** A tenant has a `country`. The catalogue and the recommended
set are filtered to that country: `GET /vault/catalogue` returns UK types for a GB tenant
(driving licence) and not US ones (driver's license), and vice-versa.

**Checklist, outstanding tracking & completion score.** `GET /vault/checklist` compares the
tenant's documents against the recommended set for their country and returns: the
per-item state (`missing` / `present` / `confirmed`), the `outstanding` list, and the
**Vaulmo completion score** (confirmed items count fully; present-but-unconfirmed count
half).

**Upload, scanning, preview.** `POST /vault/documents` creates the document + a presigned
upload; the client (web or mobile camera) uploads the bytes. `GET
/vault/documents/:id/preview` streams the file back, tenant-scoped. Mobile scanning is the
same API with an image captured on device.

## Phase 3 — AI Document Intelligence

The pipeline runs in `POST /vault/documents/:id/process` and is deliberately transparent so
accuracy can be **monitored** during alpha:

1. **OCR** (`lib/ocr.ts`) — real **Tesseract** for scanned images; a text driver for
   synthetic text documents. The engine used is returned and audited.
2. **Classification** (`lib/classify.ts`) — rule-based keyword scoring picks the document
   type and a confidence. Explainable, and swappable for an ML model behind the same
   interface later.
3. **Metadata extraction** (`lib/extract.ts` + `lib/dates.ts`) — pulls the schema's fields
   via patterns; dates are normalised to ISO. Produces **reminder candidates** from expiry/
   renewal dates.

The result is stored as **unconfirmed** `extracted_metadata`, the document moves to
`AWAITING_CONFIRM`, and any reminders are created as **DRAFT**.

### The critical flow: Scan → Extract → Confirm → Store

- **Scan/Extract** → `process` (above): metadata is unconfirmed; reminders are DRAFT.
- **Confirm/edit** → `PATCH /vault/documents/:id` edits fields; `POST
  /vault/documents/:id/confirm` validates required fields, writes `confirmed_metadata`, sets
  status `CONFIRMED`.
- **Store** → on confirm, and only then, DRAFT reminders are **activated** (go live).

### Extracted dates never create live reminders until confirmed

This rule is enforced in two places:

1. **Application:** `process` only ever writes `DRAFT` reminders; `confirm` is the only path
   that flips them to `ACTIVE` (with an `activated_at` timestamp).
2. **Database:** a CHECK constraint (`reminders_active_requires_activation`) rejects any
   `ACTIVE` reminder without an activation timestamp — so a bug or a stray write can't make a
   reminder live without going through confirmation.

`GET /vault/reminders` returns `live` and `draft` separately; the test asserts a reminder is
DRAFT before confirmation and LIVE only after.

## Accuracy monitoring

Every extraction writes an audit event (`document.extracted`) capturing the OCR engine, the
classified type, the confidence, and how many fields/reminders were produced — so extraction
accuracy can be reviewed across the alpha cohort. Because classification and extraction are
rule-based and logged, every decision is explainable rather than a black box.
