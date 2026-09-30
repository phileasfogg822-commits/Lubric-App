#!/bin/sh
# End-to-end tests against the live API + Postgres (run inside the container).
#
# Only the tests that work on the container's Node 20 runtime live here. The two
# khata suites (e2e_ledger.js / e2e_ledger_sqlite.js) import the app's real
# TypeScript to test the SQL the app actually sends, and the SQLite one needs
# node:sqlite — both require Node 22+. Run those from the repo root:
#
#   cd server && npm run e2e:ledger          (needs the API + Postgres up)
#   cd server && npm run e2e:ledger:sqlite   (standalone, in-memory SQLite)
set -e
cd /app
node /app/e2e_reminders.js
