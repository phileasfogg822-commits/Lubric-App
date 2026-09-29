#!/bin/sh
echo "=== devices: has each one ever synced? ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT id, kind, name, (token_hash IS NOT NULL) AS has_token, last_sync_at FROM devices ORDER BY id;"
echo
echo "=== any cash movements / reservations arrived? ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT (SELECT count(*) FROM cash_movements) AS movements, (SELECT count(*) FROM reservations) AS reservations, (SELECT count(*) FROM customers) AS customers;"