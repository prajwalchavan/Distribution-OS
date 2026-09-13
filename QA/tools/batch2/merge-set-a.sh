#!/bin/bash
export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH
eval "$(fnm env)"; fnm use 24 >/dev/null
MAIN="/Users/prajwalchavan/Desktop/Distribution OS"
LD="$HOME/.dos-qa-logs/logs"; LOG="$LD/b2-merge-set-a.log"; : > "$LOG"
PG="-h 127.0.0.1 -p 5439 -U dos"
CO="Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
fail() { say "FAILED: $*"; exit 1; }

cd "$MAIN" || fail "cd main"
git merge --no-ff -q c2c472f -m "Merge QA batch 2 lane h1-money slice 1: DOS-032+059 receipt numbers unique per series and financial year, self-healing counter

Verifier: red before, green after, amendments (a)-(e) satisfied. Fable merge review:
QA/evidence/batch2/merge-reviews/h1-money-slice1.md (MERGE, no blockers).

$CO" >>"$LOG" 2>&1 || { git merge --abort 2>/dev/null; fail "merge c2c472f into main"; }
say "merged h1 slice 1 -> $(git rev-parse --short HEAD)"

lane_merge() {
  local lane="$1" msg="$2" wt="$MAIN/.claude/worktrees/b2-$1"
  cd "$wt" || fail "cd $lane"
  [ -z "$(git status --short)" ] || fail "$lane worktree dirty before merge"
  git merge -q main -m "Merge main into qa/b2-$lane before merging it back

$CO" >>"$LOG" 2>&1 || { git merge --abort 2>/dev/null; fail "merge main into $lane"; }
  cd "$wt/backend" || fail "cd $lane/backend"
  pnpm install --frozen-lockfile --prefer-offline >>"$LOG" 2>&1 || fail "install $lane"
  pnpm exec turbo run build --filter=@dos/contracts --filter=@dos/core >>"$LOG" 2>&1 || fail "build $lane"
  pnpm docs:readme >>"$LOG" 2>&1 || fail "docs:readme $lane"
  pnpm docs:readme:check >>"$LOG" 2>&1 || fail "docs:readme:check $lane"
  cd "$wt" || fail "cd $lane"
  git add -A -- 'backend/*/README.md' 'frontend/*/README.md'
  if ! git diff --cached --quiet; then
    git commit -q -m "docs($lane): regenerate service and app READMEs on the merged tree

$CO" || fail "commit readmes $lane"
  fi
  [ -z "$(git status --short)" ] || say "WARNING $lane dirty after readme: $(git status --short | head -5 | tr '\n' ' ')"
  cd "$MAIN" || fail "cd main"
  git merge --no-ff -q "qa/b2-$lane" -m "$msg" >>"$LOG" 2>&1 || { git merge --abort 2>/dev/null; fail "merge $lane into main"; }
  say "merged $lane -> $(git rev-parse --short HEAD)"
}

lane_merge h5-orders "Merge QA batch 2 lane h5-orders: DOS-003 order lines carry variantName, DOS-004 approvals name shop, order and amount

Verifiers: red before, green after, amendments satisfied. Fable merge review:
QA/evidence/batch2/merge-reviews/h5-orders.md (MERGE, no blockers).

$CO"
lane_merge h2-trips "Merge QA batch 2 lane h2-trips: DOS-043 only the crew and the desk depart a trip, never past a draft load sheet

Verifier: red before, green after, amendments satisfied. Fable merge review:
QA/evidence/batch2/merge-reviews/h2-trips.md (MERGE, no blockers).

$CO"
cd "$MAIN" && git push -q origin main >>"$LOG" 2>&1 && say "pushed main $(git rev-parse --short HEAD)" || say "PUSH FAILED (continuing)"

cd "$MAIN/backend" || fail "cd main backend"
T=dos_test_batch2b_template
createdb $PG $T >>"$LOG" 2>&1 || fail "createdb $T"
DATABASE_URL="postgres://dos:dos@127.0.0.1:5439/$T" pnpm db:migrate >>"$LOG" 2>&1 || fail "migrate $T"
DATABASE_URL="postgres://dos:dos@127.0.0.1:5439/$T" pnpm db:seed >>"$LOG" 2>&1 || fail "seed $T"
"$MAIN/QA/tools/seed/verify-seed.sh" $T > "$LD/b2-template-b-verify.log" 2>&1
say "template $T verify pass=$(grep -cE '\| t$' "$LD/b2-template-b-verify.log") fail=$(grep -cE '\| f$' "$LD/b2-template-b-verify.log")"
say "duplicate receipt numbers in $T: $(psql $PG -d $T -Atc "select count(*) from (select 1 from receipts where receipt_no is not null group by tenant_id, series_code, fy, receipt_no having count(*) > 1) d")"

for l in h2 h5; do
  dropdb $PG --force dos_test_b2_$l >>"$LOG" 2>&1 || fail "dropdb dos_test_b2_$l"
  createdb $PG -T $T dos_test_b2_$l >>"$LOG" 2>&1 || fail "createdb dos_test_b2_$l"
done
say "lane databases h2 and h5 recreated from $T"

lane=h7-syncdoor; wt="$MAIN/.claude/worktrees/b2-$lane"; db=dos_test_b2_h7
git -C "$MAIN" worktree add "$wt" -b "qa/b2-$lane" main >>"$LOG" 2>&1 || fail "worktree $lane"
createdb $PG -T $T $db >>"$LOG" 2>&1 || fail "createdb $db"
sed "s#^DATABASE_URL=.*#DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/$db#" "$MAIN/backend/.env" > "$wt/backend/.env"
( cd "$wt/backend" && pnpm install --frozen-lockfile --prefer-offline && pnpm exec turbo run build --filter='./libs/*' && cd "$wt/frontend" && pnpm install --frozen-lockfile --prefer-offline ) > "$LD/b2-$lane-setup.log" 2>&1 || fail "setup $lane (see $LD/b2-$lane-setup.log)"
say "lane $lane ready on $(git -C "$wt" rev-parse --short HEAD) with $db"
say "ALL DONE"
