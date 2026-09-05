#!/bin/zsh
# Pushes any local commits on the current branch to origin.
# Runs from launchd every 30 minutes (see com.dos.git-auto-push.plist).
# Never commits: work is committed at checkpoints; this only ships what is committed.
set -euo pipefail
REPO="${1:-$HOME/Desktop/Distribution OS}"
cd "$REPO"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin "$BRANCH" 2>/dev/null || true
if git rev-parse -q --verify "origin/$BRANCH" >/dev/null && [ -z "$(git log "origin/$BRANCH..HEAD" --oneline)" ]; then
  echo "$(date '+%F %T') nothing to push"
else
  git push -u origin "$BRANCH"
  echo "$(date '+%F %T') pushed $BRANCH"
fi
