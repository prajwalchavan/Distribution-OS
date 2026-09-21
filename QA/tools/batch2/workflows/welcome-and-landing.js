export const meta = {
  name: 'welcome-and-landing',
  description: 'docs/29 section 1: a Welcome screen before sign-in and a landing after it, in every app, built once in @dos/ui and used through the template — test-first, verified, gated, merged',
  phases: [
    { title: 'Build', detail: 'test-first implementation, then an adversarial verifier, then a Fable review' },
    { title: 'Smoke', detail: 'after the seed lane merges: one observed pnpm smoke on a fresh seed, which is what re-arms the main-health gate' },
    { title: 'Integrate', detail: 'merge main in, full gates, verify, merge into main one lane at a time' },
  ],
}

/**
 * Founder, 2026-09-21: every app opens on a Welcome (the Distribution OS mark, one line, this app's
 * name and icon, one Sign in button — shown once per device until a session exists), and after sign-in
 * lands for a moment on who-you-are (the distributor's logo and name, the person, which app) before the
 * home. docs/29-sign-in-roles-and-one-store-app.md §1 is the binding design; docs/22 §8 carries the
 * decision. UI only: no contract, no permission, no schema. The review seat is Opus here on purpose —
 * Fable's remaining days are reserved for the auth change (docs/29 §2) and the audit.
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
  "key": "welcome-landing",
  "app": "kit + all seven apps",
  "track": "build",
  "ids": [
   "docs/29 \u00a71 Welcome",
   "docs/29 \u00a71 Landing"
  ],
  "defer": [],
  "db": "dos_test_b2_welcome",
  "ownsFiles": [
   "frontend/libs/ui/src/types.ts",
   "frontend/libs/ui/src/strings.ts",
   "frontend/libs/ui/src/web/welcome.tsx",
   "frontend/libs/ui/src/native/welcome.tsx",
   "frontend/libs/ui/src/web/index.ts",
   "frontend/libs/ui/src/native/index.ts",
   "frontend/libs/ui/src/web/render.test.tsx",
   "frontend/libs/ui/src/parity.test.ts",
   "frontend/libs/ui/src/welcome.test.ts",
   "frontend/libs/app-template/app/sign-in.tsx",
   "frontend/libs/app-template/app/_layout.tsx",
   "frontend/libs/app-template/src/strings.ts",
   "frontend/owner-app/app/sign-in.tsx",
   "frontend/owner-app/app/_layout.tsx",
   "frontend/owner-app/src/strings.ts",
   "frontend/manager-app/app/sign-in.tsx",
   "frontend/manager-app/app/_layout.tsx",
   "frontend/manager-app/src/strings.ts",
   "frontend/sales-app/app/sign-in.tsx",
   "frontend/sales-app/app/_layout.tsx",
   "frontend/sales-app/src/strings.ts",
   "frontend/warehouse-app/app/sign-in.tsx",
   "frontend/warehouse-app/app/_layout.tsx",
   "frontend/warehouse-app/src/strings.ts",
   "frontend/delivery-app/app/sign-in.tsx",
   "frontend/delivery-app/app/_layout.tsx",
   "frontend/delivery-app/src/strings.ts",
   "frontend/retailer-app/app/sign-in.tsx",
   "frontend/retailer-app/app/_layout.tsx",
   "frontend/retailer-app/src/strings.ts",
   "frontend/admin-app/app/sign-in.tsx",
   "frontend/admin-app/app/_layout.tsx",
   "frontend/admin-app/src/strings.ts"
  ],
  "notes": "READ docs/29-sign-in-roles-and-one-store-app.md \u00a70 and \u00a71 FIRST \u2014 binding. Then docs/design/UX-00-design-system.md \u00a711 (product name then app; the distributor's own name is the chrome). Each app's sign-in.tsx must stay byte-identical to the template's after your change (the template is the source; `diff` proves it). The Welcome is one component in @dos/ui with a web and a native implementation behind one signature in types.ts, resolved by Metro through index.web.ts / index.native.ts like every other component; screens import only @dos/ui. 'Shown once per device until a session exists' = a small flag in platform.storage set when Sign in is pressed, cleared on sign-out; a hydrating session skips Welcome entirely. The Landing is not a route: the root layout shows it for ~2 s after a session becomes available (logo via the existing TenantLogo, tenant displayName, the person's name from the session, and this app's short name from APP.title), then the home renders; respect prefers-reduced-motion (no animation, just a short hold), and never delay a person who is already signed in on launch \u2014 Landing shows only right after a fresh sign-in or a distributor switch. Six business apps plus the console: the line reads 'Connecting a distribution business through six apps.'; the console's Welcome says 'Platform console' instead. No new dependencies. No image assets you would have to invent \u2014 the mark is typeset (the wordmark in IBM Plex, as UX-00 defines it); each app already has its icon in app.json for the store, but do not load app.json at runtime.",
  "carry": [
   {
    "severity": "blocker",
    "detail": "WELCOME (docs/29 \u00a71). Every app's first screen when no session exists on the device is a Welcome: the Distribution OS wordmark, the line 'Connecting a distribution business through six apps.' ('Platform console' in the admin app), this app's own name (e.g. 'Delivery'), and ONE primary button 'Sign in' that opens the existing sign-in form unchanged. It is shown ONCE per device \u2014 after the first Sign in press it is not shown again until sign-out clears the flag; a device with a stored session never sees it. Web and native. Test-first in the kit (render test at 390 and 1280; the flag's set/clear) and a source guard that every app's sign-in.tsx equals the template's."
   },
   {
    "severity": "blocker",
    "detail": "LANDING (docs/29 \u00a71). Right after a fresh sign-in (and after a distributor switch), before the home renders, the root layout shows for about two seconds: the distributor's logo and name (the shop's in the retailer app; 'Distribution OS' in the console), the signed-in person's name, and which app this is ('Delivery app'). Not a route, not tappable, no delay on a normal launch with a stored session, no animation under prefers-reduced-motion. Proven by a kit test of the component and a guard that every app's _layout.tsx wires it the same way as the template's."
   },
   {
    "severity": "major",
    "detail": "NOTHING ELSE MOVES. sign-in fields, errors, the wrong-role screen, the tenant switcher, the shell, strings for every existing key: unchanged. `pnpm exec turbo run test --continue --concurrency=1 --force` in frontend must stay green including the kit's parity and root-layout-redirects guards \u2014 extend them for the new component rather than weakening them."
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

const rereviewPrompt = (g, r, v) => `You are the merge REVIEWER for lane ${g.key} of Distribution OS (Opus in the review seat: this is a UI-only change and the architect's days are reserved). Review the branch before it merges into main. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes.

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
        const rev = await agent(rereviewPrompt(g, r, v), { label: `review:${g.key}`, phase: 'Build', schema: REVIEW, model: 'opus' })
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
  run: 'welcome-and-landing',
  lanes: results,
  merged: results.filter((r) => r && r.final === 'merged').map((r) => r.group),
  stillOpen: results.filter((r) => !r || r.final !== 'merged').map((r) => ({ group: r && r.group, final: r && r.final })),
}
