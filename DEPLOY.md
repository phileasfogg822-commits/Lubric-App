# VPS Deployment Guide (Production)

How to put LubricApp's cloud hub on a VPS so the Windows desktop app and the
Android APK sync through it. Follow top to bottom; ~15 minutes.

## 0. What you need

- A VPS (2 vCPU / 2 GB RAM is enough to start): Ubuntu 22.04/24.04, Debian 12, etc.
- A domain name (e.g. `api.yourdomain.com`) with an **A record** pointing to the VPS IP.
- SSH access.

## 1. Point DNS at the server

Create the A record now — Let's Encrypt needs it before Caddy can issue a
certificate. Verify: `ping api.yourdomain.com` resolves to your VPS IP.

## 2. Install Docker

```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sh
```

## 3. Get the code onto the server

Either `git clone` your repo, or copy the folder up:

```bash
scp -r ./lubricapp root@YOUR_VPS_IP:/opt/lubricapp
cd /opt/lubricapp
```

## 4. Configure secrets

```bash
cp server/.env.example .env
nano .env
```

Set, at minimum:

```
DB_PASSWORD=<long random string>
JWT_SECRET=<different long random string>
```

Generate good values with: `openssl rand -hex 32` (run twice — one per var).

## 5. Set your domain in the Caddyfile

```bash
nano Caddyfile        # replace api.yourdomain.com with your domain
```

## 6. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This starts: `db` (Postgres, internal only), `api` (runs all migrations —
including `012_sync.sql` — then serves), `backup` (nightly dumps) and `caddy`
(HTTPS on 80/443).

Verify:

```bash
curl https://api.yourdomain.com/api/health
# {"status":"ok","db":"connected",...}
```

The first certificate issuance can take ~30 seconds after DNS propagates.

## 7. Pair your devices

Every device (desktop install, Android APK) needs a one-time pairing code:

```bash
# Desktop (front counter PC)
docker exec -it lubric-api node pair.js desktop "Front counter"

# Mobile (field staff)
docker exec -it lubric-api node pair.js mobile "Kashif's phone"
```

Each prints a code like `A3F9C2D1`.

- **Desktop**: open the app → Shop Settings → Cloud & Sync → paste the VPS URL
  (`https://api.yourdomain.com`), Save URL, enter the code, **Pair device**.
  Then hit **Sync now** — data starts flowing both ways.
- **APK** (Phase 4): first launch → enter server URL + code.

## 8. Backups

- Nightly dumps land in `./backups/lubricapp-YYYYMMDD-HHMM.dump` (7 kept).
- Restore drill (do it once now, not during an emergency):

```bash
docker exec -i lubric-db psql -U postgres -c "CREATE DATABASE restore_test"
docker exec -i lubric-db pg_restore -U postgres -d restore_test \
  < backups/lubricapp-<latest>.dump
docker exec -i lubric-db psql -U postgres -c "DROP DATABASE restore_test"
```

Copy the `backups/` folder off-server periodically (or mount it to object storage).

## 9. Updating the app

