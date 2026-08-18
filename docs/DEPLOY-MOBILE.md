# Publishing the Vaulmo mobile app (iOS & Android)

Your web app is live at `app.vaulmo.com`. The mobile app is a **separate** thing: it's built
with **EAS** (Expo's cloud build service) on your computer, then submitted to the **App Store**
and **Google Play**. Nothing about this touches your Hostinger server — the app just talks to your
live API at `https://app.vaulmo.com` (already configured for you).

This is the slowest part of the whole project, but not because it's hard — it's the accounts and
Apple/Google review that take time. Do it as its own focused session.

There are two stages. **Do Stage 1 first** — it's free, takes ~20 minutes, and proves the app works
on a real phone before you spend money on developer accounts.

---

## What you'll need

| For | What | Cost |
|-----|------|------|
| Building the app | **Node.js** on your PC + a free **Expo** account | Free |
| Publishing to iPhone | **Apple Developer Program** | $99 / year |
| Publishing to Android | **Google Play Developer** account | $25 one-time |

---

## Stage 1 — Run the real app on your phone (free, no stores)

This uses **Expo Go**, an app that runs your Vaulmo app on your phone instantly — no build, no
developer accounts.

**1. Install Node.js on your PC.**
Go to **nodejs.org**, download the **LTS** version, run the installer, click Next through it. This
is also what was missing when earlier commands "didn't work on your PC."

**2. Install Expo Go on your phone** from the App Store (iPhone) or Google Play (Android).

**3. Open a terminal on your PC** — press the Windows key, type **`cmd`**, open **Command Prompt**.
Navigate to the mobile folder (adjust the path to where you unzipped the project):
```
cd Downloads\vaulmo-platform-full\apps\mobile
npm install
npx expo start
```
`npm install` takes a couple of minutes the first time. Then a **QR code** appears in the terminal.

**4. Scan the QR code** with your phone:
- **Android:** open **Expo Go** → **Scan QR code**.
- **iPhone:** open the **Camera** app, point it at the QR, tap the banner that appears.

Vaulmo opens on your phone, talking to your live `app.vaulmo.com` backend. Log in with your admin
account. (Your PC and phone must be on the **same Wi-Fi**.)

If it works, you've confirmed the mobile app is good — now you can decide to publish it.

---

## Stage 2 — Publish to the App Store & Google Play

**1. Create a free Expo account** at **expo.dev** (sign up).

**2. Install the build tool and log in.** In Command Prompt:
```
npm install -g eas-cli
eas login
```

**3. Link the project.** From the `apps/mobile` folder:
```
eas init
```
It creates a project and gives you a **Project ID**. Open `apps/mobile/app.json` in a text editor
and paste that ID into the `"projectId"` field (replace `PROJECT_ID`).

*(The app's live API address is already set to `https://app.vaulmo.com` — nothing to change.)*

**4. Build both apps in the cloud** (no Mac required):
```
eas build --profile production --platform all
```
EAS builds them on its servers and gives you download links (an `.ipa` for iPhone, an `.aab` for
Android). This takes 15–30 minutes and runs in the cloud, so you can close the terminal.

### iPhone (App Store)
5a. Join the **Apple Developer Program** ($99/year) at **developer.apple.com/programs**.
5b. Submit the build: `eas submit --profile production --platform ios`
5c. In **App Store Connect** (appstoreconnect.apple.com): create the app listing — name **Vaulmo**,
    description, screenshots, privacy questionnaire — then test via **TestFlight** and click
    **Submit for Review**. Apple review typically takes **1–3 days**.

### Android (Google Play)
6a. Create a **Google Play Developer** account ($25 one-time) at **play.google.com/console**.
6b. Submit the build: `eas submit --profile production --platform android`
6c. In **Play Console**: create the app, upload to the **Internal testing** track first to try it,
    fill in the store listing and the **Data safety** form, then promote to **Production**. Google
    review is usually **faster than Apple** (hours to ~2 days).

**7. Once approved,** each store gives you a public listing link. Put those two links into the
download buttons on your landing page (`landing/index.html` — they're `#` placeholders now), and
swap the store badge graphics for Apple's and Google's official ones.

---

## Updating the app later
When you change the mobile app:
1. Bump the version in `apps/mobile/app.json` (e.g. `0.1.0` → `0.1.1`).
2. `eas build --profile production --platform all`
3. `eas submit …` for each store.
Each store update goes through review again (usually quicker than the first time).

---

## Honest expectations
- **The apps aren't instant.** Apple/Google accounts, store listings, and review add days — that's
  them, not the app.
- **Your web app already works on phones today** via `app.vaulmo.com` in the phone browser, so you
  have mobile access right now while the native apps go through review.
- **Screenshots & listing text** are required by both stores. If you want, I can help you write the
  store descriptions and produce the required screenshots from the app.
