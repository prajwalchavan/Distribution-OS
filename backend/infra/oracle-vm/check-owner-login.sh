#!/usr/bin/env bash
# Does the saved owner password open the live site? Run by the founder. Prints the answer's status and whether a
# change of password is asked for; never the password, never the token.
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/check-owner-login.sh
set -euo pipefail
F="$HOME/.config/dos/live-owner-password.txt"
U="${FILL_OWNER:-owner.tarsun}"
API="${DOS_API:-https://api.distributionos.in}"
[ -s "$F" ] || { echo "no password saved in $F"; exit 1; }
python3 - "$U" "$F" "$API" <<'PY'
import json, sys, urllib.request, urllib.error, uuid
user, path, api = sys.argv[1], sys.argv[2], sys.argv[3]
pw = next((l.strip() for l in open(path, encoding="utf-8") if l.strip()), "")
if len(pw) < 8:
    print("the saved password is shorter than 8 characters: not sent"); sys.exit(1)
body = json.dumps({"username": user, "password": pw, "deviceId": str(uuid.uuid5(uuid.NAMESPACE_URL, "dos:check-owner-login")),
                   "deviceName": "founder's check", "platform": "web"}).encode()
req = urllib.request.Request(api + "/auth/auth/login", data=body, headers={"content-type": "application/json", "user-agent": "dos-check/1.0"})  # the site's front door refuses Python's own name (403, error 1010)
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        b = json.loads(r.read() or b"{}")
        must = (b.get("user") or {}).get("mustChangePassword")
        print(f"sign-in as {user}: {r.status} OK, role {b.get('role')}, must change password: {must}")
        sys.exit(0 if not must else 3)
except urllib.error.HTTPError as e:
    raw = e.read()[:400]
    try:
        code = json.loads(raw).get("code")
        who = f"the API said {code}"
    except Exception:
        who = "NOT the API: the site's front door answered (the password was not tested)"
    print(f"sign-in as {user}: {e.code} REFUSED, {who} (401 = wrong username or password, 423 = locked for 15 minutes after 5 wrong tries)")
    sys.exit(2)
PY
