#!/usr/bin/env bash
# ─── LubricApp — one-shot VPS deploy (72.61.115.120, /opt/apps/app9) ──────────
# API :9000   Web :9001   Postgres internal only   Nightly backups -> ./backups
#
# Usage (on the VPS, as root, after uploading lubric9-deploy.tar.gz into the dir):
#   cd /opt/apps/app9
#   sed -i 's/\r$//' deploy/vps-deploy.sh   # strip CRLF if uploaded from Windows
#   bash deploy/vps-deploy.sh
set -euo pipefail

APP_DIR="/opt/apps/app9"
cd "$APP_DIR"

echo "==================================================="
echo " LubricApp deploy   API :9000   Web :9001"
echo "==================================================="

# ── 1. extract ───────────────────────────────────────────────────────────────
echo
echo "==> 1/6  Extracting the bundle"
if [ -f lubric9-deploy.tar.gz ]; then
  tar -xzf lubric9-deploy.tar.gz
  rm -f lubric9-deploy.tar.gz
  echo "    extracted"
else
  echo "    no tarball found - assuming the files are already extracted"
fi

# ── 2. secrets ───────────────────────────────────────────────────────────────
echo
echo "==> 2/6  Generating .env"
if [ -f .env ]; then
  echo "    .env already exists - leaving it untouched"
else
  if ! command -v openssl >/dev/null 2>&1; then
    echo "    !! openssl not found - cannot generate secrets" >&2
    exit 1
  fi
  printf 'DB_NAME=lubricapp\nDB_USER=lubric\nDB_PASSWORD=%s\nJWT_SECRET=%s\n' \
    "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env
  chmod 600 .env
  echo "    .env written with freshly generated secrets (chmod 600)"
fi

# ── 3. backup dir ────────────────────────────────────────────────────────────
echo
echo "==> 3/6  Preparing ./backups"
mkdir -p backups
echo "    ok"

# ── 4. build + start ─────────────────────────────────────────────────────────
echo
echo "==> 4/6  Building and starting the stack (first run takes a few minutes)"
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "    !! neither 'docker compose' nor 'docker-compose' found" >&2
  exit 1
fi
$DC -f docker-compose.vps.yml up -d --build

# ── 5. wait for health ───────────────────────────────────────────────────────
echo
echo "==> 5/6  Waiting for the API to answer /api/health"
ready=0
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:9000/api/health >/dev/null 2>&1; then
    echo "    API is up (after ~$((i * 5))s)"
    ready=1
    break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  echo "    !! API did not respond. Last 60 lines of the api log:"
  $DC -f docker-compose.vps.yml logs --tail=60 api
fi

# ── 6. report ────────────────────────────────────────────────────────────────
echo
echo "==> 6/6  Status"
$DC -f docker-compose.vps.yml ps
echo
echo "--- health (from inside the VPS) ---"
curl -s http://127.0.0.1:9000/api/health || echo "  (no response)"
echo
echo "--- lubric9 containers ---"
docker ps --filter "name=lubric9" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo
echo "==================================================="
echo " Next: create pairing codes"
echo "   docker exec -it lubric9-api node pair.js desktop \"Front counter\""
echo "   docker exec -it lubric9-api node pair.js mobile  \"Field phone\""
echo "==================================================="
