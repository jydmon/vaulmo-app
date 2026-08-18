# Architecture — Phase 1

## Shape

A small monorepo with three apps and shared infrastructure:

```
apps/api      Node + TypeScript (Express) REST API — the security core
apps/web      React + Vite web shell (admin + auth)
apps/mobile   Expo / React Native shell (end-user auth)
infra/        Docker, env templates, Terraform skeleton, monitoring
.github/      CI (build + the 33-check test) and Deploy (dev → staging)
```

The API is the only thing that touches the database and object storage. The web and
mobile apps are thin clients that call the API — so security is enforced in exactly
one place.

## Backend layers

```
request → helmet + CORS + rate-limit → JSON parse
        → route (module)
        → requireAuth (verify JWT)          [auth middleware]
        → requireMfaSatisfied               [auth middleware]
        → requirePermission(...)            [rbac middleware]
        → handler → Drizzle → PostgreSQL
        → audit() append-only write
        → error handler (never leaks stack traces)
```

Modules live under `apps/api/src/modules/*` (auth, mfa, users, admin, files, health).
Cross-cutting helpers are in `apps/api/src/lib/*` (password, jwt, totp, permissions,
storage, audit).

## Data model (PostgreSQL, via Drizzle ORM)

- **tenants** — customer accounts (household/individual), with status + plan.
- **users** — belong to a tenant (Super Admins have no tenant). Hold password hash,
  MFA secret + recovery codes, lockout counters.
- **roles / permissions / role_permissions / user_roles** — RBAC. Roles are seeded
  (`super_admin`, `tenant_owner`, `member`); permissions are granular
  (e.g. `tenant:read:all`, `file:write`).
- **sessions** — one row per refresh token (stored only as a hash); rotation revokes
  the old one. Tracks whether MFA was satisfied on that session.
- **file_objects** — metadata for stored files; bytes live in object storage. Tenant-scoped.
- **audit_logs** — append-only; the database itself blocks UPDATE/DELETE via rules.

Why Drizzle (not Prisma): it's pure TypeScript over `node-postgres` with no
downloaded binary engine, so it builds and runs anywhere — including air-gapped CI
and any container host. Migrations are plain SQL applied by a tiny runner
(`src/db/migrate.ts`), so there is no magic between you and your database.

## Authentication flow

1. **Register** → creates a tenant + owner user, returns an access token (15 min) and
   a refresh token (30 days).
2. **Login** → verifies the password (bcrypt). If MFA is on, returns a short-lived
   *challenge token* instead of a session.
3. **Login/MFA** → verifies a TOTP code (or a one-time recovery code) and issues the
   real session.
4. **Refresh** → rotates the refresh token; the previous one is invalidated.
5. Access tokens are stateless JWTs carrying the user's roles + permissions, so
   authorization checks need no database round-trip.

## File storage

`storage.ts` exposes one interface with two drivers: `local` (filesystem, for dev)
and `s3` (object storage, for staging/prod). The API issues a presigned upload URL,
the client uploads the bytes, and the API records the checksum + marks the file
`STORED`. In production the bytes never pass through the app tier.

## Observability

Structured JSON logs (pino) with secrets redacted, plus `/livez` (liveness),
`/readyz` (readiness — checks the DB) and `/metrics` (Prometheus text) for probes and
scraping. `infra/monitoring/prometheus.yml` is a ready scrape config.
