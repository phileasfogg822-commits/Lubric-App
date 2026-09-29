#!/bin/sh
echo "=== foreign keys of the four child tables ==="
docker exec lubric9-db psql -U lubric -d lubricapp -c \
  "SELECT tc.table_name, kcu.column_name, ccu.table_name AS references
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name=ccu.constraint_name
    WHERE tc.constraint_type='FOREIGN KEY'
      AND tc.table_name IN ('vehicles','order_items','account_transactions','vendor_payables')
    ORDER BY 1;"