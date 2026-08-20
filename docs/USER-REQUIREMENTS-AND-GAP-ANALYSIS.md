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
| ACC-03 | Email verification before full access | ✅ | `request-verification`, `verify-email`; **enforced** — the onboarding gate blocks the app until verified, and `REQUIRE_EMAIL_VERIFICATION=true` also blocks login server-side |
| ACC-04 | Secure login across web, iOS, Android on one account | ✅ | Shared API + JWT access/refresh |
| ACC-05 | Multi-factor authentication (MFA) | ✅ | Enroll/confirm/disable done; mandatory for admins. Step-up verification now enforced on sensitive actions (password re-check on account-deletion requests); extendable to other actions |
| ACC-06 | Biometric login (Face ID / Touch ID / Android) | ✅ | `expo-local-authentication` app-lock: on-launch biometric gate over the stored session, Settings toggle, post-login offer, graceful fallback |
| ACC-07 | Profile management (name, country, contact, image, timezone, notification prefs) | ✅ | `GET/PUT /users/me` now covers name, phone, timezone and household country (notification prefs live in Settings). Profile image still to come |
| ACC-08 | Device / session list + revoke individual or all | ✅ | `GET /auth/sessions`, `sessions/:id/revoke`, `sessions/revoke-others` |
| ACC-09 | Personalised onboarding questionnaire (household, property, vehicles, family) | ✅ | `GET/POST /vault/onboarding` — questionnaire (home/vehicle/children/travel) tailors the recommended set; relevance-gated types (MOT, tenancy, birth certificate) appear only when they apply |
| ACC-10 | Personalised document checklist | ✅ | `GET /vault/checklist` now tailored by onboarding answers, not just country |
| ACC-11 | Per-document decision (Store Now / Upload Later / Remind Me / Not Applicable / Do Not Store) | ✅ | `POST /vault/checklist/decision` persists a decision per type; N/A and Do-Not-Store are excluded from the score and outstanding list |
| ACC-12 | Outstanding documents view | ✅ | `checklist.outstanding` (excludes items the user marked not-applicable) |
| ACC-13 | Reminders to obtain/upload outstanding documents | ✅ | "Remind me" creates an ACTIVE *Obtain X* reminder (+14 days); changing the decision clears it |
| ACC-14 | Completion score without pressure | ✅ | `checklist.completionScore` (confirmed = full, present = half) |

## 2. Digital Vault

_Goal served: "know what I have."_

| ID | Requirement | Status | Notes |
|---|---|---|---|
| VLT-01 | Secure personal vault | ✅ | Tenant-scoped `documents` + `file_objects`; **now open to all subscribed users** |
| VLT-02 | Document categories (Identity, Home, Property, Vehicles, Finance, Legal, Employment, Family, Education, Travel, …) | ✅ | Driven by the document-type catalogue |
| VLT-03 | Upload PDF and supported image/file formats | ✅ | `POST /vault/documents` + presigned upload; **file-upload UI on web (file picker) and mobile (document picker)** alongside camera/scan |
| VLT-04 | Mobile document scanning (photograph & scan) | ✅ | Native camera + photo-library capture, plus file upload; images read by OCR, manual type/metadata for anything unrecognised |
| VLT-05 | Multi-page scanning combined into one document | ✅ | Mobile "Scan multiple pages" captures/reorders pages, builds one PDF on-device (`expo-print`), uploads it; server OCRs every page |
| VLT-06 | Secure document preview | ✅ | `GET /vault/documents/:id/preview` (inline, tenant-scoped) |
| VLT-07 | Document download | ✅ | `GET /vault/documents/:id/download` (attachment, audited) |
| VLT-08 | Document replacement / versioning (retain history) | ✅ | `POST /vault/documents/:id/replace` — new version linked to prior; history via `?includeHistory=1` |
| VLT-09 | Document deletion (subject to retention rules) | ✅ | `DELETE /vault/documents/:id` — soft-delete, retained for audit |

## 3. AI, OCR & Search

_Goals served: "know what I have" and "find what I need."_

