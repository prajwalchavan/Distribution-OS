#!/usr/bin/env bash
# Make the demo on the Oracle VM safe to hand to testers (docs/22 §8, 2026-09-28; docs/34).
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/demo-setup.sh
#
# Run on this Mac, by the founder: it copies itself to the VM and runs there. Safe to run again.
# It never reads or writes a row of dos_live. What it changes on the VM:
#
#   1. a database login of its own for the demo (`dos_demo`: no superuser, cannot create roles or
#      databases) and CONNECT on every other database taken away from it — the demo API can no longer
#      open dos_live at all;
#   2. sign-in keys, file-link secret and file folder of its own in /opt/dos/env/demo.env — until now
#      they were the live ones, so a token issued by the demo was valid on the live API;
#   3. one tester password for every demo login, generated here, replacing the one printed in the
#      public repository;
#   4. /opt/dos/demo-rebuild.sh and a cron line: every night at 03:00 IST the demo is dropped, migrated
#      and seeded again, so testers start each day from the same dummy data dated "today";
#   5. one rebuild now, then proofs printed as PASS / FAIL.
#
# No secret is printed. The tester password is copied to ~/.config/dos/demo-login.txt on this Mac.
# ROTATE=1 makes new keys and a new tester password even when the demo already has its own.
set -euo pipefail

E="${DOS_ENV_DIR:-/opt/dos/env}"
B="${DOS_BACKEND_DIR:-/opt/dos/backend}"
ROLE="${DEMO_DB_ROLE:-dos_demo}"
DB="${DEMO_DB:-dos_demo}"
STORAGE="${DEMO_STORAGE_DIR:-/opt/dos/storage-demo}"
PUBLIC_API="${DEMO_PUBLIC_API:-https://demo-api.distributionos.in}"
CORS="${DEMO_CORS_ORIGINS:-https://demo.distributionos.in}"
REBUILD="${DEMO_REBUILD_SCRIPT:-/opt/dos/demo-rebuild.sh}"
BACKUPS="${DOS_BACKUP_DIR:-/var/backups/dos}"
LIVE_DB="${DOS_LIVE_DB:-dos_live}"
LIVE_PORT="${DOS_LIVE_PORT:-3100}"
DEMO_PORT="${DOS_DEMO_PORT:-3200}"

say() { echo "== $*"; }
die() {
  echo "STOPPED: $*" >&2
  exit 1
}
rand() { head -c 192 /dev/urandom | base64 | LC_ALL=C tr -dc "$1" | head -c "$2"; }
# The value of KEY in an env file, without printing it.
val() { sed -n "s/^$2=//p" "$1" | head -1; }
# A short fingerprint of a value, so two secrets can be compared without showing either.
mark() { printf '%s' "$1" | sha256sum | cut -c1-12; }

# Rewrites demo.env in place (mode 600, atomically). Values arrive in the environment, never in argv.
rewrite_env() {
  DEMO_ENV_FILE="$E/demo.env" python3 - <<'PY'
import os, re

path = os.environ["DEMO_ENV_FILE"]
text = open(path).read()


def put(key, value):
    global text
    line = key + "=" + value
    pattern = r"^" + re.escape(key) + r"=.*$"
    if re.search(pattern, text, flags=re.M):
        text = re.sub(pattern, lambda _m: line, text, flags=re.M)
    else:
        text = text.rstrip("\n") + "\n" + line + "\n"


url = re.search(r"^DATABASE_URL=(.*)$", text, flags=re.M)
if not url:
    raise SystemExit("demo.env has no DATABASE_URL")
parts = re.match(r"^(postgres(?:ql)?://)[^@/]*@([^/]+)/.*$", url.group(1))
if not parts:
    raise SystemExit("demo.env DATABASE_URL is not postgres://user:password@host:port/database")
put(
    "DATABASE_URL",
    parts.group(1) + os.environ["NEW_ROLE"] + ":" + os.environ["NEW_DBPW"] + "@" + parts.group(2) + "/" + os.environ["NEW_DB"],
)
for key, name in (
    ("AUTH_JWT_PRIVATE_KEY", "NEW_PRIV"),
    ("AUTH_JWT_PUBLIC_KEY", "NEW_PUB"),
    ("OBJECT_STORAGE_SIGNING_SECRET", "NEW_SIGN"),
):
    if os.environ.get(name):
        put(key, os.environ[name])
put("OBJECT_STORAGE_DIR", os.environ["NEW_STORAGE"])
put("OBJECT_STORAGE_PUBLIC_URL", os.environ["NEW_PUBLIC_API"])
put("CORS_ORIGINS", os.environ["NEW_CORS"])

tmp = path + ".new"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as out:
    out.write(text)
os.replace(tmp, path)
PY
  chmod 600 "$E/demo.env"
}

