#!/usr/bin/env bash
# BizPilot AI · Part 2 — Finance Engine & Testing
# Owner: Member 2 (see TEAM.md)
# -----------------------------------------------------------------------------
# Database test runner.
#
# Creates a throwaway database, applies the Supabase shim (only creates what is
# missing), every migration in order, the test helpers, then runs each
# supabase/tests/*.test.sql file in its own transaction (rolled back).
#
# Connection: standard libpq env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD).
# Example with the Supabase CLI's local Postgres:
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres ./scripts/test-db.sh
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="bizpilot_test_$$"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb "$DB"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/bootstrap/local_supabase_shim.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  if ! out=$("${PSQL[@]}" -d "$DB" -f "$f" 2>&1); then
    echo "✗ migration failed: $(basename "$f")"; echo "$out"; exit 1
  fi
done
echo "✓ applied $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations"

"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/bootstrap/test_helpers.sql" >/dev/null

pass=0; fail=0; failed_files=()
for f in "$ROOT"/supabase/tests/*.test.sql; do
  name="$(basename "$f")"
  if out=$("${PSQL[@]}" -d "$DB" -c "begin;" -f "$f" -c "rollback;" 2>&1); then
    n=$(grep -c "PASS:" <<<"$out" || true)
    pass=$((pass + n))
    echo "✓ $name ($n checks)"
    grep "PASS:" <<<"$out" | sed 's/.*PASS: /    · /'
  else
    fail=$((fail + 1)); failed_files+=("$name")
    echo "✗ $name"
    grep -v "PASS:" <<<"$out" | sed 's/^/    /'
  fi
done

echo
echo "Database tests: $pass checks passed, $fail file(s) failed"
[ "$fail" -eq 0 ]
