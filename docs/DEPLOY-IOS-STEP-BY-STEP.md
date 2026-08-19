# Vaulmo — Step-by-Step iOS App Store Deployment

This guide takes the Vaulmo mobile app (Expo SDK 52 / React Native) from your code to a live app on the Apple App Store, using **Expo Application Services (EAS)** to build in the cloud.

**Good news:** You do **not** need a Mac. EAS Build compiles your iOS app on Apple hardware in the cloud, and EAS Submit uploads it for you. You run everything from your Windows PC (or any computer).

**What it costs:** An **Apple Developer Program membership — $99/year** (required to publish any app to the App Store). EAS has a free tier that's enough to get started; larger build volumes need a paid Expo plan.

**Roughly how long:** ~1–2 hours of your work, plus Apple's review (usually 24–48 hours) and up to 24–48 hours for the developer-account verification.

---

## Your current setup (already done)

- App name: **Vaulmo**, bundle identifier: **`com.vaulmo.app`**
- Production API the app will talk to: **`https://app.vaulmo.com`** (already set in `eas.json`)
- Version **0.1.0**, build number **1**

You'll fix two placeholders (`PROJECT_ID`, the local API URL) in Part B — that's the only code change needed.

---

## Part A — One-time accounts & tools (~30–45 min, plus Apple verification)

### A1. Enrol in the Apple Developer Program ($99/year)
1. Go to **https://developer.apple.com/programs/enroll/** and sign in with the Apple ID you want to own the app.
2. Choose **Individual** (fastest — the app is published under your name) or **Organization** (published under your company; requires a D-U-N-S number and takes longer).
3. Pay the **$99** annual fee.
4. Apple verifies your identity — usually a few hours, sometimes up to 48 hours. **Wait for the confirmation email before continuing to Part D.**

> Note your **Apple Team ID** once approved: **https://developer.apple.com/account** → *Membership details* → *Team ID* (a 10-character code). You'll need it later.

### A2. Create a free Expo account
- Sign up at **https://expo.dev/signup**. This runs your cloud builds.

### A3. Install Node.js and the EAS CLI (on your PC)
1. Install **Node.js LTS** from **https://nodejs.org** (accept defaults).
2. Open **PowerShell** (or Command Prompt) and install the EAS CLI:
   ```
   npm install -g eas-cli
   ```
3. Verify:
   ```
   eas --version
   ```

---

## Part B — Prepare the app config (5 min)

Open the project folder `apps/mobile` in your editor and make these small edits.

### B1. Point the app at your production API (in `app.json`)
The `extra.apiUrl` currently says `http://localhost:4000`. The production build already uses `EXPO_PUBLIC_API_URL = https://app.vaulmo.com` from `eas.json`, so this is only a fallback — but set it correctly to be safe:
```json
"extra": {
  "apiUrl": "https://app.vaulmo.com",
  "eas": { "projectId": "PROJECT_ID" }
}
```
Leave `PROJECT_ID` as-is — the next step fills it automatically.

### B2. Declare encryption compliance (avoids a prompt on every build)
Vaulmo only uses standard HTTPS encryption, which is exempt. Add this inside the `"ios"` block of `app.json`:
```json
"ios": {
  "supportsTablet": true,
  "bundleIdentifier": "com.vaulmo.app",
  "buildNumber": "1",
  "config": { "usesNonExemptEncryption": false }
}
```

### B3. Link the project to EAS (auto-fills `PROJECT_ID`)
In PowerShell, from the `apps/mobile` folder:
```
cd path\to\vaulmo-platform-full\apps\mobile
eas login
eas init
```
`eas init` creates the project on Expo's servers and writes the real project ID into `app.json` (replacing both `PROJECT_ID` placeholders). Commit these changes in GitHub Desktop.

---

## Part C — Create the app in App Store Connect (10 min)

1. Go to **https://appstoreconnect.apple.com** → **My Apps** → **＋** → **New App**.
2. Fill in:
   - **Platform:** iOS
   - **Name:** Vaulmo (this is the public App Store name; must be unique across the store)
   - **Primary language:** English (UK) or your choice
   - **Bundle ID:** select **`com.vaulmo.app`**. If it isn't listed, create it first at **https://developer.apple.com/account/resources/identifiers/** → **＋** → *App IDs* → *App* → enter `com.vaulmo.app`.
   - **SKU:** any internal code, e.g. `vaulmo-001`
3. Click **Create**.
4. Copy the app's **Apple ID number** (a long number shown under *App Information* / *General Information*) — this is your **`ascAppId`**.

---

## Part D — Build the iOS app in the cloud (15 min + build time)

From `apps/mobile` in PowerShell:
```
eas build --platform ios --profile production
```
- When prompted **"Generate a new Apple Distribution Certificate / Provisioning Profile?"**, choose **Yes** — EAS logs into your Apple account and creates and stores the signing credentials for you (no Mac, no manual certificate juggling).
- The build runs on Expo's servers (~15–25 min). You'll get a link to watch progress and download the finished **.ipa** when done.

