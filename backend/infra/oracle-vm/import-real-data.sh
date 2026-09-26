#!/usr/bin/env bash
# Load the TradeEzee extracts into the REAL database (dos_live) on the Oracle VM, from this Mac.
# The extracts never leave this Mac: the importer runs here and reaches the VM's Postgres through an SSH
# tunnel (Postgres listens on the VM's loopback only). Safe to rerun: it is idempotent (docs/32).
#
#   cd ~/Desktop/Distribution\ OS && bash backend/infra/oracle-vm/import-real-data.sh
#
# Optional: AS_OF=YYYY-MM-DD (books opened as of that day; default today), DIR=<folder with the extracts>.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIR="${DIR:-$HOME/Downloads/retradeezzzrepbackup}"
AS_OF="${AS_OF:-$(date +%F)}"
KEY="$HOME/.ssh/dos_oracle"; VM="ubuntu@92.4.84.106"; SOCK="/tmp/dos-import-tunnel.sock"; PORT=5440
LOG="$HOME/Library/Logs/dos/import-live.log"; PYV="$HOME/.config/dos/pyvenv"
mkdir -p "$(dirname "$LOG")"
export PATH=/opt/homebrew/bin:$PATH; eval "$(fnm env)"; fnm use 24 >/dev/null

[ -f "$DIR/TE2627.bak" ] || { echo "no extracts in $DIR"; exit 1; }
[ -x "$PYV/bin/python" ] || { python3 -m venv "$PYV" && "$PYV/bin/pip" -q install pypdf; }

DBPW="$(ssh -i "$KEY" "$VM" 'cat /opt/dos/env/db.pw')"
ssh -i "$KEY" -M -S "$SOCK" -f -N -o ExitOnForwardFailure=yes -L "$PORT:127.0.0.1:5432" "$VM"
trap 'ssh -i "$KEY" -S "$SOCK" -O exit "$VM" 2>/dev/null || true' EXIT

echo "importing into dos_live on the Oracle VM (as of $AS_OF) — log: $LOG"
cd "$REPO/backend"
LEGACY_PYTHON="$PYV/bin/python" DATABASE_URL="postgres://dos:${DBPW}@127.0.0.1:${PORT}/dos_live" \
  pnpm import:legacy --dir "$DIR" --bak "$DIR/TE2627.bak" --tenant tarsun --commit --opening-stock \
  --outstanding-from-backup --as-of "$AS_OF" 2>&1 | tee "$LOG" | tail -50
echo "done — tell Claude"
