# Vaulmo (LifeHub) — User Requirements & Gap Analysis

**Scope:** the customer-facing ("user") side of Vaulmo — the AI-powered Personal Life Operating System / Digital Family Vault.
**Purpose:** a single structured specification of every user requirement, grouped under seven themes, each tagged with a unique ID, a one-line description, and its current build status against the live codebase — so it doubles as a build roadmap.

_Last updated: 2026-08 · Platform: web (React) + iOS/Android (Expo) on a shared Node/PostgreSQL API._

---

## The core user journey

Everything below serves one journey:

> **Register → Subscribe → Personalise LifeHub → Choose Documents → Scan/Upload → AI Extracts → User Confirms → LifeHub Organises → Reminders Created → Ask AI → Connect Services → LifeHub Proactively Tells the User What Needs Attention.**

## The four goals

Every feature is measured against whether it makes these four things effortless:

1. **Know what I have** — the vault, organised and searchable.
2. **Find what I need** — search and the AI assistant.
3. **Know what I am missing** — the checklist, completion score and outstanding documents.
4. **Know what I need to do next** — reminders, the dashboard and the "What do I need to know?" brief.

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | **Done** — implemented and working in the current codebase |
| 🟡 | **Partial** — foundation exists but does not fully meet the requirement |
| ⛔ | **Missing** — not yet implemented |

> **Updates (this session):** two increments delivered and tested. **(1) Vault + AI + OCR:** Vault/assistant/life records opened to all subscribed users; document download, deletion, versioning; per-field metadata provenance; cross-entity assistant answers. **(2) Reminders & Notifications:** custom + recurring reminders, explicit completion, quiet hours, and missing-document reminders for all users. See the build-plan sections for the verified changes.

---

## 1. Account Management & Onboarding

_Goal served: mainly "know what I am missing" (onboarding) and the secure foundation for everything._

| ID | Requirement | Status | Notes |
|---|---|---|---|
| ACC-01 | Account registration via email/password | ✅ | `POST /auth/register` |
| ACC-02 | Registration via Google / Apple / Microsoft | ⛔ | No OAuth/social sign-in yet; email/password only |
| ACC-03 | Email verification before full access | ✅ | `request-verification`, `verify-email` |
| ACC-04 | Secure login across web, iOS, Android on one account | ✅ | Shared API + JWT access/refresh |
| ACC-05 | Multi-factor authentication (MFA) | 🟡 | Enroll/confirm/disable done; mandatory for admins. Step-up MFA for individual sensitive user actions not yet enforced |
| ACC-06 | Biometric login (Face ID / Touch ID / Android) | ⛔ | Secure token storage exists; biometric gate not wired in the mobile app |
| ACC-07 | Profile management (name, country, contact, image, timezone, notification prefs) | 🟡 | `GET/PUT /users/me` covers name/contact; profile image, timezone and full contact fields not all present |
| ACC-08 | Device / session list + revoke individual or all | ✅ | `GET /auth/sessions`, `sessions/:id/revoke`, `sessions/revoke-others` |
| ACC-09 | Personalised onboarding questionnaire (household, property, vehicles, family) | ⛔ | Catalogue is country-based today; no interactive onboarding questionnaire |
| ACC-10 | Personalised document checklist | ✅ | `GET /vault/checklist` (country-recommended set) |
| ACC-11 | Per-document decision (Store Now / Upload Later / Remind Me / Not Applicable / Do Not Store) | ⛔ | Checklist shows state; explicit per-document decision is not persisted |
| ACC-12 | Outstanding documents view | ✅ | `checklist.outstanding` |
| ACC-13 | Reminders to obtain/upload outstanding documents | 🟡 | Reminders engine exists; "remind me to obtain X" as a first-class action is partial |
| ACC-14 | Completion score without pressure | ✅ | `checklist.completionScore` (confirmed = full, present = half) |

## 2. Digital Vault

_Goal served: "know what I have."_

