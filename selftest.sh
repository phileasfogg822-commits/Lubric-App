#!/bin/bash
set -e
echo "=== 1. throwaway pairing code ==="
CODE=$(docker exec lubric9-api node pair.js mobile SyncSelfTest2 | grep -o '[0-9A-F]\{8\}')
echo "code: $CODE"

echo
echo "=== 2. pair to get a device token ==="
TOKEN=$(curl -s -X POST http://127.0.0.1:9000/api/v1/devices/pair \
  -H 'Content-Type: application/json' \
  -d "{\"code\":\"$CODE\",\"name\":\"sync-self-test\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then echo "PAIRING FAILED"; exit 1; fi
echo "token acquired (${#TOKEN} chars)"

echo
echo "=== 3. PULL - this used to kill the whole server ==="
curl -s -o /tmp/pull.json -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:9000/api/v1/pull?since=0"
echo "payload bytes: $(wc -c < /tmp/pull.json)"
head -c 200 /tmp/pull.json
echo

echo
echo "=== 4. server survived? ==="
docker inspect lubric9-api --format 'restarts={{.RestartCount}} status={{.State.Status}}'
curl -s http://127.0.0.1:9000/api/health
echo

echo
echo "=== 5. cleanup test devices ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "DELETE FROM devices WHERE name IN ('sync-self-test','SyncSelfTest','SyncSelfTest2');"