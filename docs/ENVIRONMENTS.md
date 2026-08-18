# Environments & Promotion — Dev → Staging

Phase 1 uses two isolated environments and a promotion gate between them. Phase 2/3
add a third stage — **Internal Alpha** — for internal testers only. **None are public.**

```
Development  →  Staging  →  Internal Alpha
   (auto)       (gate 1)      (gate 2, internal testers only, synthetic docs only)
```

Internal Alpha runs the same promoted image with its own DB/secrets, and access to the
Phase 2/3 vault is additionally gated per-user by the `is_internal_tester` flag. Testers
use **synthetic documents only** at this stage — no real highly sensitive data. Config
template: `infra/env/internal-alpha.env.example`; pipeline stage: `promote-internal-alpha`
in `.github/workflows/deploy.yml`.

## The principle: build once, promote the same artifact

CI builds container images once and tags them by commit. Those exact images are
deployed to **Development** automatically, then — after a human approval — the *same
images* are promoted to **Staging**. Nothing is rebuilt between environments, so what
you test in dev is bit-for-bit what runs in staging. Only the **config and secrets**
differ per environment.

```
push to main
   │
   ▼
[ build & push images ]  tag = sha-<commit>
   │
   ▼
[ deploy → DEVELOPMENT ]   (auto)   private network, own DB, own secrets
   │
   ▼   ← manual approval (GitHub "staging" environment reviewers)
[ promote → STAGING ]      (gated)  private network, own DB, own secrets
```

The pipeline is in `.github/workflows/deploy.yml`. The approval gate is a GitHub
*Environment* named `staging` with required reviewers — that is the promotion control.

## What differs per environment

| | Development | Staging |
|---|---|---|
| Database | own Postgres (dev data) | own Postgres (separate, TLS) |
| Secrets | dev-only, in repo templates | from a secret store, never committed |
| File storage | `local` driver | `s3` driver (private bucket) |
| Exposure | localhost only | private network / VPN only — **not public** |
| Images | built locally / by CI | **promoted** from the dev build |

Environments never share a database or bucket, so there is no way for staging traffic
to touch dev data or vice-versa.

## Why nothing is public yet

Every published port binds to `127.0.0.1` (see `docker-compose*.yml`), and the staging
overlay publishes only to the host loopback, reachable via VPN/bastion. There is no
TLS-terminating public ingress and no public DNS. Making it public is a **later
phase** and needs: a public load balancer + TLS, WAF/rate-limit at the edge, a
security review of the emergency-access flow, and a pen test.

## Runbook

**Stand up Development (locally):**
```bash
cp infra/env/dev.env.example .env
docker compose up --build
```

**Prepare Staging (on your private host):**
```bash
cp infra/env/staging.env.example infra/env/staging.env   # fill from your secret store
# provision managed Postgres + object storage (see infra/terraform/main.tf)
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
# migrations run automatically on api start, or run them as a separate init job:
#   docker compose run --rm api npx tsx src/db/migrate.ts
```

**Promote a build to Staging:** merge to `main` → the deploy workflow builds and
deploys to development, then waits on the `staging` approval → a reviewer approves →
the same image tag is promoted.

## Secrets

- Generate unique secrets per environment: `openssl rand -base64 48` for each JWT secret.
- Never commit `infra/env/staging.env` or `.env` (they are gitignored).
- In a real host, inject secrets from AWS Secrets Manager / GCP Secret Manager /
  Doppler / Vault at deploy time rather than files on disk.
