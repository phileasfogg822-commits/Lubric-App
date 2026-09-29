#!/bin/sh
echo "=== migration 013 ran? ==="
docker logs lubric9-api 2>&1 | grep -E "013|migration files" | tail -3
echo
echo "=== shop_id present on the four child tables now? ==="
docker exec lubric9-db psql -U lubric -d lubricapp -t -A -F'|' -c \
  "SELECT c.relname,
          (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='shop_id') AS has_shop
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND c.relname IN ('order_items','account_transactions','vehicles','vendor_payables')
    ORDER BY 1;"