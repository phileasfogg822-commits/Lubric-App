# LubricApp — Multi-Platform Technical Specification
**Version 1.0 · 2026-09-23 · Status: Approved for implementation**

## 1. Goals

| # | Requirement |
|---|---|
| G1 | Desktop app installs as a **system application** (Windows installer), not a web app. |
| G2 | App **works without internet** (in-shop daily operation must never stop). |
| G3 | When internet is available, **all local data syncs to a VPS** automatically. |
| G4 | A **VPS server** is the cloud hub: stores all shop data, serves all clients. |
| G5 | An **Android APK** for field/patrol staff: **finances only** — collections received, cash handovers, deliveries, reservations. No catalog, no dashboard, no POS. |
| G6 | APK data syncs to the VPS; the desktop pulls it down when it comes online. |
| G7 | Saleable product: per-shop tenancy, licensing, easy installer + APK distribution. |

## 2. Current system inventory (as-built facts)

- **Frontend**: React 19 + Vite 6 + Tailwind 4 + TanStack Query + React Router 7. PWA already configured (`vite-plugin-pwa`).
- **Desktop shell**: Tauri 2 project exists (`src-tauri`) with `tauri-plugin-sql` (SQLite feature) already a dependency; `lib.rs` is a stub; bundling disabled (`bundle.active = false`).
- **Data access**: `src/lib/db.ts` — every screen issues **raw SQL over HTTP** (`POST /api/query|/execute|/transaction`) to an Express server (`server/index.js`), which runs it against **PostgreSQL** and enforces permission keys via a SQL classifier (`requiredPermissions()`).
- **Schema**: Postgres migrations in `server/migrations/` (001 init … 011 reminders); separate SQLite-flavored schema in `src/lib/schema.sql` and `src-tauri/migrations/` (stale/partial — needs consolidation).
- **Auth**: JWT bearer tokens; users carry a role + JSON `permissions` array; admin/owner bypass.
- **Modules**: Dashboard, Reminders, POS, Sales History, Reports, P&L, Catalog, Customers, Vehicles, Vendors, Accounts, Expenses, Purchases, Inspections, Team, Shop Settings.

**Key constraint**: raw-SQL-over-HTTP is unsuitable for (a) an internet-exposed VPS and (b) an offline desktop. The architecture must insert a proper API layer and a local database without rewriting the 16 screens.

## 3. Target architecture

```
┌────────────────────────────┐
│ WINDOWS DESKTOP (Tauri 2)  │
│ Full app, all modules      │
│ Local SQLite (offline-first)│──┐
└────────────────────────────┘  │  HTTPS sync (push/pull)
                                ▼
                     ┌─────────────────────┐
                     │ VPS — Cloud Hub     │
                     │ Node/Express API    │
                     │ PostgreSQL          │
                     │ Caddy (TLS)         │
                     └─────────▲───────────┘
                               │ HTTPS REST + JWT
┌────────────────────────────┐ │
│ ANDROID APK (Capacitor)    │─┘
│ Finances-only field app    │
│ Local SQLite (offline)     │
└────────────────────────────┘
```

**Principles**

1. **One cloud API, three consumers** (desktop UI, APK, future web admin).
2. **Local-first**: every client writes to its own SQLite first; sync is asynchronous and retry-safe.
3. **Append-only financial records**: money movements (payments, handovers, reservations) are insert-only rows with UUIDs — never updated in place — so two-way sync can't corrupt money data.
4. **Raw SQL stays internal**: the LAN/desktop-in-server-mode path may keep the current thin-SQL client; the public VPS API and APK use named REST endpoints only.

## 4. Data model changes (migration 012)

- Add to every synced table: keep per-shop `id INTEGER`, add `uuid TEXT UNIQUE` (client-generated), `updated_at`, `deleted_at` (soft delete), `origin TEXT` ('shop' | 'mobile' | 'cloud').
- New tables:
  - `devices` (id, uuid, shop_id, kind 'desktop'|'mobile', name, token_hash, last_sync_at, created_at)
  - `sync_log` (id, device_id, table_name, row_uuid, op, pushed_at) — per-device cursors
  - `cash_movements` (uuid, shop_id, kind 'collection'|'handover'|'expense'|'reserve', amount, party_uuid, order_uuid NULL, route_id, taken_by_user_id, note, occurred_at, origin) — the APK's core table
  - `reservations` (uuid, shop_id, customer_id, items_json, amount, status 'open'|'fulfilled'|'cancelled', created_by, created_at, fulfilled_order_id NULL)
  - `routes` (uuid, shop_id, name, date, assigned_user_id, status)
