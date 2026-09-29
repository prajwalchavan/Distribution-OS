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
#      message real shopkeepers (QA DOS-401); a rehearsal an earlier run left behind (killed hard: SIGKILL, a
#      dropped ssh) is recognised by its own state file — the database it made and the process it started —
#      stopped and dropped; anything else on the rehearsal port stops the command;
#   2. REHEARSES: a fresh dump of dos_live (mode 600, in /var/backups/dos/fill-demo, closed to other logins:
#      it holds the real shops' names, phones and dues), restored into a scratch database dos_fill_rehearsal
#      (closed to every login but dos), a second API on a spare port over it (the real environment file with
#      the database, the two ports and the file folder swapped — that folder is never the real one, nor inside
#      it, nor above it), the tool with --commit, its two checks and the four release checks there, with a
#      throw-away logins file; then that API is stopped and the scratch database dropped. Any failure stops
#      everything before the real database is touched;
#   3. runs the tool with --commit against the real API (127.0.0.1:3100) as owner.tarsun, then the same six
#      checks. The tester logins are plain — manager, accounts, sales1, sales2, godown, driver1, driver2 (the next
#      free plain name, e.g. godown2, when the distributor's own staff already holds one) — and each signs in with
#      the demo password of the demo seed (founder, 2026-09-29); the tool lists them in
#      /opt/dos/env/tester-logins.txt (mode 600). The owner's password is never changed;
#   4. writes /opt/dos/fill-demo-nightly.sh and the cron line for 06:00 IST (`30 0 * * *` on a VM clock in UTC,
#      `0 6 * * *` on one in IST; any other clock needs FILL_CRON_WHEN), log in /var/backups/dos/fill-demo.log;
#   5. prints PASS / FAIL lines.
#
# The six checks after a run: check:demo-coverage (every role opens on work), check:demo-rows (the tool's rows
# are the run's, its money only on its own bills and no real money on them, the books right), and the four
# release checks — check:stock-negative, check:stranded, check:stock-cancels, check:receipt-references: the work
# the tool leaves open on purpose must read as work the product can carry on, never as stranded (rule 7b).
#
# The Mac half then copies the logins file to ~/.config/dos/tester-logins.txt (mode 600) and prints only
# its path: open it to see which tester logins exist. No password, no shop's name, phone or address is printed
# anywhere: the tool and the checks print counts and ids. When the VM has no /opt/dos/env/live-owner.pw yet, the
# Mac half sends it from
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
# The command's own folder, closed to other logins (mode 700): the before-fill dumps (a full copy of the real
# shops' names, phones and dues, mode 600), what pg_restore and the rehearsal API said, the checks' outputs,
# and the rehearsal's state file. Not the nightly backups' folder: deploy.sh restores the newest dump there as
# the postgres login, which a mode-600 file of this login would stop.
FILL_DIR="${FILL_DIR:-$BACKUPS/fill-demo}"
# What this command started for its rehearsal (the database it made, the API process, the port), so a run killed
# hard is cleaned up by the next one — by these, never by the port alone.
STATE="$FILL_DIR/rehearsal.state"
# Before-fill dumps kept (newest first); older ones are removed by this command.
KEEP_DUMPS="${FILL_KEEP_DUMPS:-7}"
# Empty = worked out from the VM clock (cron_when).
CRON_WHEN="${FILL_CRON_WHEN:-}"

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
# 06:00 IST in the clock cron keeps: the system zone (/etc/localtime), not this shell's TZ. Empty when the
# clock is neither UTC nor IST (then FILL_CRON_WHEN must say it).
cron_when() {
  if [ -n "$CRON_WHEN" ]; then
    echo "$CRON_WHEN"
    return
  fi
  case "$(env -u TZ date +%z)" in
    +0000) echo "30 0 * * *" ;;
    +0530) echo "0 6 * * *" ;;
    *) echo "" ;;
  esac
}
# The last line a script printed itself (pnpm's own "Command failed" line left out).
last() { grep -v -E 'ELIFECYCLE|^\s*$' "$1" | tail -1 || true; }

