#!/bin/bash
# Starts the worker and the seven Expo web servers in the background. The eight services are started separately (ENV.md §3).
# Logs go to $QA_LOGS/logs (default ~/.dos-qa-logs/logs).
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
S=${QA_LOGS:-$HOME/.dos-qa-logs}; mkdir -p "$S/logs"
cd "$ROOT/backend" && nohup pnpm --filter @dos/worker dev > "$S/logs/worker.log" 2>&1 &
cd "$ROOT/frontend"
for app in owner manager sales warehouse delivery retailer admin; do
  CI=1 nohup pnpm --filter @dos/$app-app web > "$S/logs/$app-app.log" 2>&1 &
done
echo "started worker + 7 web servers; logs in $S/logs"
