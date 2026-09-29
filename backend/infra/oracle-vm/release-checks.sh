#!/usr/bin/env bash
# The four release checks against the REAL database, on the server. They only read.
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/release-checks.sh
#
# Prints one line per check: its exit code and how many lines it wrote. What a check names stays on the
# server, in ~/release-checks/<date>/ (closed to other logins), because it can carry a real shop's name.
set -euo pipefail
KEY="$HOME/.ssh/dos_oracle"; VM="ubuntu@92.4.84.106"
ssh -i "$KEY" "$VM" 'set -uo pipefail; cd /opt/dos/backend
D="$HOME/release-checks/$(date +%F-%H%M)"; mkdir -p "$D"; chmod 700 "$HOME/release-checks" "$D"
set -a; . /opt/dos/env/live.env; set +a
bad=0
for c in stock-negative stranded stock-cancels receipt-references; do
  pnpm -s "check:$c" >"$D/$c.log" 2>&1; rc=$?
  echo "check:$c  exit $rc  ($(wc -l <"$D/$c.log" | tr -d " ") lines in $D/$c.log)"
  [ "$rc" -eq 0 ] || bad=1
done
if [ "$bad" -eq 0 ]; then echo "ALL FOUR PASS"; else echo "AT LEAST ONE CHECK NAMES SOMETHING: the log is on the server"; fi
exit "$bad"'
