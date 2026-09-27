# Lubric POS - Docker Development Guide

## Quick Start

```bash
# Start all services (Postgres + Backend + Frontend)
npm run docker:up

# Or directly:
docker compose up -d
```

Then open **http://localhost:5173** in your browser.

## Services

| Service | URL | Description |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | React + Vite dev server (hot reload) |
| Backend API | http://localhost:3001 | Express.js REST API |
| PostgreSQL | localhost:5432 | Database |

## Default Login Credentials

- **Admin**: `admin@lubric.app` / `admin123`
- **Cashier**: `cashier@lubric.app` / `cashier123`

## Sample Data (auto-loaded)

The migrations ship with demo data so the POS is usable immediately:

| Table | Rows | Notes |
|-------|------|-------|
| `products` | 12 | Every product has all 3 price tiers filled in |
| `services` | 5 | Oil change, tune-up, grease & lube, etc. |
| `containers` | 4 | Opened drums with partial volume remaining |
| `customers` | 4 | One per tier: returning / wholesale / walking |
| `orders` + `order_items` | 3 / 10 | Past sales, so customer history has content |

**Test the POS with these names:** `Zafar Iqbal` (returning), `Hassan Traders`
(wholesale, has 12,500 credit), `Ali Raza` (walking), `Metro Workshop` (wholesale).

Everything is loaded from `server/migrations/003_sample_data.sql`. It uses explicit
ids + `ON CONFLICT DO NOTHING`, so re-running is harmless.

Migrations run on **every** backend start, in filename order:

| File | Contents |
|------|----------|
| `001_init.sql` | Full schema (20+ tables, indexes) |
| `002_seed.sql` | Shop, users, accounts, categories, brands, settings |
| `003_sample_data.sql` | Demo data listed above — safe to delete |

> **Sequence caveat when editing the seeds:** both seed files insert rows with explicit ids, then
> advance the PostgreSQL sequences via `SELECT setval(pg_get_serial_sequence('products','id'), ...)`.
> If you add rows with explicit ids and forget that `setval(...)` call, the app's own `INSERT`s
> (which rely on the sequence) will collide with your seeded ids. The `products` insert also has a
> `wholesale_min_qty` per row — wholesale pricing only kicks in at or above that quantity.

> **To start with a completely empty database**, delete
> `server/migrations/003_sample_data.sql` and run `docker compose down -v && docker compose up -d`.
> `002_seed.sql` (users, categories, brands, settings) will still load.
> ⚠️ **Delete a seeded row and it comes back on restart.** The backend re-runs
> *every* file in `server/migrations/` on each start (there is no migration
> tracking table), so `003_sample_data.sql` re-inserts anything missing. Edits to
> existing rows are safe, because the inserts use `ON CONFLICT DO NOTHING`. Once
> you are done demoing, delete `003_sample_data.sql` and recreate the volume.

## POS Page

`http://localhost:5173/pos`

- **Customer name first** — the cart is locked until a name is entered. Typing a name
  that already exists in `customers` loads that customer's history on the right
  (total spent, credit balance, recent orders).
- **Pricing tier is a hidden feature** — three small, unlabelled buttons `W` / `R` / `Wh`
  in the top bar switch between walking, returning and wholesale prices. The chosen
  tier is never displayed prominently, so a customer at the counter can't tell which
  price bracket they are being charged.
- **Tier rules** (see `pf()` in `src/modules/pos/POSCart.tsx`):
  - `W` → `price_walking`, falling back to `price_returning` when null
  - `R` → `price_returning`
  - `Wh` → `price_wholesale` only when qty ≥ `wholesale_min_qty`, else `price_returning`
- **One search box** — type-ahead across products, partial containers, services and
  the used-oil drum (try "oil" or "drum"). Results are grouped and tagged by type.
- **Cart** — edit qty and (optionally) unit price; totals recalculate live.
- **Printing** — four formats: `A4`, `A5`, `80mm receipt` (grocery thermal roll) and
  `3"` (72mm narrow thermal). Paper size is applied via a `@page` rule injected at
  print time. A cart that hasn't been completed yet prints as `DRAFT` instead of
  showing a fake order number.

## Commands

```bash
# Start services
npm run docker:up

# Stop services
npm run docker:down

# View logs
npm run docker:logs

# Rebuild containers after dependency changes
npm run docker:build

# Run migrations manually (inside backend container)
docker exec lubricapp-backend node migrate.js
```

## How It Works

1. **Postgres** starts first and initializes the database
2. **Backend** waits for Postgres to be healthy, then runs migrations + seed data, then starts the API server with hot reload
3. **Frontend** starts Vite dev server with hot reload and proxies `/api` requests to the backend

## Live Development

- Edit any file in `src/` → Vite hot-reloads the browser instantly
- Edit any file in `server/` → Backend auto-restarts with changes
- Database persists in Docker volume `pgdata` across restarts

## Architecture

```
Browser → Vite Dev Server (:5173) → /api/* → Express Backend (:3001) → PostgreSQL (:5432)
```

## Building for Production (Web)

```bash
npm run build
# Output in dist/ folder - deploy to any static hosting
```

## Building for Desktop (Windows Installer)

When you're happy with the app and want to create a Windows installer:

1. Ensure Tauri dependencies are installed: `npm install`
2. Run: `npm run tauri:build`
3. The installer will be in `src-tauri/target/release/bundle/`

Note: For the desktop build, you'll need to either:
- Bundle PostgreSQL with the installer, OR
- Switch back to SQLite for local storage, OR
- Configure the app to connect to a remote database

## Troubleshooting

### Port conflicts
If ports 5173, 3001, or 5432 are already in use, edit `docker-compose.yml` to change the host port mappings.

### Database reset
```bash
docker compose down -v
docker compose up -d
```

### View backend logs
```bash
docker logs lubricapp-backend -f
```

### View frontend logs
```bash
docker logs lubricapp-frontend -f
```

### Rebuild after package.json changes
```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```