- **ID mapping**: clients use UUIDs; the cloud assigns global integer ids. Desktop/mobile store both (`id`, `uuid`) so existing screens keep working locally.

## 4b. Khata — the per-person ledger (migrations 014–017)

`customers.credit_balance` and `vendors.payable_balance` were denormalised
running totals with no history behind them, so the shop could not answer "what
happened with this person between March and June", "is he buying more or less
than last month?", or "print his statement".

- `party_ledger` — append-only. Every movement affecting a party's balance is
  one row; balances, statements and trends are **derived**, never stored. A
  debit always increases the balance (what the customer owes us / what we owe
  the vendor), so both party types share one formula.
- `commitments` / `commitment_items` — what field staff book on the road, with
  no stock movement until the shop converts them into an order.
- `payable_allocations` (017) — how one payment was split across the invoices
  it settled. Needed because `party_ledger.vendor_payable_id` can point at only
  one invoice, and payments routinely clear several. It is also the audit trail
  for FIFO settlement.
- 015 books the difference between the stored balance and the ledger as an
  explicit **opening balance** rather than silently overwriting a number the shop
  already shows.

Posted through `src/lib/ledgerSql.ts` (pure SQL, one place) + `src/lib/ledger.ts`
(data access). Both dialects are supported: the shop server runs PostgreSQL, the
offline desktop runs SQLite via `pgToSqlite()`.

## 5. Cloud API (extends `server/index.js`)

New versioned routes under `/v1` (JWT or device-token auth):
- `POST /v1/auth/login`, `POST /v1/devices/register` (admin-issued pairing code)
- `GET /v1/pull?since=<cursor>&tables=...` — changed rows (server filters by shop_id)
- `POST /v1/push` — batch of client changes, idempotent by uuid (`ON CONFLICT DO NOTHING` for inserts; LWW by `updated_at` for editable entities)
- `POST /v1/finances/collection`, `/v1/finances/handover`, `/v1/reservations` — named endpoints for the APK (validate server-side; never accept raw SQL from mobile)
- Existing raw-SQL endpoints remain for **LAN desktop mode only**, guarded as today.

## 6. Desktop changes (Tauri)

- `lib.rs`: register SQL plugin, run SQLite migrations on startup, expose `sync` commands.
- `src/lib/db.ts` → dual-mode driver:
  - **Server mode** (LAN/shop-server present): current HTTP behavior, unchanged.
  - **Local mode**: `@tauri-apps/plugin-sql` against local SQLite.
  - Mode + server URL configurable in Shop Settings; auto-fallback to local when the server is unreachable.
- **Sync agent** (`src/lib/sync.ts`): outbox table records every local write; push/pull loops on startup + every 2 min when online + manual "Sync now"; status indicator in the sidebar; conflicts: LWW for editable entities, reject+queue for money rows (uuid-idempotent, so retry is safe).
- **Installer**: enable `bundle.active` with NSIS (Windows), app icon, per-user install default, auto-update via Tauri updater in v2.

## 7. Android APK (finances only)

