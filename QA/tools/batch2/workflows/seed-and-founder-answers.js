export const meta = {
  name: 'qa-batch2-seed-and-founder-answers',
  description: 'Two code lanes: fix the three faults that disarmed the main-health smoke gate, and build the three product answers the founder gave on 2026-09-20',
  phases: [
    { title: 'Build', detail: 'test-first implementation, then an adversarial verifier, then a Fable review' },
    { title: 'Smoke', detail: 'after the seed lane merges: one observed pnpm smoke on a fresh seed, which is what re-arms the main-health gate' },
    { title: 'Integrate', detail: 'merge main in, full gates, verify, merge into main one lane at a time' },
  ],
}

/**
 * Batch 2's lanes are all merged. Two pieces of it are not: the three faults that made "0 BROKEN"
 * unreachable and so disarmed the main-health gate (S-149, S-156, S-157), and the three product answers
 * the founder gave on 2026-09-20 that need code (DOS-075, DOS-043, and the rest of the DOS-023 list
 * convention). Both are code-only — no device — so they run while the devices are free for the walks.
 *
 * The smoke lane matters more than its size suggests. Until one observed `pnpm smoke` reads 0 BROKEN on a
 * fresh seed and is recorded in QA/STATE.md with its commit hash, NOBODY in this programme may be held to
 * 0 BROKEN, and every lane's smoke evidence is weaker than it looks. S-157 carries the sharpest half of it:
 * a harness that cannot tell "no demo row qualifies" from "this endpoint is broken" makes every 0-BROKEN
 * claim worthless, whichever way it errs.
 */

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const WALKS = MAIN + '/QA/evidence/batch2/walks'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
const LIMIT = 3

