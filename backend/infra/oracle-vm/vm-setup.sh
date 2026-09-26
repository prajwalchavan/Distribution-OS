#!/usr/bin/env bash
# Runs ON the Oracle VM. Native (no Docker): Postgres 17 + Node 24 + systemd + cloudflared.
set -euo pipefail
export CI=1
B=/opt/dos/backend
sudo mkdir -p /var/backups/dos && sudo chown ubuntu:ubuntu /var/backups/dos; mkdir -p /opt/dos/env /opt/dos/storage
PW=$(head -c 192 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 32)
sudo -u postgres psql -qtAc "select 1 from pg_roles where rolname='dos'" | grep -q 1 || sudo -u postgres psql -qc "create role dos superuser login password '$PW'"
# a stored password is only ever written once, into the env file below
if [ ! -s /opt/dos/env/db.pw ]; then echo "$PW" > /opt/dos/env/db.pw; sudo -u postgres psql -qc "alter role dos password '$PW'"; fi
PW=$(cat /opt/dos/env/db.pw); chmod 600 /opt/dos/env/db.pw
sudo -u postgres psql -qtAc "select 1 from pg_database where datname='dos_demo'" | grep -q 1 || sudo -u postgres createdb -O dos dos_demo
KEYS=$(cd $B && ./node_modules/.bin/tsx tools/auth-keygen.mts)
PRIV=$(printf '%s\n' "$KEYS" | sed -n 's/^AUTH_JWT_PRIVATE_KEY=//p'); PUB=$(printf '%s\n' "$KEYS" | sed -n 's/^AUTH_JWT_PUBLIC_KEY=//p')
SIGN=$(head -c 192 /dev/urandom | base64 | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 48)
if [ ! -e /opt/dos/env/demo.env ]; then
cat > /opt/dos/env/demo.env <<ENV
NODE_ENV=production
TZ=Asia/Kolkata
DATABASE_URL=postgres://dos:$PW@127.0.0.1:5432/dos_demo
DATABASE_POOL_MAX=8
APP_DB_ROLE=app_rw
DOS_MODE=all
WORKER_INLINE=1
ALL_IN_ONE_PORT=3100
HEALTH_PORT=3100
AUTH_JWT_PRIVATE_KEY=$PRIV
AUTH_JWT_PUBLIC_KEY=$PUB
AUTH_ACCESS_TTL_SECONDS=900
AUTH_REFRESH_TTL_DAYS=30
CORS_ORIGINS=https://www.distributionos.in,https://distributionos.in,https://dos-7ij.pages.dev
OBJECT_STORAGE_DRIVER=local
OBJECT_STORAGE_DIR=/opt/dos/storage
OBJECT_STORAGE_URL_TTL_SECONDS=900
OBJECT_STORAGE_SIGNING_SECRET=$SIGN
OBJECT_STORAGE_PUBLIC_URL=https://api.distributionos.in
DOCINT_ENGINE=stub
ANTHROPIC_API_KEY=
DOCINT_INLINE_JOBS=0
OUTBOX_MAX_ATTEMPTS=8
ENV
chmod 600 /opt/dos/env/demo.env
fi
set -a; . /opt/dos/env/demo.env; set +a
cd $B
echo "== migrate"; pnpm db:migrate 2>&1 | tail -3
echo "== seed (demo database only)"; NODE_ENV=development pnpm db:seed 2>&1 | tail -3
sudo tee /etc/systemd/system/dos-api@.service >/dev/null <<UNIT
[Unit]
Description=Distribution OS API (%i)
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
User=ubuntu
WorkingDirectory=/opt/dos/backend/all-in-one
EnvironmentFile=/opt/dos/env/%i.env
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3
MemoryMax=6G
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now dos-api@demo
for i in $(seq 1 40); do curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/health | grep -q 200 && { echo "api up"; break; }; sleep 2; done
curl -s http://127.0.0.1:3100/health | head -c 200; echo
