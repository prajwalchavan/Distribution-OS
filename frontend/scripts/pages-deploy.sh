#!/usr/bin/env bash
# Build ONE web app and publish it to Cloudflare Pages.
#
#   cd frontend && DOMAIN=distributionos.in ./scripts/pages-deploy.sh owner
#   cd frontend && DOMAIN=distributionos.in PAGES_PROJECT=dos-web ./scripts/pages-deploy.sh dos
#
# Why a script and not a workflow: nothing deploys automatically (docs/30 is the deploy). And why it
# takes the app as an argument: there are SEVEN web apps today and there will be ONE. The founder
# decided on 2026-09-21 (docs/22 §8) that role election and the single merged app land BEFORE
# go-live, the website included, and that the seven per-role web apps are retired at that merge —
# so `dos` is already a value this script accepts, and the day frontend/dos-app exists nothing here
# has to change.
#
# Expo inlines every EXPO_PUBLIC_* variable at BUILD time. A bundle built without DOMAIN carries
# http://127.0.0.1:3001 inside it and works only on the founder's Mac, so DOMAIN is required and
# there is no default.
#
# PAGES_DRY_RUN=1 prints the exact commands and changes nothing; that is what the DEP-07 spec reads.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND="$(cd "$HERE/.." && pwd)"

APP="${1:-}"
[ -n "$APP" ] || {
  echo "usage: pages-deploy.sh <owner|manager|sales|warehouse|delivery|retailer|admin|dos>" >&2
  exit 1
}

# The all-in-one prefix each app's service answers on (docs/26 §7). `dos` is the merged app: it
# elects its role at sign-in, so it cannot be nailed to one service prefix at build time — it sends
# the origin and chooses the prefix per elected role at runtime.
case "$APP" in
  owner | manager | sales | warehouse | delivery | retailer | admin) PREFIX="/$APP" ;;
  dos) PREFIX="" ;;
  *)
    echo "unknown app: $APP" >&2
    echo "expected one of owner manager sales warehouse delivery retailer admin dos" >&2
    exit 1
    ;;
esac

PACKAGE="@dos/$APP-app"
APP_DIR="$FRONTEND/$APP-app"
PROJECT="${PAGES_PROJECT:-dos-$APP}"
BRANCH="${PAGES_BRANCH:-main}"
DRY="${PAGES_DRY_RUN:-0}"

: "${DOMAIN:?DOMAIN is required (e.g. DOMAIN=distributionos.in). Expo inlines the API URL at build time.}"
API_URL="${EXPO_PUBLIC_API_URL:-https://api.$DOMAIN}"
AUTH_URL="${EXPO_PUBLIC_AUTH_URL:-https://api.$DOMAIN/auth}"

if [ "$DRY" != "1" ] && [ ! -d "$APP_DIR" ]; then
  echo "no such app directory: $APP_DIR" >&2
  echo "(frontend/dos-app arrives with the merged app; until then deploy the seven)" >&2
  exit 1
fi

say() { echo "$@"; }
step() {
  say "+ $*"
  if [ "$DRY" != "1" ]; then
    eval "$@"
  fi
}

say "app:      $APP  ($PACKAGE)"
say "project:  $PROJECT   branch: $BRANCH"
say "EXPO_PUBLIC_API_URL=$API_URL"
# Both lines are printed FROM $PREFIX, the same variable the build command below exports, so the
# banner cannot drift from what the bundle gets. It used to say "(unset)" over a command that
# exported EXPO_PUBLIC_API_PREFIX='' — an empty string, which is not the same thing: Expo inlines an
# empty string, and a banner that disagrees with the command under it is how a wrong bundle ships.
if [ -n "$PREFIX" ]; then
  say "EXPO_PUBLIC_API_PREFIX=$PREFIX"
else
  say "EXPO_PUBLIC_API_PREFIX=$PREFIX   (the empty string, exported as one: the merged app elects its role at sign-in, and its service with it)"
fi
say "EXPO_PUBLIC_AUTH_URL=$AUTH_URL"

# --clear is not optional (QA S-192): Expo inlines EXPO_PUBLIC_* at build time and Metro caches the
# result, so an export after a change of API URL otherwise ships the PREVIOUS build's URL — the first
# publish of the one app went out carrying http://127.0.0.1:3210 and said "No connection" to everyone.
step "EXPO_PUBLIC_API_URL='$API_URL' EXPO_PUBLIC_API_PREFIX='$PREFIX' EXPO_PUBLIC_AUTH_URL='$AUTH_URL' pnpm --filter $PACKAGE run export:web --clear"

# expo exports a single-page bundle (`web.output: single` in every app.json). Without this rule
# Cloudflare Pages answers 404 for /orders/123 on a hard refresh or a shared link — every deep link
# anyone ever sends. Pages reads `_redirects` from the root of what is published.
DIST="$APP_DIR/dist"
say "+ write $DIST/_redirects"
if [ "$DRY" != "1" ]; then
  printf '/*    /index.html    200\n' >"$DIST/_redirects"
fi

# wrangler takes its account and token from CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN. The
# project has to exist first: `wrangler pages project create <project>`, once, per app (docs/30 §9).
step "pnpm dlx wrangler pages deploy '$DIST' --project-name $PROJECT --branch $BRANCH"

if [ "$DRY" = "1" ]; then
  say "(dry run: nothing was built and nothing was published)"
else
  say "published $APP to the $PROJECT Pages project on branch $BRANCH"
fi
