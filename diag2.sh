#!/bin/sh
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT id, kind, name, COALESCE(pairing_code, '(code used - PAIRED)') AS code, revoked FROM devices ORDER BY id;"