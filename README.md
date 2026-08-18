# Vaulmo Platform — Phase 1: Foundation

This repository is the **technical foundation** for Vaulmo. Its single objective is
the one you set for Phase 1:

> **Prove that users can securely register, authenticate and access the platform from both web and mobile — deployed to Development, promotable to Staging, and not exposed publicly.**

Everything here is real, runnable code — not slideware. The backend was stood up
against a real PostgreSQL database and an automated **33-check end-to-end suite**
proves the whole security path (register → login → MFA → role-based access → audit →
file storage → session rotation → brute-force lockout). See `docs/PROOF.md` for the
captured run.

## What's included (your Phase 1 checklist)

| Requirement | Where it lives | Status |
|---|---|---|
| Backend API | `apps/api` (Node + TypeScript, Express) | ✅ built & tested |
| PostgreSQL database | `apps/api/src/db` (schema + migrations) | ✅ real DB, migrated |
| Web application shell | `apps/web` (React + Vite) | ✅ builds & runs vs API |
| Mobile application shell | `apps/mobile` (Expo / React Native) | ✅ runnable code |
| Authentication | `apps/api/src/modules/auth` (JWT access + rotating refresh) | ✅ |
| User registration / login | `/api/v1/auth/register`, `/login` | ✅ |
| MFA foundation | `apps/api/src/modules/mfa` (TOTP + recovery codes) | ✅ |
| Roles and permissions (RBAC) | `apps/api/src/lib/permissions.ts` + `middleware/rbac.ts` | ✅ |
| Admin portal foundation | `apps/api/src/modules/admin` + web dashboard | ✅ |
| Secure file-storage infrastructure | `apps/api/src/lib/storage.ts` (local + S3 drivers) | ✅ |
| Audit logging | `apps/api/src/lib/audit.ts` (append-only, DB-enforced) | ✅ |
| Logging & monitoring | `logger.ts`, `/livez` `/readyz` `/metrics`, `infra/monitoring` | ✅ |
| Deploy to Development → Staging | `docker-compose*.yml`, `.github/workflows` | ✅ pipeline |
| Not exposed publicly | localhost-only ports, private-network notes | ✅ |

### Phase 2 — Digital Vault + Phase 3 — AI Document Intelligence

Built on the Phase 1 foundation, gated to **internal testers only** (`is_internal_tester`),
promoted **Development → Staging → Internal Alpha**. Proven by `npm run test:e2e:vault`
(**30 checks, 0 failed** — see `docs/PROOF-phase2-3.md`), including **real Tesseract OCR**
on a synthetic passport image.

| Requirement | Where | Status |
|---|---|---|
| Document catalogue | `apps/api/src/lib/catalogue.ts` (+ `document_types`) | ✅ |
| Country-specific config | catalogue `countries` + tenant `country` | ✅ |
| Document checklist + outstanding tracking | `GET /vault/checklist` | ✅ |
| Vaulmo completion score | `GET /vault/checklist` → `completionScore` | ✅ |
| Upload | `POST /vault/documents` (+ presigned upload) | ✅ |
| Mobile scanning | same document API (image capture → upload → process) | ✅ endpoints |
| Document preview | `GET /vault/documents/:id/preview` | ✅ |
| OCR | `apps/api/src/lib/ocr.ts` (Tesseract + text driver) | ✅ real OCR |
| Document classification | `apps/api/src/lib/classify.ts` | ✅ |
| Metadata extraction | `apps/api/src/lib/extract.ts` | ✅ |
| Metadata confirmation / editing | `PATCH` + `POST /vault/documents/:id/confirm` | ✅ |
| Confirmed metadata storage | `documents.confirmed_metadata` | ✅ |
| **Reminders only after confirm** | draft→active on confirm; DB CHECK constraint | ✅ enforced |

The critical flow — **Scan → Extract → Confirm → Store** — is implemented and tested, and
**extracted dates never create live reminders until the user confirms them** (proven).

Internal tester login (dev): `tester@lifehub.local` / `Tester123!`. From the tenant
dashboard in the web app, open the **Digital Vault** to run the flow on synthetic documents.

### Phases 4–6 — Notifications, AI Assistant, Billing

Also built and tested on this foundation. Full details in `docs/PHASE4-6.md`; proofs in
`docs/PROOF-phase4-6.md`. Deployment stages: **Development → Staging → Internal Alpha →
Closed Pilot**, with Stripe on its own **Test → Staging → Live** track.

| Phase | Requirement | Where | Status |
|---|---|---|---|
| 4 | Reminder service (tick engine) | `apps/api/src/lib/reminderEngine.ts` | ✅ |
| 4 | Push / email / in-app notifications | `apps/api/src/lib/notify.ts` (channel drivers) | ✅ |
| 4 | Escalation rules | escalation levels per lead-day threshold | ✅ |
| 4 | Snooze | `POST /notifications/reminders/:id/snooze` | ✅ |
| 4 | Due-date tracking | reminder due dates + engine | ✅ |
| 4 | Missing-document reminders | `runMissingDocReminders()` | ✅ |
| 5 | Semantic / metadata / document search | `apps/api/src/lib/search.ts` (Postgres FTS + trigram) | ✅ |
| 5 | RAG + AI Assistant + source references | `apps/api/src/lib/assistant.ts` | ✅ |
| 5 | "What do I need to know?" | `GET /assistant/whats-important` | ✅ |
| 5 | **Permission control** (own/shared only) | every retrieval tenant-scoped; proven | ✅ enforced |
| 6 | Super Admin plan management | `POST /billing/admin/plans` | ✅ |
| 6 | Annual plans, Stripe products/prices | `plans` table + gateway provisioning | ✅ |
| 6 | Stripe Checkout + webhooks | `billing` module + raw webhook route | ✅ |
| 6 | Subscriptions + entitlements | `subscriptions` table + `entitlementsFor()` | ✅ |
| 6 | Renewal, failed payment, **grace period** | webhook handlers + grace logic | ✅ |