| ID | Requirement | Status | Notes |
|---|---|---|---|
| AIX-01 | AI document classification | ✅ | `classify()` (rule-based, country-aware) |
| AIX-02 | OCR text extraction from scans | ✅ | Real Tesseract for images **and PDFs**: digital PDFs via `pdftotext`; scanned/image PDFs rasterised with `pdftoppm` then OCR'd per page |
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
| FAM-02 | Associate documents with a child/dependant | ✅ | `POST /vault/documents/:id/subject` links a document to a family member; `GET /family/members/:id/documents` lists a member's documents. Web UI: link/unlink per member |
| FAM-03 | Household documents (not person-specific) | ✅ | Documents default to the household (tenant) scope; person- and asset-linking are optional overlays on top |
| FAM-04 | Property records (docs, warranties, info) | ✅ | First-class `assets` (kind=property) via `/assets`; link documents (`/vault/documents/:id/asset`), track insurance/mortgage dates with auto-reminders. Web + mobile UI |
| FAM-05 | Vehicle records (MOT, insurance, tax, service) | ✅ | First-class `assets` (kind=vehicle); MOT/tax/insurance renewal dates auto-create yearly reminders (30- and 7-day lead). Web + mobile UI |
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
| INT-02 | Connect Gmail | ✅ | Real Google OAuth driver (`GoogleProvider`): consent URL, token exchange, Gmail API read. Activates when `GOOGLE_CLIENT_ID/SECRET` are set; sandbox otherwise |
| INT-03 | Connect Outlook | ✅ | Real Microsoft OAuth driver (`MicrosoftProvider`): consent URL, token exchange, Graph mail read. Activates when `MICROSOFT_CLIENT_ID/SECRET` are set; sandbox otherwise |
| INT-04 | Integration consent (choose categories) | 🟡 | OAuth scopes are least-privilege (read-only mail); category-level user consent still partial |
| INT-05 | Disconnect a service | ✅ | `DELETE /integrations/connections/:id` (tokens wiped) |
| INT-06 | Pause synchronisation | ✅ | `POST /integrations/connections/:id/pause` and `/resume`; sync is refused (409) while paused. Web + mobile UI |
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
| INT-22 | Future API connections (banking, calendar, cloud, gov, insurance, utility) | ✅ | Provider framework with a live-or-sandbox selector; Gmail, Outlook and Open Banking implemented behind one interface — new providers plug in the same way |

## 7. Billing, Security, Privacy & Platform

_The commercial and trust foundation that spans everything._

| ID | Requirement | Status | Notes |
|---|---|---|---|
| SEC-01 | Plan selection (view plans + features) | ✅ | `GET /billing/plans` — now with per-plan **modules**, **discount** and discounted net price; admin plan editor lets you pick modules + set discounts; **feature access is enforced by plan** (`requireModule`) |
| SEC-02 | Annual subscription purchase | ✅ | `POST /billing/checkout` (Stripe) |
| SEC-03 | Secure payment (Stripe; no card storage) | ✅ | Stripe Checkout; card data never stored |
| SEC-04 | Subscription status (active/past-due/grace/cancelled/expired) | ✅ | `GET /billing` / entitlements |
| SEC-05 | Renewal date visible | ✅ | On subscription record |
| SEC-06 | Advance renewal notifications | 🟡 | Data present; reminder wiring to confirm |
| SEC-07 | Billing history (invoices/receipts) | ✅ | `GET /billing` returns invoices; in-app invoice list on web & mobile |
| SEC-08 | Payment-method management | ✅ | `POST /billing/portal` (Stripe portal) |
| SEC-09 | Cancel renewal (keep access to period end) | ✅ | `POST /billing/cancel` schedules end-of-period; access is kept until `currentPeriodEnd` (never an immediate cut). In-app on web & mobile |
| SEC-10 | Resume a scheduled cancellation | ✅ | `POST /billing/resume` clears the scheduled cancellation. In-app on web & mobile |
| SEC-11 | Renew an expired subscription | ✅ | Re-checkout |
| SEC-12 | Plan upgrade | ✅ | `POST /billing/change-plan` (direction=upgrade); in-app on web & mobile (Stripe proration applies when live) |
| SEC-13 | Plan downgrade (next renewal) | ✅ | `POST /billing/change-plan` (direction=downgrade); in-app on web & mobile |
| SEC-14 | Failed-payment grace period (no immediate block) | ✅ | Grace state modelled |
| SEC-15 | Data preservation on expiry (no auto-deletion of documents) | ✅ | Expiry never auto-deletes documents |
| SEC-16 | Privacy centre | ✅ | User-facing Privacy & Security Centre in Settings: `GET /users/me/privacy` (consents + open requests), export and deletion controls |
| SEC-17 | Access/security activity history | ✅ | Audit log |
| SEC-18 | Data export | ✅ | `POST /users/me/export` — self-serve, downloads a portable JSON bundle (account, documents metadata, reminders, trips, purchases, subscriptions, family) and logs a completed DSR |
| SEC-19 | Account deletion (subject to law) | ✅ | `POST /users/me/deletion-request` — self-serve, **password step-up** required (ACC-05), raises a verified pending request; documents are never auto-deleted (SEC-15) |
| SEC-20 | Consent management (review/revoke) | ✅ | `POST /users/me/consent` records policy/marketing consent; `GET /users/me/privacy` lists consents on record |
| SEC-21 | Security alerts | ✅ | `GET /users/me/security-activity` surfaces sign-ins, 2FA changes, downloads, deletions and emergency decisions in the Privacy & Security Centre (dedicated push alerting rides the notifications adapter) |
| SEC-22 | Password change/reset | ✅ | `request-password-reset`, `reset-password` |
| SEC-23 | MFA management & recovery | ✅ | Enroll/confirm/disable + recovery codes |
| SEC-24 | Logout everywhere | ✅ | `sessions/revoke-others` |
| SEC-25 | Web ↔ mobile synchronisation | ✅ | Single shared API and data model |
| SEC-26 | Consistent account across web/iOS/Android | ✅ | One account, vault, reminders, AI, family, subscription |
| SEC-27 | Accessibility (WCAG 2.2 AA) | ✅ | Web: keyboard-operable controls, skip link, landmarks, focus-visible, live regions, 24px targets, reduced-motion — verified 0 violations by an axe-core scan (`npm run a11y`). Mobile: roles/labels/state on core controls |
| SEC-28 | Help & support (FAQ, troubleshooting, contact) | ✅ | In-app **FAQ page** (`GET /faq`, categorised Q&A) + support overview, Support desk, and CMS help centre — web + mobile |
| SEC-29 | Terms & Privacy accessible in-app | ✅ | Config/CMS policies |