# A UUIDv7 for the sign-in's deviceId (the contract insists on one).
uuid7() {
  python3 - <<'PY'
import os, time, uuid

b = bytearray(int(time.time() * 1000).to_bytes(6, "big") + os.urandom(10))
b[6] = (b[6] & 0x0F) | 0x70
b[8] = (b[8] & 0x3F) | 0x80
print(uuid.UUID(bytes=bytes(b)))
PY
}

# Signs in on the demo API; prints "<http status> <access token or ->". The password comes from the
# environment (SIGNIN_PW) and reaches curl on stdin.
signin() {
  local port="$1" user="$2" body out code
  body=$(SIGNIN_USER="$user" SIGNIN_DEVICE="$(uuid7)" python3 -c '
import json, os
print(json.dumps({"username": os.environ["SIGNIN_USER"], "password": os.environ["SIGNIN_PW"],
                  "deviceId": os.environ["SIGNIN_DEVICE"], "deviceName": "demo-setup check", "platform": "web"}))')
  out=$(printf '%s' "$body" | curl -s -m 20 -w '\n%{http_code}' -H 'content-type: application/json' \
    --data-binary @- "http://127.0.0.1:$port/auth/auth/login" || true)
  code=$(printf '%s' "$out" | tail -1)
  printf '%s ' "${code:-000}"
  printf '%s' "$out" | sed '$d' | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("accessToken") or "-")
except Exception:
    print("-")'
}

PASSES=0
FAILS=0
proof() { # proof <ok|bad> <sentence>
  if [ "$1" = ok ]; then
    PASSES=$((PASSES + 1))
    echo "  PASS  $2"
  else
    FAILS=$((FAILS + 1))
    echo "  FAIL  $2"
  fi
}

write_rebuild_script() {
  local pnpm_dir node_dir
  pnpm_dir="$(dirname "$(command -v pnpm)")"
  node_dir="$(dirname "$(command -v node)")"
  sudo tee "$REBUILD" >/dev/null <<SH
#!/usr/bin/env bash
# Written by backend/infra/oracle-vm/demo-setup.sh. Rebuilds the DEMO from nothing: drop, create,
# migrate, seed, tester password, empty file folder, restart. Dummy data only; never touches dos_live.
set -euo pipefail
export CI=1 PATH="$pnpm_dir:$node_dir:\$PATH"
echo "-- demo rebuild \$(date '+%F %T %Z')"
set -a; . "$E/demo.env"; set +a
case "\$DATABASE_URL" in
  *://$ROLE:*@*/$DB) ;;
  *) echo "demo.env does not point at database $DB as login $ROLE; nothing was touched"; exit 1 ;;
esac
case "\$OBJECT_STORAGE_DIR" in
  "$STORAGE") ;;
  *) echo "demo.env does not keep its files in $STORAGE; nothing was touched"; exit 1 ;;
esac
sudo systemctl stop dos-api@demo
# Whatever happens below, the demo API is started again, so a failed night leaves a log line and not a dead link.
trap 'rc=\$?; if [ "\$rc" != 0 ]; then echo "demo rebuild FAILED (exit \$rc)"; sudo systemctl start dos-api@demo || true; fi' EXIT
sudo -u postgres psql -v ON_ERROR_STOP=1 -qc 'DROP DATABASE IF EXISTS "$DB" WITH (FORCE)'
sudo -u postgres createdb -O "$ROLE" "$DB"
cd "$B"
pnpm db:migrate 2>&1 | tail -1
NODE_ENV=development pnpm db:seed >"$BACKUPS/demo-seed.log" 2>&1 || { tail -20 "$BACKUPS/demo-seed.log"; echo "seed failed"; exit 1; }
HASH=\$(cd "$B/libs/database" && DEMO_LOGIN_PW="\$(cat "$E/demo-login.pw")" node --input-type=module \\
  -e "import { hashPassword } from './dist/index.js'; process.stdout.write(await hashPassword(process.env.DEMO_LOGIN_PW))")
