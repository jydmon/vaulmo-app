# Phases 7–13

All build on the same tested foundation. Proofs: `npm run test:e2e:family` (Phase 7/8, 21
checks) and `npm run test:e2e:integrations` (Phase 9–13, 23 checks).

## Phase 7 — Family & Next of Kin

- **Family profiles & dependants** — `family_members` (people in the household, distinct
  from login users; dependants flagged).
- **Next of kin** — nominate (`POST /family/nok`), **invite** (issues a one-time token,
  emailed in prod), the NOK **accepts** via a public endpoint (`POST /nok/accept`), with
  granular **permissions** (what they may see in an emergency).
- **Quarterly reconfirmation** — on acceptance a 90-day `reconfirmDueAt` is set; the reminder
  engine nudges the owner when it's due (`runNokReconfirmations`), and reconfirming resets it.

## Phase 8 — Emergency Access (handled separately, by sensitivity)

Ships behind `EMERGENCY_ACCESS_ENABLED` — until it's true the API returns **"Emergency Access
coming soon"** and blocks requests, so Vaulmo can launch with NOK registration while the
legal/identity process is finalised.

The workflow is a strict, audited state machine:

1. A **confirmed** next of kin submits a **request** → a **7-day pending period** starts and
   the owner is notified. (A non-NOK is rejected.)
2. The **owner approves or declines**.
3. Only after the pending period elapses **and** the owner approved, a **Super Admin performs
   a security review** with **due diligence**, and grants **restricted, temporary access**
   (a scoped set, an expiry window).
4. The granted requester reads a **restricted view** — document **titles/types only, never
   contents** — valid only while active and unexpired.
5. Access can be **revoked** immediately.

Every step is written to the append-only audit log. The test proves the pending-period guard
(a review is rejected with `425` before 7 days), the Super-Admin-only guard, the
titles-only restriction, and that access dies on revocation.

## Phase 9 — Integration Gateway (framework first)

- **OAuth framework** — `startAuth` / `exchange` behind a provider interface; a mock/sandbox
  driver for dev/CI, real Gmail/Outlook drivers by env.
- **Token encryption** — access/refresh tokens are stored **AES-256-GCM encrypted**
  (`lib/crypto.ts`); the API never returns them, and disconnect wipes them.
- **Connection management** — `connections` table + a Connected Services list.
- **Synchronisation jobs** — `POST /connections/:id/sync` pulls items and creates pending
  **detected items** carrying **provenance** (which connection they came from).
- **Webhook framework** — an unauthenticated provider-callback endpoint (signature
  verification + enqueue in prod).

## Phase 10 — Gmail & Outlook (email intelligence)

- **Email classification** (`classifyEmail.ts`) — rule-based, explainable: travel, ticket,
  purchase, warranty, subscription, or other, with structured extraction.
- **Detection → user confirmation** — nothing is created automatically; detected items are
  **pending** until the user confirms (or dismisses) them. Rolled out gradually behind the
  pilot flag, provider-sandbox-first.

## Phases 11–13 — Life entities fed by email (and manual)

Confirming a detected item creates the right entity and a **live reminder**:

- **Trips** (Phase 11) — **email-to-trip matching**: a flight and a hotel with overlapping
  dates group into one trip (flights/hotels/trains/tickets/car rental as trip items); travel
  reminders are created.
- **Purchases & warranties** (Phase 12) — receipts become purchases; ones with a warranty are
  tracked as **assets** with a **warranty reminder**.
- **Personal subscription tracking** (Phase 13) — membership emails (Netflix, broadband, gym,
  …) become tracked subscriptions with a **renewal reminder**. (Open Banking detection is a
  later addition behind the same "detected item → confirm" pattern.)
