#!/bin/sh
echo "=== does every sync table have shop_id AND updated_at? ==="
docker exec lubric9-db psql -U lubric -d lubricapp -t -A -F'|' -c \
  "SELECT c.relname,
          (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='shop_id') AS has_shop,
          (SELECT count(*) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='updated_at') AS has_upd
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND c.relname IN ('products','services','customers','vehicles','vendors','orders','order_items','expenses','accounts','account_transactions','purchase_orders','vendor_payables','reminders','inspections')
    ORDER BY 1;"