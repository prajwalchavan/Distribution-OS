#!/usr/bin/env bash
# Why did the last fill stop? Prints the last lines that the tool and its two checks wrote on the server for
# the newest run (rehearsal or real). They hold counts, ids and the API's refusal, never a name or a password.
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/fill-demo-why.sh
set -euo pipefail
KEY="$HOME/.ssh/dos_oracle"; VM="ubuntu@92.4.84.106"
ssh -i "$KEY" "$VM" 'D=/var/backups/dos/fill-demo
f=$(ls -t "$D"/rehearsal-*.log "$D"/live-*.log 2>/dev/null | head -1)
[ -n "$f" ] || { echo "no run found in $D"; exit 1; }
echo "newest run: $(basename "$f")"
for x in "$f" "$f.coverage" "$f.rows"; do
  [ -f "$x" ] || continue
  echo "== $(basename "$x")"
  grep -v -E "ELIFECYCLE|^[[:space:]]*$|^usage:|^ +\[--" "$x" | tail -8 | cut -c1-300
done'
