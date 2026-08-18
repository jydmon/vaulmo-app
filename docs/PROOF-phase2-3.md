# Proof — Phase 2 & 3 (Digital Vault + AI Document Intelligence)

Captured from `npm run test:e2e:vault` against real PostgreSQL, with REAL OCR (Tesseract)
on a synthetic passport image plus text OCR on synthetic text documents. Proves the vault,
catalogue, checklist/score, and the Scan -> Extract -> Confirm -> Store flow — including the
rule that extracted dates create DRAFT reminders that only go LIVE on user confirmation.

```
  ✓ internal tester can sign in
PHASE 2 — CATALOGUE (country-specific)
  ✓ catalogue is scoped to GB
  ✓ GB catalogue includes UK driving licence
  ✓ GB catalogue excludes US driver license
PHASE 2 — CHECKLIST & COMPLETION SCORE (before)
  ✓ completion score is a number
  ✓ outstanding documents are tracked
PHASE 3 — SCAN → EXTRACT (synthetic passport, text OCR)
  ✓ OCR engine used = text (synthetic doc)
  ✓ classified as passport
  ✓ extracted expiry date normalised to 2027-03-22
  ✓ extracted passport number
  ✓ status is AWAITING_CONFIRM after extract
  ✓ a DRAFT reminder was created from the date
PHASE 3 — REMINDER GATE (must not be live before confirm)
  ✓ reminder is DRAFT, not live, before confirmation
PHASE 3 — CONFIRM → STORE (activates reminder)
  ✓ confirm stores the document (CONFIRMED)
  ✓ confirm activated the reminder
  ✓ reminder is now LIVE after confirmation
  ✓ confirmed metadata is stored
  ✓ preview URL is available
PHASE 3 — METADATA EDITING (edit before confirm)
  ✓ home insurance classified
  ✓ renewal date extracted (2027-09-05)
  ✓ edited metadata is preserved on confirm
PHASE 3 — REAL OCR (Tesseract on a scanned image)
  ✓ OCR engine used = tesseract (scanned image)
  ✓ scanned image classified as passport
  ✓ metadata extracted from the real OCR text
PHASE 3 — CONFIRM GUARD (required fields)
  ✓ cannot confirm without required fields (422)
PHASE 2 — COMPLETION SCORE (after) & OUTSTANDING
  ✓ completion score increased after confirming documents
  ✓ outstanding shrank
INTERNAL-TESTER GATE (alpha restriction)
  ✓ non-tester is blocked from the vault (403)
AUDIT TRAIL
  ✓ extraction event audited
  ✓ confirmation event audited
================================================
  RESULT: 30 passed, 0 failed
================================================
```
