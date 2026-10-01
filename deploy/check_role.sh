#!/bin/sh
# Can the app role actually authenticate, and can it do its job?
echo "--- as lubric_app over TCP ---"
PGPASSWORD=lubric_app_pw psql -h db -U lubric_app -d lubricapp -tAc "SELECT current_user, count(*) FROM products" 2>&1 | head -5
echo "--- as lubric_app over the local socket ---"
PGPASSWORD=lubric_app_pw psql -U lubric_app -d lubricapp -tAc "SELECT current_user" 2>&1 | head -3
echo "--- hba rules ---"
grep -vE '^\s*#|^\s*$' /var/lib/postgresql/data/pg_hba.conf 2>/dev/null | head -10
echo "--- password_encryption ---"
psql -U lubric -d lubricapp -tAc "SHOW password_encryption" 2>&1 | head -2