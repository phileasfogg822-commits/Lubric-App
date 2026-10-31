# Lubric POS — Android wrapper (desktop-app)

This folder wraps the Lubric-App **main web app** (`src/`, the same code as
the desktop/web app) as an Android app via Capacitor. It is NOT the field
companion in `mobile/` (collections/handovers only) and NOT a rewrite — the
APK runs the full app: dashboard, POS, catalog, customers, vendors, khata,
accounts, expenses, reports, and everything else the web app does.

## Same database, by design

The APK talks to the **same VPS backend as the web app**. The build bakes in
`VITE_API_URL=http://72.61.115.120:9001` (the VPS web origin, which proxies
`/api` to the same API and the same Postgres database). A sale, customer, or
expense created in the APK lands in the same rows the web app reads — there is
no second database and no sync step. If the VPS address ever changes, rebuild
with the new URL (a server-URL setting screen, like `mobile/` has, is a
possible later addition).

## Version 1 limits (stated plainly)

- **Online-only.** The app talks straight to the server, like the web app.
  There is no offline database in this wrapper (unlike `mobile/`).
- **Debug APK from CI.** This machine has no Android SDK, so the APK is built
  by the `desktop-apk.yml` workflow. Install the debug APK for testing.
- **Default app icon.** The repo has no real logo file (the PWA icons are
  placeholders), so v1 ships Capacitor's default icon. A branded icon needs a
  real logo file and is a small follow-up.
- **No in-app update channel yet.** The hub's `/api/v1/app/version` manifest
  currently serves the field app only; a per-app manifest for this app is
  future work. New versions come as a new APK.

## How the build works

1. The repo-root web app is built with `vite build --base ./` and
   `VITE_API_URL` set to the hub origin (relative `/api` would resolve to
   `https://localhost/api` inside the WebView, which does not exist).
2. `npx cap add android && npx cap sync android` copies `../dist` into the
   Android project (cleartext HTTP is enabled in the manifest because the
   hub is plain `http://`, same as the field app's workflow).
3. `./gradlew assembleDebug` produces the APK, uploaded as the
   `lubric-pos-apk` artifact.

## Local commands (for reference; the APK itself comes from CI)

```sh
# from the repo root
npm ci
npx tsc
VITE_API_URL=http://72.61.115.120:9001 npx vite build --base ./
cd desktop-app
npm install
npx cap add android
npx cap sync android
```