const LANES = [
 {
  "key": "fix-seed-harness",
  "app": "backend/seed",
  "track": "build",
  "ids": [
   "S-149",
   "S-156",
   "S-157"
  ],
  "defer": [],
  "db": "dos_test_b2_seed_harness",
  "ownsFiles": [
   "backend/libs/core/src/service/examples.ts",
   "backend/libs/database/src/seed-demo/warehouse.ts",
   "backend/libs/database/src/seed-demo/procurement.ts",
   "backend/libs/database/src/seed-demo/index.ts",
   "backend/tools/smoke-endpoints.mts",
   "backend/libs/core/src/docs/examples.spec.ts"
  ],
  "notes": "These three are what disarmed the main-health gate. Fixing them, then ONE observed `pnpm smoke` reading 0 BROKEN on a fresh seed, is what re-arms it (QA/STATE.md, section 'The smoke gate, reshaped').",
  "carry": [
   {
    "severity": "blocker",
    "detail": "S-149. `backend/libs/core/src/service/examples.ts` builds the `ownNotices` example by taking the newest rows of the TENANT and then filtering, so on the manager and warehouse lanes the example is a notice that does not belong to the signed-in user and `notifications.markRead` answers BROKEN. The filter must run BEFORE any limit: in_app/push only, `recipient_user_id` set and equal to the signed-in user, never a retailer recipient \u2014 then take the newest. Proof: `pnpm smoke` on a fresh seed shows `markRead` OK on BOTH the manager and the warehouse lane."
   },
   {
    "severity": "blocker",
    "detail": "S-156. The seed leaves one PARKED pack, so a smoke path that expects a pack it can act on finds a parked one and reports BROKEN. Either the seed must not leave a pack parked, or the example must pick a pack in a state the operation accepts. Decide which is honest \u2014 a parked pack is a real state the warehouse has \u2014 and make the example choose correctly rather than removing the state from the demo data."
   },
   {
    "severity": "blocker",
    "detail": "S-157. The seed leaves one OPEN gate-count discrepancy, with the same consequence. Same rule as S-156: the demo data may keep the state; the example must not pick a row the operation will refuse. SEPARATELY and bindingly: `backend/tools/smoke-endpoints.mts` must report an INVENTED path id as SKIPPED with the reason 'no demo row qualifies', never BROKEN \u2014 a harness that cannot tell 'no data for this case' from 'this endpoint is broken' makes every 0-BROKEN claim worthless. Prove it by feeding the harness an id that cannot exist and reading SKIPPED."
   }
  ]
 },
 {
  "key": "founder-answers",
  "app": "cross",
  "track": "build",
  "ids": [
   "DOS-075",
   "DOS-023",
   "DOS-043"
  ],
  "defer": [],
  "db": "dos_test_b2_founder_answers",
  "ownsFiles": [
   "backend/libs/domain/src/pricing/schemes.ts",
   "backend/libs/domain/src/pricing/schemes.test.ts",
   "backend/libs/core/src/modules/delivery/trips.service.ts",
   "backend/libs/core/src/modules/delivery/delivery.spec.ts",
   "backend/libs/contracts/src/delivery.ts",
   "backend/libs/database/src/schema/delivery.ts"
  ],
  "notes": "The founder answered four open product questions on 2026-09-20 ('I agree with all recommendations go ahead with this decisions'). Three of them need code; the fourth (DOS-057/099, no permanent public link) needs none. The rows are in docs/22 \u00a78 dated 2026-09-20 \u2014 read them there, not from this note.",
  "carry": [
   {
    "severity": "blocker",
    "detail": "DOS-075, founder 2026-09-20. A scheme threshold counts EVERY line on the bill, including lines already under an exclusive scheme, while those lines still earn nothing from the threshold scheme. Today `priceOrder()` leaves exclusive lines out of the threshold sum, so 'bills over Rs X' misses bills that really are over X. Fix it in `backend/libs/domain/src/pricing/schemes.ts` only: the threshold sum includes the exclusive lines; the allocation of the threshold scheme's benefit still excludes them. Every order and invoice line must keep an `applied_rules` that reads true. Test-first, and pin BOTH halves (counted toward the threshold; earned nothing from it)."
   },
   {
    "severity": "blocker",
    "detail": "DOS-043, founder 2026-09-20. A trip may depart BEFORE its planned date, and the early departure is recorded: the trip carries its planned date and 'departed early' beside it. Today departure before the planned date is refused. Keep the 2026-09-12 rule unchanged (only the owner, the manager and the delivery crew may depart, and never while the load sheet is a draft). Add the record, not a silent allowance \u2014 a reader must be able to see that a trip left early and on which date it was planned."
   },
   {
    "severity": "major",
    "detail": "DOS-023, founder 2026-09-20, THE CONVENTION ONLY. Every list in every app orders by server time, newest first, the record id only as a tie-break. `lean-manager-order-lifecycle` already applied it to the desk lists (orders by `created_at`; bills and trips by their own date column, recorded in docs/22 as the ONE stated exception, still to be confirmed by the founder). Your job is the REST: find every remaining list that still orders by record id and move it to server time, in the backend query and in the contract's documented order. Do NOT touch the bills/trips exception \u2014 it is with the founder. List what you changed, one line each, and what you deliberately left."
   }
  ]
 }
]

const wt = (g) => MAIN + '/.claude/worktrees/b2-' + g.key
const branchOf = (g) => 'qa/b2-' + g.key
const build = (g) => g.ids.filter((id) => !g.defer.includes(id))

