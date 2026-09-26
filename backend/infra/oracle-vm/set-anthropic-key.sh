#!/usr/bin/env bash
# Reads the Anthropic API key from stdin (never from argv, never printed), switches bill scanning to the real engine.
set -euo pipefail
IFS= read -r KEY
case "$KEY" in sk-ant-*) ;; *) echo "that does not look like an Anthropic key (should start sk-ant-)"; exit 1;; esac
for f in /opt/dos/env/demo.env /opt/dos/env/live.env; do
  [ -f "$f" ] || continue
  python3 - "$f" "$KEY" <<PY
import sys,re
p,k=sys.argv[1],sys.argv[2]; s=open(p).read()
s=re.sub(r"^ANTHROPIC_API_KEY=.*$","ANTHROPIC_API_KEY="+k,s,flags=re.M)
s=re.sub(r"^DOCINT_ENGINE=.*$","DOCINT_ENGINE=anthropic",s,flags=re.M)
open(p,"w").write(s)
PY
  chmod 600 "$f"
done
for u in $(systemctl list-units --plain --no-legend "dos-api@*" | awk "{print \$1}"); do sudo systemctl restart "$u"; done
echo "bill scanning is now on the real engine; API restarted"
