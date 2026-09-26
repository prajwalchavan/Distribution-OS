# 33 · Running Distribution OS in production — the handover

Written 2026-09-26 (the day the real data went live). Everything below was executed at least once
that day unless it says otherwise. Read `docs/30` for the Docker path that was NOT taken; production
runs natively on the VM.

## 1. What runs where

| Piece | Where | How it runs | Proof |
| --- | --- | --- | --- |
| Website (the one app, all six roles) | Cloudflare Pages project `dos` → `https://www.distributionos.in` (apex redirects) | static export, published by `frontend/scripts/pages-deploy.sh dos` | 200 on `/` |
| API (all-in-one: auth + six services + inline worker) | Oracle Always Free VM, Mumbai, `92.4.84.106` (2 OCPU / 12 GB arm64, Ubuntu 24.04) | `systemd` unit `dos-api@live` on :3100 (`/opt/dos/env/live.env`, database `dos_live`) | `https://api.distributionos.in/health` |
| Demo copy | same VM | `dos-api@demo` on :3200 (`/opt/dos/env/demo.env`, database `dos_demo`, seed logins `Dos@1234`) — VM-local only | `curl 127.0.0.1:3200/health` on the VM |
| Database | same VM, Postgres 17 on 127.0.0.1:5432 only | `postgresql` service; role `dos` (password in `/opt/dos/env/db.pw`) | no inbound 5432 (checked from outside) |
| Public address for the API | Cloudflare named tunnel `dos-mac` | `dos-tunnel.service` on the VM (`/opt/dos/env/tunnel.env`), outbound-only; the VM opens no port but 22 | 200 through the tunnel one minute after a reboot |
| Android app | the founder's phone (APK, debug-signed, arm64) | download link in `~/.config/dos/apk-download.url` (30 days); build command in §5 | installed and signed in 2026-09-26 |
| Backups | VM `/var/backups/dos/daily` (7 days) + Oracle Object Storage bucket `dos-backups` (write-only URL) | cron `30 20 * * *` UTC = 02:00 IST, `/opt/dos/backup-local.sh` | restore drill §4 |

Logins: `~/.config/dos/live-staff-logins.txt` on the founder's Mac (mode 600; never in git or chat).
The five "(test)" staff are placeholders to rename or disable in Settings → Staff.

## 2. Day to day (from the Mac)

```bash
ssh -i ~/.ssh/dos_oracle ubuntu@92.4.84.106                     # the box
sudo systemctl status dos-api@live dos-api@demo dos-tunnel postgresql
sudo journalctl -u dos-api@live -n 200 --no-pager               # API log
sudo journalctl -u dos-tunnel -n 50 --no-pager                  # tunnel log
sudo -u postgres psql -d dos_live -c '\dt' | tail -5            # the data
```

## 3. Deploying a change

1. Backend (API): `bash backend/infra/oracle-vm/deploy.sh` — rsync, install, build, migrate live + demo, restart, public health.
2. Website: `cd frontend && CLOUDFLARE_API_TOKEN="$(cat ~/.config/dos/cloudflare.token)" CLOUDFLARE_ACCOUNT_ID=6730952ae1e2212f14c52d66a5339d35 DOMAIN=distributionos.in PAGES_PROJECT=dos PAGES_BRANCH=main EXPO_PUBLIC_API_URL=https://api.distributionos.in EXPO_PUBLIC_AUTH_URL=https://api.distributionos.in/auth ./scripts/pages-deploy.sh dos` (the script exports with `--clear`; a cached export ships a stale API URL — S-192).
3. Android: §5.
4. Rollback: `git checkout <previous sha>` on the Mac, run 1 and 2 again. Migrations are expand-only and stay.

## 4. Backups and the restore drill

Nightly: every `dos_*` database as a custom-format dump + cluster globals, kept 7 days locally and
uploaded to the bucket through a pre-authenticated write-only URL (`/opt/dos/env/backup-par.url`,
expires 2027-09; the bucket is not readable from the VM). To restore into a scratch database and
compare (run 2026-09-26 — see the STATE file for the counts):

```bash
D=/var/backups/dos/daily; F=$(ls -t $D/dos_live-*.dump | head -1)
sudo -u postgres createdb -O dos dos_restore_drill
sudo -u postgres pg_restore -d dos_restore_drill --no-owner --role=dos "$F"
sudo -u postgres psql -d dos_restore_drill -c 'select count(*) from retailers'
sudo -u postgres psql -c 'drop database dos_restore_drill'
```

To restore FOR REAL: stop `dos-api@live`, rename `dos_live` aside, create `dos_live`, `pg_restore`
into it, start the service. The cluster roles (`app_rw`, `app_worker`) exist already on this box; on
a NEW box apply `globals-<stamp>.sql` first, then the dump.

## 5. The Android APK

```bash
cd frontend/dos-app && export ANDROID_HOME=$HOME/Library/Android/sdk JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home PATH="$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH"
EXPO_PUBLIC_API_URL=https://api.distributionos.in EXPO_PUBLIC_API_PREFIX= EXPO_PUBLIC_AUTH_URL=https://api.distributionos.in/auth NODE_ENV=production \
  ./android/gradlew -p android assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
# → android/app/build/outputs/apk/release/app-release.apk (~58 MB); upload with the OCI CLI to
#   bucket dos-backups, object downloads/distribution-os.apk, and mint a read pre-authenticated URL.
```

The release build is signed with the DEBUG keystore (`android/app/build.gradle`): fine for sideloading,
not for the Play Store. A store build needs its own upload key — a later step.

## 6. Keys and rotations

- Cloudflare API token (`~/.config/dos/cloudflare.token`): edits DNS, Pages, tunnel. The live site does
  not depend on it; only publishing does. Roll it in the dashboard, then `pbpaste > ~/.config/dos/cloudflare.token`.
- Tunnel token (`/opt/dos/env/tunnel.env` on the VM): rotating it = a new tunnel; not needed.
- Anthropic key (real bill scanning): `pbpaste | ssh -i ~/.ssh/dos_oracle ubuntu@92.4.84.106 /opt/dos/set-anthropic-key.sh` (stdin only, never argv).
- Owner password: change it in the app at first sign-in.

## 7. Re-importing the old software's data

`bash backend/infra/oracle-vm/import-real-data.sh` (extracts stay on the Mac; SSH tunnel to the VM's
Postgres; idempotent — re-running adds only what is new; `AS_OF=YYYY-MM-DD` sets the cut-over day).
`docs/32` has the mapping and the open data-quality list.

## 8. Not done (say so, never "passed")

Docker image build (docs/30 §12); Play Store / iOS builds; R2 (Cloudflare) backups — the bucket is
Oracle's; lifecycle deletion in the bucket (needs a service policy); a second VM or any HA.
