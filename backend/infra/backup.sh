#!/usr/bin/env bash
# Nightly backup, OFF the box. A pg_dump on the same disk as the database is not a backup: a free
# Oracle VM can be reclaimed for idleness and a disk can die, so the dump and the uploaded files go
# to an S3-compatible store (Cloudflare R2 is the decided one — zero egress, 10 GB free) and the
# local copies are only a cache that is rotated.
#
# Run it from cron on the VM, as the user that can talk to Docker:
#   0 2 * * *  cd /opt/dos/backend/infra && ./backup.sh >> /var/log/dos-backup.log 2>&1
#
# Reads .env.prod (the file compose uses) unless the variables are already in the environment.
# Restoring one of these is restore.sh, which has been run — see docs/30 §8.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/.env.prod}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required (it is in .env.prod)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/dos}"
OBJECT_STORAGE_DIR="${OBJECT_STORAGE_DIR:-/data/storage}"
BACKUP_KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
BACKUP_KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
BACKUP_UPLOAD="${BACKUP_UPLOAD:-1}"
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-dos}"
# Reaching the database and the object store from inside the compose network when this script runs
# on the VM host: see `pg` and `vol` below.
DOCKER_NETWORK="${DOCKER_NETWORK:-dos_default}"
STORAGE_VOLUME="${STORAGE_VOLUME:-dos_dos-storage}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DOW="$(date +%u)" # 7 = Sunday, which is the copy that is promoted to weekly
DAILY="$BACKUP_DIR/daily"
WEEKLY="$BACKUP_DIR/weekly"
mkdir -p "$DAILY" "$WEEKLY"

# The postgres client, wherever it lives. On a machine that has it (this Mac, or a VM with the
# matching client installed) the binary runs directly; otherwise it comes out of the same
# postgres:17-alpine image the database itself runs, which guarantees the versions match. Both
# branches run the SAME arguments against the SAME URL — only the way the binary is found differs.
pg() {
  local bin="$1"
  shift
  if command -v "$bin" >/dev/null 2>&1; then
    "$bin" "$@"
  else
    docker run --rm -i --network "$DOCKER_NETWORK" postgres:17-alpine "$bin" "$@"
  fi
}

DUMP="$DAILY/db-$STAMP.dump"
echo "$(date '+%F %T') dumping the database"
# Ownership and ACLs are KEPT on purpose. The migrations grant `app_rw` and `app_worker` their
# privileges, and every RLS policy is written `TO app_rw`: a dump taken with --no-acl would restore a
# database where the application's own role can read nothing.
pg pg_dump --format=custom --dbname "$DATABASE_URL" >"$DUMP"
test -s "$DUMP" || {
  echo "the dump is empty; refusing to rotate or report success" >&2
  exit 1
}

# The roles themselves are CLUSTER-wide, so they are not in the database dump. Without them a
# restore onto a fresh Postgres fails on the first GRANT to app_rw. `--globals-only` is small and
# costs nothing; restore.sh applies it before the dump.
GLOBALS="$DAILY/globals-$STAMP.sql"
pg pg_dumpall --globals-only --no-role-passwords --dbname "$DATABASE_URL" >"$GLOBALS"
test -s "$GLOBALS" || {
  echo "the globals dump is empty; the roles would not survive a restore" >&2
  exit 1
}

# The uploaded files: invoice and challan PDFs, POD photos, claim evidence, exports. On the VM they
# are a named volume, so tar reads them through a throwaway container; locally OBJECT_STORAGE_DIR is
# a real directory.
FILES="$DAILY/storage-$STAMP.tar.gz"
echo "$(date '+%F %T') archiving the object store"
if [ -d "$OBJECT_STORAGE_DIR" ]; then
  tar -czf "$FILES" -C "$OBJECT_STORAGE_DIR" .
else
  docker run --rm -v "$STORAGE_VOLUME":/data:ro -v "$DAILY":/out alpine:3 \
    tar -czf "/out/$(basename "$FILES")" -C /data .
fi
test -f "$FILES" || {
  echo "the object-store archive was not written" >&2
  exit 1
}

# Sunday's pair is also the week's. Copies, not moves: the daily rotation must not take the weekly.
if [ "$DOW" = "7" ]; then
  cp "$DUMP" "$WEEKLY/db-$STAMP.dump"
  cp "$GLOBALS" "$WEEKLY/globals-$STAMP.sql"
  cp "$FILES" "$WEEKLY/storage-$STAMP.tar.gz"
fi

