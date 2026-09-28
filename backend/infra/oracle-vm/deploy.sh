#!/usr/bin/env bash
# Deploy the backend on this Mac's checkout to the Oracle VM: rsync, install, build, migrate every
# environment (live + demo), restart the two API services, prove the public /health.
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/deploy.sh
#
# The website is a separate publish (frontend/scripts/pages-deploy.sh dos) and the Android APK a
# separate build (docs/33). Migrations are expand-only (CLAUDE.md), so the old API keeps serving while
# they run; rollback = `git checkout <previous sha>` here and run this again.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
KEY="$HOME/.ssh/dos_oracle"; VM="ubuntu@92.4.84.106"
echo "== rsync backend → $VM:/opt/dos/backend ($(git -C "$REPO" rev-parse --short HEAD))"
rsync -az --delete -e "ssh -i $KEY" --exclude node_modules --exclude dist --exclude .turbo --exclude .env \
  --exclude '*.log' --exclude coverage "$REPO/backend/" "$VM:/opt/dos/backend/"
ssh -i "$KEY" "$VM" 'set -euo pipefail; export CI=1; cd /opt/dos/backend
echo "== install"; pnpm install --frozen-lockfile 2>&1 | tail -1
echo "== build"; pnpm exec turbo run build --filter=./libs/* >/dev/null; pnpm --filter @dos/worker build >/dev/null; pnpm --filter @dos/all-in-one build >/dev/null; echo "   built"
# REHEARSAL: the new migrations run first on a scratch restore of the latest nightly dump of the real
# database. A migration that would fail on the real data fails HERE, with the API still serving.
F=$(ls -t /var/backups/dos/daily/dos_live-*.dump 2>/dev/null | head -1)
if [ -n "$F" ]; then
  echo "== rehearse migrations on a restore of $(basename "$F")"
  sudo -u postgres psql -qc "drop database if exists dos_migrate_rehearsal" 2>/dev/null
  sudo -u postgres createdb -O dos dos_migrate_rehearsal
  sudo -u postgres pg_restore -d dos_migrate_rehearsal --no-owner --role=dos "$F" >/dev/null 2>&1 || true
  ( set -a; . /opt/dos/env/live.env; set +a; DATABASE_URL="${DATABASE_URL%/*}/dos_migrate_rehearsal" pnpm db:migrate 2>&1 | tail -1 )
  sudo -u postgres psql -qc "drop database dos_migrate_rehearsal"
fi
/opt/dos/backup-local.sh | tail -1                 # a dump of the real data as it is NOW, before it is migrated
for e in live demo; do [ -f /opt/dos/env/$e.env ] || continue; echo "== migrate $e"; ( set -a; . /opt/dos/env/$e.env; set +a; pnpm db:migrate 2>&1 | tail -1 ); done
echo "== restart"; sudo systemctl restart dos-api@live dos-api@demo
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/health | grep -q 200 && { echo "   live api up (:3100)"; break; }; sleep 2; done
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3200/health | grep -q 200 && { echo "   demo api up (:3200)"; break; }; sleep 2; done'
curl -s -m 10 -o /dev/null -w 'public https://api.distributionos.in/health → %{http_code}\n' https://api.distributionos.in/health
