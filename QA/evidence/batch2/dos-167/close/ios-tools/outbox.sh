#!/bin/bash
# Read the sales app's device stores off the booted simulator, READ-ONLY (file: URI with mode=ro +
# immutable=1), so nothing the app owns is ever written by the observer.
#
# Since 609388b the file is named `<appLetter><userId-base36x25><tenantId-base36x25>` (docs/27 §2,
# frontend/libs/offline/src/engine.ts storeNameFor) — 51 characters, no hash — so this script decodes
# each name back to (app, user, distributor) before printing it.
#
# Usage: outbox.sh [userIdFragment]
DIR="$(cd "$(dirname "$0")" && pwd)"
C=$(xcrun simctl get_app_container booted host.exp.Exponent data 2>/dev/null)
FILTER="${1:-}"
SQ="$C/Documents/ExponentExperienceData/@anonymous/dos-sales-7faf459a-6cfb-4f44-ac50-ca89e6b3ce20/SQLite"
echo "container: $C"
echo "store dir: $SQ"
echo
for f in $(ls "$SQ" 2>/dev/null | grep -E '^[sdwh][0-9a-z]{50}$' | sort); do
  who=$(node "$DIR/decode-store-name.mjs" "$f" 2>/dev/null)
  if [ -n "$FILTER" ] && [[ "$who" != *"$FILTER"* ]]; then continue; fi
  echo "=== $f"
  echo "    $who"
  # Copy the file AND its -wal/-shm to a scratch dir and read the COPY: `immutable=1` on the live file
  # would skip the write-ahead log and show a stale picture mid-flight. The app's own files are only read.
  T=$(mktemp -d)
  cp "$SQ/$f" "$T/db" 2>/dev/null
  [ -f "$SQ/$f-wal" ] && cp "$SQ/$f-wal" "$T/db-wal"
  [ -f "$SQ/$f-shm" ] && cp "$SQ/$f-shm" "$T/db-shm"
  p="$T/db"
  echo "--- _outbox (seq | opId | table | rowId | op | status | attempts | created_at | sent_at | acked_at)"
  sqlite3 "$p" "select seq, op_id, tbl, row_id, op, status, attempts, created_at, coalesce(sent_at,'-'), coalesce(acked_at,'-') from _outbox order by seq;" 2>&1
  echo "--- _outbox counts by status"
  sqlite3 "$p" "select status, count(*) from _outbox group by status;" 2>&1
  echo "--- _sync_errors"
  sqlite3 "$p" "select count(*) from _sync_errors;" 2>&1
  echo "--- _sync_state"
  sqlite3 "$p" "select key, substr(value,1,60) from _sync_state order by key;" 2>&1
  echo "--- sales_orders the phone has NOT settled (_pending set)"
  sqlite3 "$p" "select id, retailer_id, state, coalesce(total_paise,''), _pending from sales_orders where _pending is not null and _pending <> '' order by id;" 2>&1
  echo "--- sales_order_lines the phone has NOT settled (_pending set)"
  sqlite3 "$p" "select id, order_id, _pending from sales_order_lines where _pending is not null and _pending <> '' order by id;" 2>&1
  echo "--- row counts"
  sqlite3 "$p" "select 'sales_orders', count(*) from sales_orders union all select 'sales_order_lines', count(*) from sales_order_lines union all select 'retailers', count(*) from retailers;" 2>&1
  rm -rf "$T"
  echo
done
echo "--- every file in the store dir (a -wal/-shm beside a name means that file is OPEN)"
ls -la "$SQ" 2>/dev/null | tail -n +2
