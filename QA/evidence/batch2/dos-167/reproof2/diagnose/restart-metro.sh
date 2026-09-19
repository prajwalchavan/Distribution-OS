#!/bin/bash
D="/Users/prajwalchavan/Desktop/Distribution OS/QA/evidence/batch2/dos-167/reproof2/diagnose"
lsof -ti:5175 | xargs -r kill -9 2>/dev/null
pkill -f "sales-app" 2>/dev/null
sleep 3
cd "/Users/prajwalchavan/Desktop/Distribution OS/.claude/worktrees/b2-dos167r3/frontend"
CI=1 nohup pnpm --filter @dos/sales-app web -- --port 5175 --clear > "$D/metro-5175.log" 2>&1 &
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5175/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
# force a bundle build and report whether the variant marker is in it
curl -s "http://localhost:5175/index.bundle?platform=web&dev=true" -o /tmp/dos-bundle.js
echo "bundle bytes: $(wc -c < /tmp/dos-bundle.js)  variantMarkers: $(grep -c 'DOSDIAG variant' /tmp/dos-bundle.js)  serializeMarker: $(grep -c 'openStoreInner' /tmp/dos-bundle.js)"
