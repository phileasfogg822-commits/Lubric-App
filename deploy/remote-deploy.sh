#!/usr/bin/env bash
# Remote deploy runner (upload to VPS, run as root)
set -uo pipefail
APP_DIR=/opt/apps/app9
cd "$APP_DIR" || { echo "FATAL: $APP_DIR missing"; exit 1; }

echo "==================== 1. BASELINE ===================="
docker ps -a --format "{{.ID}}|{{.Names}}|{{.Status}}" | sort > /root/lubric9-baseline.txt
echo "saved $(wc -l < /root/lubric9-baseline.txt) existing containers (DO NOT TOUCH)"

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
chmod 755 deploy dist server
chmod 644 docker-compose.vps.yml
ls -ld deploy dist server docker-compose.vps.yml

echo "==================== 4. BUILD + START ===================="
echo "first build can take several minutes..."
docker compose -f docker-compose.vps.yml up -d --build
echo "COMPOSE_EXIT=$?"

echo "==================== 5. RESULT ===================="
docker ps -a --filter "name=lubric9" --format "{{.Names}}|{{.Status}}|{{.Ports}}"
echo "DONE-REMOTE-DEPLOY"