| ID | Requirement | Status | Notes |
|---|---|---|---|
| VLT-01 | Secure personal vault | ✅ | Tenant-scoped `documents` + `file_objects`; **now open to all subscribed users** |
| VLT-02 | Document categories (Identity, Home, Property, Vehicles, Finance, Legal, Employment, Family, Education, Travel, …) | ✅ | Driven by the document-type catalogue |
| VLT-03 | Upload PDF and supported image/file formats | ✅ | `POST /vault/documents` + presigned upload |
| VLT-04 | Mobile document scanning (photograph & scan) | 🟡 | Backend upload works; native camera-scan UX is a mobile-app task |
| VLT-05 | Multi-page scanning combined into one document | ⛔ | Not supported; single file per document today |
| VLT-06 | Secure document preview | ✅ | `GET /vault/documents/:id/preview` (inline, tenant-scoped) |
| VLT-07 | Document download | ✅ | `GET /vault/documents/:id/download` (attachment, audited) |
| VLT-08 | Document replacement / versioning (retain history) | ✅ | `POST /vault/documents/:id/replace` — new version linked to prior; history via `?includeHistory=1` |
| VLT-09 | Document deletion (subject to retention rules) | ✅ | `DELETE /vault/documents/:id` — soft-delete, retained for audit |

## 3. AI, OCR & Search

_Goals served: "know what I have" and "find what I need."_

| ID | Requirement | Status | Notes |
|---|---|---|---|
| AIX-01 | AI document classification | ✅ | `classify()` (rule-based, country-aware) |
| AIX-02 | OCR text extraction from scans | 🟡 | Real Tesseract for images; **PDFs are not yet rasterised/OCR'd** (utf8 fallback) |
| AIX-03 | AI metadata extraction (number, provider, issue/expiry/renewal/policy/purchase/warranty dates) | ✅ | `extract()` per document type |
| AIX-04 | Mandatory metadata confirmation before trust | ✅ | Documents held at `AWAITING_CONFIRM` until user confirms |
| AIX-05 | Correct AI-extracted metadata | ✅ | `PATCH /vault/documents/:id` |
| AIX-06 | Add undetected metadata | ✅ | Same PATCH merges new fields |
| AIX-07 | Metadata source shown (manual / AI / email / integration) | ✅ | Per-field `metadataSources` — AI-extracted vs user-edited tracked and returned |
| AIX-08 | Automatic reminder suggestions after confirmation | ✅ | Draft reminders created on process, activated on confirm |
| AIX-09 | Conversational AI assistant | ✅ | `POST /assistant/ask` (grounded, extractive RAG) |
| AIX-10 | Document search ("Find my home insurance policy") | ✅ | Full-text over documents |
| AIX-11 | Expiry search ("What expires in six months?") | 🟡 | Date-field answers work; a true horizon query relies on reminders more than documents |
| AIX-12 | Personal search ("When does my passport expire?") | ✅ | Handled by date-aware answer path |
| AIX-13 | Missing-info search ("What am I still missing?") | ✅ | Backed by the checklist/outstanding logic |
| AIX-14 | Travel search ("What trips next month?") | ✅ | Assistant routes travel questions to trips |
| AIX-15 | Purchase search ("Find the receipt for my TV") | ✅ | Assistant routes purchase/receipt questions to purchases |
| AIX-16 | Warranty search ("Is my washing machine under warranty?") | ✅ | Assistant checks warranty dates on purchases |
| AIX-17 | Action search ("What do I need to know today?") | ✅ | `GET /assistant/whats-important` |
| AIX-18 | AI source references on every answer | ✅ | `answer.sources[]` |
| AIX-19 | Open the underlying source document from an answer | ✅ | `documentId` returned in sources |
| AIX-20 | Accuracy protection — say when it cannot find, never invent | ✅ | Returns "couldn't find anything" rather than fabricating |
| AIX-21 | Global search across documents, metadata, reminders, trips, purchases, warranties, subscriptions | ✅ | Assistant now answers across documents, trips, purchases, warranties and subscriptions |
| AIX-22 | Personalised dashboard | ✅ | `whats-important` + web dashboard |
| AIX-23 | "Attention required" + "Upcoming" surfacing | ✅ | Overdue / upcoming split in the brief |
| AIX-24 | Proactive "What do I need to know?" summary | ✅ | `whatDoINeedToKnow()` |

## 4. Reminders & Notifications

_Goal served: "know what I need to do next."_