- Capacitor 6 + React (shares `src/lib/api.ts`, types, currency/format utils, and a stripped design system).
- Screens: **Login → Finances dashboard** (today's collections, cash in hand, outstanding per customer, pending sync count) → **Record collection / delivery**, **Hand over cash**, **Reservations** (create/fulfil), **Sync status**.
- Local SQLite cache of customers, routes, outstanding balances; write-locally-then-sync identical to desktop.
- Distribution: direct APK download from the VPS first (signed); Play Store optional later. Device pairing via one-time code from desktop admin.

## 8. VPS deployment

- `docker-compose` (exists) extended: `caddy` (TLS via Let's Encrypt) → `api` → `postgres` + nightly `pg_dump` to `/backups` (7-day rotation).
- Env: `JWT_SECRET`, `DB_PASSWORD`, `POSTGRES_HOST`; device pairing CLI script.
- Sizing: 2 vCPU / 2 GB RAM VPS is sufficient initially.

## 9. Security

- HTTPS only; JWT (users) + per-device tokens (sync) with revocation; APK never receives raw SQL; rate limiting on `/v1/*`; per-shop row isolation enforced server-side (shop_id from token, not from the client).

## 10. Delivery phases & milestones

| Phase | Deliverable | Est. effort | Status |
|---|---|---|---|
| 1 | Tauri installer + dual-mode DB driver | 2–3 days | ✅ Done |
| 2 | Local SQLite schema + sync agent + `/v1` sync endpoints | 5–8 days | ✅ Done |
| 3 | VPS deploy (compose, TLS, backups, pairing) | 1–2 days | ✅ Done — adapted: shared VPS 72.61.115.120, `/opt/apps/app9`, API on **:9000**, web dashboard on **:9001**, no domain/TLS yet (Caddy skipped; HTTP upgrade path documented) |
| 4 | Android APK (finances-only) | 5–8 days | ✅ **DONE — APK BUILT & VERIFIED.** `mobile/` Capacitor + React app; GitHub Actions build #36576035654 green in 4m56s; artifact `lubric-field-apk` (19.6 MB) → `app-debug.apk` (17.58 MB, valid, signed with the Android debug key). Local copy: `LubricField-v0.1.0-debug.apk` in the project root. Repo: https://github.com/hrperalglobalcity-spec/lubric-field |
| 4b | Khata — per-person ledger, statements, month-on-month | 2–3 days | ✅ **DONE.** Migrations 014–017, `/ledger` screen (statement, running balance, period filters, month comparison, CSV, print, WhatsApp, record payment / bill on account), deep-linked from Customers and Vendors. Verified by `server/e2e_ledger.js` (19 checks, live API + Postgres) and `server/e2e_ledger_sqlite.js` (10 checks, offline SQLite). |
| 5 | Hardening, conflict edge cases, signing, licensing | 3–5 days | ⬜ Pending |

Deployment artefacts (Phase 3): the current production topology targets the shared
VPS 72.61.115.120 — `docker-compose.vps.yml` (postgres internal only, API :9000,
web :9001, nightly backups), `deploy/nginx-web.conf`, `DEPLOY.md`, `server/pair.js`.
A single-host Caddy/TLS variant (`docker-compose.prod.yml` + `Caddyfile`) is kept for
when a domain is available.

## 10a. Android APK (Phase 4) — build & install

The APK is built by GitHub Actions (`.github/workflows/android.yml`) because the dev
machine has no Android SDK installed. No local SDK is required.

```bash
# 1. Create the GitHub repo (empty — no README), then from the project root:
git remote add origin https://github.com/<you>/lubricapp.git
git push -u origin master

# 2. GitHub → Actions tab → "Android APK" → Run workflow
# 3. When it turns green: Artifacts → lubric-field-apk → download the ZIP
#    (contains app-debug.apk)

# 4. Copy the .apk to the phone (USB / WhatsApp / Drive) and tap it.
#    Allow "install from unknown sources" when Android asks.
```

Build locally instead (optional, needs Android Studio + JDK 17):

```bash
cd mobile
npm install
npm run build
npx cap add android
npx cap sync android
cd android && gradlew assembleDebug
# → mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

First run on the phone: enter the server URL (`http://72.61.115.120:9000`), the pairing
code from `node pair.js mobile "Field phone"`, and a device name. The debug APK is
signed with the standard Android debug key — fine for sideloading, but for Play Store
distribution a release keystore is required (Phase 5).


## 11. Risks

- **Two id systems** (per-shop ints vs UUIDs) — mitigated by keeping ints locally and mapping at the cloud.
- **Raw-SQL client remains a wide attack surface** if the LAN server is exposed — bind it to LAN, never port-forward.
- **SQLite vs Postgres SQL dialects** in the app's queries (e.g. `date_trunc`, `FILTER`) — audited during Phase 2; a small query-compat shim where needed.
