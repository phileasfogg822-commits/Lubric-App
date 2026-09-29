# APK Build Handoff — Lubric Field (Android)

**Purpose:** this file is a complete, self-contained brief. Give the whole file to
another AI/tool (e.g. Astra) that has GitHub access, and it should be able to produce
`app-debug.apk` without further questions.

---

## 0. TL;DR — the task

| | |
|---|---|
| **Repository** | **https://github.com/hrperalglobalcity-spec/lubric-field** (private, branch `master`) |
| **Actions page** | https://github.com/hrperalglobalcity-spec/lubric-field/actions/workflows/android.yml |
| **Build command** | GitHub Actions -> "Android APK" -> **Run workflow** |
| **Deliverable** | `app-debug.apk` from the `lubric-field-apk` artifact |

> Build the Android APK for the app in the `mobile/` folder of this repository and give
> back a downloadable `.apk` file. Use GitHub Actions to do the build. Do not modify
> application logic unless the build fails.

---

## 1. What the app is

| Item | Value |
|---|---|
| Repo folder to build | `mobile/` |
| App name | **Lubric Field** |
| Package / appId | `app.lubric.field` |
| Purpose | Finances-only companion for field staff: record **collections**, **cash handovers**, and **reservations**. Works fully offline, syncs to a server when online. |
| Stack | React 18 + TypeScript + Vite 6, wrapped by **Capacitor 6** (`@capacitor/android` 6.2) |
| Local DB | `@capacitor-community/sqlite` 6.0 (offline-first) |
| Build config | `mobile/capacitor.config.json`, `mobile/vite.config.ts` |
| Existing CI | `.github/workflows/android.yml` (already configured — see §4) |

**Not in scope:** no product catalog, no POS, no desktop dashboard. If a build step
suggests adding these, do not.

---

## 2. Server it talks to

| Item | Value |
|---|---|
| API base URL | `http://72.61.115.120:9000` |
| Endpoints used | `POST /api/v1/devices/pair`, `POST /api/v1/push`, `GET /api/v1/pull?since=<cursor>` |
| Auth | `Authorization: Bearer <device token>` (obtained via pairing code) |
| Transport | **Plain HTTP** — there is no domain/TLS yet. Cleartext must stay allowed. |

The app is fully functional offline; sync is opportunistic.

---

## 3. Source layout (files that matter)

```
mobile/
  capacitor.config.json      # appId, appName, webDir=dist, cleartext HTTP enabled
  vite.config.ts             # base: "./"  (required - absolute asset paths 404 on device)
  package.json               # scripts: dev, build (tsc && vite build), cap:sync
  tsconfig.json
  index.html
  src/
    main.tsx                 # React entry
    App.tsx                  # shell: Setup -> Dashboard/Record/Reservations, tab bar
    api.ts                   # pairing, syncNow() push+pull, token storage
    store.ts                 # SQLite: cash_movements, reservations, customers, outbox, sync_state
    styles.css
    screens/
      Setup.tsx              # server URL + pairing code + device name
      Dashboard.tsx          # collected today / handed over / cash in hand (PKR)
      Record.tsx             # add collection / handover / adjustment
      Reservations.tsx       # book + track reservations
```

`ARCHITECTURE_SPEC.md` in the repo root has the full product/architecture context.

---

## 4. The CI workflow that already exists

`.github/workflows/android.yml` runs on push to `main`/`master` (paths `mobile/**`) and
on manual dispatch. It performs:

1. Checkout, Node 20, Temurin JDK 17
2. `npm ci || npm install` then `npm run build` in `mobile/`
3. `npx cap add android` + `npx cap sync android`
4. **Bump `minSdkVersion` 22 -> 23** in `android/variables.gradle`
   *(required: `@capacitor-community/sqlite` needs minSdk 23, Capacitor defaults to 22 —
   without this the build fails with `uses-sdk:minSdkVersion 22 cannot be smaller than 23`)*