psql "\$DATABASE_URL" -v ON_ERROR_STOP=1 -v h="\$HASH" -qtA <<'SQL'
UPDATE users SET password_hash = :'h' WHERE password_hash IS NOT NULL;
SQL
mkdir -p "$STORAGE"
find "$STORAGE" -mindepth 1 -delete
sudo systemctl start dos-api@demo
for i in \$(seq 1 60); do
  curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$DEMO_PORT/health" | grep -q 200 && { echo "demo api up (:$DEMO_PORT)"; exit 0; }
  sleep 2
done
echo "demo api did not answer /health"; exit 1
SH
  sudo chown ubuntu:ubuntu "$REBUILD"
  chmod 755 "$REBUILD"
}

vm_main() {
  export CI=1
  [ -f "$E/live.env" ] && [ -f "$E/demo.env" ] || die "this is not the VM ($E/live.env and demo.env are expected)"
  [ -f "$B/all-in-one/dist/main.js" ] || die "the backend is not built on the VM; run deploy.sh first"
  [ -f "$B/libs/database/dist/index.js" ] || die "@dos/db is not built on the VM; run deploy.sh first"
  sudo -n true 2>/dev/null || die "sudo asks for a password here"
  command -v pnpm >/dev/null && command -v node >/dev/null && command -v psql >/dev/null || die "pnpm, node or psql is missing"

  say "1/5 database login $ROLE"
  [ -s "$E/demo-db.pw" ] || rand 'A-Za-z0-9' 32 >"$E/demo-db.pw"
  chmod 600 "$E/demo-db.pw"
  DBPW="$(cat "$E/demo-db.pw")"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN CREATE ROLE "$ROLE" LOGIN; END IF;
END \$\$;
ALTER ROLE "$ROLE" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS PASSWORD '$DBPW';
GRANT app_rw, app_worker TO "$ROLE" WITH ADMIN OPTION;
SQL
  for db in $(sudo -u postgres psql -qtAc "select datname from pg_database where not datistemplate and datname not in ('$DB', 'postgres')"); do
    sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "REVOKE CONNECT ON DATABASE \"$db\" FROM PUBLIC" -c "GRANT CONNECT ON DATABASE \"$db\" TO dos"
    echo "   $db: closed to every login but dos"
  done

  say "2/5 keys, file secret and file folder of its own"
  NEW_PRIV="" NEW_PUB="" NEW_SIGN=""
  if [ "${ROTATE:-0}" = 1 ] || [ "$(val "$E/demo.env" AUTH_JWT_PUBLIC_KEY)" = "$(val "$E/live.env" AUTH_JWT_PUBLIC_KEY)" ]; then
    KEYS="$(cd "$B" && ./node_modules/.bin/tsx tools/auth-keygen.mts)"
    NEW_PRIV="$(printf '%s\n' "$KEYS" | sed -n 's/^AUTH_JWT_PRIVATE_KEY=//p')"
    NEW_PUB="$(printf '%s\n' "$KEYS" | sed -n 's/^AUTH_JWT_PUBLIC_KEY=//p')"
    [ -n "$NEW_PRIV" ] && [ -n "$NEW_PUB" ] || die "the key generator printed nothing"
    echo "   new sign-in keys"
  else
    echo "   sign-in keys are already the demo's own; kept"
  fi
  if [ "${ROTATE:-0}" = 1 ] || [ "$(val "$E/demo.env" OBJECT_STORAGE_SIGNING_SECRET)" = "$(val "$E/live.env" OBJECT_STORAGE_SIGNING_SECRET)" ]; then
    NEW_SIGN="$(rand 'A-Za-z0-9' 48)"
    echo "   new file-link secret"
  else
    echo "   file-link secret is already the demo's own; kept"
  fi
  mkdir -p "$STORAGE"
  chmod 700 "$STORAGE"
  NEW_ROLE="$ROLE" NEW_DB="$DB" NEW_DBPW="$DBPW" NEW_PRIV="$NEW_PRIV" NEW_PUB="$NEW_PUB" NEW_SIGN="$NEW_SIGN" \
    NEW_STORAGE="$STORAGE" NEW_PUBLIC_API="$PUBLIC_API" NEW_CORS="$CORS" rewrite_env

  say "3/5 tester password"
  if [ "${ROTATE:-0}" = 1 ] || [ ! -s "$E/demo-login.pw" ]; then
    printf 'Demo@%s%s\n' "$(rand 'abcdefghjkmnpqrstuvwxyz' 4)" "$(rand '23456789' 4)" >"$E/demo-login.pw"
    echo "   new tester password (in $E/demo-login.pw)"
  else
    echo "   kept"
  fi
  chmod 600 "$E/demo-login.pw"

  say "4/5 nightly rebuild at 03:00 IST"
  write_rebuild_script
  (
    crontab -l 2>/dev/null | grep -v 'demo-rebuild.sh' || true
    echo "30 21 * * * $REBUILD >> $BACKUPS/demo-rebuild.log 2>&1"
  ) | crontab -

  say "5/5 rebuild now (the old demo database is dumped first)"
  if sudo -u postgres psql -qtAc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
    sudo -u postgres pg_dump -Fc "$DB" >"$BACKUPS/daily/$DB-before-rebuild-$(date +%F-%H%M).dump"
  fi
  "$REBUILD" 2>&1 | sed 's/^/   /'

  say "proofs"
  local same=0 k out code token
  for k in AUTH_JWT_PRIVATE_KEY AUTH_JWT_PUBLIC_KEY OBJECT_STORAGE_SIGNING_SECRET; do
    [ "$(mark "$(val "$E/demo.env" $k)")" = "$(mark "$(val "$E/live.env" $k)")" ] && same=$((same + 1))
  done
  [ "$same" = 0 ] && proof ok "the demo shares no sign-in key and no file secret with live" || proof bad "$same of 3 secrets are still the same as live's"

  [ "$(val "$E/demo.env" OBJECT_STORAGE_DIR)" != "$(val "$E/live.env" OBJECT_STORAGE_DIR)" ] &&
    proof ok "the demo keeps its files in its own folder" || proof bad "the demo writes files into the live folder"

  out="$(PGPASSWORD="$DBPW" psql -h 127.0.0.1 -U "$ROLE" -d "$LIVE_DB" -qtAc 'select 1' 2>&1 || true)"
  case "$out" in
    *"CONNECT privilege"*) proof ok "the demo's database login is refused by $LIVE_DB" ;;
    *) proof bad "the demo's database login was NOT refused by $LIVE_DB" ;;
  esac

  out="$(SIGNIN_PW="$(cat "$E/demo-login.pw")" signin "$DEMO_PORT" pilot.owner)"
  code="${out%% *}"
  token="${out#* }"
  [ "$code" = 200 ] && [ "$token" != "-" ] && proof ok "pilot.owner signs in on the demo with the tester password" ||
    proof bad "pilot.owner could not sign in on the demo with the tester password (HTTP $code)"

  code="$(SIGNIN_PW='Dos@1234' signin "$DEMO_PORT" pilot.owner)"
  code="${code%% *}"
  [ "$code" = 401 ] && proof ok "the password printed in the repository is refused on the demo" ||
    proof bad "the password printed in the repository still works on the demo (HTTP $code)"

  if [ "$token" != "-" ]; then
    code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' -H "authorization: Bearer $token" "http://127.0.0.1:$LIVE_PORT/auth/auth/me" || true)"
    [ "$code" = 401 ] && proof ok "a demo token is refused by the live API" ||
      proof bad "a demo token was answered $code by the live API"
  fi

  code="$(curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$LIVE_PORT/health" || true)"
  [ "$code" = 200 ] && proof ok "the live API was not disturbed (/health 200)" || proof bad "live /health answers $code"

  echo
  echo "$PASSES passed, $FAILS failed"
  [ "$FAILS" = 0 ]
}

mac_main() {
  local key="$HOME/.ssh/dos_oracle" vm="ubuntu@92.4.84.106" out="$HOME/.config/dos/demo-login.txt" rc=0
  [ -f "$key" ] || die "no SSH key at $key"
  scp -q -i "$key" "${BASH_SOURCE[0]}" "$vm:/opt/dos/demo-setup.sh"
  ssh -i "$key" "$vm" "ROTATE='${ROTATE:-0}' bash /opt/dos/demo-setup.sh vm" || rc=$?
  mkdir -p "$(dirname "$out")"
  (
    umask 077
    ssh -i "$key" "$vm" 'cat /opt/dos/env/demo-login.pw 2>/dev/null' >"$out.new" || true
  )
  echo
  if [ -s "$out.new" ]; then
    mv "$out.new" "$out"
    echo "tester password: saved in $out (not shown here)"
  else
    rm -f "$out.new"
    echo "tester password: none yet (the run stopped before it was made)"
  fi
  [ "$rc" = 0 ] && echo "done — tell Claude" || echo "one or more steps FAILED — tell Claude, paste the lines above"
  return "$rc"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "${1:-}" = vm ]; then vm_main; else mac_main; fi
fi
