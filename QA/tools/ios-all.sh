#!/bin/bash
cd "$(dirname "$0")"; export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
curl -s localhost:4723/status | grep -q '"ready":true' || { nohup npx appium --port 4723 --log-level info > ~/.dos-qa-logs/logs/appium.log 2>&1 & sleep 6; }
for spec in "5178 ramesh.gupta retailer Retailer"; do
  set -- $spec; node ios-login.mjs $1 $2 $3 $4 2>&1 | grep -E "^(SIGNED_IN|STILL_ON_SIGN_IN|Error)" | cut -c1-200
done
echo ALL_DONE