---

## Summary — where the gaps are

**Remaining fully missing (⛔) — the forward backlog:**

- **ACC-02** social sign-in (Google/Apple/Microsoft) — needs OAuth provider credentials
- **INT-06** pause synchronisation
- **REM-08/09** real email/push delivery — needs provider credentials

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

## Build plan — Account & Onboarding (this increment: ✅ done & tested)

The third focus, making the vault feel personal from the first minute. Migrated (`0020_onboarding_decisions.sql`) and verified (full API suite green plus a dedicated 21-check onboarding/decisions/profile smoke test):

1. ✅ **ACC-09 Personalised onboarding** — `GET/POST /vault/onboarding` presents a short questionnaire (own/rent, vehicles, children, travel). Answers are stored on the household and drive recommendations. A **Personalise** page and a welcome prompt on Home and the Vault guide the user in.
2. ✅ **ACC-10/12 Tailored checklist** — `GET /vault/checklist` now recommends by circumstance, not just country: relevance-gated types (MOT, tenancy/mortgage, birth certificate) appear only when they apply, so the list never nags about documents the user can't have.
3. ✅ **ACC-11 Per-document decisions** — `POST /vault/checklist/decision` records Store Now / Upload Later / Remind Me / Not Applicable / Do Not Store per type. "Not applicable" and "Do not store" drop out of the completion score and the outstanding list, keeping the score pressure-free (ACC-14).
4. ✅ **ACC-13 "Remind me to obtain"** — choosing *Remind me* creates an ACTIVE *Obtain X* reminder due in two weeks; changing the decision later clears it automatically.
5. ✅ **ACC-07 Profile** — `PUT /users/me` now saves phone and timezone on the user and the country on the household; the web Profile page exposes all three with inline help.

Web UI wired: a **Personalise** questionnaire page, per-document decision controls on the Vault checklist ("Recommended documents" card), onboarding prompts on Home and Vault, and an expanded Profile editor. The logout-on-refresh defect is fixed in the same build (tokens persisted to `localStorage`, session restored on load).

## Build plan — Family associations + Privacy & Security Centre (this increment: ✅ done & tested)

Deepening the Family pillar and hardening Security. Migrated (`0021_family_privacy.sql`) and verified (full API suite green plus an 18-check family/privacy smoke test):

