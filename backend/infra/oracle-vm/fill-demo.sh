#!/usr/bin/env bash
# Dummy activity on top of the real master data, every night (docs/22 §8, 2026-09-28; brief
# docs/plans/demo-activity-fill.md). One site, one database: the tool `pnpm fill:demo` drives the running
# API as the people who would do each step, and every row it makes is marked.
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/fill-demo.sh
#
# Run on this Mac, by the founder: it copies itself to the VM and runs there. Safe to run again (the tool
# writes nothing twice for the same day). What it does on the VM:
#
#   1. refuses to start unless the backend is built, the real API answers /health, the owner's password
#      file is there, and no message channel (WhatsApp, SMS) is switched on — dummy deliveries would
#      message real shopkeepers (QA DOS-401);
#   2. REHEARSES: a fresh dump of dos_live, restored into a scratch database dos_fill_rehearsal (closed to
#      every login but dos), a second API on a spare port over it (the real environment file with the
#      database, the two ports and the file folder swapped), the tool with --commit and the three checks
#      there, with a throw-away logins file; then that API is stopped and the scratch database dropped. Any
#      failure stops everything before the real database is touched;
#   3. runs the tool with --commit against the real API (127.0.0.1:3100) as owner.tarsun, with the tester
#      logins in /opt/dos/env/tester-logins.txt (mode 600), then the three checks;
#   4. writes /opt/dos/fill-demo-nightly.sh and the cron line `30 0 * * *` (06:00 IST), log in
#      /var/backups/dos/fill-demo.log;
#   5. prints PASS / FAIL lines.
#
# The Mac half then copies the logins file to ~/.config/dos/tester-logins.txt (mode 600) and prints only
# its path. No password, no shop's name, phone or address is printed anywhere: the tool and the checks
# print counts and ids. When the VM has no /opt/dos/env/live-owner.pw yet, the Mac half sends it from
# ~/.config/dos/live-owner-password.txt over ssh (stdin, mode 600), never through the screen.
set -euo pipefail

E="${DOS_ENV_DIR:-/opt/dos/env}"
B="${DOS_BACKEND_DIR:-/opt/dos/backend}"
BACKUPS="${DOS_BACKUP_DIR:-/var/backups/dos}"
LIVE_ENV="${DOS_LIVE_ENV:-$E/live.env}"
LIVE_DB="${DOS_LIVE_DB:-dos_live}"
LIVE_PORT="${DOS_LIVE_PORT:-3100}"
REHEARSAL_DB="${FILL_REHEARSAL_DB:-dos_fill_rehearsal}"
REHEARSAL_PORT="${FILL_REHEARSAL_PORT:-3300}"
REHEARSAL_STORAGE="${FILL_REHEARSAL_STORAGE:-$BACKUPS/fill-rehearsal-storage}"
TENANT="${FILL_TENANT:-tarsun}"
OWNER="${FILL_OWNER:-owner.tarsun}"
OWNER_PW="${FILL_OWNER_PW:-$E/live-owner.pw}"
LOGINS="${FILL_LOGINS:-$E/tester-logins.txt}"
NIGHTLY="${FILL_NIGHTLY_SCRIPT:-/opt/dos/fill-demo-nightly.sh}"
LOG="${FILL_LOG:-$BACKUPS/fill-demo.log}"
CRON_WHEN="${FILL_CRON_WHEN:-30 0 * * *}"

say() { echo "== $*"; }
die() {
  echo "STOPPED: $*" >&2
  exit 1
}
# The value of KEY in an env file, without printing it.
val() { sed -n "s/^$2=//p" "$1" | head -1; }

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

