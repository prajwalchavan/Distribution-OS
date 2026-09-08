#!/bin/bash
# Phase 0 evidence on Android: install the app's debug build, point host:8081 at ITS Metro, wipe app data,
# verify the RIGHT bundle loaded (title check), sign in through adb, screenshot.
# Usage: ./android-login.sh <app> <webport> <user> <TitleWord>   e.g. ./android-login.sh sales 5175 rahul.deshmukh Sales
set -u
APP=$1; PORT=$2; USER_=$3; TITLE=${4:-}; PASS='Dos@1234'
ROOT="/Users/prajwalchavan/Desktop/Distribution OS"; T="$ROOT/QA/tools"
OUT="$ROOT/QA/evidence/phase0/android"; mkdir -p "$OUT"
export ANDROID_HOME=$HOME/Library/Android/sdk; export PATH="$ANDROID_HOME/platform-tools:$PATH"
PKG="in.distributionos.$APP"; TAG="$APP-$USER_"
ui() { python3 "$T/ui.py" "$@"; }   # $T contains a space — never expand it unquoted
for p in 3000 3001 3002 3003 3004 3005 3006 3007 $PORT; do adb reverse tcp:$p tcp:$p >/dev/null; done
# --- host:8081 -> this app's Metro. The debug APKs are plain RN debug builds fetching from 10.0.2.2:8081.
pkill -f "node .*proxy8081.mjs" 2>/dev/null; for i in 1 2 3 4 5 6; do lsof -nP -iTCP:8081 -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 1; done
nohup node "$T/proxy8081.mjs" $PORT </dev/null >/dev/null 2>&1 & disown
for i in 1 2 3 4 5; do curl -s -o /dev/null -H "Host: 10.0.2.2:8081" http://127.0.0.1:8081/status && break; sleep 1; done
curl -s -H "Host: 10.0.2.2:8081" http://127.0.0.1:8081/status | grep -q running || { echo "PROXY_DOWN $TAG"; exit 4; }
# --- fresh app: no session, no leftover text from a previous run
adb install -r "$ROOT/frontend/$APP-app/android/app/build/outputs/apk/debug/app-debug.apk" >/dev/null 2>&1 || { echo "INSTALL FAILED $TAG"; exit 1; }
adb shell am force-stop $PKG; adb shell pm clear $PKG >/dev/null; adb shell am start -n $PKG/.MainActivity >/dev/null 2>&1
# --- wait for the sign-in form AND the right app's title (guards against a stale/wrong bundle on :8081)
for i in $(seq 1 80); do sleep 3; ui has-edit && break; done
if ! ui has-edit; then adb exec-out screencap -p > "$OUT/$TAG-9-noform.png"; echo "NO_SIGN_IN_FORM $TAG: $(ui texts)"; exit 2; fi
if [ -n "$TITLE" ] && ! ui texts | grep -q "Distribution OS - $TITLE\|Distribution OS $TITLE"; then adb exec-out screencap -p > "$OUT/$TAG-9-wrongbundle.png"; echo "BUNDLE_MISMATCH $TAG expected '$TITLE': $(ui texts)"; exit 5; fi
adb exec-out screencap -p > "$OUT/$TAG-0-signin.png"
clear_field() { adb shell input keyevent KEYCODE_MOVE_END; adb shell input keyevent --longpress $(printf 'KEYCODE_DEL %.0s' $(seq 1 40)); }
adb shell input tap $(ui edit 1); sleep 1; clear_field; adb shell input text "$USER_"; sleep 1
adb shell input tap $(ui edit 2); sleep 1; clear_field; adb shell input text "$PASS"; sleep 1
adb shell input keyevent 111; sleep 1   # ESC closes the soft keyboard
adb exec-out screencap -p > "$OUT/$TAG-1-filled.png"
BTN=$(ui text "Sign in"); adb shell input tap $BTN
signin() { ui texts | grep -q "Use the username\|Invalid username"; }
for i in $(seq 1 25); do sleep 2; signin || break; done
sleep 5; adb exec-out screencap -p > "$OUT/$TAG-2-home.png"
if signin; then echo "STILL_ON_SIGN_IN $TAG: $(ui texts)"; exit 3; else echo "SIGNED_IN $TAG: $(ui texts)"; fi
