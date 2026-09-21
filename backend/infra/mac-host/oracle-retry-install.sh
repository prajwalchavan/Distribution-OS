#!/usr/bin/env bash
# Installs a launchd agent that runs oracle-a1-try.sh every 5 minutes until the Oracle VM lands.
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/mac-host/oracle-retry-install.sh
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
A="$HOME/Library/LaunchAgents/in.distributionos.oracle.plist"; mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/dos"
chmod +x "$REPO/backend/infra/mac-host/oracle-a1-try.sh"
launchctl bootout "gui/$(id -u)/in.distributionos.oracle" 2>/dev/null || true
cat >"$A" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.distributionos.oracle</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$REPO/backend/infra/mac-host/oracle-a1-try.sh</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/dos/oracle.err.log</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$A" && echo "installed: tries every 5 min; watch ~/Library/Logs/dos/oracle.log — a LAUNCHED line means the server exists"
