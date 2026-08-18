# Security posture — Phase 1

This foundation is security-first because Vaulmo holds people's most sensitive
documents. What's already enforced, and what later phases add:

## Already in place

- **Password storage:** bcrypt (cost 12). Interface is swappable to argon2id.
- **Password policy:** min 10 chars with letters + numbers, checked at the edge and in code.
- **MFA:** TOTP (RFC 6238), compatible with Google Authenticator / Authy / 1Password.
  One-time recovery codes are stored hashed. MFA-enabled logins get a challenge token,
  not a session, until a valid code is supplied.
- **Tokens:** short-lived (15 min) stateless JWT access tokens; long-lived **refresh
  tokens are opaque and stored only as SHA-256 hashes**. Refresh **rotates** — a used
  token can't be replayed (proven in the test suite).
- **RBAC:** every privileged route is guarded by explicit permissions. A Tenant is
  denied all platform-admin routes; denials are audited.
- **Brute-force protection:** account locks for 15 minutes after 5 failed logins;
  auth endpoints are additionally rate-limited (20 / 15 min / IP).
- **Tenant isolation:** file access is filtered by the caller's tenant id; a user can
  only see their own tenant's files.
- **Audit log:** append-only at the application layer *and* enforced by the database
  (UPDATE/DELETE are blocked by rules). Captures registration, logins (success/
  failure), MFA changes, uploads, and authorization denials.
- **Transport & headers:** helmet security headers; CORS restricted to explicit
  internal origins (no public origin in Phase 1); TLS required to the DB outside dev.
- **No leakage:** errors never return stack traces; logs redact tokens, passwords and
  MFA secrets.
- **Least privilege runtime:** API container runs as a non-root user.

## Hardening the next phases add (tracked, not yet done)

- **Encrypt `users.mfaSecret` at rest** with a KMS-backed key (currently stored
  plaintext in the DB row — acceptable for a private Phase 1 foundation, not for
  production). Same for any future document-derived secrets.
- **httpOnly, Secure, SameSite cookie** for the refresh token on web (the shell keeps
  it in memory today for simplicity).
- **Email verification + password reset** flows.
- **Device/session management UI** (list and revoke sessions).
- **Emergency-access process** (next of kin): identity verification + waiting period +
  full audit — needs a dedicated design and security review.
- **Edge protections** before any public launch: WAF, bot/abuse protection, a public
  TLS ingress, and a third-party penetration test.
- **Backups & DR**: automated encrypted backups + point-in-time recovery per environment.

## Secrets handling

Dev secrets are throwaway values in `infra/env/dev.env.example`. Staging/production
secrets must come from a managed secret store and be unique per environment. Rotate
JWT secrets by environment; rotating invalidates existing sessions (by design).

## Update — completed since the foundation

- **MFA secret encrypted at rest** (AES-256-GCM, `lib/crypto.ts`) — proven in `test:e2e:extra`.
- **Email verification + password reset** (single-use hashed expiring tokens; reset revokes all
  sessions; no user enumeration) — proven in `test:e2e:extra`.
- **Integration tokens encrypted at rest** (Phase 9, same AES-256-GCM).
- **Reminder worker** (`src/worker.ts`) so the engine runs on a schedule, not just via the API.
- **Device / session management UI** — the access token now carries its session id (`sid`);
  users can list every active session (with "This device" flagged), sign out a single device,
  or sign out everywhere else. Revoked sessions can no longer refresh. Proven in `test:e2e:extra`.
- **Open Banking (sandbox-first)** — a mock AISP driver + recurring-payment detector surface
  subscriptions as **pending** detected items; nothing goes live until the user confirms, and
  variable/one-off spend is never flagged. Real bank data is gated behind an FCA-authorised
  AISP contract + security review per environment. Proven in `test:e2e:extra`.

Remaining hardening: KMS-backed `ENCRYPTION_KEY`, httpOnly refresh-token cookie on web,
plus the pre-launch items (public TLS ingress, WAF, pen test).
