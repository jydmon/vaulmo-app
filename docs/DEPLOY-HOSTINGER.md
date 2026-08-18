# Deploying Vaulmo to a Hostinger VPS (from GitHub Desktop)

The flow has two halves:
1. **GitHub Desktop** pushes your code to GitHub.
2. Your **Hostinger VPS** pulls that code and runs it with Docker.

You do part 1 once (and again for every future update), and part 2 once to set the server up.
Total time the first time: about 30–45 minutes. HTTPS and your domain are handled automatically
by Caddy, which is already wired into `docker-compose.prod.yml`.

You'll type a handful of commands on the server. You don't need to be a developer — just copy,
paste, and change the bits in ANGLE BRACKETS.

---

## Before you start
- A **Hostinger VPS** — KVM 2, **Ubuntu 24.04 with Docker** template (from the earlier step).
- Your code on **GitHub** (via GitHub Desktop).
- A **domain** you can edit DNS for (e.g. `vaulmo.com`).

---

## Part 1 — Push your code to GitHub (GitHub Desktop)
1. Open **GitHub Desktop**, make sure your latest changes are committed: type a summary bottom-left,
   click **Commit to main**.
2. Click **Push origin** (top bar). Your code is now on GitHub.
3. Note your repo's address — it looks like `https://github.com/<your-username>/<repo>.git`
   (for example `https://github.com/jydmon/lifehub-platform-full.git`).

Because the repo is **private**, the server needs a token to read it. Create one now:
4. On GitHub.com, go to **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. Give it **Read-only** access to that one repository
   (Repository access → Only select repositories → your repo; Permissions → Contents: Read).
   Generate it and **copy the token** (starts with `github_pat_…`). Keep it somewhere safe.

---

## Part 2 — Connect to your server
1. In the **Hostinger** panel (hpanel), open your VPS → **Overview**. Note the server's **IP address**.
2. Click **Browser terminal** (Hostinger's built-in SSH — no extra software needed). You're now
   typing commands on your server. (Alternatively use Windows Terminal: `ssh root@<YOUR-VPS-IP>`.)

Check Docker is there (the Docker template includes it):
```bash
docker --version && docker compose version
```
If either is missing, install Docker once:
```bash
curl -fsSL https://get.docker.com | sh
```

---

## Part 3 — Get the code onto the server
Clone your repo into a folder called `vaulmo`. Paste your token and repo path where shown:
```bash
cd /opt
git clone https://<YOUR-GITHUB-TOKEN>@github.com/<your-username>/<repo>.git vaulmo
cd vaulmo
```
(Using the token in the URL lets it read your private repo. Example:
`git clone https://github_pat_xxx@github.com/jydmon/lifehub-platform-full.git vaulmo`.)

---

## Part 4 — Fill in your settings (secrets)
Copy the template to a real settings file and edit it:
```bash
cp .env.prod.example .env
nano .env
```
In the editor set each value:
- `LANDING_DOMAIN` — your marketing page address, e.g. `vaulmo.com`
- `APP_DOMAIN` — your web app address, e.g. `app.vaulmo.com`
- `POSTGRES_PASSWORD` — a long random password
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — long random strings
- `ENCRYPTION_KEY` — generate one by running `openssl rand -base64 32` in another terminal line and
  pasting the result. **Set once, keep a backup** — if it changes, encrypted data becomes unreadable.
- `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` — your admin login

Save and exit nano: **Ctrl+O**, **Enter**, then **Ctrl+X**.

---

## Part 5 — Point your domains at the server
You have **two** hostnames, both pointing at the same VPS. In your domain registrar's DNS settings,
add **two A records**:

| Host / Name | Points to | Serves |
|-------------|-----------|--------|
| `@` (the bare `vaulmo.com`) | your VPS IP | the landing page |
| `app` (makes `app.vaulmo.com`) | your VPS IP | the web application |

DNS can take a few minutes to an hour to take effect. Do this now so the HTTPS certificates can be
issued in the next step — Caddy will automatically get a separate certificate for each domain. Also
make sure ports 80 and 443 are open (Hostinger VPS → **Firewall**: allow HTTP 80, HTTPS 443, and
SSH 22).

---

## Part 6 — Launch Vaulmo
From the `vaulmo` folder:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
The first run takes a few minutes (it builds the images and installs Tesseract for document OCR).
When it finishes, the database, API, reminder worker, web app, and Caddy are all running. Caddy
automatically fetches a free HTTPS certificate for your domain.

Check everything is up:
```bash
docker compose -f docker-compose.prod.yml ps
```

---

## Part 7 — Create your admin account (one time)
The database starts empty. Seed the roles, plans, and your admin user once:
```bash
docker compose -f docker-compose.prod.yml exec api npx tsx src/db/seed.ts
```
(It uses the `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` from your `.env`.)

---

## Part 8 — Open it
- **https://vaulmo.com** → your marketing landing page (with the App Store / Google Play buttons).
- **https://app.vaulmo.com** → the web application; sign in with your admin email and password.

That's it — both are live, each with its own HTTPS certificate. 🎉

If a page doesn't load immediately, give DNS a few more minutes, then try again. To watch logs:
```bash
docker compose -f docker-compose.prod.yml logs -f caddy   # certificate / routing
docker compose -f docker-compose.prod.yml logs -f api     # the app
```

---

## Updating later (your ongoing workflow)
Whenever you change something:
1. In **GitHub Desktop**: **Commit to main** → **Push origin**.
2. On the server:
   ```bash
   cd /opt/vaulmo
   git pull
   docker compose -f docker-compose.prod.yml up -d --build
   ```
Database migrations run automatically when the API restarts. Your data (database + uploaded files)
lives in Docker volumes and is preserved across updates.

### Want automatic deploys instead?
If you'd rather have "push in GitHub Desktop → server updates itself" without SSH-ing in each time,
install **Coolify** on the VPS (Hostinger has a one-click Coolify template). It connects to your
GitHub repo and redeploys on every push, and also manages HTTPS. Tell me and I'll write that path.

---

## Backups (do this before real users)
Take a database dump anytime:
```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U vaulmo vaulmo > ~/vaulmo-backup.sql
```
Consider a weekly cron job, and Hostinger's VPS snapshots for whole-server backups.

---

## Handy commands
| Do this | Command (run in `/opt/vaulmo`) |
|---------|-------------------------------|
| See running services | `docker compose -f docker-compose.prod.yml ps` |
| View app logs | `docker compose -f docker-compose.prod.yml logs -f api` |
| Restart everything | `docker compose -f docker-compose.prod.yml restart` |
| Stop everything | `docker compose -f docker-compose.prod.yml down` |
| Update after a push | `git pull && docker compose -f docker-compose.prod.yml up -d --build` |
