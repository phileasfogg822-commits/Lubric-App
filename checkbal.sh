#!/bin/bash
echo "=== all orders, with what was paid ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT o.id, o.customer_id, c.name, o.status, o.total, o.paid_amount,
          (COALESCE(o.total,0) - COALESCE(o.paid_amount,0)) AS udhaar, o.created_at::date
     FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.customer_id, o.id;"
echo "=== where does credit_balance=12500 come from? ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT id, name, credit_balance, customer_type, last_visit_at, created_at::date
     FROM customers WHERE id=2;"
echo "=== any account_transactions mentioning him? ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT count(*) AS account_tx FROM account_transactions;"