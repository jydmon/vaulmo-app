# Proof — Phases 7–13

Captured from the phase suites against real PostgreSQL.
Phase 7/8: 21 checks · Phase 9-13: 23 checks. (Full battery across all 13 phases: 154 checks, 0 failed.)

## Phase 7 (Family & Next-of-Kin) + Phase 8 (Emergency Access)
```
PHASE 7 — FAMILY & DEPENDANTS
  ✓ a dependant was added to the family
PHASE 7 — NEXT OF KIN (nominate → invite → accept)
  ✓ next of kin nominated
  ✓ invitation issues a token
  ✓ NOK accepts the invitation (confirmed)
  ✓ confirmed NOK has a quarterly reconfirmation due date
PHASE 7 — QUARTERLY RECONFIRMATION REMINDER
  ✓ reconfirmation reminder is generated when due
  ✓ owner is reminded to reconfirm the NOK
  ✓ owner can reconfirm the NOK
PHASE 8 — "COMING SOON" (flag off)
  ✓ emergency access shows as coming soon by default
  ✓ emergency request blocked while coming soon (403)
PHASE 8 — EMERGENCY WORKFLOW (flag on)
  ✓ a non-NOK cannot request emergency access (403)
  ✓ confirmed NOK can start a request (7-day pending)
  ✓ owner can approve the request
  ✓ security review blocked until the 7-day period elapses (425)
  ✓ a non-super-admin cannot perform the security review (403)
  ✓ super admin grants restricted, temporary access
  ✓ granted requester sees a restricted view
  ✓ restricted view exposes titles but NOT document contents
PHASE 8 — REVOCATION
  ✓ access is denied after revocation
AUDIT + NOK REVOKE
  ✓ emergency request + grant + revoke are all audited
  ✓ a next of kin can be revoked
================================================
  RESULT: 21 passed, 0 failed
================================================
```

## Phases 9-13 (Integrations, Email, Trips, Purchases, Subscriptions)
```
PHASE 9 — CONNECT (OAuth) + ENCRYPTED TOKENS
  ✓ gmail & outlook providers are available
  ✓ OAuth start returns a consent URL
  ✓ callback creates a connection
  ✓ tokens are NOT returned by the API
  ✓ access token is stored ENCRYPTED (not plaintext)
  ✓ encrypted token decrypts back to the original
PHASE 10 — SYNC + CLASSIFY + DETECT
  ✓ sync creates detected items
  ✓ classified travel, purchase, ticket & subscription
  ✓ detected items carry provenance (connection id)
PHASE 11 — EMAIL → TRIP (matching)
  ✓ confirming a flight creates a trip
  ✓ confirming the hotel matches the SAME trip
  ✓ the trip has both flight and hotel items
PHASE 12 — EMAIL → PURCHASE + WARRANTY
  ✓ confirming a receipt creates a purchase
  ✓ purchase is tracked as an asset with a warranty date
PHASE 13 — EMAIL → TRACKED SUBSCRIPTION
  ✓ confirming a membership email creates a tracked subscription
  ✓ the subscription (e.g. Netflix) is tracked
REMINDERS FROM CONFIRMED ITEMS
  ✓ a warranty reminder went live
  ✓ a subscription renewal reminder went live
DISMISS, WEBHOOK, DISCONNECT, GATE
  ✓ a detected item can be dismissed
  ✓ the webhook framework accepts provider callbacks
  ✓ disconnect clears the stored tokens
  ✓ non-pilot user cannot access integrations (403)
  ✓ connect, sync and confirm are audited (provenance)
================================================
  RESULT: 23 passed, 0 failed
================================================
```