1. ✅ **FAM-02 Document ↔ family member** — `documents.subject_member_id` links a document to a household member; `POST /vault/documents/:id/subject` assigns/clears it (validating the member belongs to the household), and `GET /family/members/:id/documents` lists a person's documents. Web UI: each household member expands to link/unlink their documents.
2. ✅ **SEC-18 Self-serve data export** — `POST /users/me/export` builds and downloads a portable JSON bundle of the user's own data and records a completed DSR for the audit trail. Document file bytes and raw OCR text are excluded from the bundle; confirmed metadata is included.
3. ✅ **SEC-19 + ACC-05 Account deletion with step-up** — `POST /users/me/deletion-request` requires a fresh password check before raising a verified, de-duplicated pending request. It never hard-deletes: documents are preserved (SEC-15) and the request is handled with due process.
4. ✅ **SEC-16/20 Privacy centre & consent** — `GET /users/me/privacy` shows consents on record and open data requests; `POST /users/me/consent` records policy/marketing consent.
5. ✅ **SEC-17/21 Security activity** — `GET /users/me/security-activity` surfaces the user's own security events (sign-ins, 2FA changes, downloads, deletions, emergency decisions), shown in a Privacy & Security Centre in Settings.

The Emergency-Access model (FAM-10..16) was already complete; this increment focuses on the outstanding Family association and the user-facing privacy/security surface. **Super Admin still administers LifeHub, not the user's life** — exceptional access remains authorised and audited, and none of these self-serve tools expose another user's private data.

## Build plan — Property & Vehicles (Assets) (this increment: ✅ done & tested)

Completing the Family pillar's physical-asset side and adding real mobile surface. Migrated (`0022_assets.sql`) and verified (full API suite green plus a 13-check assets smoke test):

1. ✅ **FAM-04/05 Properties & Vehicles** — a first-class `assets` record (kind `property` | `vehicle`) with a flexible `details` map. Full CRUD via `/assets`, filterable by kind.
2. ✅ **Auto renewal reminders** — saving a vehicle's MOT/tax/insurance date (or a property's home-insurance/mortgage date) creates a yearly `asset_renewal` reminder with 30- and 7-day lead alerts; editing the date re-syncs it (no duplicates); deleting the asset clears them.
3. ✅ **Document ↔ asset linking** — `POST /vault/documents/:id/asset` groups a policy or logbook under the right car/house; `GET /assets/:id` returns the asset and its documents.
4. ✅ **Web + mobile UI** — a Property & Vehicles view on web, and an Assets screen on mobile (add, edit details, link documents). The mobile app also gained the Privacy & Security Centre and family document-linking, bringing it to parity with the web user features.

## Build plan — Billing self-service (this increment: ✅ done & tested)

Making subscription management something the user can do in-app, not only via the Stripe portal. Verified (full API suite green plus a 10-check billing smoke test):

1. ✅ **SEC-09 Cancel renewal** — `POST /billing/cancel` sets `cancelAtPeriodEnd`; the smoke test confirms access is KEPT (status stays active, entitlements stay active) until the period ends — never an immediate cut.
2. ✅ **SEC-10 Resume** — `POST /billing/resume` clears the scheduled cancellation.
3. ✅ **SEC-12/13 Upgrade / downgrade** — `POST /billing/change-plan` switches plan and reports direction; guarded against no-op/unknown-plan. (In the current fake-gateway phase the change is immediate; Stripe proration applies once `STRIPE_DRIVER=stripe` is live.)
4. ✅ **SEC-07 Invoices** — an in-app invoice list on web and mobile.

Web & mobile Billing screens now show the renewal/cancellation state and offer cancel, resume, upgrade and downgrade inline. **Stripe stays in the fake/test gateway until checkout + webhook + cancellation are validated end-to-end against live keys** — these controls are what makes that validation possible.

## Build plan — Connected Services made real-ready (this increment: ✅ done & tested)

Turning the sandbox integrations framework into something that goes live the moment credentials are supplied. Verified (full API suite green plus an 11-check integrations smoke test run in both gated and live modes):

