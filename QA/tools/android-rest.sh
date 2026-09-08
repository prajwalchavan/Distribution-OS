#!/bin/bash
cd "$(dirname "$0")"
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
export ANDROID_HOME=$HOME/Library/Android/sdk; export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb reverse --remove-all >/dev/null 2>&1
for spec in "manager 5174 vikas.kadam Manager" "warehouse 5176 dinesh.patil Warehouse" "delivery 5177 ganesh.more Delivery" "retailer 5178 ramesh.gupta Retailer" "admin 5179 dos.admin Admin"; do
  set -- $spec; echo "=== $1 ==="
  ./android-login.sh $1 $2 $3 $4 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^(SIGNED_IN|STILL_ON_SIGN_IN|NO_SIGN_IN_FORM|BUNDLE_MISMATCH|PROXY_DOWN|INSTALL FAILED)" | cut -c1-240
done
echo ALL_DONE