# Rotation, newest first, by name — the stamp sorts chronologically. `find` and not `ls`: with
# `pipefail` an `ls` that matches nothing exits non-zero and would take the whole script down on the
# first night, before anything had ever been rotated.
rotate() {
  local dir="$1" pattern="$2" keep="$3" old
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    echo "  rotating out $old"
    rm -f "$old"
  done < <(find "$dir" -maxdepth 1 -type f -name "$pattern" | sort -r | tail -n "+$((keep + 1))")
}
rotate "$DAILY" "db-*.dump" "$BACKUP_KEEP_DAILY"
rotate "$DAILY" "globals-*.sql" "$BACKUP_KEEP_DAILY"
rotate "$DAILY" "storage-*.tar.gz" "$BACKUP_KEEP_DAILY"
rotate "$WEEKLY" "db-*.dump" "$BACKUP_KEEP_WEEKLY"
rotate "$WEEKLY" "globals-*.sql" "$BACKUP_KEEP_WEEKLY"
rotate "$WEEKLY" "storage-*.tar.gz" "$BACKUP_KEEP_WEEKLY"

# Off the box. Any S3-compatible endpoint: R2, S3 itself, Backblaze, MinIO. rclone if it is there,
# otherwise the aws CLI, otherwise the rclone image. If BACKUP_UPLOAD is on and none of the three can
# run, this FAILS — a backup that stayed on the box must never be reported as a backup.
if [ "$BACKUP_UPLOAD" = "1" ]; then
  : "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required unless BACKUP_UPLOAD=0}"
  : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required unless BACKUP_UPLOAD=0}"
  : "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is required unless BACKUP_UPLOAD=0}"
  : "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is required unless BACKUP_UPLOAD=0}"
  DEST="$BACKUP_S3_PREFIX/$(date +%Y/%m)"
  echo "$(date '+%F %T') uploading to $BACKUP_S3_BUCKET/$DEST"
  if command -v rclone >/dev/null 2>&1; then
    RCLONE_CONFIG_DOS_TYPE=s3 \
      RCLONE_CONFIG_DOS_PROVIDER=Other \
      RCLONE_CONFIG_DOS_ENDPOINT="$BACKUP_S3_ENDPOINT" \
      RCLONE_CONFIG_DOS_REGION="$BACKUP_S3_REGION" \
      RCLONE_CONFIG_DOS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      RCLONE_CONFIG_DOS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      rclone copy "$DUMP" "dos:$BACKUP_S3_BUCKET/$DEST"
    RCLONE_CONFIG_DOS_TYPE=s3 \
      RCLONE_CONFIG_DOS_PROVIDER=Other \
      RCLONE_CONFIG_DOS_ENDPOINT="$BACKUP_S3_ENDPOINT" \
      RCLONE_CONFIG_DOS_REGION="$BACKUP_S3_REGION" \
      RCLONE_CONFIG_DOS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      RCLONE_CONFIG_DOS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      rclone copy "$FILES" "dos:$BACKUP_S3_BUCKET/$DEST"
    RCLONE_CONFIG_DOS_TYPE=s3 \
      RCLONE_CONFIG_DOS_PROVIDER=Other \
      RCLONE_CONFIG_DOS_ENDPOINT="$BACKUP_S3_ENDPOINT" \
      RCLONE_CONFIG_DOS_REGION="$BACKUP_S3_REGION" \
      RCLONE_CONFIG_DOS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      RCLONE_CONFIG_DOS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      rclone copy "$GLOBALS" "dos:$BACKUP_S3_BUCKET/$DEST"
  elif command -v aws >/dev/null 2>&1; then
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$DUMP" "s3://$BACKUP_S3_BUCKET/$DEST/"
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$FILES" "s3://$BACKUP_S3_BUCKET/$DEST/"
    AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      AWS_DEFAULT_REGION="$BACKUP_S3_REGION" \
      aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$GLOBALS" "s3://$BACKUP_S3_BUCKET/$DEST/"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$DAILY":/backup:ro \
      -e RCLONE_CONFIG_DOS_TYPE=s3 \
      -e RCLONE_CONFIG_DOS_PROVIDER=Other \
      -e RCLONE_CONFIG_DOS_ENDPOINT="$BACKUP_S3_ENDPOINT" \
      -e RCLONE_CONFIG_DOS_REGION="$BACKUP_S3_REGION" \
      -e RCLONE_CONFIG_DOS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
      -e RCLONE_CONFIG_DOS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
      rclone/rclone:latest copy /backup "dos:$BACKUP_S3_BUCKET/$DEST" --include "*-$STAMP.*"
  else
    echo "no rclone, no aws and no docker: the backup is still ON THE BOX and that is not a backup" >&2
    exit 1
  fi
else
  echo "$(date '+%F %T') BACKUP_UPLOAD=0 — local copies only, nothing left the box"
fi

echo "dump: $DUMP"
echo "globals: $GLOBALS"
echo "files: $FILES"
echo "$(date '+%F %T') backup complete"