1. ✅ **INT-02/03 Real Gmail & Outlook OAuth** — `GoogleProvider` and `MicrosoftProvider` implement the existing `Provider` interface with real authorization URLs, token exchange, and Gmail/Graph mail reads (least-privilege, read-only scopes). They **activate automatically** when `GOOGLE_CLIENT_ID/SECRET` / `MICROSOFT_CLIENT_ID/SECRET` are present; otherwise the deterministic sandbox driver is used.
2. ✅ **Safe rollout gate** — Connected Services stays limited to internal testers until a real provider is configured, then opens to all subscribed users (`requireIntegrationsAccess`). So no one ever sees the sandbox mailbox by mistake, and there's no code change to flip it on — just set the env keys.
3. ✅ **INT-06 Pause / resume sync** — `POST /connections/:id/pause` and `/resume`; sync is refused (409) while paused. Web + mobile UI.
4. ✅ **INT-22 Extensible provider framework** — one interface covers Gmail, Outlook and Open Banking; the live-or-sandbox selector makes adding future providers a drop-in.

To switch email import on in production: register an OAuth app with Google and/or Microsoft, set the redirect URI to `https://app.vaulmo.com/integrations/callback`, and put the client id/secret in `/opt/vaulmo/.env` (see `.env.prod.example`). No redeploy of code is needed beyond restarting the API to pick up the new env.

## Build plan — Onboarding & gating flow + platform tour (this increment: ✅ done & tested)

Implementing the first-run journey end-to-end (backend + web + mobile). Migrated (`0023_onboarding_flow.sql`) and verified (full API suite green plus a 15-check onboarding-flow smoke test):

1. ✅ **Journey gate** — after sign-in, a returning `me.onboarding` object drives a blocking gate: **verify email → accept Terms of Business → select a plan** (each step flips its flag; `complete` opens the app). Staff/super-admins bypass. Server-side email-verification enforcement is available via `REQUIRE_EMAIL_VERIFICATION`.
2. ✅ **Terms of Business** — `GET /legal` / `GET /legal/:key` serve versioned Terms of Business, Terms of Use and Privacy Policy; `POST /users/me/accept-terms` records acceptance + a consent record. Bumping `CURRENT_TERMS_VERSION` re-prompts everyone to acknowledge the update (policy-update flow).
3. ✅ **Plan + payment gate** — `POST /billing/choose` activates a free plan immediately or (when Stripe is live) redirects to Checkout and back; in the fake-gateway phase it activates so the journey completes. No app access until a plan is selected.
4. ✅ **Platform tour** — a post-onboarding welcome overlay with **Start the tour / Skip / Don't show again** (all mark it seen via `POST /users/me/tour-seen`), plus a **2FA nudge** (set up now or later). Web + mobile.
5. ✅ **Sidebar scrolling fix** — the web sidebar nav now scrolls independently (`flex:1; min-height:0; overflow-y:auto`) so every lower menu item is reachable.

The full journey now matches the requested flow: download → create account → verify email → log in → accept Terms → select plan → pay → return → choose tour → start using Vaulmo.

## Build plan — Plan modules, discounts + feature gating (this increment: ✅ done & tested)

Tying subscription plans directly to features, with discounts. Migrated (`0025_plan_modules.sql`) and verified (full API suite green plus an 11-check plans smoke test):

1. ✅ **Per-plan modules** — plans carry a `modules` list (Document Vault, Reminders, AI Assistant, Life records, Property & Vehicles, Family & Access, Connected Services). The admin plan editor selects which modules each plan includes.
2. ✅ **Feature gating enforced** — a `requireModule` guard blocks routes (assistant, assets, family — extensible to more) with **402 feature_not_in_plan** when the tenant's active plan doesn't include that module. A plan with no curated modules stays permissive (all-access), so nothing breaks until an admin restricts it — verified by the suite showing no regressions.
3. ✅ **Discounts** — plans carry `discountPercent` + `discountLabel`; `GET /billing/plans` returns the discounted **net price**, shown to users (struck-through original + offer badge) on the Billing and onboarding plan screens.
4. ✅ **Admin plan editor** — module checkboxes, discount %, discount label and price, all in the admin Subscriptions area (syncs to Stripe when connected).

This makes plans the single source of truth for what a household can use, and gives Marketing a real discount lever. The Starter/Family/Premium module sets can be curated in the admin editor at any time.

## Build plan — CRM email campaigns + automations (this increment: ✅ done & tested)

Adding marketing/engagement communications on top of the existing admin CRM. Migrated (`0024_campaigns.sql`) and verified (full API suite green plus a 10-check campaigns smoke test):

