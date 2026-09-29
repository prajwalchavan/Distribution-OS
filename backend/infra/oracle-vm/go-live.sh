#!/usr/bin/env bash
# Everything that puts main on the live site, in order. Run by the founder on this Mac:
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/go-live.sh
#
#   1. the backend release            (deploy.sh: rehearses the migrations on a restore, backs up, migrates, restarts)
#   2. the release checks on live     (release-checks.sh: they only read)
#   3. the dummy activity             (fill-demo.sh: rehearsal on a copy first, then the real site, then 06:00 every day)
#   4. the website                    (the libraries built here first, then frontend/scripts/pages-deploy.sh dos)
#
# Safe to run again: the release is the same code again, the fill writes nothing twice for one day, the
# website is published again. A step that fails is reported and the later steps still run, except that the
# dummy activity is not started when the release failed. No password is printed.
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$REPO/backend/infra/oracle-vm"
export PATH="/opt/homebrew/bin:$PATH"
if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)"; fnm use 24 >/dev/null 2>&1 || true; fi

R1=skipped; R2=skipped; R3=skipped; R4=skipped
line() { echo; echo "==================== $1"; }

line "1 of 4: backend release ($(git -C "$REPO" rev-parse --short HEAD))"
if bash "$HERE/deploy.sh"; then R1=PASS; else R1=FAIL; fi

line "2 of 4: release checks on the live database"
if [ "$R1" = PASS ]; then
  if bash "$HERE/release-checks.sh"; then R2=PASS; else R2=FAIL; fi
else
  echo "not run: the release failed"
fi

line "3 of 4: dummy activity (rehearsal on a copy first)"
if [ "$R1" = PASS ]; then
  if bash "$HERE/fill-demo.sh"; then R3=PASS; else R3=FAIL; fi
else
  echo "not run: the release failed"
fi

line "4 of 4: website"
TOKEN_FILE="$HOME/.config/dos/cloudflare.token"
if [ ! -s "$TOKEN_FILE" ]; then
  echo "no Cloudflare token at $TOKEN_FILE: the website is not published"
  R4=FAIL
else
  if (
    set -e
    cd "$REPO/backend"
    pnpm install --frozen-lockfile --prefer-offline >/dev/null
    pnpm exec turbo run build --filter='./libs/*' >/dev/null
    echo "   libraries built"
    cd "$REPO/frontend"
    pnpm install --frozen-lockfile --prefer-offline >/dev/null
    CLOUDFLARE_API_TOKEN="$(cat "$TOKEN_FILE")" CLOUDFLARE_ACCOUNT_ID=6730952ae1e2212f14c52d66a5339d35 \
      DOMAIN=distributionos.in PAGES_PROJECT=dos PAGES_BRANCH=main \
      EXPO_PUBLIC_API_URL=https://api.distributionos.in EXPO_PUBLIC_AUTH_URL=https://api.distributionos.in/auth \
      ./scripts/pages-deploy.sh dos
  ); then R4=PASS; else R4=FAIL; fi
fi

line "result"
echo "  backend release   $R1"
echo "  release checks    $R2"
echo "  dummy activity    $R3"
echo "  website           $R4"
LOGINS="$HOME/.config/dos/tester-logins.txt"
if [ -s "$LOGINS" ]; then
  echo
  echo "tester sign-ins (username, role); the passwords are in $LOGINS:"
  grep -v '^#' "$LOGINS" | awk -F'\t' 'NF>=1 && $1!="" {printf "  %-14s %s\n", $1, $3}'
fi
echo
echo "site: https://www.distributionos.in   api: https://api.distributionos.in/health"
[ "$R1" = PASS ] && [ "$R2" != FAIL ] && [ "$R3" != FAIL ] && [ "$R4" != FAIL ]
