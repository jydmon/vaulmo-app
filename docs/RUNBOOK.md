# Vaulmo Deployment Runbook

A practical, step-by-step guide to deploying Vaulmo and promoting it through the
environments. It assumes a competent engineer/DevOps operator. Commands are portable
(Docker + a container host + a managed Postgres + object storage); adapt the provider
specifics to wherever you host.

Environments and their promotion order:

```
Development → Staging → Internal Alpha → Closed Pilot → Production
                     │
Emergency Access:    └→ Dedicated Security Testing → Controlled Pilot → Production (own gate)
Billing (Stripe):    Test Mode → Staging(test) → Live Mode (own gate)
Email connectors:    Provider Sandbox → Staging → Pilot (per-cohort) → Production
```

Nothing is public until the Production step, and even then only behind a TLS ingress + WAF.

---

## 0. Prerequisites (once)

- A container registry (e.g. GHCR — the CI already pushes `lifehub-api` and `lifehub-web`).
- A container host per environment (ECS/Fargate, Cloud Run, Kubernetes, or a VM running
  `docker compose`). Each environment is **isolated**: its own database, bucket and secrets.
- Managed **PostgreSQL 16** per environment (TLS required outside dev).
- **Object storage** bucket per environment (S3 / GCS / R2) — private, encrypted at rest.
- A **secret store** (AWS Secrets Manager / GCP Secret Manager / Doppler / Vault).
- A monitoring stack (Prometheus/Grafana, Datadog, or CloudWatch) — the API exposes
  `/livez`, `/readyz`, `/metrics`.
- A private network / VPN so non-production environments are reachable only internally.

## 1. Generate secrets (per environment)

Never reuse secrets across environments.

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY (Phase 9 token encryption, 32 bytes)
# DATABASE_URL, S3 creds, Stripe keys, email/push provider creds → from the provider
```

Store them in the secret store and inject at deploy time. Templates to fill:
`infra/env/{dev,staging,internal-alpha,closed-pilot}.env.example`.

## 2. Development environment (local / shared dev)

The fastest path is the bundled Docker Compose stack — the exact thing the test suite runs
against.

```bash
cp infra/env/dev.env.example .env
docker compose up --build            # api:4000, web:8080, postgres (localhost only)
```

Or run the API directly against a local Postgres:

```bash
cd apps/api
cp ../../infra/env/dev.env.example .env   # edit DATABASE_URL
npm install
npm run db:migrate      # apply all migrations (idempotent)
npm run seed            # roles, permissions, super admin, catalogue, plans, internal tester
npm run test            # the full 154-check suite (needs tesseract-ocr for OCR test)
```

Default accounts (dev only — change in every other environment):
`admin@lifehub.local / ChangeMe123!` (Super Admin), `tester@lifehub.local / Tester123!`
(internal tester).

## 3. First deploy to a real environment (Staging as the example)

1. **Provision** the DB, bucket and secrets (steps 0–1).
2. **Fill** `infra/env/staging.env` from the secret store (copy from `.example`).
3. **Migrate** — run migrations as a one-off job before starting the app so a bad migration
   never leaves a half-started service:
   ```bash
   docker run --rm --env-file infra/env/staging.env $REGISTRY/lifehub-api:$TAG \
     npx tsx src/db/migrate.ts
   ```
4. **Seed** (first deploy only — idempotent, safe to re-run):
   ```bash
   docker run --rm --env-file infra/env/staging.env $REGISTRY/lifehub-api:$TAG \
     npx tsx src/db/seed.ts
   ```
   Then immediately rotate/replace the default Super Admin password.
5. **Start** the `api` and `web` services (via your orchestrator or the staging compose
   overlay):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
   ```
6. **Schedule the reminder engine.** The engine does not self-run — a cron/worker must call
   it (hourly is typical). Two options:
   - a scheduled job hitting `POST /api/v1/notifications/run-tick` with a Super Admin token, or
   - a small cron container running `npx tsx -e "import('./src/lib/reminderEngine').then(m=>m.runReminderTick())"`.
   Set `REMINDER_TICK_CRON` in the env for documentation; wire the actual schedule in your host.
7. **Smoke test** (see §7).

## 4. Promotion (build once, promote the same image)

CI builds and tags images by commit and deploys to Development automatically; each further
environment is a **gated approval** in `.github/workflows/deploy.yml` (GitHub Environments
with required reviewers). To promote:

1. Merge to `main` → CI builds `lifehub-api:sha-<commit>` + `lifehub-web:sha-<commit>` and
   deploys to Development.
2. Approve **Staging** → same image promoted; run migrations against the staging DB first.
3. Approve **Internal Alpha** → same image; access to Phase 2/3+ features is additionally
   gated per-user by `is_internal_tester`.
4. Approve **Closed Pilot** → same image; a small group of real pilot users (flagged
   internal testers). Phases 4 & 5 make it genuinely useful.