5. **Enable `android:usesCleartextTraffic="true"`** in `AndroidManifest.xml`
   *(required: the server is plain HTTP at an IP address)*
6. `./gradlew assembleDebug` (and `assembleRelease`, non-blocking)
7. Uploads artifact `lubric-field-apk` containing the APKs

---


## 5. Step-by-step instructions

### Step A — the code is already on GitHub

Repository (private, owned by `hrperalglobalcity-spec`):

**https://github.com/hrperalglobalcity-spec/lubric-field**

The default branch is `master` and it already contains the full source, including
`mobile/` and the CI workflow. Nothing to push — go straight to Step B.

```bash
# only if you need a fresh clone
git clone https://github.com/hrperalglobalcity-spec/lubric-field.git
cd lubric-field
```

### Step B — trigger the build
GitHub -> **Actions** tab -> **Android APK** -> **Run workflow** -> wait ~5-10 min.

Direct link: **https://github.com/hrperalglobalcity-spec/lubric-field/actions/workflows/android.yml**

Click **Run workflow** (right side, "Run workflow" dropdown) -> branch `master` -> green button.

### Step C — download the artifact
GitHub -> Actions -> the run -> bottom **Artifacts** -> download `lubric-field-apk` (a ZIP).
Inside: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

### Step D — install on a phone
Copy the `.apk` to the phone (USB / Drive / WhatsApp) and tap it.
Allow **"install from unknown sources"** when Android prompts.

### Step E — first run
1. Server URL: `http://72.61.115.120:9000`
2. Pairing code: generated on the server with
   `docker exec -it lubric9-api node pair.js mobile "Kashif phone"`
3. Device name: e.g. "Kashif's phone"
4. Tap **Pair device** -> app unlocks to the Finances dashboard.

---

## 6. Local build (only if CI is unavailable)

Requires Android Studio + JDK 17 + Android SDK 34.

```bash
cd mobile
npm install
npm run build
npx cap add android
npx cap sync android
# apply the minSdk 23 + cleartext edits from step 4 above
cd android
./gradlew assembleDebug        # macOS/Linux
gradlew.bat assembleDebug      # Windows
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `uses-sdk:minSdkVersion 22 cannot be smaller than version 23` | SQLite plugin needs minSdk 23 | Bump in `android/variables.gradle` (CI step 4 does this) |
| App opens to a blank/white screen | absolute asset paths | ensure `base: "./"` in `vite.config.ts` |
| "Cleartext HTTP traffic not permitted" | HTTPS-only default | set `android:usesCleartextTraffic="true"` (CI step 5) |
| Sync button errors, app otherwise fine | server not deployed / wrong URL | server must be up on :9000; the app still works offline |
| `./gradlew: not found` | perms | `chmod +x gradlew` |
| Workflow didn't trigger | path filter | the workflow only runs for `mobile/**` changes — use **Run workflow** to force it |

---

## 8. Constraints — do not break these

1. **Do not change app behaviour.** This is a build task. If something fails to compile,
   report it; only fix genuine build blockers.
2. **Keep `minSdkVersion = 23` and cleartext HTTP enabled** — both are hard requirements
   (see §4).
3. **Do not add secrets to the repo.** No API keys, no `.env`, no server credentials.
4. **The debug APK is signed with the Android debug key** — fine for sideloading. Play
   Store distribution needs a release keystore (future work, not part of this task).
5. **The app is offline-first** — never make the UI require a network connection to
   render.

---

## 9. Definition of done

- [ ] GitHub Actions run is green
- [ ] Artifact `lubric-field-apk` downloads
- [ ] `app-debug.apk` present (~5-10 MB)
- [ ] APK installs on a physical Android phone
- [ ] App opens to the Setup screen (not a white screen)
- [ ] Entering the server URL + pairing code unlocks the Finances dashboard
- [ ] A collection can be recorded with no internet, and Sync shows a pending count

Report back: the workflow run URL, the APK filename/size, and the result of each
checkbox above (or a clear description of anything that failed).
