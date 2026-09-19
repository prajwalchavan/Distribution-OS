#!/bin/bash
# DOS-167 ruling-3 re-proof (web). Restart the sales Metro on :5175 from the MAIN checkout with --clear.
# usage: restart-metro.sh <log-suffix>
D="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/reproof2/web"
SUF=${1:-run}
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
lsof -ti:5175 | xargs kill -9 2>/dev/null
pkill -f "sales-app" 2>/dev/null
sleep 3
cd "/Users/prajwalchavan/Desktop/Distribution OS/frontend"
CI=1 nohup pnpm --filter @dos/sales-app web -- --port 5175 --clear > "$D/metro-5175-$SUF.log" 2>&1 &
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -m 3 -w "%{http_code}" http://localhost:5175/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "metro http=$code"
