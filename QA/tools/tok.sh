#!/bin/bash
# Re-mint 15-minute access tokens for the QA probe accounts into the scratchpad ($1 = scratchpad dir). Console accounts use /auth/platform/login.
SP=$1; uu() { uuidgen | tr A-Z a-z; }
for u in dos.admin dos.support; do curl -s -X POST http://127.0.0.1:3000/auth/platform/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"Dos@1234\",\"deviceId\":\"$(uu)\",\"deviceName\":\"QA curl admin\",\"platform\":\"web\"}" > $SP/tok-$u.json; done
for u in sunil.tarsun prakash.salunkhe; do curl -s -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d "{\"username\":\"$u\",\"password\":\"Dos@1234\",\"deviceId\":\"$(uu)\",\"deviceName\":\"QA curl owner\",\"platform\":\"web\"}" > $SP/tok-$u.json; done
for f in $SP/tok-*.json; do printf '%s: %s\n' "$(basename $f)" "$(python3 -c "import json;d=json.load(open('$f'));print('ok' if d.get('accessToken') else d.get('message'))")"; done