### Phases 7–13 — Family, Emergency Access, Integrations, Trips, Purchases, Subscriptions

Full details in `docs/PHASE7-13.md`; proofs in `docs/PROOF-phase7-13.md`.

| Phase | Requirement | Where | Status |
|---|---|---|---|
| 7 | Family profiles, dependants | `family` module + `family_members` | ✅ |
| 7 | Next-of-kin nomination / invite / permissions | `family` module + `next_of_kin` | ✅ |
| 7 | Quarterly reconfirmation + reminders | `runNokReconfirmations()` in the engine | ✅ |
| 8 | Emergency request → owner decision | `emergency` module | ✅ |
| 8 | 7-day pending + Super Admin security review + due diligence | state machine + guards | ✅ enforced |
| 8 | Restricted / temporary access + revocation + audit | `emergency` module (titles only, expiry) | ✅ |
| 8 | "Emergency Access coming soon" flag | `EMERGENCY_ACCESS_ENABLED` | ✅ |
| 9 | OAuth / API / webhook framework | `integrations` module + `lib/integrations` | ✅ |
| 9 | Token encryption, connection mgmt, sync, provenance | AES-256-GCM (`lib/crypto.ts`) | ✅ |
| 10 | Gmail/Outlook (sandbox) + email classification | `lib/integrations/classifyEmail.ts` | ✅ |
| 10 | Travel/ticket/purchase/warranty detection + confirmation | detected items → confirm | ✅ |
| 11 | Trips + email-to-trip matching + travel reminders | `life` module + `trips` | ✅ |
| 12 | Purchases / assets / warranty tracking + reminders | `life` module + `purchases` | ✅ |
| 13 | Personal subscription tracking + renewal reminders | `life` module + `tracked_subscriptions` | ✅ |

**Proof:** `npm run test` runs all seven suites — **154 checks, 0 failed** (Phase 1: 33,
2/3: 30, 4: 14, 5: 13, 6: 20, 7/8: 21, 9–13: 23). Highlights proven end to end: the AI
assistant answers **only** from the caller's own data; extracted dates never create live
reminders until confirmed; Stripe billing runs the full lifecycle (fake gateway → real by
env); the emergency-access workflow enforces owner approval + a 7-day pending period +
Super Admin review before restricted, temporary, revocable access; and connected-service
tokens are stored **encrypted** with sync creating classified, provenance-tagged items that
become trips/purchases/subscriptions on user confirmation.

Sensitive/rollout deployment paths (in `.github/workflows/deploy.yml`): Emergency Access
runs **Development → Dedicated Security Testing → Staging → Controlled Pilot → Production**
behind a "coming soon" flag; email connectors roll out **provider-sandbox-first, per cohort**.

## Run it locally (the Development environment)

Two ways — both give you the exact stack that was tested.

**A. One command with Docker (portable, recommended):**

```bash
cp infra/env/dev.env.example .env
docker compose up --build
# API  → http://127.0.0.1:4000   Web → http://127.0.0.1:8080
```

**B. Directly with Node (needs a local PostgreSQL):**

```bash
cd apps/api
cp ../../infra/env/dev.env.example .env   # then edit DATABASE_URL
npm install
npm run db:migrate      # create tables
npm run seed            # roles, permissions, super admin
npm run dev             # API on :4000
npm run test:e2e        # run the 33-check proof suite
```

Web shell: `cd apps/web && npm install && npm run dev` → http://127.0.0.1:5173
Mobile shell: `cd apps/mobile && npm install && npm start` → open in Expo Go.

Default Super Admin (dev only): `admin@lifehub.local` / `ChangeMe123!`

## The two roles

- **Super Admin** — the Vaulmo platform operator. Full platform permissions; not tied to a tenant.
- **Tenant** — a customer account (a household/individual). The person who registers becomes the account owner and manages their own household.

RBAC enforces the line between them: a Tenant is denied every platform-admin route (proven in the test suite).

## Documentation

- `docs/ARCHITECTURE.md` — how the pieces fit, the data model, request flow.
- `docs/ENVIRONMENTS.md` — the Dev → Staging promotion runbook (and why nothing is public yet).
- `docs/SECURITY.md` — the security posture, and what hardening the next phases add.
- `docs/PROOF.md` — the captured end-to-end test output.

## What Phase 1 is *not* (yet)

This is the secure foundation, deliberately scoped. It is **not public**, has no
Stripe/billing, no real document AI, and no consumer feature surface — those are
later phases that build on top of this authenticated, audited, multi-tenant base.
