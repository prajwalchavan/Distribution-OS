export const meta = {
  name: 'deploy-plumbing',
  description: 'The path from this repo to a running server, which does not exist today: a Dockerfile that builds, a compose for the VM, Caddy with TLS, a migrate step, backups off-box, secrets, and a Cloudflare Pages pipeline for the web app — authored and proven on this Mac with colima',
  phases: [
    { title: 'Build', detail: 'test-first implementation, then an adversarial verifier, then a Fable review' },
    { title: 'Smoke', detail: 'after the seed lane merges: one observed pnpm smoke on a fresh seed, which is what re-arms the main-health gate' },
    { title: 'Integrate', detail: 'merge main in, full gates, verify, merge into main one lane at a time' },
  ],
}

/**
 * Research of 2026-09-21 (wf_e2039cff-1b2) found there is NO working path from this repo to a server:
 * the Dockerfile has never been built and has a definite COPY bug (`COPY *-service ./` collapses eight
 * directories into one), `pnpm deploy` likely fails under the hoisted linker, no migration step, no
 * compose for the app, no Caddy, no backups, no secrets, no static pipeline, and Docker is not on the
 * Mac. Target, decided on verified terms: Oracle Cloud Always Free (arm64, 2 OCPU / 12 GB, Ubuntu),
 * Postgres 17 self-hosted on the VM (free managed Postgres cannot host this schema), Caddy + Let's
 * Encrypt, the web app on Cloudflare Pages, backups off Oracle. Builds never run on the VM.
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
  "key": "deploy-plumbing",
  "app": "infra",
  "track": "build",
  "ids": [
   "Dockerfile that builds",
   "docker-compose for the VM",
   "Caddyfile + TLS",
   "migrate + bootstrap step",
   "backups off-box",
   "secrets",
   "Pages pipeline",
   "deploy runbook"
  ],
  "defer": [],
  "db": "dos_test_b2_deploy",
  "ownsFiles": [
   "backend/infra/",
   "backend/all-in-one/",
   "backend/package.json",
   "backend/pnpm-workspace.yaml",
   "backend/turbo.json",
   ".github/workflows/deploy.yml",
   ".github/workflows/image.yml",
   "docs/26-environments-and-configuration.md",
   "docs/30-deploy-runbook.md",
   "frontend/scripts/"
  ],
  "notes": "You MAY install tooling (founder autonomy grant): `brew install colima docker docker-compose` \u2014 colima runs Docker on Apple Silicon without sudo and builds linux/arm64 NATIVELY, which is the VM's architecture; never Docker Desktop. Check headroom (vm_stat; sysctl vm.swapusage) before every image build and wait if free RAM is under 1.5 GB \u2014 three other runs share this machine. Read docs/26 fully, then backend/infra/docker/Dockerfile, backend/infra/docker-compose.yml, backend/all-in-one/*, backend/libs/database/src/migrate.ts and seed.ts, backend/tools/auth-keygen.mts, the object-storage local driver (backend/libs/core/src/platform/object-storage.ts), and CLAUDE.md's Toolchain section (Node 24, pnpm 11 pinned, hoisted linker). The production database is bootstrapped with bootstrapTenant(), NEVER pnpm db:seed (docs/23 \u00a710: the seed and smoke leave demo rows). DOCINT_ENGINE stays stub. Nothing here touches product code; if a product change is needed to deploy, name it as a finding instead.",
  "carry": [
   {
    "severity": "blocker",
    "detail": "AN IMAGE THAT BUILDS AND RUNS. Fix backend/infra/docker/Dockerfile: the `COPY *-service ./` collapse, the `pnpm deploy` under the hoisted linker (inject-workspace-packages or a copy of dist/ + production node_modules), Node 24 alpine multi-arch, a non-root user, HEALTHCHECK on /health. Prove: `docker build --platform linux/arm64` succeeds on colima; `docker run` of the image with a DATABASE_URL to dos_test_b2_deploy answers /health 200 on ALL_IN_ONE_PORT and mounts all eight services plus the worker; RSS under 500 MB idle (docs/26 measured 377)."
   },
   {
    "severity": "blocker",
    "detail": "COMPOSE FOR THE VM: backend/infra/compose.prod.yml with services app (the image, restart: unless-stopped, env from a .env the runbook explains, a volume for OBJECT_STORAGE_DIR), db (postgres:17, a named volume, healthcheck, max_connections sized for DATABASE_POOL_MAX), caddy (Caddyfile: api.<domain> \u2192 app:PORT with automatic Let's Encrypt; the SPA fallback is NOT needed here because the web app lives on Pages). A one-shot `migrate` service that runs the migrations from the image before app starts (depends_on with condition: service_completed_successfully) \u2014 today nothing reads /app/migrations; make migrate.ts resolve them inside the image and prove it on a fresh dos_test_b2_deploy: 48 applied, bootstrapTenant() creates the pilot tenant and its owner."
   },
   {
    "severity": "blocker",
    "detail": "BACKUPS OFF THE BOX + SECRETS. backend/infra/backup.sh: nightly pg_dump (custom format) plus a tar of OBJECT_STORAGE_DIR, rotated (7 daily, 4 weekly), uploaded with rclone or the aws-cli S3 API to Cloudflare R2 (S3-compatible; the runbook explains the bucket and the token; the script must work with any S3 endpoint); a `restore.sh` that is actually tested: dump \u2192 drop \u2192 restore \u2192 the row counts match. Secrets: a `.env.prod.example` listing every variable the image needs (AUTH_JWT_PRIVATE_KEY/PUBLIC_KEY from `pnpm auth:keygen`, OBJECT_STORAGE_SIGNING_SECRET, DATABASE_URL, CORS_ORIGINS, OBJECT_STORAGE_PUBLIC_URL, DOCINT_ENGINE=stub) and a `gen-secrets.sh` that writes a real .env.prod with fresh keys, never committed (.gitignore it)."
   },
   {
    "severity": "blocker",
    "detail": "PAGES PIPELINE + RUNBOOK. frontend/scripts/pages-deploy.sh: builds ONE web app (`pnpm --filter <app> export:web` with EXPO_PUBLIC_API_URL and EXPO_PUBLIC_AUTH_URL pointed at api.<domain> and the all-in-one prefixes per docs/26 \u00a77) and publishes dist/ with wrangler to a named Pages project; parameterised by app so it serves the seven today and the one merged app (frontend/dos-app, coming) tomorrow. .github/workflows/image.yml builds the arm64 image on push to main and pushes it to GHCR (free for public/private within limits) so the VM only ever pulls. docs/30-deploy-runbook.md: the exact, ordered steps a human or agent runs from a fresh Oracle VM to a live API and a live Pages site, with every command, what each proves, and the rollback. Every command in it must have been run at least once on this Mac (colima) or be marked 'not run here: needs the VM'."
   },
   {
    "severity": "major",
    "detail": "CI STAYS GREEN AND HONEST. The existing ci.yml is untouched in behaviour; image.yml is a separate workflow; nothing deploys automatically to production \u2014 the runbook is the deploy. docs/26 gets an as-built note: Oracle replaces Lightsail, Pages replaces S3+CloudFront, R2 replaces S3 for backups, and the reason for each (verified 2026-09-21)."
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

const rereviewPrompt = (g, r, v) => `You are the pre-merge REVIEWER for lane ${g.key} of Distribution OS (Opus; the architect reads the branch after you, before it merges). Review the branch. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes.

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
        log(`${g.key}: integrated and verified at ${integ.headCommit} — waiting for the architect's review before merge`)
        return { final: 'ready-for-architect-merge', integration: integ, integrationVerdict: iv }
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
  run: 'deploy-plumbing',
  lanes: results,
  merged: results.filter((r) => r && r.final === 'ready-for-architect-merge').map((r) => r.group),
  stillOpen: results.filter((r) => !r || r.final !== 'merged').map((r) => ({ group: r && r.group, final: r && r.final })),
}