# The release checks, in the order release-checks.sh runs them. What one names can carry a real shop's name, so
# its output stays in the command's closed folder and only its exit code and line count are shown.
RELEASE_CHECKS="stock-negative stranded stock-cancels receipt-references"

# The tool and the six checks against one API and one database. Output goes to "$2" (counts and ids only);
# the summary lines are shown. The seven exit codes land in "$2.codes" as
# "fill coverage rows stock-negative stranded stock-cancels receipt-references".
fill_and_check() { # fill_and_check <port> <log file> <database url> <logins file> <label>
  local port="$1" out="$2" url="$3" logins="$4" label="$5" fill=0 cov=0 rows=0 rc codes c
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
  codes="$fill $cov $rows"
  for c in $RELEASE_CHECKS; do
    rc=0
    (cd "$B" && DATABASE_URL="$url" pnpm -s "check:$c") >"$out.$c" 2>&1 || rc=$?
    echo "   [$label] check:$c exit $rc ($(wc -l <"$out.$c" | tr -d ' ') lines, in $out.$c)"
    codes="$codes $rc"
  done
  echo "$codes" >"$out.codes"
}
ALL_PASS="0 0 0 0 0 0 0"

# ---------------------------------------------------------------------------------- the rehearsal's own things
# The state file names what THIS command made for its rehearsal: `db=` before the database is created, `pid=`
# and `port=` once its API runs. A run killed hard (SIGKILL, a dropped ssh: the EXIT trap never runs) leaves them
# behind; the next run reads the file, stops that API only when it is still that process (its command line is
# the API's and its environment names that database) and drops that database only when its name is a
# rehearsal's. Never by the port alone: whatever else answers on the rehearsal port stops the command.
state_get() { [ -f "$STATE" ] && sed -n "s/^$1=//p" "$STATE" | head -1 || true; }
state_put() { (umask 077 && echo "$1=$2" >>"$STATE"); }

# Is process $1 the rehearsal API over database $2? Its command line runs dist/main.js and its environment names
# that database (Linux /proc; elsewhere `ps eww`, which shows the environment of one's own processes).
is_rehearsal_api() { # is_rehearsal_api <pid> <db>
  local pid="$1" db="$2"
  [ -n "$pid" ] && [ -n "$db" ] && kill -0 "$pid" 2>/dev/null || return 1
  ps -o args= -p "$pid" 2>/dev/null | grep -q 'dist/main.js' || return 1
  if [ -r "/proc/$pid/environ" ]; then
    tr '\0' '\n' <"/proc/$pid/environ" | grep -q "^DATABASE_URL=.*/$db\$"
  else
    ps eww -o command= -p "$pid" 2>/dev/null | tr ' ' '\n' | grep -q "^DATABASE_URL=.*/$db\$"
  fi
}

stop_pid() {
  kill "$1" 2>/dev/null || true
  for _ in $(seq 1 40); do kill -0 "$1" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$1" 2>/dev/null || true
}

# A database the rehearsal may drop: its name says rehearsal and it is not the real one.
droppable() { case "$1" in *rehearsal*) [ "$1" != "$LIVE_DB" ] && [ "$1" != "${2:-}" ] ;; *) return 1 ;; esac; }

REHEARSAL_PID=""
stop_rehearsal() {
  if [ -n "$REHEARSAL_PID" ] && kill -0 "$REHEARSAL_PID" 2>/dev/null; then stop_pid "$REHEARSAL_PID"; fi
  REHEARSAL_PID=""
  sudo -u postgres psql -qc "DROP DATABASE IF EXISTS \"$REHEARSAL_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$REHEARSAL_STORAGE" "$E/.fill-rehearsal-logins.txt"
  rm -f "$STATE"
}