const blocks = (g) => build(g).map((id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); if [ -n "$n" ]; then sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'; else grep -n '^| ${id} ' "${FIND}"; fi`).join(' ; ')

const LIMITS = `HOUSE RULES OF THIS PROGRAMME — they override any habit:
- Never report a command you did not run or an outcome you did not see. "not-tested" is an honest answer and is always accepted; an invented one is the only unforgivable result.
- Test data only. Destructive work only on a database whose name carries "test". dos and dos_qa are never touched from a lane.
- zsh here has no \${PIPESTATUS[0]}: capture an exit code with "cmd > log 2>&1; echo $?".
- vitest 4: run one file as "pnpm --filter <pkg> exec vitest run <file>".
- If a git operation is refused by the tool permission layer, try twice, then return blocked with the exact command — do not work around it.`

const RULES = `PRODUCT RULES that outrank any instruction below:
- docs/22-source-of-truth.md is what the founder has decided; read it before changing behaviour, never a note elsewhere.
- Money is integer paise, quantities integer pieces, business dates IST. Mutations are idempotent and carry the client UUIDv7 id.
- A screen imports only @dos/ui (plus expo-router, @dos/api-client, @dos/offline, @dos/domain, @dos/contracts) — never react-native or react-dom.
- Never widen a permission, a policy or a validation to make a test pass. Purchase cost never reaches a salesperson, delivery or retailer role; a shop's credit limit and outstanding never reach the shop's own device.
- Never say work is saved when it is not, and never claim a reading the device did not take.`

const env = (g, walk) => `ENVIRONMENT — read carefully:
- Your worktree is "${wt(g)}" on branch ${branchOf(g)}. Start EVERY Bash command with: cd "${wt(g)}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${g.db}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree — other lanes are live there. You MAY READ ${MAIN}/QA/.
- Database: ${g.db} is a copy of dos_test_batch2b_template; you may drop and recreate ONLY it. Never connect to dos, dos_qa or a template.
- 8 GB RAM shared with other agents: ONE spec or test file per command unless a step names a wider gate.
- Libraries are consumed from dist: after editing @dos/contracts or @dos/core rebuild them (cd backend && pnpm exec turbo run build --filter=<pkg>...).
- No git stash, reset --hard, rebase, push or branch deletion.
- Do NOT edit docs/22, docs/18, CLAUDE.md or anything under QA/ except the one output file a step names.
${walk ? `- THIS STAGE MAY START SERVICES. Port rule, absolute: if :3000-:3007 are already held, do NOT kill what you did not start — run the all-in-one process on :3100 (cd backend && PORT_BASE unset; pnpm --filter @dos/all-in-one dev, or the service you need on its own free port) and point the app at it with EXPO_PUBLIC_API_URL. Stop only what you started, before you return.
- Android: export ANDROID_HOME=$HOME/Library/Android/sdk; export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"; emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save. iOS: drive the simulator headlessly with xcrun simctl only — NEVER open the simulator panel in the Claude app.` : '- Do NOT start dev servers, emulators or simulators.'}
- THIS LANE OWNS THESE FILES; another lane owns every other file:
${g.ownsFiles.map((f) => '  ' + f).join('\n')}`

const carried = (g) => g.carry.map((p, i) => `(${i + 1}) [${p.severity}] ${p.detail}`).join('\n\n')

const preparePrompt = (g) => `Prepare an isolated lane for Distribution OS QA batch 2, lane ${g.key}. Mechanical setup only — write no product code.

${LIMITS}

1. cd "${MAIN}" && git rev-parse --short main — record it as the base.
2. If "${wt(g)}" does not exist: git -C "${MAIN}" worktree add -b ${branchOf(g)} "${wt(g)}" main. If it exists, cd into it, confirm the branch is ${branchOf(g)} and git merge --ff-only main (return blocked if it cannot fast-forward).
3. Database: dropdb -h 127.0.0.1 -p 5439 -U dos --force ${g.db} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${g.db}
4. In the worktree make sure backend/.env points at ${g.db} and nothing else.
5. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install
6. git status --short must be clean apart from the .env you pointed at your own database. Return the structured result.`

const PREP = {
  type: 'object',
  properties: { group: { type: 'string' }, status: { type: 'string', enum: ['ready', 'blocked'] }, base: { type: 'string' }, notes: { type: 'string' } },
  required: ['group', 'status', 'notes'],
}

const buildPrompt = (g) => `You are building a batch of already-decided changes in Distribution OS, in an isolated worktree, as a careful senior engineer. Lane: ${g.key} (${g.app}). Items: ${g.ids.join(', ')}.

${env(g)}

${RULES}

${LIMITS}

${g.notes ? 'LANE NOTES: ' + g.notes : ''}

WHAT MUST BE TRUE WHEN YOU ARE DONE (binding; each item is its own commit):

${carried(g)}

Context you should read first:
  ${blocks(g)}
Re-read every source file before editing: main has moved a long way.

For EACH item, in the order listed:
STEP 1: write the red-first test whose name carries the item's id, run it, and confirm it FAILS for the stated reason. Keep the excerpt.
STEP 2: make the smallest fix that turns it green, inside this lane's own files.
STEP 3: run that test file whole, then typecheck and lint the packages you touched; prettier --write on touched files.
STEP 4: commit that item alone: "fix(<ID>): <one line>" + two sentences + "Test: <file> › <name>" + ${CO}.
If an item cannot be done without leaving this lane's files, say so in deviations rather than reaching outside them. If the decided behaviour turns out to be wrong once you read the code, STOP on that item and say why — a founder decision is not changed by an implementer.
Finish with git status clean and return the structured result.`

const repairPrompt = (g) => `You are repairing lean group ${g.key} for Distribution OS. Its adversarial verifier proved real defects in the work on this branch. Fix them properly — at the cause, test-first — or say honestly that you could not.

${env(g)}

${RULES}

${LIMITS}

WHAT THE VERIFIER PROVED (binding; every one of these must end resolved or explicitly returned as blocked):

${carried(g)}

Design and findings for context:
  cat "${VERD}/lean-${g.key}.md"
  ${blocks(g)}

For EACH problem above, in order:
STEP 1: reproduce it. Write or run the test that fails for the verifier's stated reason and keep the excerpt. If you cannot reproduce it, say so with the evidence rather than "fixing" it blind.
STEP 2: fix the real cause, inside this lane's own files. A leak is closed by not sending the field, never by hiding it in the app. A test that proves a different mechanism than its name claims is rewritten to prove the named one. An item the design forbade is REMOVED, not kept.
STEP 3: run the whole test file, then typecheck and lint the packages you touched; prettier --write on touched files.
STEP 4: commit it alone: "fix(<ID>): address verification — <one line>" + two sentences + "Test: <file> › <name>" + ${CO}. Never rewrite history.
Finish with git status clean and return the structured result.`

const reverifyPrompt = (g, r) => `You are the adversarial verifier of lean group ${g.key} for Distribution OS, second round. The lane has just been repaired after you (or your predecessor) proved defects in it. Assume the repair is cosmetic until you prove otherwise. You make no commits.

${env(g)}

${RULES}

${LIMITS}

The problems the repair was asked to close:

${carried(g)}

Repair report: ${JSON.stringify(r, null, 1)}

1. git log --oneline main..HEAD — the repair commits exist and touch only this lane's owned files.
2. For EACH problem above: read the code ON HEAD that is supposed to close it and show it. Then prove it red: reverse that commit's non-test change (git diff C^ C -- . ':(exclude)**/*.spec.ts' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' | git apply -R), rebuild any affected library, run the test, confirm it FAILS for the right reason, restore with git checkout -- . and rebuild.
3. Re-run every whole test file this lane touched.
4. Hunt again: a test weakened instead of a fix made; a leak moved rather than closed; a permission or validation relaxed; a deferred item still present; a claim in the report that the code does not support.
verdict 'pass' only when every listed problem is closed on HEAD and proven. A remaining MAJOR that is purely a walk still owed is reported as a major and does NOT by itself make the verdict 'fail' — say plainly that it is owed, not done.`

const rereviewPrompt = (g, r, v) => `You are Fable, the ARCHITECT of the Distribution OS QA programme. You reviewed lean group ${g.key} before; its verifier then proved defects, and the lane has been repaired. Review the repaired branch before it merges into main. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes.

GROUP ${g.key} (${g.app}), branch ${branchOf(g)}:
  git -C "${MAIN}" log --oneline main..${branchOf(g)} ; git -C "${MAIN}" diff main...${branchOf(g)}
Your earlier review: cat "${REV}/${g.key}.md"
Design and findings:
  cat "${VERD}/lean-${g.key}.md"
  ${blocks(g)}

The defects the repair was asked to close:

${carried(g)}

Repair report: ${JSON.stringify(r, null, 1)}
Re-verification: ${JSON.stringify(v, null, 1)}

Judge: is each proven defect actually closed at the cause, or moved? Does the repair break anything the first review approved? Does the branch still match the design and the founder's decisions in docs/22? What must still be walked, and on which platform?
Be adversarial — you are the last reader before main.

Rewrite ${REV}/${g.key}.md (under 80 lines, and keep a two-line "First review" note at the top saying what changed since): **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside. Return the structured summary.`

const walkPrompt = (g) => `You are settling the one debt lean group ${g.key} still owes Distribution OS: a claim nobody has been allowed to MEASURE. Every earlier stage of this lane was forbidden to start a server, so the proof could not exist. You may start what you need.

${env(g, true)}

${RULES}

${LIMITS}

WHAT IS OWED (binding):

${carried(g)}

Also read the architect's review for the exact walks it lists: cat "${REV}/${g.key}.md"
And the findings themselves: ${blocks(g)}

HOW TO SETTLE IT:
1. Bring the lane up: cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${g.db} from dos_test_batch2b_template; pnpm db:migrate && pnpm db:seed. Start ONLY the services the walk needs, on free ports per the port rule above.
2. Walk what the review names, at the widths it names, on the platforms it names. MEASURE rather than eyeball: read the rendered geometry (element boxes, scroll offsets, what is inside the viewport) and say the numbers. A screenshot goes to ${WALKS}/${g.key}-<platform>-<screen>.png.
3. If the lane's debt is the SMOKE gate, run it the way the architect reshaped it on 2026-09-19 (QA/evidence/batch2/verdicts/DOS-175-177-blocker2-ruling.md, and QA/STATE.md "The smoke gate, reshaped"): the design's NAMED operations must read OK — never EXPECTED, never a 409 counted as green — on a fresh seed AND on a replay; no NEW BROKEN against main at the merge base with the same seed and the same --run-tag; nothing turns BROKEN on the replay. Absolute "0 BROKEN" is NOT this lane's bar and nobody may be held to it.
4. If the walk shows the claim is FALSE, say so plainly, fix it inside this lane's own files test-first, commit ("fix(<ID>): <one line>" + ${CO}) and walk again.
5. Write ${WALKS}/${g.key}.md: what you started and on which ports, each walk with its measured numbers, each screenshot path, and what is still not proven. Stop everything you started.
Return the structured result. "not-proven" for something you could not measure is an accepted answer; an invented measurement is not.`

const integratePrompt = (g, repairOf) => `You are the INTEGRATOR of lean group ${g.key} for Distribution OS. Main has moved since this lane was last integrated. Merge current main into the lane, resolve every remaining review blocker, prove the merged tree green and commit. You do NOT merge into main.

${env(g)}
- INTEGRATOR git: you may merge main INTO ${branchOf(g)}, use checkout --ours/--theirs while resolving, and merge --abort.

${RULES}

${LIMITS}

REVIEW (binding): cat "${REV}/${g.key}.md"
Every Blocker there was raised against the branch AS REVIEWED: a commit that already existed when the review was written is NEVER its fix. Resolve each with a new commit — a test that fails for the blocker's reason, then the fix — or return blocked with the reason.
A MAJOR that is purely "a platform walk is still owed" is NOT a blocker: carry it, name it in notes, and keep going. That distinction is the whole reason this run exists.

STEPS:
1. git merge main -m "Merge main into ${branchOf(g)} before merging it back" (resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this lane).
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${g.db} from the template and pnpm db:migrate; cd ../frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above; apply a minor only when it is one line inside this lane's files.
4. Gates on the merged tree:
   - backend, if touched: every spec file the lane touched (one per command); pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service that mounts a touched module; typecheck and lint for touched packages; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs).
   - frontend, if touched: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 --force — the --force matters: a turbo cache hit cannot prove the kit's CROSS-APP GUARDS (S-155); pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   A red test or guard is a blocker unless the identical command shows the identical failure on main — then return blocked and say so in notes.
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the integration verifier found problems; fix every blocker with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const iverifyPrompt = (g, r) => `You verify the integration of lean group ${g.key} before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${env(g)}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. For each merge commit: git show --cc; every hunk from both sides survived in the conflicted files.
3. REVIEW BLOCKERS: read them yourself (cat "${REV}/${g.key}.md"). For EACH, read the file:line it names ON HEAD and show the code that resolves it; prove one blocker fix red by reversing its non-test change, then restore.
4. Re-run the lane's own test files; for a frontend lane also pnpm exec turbo run test --continue --concurrency=1 --force in frontend; for a backend lane the touched spec files and docs:readme:check.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the tests pass. A walk still owed is a major to be named, not a reason to fail the verdict.`

const mergePrompt = (g, r) => `Merge the verified lean group ${g.key} into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${branchOf(g)} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${branchOf(g)} reports no conflict (else blocked). If any commit in git -C "${MAIN}" log ${branchOf(g)}..main touches a file this branch changed, return blocked: it needs re-integration.
4. git -C "${MAIN}" merge --no-ff ${branchOf(g)} -m "Merge QA batch 2 lean group ${g.key}: ${build(g).join(', ')}

Built test-first with an adversarial verifier; merge review by Fable (architect) at QA/evidence/batch2/merge-reviews/${g.key}.md; integration verified on the merged tree with the full frontend gate including the kit cross-app guards.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const RESULT = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
    itemsDone: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, test: { type: 'string' }, failBefore: { type: 'string' }, passAfter: { type: 'string' } }, required: ['id', 'test', 'failBefore', 'passAfter'] } },
    itemsSkipped: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    commits: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'string' },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['group', 'status', 'itemsDone', 'itemsSkipped', 'commits', 'deviations'],
}

const VERDICT = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    itemsChecked: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, redProven: { type: 'boolean' }, greenProven: { type: 'boolean' }, note: { type: 'string' } }, required: ['id', 'redProven', 'greenProven'] } },
    problems: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } }, required: ['severity', 'detail'] } },
    evidence: { type: 'string' },
  },
  required: ['group', 'verdict', 'problems', 'evidence'],
}

const REVIEW = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    decision: { type: 'string', enum: ['MERGE', 'MERGE AFTER FIXES', 'DO NOT MERGE'] },
    blockers: { type: 'array', items: { type: 'string' } },
    minors: { type: 'array', items: { type: 'string' } },
    walks: { type: 'array', items: { type: 'string' } },
    defectsOutside: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['group', 'decision', 'blockers', 'file'],
}

const WALK = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['proven', 'partly-proven', 'not-proven', 'claim-false-and-fixed'] },
    started: { type: 'string' },
    walks: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, platform: { type: 'string' }, measured: { type: 'string' }, screenshot: { type: 'string' }, verdict: { type: 'string' } }, required: ['what', 'platform', 'measured', 'verdict'] } },
    stillNotProven: { type: 'array', items: { type: 'string' } },
    commits: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['group', 'status', 'walks', 'stillNotProven', 'file'],
}

const INTEG = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    status: { type: 'string', enum: ['ready', 'blocked'] },
    headCommit: { type: 'string' },
    mergedMainAt: { type: 'string' },
    blockersResolved: { type: 'array', items: { type: 'string' } },
    gates: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string' } }, required: ['command', 'outcome'] } },
    carriedMajors: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['group', 'status', 'notes'],
}

const IVERDICT = {
  type: 'object',
  properties: {
    group: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    problems: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } }, required: ['severity', 'detail'] } },
    evidence: { type: 'string' },
  },
  required: ['group', 'verdict', 'problems', 'evidence'],
}

const MERGED = {
  type: 'object',
  properties: { group: { type: 'string' }, status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, reason: { type: 'string' } },
  required: ['group', 'status'],
}

// A lane stops on a failed verdict or a blocker. A MAJOR is carried and logged — never dropped, never a
// silent merge, but never a reason to hold work its own architect has cleared. This is the corrected form
// of the gate that stopped four proven lanes in wf_2c3fe029-0c9.
const stops = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity === 'blocker')

let slots = LIMIT
const waiters = []
const acquire = () => (slots > 0 ? ((slots -= 1), Promise.resolve()) : new Promise((res) => waiters.push(res)))
const release = () => { const w = waiters.shift(); if (w) w(); else slots += 1 }
let mergeChain = Promise.resolve()
const serialized = (fn) => { const p = mergeChain.then(fn, fn); mergeChain = p.catch(() => {}); return p }

async function runLane(g) {
  const out = { group: g.key, track: g.track, ids: g.ids, carriedIn: g.carry.length }
  try {
    await acquire()
    try {
      const prep = await agent(preparePrompt(g), { label: `prep:${g.key}`, phase: 'Build', schema: PREP, model: 'sonnet', effort: 'low' })
      if (!prep || prep.status !== 'ready') { out.final = 'prepare-blocked'; out.prepare = prep; return out }
      out.base = prep.base
      if (g.track === 'repair' || g.track === 'build') {
        const r = await agent(g.track === 'build' ? buildPrompt(g) : repairPrompt(g), { label: `${g.track}:${g.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
        if (!r) { out.final = 'agent-failed'; return out }
        out.repair = r
        const v = await agent(reverifyPrompt(g, r), { label: `verify:${g.key}`, phase: 'Build', schema: VERDICT, model: 'opus' })
        out.verdict = v
        if (stops(v)) { out.final = 'not-verified'; return out }
        const rev = await agent(rereviewPrompt(g, r, v), { label: `review:${g.key}`, phase: 'Build', schema: REVIEW, model: 'fable' })
        out.review = rev
        if (!rev || rev.decision === 'DO NOT MERGE') { out.final = 'review-blocked'; return out }
      }
      if (g.track === 'walk') {
        const w = await agent(walkPrompt(g), { label: `walk:${g.key}`, phase: 'Walk', schema: WALK, model: 'opus' })
        out.walk = w
        if (!w || w.status === 'not-proven') { out.final = 'walk-not-proven'; return out }
      }
    } finally {
      release()
    }

    const m = await serialized(async () => {
      await acquire()
      try {
        log(`${g.key}: integrating`)
        let integ = await agent(integratePrompt(g, null), { label: `integrate:${g.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
        if (!integ || integ.status !== 'ready') return { final: 'integration-blocked', integration: integ }
        let iv = await agent(iverifyPrompt(g, integ), { label: `integ-verify:${g.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
        if (stops(iv)) {
          const again = await agent(integratePrompt(g, iv), { label: `integrate-repair:${g.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
          if (again && again.status === 'ready') {
            integ = again
            iv = await agent(iverifyPrompt(g, integ), { label: `integ-reverify:${g.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
          }
        }
        if (stops(iv)) return { final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
        const merged = await agent(mergePrompt(g, integ), { label: `merge:${g.key}`, phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
        log(`${g.key}: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked'}`)
        return { final: merged && merged.status === 'merged' ? 'merged' : 'merge-blocked', integration: integ, integrationVerdict: iv, merge: merged }
      } finally {
        release()
      }
    })
    Object.assign(out, m)
    return out
  } catch (e) {
    out.final = 'error'
    out.error = String(e)
    return out
  }
}

const results = await parallel(LANES.map((g) => () => runLane(g)))
return {
  run: 'seed-and-founder-answers',
  lanes: results,
  merged: results.filter((r) => r && r.final === 'merged').map((r) => r.group),
  stillOpen: results.filter((r) => !r || r.final !== 'merged').map((r) => ({ group: r && r.group, final: r && r.final })),
}
