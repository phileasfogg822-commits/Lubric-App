#!/bin/bash
MIG=/opt/apps/app9/server/migrations/014_party_ledger.sql
echo "=== APPLYING 014 for real ==="
docker exec -i lubric9-db psql -U lubric -d lubricapp -v ON_ERROR_STOP=1 -f - < "$MIG"
echo "exit=$?"
echo
echo "=== ledger summary by kind ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT kind, direction, count(*) AS rows, sum(amount) AS total FROM party_ledger GROUP BY 1,2 ORDER BY 1,2;"
echo "=== per-customer: ledger balance vs the stored credit_balance ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT c.id, c.name,
          COALESCE(SUM(CASE WHEN l.direction='debit' THEN l.amount ELSE -l.amount END),0) AS ledger_balance,
          c.credit_balance AS stored_balance
     FROM customers c LEFT JOIN party_ledger l ON l.party_type='customer' AND l.party_id=c.id
    GROUP BY c.id, c.name, c.credit_balance ORDER BY c.id;"