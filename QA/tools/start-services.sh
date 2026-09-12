#!/bin/bash
# Starts the eight backend services in the background (DATABASE_URL from backend/.env unless overridden). Logs: $QA_LOGS/logs.
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
# QA runs against the fresh realistic seed in dos_qa (2026-09-12); override with DATABASE_URL=... to use another database
export DATABASE_URL=${DATABASE_URL:-postgres://dos:dos@127.0.0.1:5439/dos_qa}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S=${QA_LOGS:-$HOME/.dos-qa-logs}; mkdir -p "$S/logs"
cd "$ROOT/backend"
for svc in auth owner manager sales warehouse delivery retailer admin; do
  nohup pnpm --filter @dos/$svc-service dev > "$S/logs/$svc-service.log" 2>&1 &
done
nohup pnpm --filter @dos/worker dev > "$S/logs/worker.log" 2>&1 &
echo "started 8 services + worker; logs in $S/logs"