5. **Production** → same image; only now behind a public TLS load balancer + WAF.

Always run `migrate` against the target DB **before** the new image serves traffic.

## 5. Feature-specific rollouts

### Stripe (Phase 6): Test → Live
- Staging runs `STRIPE_DRIVER=stripe` with **test** keys. Verify: create a plan (Super Admin),
  run Checkout, complete it, confirm the webhook activates the subscription, then test a
  renewal, a failed payment (grace), and a cancellation.
- Register the webhook endpoint `POST /api/v1/stripe/webhook` in the Stripe dashboard and set
  `STRIPE_WEBHOOK_SECRET`.
- **Only after** the full checkout + webhook + cancellation flows pass in staging, switch
  Production to **live** keys (the `stripe-go-live` gate). Do a single real low-value
  transaction end to end before opening signups.

### Emergency Access (Phase 8): the strict path
- Keep `EMERGENCY_ACCESS_ENABLED=false` everywhere → the product shows "Emergency Access
  coming soon". Vaulmo can launch with next-of-kin registration in this state.
- Enable it only after: the legal process is defined, identity verification is in place, and
  operating procedures + the Super Admin due-diligence checklist are written.
- Path: Development → **Dedicated Security Testing** (isolated env + pen test of the workflow)
  → Staging → **Controlled Pilot** (consented users) → **Production**. Flip
  `EMERGENCY_ACCESS_ENABLED=true` per environment as each gate is signed off.

### Email connectors (Phases 9–10): provider-sandbox-first
- Create Google Cloud + Microsoft Entra **test** OAuth apps; use test mailboxes.
- Verify the OAuth round-trip and sync against the sandbox before staging.
- Roll out per cohort using the `is_internal_tester`/pilot gate — do **not** enable for
  everyone at once. Move to real Google/Microsoft app verification only when the cohort is
  stable.

## 6. Configuration reference (key env vars)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (TLS/`sslmode=require` outside dev) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | token signing (unique per env) |
| `ENCRYPTION_KEY` | 32-byte key for encrypting integration tokens at rest |
| `STORAGE_DRIVER` / `S3_*` | `local` (dev) or `s3` + bucket/region |
| `STRIPE_DRIVER` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | `fake` (dev/CI) or `stripe` |
| `EMERGENCY_ACCESS_ENABLED` | `false` until the emergency process is ready |
| `CORS_ORIGINS` | explicit internal origins only until Production |
| `LOG_LEVEL` | `info` normally |

## 7. Smoke tests (run after every deploy)

```bash
curl -fsS $BASE/livez        # process up
curl -fsS $BASE/readyz       # DB reachable
# auth round-trip:
curl -fsS -XPOST $BASE/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@…","password":"…"}' | jq .accessToken
```

For a deeper gate, point the `test:e2e` suite at a disposable schema in the target
environment (never the production DB).

## 8. Monitoring & alerts

- Scrape `GET /metrics` (Prometheus format) — users, tenants, active sessions.
- Alert on: `readyz` failing, error-rate spikes (5xx in logs), failed audit writes
  (`AUDIT WRITE FAILED` in logs), Stripe webhook 4xx/5xx, and the reminder tick not running.
- Ship structured logs (pino JSON) to your log store; they already redact tokens/secrets.

## 9. Rollback

Images are immutable and tagged by commit, so rollback = redeploy the previous tag.

```bash
TAG=sha-<previous> docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

Migrations are **additive** (new tables/columns), so rolling the app back one release is
safe without a DB downgrade. If a migration must be reverted, write a new forward migration
that undoes it — do not hand-edit applied migrations.

## 10. Backups & DR

- Enable automated encrypted backups + point-in-time recovery on each environment's Postgres.
- Enable versioning on the object-storage bucket.
- Periodically test restore into a scratch environment.

## 11. Production go-live checklist

- [ ] Unique secrets set from the secret store (no defaults anywhere).
- [ ] Default Super Admin password rotated; MFA enrolled on admin accounts.
- [ ] Migrations applied; seed run once; `readyz` green.
- [ ] Reminder engine scheduled and observed firing.
- [ ] TLS ingress + WAF/rate-limit in front; `CORS_ORIGINS` set to the real web origin.
- [ ] Stripe live keys + webhook verified with one real transaction.
- [ ] `EMERGENCY_ACCESS_ENABLED` decision made (stays `false` until the process is ready).
- [ ] Email connectors: real provider apps verified, per-cohort rollout plan set.
- [ ] Backups + PITR enabled and a restore tested.
- [ ] MFA-secret-at-rest encryption and any remaining items in `docs/SECURITY.md` addressed.
- [ ] Monitoring dashboards + alerts live; on-call defined.
- [ ] Penetration test completed (especially the emergency-access workflow).
```