| ID | Requirement | Status | Notes |
|---|---|---|---|
| REM-01 | Smart reminders (documents, insurance, MOT, warranties, subscriptions, travel) | ✅ | Reminders engine + draft/active lifecycle |
| REM-02 | Escalating reminders (multiple alerts as deadlines approach) | ✅ | Engine fires once per lead threshold crossed (e.g. 30/7/1/0 days); overdue alerts are critical |
| REM-03 | Custom reminders (own dates/schedules) | ✅ | `POST /notifications/reminders` + web create form |
| REM-04 | Recurring reminders | ✅ | monthly/quarterly/yearly; completing one spawns the next occurrence |
| REM-05 | Snooze a reminder | ✅ | `POST /notifications/reminders/:id/snooze` |
| REM-06 | Mark action complete to stop alerts | ✅ | `POST /notifications/reminders/:id/complete` — sets COMPLETED, stops alerts |
| REM-07 | Notification centre (urgent / upcoming / completed / snoozed) | ✅ | `GET /notifications`, unread-count, read-all |
| REM-08 | Push notifications (mobile) | 🟡 | Full pipeline (settings, quiet hours, dedupe, device tokens); needs FCM/APNs credentials to deliver |
| REM-09 | Email notifications | 🟡 | Full pipeline via the notify adapter; needs SES/SMTP credentials to deliver |
| REM-10 | In-app notifications | ✅ | Notification centre |
| REM-11 | Notification preferences (categories + channels) | ✅ | `GET/PUT /notifications/settings` |
| REM-12 | Quiet hours | ✅ | Per-user quiet window enforced in `notify` (holds non-urgent email/push; in-app kept; overdue bypasses) + web UI |

## 5. Family, Next-of-Kin & Emergency Access

_Goals served: "know what I have" for the household + trusted continuity._

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FAM-01 | Family / dependant profiles | ✅ | `GET/POST /family/members` |
| FAM-02 | Associate documents with a child/dependant | 🟡 | Members exist; document→member association to confirm end-to-end |
| FAM-03 | Household documents (not person-specific) | 🟡 | Supported by ownership model; explicit household scoping partial |
| FAM-04 | Property records (docs, warranties, info) | 🟡 | Records live under life/vault; a dedicated property entity is partial |
| FAM-05 | Vehicle records (MOT, insurance, tax, service) | 🟡 | Vehicle document types exist; a dedicated vehicle entity is partial |
| FAM-06 | Nominate next-of-kin (per plan limits) | ✅ | `POST /family/nok`, invite |
| FAM-07 | Define what a next-of-kin could access | ✅ | NOK permissions/scope |
| FAM-08 | Quarterly confirmation of next-of-kin | ✅ | `POST /family/nok/:id/reconfirm` |
| FAM-09 | Replace / remove next-of-kin | ✅ | `nok/:id/revoke` |
| FAM-10 | Immediate notification of emergency-access request | ✅ | Emergency module notifies owner |
| FAM-11 | Explicitly approve a request | ✅ | `owner-decision` |
| FAM-12 | Immediately decline a request | ✅ | `owner-decision` |
| FAM-13 | Seven-day protection (no auto-grant on elapse) | ✅ | Owner/security approval required; time alone never grants |
| FAM-14 | Emergency-access scope selection | ✅ | Scope carried on request/grant |
| FAM-15 | Revoke approved emergency access | ✅ | `requests/:id/revoke` |
| FAM-16 | Access history | ✅ | `GET /emergency/requests` + audit log |

## 6. Integrations & Life Records

_Goals served: "know what I have" (auto-captured) and "find what I need."_

