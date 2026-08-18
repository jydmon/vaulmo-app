# Deploying Vaulmo to Render

This is the click-by-click guide to putting Vaulmo live on **Render**, using **GitHub
Desktop** to push the code. No prior server experience needed. It takes about 30–40 minutes
the first time.

Render reads the `render.yaml` file in this repo and builds everything for you: a managed
**PostgreSQL** database, the **API**, the **reminder worker**, and the **web app** — each with
HTTPS automatically. Migrations run on their own before every deploy.

> **What gets hosted here:** the web app, the API, and the database.
> **The mobile app is NOT hosted on Render** — it gets built and submitted to the App Store /
> Google Play. That's covered at the end.

---

## What you need first

1. A **GitHub** account (free) and **GitHub Desktop** installed.
2. A **Render** account (free to create) — sign up with your GitHub account so Render can see
   your repositories.
3. This project as a folder on your computer (unzip `lifehub-platform-full.zip`).

---

## Step 1 — Put the code on GitHub (GitHub Desktop)

1. Open **GitHub Desktop** → **File → Add Local Repository** → choose the unzipped
   `lifehub-platform` folder. If it says it's not a git repository, click **create a
   repository** on that same screen.
2. GitHub Desktop will show a long list of files as the first commit. The project already has a
   `.gitignore`, so secrets (`.env`) and `node_modules` are **excluded automatically** — good.
3. In the bottom-left, type a summary like `Initial Vaulmo commit` and click
   **Commit to main**.
4. Click **Publish repository** (top bar). Name it e.g. `lifehub`, keep it **Private**, and
   publish.

That's your repo. From now on, any time you **Commit** + **Push** in GitHub Desktop, Render
redeploys automatically.

---

## Step 2 — Create the Blueprint on Render

1. In the Render dashboard, click **New → Blueprint**.
2. Select your `lifehub` repository. Render finds `render.yaml` and shows the four resources it
   will create: **lifehub-db**, **lifehub-api**, **lifehub-worker**, **lifehub-web**.
3. Click **Apply**. Render now asks you to fill in a few values it can't invent for you (these
   are the ones marked "sync: false" in the file). Fill them in as below.

### The values to paste in

| Where | Key | What to enter |
|-------|-----|---------------|
| shared group | `ENCRYPTION_KEY` | A 32-byte key — see below. **Set once, never change it.** |
| lifehub-api | `SUPERADMIN_EMAIL` | Your admin login email, e.g. `you@yourdomain.com` |
| lifehub-api | `SUPERADMIN_PASSWORD` | A strong password (10+ chars, letters + numbers) |
| lifehub-api | `CORS_ORIGINS` | Leave blank for now — you'll set it in Step 4 |
| lifehub-web | `VITE_API_URL` | Leave blank for now — you'll set it in Step 4 |

**Generating the encryption key.** On a Mac, open Terminal and run:

```bash
openssl rand -base64 32
```

Copy the output (a random ~44-character string) into `ENCRYPTION_KEY`. On Windows without
Terminal, you can run the same command in **Git Bash** (installed alongside GitHub Desktop), or
generate one at any "random 32 byte base64" tool. **This key protects two-factor secrets and
connected-account tokens — if it ever changes, that encrypted data becomes unreadable, so store
a copy somewhere safe (a password manager).**

4. Click **Apply / Create**. Render provisions the database first, then builds the API, worker,
   and web app. The first build takes a few minutes (it installs Tesseract for document OCR).

---

## Step 3 — Seed the first admin account (one time)

The database starts empty. Seed the roles, permissions, plans and your admin user once:

1. Open the **lifehub-api** service → **Shell** tab.
2. Run:

   ```bash
   npx tsx src/db/seed.ts
   ```

   You'll see it create roles, permissions, the subscription plans and your super-admin account
   (using the email/password you set in Step 2). You only ever do this once.

---

## Step 4 — Connect the web app and API (two URLs)