```bash
cd /opt/lubricapp
git pull            # or scp the new build
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations are idempotent — they run automatically on every container start.

## 10. Security checklist

- [x] Postgres is **not** published to the internet (only `api` reaches it).
- [x] HTTPS enforced by Caddy; HTTP redirects automatically.
- [ ] `.env` secrets set to random values (never the examples).
- [ ] Firewall: only 22, 80, 443 open (`ufw allow 22,80,443/tcp && ufw enable`).
- [ ] The raw-SQL `/api/*` endpoints require login — do not bypass auth.
- [ ] Revoke a lost device:

```bash
docker exec -it lubric-db psql -U postgres -d lubricapp \
  -c "UPDATE devices SET revoked = TRUE WHERE id = <device_id>;"
```

## 11. Monitoring quick wins

```bash
docker compose -f docker-compose.prod.yml logs -f api     # app logs
docker exec lubric-db psql -U postgres -c "SELECT id, kind, name, last_sync_at, revoked FROM devices;"
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Caddy keeps failing TLS | DNS not propagated yet, or ports 80/443 blocked upstream. |
| `api` restarts in a loop | Check `docker compose -f docker-compose.prod.yml logs api` — usually a bad `.env`. |
| Desktop "Push failed: 401" | Device token revoked or pairing never done — re-pair with a fresh code. |
| Clock skew warnings | Keep the VPS on NTP (`timedatectl set-ntp true`) — sync cursors use server time. |

---

# Deploy to the existing VPS (72.61.115.120 — no domain, ports 9000/9001)

This section is tailored to the shared VPS where apps run in `/opt/apps/app1..app8`.
Port 80/443 are already taken by another app's nginx, so this stack skips Caddy
entirely and publishes directly:

| Port | Service | Notes |
|---|---|---|
| **9000** | API (`lubric9-api`) | Desktop sync, APK, health check. |
| **9001** | Web dashboard (`lubric9-web`) | The PWA build (`dist/`), proxies `/api` to the API. |
| — | Postgres (`lubric9-db`) | Internal only; never published. |

> **Security note:** without a domain there is no TLS — tokens travel as plain
> HTTP. Acceptable to start; upgrade path at the bottom. Also note Android
> blocks cleartext HTTP by default, so the APK (Phase 4) will carry a
> cleartext-exception for this IP until TLS exists.

## A. From your Windows PC (build + upload)

```powershell
cd c:\Users\Grafixers\Downloads\Compressed\lubricapp
npm run build     # produces dist/ for the web dashboard

tar --exclude=node_modules --exclude=src-tauri/target --exclude=dist/.vite -czf lubricapp.tar.gz .
scp lubricapp.tar.gz root@72.61.115.120:/opt/apps/app9/
```

(Windows 10+ ships `tar` and `scp`. If `tar` is missing: `wsl tar ...` or zip.)

## B. On the VPS (SSH in as root)

```bash
mkdir -p /opt/apps/app9/backups
cd /opt/apps/app9
tar -xzf lubricapp.tar.gz && rm lubricapp.tar.gz

# ── Secrets (fail-safe: the stack refuses to start without them) ──
cat > .env <<'EOF'
DB_NAME=lubricapp
DB_USER=lubric
DB_PASSWORD=CHANGE_ME_1
JWT_SECRET=CHANGE_ME_2
EOF
# Replace both:  openssl rand -hex 32   (run twice)
nano .env

# ── Start the stack ──
docker compose -f docker-compose.vps.yml up -d --build

# ── Verify ──
curl http://127.0.0.1:9000/api/health
# {"status":"ok","db":"connected",...}
```

Open in a browser later: `http://72.61.115.120:9001` (dashboard),
`http://72.61.115.120:9000/api/health` (API health).

## C. Pair devices

```bash
docker exec -it lubric9-api node pair.js desktop "Front counter"
docker exec -it lubric9-api node pair.js mobile "Field phone"
```

Then in the **desktop app**: Shop Settings → Cloud & Sync →
URL = `http://72.61.115.120:9000` → Save URL → enter the code → **Pair device** → **Sync now**.

## D. Firewall

Only 9000/9001 need to be reachable. Check both the provider panel and:

```bash
ufw status
# if active: ufw allow 9000/tcp && ufw allow 9001/tcp
```

## E. Updating

```bash
# Windows: rebuild + re-upload (tar/scp as above)
# VPS:
cd /opt/apps/app9
docker compose -f docker-compose.vps.yml up -d --build
```

Migrations are idempotent and re-run on every start.

## F. Upgrading to HTTPS later (when you get a domain)

1. Point the domain's A record at 72.61.115.120.
2. Add a Caddy service to `docker-compose.vps.yml` (ports 80/443 are free if
   the other app's nginx is removed from them — otherwise front through it).
3. Set the desktop/APK Cloud URL to `https://your.domain` — no data migration
   needed; sync continues.