> You'll be asked to log in to your Apple Developer account during this step so EAS can register the certificate.

---

## Part E — Send the build to TestFlight (5 min)

Before filling the submit config, put your Apple details into `eas.json` **or** just answer the prompts. To use the config, edit `apps/mobile/eas.json` → `submit.production.ios`:
```json
"ios": {
  "appleId": "your-apple-id@email.com",
  "ascAppId": "1234567890",
  "appleTeamId": "ABCDE12345"
}
```
Then submit the build you just made:
```
eas submit --platform ios --profile production --latest
```
This uploads the build to **App Store Connect → TestFlight**. Apple runs an automated processing pass (~15–30 min).

### Test it on your iPhone
1. Install the **TestFlight** app from the App Store on your iPhone.
2. In App Store Connect → your app → **TestFlight**, add yourself as an **Internal Tester** (your Apple ID).
3. Accept the invite in TestFlight and install the beta. Verify sign-in, MFA, and that it reaches `https://app.vaulmo.com`.

> **Tip:** TestFlight is also how you'd let a small group trial the app for weeks before going public — no App Review needed for internal testers.

---

## Part F — Prepare the store listing & submit for review (30–45 min)

In App Store Connect → your app → the **iOS App** version page, complete:

1. **Screenshots** (required). At minimum, a set for **6.7"** iPhone (e.g. iPhone 15 Pro Max, 1290×2796). Capture them from the TestFlight build on a device or simulator. You need 3–10 images.
2. **App icon** — already bundled from `assets/icon.png` (your Vaulmo shield). No separate upload needed.
3. **Description, keywords, support URL** (e.g. `https://vaulmo.com`), and **marketing URL** (optional).
4. **App Privacy** (required, and important for Vaulmo since it stores personal documents):
   - Provide your **Privacy Policy URL** — `https://vaulmo.com/privacy` (the one you configured in the admin Configuration → Policies).
   - Fill the **data-collection questionnaire** honestly (e.g. account data, documents the user uploads, whether data is linked to identity, used for tracking — for Vaulmo, *not* used for tracking).
5. **Age rating** — answer the questionnaire (Vaulmo is generally 4+).
6. **Sign-in required?** If reviewers need an account, provide a **demo login** in *App Review Information* → *Sign-In required* (create a test customer account on `app.vaulmo.com` and give its email/password). This prevents rejection for "can't access the app".
7. **Encryption / export compliance** — because you set `usesNonExemptEncryption: false`, you can answer "No" to the export-compliance question.
8. Under **Build**, click **＋** and select the TestFlight build you uploaded.
9. Choose release option (usually **Automatically release after approval**), then **Add for Review** → **Submit**.

---

## Part G — Review, release & future updates

- **Review:** Apple typically reviews within **24–48 hours**. You'll get an email if it's approved or if they need changes.
- **Rejections** are common on the first try (often for the demo-account or privacy details) — read Apple's note, fix, and resubmit; it's usually quick the second time.
- **Once approved,** the app goes live on the App Store (immediately, or on the date you set).

### Shipping an update later
1. Bump the version in `app.json` (e.g. `"version": "0.1.1"`). EAS auto-increments the build number (`autoIncrement` is on in your `eas.json`).
2. Rebuild and resubmit:
   ```
   eas build --platform ios --profile production
   eas submit --platform ios --profile production --latest
   ```
3. Add the new build to a new version in App Store Connect and submit for review.

> For small JavaScript-only changes you can also push instant **EAS Updates** (over-the-air) without a new review — that's the `channel: "production"` already set in your `eas.json`. Native changes still require a new build + review.

---

## Quick reference — the whole flow in commands

```
# one time
npm install -g eas-cli
cd apps/mobile
eas login
eas init

# each release
eas build   --platform ios --profile production
eas submit  --platform ios --profile production --latest
# then: App Store Connect → attach build → submit for review
```

---

## Troubleshooting

- **"Bundle ID not available"** — someone else registered `com.vaulmo.app`, or you haven't created the App ID yet. Create it under *Certificates, Identifiers & Profiles*.
- **Build fails on native dependency** — run `npx expo-doctor` in `apps/mobile` to catch version mismatches before building.
- **App can't reach the backend** — confirm `EXPO_PUBLIC_API_URL` in `eas.json` (production) is `https://app.vaulmo.com` and that the app actually reads `process.env.EXPO_PUBLIC_API_URL`. Test in TestFlight before submitting.
- **Rejected: "guideline 2.1 — unable to sign in"** — you forgot the demo account in *App Review Information*. Add it and resubmit.
- **Rejected on privacy** — your App Privacy answers must match what the app really does; make sure the Privacy Policy URL loads.

---

### Android (Google Play) — for later
The same EAS flow builds Android: `eas build --platform android --profile production` then `eas submit --platform android`. Google Play requires a **one-time $25** developer registration and a **service-account key** (the placeholder is already in your `eas.json`). Ask me and I'll write the Android guide too.