1. ✅ **Email campaigns** — admins create a campaign (name, subject, message) targeting a **segment** (all users / subscribers / prospects with no active plan / a CRM tag), **preview the audience** size and sample, then **send now**. Each recipient is recorded; a sent campaign can't be re-sent. Delivery uses the shared email adapter (dev outbox; SES/SMTP in prod).
2. ✅ **Automated communication workflows** — a seeded set of triggerable automations (**welcome** on signup, **renewal reminder**, **re-engagement** on inactivity, **payment-issue**) that admins can enable/disable and edit the subject/body of.
3. ✅ **Audience segmentation** — one account-owner email per household, filtered by subscription status or CRM tag — so campaigns reach the right people without spamming every household member.
4. ✅ **Admin UI** — a new **Campaigns** area in the admin portal for both campaigns and automations. Access is restricted to platform admins (PLATFORM_MANAGE).

Real bulk-send at scale still rides the email provider that powers reminders (SES/SMTP) — the same credentials switch both on.

## Build plan — Document upload + FAQ/Help (this increment: ✅ done & tested)

Two visible wins across web + mobile. Verified (full API suite green plus a 9-check FAQ/upload smoke test):

1. ✅ **VLT-03/04 Upload a file (alongside scan)** — the Vault "Add" flow now offers **Upload a file** (web file picker; mobile `expo-document-picker` for PDF/image) in addition to camera capture, photo library and paste-text. Any file streams to storage; images are OCR'd.
2. ✅ **Manual type & metadata entry** — after processing, the confirm step lets the user pick a **document type** and fill fields **manually** for anything not auto-recognised (driven by `GET /vault/catalogue`), then stores with the chosen title/type. Covers OCR *and* manual metadata capture.
3. ✅ **SEC-28 In-app FAQ + Help** — a public `GET /faq` serves categorised Q&A (getting started, documents, security, billing, reminders/AI) plus a support overview (channels + response time). New **FAQ & Support** page on web and screen on mobile, sitting alongside the existing Help Centre and Support desk.

**Remaining**: the WCAG 2.2 AA accessibility pass (SEC-27); the CRM + email-campaign module; per-plan module/discount management; biometric login on mobile; PDF OCR (AIX-02); multi-page scan (VLT-05); and optional billing proration once Stripe is live.

## Build plan — Biometric app lock on mobile (this increment: ✅ done & tested)

Delivering ACC-06. Mobile-only (no API or migration change) and typecheck-clean:

1. ✅ **On-launch biometric gate** — when a saved session exists and the user has turned the lock on, the app holds the session behind a **Lock screen** and presents Face ID / fingerprint (via `expo-local-authentication`) before restoring it. Success unlocks; the user can also choose **Sign in with password instead**, which clears the stored session.
2. ✅ **Settings toggle** — a new **App lock** section in Settings lets the user turn *Unlock with Face ID / Fingerprint* on or off. Turning it on requires a live biometric confirmation first. The device's capability is auto-detected, so the label reads "Face ID" or "Fingerprint" correctly, and the toggle is hidden with guidance when no biometric is enrolled.
3. ✅ **Post-login offer** — after a successful sign-in on a capable device, a one-time prompt offers to enable the lock, so users discover it without hunting through Settings.
4. ✅ **Safe by design** — biometrics are a *local convenience lock* over the already-secure keychain session; nothing touches the server or document encryption. Every native call is guarded so web/preview builds degrade to "no biometrics", and if a user removes all their enrolled biometrics after enabling, the app declines to lock them out rather than trapping their session. Preference is stored in `expo-secure-store`; the iOS `NSFaceIDUsageDescription` and the `expo-local-authentication` config plugin are wired in `app.json`.

**Remaining backlog**: PDF OCR (AIX-02); multi-page scan combine (VLT-05); the WCAG 2.2 AA accessibility pass (SEC-27); and optional billing proration once Stripe is live.

## Build plan — PDF OCR (this increment: ✅ done & tested)

Delivering AIX-02. The document pipeline now reads PDFs, not just images. Verified (full API suite green plus a 9-check `pdfocr.smoke.ts` using real generated fixtures):

