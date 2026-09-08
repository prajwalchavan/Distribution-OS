#!/bin/bash
# Runs android-login.sh for every app in sequence (one Metro proxy on :8081 at a time). Output: one status line per app.
cd "$(dirname "$0")"
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null
for spec in "owner 5173 sunil.tarsun" "manager 5174 vikas.kadam" "warehouse 5176 dinesh.patil" "delivery 5177 ganesh.more" "retailer 5178 ramesh.gupta" "admin 5179 dos.admin"; do
  set -- $spec
  ./android-login.sh $1 $2 $3 2>&1 | grep -E "^(SIGNED_IN|STILL_ON_SIGN_IN|NO_SIGN_IN_FORM|INSTALL FAILED)" | cut -c1-260
done
echo ALL_DONE
