#!/bin/sh
echo "=== does /api/v1/devices/pair exist? (bogus code - non-destructive) ==="
curl -s -o /tmp/pair.txt -w "HTTP %{http_code}\n" -X POST http://127.0.0.1:9000/api/v1/devices/pair \
  -H 'Content-Type: application/json' \
  -d '{"code":"00000000","name":"diag"}'
echo "body: $(cat /tmp/pair.txt)"
echo
echo "=== device rows in the DB ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT id, kind, name, pairing_code, revoked FROM devices ORDER BY id;"