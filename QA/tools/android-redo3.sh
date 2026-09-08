#!/bin/bash
cd "$(dirname "$0")"
until grep -q ALL_DONE /private/tmp/claude-501/-Users-prajwalchavan-Desktop-Distribution-OS/bdc392e9-21d1-4d15-9ffa-7a88c7db4de9/logs/android-redo2.log; do sleep 10; done
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
for spec in "retailer 5178 ramesh.gupta Retailer" "admin 5179 dos.admin console"; do
  set -- $spec; echo "=== $1 ==="
  ./android-login-b.sh $1 $2 $3 $4 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^(SIGNED_IN|STILL_ON_SIGN_IN|NO_SIGN_IN_FORM|BUNDLE_MISMATCH|PROXY_DOWN|INSTALL FAILED)" | cut -c1-240
done
echo ALL_DONE
