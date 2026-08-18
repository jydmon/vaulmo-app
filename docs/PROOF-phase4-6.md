# Proof — Phases 4, 5 & 6

Captured from the phase suites against real PostgreSQL. Totals across all phases:
Phase 1: 33 · Phase 2/3: 30 · Phase 4: 14 · Phase 5: 13 · Phase 6: 20  =  110 checks, 0 failed.

## Phase 4 — Notifications & Reminder Engine
```
  ✓ pilot user signs in
DUE-DATE REMINDER + ESCALATION
  ✓ confirmed document created a LIVE reminder
  ✓ reminder tick notifies (>=1)
  ✓ in-app inbox has a reminder notification
  ✓ unread count > 0
  ✓ email channel notification was queued
NO-SPAM (idempotent escalation)
  ✓ re-running the tick does not re-notify same urgency
SNOOZE
  ✓ a snoozed reminder produces no notifications
MISSING-DOCUMENT REMINDERS
  ✓ missing-document reminder generated
CHANNEL PREFERENCES
  ✓ email suppressed when preference is off
  ✓ in-app still delivered when enabled
MARK READ + GATE
  ✓ marking read decrements unread
  ✓ non-pilot user blocked from notifications (403)
  ✓ reminder tick audited
================================================
  RESULT: 14 passed, 0 failed
================================================
```

## Phase 5 — AI Assistant (permission-scoped)
```
  ✓ two pilot users signed in
DOCUMENT + METADATA + SEMANTIC SEARCH (own data)
  ✓ A can find their passport by keyword
  ✓ A can find a document by its metadata (policy number)
RAG ASSISTANT + SOURCE REFERENCES
  ✓ assistant answers the expiry question
  ✓ answer includes a source reference
"WHAT DO I NEED TO KNOW?"
  ✓ brief summarises the user's situation
  ✓ brief lists outstanding recommended documents
PERMISSION ISOLATION (the critical guarantee)
  ✓ B CANNOT find A's passport number
  ✓ B CANNOT find A's policy number
  ✓ B's assistant returns nothing (no access to A's data)
  ✓ A can still retrieve their own passport (control)
GATE + AUDIT
  ✓ non-pilot user blocked from the assistant (403)
  ✓ assistant queries are audited
================================================
  RESULT: 13 passed, 0 failed
================================================
```

## Phase 6 — Subscriptions & Stripe
```
PLANS & ENTITLEMENTS (free by default)
  ✓ annual plans are listed
  ✓ new tenant is on free Starter (AI off)
CHECKOUT (Stripe Checkout session)
  ✓ checkout returns a session URL
WEBHOOK: activation
  ✓ checkout.session.completed activates the subscription
  ✓ subscription is active on the Family plan
  ✓ renewal date (currentPeriodEnd) is set ~1yr out
  ✓ entitlements now grant the AI assistant
WEBHOOK: idempotency & signature
  ✓ replaying the same event is a no-op (idempotent)
  ✓ an invalid signature is rejected (400)
RENEWAL
  ✓ invoice.paid renews the subscription
  ✓ renewal extends the period end
FAILED PAYMENT → GRACE PERIOD
  ✓ payment_failed marks the subscription past_due
  ✓ entitlements REMAIN active during the grace period
GRACE EXPIRY → SUSPENSION
  ✓ after grace expires, entitlements are suspended
CANCELLATION
  ✓ subscription.deleted cancels the subscription
  ✓ canceled tenant falls back to free Starter
SUPER ADMIN PLAN MANAGEMENT
  ✓ super admin can create a plan (provisioned into Stripe)
  ✓ the new plan appears in plan management
  ✓ a tenant user cannot manage plans (403)
  ✓ checkout start is audited
================================================
  RESULT: 20 passed, 0 failed
================================================
```