| ID | Requirement | Status | Notes |
|---|---|---|---|
| INT-01 | Connected-services page | ✅ | `GET /integrations/connections` |
| INT-02 | Connect Gmail | 🟡 | Generic provider connect exists; Gmail-specific flow to confirm |
| INT-03 | Connect Outlook | 🟡 | Generic provider connect exists; Outlook-specific flow to confirm |
| INT-04 | Integration consent (choose categories) | 🟡 | Consent scaffolding present; category-level consent partial |
| INT-05 | Disconnect a service | ✅ | `DELETE /integrations/connections/:id` |
| INT-06 | Pause synchronisation | ⛔ | No pause toggle |
| INT-07 | Integration status + last-sync | ✅ | Connection status + sync |
| INT-08 | Email intelligence (travel, purchases, tickets, warranties, deliveries) | ✅ | `GET /integrations/detected` |
| INT-09 | Confirm detected info before adding | ✅ | `POST /inbox/detected/:id/confirm` |
| INT-10 | Travel detection (flight/hotel/train/car hire/ticket) | 🟡 | Detected-items pipeline supports it; parser coverage partial |
| INT-11 | My Trips (upcoming + previous) | ✅ | `GET /trips` |
| INT-12 | Trip organisation (group items into one trip) | ✅ | `trips` + `trip_items` |
| INT-13 | Travel reminders | 🟡 | Reminders can attach to trips; dedicated travel schedule partial |
| INT-14 | Manual trip creation | ✅ | `POST /trips` |
| INT-15 | Purchase tracking | ✅ | `GET/POST /purchases` |
| INT-16 | Receipt storage | ✅ | Purchases + vault documents |
| INT-17 | Home inventory of assets | 🟡 | Purchases approximate this; a dedicated inventory is partial |
| INT-18 | Warranty tracking (periods/expiry) | 🟡 | Warranty dates captured on documents/purchases; a first-class warranty view is partial |
| INT-19 | Warranty reminders | 🟡 | Reminder candidates include warranty dates |
| INT-20 | Personal subscription tracking (broadband, mobile, streaming, gym…) | ✅ | `GET/POST /tracked-subscriptions` |
| INT-21 | Subscription renewal reminders | 🟡 | Renewal dates tracked; reminder wiring partial |
| INT-22 | Future API connections (banking, calendar, cloud, gov, insurance, utility) | 🟡 | Provider framework + bank stub present; individual providers to be added |

## 7. Billing, Security, Privacy & Platform

_The commercial and trust foundation that spans everything._

| ID | Requirement | Status | Notes |
|---|---|---|---|
| SEC-01 | Plan selection (view plans + features) | ✅ | `GET /billing/plans` |
| SEC-02 | Annual subscription purchase | ✅ | `POST /billing/checkout` (Stripe) |
| SEC-03 | Secure payment (Stripe; no card storage) | ✅ | Stripe Checkout; card data never stored |
| SEC-04 | Subscription status (active/past-due/grace/cancelled/expired) | ✅ | `GET /billing` / entitlements |
| SEC-05 | Renewal date visible | ✅ | On subscription record |
| SEC-06 | Advance renewal notifications | 🟡 | Data present; reminder wiring to confirm |
| SEC-07 | Billing history (invoices/receipts) | 🟡 | `invoices` table + Stripe portal; in-app list partial |
| SEC-08 | Payment-method management | ✅ | `POST /billing/portal` (Stripe portal) |
| SEC-09 | Cancel renewal (keep access to period end) | 🟡 | Portal supports; in-app cancel/resume UX partial |
| SEC-10 | Resume a scheduled cancellation | 🟡 | Via portal; native resume partial |
| SEC-11 | Renew an expired subscription | ✅ | Re-checkout |
| SEC-12 | Plan upgrade | 🟡 | Plan change supported; proration/flow partial |
| SEC-13 | Plan downgrade (next renewal) | 🟡 | Partial |
| SEC-14 | Failed-payment grace period (no immediate block) | ✅ | Grace state modelled |
| SEC-15 | Data preservation on expiry (no auto-deletion of documents) | ✅ | Expiry never auto-deletes documents |
| SEC-16 | Privacy centre | 🟡 | DSR/consent exist admin-side; a user-facing privacy centre is partial |
| SEC-17 | Access/security activity history | ✅ | Audit log |
| SEC-18 | Data export | 🟡 | DSR export exists; user-initiated self-serve export partial |
| SEC-19 | Account deletion (subject to law) | 🟡 | DSR delete exists admin-side; user-initiated deletion partial |
| SEC-20 | Consent management (review/revoke) | 🟡 | Consent records exist; user-facing management partial |
| SEC-21 | Security alerts | 🟡 | Audit + notifications foundation; dedicated security alerts partial |
| SEC-22 | Password change/reset | ✅ | `request-password-reset`, `reset-password` |
| SEC-23 | MFA management & recovery | ✅ | Enroll/confirm/disable + recovery codes |
| SEC-24 | Logout everywhere | ✅ | `sessions/revoke-others` |
| SEC-25 | Web ↔ mobile synchronisation | ✅ | Single shared API and data model |
| SEC-26 | Consistent account across web/iOS/Android | ✅ | One account, vault, reminders, AI, family, subscription |
| SEC-27 | Accessibility (WCAG 2.2 AA) | 🟡 | Frontend concern; formal WCAG pass outstanding |
| SEC-28 | Help & support (FAQ, troubleshooting, contact) | ✅ | Support desk + CMS help centre |
| SEC-29 | Terms & Privacy accessible in-app | ✅ | Config/CMS policies |

