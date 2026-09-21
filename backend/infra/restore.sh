#!/usr/bin/env bash
# Restore one dump written by backup.sh. This script has been RUN, not just written: the round trip
# (dump -> drop -> restore -> the row counts match) is
# backend/all-in-one/src/deploy/backup.spec.ts › DEP-05.
#
#   ./restore.sh /var/backups/dos/daily/db-20260921-020001.dump
#   ./restore.sh /var/backups/dos/daily/db-....dump /var/backups/dos/daily/storage-....tar.gz
#
# The matching globals-<stamp>.sql beside the dump is applied first, without being asked for: the
# roles app_rw and app_worker are cluster-wide and a restore onto a fresh Postgres needs them.
#
# It refuses to run until RESTORE_CONFIRM names the database it is about to overwrite, because
# `pg_restore --clean` drops every object it is about to replace and a typo'd DATABASE_URL would do
# that to the wrong database in silence.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/.env.prod}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

DUMP="${1:-}"
FILES="${2:-}"
# The cluster-wide roles. Taken automatically from the dump's own stamp unless GLOBALS names one.
GLOBALS="${GLOBALS:-}"
[ -n "$DUMP" ] || {
  echo "usage: restore.sh <db-....dump> [storage-....tar.gz]" >&2
  exit 1
}
[ -s "$DUMP" ] || {
  echo "no such dump (or it is empty): $DUMP" >&2
  exit 1
}

: "${DATABASE_URL:?DATABASE_URL is required (it is in .env.prod)}"
OBJECT_STORAGE_DIR="${OBJECT_STORAGE_DIR:-/data/storage}"
DOCKER_NETWORK="${DOCKER_NETWORK:-dos_default}"
STORAGE_VOLUME="${STORAGE_VOLUME:-dos_dos-storage}"

TARGET="${DATABASE_URL##*/}"
TARGET="${TARGET%%\?*}"
if [ "${RESTORE_CONFIRM:-}" != "$TARGET" ]; then
  echo "refusing to restore: set RESTORE_CONFIRM=$TARGET to confirm you mean THIS database" >&2
  echo "  (pg_restore --clean drops every object it replaces)" >&2
  exit 1
fi

pg() {
  local bin="$1"
  shift
  if command -v "$bin" >/dev/null 2>&1; then
    "$bin" "$@"
  else
    docker run --rm -i --network "$DOCKER_NETWORK" postgres:17-alpine "$bin" "$@"
  fi
}

if [ -z "$GLOBALS" ]; then
  CANDIDATE="$(dirname "$DUMP")/globals-$(basename "$DUMP" | sed -e 's/^db-//' -e 's/\.dump$//').sql"
  if [ -s "$CANDIDATE" ]; then
    GLOBALS="$CANDIDATE"
  fi
fi

# Roles first. app_rw and app_worker are cluster-wide, so they are NOT in the database dump, and
# every GRANT and every RLS policy in it names them: onto a fresh Postgres the restore would fail on
# the first one. Errors here are tolerated on purpose — on the original cluster the roles already
# exist, and "role already exists" is the expected outcome, not a failure.
if [ -n "$GLOBALS" ]; then
  echo "$(date '+%F %T') restoring cluster roles from $GLOBALS"
  pg psql --dbname "$DATABASE_URL" --set ON_ERROR_STOP=0 --quiet --file - <"$GLOBALS" >/dev/null || true
fi

echo "$(date '+%F %T') restoring $DUMP into $TARGET"
# --clean --if-exists so a partially-populated database is replaced rather than merged, and
# --single-transaction so a half-restored database is never left behind. Ownership and ACLs come
# from the dump, which is what keeps app_rw's grants and the RLS policies that name it.
set +e
pg pg_restore --clean --if-exists --single-transaction --dbname "$DATABASE_URL" <"$DUMP"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  echo "pg_restore exited $STATUS" >&2
  exit "$STATUS"
fi

if [ -n "$FILES" ]; then
  [ -s "$FILES" ] || {
    echo "no such archive (or it is empty): $FILES" >&2
    exit 1
  }
  echo "$(date '+%F %T') restoring the object store from $FILES"
  if [ -d "$OBJECT_STORAGE_DIR" ]; then
    tar -xzf "$FILES" -C "$OBJECT_STORAGE_DIR"
  else
    docker run --rm -v "$STORAGE_VOLUME":/data -v "$(cd "$(dirname "$FILES")" && pwd)":/in:ro alpine:3 \
      tar -xzf "/in/$(basename "$FILES")" -C /data
  fi
fi

echo "$(date '+%F %T') restore complete"
