# Phases 4–6 — Notifications, AI Assistant, Billing

All three build on the same tested foundation and are exercised by automated suites
(`npm run test:e2e:notifications`, `:assistant`, `:billing`).

## Phase 4 — Notifications & Reminder Engine

**The engine** (`lib/reminderEngine.ts`) is called on a schedule (cron/worker →
`POST /notifications/run-tick`). It is idempotent:

- **Due-date tracking + escalation.** Each reminder has lead-day thresholds
  (default `[30, 7, 1, 0]`). As the due date approaches, the reminder crosses thresholds
  and its escalation level rises; it notifies **once per threshold** — re-running the tick
  never re-sends the same urgency (proven).
- **Channels** (`lib/notify.ts`): `in_app` (stored, served by `GET /notifications`),
  `email`, and `push`, behind one interface. Dev drivers log to an outbox; SES/SMTP and
  FCM/APNs adapters slot in by env. Deliveries are deduped at the database level.
- **Channel preferences** — per-user toggles; a disabled channel is suppressed (proven).
- **Snooze** — `POST /notifications/reminders/:id/snooze`; a snoozed reminder produces no
  notifications until it expires (proven).
- **Missing-document reminders** — a weekly, deduped nudge listing the recommended
  documents a tenant still hasn't added.

## Phase 5 — AI Assistant (permission-scoped RAG)

- **Search** (`lib/search.ts`) — Postgres full-text ranking + trigram fuzzy matching over a
  per-document `search_text` (title + type + OCR + metadata), refreshed on process/confirm.
  Covers document, metadata and semantic-style lexical search. A vector/embedding retriever
  can be added behind the same function.
- **RAG assistant** (`lib/assistant.ts`) — retrieves the caller's relevant documents,
  grounds an answer in their confirmed metadata, and returns **source references**.
  Generation is extractive today (composed from retrieved facts); an LLM slots into the
  same retrieve→ground→answer shape.
- **"What do I need to know?"** — `GET /assistant/whats-important` builds a grounded brief
  from the tenant's own reminders (overdue/upcoming) and outstanding documents.
- **The guarantee:** every retrieval is filtered by `tenant_id`, so an answer can only ever
  draw on the caller's own (or shared-with-them) information. The test proves user B cannot
  find user A's passport number or policy number, and B's assistant returns nothing about
  A's documents — while A can.

## Phase 6 — Subscriptions & Stripe

- **Gateway** (`lib/billing/gateway.ts`) — one interface, two drivers: `fake` (deterministic,
  = Stripe **Test Mode** for dev/CI, with **real HMAC webhook-signature verification**) and
  `stripe` (the real SDK, enabled by `STRIPE_DRIVER=stripe` + keys). Callers never change.
- **Plans** — Super Admin manages annual plans (`POST /billing/admin/plans`); each is
  provisioned into Stripe (product + price). Plans carry **entitlements** (feature flags/
  limits) as JSON.
- **Checkout → webhook → subscription.** `POST /billing/checkout` starts a Checkout session;
  the `checkout.session.completed` webhook activates the subscription and grants entitlements.
- **Entitlements** (`entitlementsFor()`) — what a tenant may use right now. A `past_due`
  subscription keeps its entitlements **through a 14-day grace period**, then is suspended
  (falls back to free). Proven across the whole lifecycle.
- **Renewal / failed payment / cancellation** — `invoice.paid` renews; `invoice.payment_failed`
  → `past_due` + grace; `customer.subscription.deleted` → canceled → free Starter.
- **Idempotency & security** — every event is processed at most once (`stripe_events`), and
  an invalid signature is rejected (400). Both proven.

### Deployment order (as requested)

- Phases 4 & 5: **Development → Staging → Closed Pilot** — at Closed Pilot Vaulmo is a
  genuinely useful app; a small group of real pilot users can start using it.
- Phase 6: **Stripe Test Mode → Staging → Stripe Live Mode** — do not switch to live keys
  until the full checkout, webhook and cancellation flows have been verified in staging.
  The pipeline gates the live switch behind an explicit approval (`stripe-go-live`).