After the first deploy, each service has a public URL shown at the top of its page, e.g.
`https://lifehub-api.onrender.com` and `https://lifehub-web.onrender.com`. Now tell them about
each other:

1. **lifehub-web → Environment →** set `VITE_API_URL` to the **API** URL
   (e.g. `https://lifehub-api.onrender.com`, no trailing slash). Save.
2. **lifehub-api → Environment →** set `CORS_ORIGINS` to the **web** URL
   (e.g. `https://lifehub-web.onrender.com`). Save.
3. Both services redeploy automatically. When they're green, open the **web** URL and sign in
   with your super-admin email and password.

> Why this step exists: the browser app calls the API across two different addresses, and the
> API only accepts requests from origins you explicitly allow. These two values wire that up.

You're live. 🎉

---

## Step 5 — Your own domain (optional, recommended)

1. On **lifehub-web** → **Settings → Custom Domains**, add e.g. `app.yourdomain.com` and follow
   the DNS instructions. HTTPS is issued automatically.
2. Do the same on **lifehub-api** for e.g. `api.yourdomain.com` if you want a branded API URL.
3. **Update the two values from Step 4** to your custom domains (`VITE_API_URL` → your API
   domain; `CORS_ORIGINS` → your web domain). Save; they redeploy.

---

## Step 6 — The mobile app (App Store / Google Play)

The mobile app isn't hosted on Render — it's built with **EAS** (Expo) and submitted to the
stores. The GitHub workflow for this is already in the repo
(`.github/workflows/mobile-eas.yml`). One-time setup:

1. In `apps/mobile/eas.json`, set the **production** profile's `EXPO_PUBLIC_API_URL` to your API
   URL (the same one from Step 4/5).
2. Create an Expo account, run `eas init` in `apps/mobile`, and put the resulting `projectId`
   into `app.json`. Add your Expo token to GitHub as a secret named `EXPO_TOKEN`
   (repo **Settings → Secrets and variables → Actions**).
3. Trigger a build: either run the workflow manually from the GitHub **Actions** tab, or push a
   tag like `mobile-v1.0.0` from GitHub Desktop. EAS builds the iOS and Android apps.
4. Submit to the stores with `eas submit` (needs an Apple Developer account and a Google Play
   Developer account). See `apps/mobile/README.md` for the exact commands.

---

## Day-to-day: how updates work

- Make a change → **Commit** + **Push** in GitHub Desktop → Render rebuilds and redeploys the
  affected services automatically. Database migrations run on their own before the API goes live.
- **Logs:** each service has a **Logs** tab for troubleshooting.
- **Backups:** Render's paid Postgres plans take automated daily backups (see the database's
  **Backups** tab). For extra safety you can also download a manual dump from the API Shell:
  `pg_dump "$DATABASE_URL" > backup.sql`.

---

## What it costs (roughly)

| Service | Plan | Approx / month |
|---------|------|----------------|
| PostgreSQL | basic-256mb | ~$6 |
| API (web service) | Starter | ~$7 |
| Reminder worker | Starter | ~$7 |
| Web app (static) | Free/Static | $0 |
| **Total** | | **~$20** |

For a handful of pilot users this is comfortable. You can drop the worker to a smaller plan, or
even fold the reminder tick into the API later, if you want to trim cost — ask me and I'll adjust
`render.yaml`.

---

## Things to remember

- **`ENCRYPTION_KEY` is set once and never changed.** Keep a copy in a password manager.
- **Uploaded documents** live on the API's persistent disk (`/data`). When you outgrow one box,
  switch `STORAGE_DRIVER` to `s3` and point it at object storage — the app already supports it.
- **Stripe stays in test mode** (`STRIPE_DRIVER=fake`) and **Emergency Access stays off**
  (`EMERGENCY_ACCESS_ENABLED=false`) until you deliberately turn them on — exactly as designed.
- Keep all services in the **same Render region** so the API reaches Postgres over the fast
  internal network.
