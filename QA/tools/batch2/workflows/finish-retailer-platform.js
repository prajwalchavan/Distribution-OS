export const meta = {
  name: 'qa-batch2-retailer-platform',
  description: 'The last lean wave-3 lane: repair the 401 retry defect the previous repair introduced on the retailer home screen, walk DOS-102 on the Pixel 7 and iOS, then merge',
  phases: [
    { title: 'Repair', detail: 'close the 401 retry hole and the declared minors, then re-verify adversarially' },
    { title: 'Walk', detail: 'DOS-102 on a real device — this run MAY start services and the Pixel 7' },
    { title: 'Integrate', detail: 'merge current main in, full gates, verify, merge into main' },
  ],
}

/**
 * The last of wave 3. `finish-wave3.js` (wf_f5cf1873-fd0) merged nine of its ten lanes; this one failed
 * its re-verification, and the failure was honest and useful: the repair moved the retailer home screen's
 * memberships read onto the auth link, where `AUTH_RETRY_PATHS` (client.ts:38-43) does not list
 * 'memberships' — so a 401 on that call is never retried and the home screen can still tell a shop that
 * owes lakhs that it owes nothing. That is never-list #12, the honesty rule, in the one place a shop looks
 * first. It is a one-line set entry plus the proof that it fires.
 *
 * The second major is the DOS-102 device walk, which no wave-3 lane was allowed to take. The walk stage
 * here may start services and the Pixel 7, under the port rule.
 *
 * `frontend/libs/api-client/src/client.ts`, `frontend/retailer-app/src/api.ts` and the retailer app's
 * package.json are added to this lane's owned list: every other lane has merged, so nothing contends.
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
  "key": "lean-retailer-platform",
  "app": "retailer",
  "ids": [
   "DOS-100",
   "DOS-102",
   "DOS-103",
   "DOS-104",
   "DOS-125"
  ],
  "defer": [],
  "ownsFiles": [
   "backend/libs/contracts/src/auth.ts",
   "backend/libs/contracts/src/catalog.ts",
   "backend/libs/contracts/src/notifications.ts",
   "backend/libs/contracts/src/permissions.ts",
   "backend/libs/contracts/src/pricing.ts",
   "backend/libs/contracts/src/tenancy.ts",
   "backend/libs/core/src/modules/auth/auth.controller.ts",
   "backend/libs/core/src/modules/auth/auth.service.ts",
   "backend/libs/core/src/modules/auth/auth.spec.ts",
   "backend/libs/core/src/modules/notifications/events.ts",
   "backend/libs/core/src/modules/notifications/inbound.service.ts",
   "backend/libs/core/src/modules/notifications/notifications.spec.ts",
   "backend/libs/core/src/modules/orders/orders.mappers.ts",
   "backend/libs/core/src/modules/pricing/pricing.spec.ts",
   "backend/libs/core/src/modules/pricing/quote.service.ts",
   "backend/libs/core/src/modules/receivables/outstanding.ts",
   "backend/libs/core/src/modules/tenant-catalog/tenant-catalog.service.ts",
   "backend/libs/database/migrations/meta/_journal.json",
   "backend/libs/database/src/rls.test.ts",
   "backend/libs/database/src/schema/notifications.ts",
   "backend/libs/database/src/seed-demo/notifications.ts",
   "backend/libs/database/src/tenant-bootstrap.ts",
   "frontend/libs/api-client/src/client.ts",
   "frontend/libs/ui/package.json",
   "frontend/libs/ui/src/native/charts.tsx",
   "frontend/libs/ui/src/parity.test.ts",
   "frontend/libs/ui/src/platform/links.web.ts",
   "frontend/libs/ui/src/platform/types.ts",
   "frontend/libs/ui/src/types.ts",
   "frontend/libs/ui/src/web/charts.tsx",
   "frontend/owner-app/app/settings/index.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/pnpm-lock.yaml",
   "frontend/pnpm-workspace.yaml",
   "frontend/retailer-app/app/bills/[id].tsx",
   "frontend/retailer-app/app/dues.tsx",
   "frontend/retailer-app/app/index.tsx",
   "frontend/retailer-app/app/order.tsx",
   "frontend/retailer-app/app/orders/[id].tsx",
   "frontend/retailer-app/app/pay.tsx",
   "frontend/retailer-app/app/returns.tsx",
   "frontend/retailer-app/app/sign-in.tsx",
   "frontend/retailer-app/package.json",
   "frontend/retailer-app/src/api.ts",
   "frontend/retailer-app/src/strings.ts"
  ],
  "db": "dos_test_b2_retailer_platform",
  "notes": "WAITS FOR the architect designs of all five items (contracts, permissions, schema, kit types.ts). permissions.ts is edited by h9 (merged) and h10 (admin rows, uncommitted in 4201823): rebase. Every new route needs a PERMISSIONS row plus the describePermissionMatrix spec. ADR 0006 keeps the credit limit off the retailer app (CREDIT_CHECKERS excludes retailer), so DOS-100's 'credit left' part must respect it; the on-order hold sentence needs no contract change. DOS-102's cross-tenant memberships summary is an auth-service read, with the module boundary and host service set by the design; never switchTenant behind the user's back. DOS-103 adds a retailer write path. Extend backend/libs/database/src/rls.test.ts for any new role-restricted table or policy, and never join retailer_identities from a tenant table (42P17). A new table takes the next _journal.json index plus its FORCE RLS line. The owner setting label uses owner strings.ts, which is why this group waits on lean-manager-order-lifecycle. DOS-104 must not create a second pricing path: priceOrder stays the only engine, with a parity case in pricing.spec.ts. DOS-125: a new kit QR component in types.ts, with web and native renderers on react-native-svg (already in the catalog), parity.test.ts, and a static web hint (links.web.open always reports true). If the design needs a QR encoder dependency, it goes through frontend/pnpm-workspace.yaml, libs/ui package.json and pnpm-lock.yaml; this group owns them and comes after lean-libs-offline-boot and lean-owner-desk. Seed change (DOS-100 template): re-run pnpm db:seed on dos_qa. Walk web, Android, iOS (R2 and pay).",
  "after": [
   "lean-warehouse-stock",
   "lean-admin-support",
   "lean-sales-orders-pricing",
   "lean-owner-money-approvals",
   "lean-manager-order-lifecycle"
  ],
  "model": "opus",
  "track": "repair-then-walk",
  "carry": [
   {
    "severity": "major",
    "detail": "NEW, introduced by the repair itself: the home screen can STILL show 'You owe \u20b90.00 across 3 distributors' to a shop that owes lakhs, because the call the repair moved onto the auth link is the one authenticated read in this app that the client will not heal. frontend/libs/api-client/src/client.ts:317-322 builds the auth link with `interceptors: [interceptor((path) => AUTH_RETRY_PATHS.has(path[0] ?? ''))]`, and AUTH_RETRY_PATHS (client.ts:38-43) is {me, sessions, revokeSession, changePassword}. For `auth.memberships.summary` path[0] is 'memberships', so `retryable` is FALSE \u2014 and that one predicate gates BOTH the pre-expiry refresh (`if (retryable(opts.path)) await refreshBeforeExpiry()`, client.ts:288) and the 401 refresh-and-replay (client.ts:292). The api link is built with `interceptor(() => true)`, so before the repair the call was healed (it just always 404'd); after it, it is not. PROVEN, not reasoned: I wrote a throwaway probe (frontend/retailer-app/src/lib/zz-verifier-probe.test.ts, run then DELETED \u2014 tree is clean) driving the real createApiClient against a stubbed fetch. On an identical 401, `auth.me()` produced `POST /auth/login \u2192 GET /auth/me [Bearer stale] \u2192 POST /auth/refresh \u2192 GET /auth/me [Bearer fresh]` and RESOLVED, while `auth.memberships.summary()` produced `POST /auth/login \u2192 GET /auth/memberships/summary [Bearer stale]` and THREW 'Access token expired.' \u2014 one request, no refresh, no replay. Second probe, token with 30 s left (inside REFRESH_BEFORE_EXPIRY_MS = 60 s): `me()` emitted `POST /auth/refresh` before its call; `memberships.summary()` emitted only `GET /auth/memberships/summary [Bearer stale]` \u2014 it goes out on a dying token that every other read in the app would have renewed first. Reachability read from the code: the access token lives 15 min (AUTH_ACCESS_TTL_SECONDS), there is no timer refresh anywhere in @dos/api-client (grep for setInterval/setTimeout), useQuery's staleTime on this read is 60 s, and the other home-screen reads (dues, orders, lastBill, stops, branding) are all declared BEFORE `across` and each AWAITS refreshBeforeExpiry() \u2014 so `across` is dispatched first, with the stale token. Consequence on screen: app/index.tsx:139 `across.data?.items ?? []` and :218 `formatMoney(across.data?.totalOutstandingPaise ?? 0)` swallow the thrown ApiError into a MONEY FIGURE \u2014 `across.error` and `across.status` are both available from useQuery (react/index.tsx:253-258) and neither is read \u2014 while ConnectionStrip is fed by a different query (`inbox`, app/_layout.tsx:338) which DOES heal, so the strip says online and fresh next"
   },
   {
    "severity": "major",
    "detail": "OWED, NOT DONE \u2014 declared honestly by the repairer and I confirm it is still outstanding: neither half of DOS-102 has been seen on a device. Item 2 is a native-only divergence (storage.web.ts reads localStorage synchronously, storage.native.ts does not), and the guard proves the MECHANISM against a hand-written model of storage.native.ts, not the shipped Android/iOS binary \u2014 under Vitest `@dos/ui/platform` resolves to the web half, which is why the model exists. The task forbids starting emulators, so no walk was possible here either. Owed: on the Pixel 7, sign in as ramesh.gupta, switch to Sai, force-stop, reopen, confirm it lands in Sai AND that the r2-total line quotes the real \u20b9 figure. This alone does not make the verdict fail."
   }
  ],
  "lastStage": "not-verified",
  "headAt": null
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
      if (g.track === 'repair' || g.track === 'repair-then-walk') {
        const r = await agent(repairPrompt(g), { label: `repair:${g.key}`, phase: 'Repair', schema: RESULT, model: 'opus' })
        if (!r) { out.final = 'agent-failed'; return out }
        out.repair = r
        const v = await agent(reverifyPrompt(g, r), { label: `reverify:${g.key}`, phase: 'Repair', schema: VERDICT, model: 'opus' })
        out.verdict = v
        if (stops(v)) { out.final = 'repair-not-verified'; return out }
        if (g.track === 'repair-then-walk') {
          const w = await agent(walkPrompt(g), { label: `walk:${g.key}`, phase: 'Walk', schema: WALK, model: 'opus' })
          out.walk = w
          if (!w || w.status === 'not-proven') { out.final = 'walk-not-proven'; return out }
        }
        const rev = await agent(rereviewPrompt(g, r, v), { label: `re-review:${g.key}`, phase: 'Repair', schema: REVIEW, model: 'fable' })
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
  run: 'retailer-platform',
  lanes: results,
  merged: results.filter((r) => r && r.final === 'merged').map((r) => r.group),
  stillOpen: results.filter((r) => !r || r.final !== 'merged').map((r) => ({ group: r && r.group, final: r && r.final })),
}
