#!/usr/bin/env bash
# Serve the hosted test preview FROM THIS MAC, under launchd, so it survives a Claude session ending,
# a terminal closing, and a reboot (it comes back at login). Run it once; rerun it after any change.
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/mac-host/serve-from-this-mac.sh
#
# What it installs (user LaunchAgents, no sudo):
#   in.distributionos.api     the all-in-one API on :3100 against the TEST database dos_test_hosted
#   in.distributionos.tunnel  the Cloudflare tunnel that gives the API a public https address
#   in.distributionos.awake   caffeinate, so the Mac does not idle-sleep (keep the lid open, plugged in)
# Postgres 17 is already a brew service (postgresql@17) and starts at login on its own.
#
# The tunnel comes in two kinds:
#   NAMED  — ~/.config/dos/tunnel.token exists (created once the Cloudflare API token carries
#            "Cloudflare Tunnel: Edit"): stable address https://api.distributionos.in, survives restarts.
#   QUICK  — no token yet: a random *.trycloudflare.com address that CHANGES on every restart, so this
#            script republishes the website with the new address at the end. Rerun after a reboot.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/dos"
CF_TOKEN_FILE="$HOME/.config/dos/cloudflare.token"
TUNNEL_TOKEN_FILE="$HOME/.config/dos/tunnel.token"
ACCOUNT_ID="6730952ae1e2212f14c52d66a5339d35"
DOMAIN="distributionos.in"
mkdir -p "$AGENTS" "$LOGS"

export PATH="/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH"
eval "$(fnm env)"; fnm use 24 >/dev/null
NODE="$(command -v node)"
UID_N="$(id -u)"
say() { printf '\n== %s\n' "$*"; }

say "database dos_test_hosted (created if missing, migrated, seeded)"
export PGHOST=127.0.0.1 PGPORT=5439 PGUSER=dos
if ! psql -d postgres -tAc "select 1 from pg_database where datname='dos_test_hosted'" | grep -q 1; then
  createdb -T dos_test_batch2b_template dos_test_hosted
fi
( cd "$REPO/backend" && DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_hosted pnpm db:migrate >/dev/null && DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_test_hosted pnpm db:seed >/dev/null ) && echo "   migrated + seeded"

say "API build (all-in-one dist)"
( cd "$REPO/backend" && pnpm exec turbo run build --filter='./libs/*' >/dev/null && pnpm --filter @dos/all-in-one build >/dev/null ) && echo "   built"

say "stopping anything already on :3100 / :3101 (an earlier session's copies)"
launchctl bootout "gui/$UID_N/in.distributionos.api" 2>/dev/null || true
launchctl bootout "gui/$UID_N/in.distributionos.tunnel" 2>/dev/null || true
launchctl bootout "gui/$UID_N/in.distributionos.awake" 2>/dev/null || true
lsof -ti :3100 -ti :3101 2>/dev/null | xargs kill 2>/dev/null || true
sleep 2

say "writing LaunchAgents"
cat >"$AGENTS/in.distributionos.api.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.distributionos.api</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>dist/main.js</string></array>
  <key>WorkingDirectory</key><string>$REPO/backend/all-in-one</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key><string>development</string>
    <key>DATABASE_URL</key><string>postgres://dos:dos@127.0.0.1:5439/dos_test_hosted</string>
    <key>DATABASE_POOL_MAX</key><string>8</string>
    <key>ALL_IN_ONE_PORT</key><string>3100</string>
    <key>WORKER_INLINE</key><string>1</string>
    <key>CORS_ORIGINS</key><string>https://www.$DOMAIN,https://$DOMAIN,https://dos-7ij.pages.dev</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOGS/api.log</string>
  <key>StandardErrorPath</key><string>$LOGS/api.err.log</string>
</dict></plist>
EOF

if [ -s "$TUNNEL_TOKEN_FILE" ]; then
  KIND=named
  TUNNEL_ARGS="<string>tunnel</string><string>--no-autoupdate</string><string>run</string><string>--token</string><string>$(cat "$TUNNEL_TOKEN_FILE")</string>"
else
  KIND=quick
  TUNNEL_ARGS="<string>tunnel</string><string>--no-autoupdate</string><string>--url</string><string>http://127.0.0.1:3100</string><string>--metrics</string><string>127.0.0.1:3101</string>"
fi
: >"$LOGS/tunnel.err.log"
cat >"$AGENTS/in.distributionos.tunnel.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.distributionos.tunnel</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/cloudflared</string>$TUNNEL_ARGS</array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/tunnel.log</string>
  <key>StandardErrorPath</key><string>$LOGS/tunnel.err.log</string>
</dict></plist>
EOF

cat >"$AGENTS/in.distributionos.awake.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>in.distributionos.awake</string>
  <key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-dims</string></array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
plutil -lint "$AGENTS"/in.distributionos.*.plist >/dev/null && echo "   three agents written"

say "loading"
for a in api tunnel awake; do launchctl bootstrap "gui/$UID_N" "$AGENTS/in.distributionos.$a.plist"; done
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/health | grep -q 200; then echo "   API up on :3100"; break; fi
  sleep 2
done

if [ "$KIND" = named ]; then
  API_URL="https://api.$DOMAIN"
else
  for i in $(seq 1 30); do
    API_URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOGS/tunnel.err.log" "$LOGS/tunnel.log" 2>/dev/null | head -1 | cut -d: -f2- | sed 's#^//#https://#')" || true
    [ -n "$API_URL" ] && break
    sleep 2
  done
  [ -n "$API_URL" ] || { echo "no tunnel address in $LOGS/tunnel.err.log"; exit 1; }
fi
for i in $(seq 1 30); do
  if curl -s -m 10 -o /dev/null -w '%{http_code}' "$API_URL/health" | grep -q 200; then echo "   public API: $API_URL"; break; fi
  sleep 3
done

say "publishing the website against $API_URL ($KIND tunnel)"
( cd "$REPO/frontend" && CLOUDFLARE_API_TOKEN="$(cat "$CF_TOKEN_FILE")" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" DOMAIN="$DOMAIN" PAGES_PROJECT=dos PAGES_BRANCH=main EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_AUTH_URL="$API_URL/auth" ./scripts/pages-deploy.sh dos )

say "done — https://www.$DOMAIN talks to $API_URL; logs in $LOGS; to stop everything: launchctl bootout gui/$UID_N/in.distributionos.{api,tunnel,awake}"
[ "$KIND" = quick ] && echo "   (quick tunnel: after a reboot or a tunnel restart the address changes — rerun this script)"
