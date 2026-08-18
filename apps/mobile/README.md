# Vaulmo Mobile (Expo / React Native)

Native iOS/Android app for Vaulmo.

## Run in development
```bash
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 npx expo start
# open in Expo Go (device) or a simulator
```
On a physical device use your machine's LAN IP (not `localhost`) so the phone can reach the API.

## App-store builds (EAS)
One-time: create an Expo project (`eas init`), set the `projectId` in `app.json` and the
`updates.url`, and add store credentials as **EAS secrets** (never commit them).

```bash
npm i -g eas-cli && eas login
eas build --profile preview   --platform all   # internal test builds (TestFlight / APK)
eas build --profile production --platform all   # store builds
eas submit --profile production --platform all   # upload to App Store / Play
```

CI: `.github/workflows/mobile-eas.yml` runs the same, gated by an `EXPO_TOKEN` secret —
trigger it manually (pick `preview`/`production`) or push a `mobile-v*` tag.

Per-environment API URL is injected by the EAS build profile via `EXPO_PUBLIC_API_URL`
(see `eas.json`); the app reads it in `src/api.ts`.
