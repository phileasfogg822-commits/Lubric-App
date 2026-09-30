#!/usr/bin/env bash
# Remote deploy runner (upload to VPS, run as root)
set -uo pipefail
APP_DIR=/opt/apps/app9
cd "$APP_DIR" || { echo "FATAL: $APP_DIR missing"; exit 1; }

echo "==================== 1. BASELINE ===================="
docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}" | sort > /root/lubric9-baseline.txt
echo "saved $(wc -l < /root/lubric9-baseline.txt) existing containers (DO NOT TOUCH)"

echo "==================== 1. WEB BUILD ===================="
# Sync INTO the existing dist/ directory.
#
# Do NOT `rm -rf dist` and untar a fresh one. The web container has dist/ bind-
# mounted, and a bind mount pins the directory INODE at container start. Swapping
# the directory out from under it leaves nginx reading a deleted inode, so every
# request 403s - and `docker compose` will NOT fix it, because the mount path
# string is unchanged, so compose considers the container up to date. That is
# exactly the outage this replaced.
#
# rsync updates the contents in place: the directory, its inode and the mount
# are untouched, and no container needs recreating.
if [ -f dist.tar.gz ]; then
  rm -rf .dist-stage && mkdir -p .dist-stage
  tar -xzf dist.tar.gz -C .dist-stage
  if [ -d .dist-stage/dist ]; then
    mkdir -p dist
    rsync -a --delete .dist-stage/dist/ dist/
  fi
  rm -rf .dist-stage dist.tar.gz
  echo "    dist/ synced in place ($(find dist -type f | wc -l) files)"
else
  echo "    no dist.tar.gz found - leaving the existing build alone"
fi

echo "==================== 2. SECRETS ===================="
if [ -f .env ]; then
  echo ".env already exists - leaving it untouched"
else
  printf "DB_NAME=lubricapp\nDB_USER=lubric\nDB_PASSWORD=%s\nJWT_SECRET=%s\n" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env
  chmod 600 .env
  echo ".env created with fresh random secrets"
fi
echo "--- .env (values masked) ---"
sed -e "s/=.*/=<hidden>/" .env
ls -la .env

echo "==================== 3. PERMISSIONS ===================="
chmod 755 deploy server
chmod 644 docker-compose.vps.yml
ls -ld deploy server docker-compose.vps.yml

echo "==================== 4. BACKUP THE DB ===================="
# Migrations re-run on every container start, so a dump must exist BEFORE the
# new build is allowed to start.
set -a; . ./.env; set +a
ts=$(date -u +%Y%m%d-%H%M)
mkdir -p backups
if docker exec lubric9-db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "backups/pre-deploy-${ts}.dump"; then
  chmod 600 "backups/pre-deploy-${ts}.dump"
  echo "    backups/pre-deploy-${ts}.dump written"
else
  echo "    !! pg_dump FAILED - refusing to deploy" >&2
  exit 1
fi

echo "==================== 5. BUILD + START ===================="
echo "first build can take several minutes..."
docker compose -f docker-compose.vps.yml up -d --build
echo "COMPOSE_EXIT=$?"

echo "==================== 6. VERIFY ===================="
ready=0
for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:9000/api/health >/dev/null 2>&1; then
    echo "    API up after ~$((i * 3))s"; ready=1; break
  fi
  sleep 3
done
[ "$ready" -eq 1 ] || { echo "    !! API unhealthy"; docker logs --tail=40 lubric9-api; exit 1; }

# A dashboard that answers anything but 200 is the failure this catches.
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9001/)
echo "    dashboard HTTP $code"
if [ "$code" != "200" ]; then
  echo "    !! dashboard is not serving the build" >&2
  echo "    !! recover with:" >&2
  echo "    !!   docker compose -f docker-compose.vps.yml up -d --force-recreate web" >&2
  exit 1
fi

echo "==================== 7. RESULT ===================="
docker ps -a --filter "name=lubric9" --format "{{.Names}}|{{.Status}}|{{.Ports}}"
echo "--- other apps still running? ---"
echo "    $(docker ps --format '{{.Names}}' | grep -vc '^lubric9-') non-app9 containers up"
echo "--- container changes outside app9 (must be none) ---"
docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}" | sort > /root/lubric9-after.txt
unexpected=$(diff /root/lubric9-baseline.txt /root/lubric9-after.txt \
  | grep -E '^[<>]' | grep -vE 'lubric9-' || true)
if [ -n "$unexpected" ]; then
  echo "$unexpected" | sed 's/^/    !! UNEXPECTED: /'
else
  echo "    none (good)"
fi
echo "DONE-REMOTE-DEPLOY"