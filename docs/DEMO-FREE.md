# Free demo / testing stack (no paid plans)

Yes — you can stand Vaulmo up for **$0** to test and demo. Two ways: the quickest is fully
local; the shareable one uses Neon + Render + Vercel + Expo (all free tiers).

> Use **synthetic / test documents only** on the free stack — free storage is temporary and not
> meant for real sensitive files (this matches the internal-tester rule from the build).

---

## Option A — Fastest test (local, zero accounts)

Everything runs on your computer with Docker, including OCR and the worker. Nothing to sign up
for.

```bash
# from the project root
docker compose up --build
```

Then open the web app at the URL Compose prints (http://localhost:8080), and log in with the
seeded admin (`admin@lifehub.local` / `ChangeMe123!`). This is the best way to *try* the app;
it's just not reachable by other people.

---

## Option B — Shareable free demo (Neon + Render + Vercel + Expo)

Here's how the free tiers map to Vaulmo's pieces:

| Piece | Free service | Notes |
|-------|--------------|-------|
| Database | **Neon** | Serverless Postgres, free tier. Reachable from anywhere. |
| API + worker | **Render (Free)** | Docker image keeps OCR working. Sleeps when idle. |
| Web app | **Vercel (Hobby)** | Perfect for the Vite build. Fast, free, HTTPS. |
| Mobile | **Expo Go** | Run the app on your phone with no store build. |

**Important:** Vercel hosts the **web app**, not the API. Vaulmo's API is a long-running Express
server with a background worker and OCR — that doesn't fit Vercel's serverless model, so the API
goes on Render's free tier. Vercel handles the frontend beautifully.

### 1. Database — Neon
1. Create a free project at neon.tech and copy the **connection string** (looks like
   `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).
2. Because Neon is public, run the migrations and seed **from your own computer** (no paid shell
   needed):
   ```bash
   cd apps/api
   npm install
   DATABASE_URL="<your-neon-url>" DATABASE_SSL=true npx tsx src/db/migrate.ts
   DATABASE_URL="<your-neon-url>" DATABASE_SSL=true npx tsx src/db/seed.ts
   ```
   That creates the tables, roles, plans and the admin user.

### 2. API — Render Free
1. In Render, create a **Web Service** from your repo, root directory `apps/api`, environment
   **Docker**.
2. Choose the **Free** instance.
3. Set environment variables:
   - `DATABASE_URL` = your Neon URL
   - `DATABASE_SSL` = `true`
   - `APP_ENV` = `production`
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` = any long random strings
   - `ENCRYPTION_KEY` = output of `openssl rand -base64 32`
   - `STRIPE_DRIVER` = `fake`, `EMERGENCY_ACCESS_ENABLED` = `false`
4. Deploy. Note the API URL, e.g. `https://lifehub-api.onrender.com`.

*(You can skip a separate worker service for a demo — see "Firing reminders" below.)*

### 3. Web — Vercel
1. Import the repo in Vercel, set **Root Directory** to `apps/web` (there's a `vercel.json` there
   already, so it auto-detects Vite).
2. Add an environment variable `VITE_API_URL` = your Render API URL (no trailing slash).
3. Deploy. Note the web URL, e.g. `https://lifehub-web.vercel.app`.
4. Back in Render, set the API's `CORS_ORIGINS` to that Vercel URL and redeploy. (This lets the
   browser app talk to the API.)

Open the Vercel URL and sign in with the admin you seeded. Live demo, $0.

### 4. Mobile — Expo Go (no build required)
1. Install **Expo Go** on your phone.
2. On your computer:
   ```bash
   cd apps/mobile
   npm install
   EXPO_PUBLIC_API_URL="https://lifehub-api.onrender.com" npx expo start
   ```
3. Scan the QR code with Expo Go. The app runs on your phone against the live API — no App Store
   or EAS build needed for a demo.

---

## What "free" costs you (the trade-offs)

- **Cold starts.** The Render free API sleeps after ~15 minutes idle; the first request then takes
  ~30–60 seconds to wake. Fine for testing, a little awkward in a live pitch — hit the URL once a
  minute before you demo, or upgrade just the API to Starter ($7) for the day.
- **Temporary storage.** Uploaded documents live on an ephemeral disk and disappear when the free
  service restarts. Great for testing the scan→confirm flow; not for keeping anything real.
- **Neon auto-suspend.** The database naps when idle and wakes on the first query (~0.5s). Harmless.
- **Firing reminders.** Without an always-on worker, trigger the reminder engine on demand:
  ```bash
  cd apps/api
  DATABASE_URL="<neon-url>" DATABASE_SSL=true npx tsx src/worker.ts --once
  ```
  Run that whenever you want to show reminders being generated.

When you're ready to go from demo to real users, switch to the paid set in
`docs/DEPLOY-RENDER.md` (Starter API + worker, Basic-256MB Postgres, persistent disk) — same code,
just non-free plans.