---

## Summary — where the gaps are

**Remaining fully missing (⛔) — the forward backlog:**

- **ACC-02** social sign-in (Google/Apple/Microsoft)
- **ACC-09** personalised onboarding questionnaire
- **ACC-11** per-document decision (Store Now / Upload Later / Remind Me / N/A / Do Not Store)
- **VLT-05** multi-page scan combine
- **INT-06** pause synchronisation

## Build plan — Vault + AI + OCR (this increment: ✅ done & tested)

The chosen first focus was **Vault + AI + OCR**, the heart of the journey. This increment is implemented, migrated (`0018_vault_user_phase.sql`) and verified end-to-end (full API suite green — 189 checks across 8 suites, 0 failures — plus a dedicated 15-check new-feature smoke test):

1. ✅ **Vault, assistant & life records opened to all subscribed users** — the `requireInternalTester` alpha gate is removed; auth + MFA-satisfied + subscription entitlement remains the access control. (Integrations stays gated as a later focus.)
2. ✅ **VLT-07 Document download** — `GET /vault/documents/:id/download`, attachment disposition, audited.
3. ✅ **VLT-09 Document deletion** — `DELETE /vault/documents/:id`, soft-delete (retained for audit/retention), hidden from lists/checklist/search, related reminders cleared.
4. ✅ **VLT-08 Replacement/versioning** — `POST /vault/documents/:id/replace` creates a new linked version; the prior version is retained as history (`?includeHistory=1`).
5. ✅ **AIX-07 Metadata source** — per-field `metadataSources` provenance (AI-extracted vs user-edited) tracked through process → edit → confirm and returned in document detail.
6. ✅ **AIX-14/15/16/21 Cross-entity assistant** — travel, purchase, warranty and subscription questions are answered from the corresponding life records, with sources; document answers unchanged.

Web UI wired: download and delete actions plus a version badge on each document, and new assistant example prompts. API clients (web) updated.

## Build plan — Reminders & Notifications (this increment: ✅ done & tested)

The second focus, making "know what I need to do next" real. Migrated (`0019_reminders_notifications.sql`) and verified (full API suite green plus an 8-check reminders/notifications smoke test):

1. ✅ **REM-03 Custom reminders** — `POST /notifications/reminders` lets a user set their own title, date and lead-day schedule; a web create form is wired in.
2. ✅ **REM-04 Recurring reminders** — monthly/quarterly/yearly; completing a recurring reminder automatically spawns the next occurrence.
3. ✅ **REM-06 Complete** — `POST /notifications/reminders/:id/complete` marks it done and stops its alerts; a grouped centre view (`GET /notifications/reminders`) returns overdue / upcoming / completed / snoozed.
4. ✅ **REM-12 Quiet hours** — a per-user quiet window (in settings + UI) holds non-urgent email/push; in-app is always kept and overdue alerts bypass it as critical.
5. ✅ **REM-02 Escalating reminders** — confirmed the engine fires once per lead threshold crossed, with overdue treated as critical.
6. ✅ **Missing-document reminders opened to all users** (previously pilot-only), excluding deleted documents.

_Email/push (REM-08/09) delivery still needs real provider credentials (SES/SMTP, FCM/APNs) — the full pipeline, preferences and quiet-hours handling are in place behind the adapter._

**Subsequent phases** follow the remaining focus areas: Account & Onboarding, then Family/Emergency/Integrations.
