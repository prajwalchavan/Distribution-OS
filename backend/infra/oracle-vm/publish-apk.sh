#!/usr/bin/env bash
# Build the Android app from this checkout and put it at the download link the founder already hands out.
# Run by the founder on this Mac:
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/publish-apk.sh
#
# The link (~/.config/dos/apk-download.url) points at the object downloads/distribution-os.apk in the bucket
# dos-backups; putting a new file under the same name keeps the link. Prints the link at the end.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
export PATH="/opt/homebrew/bin:$PATH"
if command -v fnm >/dev/null 2>&1; then eval "$(fnm env)"; fnm use 24 >/dev/null 2>&1 || true; fi
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
APP="$REPO/frontend/dos-app"
APK="$APP/android/app/build/outputs/apk/release/app-release.apk"
URL_FILE="$HOME/.config/dos/apk-download.url"

echo "== 1 of 3: libraries and packages ($(git -C "$REPO" rev-parse --short HEAD))"
( cd "$REPO/backend" && pnpm install --frozen-lockfile --prefer-offline >/dev/null && pnpm exec turbo run build --filter='./libs/*' >/dev/null )
( cd "$REPO/frontend" && pnpm install --frozen-lockfile --prefer-offline >/dev/null )
echo "   built"

echo "== 2 of 3: the Android app (release, arm64; a few minutes)"
( cd "$APP" && EXPO_PUBLIC_API_URL=https://api.distributionos.in EXPO_PUBLIC_API_PREFIX= \
    EXPO_PUBLIC_AUTH_URL=https://api.distributionos.in/auth NODE_ENV=production \
    ./android/gradlew -p android assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain -q )
[ -s "$APK" ] || { echo "no APK at $APK"; exit 1; }
echo "   $(du -h "$APK" | cut -f1) $(basename "$APK"), built $(date '+%d %b %H:%M')"

echo "== 3 of 3: upload"
NS="$(oci os ns get --query data --raw-output)"
oci os object put --namespace "$NS" --bucket-name dos-backups --name downloads/distribution-os.apk \
  --file "$APK" --content-type application/vnd.android.package-archive --force >/dev/null
echo "   uploaded as downloads/distribution-os.apk"
echo
if [ -s "$URL_FILE" ]; then echo "download link (unchanged): $(cat "$URL_FILE")"; else echo "no link file at $URL_FILE"; fi
echo "on the phone: open the link, install over the old app (same signature, data kept), sign in again"
