#!/bin/bash
# Starts the eight backend services in the background (DATABASE_URL from backend/.env unless overridden). Logs: $QA_LOGS/logs.
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; S=${QA_LOGS:-$HOME/.dos-qa-logs}; mkdir -p "$S/logs"
cd "$ROOT/backend"
for svc in auth owner manager sales warehouse delivery retailer admin; do
  nohup pnpm --filter @dos/$svc-service dev > "$S/logs/$svc-service.log" 2>&1 &
done
nohup pnpm --filter @dos/worker dev > "$S/logs/worker.log" 2>&1 &
echo "started 8 services + worker; logs in $S/logs"
