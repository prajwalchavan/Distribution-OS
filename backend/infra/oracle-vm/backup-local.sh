#!/usr/bin/env bash
# Nightly local dump of every dos_* database + cluster globals; keeps 7 days. Off-box copy (R2) comes next.
set -euo pipefail
D=/var/backups/dos/daily; mkdir -p $D; S=$(date +%F-%H%M)
for db in $(sudo -u postgres psql -qtAc "select datname from pg_database where datname like 'dos_%'"); do
  sudo -u postgres pg_dump -Fc "$db" > "$D/$db-$S.dump"
done
sudo -u postgres pg_dumpall --globals-only > "$D/globals-$S.sql"
find $D -type f -mtime +7 -delete
echo "backup complete $S"