health() { curl -s -m 10 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$1/health" 2>/dev/null || true; }
# The last line a script printed itself (pnpm's own "Command failed" line left out).
last() { grep -v -E 'ELIFECYCLE|^\s*$' "$1" | tail -1 || true; }

# The tool and the checks against one API and one database. Output goes to "$2" (counts and ids only);
# the summary lines are shown. The four exit codes land in "$2.codes" as "fill coverage rows cancels".
fill_and_check() { # fill_and_check <port> <log file> <database url> <logins file> <label>
  local port="$1" out="$2" url="$3" logins="$4" label="$5" fill=0 cov=0 rows=0 cancels=0
  # What the database held before, so the marker check proves THIS run's rows against its report.
  (cd "$B" && DATABASE_URL="$url" pnpm -s check:demo-rows --tenant "$TENANT" --json "$out.before.json") >/dev/null 2>&1 || true
  (
    cd "$B"
    pnpm -s fill:demo --api "http://127.0.0.1:$port" --tenant "$TENANT" --owner-username "$OWNER" \
      --owner-password-file "$OWNER_PW" --logins-file "$logins" --commit --report "$out.run.json"
  ) >"$out" 2>&1 || fill=$?
  grep -E '^(rows written|the brief|  (shopkeeper|sales|manager|godown|driver|accountant|owner) )' "$out" |
    sed "s/^/   [$label] /" || true
  [ "$fill" = 0 ] || last "$out" | sed "s/^/   [$label] fill: /"
  (
    cd "$B"
    pnpm -s check:demo-coverage --api "http://127.0.0.1:$port" --tenant "$TENANT" --owner-username "$OWNER" \
      --owner-password-file "$OWNER_PW" --logins-file "$logins"
  ) >"$out.coverage" 2>&1 || cov=$?
  last "$out.coverage" | sed "s/^/   [$label] coverage: /"
  (cd "$B" && DATABASE_URL="$url" pnpm -s check:demo-rows --tenant "$TENANT" --expect "$out.run.json" \
    --baseline "$out.before.json") >"$out.rows" 2>&1 || rows=$?
  last "$out.rows" | sed "s/^/   [$label] marker check: /"
  (cd "$B" && DATABASE_URL="$url" pnpm -s check:stock-cancels) >"$out.cancels" 2>&1 || cancels=$?
  last "$out.cancels" | sed "s/^/   [$label] stock cancels: /"
  echo "$fill $cov $rows $cancels" >"$out.codes"
}

REHEARSAL_PID=""
stop_rehearsal() {
  if [ -n "$REHEARSAL_PID" ] && kill -0 "$REHEARSAL_PID" 2>/dev/null; then
    kill "$REHEARSAL_PID" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 "$REHEARSAL_PID" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$REHEARSAL_PID" 2>/dev/null || true
  fi
  REHEARSAL_PID=""
  sudo -u postgres psql -qc "DROP DATABASE IF EXISTS \"$REHEARSAL_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_STORAGE" "$E/.fill-rehearsal-logins.txt"
}

write_nightly() {
  local pnpm_dir node_dir
  pnpm_dir="$(dirname "$(command -v pnpm)")"
  node_dir="$(dirname "$(command -v node)")"
  cat >"$NIGHTLY.new" <<SH
#!/usr/bin/env bash
# Written by backend/infra/oracle-vm/fill-demo.sh. Every morning at 06:00 IST: the tool finishes what it
# left open yesterday and makes today on the REAL API, then the three checks. Log: $LOG
set -uo pipefail
export CI=1 PATH="$pnpm_dir:$node_dir:\$PATH"
echo "-- fill-demo \$(date '+%F %T %Z')"
for k in WHATSAPP_ACCESS_TOKEN MSG91_AUTH_KEY; do
  if [ -n "\$(sed -n "s/^\$k=//p" "$LIVE_ENV" | head -1)" ]; then
    echo "FAIL  a message channel is switched on (\$k): dummy activity would message real shops; nothing made"; exit 1
  fi
done
code=\$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:$LIVE_PORT/health || true)
[ "\$code" = 200 ] || { echo "FAIL  the API does not answer /health (\$code); nothing made"; exit 1; }
URL="\$(sed -n 's/^DATABASE_URL=//p' "$LIVE_ENV" | head -1)"
cd "$B"
DATABASE_URL="\$URL" pnpm -s check:demo-rows --tenant "$TENANT" --json "$BACKUPS/fill-demo-before.json" >/dev/null 2>&1 || true
rc=0
pnpm -s fill:demo --api http://127.0.0.1:$LIVE_PORT --tenant "$TENANT" --owner-username "$OWNER" \\
  --owner-password-file "$OWNER_PW" --logins-file "$LOGINS" --commit --report "$BACKUPS/fill-demo-last.json" || rc=\$?
[ "\$rc" = 0 ] && echo "PASS  fill:demo" || echo "FAIL  fill:demo exit \$rc"
c=0; pnpm -s check:demo-coverage --api http://127.0.0.1:$LIVE_PORT --tenant "$TENANT" --owner-username "$OWNER" \\
  --owner-password-file "$OWNER_PW" --logins-file "$LOGINS" || c=\$?
[ "\$c" = 0 ] && echo "PASS  check:demo-coverage" || echo "FAIL  check:demo-coverage exit \$c"
r=0; DATABASE_URL="\$URL" pnpm -s check:demo-rows --tenant "$TENANT" --baseline "$BACKUPS/fill-demo-before.json" \\
  --expect "$BACKUPS/fill-demo-last.json" || r=\$?
[ "\$r" = 0 ] && echo "PASS  check:demo-rows" || echo "FAIL  check:demo-rows exit \$r"
s=0; DATABASE_URL="\$URL" pnpm -s check:stock-cancels || s=\$?
[ "\$s" = 0 ] && echo "PASS  check:stock-cancels" || echo "FAIL  check:stock-cancels exit \$s"
chmod 600 "$LOGINS" 2>/dev/null || true
exit \$(( rc + c + r + s > 0 ? 1 : 0 ))
SH
  chmod 755 "$NIGHTLY.new"
  mv "$NIGHTLY.new" "$NIGHTLY"
}

vm_main() {
  export CI=1
  local rc codes stamp dump url rurl out before after

  say "0/4 preconditions"
  [ -f "$LIVE_ENV" ] || die "this is not the VM ($LIVE_ENV is expected)"
  [ -f "$B/all-in-one/dist/main.js" ] || die "the backend is not built here; run deploy.sh first"
  [ -f "$B/libs/contracts/dist/index.js" ] && [ -f "$B/libs/database/dist/index.js" ] ||
    die "@dos/contracts or @dos/db is not built here; run deploy.sh first"
  [ -f "$B/tools/fill-demo-activity.mts" ] || die "the tool is not on the VM; run deploy.sh first"
  command -v pnpm >/dev/null && command -v node >/dev/null && command -v curl >/dev/null ||
    die "pnpm, node or curl is missing"
  sudo -n true 2>/dev/null || die "sudo asks for a password here"
  [ -s "$OWNER_PW" ] || die "no owner password in $OWNER_PW"
  chmod 600 "$OWNER_PW"
  for k in WHATSAPP_ACCESS_TOKEN MSG91_AUTH_KEY; do
    [ -z "$(val "$LIVE_ENV" "$k")" ] ||
      die "a message channel is switched on ($k): dummy deliveries and receipts would message real shops (DOS-401)"
  done
  url="$(val "$LIVE_ENV" DATABASE_URL)"
  case "$url" in */"$LIVE_DB") ;; *) die "$LIVE_ENV does not point at $LIVE_DB" ;; esac
  [ "$(health "$LIVE_PORT")" = 200 ] || die "the real API does not answer /health on :$LIVE_PORT"
  [ "$(health "$REHEARSAL_PORT")" = 000 ] || die "port $REHEARSAL_PORT is taken: the rehearsal needs it free"
  echo "   built, the API answers on :$LIVE_PORT, no message channel, port $REHEARSAL_PORT free"
  stamp="$(date +%F-%H%M)"
  mkdir -p "$BACKUPS/daily"

  say "1/4 rehearse on a copy of $LIVE_DB"
  dump="$BACKUPS/daily/$LIVE_DB-$stamp-before-fill.dump"
  sudo -u postgres pg_dump -Fc "$LIVE_DB" >"$dump"
  dump="$(ls -t "$BACKUPS/daily/$LIVE_DB"-*.dump 2>/dev/null | head -1)"
  [ -s "$dump" ] || die "no dump of $LIVE_DB in $BACKUPS/daily"
  echo "   restoring $(basename "$dump")"
  trap stop_rehearsal EXIT
  stop_rehearsal
  sudo -u postgres createdb -O dos "$REHEARSAL_DB"
  sudo -u postgres psql -qc "REVOKE CONNECT ON DATABASE \"$REHEARSAL_DB\" FROM PUBLIC"
  sudo -u postgres pg_restore -d "$REHEARSAL_DB" --no-owner --role=dos "$dump" >/dev/null 2>&1 || true
  rurl="${url%/*}/$REHEARSAL_DB"
  mkdir -p "$REHEARSAL_STORAGE"
  chmod 700 "$REHEARSAL_STORAGE"
  (
    set -a
    # shellcheck disable=SC1090
    . "$LIVE_ENV"
    set +a
    export DATABASE_URL="$rurl" ALL_IN_ONE_PORT="$REHEARSAL_PORT" HEALTH_PORT="$REHEARSAL_PORT"
    # Its own file folder: the tool's ids are the same on the copy and on the real database, so a receipt
    # PDF rendered here would be written over the real one's file.
    export OBJECT_STORAGE_DIR="$REHEARSAL_STORAGE"
    cd "$B/all-in-one"
    exec node dist/main.js >"$BACKUPS/fill-rehearsal-api.log" 2>&1
  ) &
  REHEARSAL_PID=$!
  for _ in $(seq 1 60); do [ "$(health "$REHEARSAL_PORT")" = 200 ] && break; sleep 2; done
  [ "$(health "$REHEARSAL_PORT")" = 200 ] || die "the rehearsal API did not start (log $BACKUPS/fill-rehearsal-api.log)"
  echo "   rehearsal API on :$REHEARSAL_PORT over $REHEARSAL_DB"
  # A throw-away copy of the tester logins: the copy of the database has the same people, so the
  # rehearsal signs them in as the real run will (and heals them on the copy when the file is new).
  (umask 077 && if [ -f "$LOGINS" ]; then cat "$LOGINS"; fi >"$E/.fill-rehearsal-logins.txt")
  out="$BACKUPS/fill-demo-rehearsal-$stamp.log"
  fill_and_check "$REHEARSAL_PORT" "$out" "$rurl" "$E/.fill-rehearsal-logins.txt" rehearsal
  codes="$(cat "$out.codes")"
  stop_rehearsal
  trap - EXIT
  [ "$(sudo -u postgres psql -qtAc "select count(*) from pg_database where datname = '$REHEARSAL_DB'")" = 0 ] &&
    proof ok "the rehearsal database is dropped and its API stopped" ||
    proof bad "the rehearsal database $REHEARSAL_DB is still there"
  if [ "$codes" != "0 0 0 0" ]; then
    proof bad "the rehearsal failed (fill, coverage, marker, cancels exit: $codes); the real database was NOT touched"
    echo
    echo "$PASSES passed, $FAILS failed — details in $out*"
    return 1
  fi
  proof ok "the rehearsal on a copy of $LIVE_DB made the day, every role opens on work, every rule holds"

  say "2/4 the real API (:$LIVE_PORT)"
  [ "$(health "$LIVE_PORT")" = 200 ] || die "the real API stopped answering"
  out="$BACKUPS/fill-demo-live-$stamp.log"
  before="$([ -f "$LOGINS" ] && echo yes || echo no)"
  fill_and_check "$LIVE_PORT" "$out" "$url" "$LOGINS" live
  codes="$(cat "$out.codes")"
  read -r fillc covc rowsc cancelc <<<"$codes"
  [ "$fillc" = 0 ] && proof ok "fill:demo made the day on the real database" || proof bad "fill:demo exit $fillc (see $out)"
  [ "$covc" = 0 ] && proof ok "every tester login opens on work" || proof bad "check:demo-coverage exit $covc (see $out.coverage)"
  [ "$rowsc" = 0 ] && proof ok "the marker check: the tool's rows are the runs' rows, its money only on its own bills, the books right" ||
    proof bad "check:demo-rows exit $rowsc (see $out.rows)"
  [ "$cancelc" = 0 ] && proof ok "no cancelled bill leaves stock behind" || proof bad "check:stock-cancels exit $cancelc"
  after="$(stat -c '%a' "$LOGINS" 2>/dev/null || stat -f '%Lp' "$LOGINS" 2>/dev/null || echo none)"
  [ "$after" = 600 ] && proof ok "the tester logins are in $LOGINS, mode 600 (was there before: $before)" ||
    proof bad "the tester logins file is missing or not mode 600 ($after)"

  say "3/4 every morning at 06:00 IST"
  write_nightly
  (
    crontab -l 2>/dev/null | grep -v 'fill-demo-nightly.sh' || true
    echo "$CRON_WHEN $NIGHTLY >> $LOG 2>&1"
  ) | crontab -
  [ -x "$NIGHTLY" ] && [ "$(crontab -l 2>/dev/null | grep -c 'fill-demo-nightly.sh')" = 1 ] &&
    proof ok "$NIGHTLY and one cron line ($CRON_WHEN, UTC = 06:00 IST), log $LOG" ||
    proof bad "the nightly script or its cron line is missing"

  say "4/4 the real API after the run"
  [ "$(health "$LIVE_PORT")" = 200 ] && proof ok "the real API answers /health" || proof bad "the real API does not answer /health"
  echo
  echo "$PASSES passed, $FAILS failed"
  [ "$FAILS" = 0 ]
}

