#!/bin/bash
MIG=/opt/apps/app9/server/migrations/014_party_ledger.sql
echo "=== DRY RUN: BEGIN + migration + inspect + ROLLBACK ==="
{
  echo "BEGIN;"
  cat "$MIG"
  echo "SELECT 'would create ' || count(*) || ' ledger rows' FROM party_ledger;"
  echo "SELECT kind, direction, count(*) FROM party_ledger GROUP BY 1,2 ORDER BY 1,2;"
  echo "ROLLBACK;"
} | docker exec -i lubric9-db psql -U lubric -d lubricapp -v ON_ERROR_STOP=1
echo "exit=$?"
echo
echo "=== ledger must NOT exist after rollback ==="
docker exec lubric9-db psql -U lubric -d lubricapp -t -A -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('party_ledger','commitments');"