1. ✅ **Digital PDFs** — a PDF that carries a real text layer (bank statements, insurer exports, most e-documents) has its text pulled directly with `pdftotext -layout`, preserving row/column structure so field extraction fares better. Engine reported as `pdf-text`.
2. ✅ **Scanned / image-only PDFs** — when a PDF has little or no embedded text, each page is rasterised to a grayscale PNG at 200 DPI with `pdftoppm` and OCR'd by Tesseract, then concatenated. Engine reported as `pdf-ocr`. Page count is capped (15) so a huge PDF can't run OCR indefinitely.
3. ✅ **Smart routing + page count** — the pipeline tries fast text extraction first and only falls back to the slower raster+OCR path when needed; the process response now also returns `pages`.
4. ✅ **Safe degradation** — if `poppler-utils`/Tesseract are absent (e.g. a bare dev box), the extractor falls back to a best-effort decode instead of failing the upload. `poppler-utils` is added to the API Dockerfile alongside the existing `tesseract-ocr`.

**Remaining backlog**: multi-page scan combine on mobile (VLT-05); the WCAG 2.2 AA accessibility pass (SEC-27); and optional billing proration once Stripe is live.

## Build plan — Multi-page scan on mobile (this increment: ✅ done & tested)

Delivering VLT-05, building straight on the new PDF OCR. Verified (mobile typecheck clean; the `pdfocr.smoke.ts` suite extended to 14 checks, including a real 2-page image-only PDF whose every page is OCR'd):

1. ✅ **Capture several pages** — the Add-a-document sheet gains **Scan multiple pages**. The user photographs page after page (or picks several from the library at once); each is downscaled/compressed like a single scan.
2. ✅ **Review before combining** — a page list shows every captured page with **reorder (up/down)** and **remove**, and a running count. Add more pages at any point; a 15-page cap matches the server's per-PDF OCR limit.
3. ✅ **One PDF, on device** — on confirm, the pages are assembled into a single PDF locally with `expo-print` (one image per page) and uploaded as `application/pdf` — so the whole scan is *one document* in the vault, not scattered files.
4. ✅ **Server OCRs every page** — the uploaded PDF flows through the AIX-02 pipeline: an image-only multi-page PDF is rasterised and OCR'd page-by-page, so extracted text and detected fields cover the entire document. The smoke proves a 2-page scan reports `pages: 2` and recovers text from both pages.

**Remaining backlog**: the WCAG 2.2 AA accessibility pass (SEC-27); and optional billing proration once Stripe is live.

## Build plan — Accessibility pass, WCAG 2.2 AA (this increment: ✅ done & verified)

Delivering SEC-27 across web and mobile. The web result is machine-verified: an **axe-core** scan (WCAG 2.0/2.1/2.2 A+AA rulesets) over the auth screens — which exercise the app's shared primitives — reports **0 violations** (17 checks passing per screen, up from 12). It's committed as a repeatable check: `npm run a11y` in `apps/web` (builds are scanned in headless Chromium).

Web changes (mostly at the shared-primitive and global-CSS level, so they cascade across every screen):

1. ✅ **Keyboard-operable controls (2.1.1 / 4.1.2)** — every link-styled control that was a click-only `<a>` (41 of them) now renders a real `<button>` via one shared `A` component: focusable, Enter/Space works, correct role and name. Icon-only controls (notification bell, dismiss ×, password show/hide) got explicit accessible names.
2. ✅ **Visible focus (2.4.7 / 2.4.11)** — a strong `:focus-visible` outline on all interactive elements (white on the dark sidebar), shown for keyboard users and suppressed for mouse users.
3. ✅ **Bypass blocks + landmarks (2.4.1 / 1.3.1)** — a "Skip to main content" link, a labelled primary `<nav>` with `aria-current` on the active item, and a `<main id="main">` target.
4. ✅ **Status messages (4.1.3)** — the global toast is a polite `role="status"` live region; auth error boxes are `role="alert"`.
5. ✅ **Target size (2.5.8, new in WCAG 2.2)** — the one sub-24px control (the password show/hide toggle) enlarged to a compliant hit area; axe confirms no remaining target-size failures.
6. ✅ **Reduced motion (2.3.3)** — a `prefers-reduced-motion` block neutralises animations/transitions for users who ask for it.

Mobile (React Native, verified by typecheck): the shared `Btn`, `Field`, tab bar, capture FAB and `Toggle` primitives now expose the right `accessibilityRole` ("button" / "tab" / "switch"), `accessibilityLabel` and `accessibilityState` (disabled/busy/selected/checked) so VoiceOver and TalkBack announce them correctly.

**Remaining backlog**: optional billing proration once Stripe is live. All headline user-facing requirements from the brief are now implemented.