# What an earlier run killed hard left: its API stopped (when it is still that process) and its database dropped.
# Prints what it did; changes nothing when there is no state file.
clean_leftover() { # clean_leftover <live database of live.env>
  local db pid port
  [ -f "$STATE" ] || return 0
  db="$(state_get db)"
  pid="$(state_get pid)"
  port="$(state_get port)"
  if [ -n "$pid" ] && is_rehearsal_api "$pid" "$db"; then
    stop_pid "$pid"
    echo "   an earlier run was stopped hard: its rehearsal API (pid $pid, :$port) is stopped"
  elif [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "   the state file names pid $pid, which is not this command's rehearsal API now: left alone"
  fi
  if [ -n "$db" ]; then
    if droppable "$db" "$1"; then
      if [ "$(sudo -u postgres psql -qtAc "select count(*) from pg_database where datname = '$db'" 2>/dev/null)" = 1 ]; then
        sudo -u postgres psql -qc "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1 || true
        echo "   an earlier run was stopped hard: its rehearsal database $db is dropped"
      fi
    else
      die "the state file $STATE names a database that is not a rehearsal ($db): nothing dropped; look at it"
    fi
  fi
  rm -f "$STATE" "$E/.fill-rehearsal-logins.txt"
}

# A folder's own path, links resolved, for a folder that may not exist yet (its nearest existing parent's).
canon() {
  local p="$1" tail=""
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  while [ ! -d "$p" ]; do
    tail="/$(basename "$p")$tail"
    p="$(dirname "$p")"
  done
  echo "$(cd "$p" && pwd -P)$tail" | sed -e 's#//*#/#g' -e 's#/$##'
}

# The rehearsal's file folder is removed at the end of every rehearsal: it can never be the real API's folder,
# nor inside it, nor above it (nor the root, the backend or the backups).
check_rehearsal_storage() { # check_rehearsal_storage <real storage folder, from live.env>
  local r l
  [ -n "$REHEARSAL_STORAGE" ] || die "FILL_REHEARSAL_STORAGE is empty"
  r="$(canon "$REHEARSAL_STORAGE")"
  [ -n "$r" ] && [ "$r" != / ] || die "the rehearsal file folder is the root"
  for other in "$1" "$B" "$BACKUPS" "$E" "$FILL_DIR" "$HOME"; do
    [ -n "$other" ] || continue
    l="$(canon "$other")"
    [ "$r" != "$l" ] || die "the rehearsal file folder is $other: it is removed after the rehearsal"
    case "$l/" in "$r"/*) die "the rehearsal file folder $REHEARSAL_STORAGE holds $other: it is removed after the rehearsal" ;; esac
  done
  if [ -n "$1" ]; then
    l="$(canon "$1")"
    case "$r/" in "$l"/*) die "the rehearsal file folder $REHEARSAL_STORAGE is inside the real one ($1)" ;; esac
  fi
}

write_nightly() {
  local pnpm_dir node_dir
  # The folders themselves, not a per-shell link to them (a version manager's shell folder is gone by
  # tomorrow morning).
  pnpm_dir="$(cd "$(dirname "$(command -v pnpm)")" && pwd -P)"
  node_dir="$(cd "$(dirname "$(command -v node)")" && pwd -P)"
  cat >"$NIGHTLY.new" <<SH
#!/usr/bin/env bash
# Written by backend/infra/oracle-vm/fill-demo.sh. Every morning at 06:00 IST: the tool finishes what it
# left open yesterday and makes today on the REAL API, then its two checks and the four release checks. Log: $LOG
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
umask 077
mkdir -p "$FILL_DIR"; chmod 700 "$FILL_DIR"
DATABASE_URL="\$URL" pnpm -s check:demo-rows --tenant "$TENANT" --json "$FILL_DIR/nightly-before.json" >/dev/null 2>&1 || true
rc=0
pnpm -s fill:demo --api http://127.0.0.1:$LIVE_PORT --tenant "$TENANT" --owner-username "$OWNER" \\
  --owner-password-file "$OWNER_PW" --logins-file "$LOGINS" --commit --report "$FILL_DIR/nightly-last.json" || rc=\$?
[ "\$rc" = 0 ] && echo "PASS  fill:demo" || echo "FAIL  fill:demo exit \$rc"
c=0; pnpm -s check:demo-coverage --api http://127.0.0.1:$LIVE_PORT --tenant "$TENANT" --owner-username "$OWNER" \\
  --owner-password-file "$OWNER_PW" --logins-file "$LOGINS" || c=\$?
[ "\$c" = 0 ] && echo "PASS  check:demo-coverage" || echo "FAIL  check:demo-coverage exit \$c"
r=0; DATABASE_URL="\$URL" pnpm -s check:demo-rows --tenant "$TENANT" --baseline "$FILL_DIR/nightly-before.json" \\
  --expect "$FILL_DIR/nightly-last.json" || r=\$?
[ "\$r" = 0 ] && echo "PASS  check:demo-rows" || echo "FAIL  check:demo-rows exit \$r"
# The four release checks (rule 7b). What one names can carry a real shop's name: it stays in $FILL_DIR.
s=0
for k in $RELEASE_CHECKS; do
  x=0; DATABASE_URL="\$URL" pnpm -s "check:\$k" >"$FILL_DIR/nightly-\$k.log" 2>&1 || x=\$?
  [ "\$x" = 0 ] && echo "PASS  check:\$k" || { echo "FAIL  check:\$k exit \$x (\$(wc -l <"$FILL_DIR/nightly-\$k.log" | tr -d ' ') lines in $FILL_DIR/nightly-\$k.log)"; s=1; }
done
chmod 600 "$LOGINS" 2>/dev/null || true
exit \$(( rc + c + r + s > 0 ? 1 : 0 ))
SH
  chmod 755 "$NIGHTLY.new"
  mv "$NIGHTLY.new" "$NIGHTLY"
}

vm_main() {
  export CI=1
  local rc codes stamp dump url rurl out before after when

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
  # The rehearsal database is created, restored over and DROPPED: it can never be the real one.
  case "$REHEARSAL_DB" in
    *rehearsal*) ;;
    *) die "the rehearsal database must be a scratch copy whose name says rehearsal (it is dropped): $REHEARSAL_DB" ;;
  esac
  [ "$REHEARSAL_DB" != "$LIVE_DB" ] && [ "$REHEARSAL_DB" != "${url##*/}" ] ||
    die "the rehearsal database is the real one ($REHEARSAL_DB)"
  [ "$REHEARSAL_PORT" != "$LIVE_PORT" ] || die "the rehearsal port is the real API's ($REHEARSAL_PORT)"
  # The rehearsal's file folder is removed after it: never the real API's folder, inside it or above it.
  check_rehearsal_storage "$(val "$LIVE_ENV" OBJECT_STORAGE_DIR)"
  [ "$(health "$LIVE_PORT")" = 200 ] || die "the real API does not answer /health on :$LIVE_PORT"
  # The command's own folder, closed to other logins; everything it writes there is its own login's only.
  umask 077
  mkdir -p "$FILL_DIR"
  chmod 700 "$FILL_DIR"
  # Before-fill dumps an earlier version of this command wrote into the nightly backups' folder (readable there,
  # and the newest dump of that folder is what deploy.sh restores): moved into the closed folder, mode 600.
  local old
  for old in "$BACKUPS/daily/$LIVE_DB"-*-before-fill.dump; do
    [ -f "$old" ] || continue
    if mv "$old" "$FILL_DIR/" 2>/dev/null; then
      chmod 600 "$FILL_DIR/$(basename "$old")"
      echo "   an earlier before-fill dump moved out of the nightly backups' folder into $FILL_DIR (mode 600)"
    else
      die "an earlier before-fill dump in $BACKUPS/daily cannot be moved into $FILL_DIR: move it by hand"
    fi
  done
  # A rehearsal an earlier run left when it was killed hard: recognised by its state file, then cleaned up.
  clean_leftover "${url##*/}"
  [ "$(health "$REHEARSAL_PORT")" = 000 ] ||
    die "port $REHEARSAL_PORT is taken by something this command did not start: the rehearsal needs it free"
  echo "   built, the API answers on :$LIVE_PORT, no message channel, port $REHEARSAL_PORT free"
  stamp="$(date +%F-%H%M%S)"

  say "1/4 rehearse on a copy of $LIVE_DB"
  # A dump of the real data as it is before this run: the copy the rehearsal restores, and the way back. It
  # holds the real shops' names, phones and dues: mode 600 in the command's own folder (mode 700), the newest
  # $KEEP_DUMPS kept. pg_restore reads it from this login's hand (stdin), so the postgres login never opens it.
  local dump_name="$LIVE_DB-$stamp-before-fill.dump"
  dump="$FILL_DIR/$dump_name"
  (umask 077 && sudo -u postgres pg_dump -Fc "$LIVE_DB" >"$dump")
  chmod 600 "$dump"
  [ -s "$dump" ] || die "the dump of $LIVE_DB is empty"
  # shellcheck disable=SC2012
  ls -1t "$FILL_DIR/$LIVE_DB"-*-before-fill.dump 2>/dev/null | tail -n +"$((KEEP_DUMPS + 1))" | while read -r old; do rm -f "$old"; done
  echo "   restoring $dump_name"
  trap stop_rehearsal EXIT
  stop_rehearsal
  # What this command makes is written down before it is made: a run killed hard is recognised by the next.
  state_put db "$REHEARSAL_DB"
  sudo -u postgres createdb -O dos "$REHEARSAL_DB"
  sudo -u postgres psql -qc "REVOKE CONNECT ON DATABASE \"$REHEARSAL_DB\" FROM PUBLIC"
  # What pg_restore says stays on the VM (mode 600): an error line may quote a row of the real data.
  local restore_log="$FILL_DIR/rehearsal-restore.log" restored=0 errors there
  (umask 077 && sudo -u postgres pg_restore -d "$REHEARSAL_DB" --no-owner --role=dos <"$dump" >"$restore_log" 2>&1) ||
    restored=$?
  errors="$(grep -c -i 'error' "$restore_log" || true)"
  there="$(sudo -u postgres psql -d "$REHEARSAL_DB" -qtAc "select count(*) from tenants where slug = '$TENANT'" 2>/dev/null || true)"
  [ "$there" = 1 ] ||
    die "the copy has no distributor $TENANT after pg_restore (exit $restored, $errors error line(s) in $restore_log); the real database was NOT touched"
  if [ "$restored" = 0 ]; then
    echo "   restored"
  else
    echo "   restored, but pg_restore exit $restored with $errors error line(s) ($restore_log); the rehearsal decides"
  fi
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
    exec node dist/main.js >"$FILL_DIR/rehearsal-api.log" 2>&1
  ) &
  REHEARSAL_PID=$!
  state_put pid "$REHEARSAL_PID"
  state_put port "$REHEARSAL_PORT"
  for _ in $(seq 1 60); do [ "$(health "$REHEARSAL_PORT")" = 200 ] && break; sleep 2; done
  [ "$(health "$REHEARSAL_PORT")" = 200 ] || die "the rehearsal API did not start (log $FILL_DIR/rehearsal-api.log)"
  echo "   rehearsal API on :$REHEARSAL_PORT over $REHEARSAL_DB"
  # A throw-away copy of the tester logins: the copy of the database has the same people, so the
  # rehearsal signs them in as the real run will (and heals them on the copy when the file is new).
  (umask 077 && if [ -f "$LOGINS" ]; then cat "$LOGINS"; fi >"$E/.fill-rehearsal-logins.txt")
  out="$FILL_DIR/rehearsal-$stamp.log"
  fill_and_check "$REHEARSAL_PORT" "$out" "$rurl" "$E/.fill-rehearsal-logins.txt" rehearsal
  codes="$(cat "$out.codes")"
  stop_rehearsal
  trap - EXIT
  [ "$(sudo -u postgres psql -qtAc "select count(*) from pg_database where datname = '$REHEARSAL_DB'")" = 0 ] &&
    proof ok "the rehearsal database is dropped and its API stopped" ||
    proof bad "the rehearsal database $REHEARSAL_DB is still there"
  if [ "$codes" != "$ALL_PASS" ]; then
    proof bad "the rehearsal failed (fill, coverage, marker, then the release checks $RELEASE_CHECKS exit: $codes); the real database was NOT touched"
    echo
    echo "$PASSES passed, $FAILS failed — details in $out*"
    return 1
  fi
  proof ok "the rehearsal on a copy of $LIVE_DB made the day, every role opens on work, every rule holds, the four release checks pass"

  say "2/4 the real API (:$LIVE_PORT)"
  [ "$(health "$LIVE_PORT")" = 200 ] || die "the real API stopped answering"
  out="$FILL_DIR/live-$stamp.log"
  before="$([ -f "$LOGINS" ] && echo yes || echo no)"
  fill_and_check "$LIVE_PORT" "$out" "$url" "$LOGINS" live
  codes="$(cat "$out.codes")"
  read -r fillc covc rowsc negc strc cancelc refc <<<"$codes"
  [ "$fillc" = 0 ] && proof ok "fill:demo made the day on the real database" || proof bad "fill:demo exit $fillc (see $out)"
  [ "$covc" = 0 ] && proof ok "every tester login opens on work" || proof bad "check:demo-coverage exit $covc (see $out.coverage)"
  [ "$rowsc" = 0 ] && proof ok "the marker check: the tool's rows are the runs' rows, its money only on its own bills and no real money on them, the books right" ||
    proof bad "check:demo-rows exit $rowsc (see $out.rows)"
  [ "$negc" = 0 ] && proof ok "no place shows stock below zero" || proof bad "check:stock-negative exit $negc (see $out.stock-negative)"
  [ "$strc" = 0 ] && proof ok "nothing is stranded: the work left open today is work the product carries on" ||
    proof bad "check:stranded exit $strc (see $out.stranded)"
  [ "$cancelc" = 0 ] && proof ok "no cancelled bill leaves stock behind" || proof bad "check:stock-cancels exit $cancelc (see $out.stock-cancels)"
  [ "$refc" = 0 ] && proof ok "no payment reference is on two live receipts" ||
    proof bad "check:receipt-references exit $refc (see $out.receipt-references)"
  after="$(stat -c '%a' "$LOGINS" 2>/dev/null || stat -f '%Lp' "$LOGINS" 2>/dev/null || echo none)"
  [ "$after" = 600 ] && proof ok "the tester logins are in $LOGINS, mode 600 (was there before: $before)" ||
    proof bad "the tester logins file is missing or not mode 600 ($after)"

  say "3/4 every morning at 06:00 IST"
  write_nightly
  when="$(cron_when)"
  if [ "$FAILS" -gt 0 ]; then
    # A run that failed a check is not repeated every morning: put it right, run this command again.
    proof bad "no cron line written: $FAILS of the proofs above failed; put them right and run this command again"
  elif [ -z "$when" ]; then
    proof bad "the VM clock is on $(env -u TZ date +%Z) ($(env -u TZ date +%z)), neither UTC nor IST: no cron line written; set FILL_CRON_WHEN to 06:00 IST in that clock"
  else
    (
      crontab -l 2>/dev/null | grep -v 'fill-demo-nightly.sh' || true
      echo "$when $NIGHTLY >> $LOG 2>&1"
    ) | crontab -
    [ -x "$NIGHTLY" ] && [ "$(crontab -l 2>/dev/null | grep -c 'fill-demo-nightly.sh')" = 1 ] &&
      proof ok "$NIGHTLY and one cron line ($when on a clock at $(env -u TZ date +%z) = 06:00 IST), log $LOG" ||
      proof bad "the nightly script or its cron line is missing"
  fi

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
  # The password saved on this Mac is the one that counts: it is sent every time, so a corrected one replaces
  # a wrong one on the VM. Without a file here the VM's own is used.
  if [ -s "$ownerpw" ]; then
    ssh -i "$key" "$vm" "umask 077 && cat > $OWNER_PW && chmod 600 $OWNER_PW" <"$ownerpw"
    echo "owner password: sent to the VM ($OWNER_PW, mode 600; not shown)"
  elif ! ssh -i "$key" "$vm" "test -s $OWNER_PW"; then
    die "the VM has no $OWNER_PW and this Mac has no $ownerpw"
  fi
  # The distributor and the owner's username go with it, so FILL_TENANT / FILL_OWNER set on this Mac hold there.
  ssh -i "$key" "$vm" "FILL_TENANT=$(printf '%q' "$TENANT") FILL_OWNER=$(printf '%q' "$OWNER") bash /opt/dos/fill-demo.sh vm" || rc=$?
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