mac_main() {
  local key="$HOME/.ssh/dos_oracle" vm="ubuntu@92.4.84.106" out="$HOME/.config/dos/tester-logins.txt" rc=0
  local ownerpw="$HOME/.config/dos/live-owner-password.txt"
  [ -f "$key" ] || die "no SSH key at $key"
  scp -q -i "$key" "${BASH_SOURCE[0]}" "$vm:/opt/dos/fill-demo.sh"
  if ! ssh -i "$key" "$vm" "test -s $OWNER_PW"; then
    [ -s "$ownerpw" ] || die "the VM has no $OWNER_PW and this Mac has no $ownerpw"
    ssh -i "$key" "$vm" "umask 077 && cat > $OWNER_PW" <"$ownerpw"
    echo "owner password: sent to the VM ($OWNER_PW, mode 600; not shown)"
  fi
  ssh -i "$key" "$vm" "bash /opt/dos/fill-demo.sh vm" || rc=$?
  mkdir -p "$(dirname "$out")"
  (
    umask 077
    ssh -i "$key" "$vm" "cat $LOGINS 2>/dev/null" >"$out.new" || true
  )
  echo
  if [ -s "$out.new" ]; then
    mv "$out.new" "$out"
    chmod 600 "$out"
    echo "tester logins: $out"
  else
    rm -f "$out.new"
    echo "tester logins: none yet (the run stopped before they were made)"
  fi
  [ "$rc" = 0 ] && echo "done — tell Claude" || echo "one or more steps FAILED — tell Claude, paste the lines above"
  return "$rc"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "${1:-}" = vm ]; then vm_main; else mac_main; fi
fi
