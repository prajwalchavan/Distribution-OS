#!/bin/sh
# Runs the seed invariants of REALISTIC-SEED-SPEC.md §5 against a seeded database.
#
#   QA/tools/seed/verify-seed.sh                 # DATABASE_URL from the environment, else the local dos
#   RESEED=1 QA/tools/seed/verify-seed.sh        # also I-49: re-run `pnpm db:seed` and prove no table grew
#
# Exits non-zero when any check fails. Postgres 17's psql is expected at the Homebrew path.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PSQL="${PSQL:-/opt/homebrew/opt/postgresql@17/bin/psql}"
URL="${DATABASE_URL:-postgres://dos:dos@127.0.0.1:5439/dos}"

COUNTS="select tablename, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', tablename), false, true, '')))[1]::text::int as n
          from pg_tables where schemaname = 'public' order by tablename"

if [ -n "$RESEED" ]; then
  # I-49 / I-50: a second seed adds nothing to any table, and runs inside the budget.
  BEFORE="$("$PSQL" "$URL" -X -At -c "$COUNTS")"
  START=$(date +%s)
  (cd "$ROOT/backend" && DATABASE_URL="$URL" pnpm db:seed > /dev/null)
  END=$(date +%s)
  AFTER="$("$PSQL" "$URL" -X -At -c "$COUNTS")"
  if [ "$BEFORE" != "$AFTER" ]; then
    echo "I-49 FAILED: a second pnpm db:seed changed row counts (before / after):" >&2
    printf '%s\n' "$BEFORE" > "${TMPDIR:-/tmp}/verify-seed-before.txt"
    printf '%s\n' "$AFTER" > "${TMPDIR:-/tmp}/verify-seed-after.txt"
    diff "${TMPDIR:-/tmp}/verify-seed-before.txt" "${TMPDIR:-/tmp}/verify-seed-after.txt" >&2 || true
    exit 1
  fi
  echo "I-49 ok: second seed added nothing ($((END - START)) s, budget 180 s)"
  [ $((END - START)) -le 180 ] || { echo "I-50 FAILED: seed took $((END - START)) s" >&2; exit 1; }
fi

"$PSQL" "$URL" -X -v ON_ERROR_STOP=1 -f "$HERE/verify-seed.sql"
