export const meta = {
  name: 'qa-batch2-dos167-ruling3',
  description: 'DOS-167 ruling 3 (Opus standing in for Fable): diagnose by execution why the web persistent store never opens when the database code loads slowly, rule the fix plus the missing log lines and the flash, build test-first with adversarial verification, review, integrate with the full frontend gate, merge, then a focused re-proof and a judge',
  phases: [
    { title: 'Diagnose', detail: 'reproduce S-138 with late expo-sqlite bundles, bisect the clean-up steps, check the pool and a production export', model: 'opus' },
    { title: 'Ruling', detail: 'Opus standing in for Fable: binding amendments from the diagnosis', model: 'opus' },
    { title: 'Build', detail: 'Opus implementer, adversarial verifier, one repair round', model: 'opus' },
    { title: 'Review', detail: 'Opus merge review standing in for Fable', model: 'opus' },
    { title: 'Integrate', detail: 'Opus integrator with the full frontend gate, verifier of every review blocker on HEAD, merge', model: 'opus' },
    { title: 'Proof', detail: 'web persistent (cold and slow loads) and memory, Android sales, iOS sanity; one at a time', model: 'opus' },
    { title: 'Judge', detail: 'Opus standing in for Fable decides whether DOS-167 is closed', model: 'opus' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const WT = MAIN + '/.claude/worktrees/b2-dos167r3'
const BR = 'qa/b2-dos167r3'
const DB = 'dos_test_b2_dos167r3'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const DESIGN = VERD + '/DOS-167-design.md'
const R1 = VERD + '/DOS-167-ruling-1.json'
const R2MD = VERD + '/DOS-167-ruling-2.md'
const ADD = VERD + '/DOS-167-ruling-2-addendum.md'
const R3MD = VERD + '/DOS-167-ruling-3.md'
const PREV = MAIN + '/QA/evidence/batch2/dos-167/reproof'
const EV = MAIN + '/QA/evidence/batch2/dos-167/reproof2'
const J2 = '/Users/prajwalchavan/.claude/projects/-Users-prajwalchavan-Desktop-Distribution-OS/682f4d7a-4374-4d97-b41b-5f986fb5fa07/subagents/workflows/wf_a77ba6a6-adc/journal.jsonl'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
const STAND = 'You run on Opus standing in for the architect (Fable), whose usage limit was reached; act as the architect would and say so in your output.'

const FOUNDER = `FOUNDER ANSWER (2026-09-13, binding): "DOS-167 — A" = unsent changes at sign-out stay on that phone for that person only, go first at that person's next sign-in, and nothing is thrown away at sign-out. Merged on main: the design with ruling 1 (199952b), ruling 2 with addenda (x), (y) and (z) (bafb7b5). RE-PROOF of bafb7b5 (judge: OPEN): Android delivery and warehouse and iOS sales, delivery and warehouse PROVEN (no leak, no crash in nine keep runs, relaunch at the sign-in form, kept changes sent once). FAILED: S-138 (P1) the web persistent store never opens when the expo-sqlite chunk and worker arrive late (first load after a Metro start; 600 ms added latency): 'SQLiteError: not a database', the OPFS pool filled with orphan temp files and '/dos-sales.db-wal', no /sync for 240 s, the next person's open fails too; S-139 (P3) no field app passes onLog, so the 'offline:' lines never print; S-140 (P3) 'This browser will not keep the offline copy' flashes for 39-82 ms after every sign-in on a persistent web store.`
const PROOFS_SO_FAR = `python3 -c "import json;[print(json.dumps(json.loads(l)['result'],indent=1)[:6000]) for l in open('${J2}') if l.strip() and json.loads(l).get('type')=='result' and isinstance(json.loads(l)['result'],dict) and ('platform' in json.loads(l)['result'] or 'overall' in json.loads(l)['result'])]"`
const ROWS = `grep -n '^| S-138 \\|^| S-139 \\|^| S-140 ' "${MAIN}/QA/findings/12-batch2-new-findings.md"`

const DIAG = { type: 'object', required: ['rootCause', 'evidence', 'variants', 'poolBehaviour', 'productionRepro', 'proposedFix', 'testIdeas', 'cleanup'], properties: {
  rootCause: { type: 'string' }, evidence: { type: 'string' },
  variants: { type: 'array', items: { type: 'object', required: ['variant', 'runs', 'passes', 'notes'], properties: { variant: { type: 'string' }, runs: { type: 'number' }, passes: { type: 'number' }, notes: { type: 'string' } } } },
  poolBehaviour: { type: 'string' }, productionRepro: { type: 'string' }, proposedFix: { type: 'string' },
  testIdeas: { type: 'array', items: { type: 'string' } }, cleanup: { type: 'string' } } }
const RULING = { type: 'object', required: ['needsFounder', 'founderQuestion', 'amendments', 'reproof', 'outOfScope', 'summaryForFounder', 'notes'], properties: {
  needsFounder: { type: 'boolean' }, founderQuestion: { type: 'string' },
  amendments: { type: 'array', items: { type: 'object', required: ['id', 'title', 'rule', 'files', 'tests', 'mandatory'], properties: {
    id: { type: 'string' }, title: { type: 'string' }, rule: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'object', required: ['file', 'name', 'redBecause'], properties: { file: { type: 'string' }, name: { type: 'string' }, redBecause: { type: 'string' } } } },
    mandatory: { type: 'boolean' } } } },
  reproof: { type: 'array', items: { type: 'string' } }, outOfScope: { type: 'array', items: { type: 'string' } }, summaryForFounder: { type: 'string' }, notes: { type: 'string' } } }
const RESULT = { type: 'object', required: ['status', 'commits', 'failBefore', 'passAfter', 'testsAdded', 'testsCorrected', 'filesChanged', 'amendments', 'deviations', 'followUps'], properties: {
  status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] }, commits: { type: 'array', items: { type: 'string' } }, failBefore: { type: 'string' }, passAfter: { type: 'string' },
  testsAdded: { type: 'array', items: { type: 'object', required: ['file', 'name'], properties: { file: { type: 'string' }, name: { type: 'string' } } } },
  testsCorrected: { type: 'array', items: { type: 'object', required: ['file', 'name', 'before', 'after', 'why'], properties: { file: { type: 'string' }, name: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, why: { type: 'string' } } } },
  filesChanged: { type: 'array', items: { type: 'string' } },
  amendments: { type: 'array', items: { type: 'object', required: ['amendment', 'done', 'how'], properties: { amendment: { type: 'string' }, done: { type: 'boolean' }, how: { type: 'string' } } } },
  deviations: { type: 'string' }, followUps: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['verdict', 'failBeforeConfirmed', 'passAfterConfirmed', 'amendmentsChecked', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] }, failBeforeConfirmed: { type: 'boolean' }, passAfterConfirmed: { type: 'boolean' },
  amendmentsChecked: { type: 'array', items: { type: 'object', required: ['amendment', 'satisfied', 'detail'], properties: { amendment: { type: 'string' }, satisfied: { type: 'boolean' }, detail: { type: 'string' } } } },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, detail: { type: 'string' } } } },
  evidence: { type: 'string' } } }
const REVIEW = { type: 'object', required: ['decision', 'blockers', 'minors', 'conflicts', 'walks', 'unfiledDefects'], properties: {
  decision: { type: 'string', enum: ['MERGE', 'MERGE AFTER FIXES', 'DO NOT MERGE'] }, blockers: { type: 'array', items: { type: 'string' } }, minors: { type: 'array', items: { type: 'string' } },
  conflicts: { type: 'array', items: { type: 'string' } }, walks: { type: 'array', items: { type: 'string' } }, unfiledDefects: { type: 'array', items: { type: 'string' } } } }
const INTEG = { type: 'object', required: ['status', 'headCommit', 'conflicts', 'fixes', 'testsRun', 'notes'], properties: {
  status: { type: 'string', enum: ['ready', 'blocked'] }, headCommit: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } },
  fixes: { type: 'array', items: { type: 'string' } }, testsRun: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
const IVERDICT = { type: 'object', required: ['verdict', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } } } }
const MERGED = { type: 'object', required: ['status', 'mainHead', 'pushed', 'notes'], properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, pushed: { type: 'boolean' }, notes: { type: 'string' } } }
const PROOF = { type: 'object', required: ['platform', 'verdict', 'steps', 'defects', 'notTested', 'environment'], properties: {
  platform: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fail', 'partial'] },
  steps: { type: 'array', items: { type: 'object', required: ['app', 'step', 'expected', 'observed', 'result', 'evidence'], properties: {
    app: { type: 'string' }, step: { type: 'string' }, expected: { type: 'string' }, observed: { type: 'string' },
    result: { type: 'string', enum: ['PASS', 'FAIL', 'NOT TESTED'] }, evidence: { type: 'array', items: { type: 'string' } } } } },
  defects: { type: 'array', items: { type: 'object', required: ['severity', 'detail', 'evidence'], properties: { severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, detail: { type: 'string' }, evidence: { type: 'string' } } } },
  notTested: { type: 'array', items: { type: 'string' } }, environment: { type: 'string' } } }
const JUDGE = { type: 'object', required: ['overall', 'platforms', 'gaps', 'newDefects', 'summary'], properties: {
  overall: { type: 'string', enum: ['closed', 'partially-proven', 'open'] },
  platforms: { type: 'array', items: { type: 'object', required: ['platform', 'status', 'reason'], properties: { platform: { type: 'string' }, status: { type: 'string', enum: ['proven', 'failed', 'partial', 'not-tested'] }, reason: { type: 'string' } } } },
  gaps: { type: 'array', items: { type: 'string' } },
  newDefects: { type: 'array', items: { type: 'object', required: ['priority', 'detail', 'evidence'], properties: { priority: { type: 'string' }, detail: { type: 'string' }, evidence: { type: 'string' } } } },
  summary: { type: 'string' } } }

const SHARED = `- 8 GB RAM is shared with the batch-2 build lanes in other worktrees: stop what you start; repeat any timing-sensitive run three times and count a variant as passing only on 3 of 3.
- Services :3000-:3007 and the worker run on dos_qa (QA/tools/start-services.sh; QA/ENV.md). backend/.env in the main checkout points at the founder's own database dos: NEVER run pnpm db:* or psql without export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_qa, and never connect to dos.
- Never open the iOS simulator panel in the Claude app (xcrun simctl, QA/tools/ios-login.mjs and QA/tools/ios-drive.mjs only). Android shells need the ANDROID_HOME, JAVA_HOME and PATH exports from CLAUDE.md; boot Pixel_7_API_36 with -memory 3072 -no-snapshot-save.
- QA CHARTER: report only what you executed; a step you could not run is NOT TESTED with the reason; never infer one platform from another; never change product code outside the step that allows it; never commit unless the step says so. Do not write SUMMARY.md or other report files; screenshots, raw logs and scripts under the evidence folder are fine.`

const diagnosePrompt = () => `You diagnose one confirmed P1 on Distribution OS by EXECUTING, not by reading alone: S-138, the web persistent store that never opens when the expo-sqlite code loads late. ${STAND}

${FOUNDER}

WHERE THINGS ARE:
- Rows: ${ROWS}
- The previous prover's evidence: ls "${PREV}/web" (diag-01 control, diag-02 and diag-03 with 600 ms added to the expo-sqlite chunk and worker, run3-v5a, results-*.json, run-*.log) and its structured result: ${PROOFS_SO_FAR}
- The e2e script it used and extended: ${MAIN}/QA/tools/e2e/s-098-shared-device.mjs (find how the delay and the OPFS walk are injected: grep -n "delay\\|route\\|opfs\\|getDirectory" in it and in the diag logs).
- Code: frontend/libs/offline/src/store/open.web.ts, store/expo-sqlite.ts, engine.ts (start, sweepStores, the interim and legacy sweeps), react.tsx (the legacy-file destroy and interim sweep effects), frontend/sales-app/app/_layout.tsx; expo-sqlite web internals under frontend/node_modules/expo-sqlite/web (the wa-sqlite worker, AccessHandlePoolVFS and its pool capacity).

ENVIRONMENT:
- Code experiments happen ONLY in the worktree "${WT}" (branch ${BR}, fresh from main). You may make TEMPORARY, UNCOMMITTED edits there to bisect; restore with git checkout -- . and remove untracked files at the end; never commit. Setup: cd "${WT}/backend" && pnpm install && pnpm exec turbo run build --filter='./libs/*'; cd "${WT}/frontend" && pnpm install. Start every Bash command with: export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null
- The sales web app for experiments runs from the WORKTREE on :5175 (cd "${WT}/frontend" && pnpm --filter @dos/sales-app web -- --port 5175 --clear, in the background with a log under ${EV}/diagnose/), against the services on dos_qa. Check first that nothing else listens on :5175. Chromium: PW_PORT=9341 node "${MAIN}/QA/tools/pw-server.mjs" (or the script's own launcher). Never edit the main checkout.
${SHARED}
- Evidence under ${EV}/diagnose/.

STEPS:
1. Reproduce: with a warm Metro, the control (no delay) opens a persistent store (an OPFS header for rahul, a manifest call, a pull); with 600 ms added to the expo-sqlite chunk and worker, it fails as S-138 says. Three runs each. Also the first load right after a Metro start.
2. Bisect with temporary edits (three runs each under the 600 ms delay): (A) no legacy <prefix>.db destroy; (B) no interim 199952b-name sweep; (C) neither; (D) both, but only after the engine's own store has opened; (E) any other clean-up or concurrent open you find (the sibling sweep, a second provider mount, React strict-mode double effects, the leave flow at startup). Record passes per variant.
3. The pool: before and after a failure, list the OPFS pool directory and the VFS's file-name map; find the pool capacity; say whether a reload in the same browser profile heals it or it stays broken, and whether a fresh profile is fine.
4. Production: build the web export from the worktree (cd "${WT}/frontend" && pnpm --filter @dos/sales-app exec expo export --platform web --output-dir <a directory under ${EV}/diagnose>), serve it with a tiny static server that sends COOP/COEP, and try a first visit with the same added latency (three runs): does S-138 reproduce outside Metro?
5. Decide the root cause with the executed evidence, the smallest correct fix, and red-first tests that can run in Node (for example a fake pool with a fixed capacity and a slow open, or an ordering test over the provider's effects).
6. Clean up: stop Metro, the static server and Chromium you started; git -C "${WT}" status must be clean; leave the services running.
Return the structured result.`

const rulingPrompt = (diag) => `${STAND} Rule on DOS-167's third round as binding amendments (aa), (bb), ... to the design, ruling 1 and ruling 2 with its addenda. Read-only: edit nothing except the ONE file below; no builds, tests, git writes or database connections.

${FOUNDER}

READ: cat "${DESIGN}" "${R1}" "${R2MD}" "${ADD}" ; ${ROWS} ; the re-proof results and judge: ${PROOFS_SO_FAR}
THE EXECUTED DIAGNOSIS (binding facts): ${JSON.stringify(diag, null, 1)}

RULE ON:
1. S-138: the fix that follows from the diagnosis; what the engine does when the persistent open fails (announced, bounded, never a silent hang, the memory fallback said out loud); nothing that can exhaust or corrupt the OPFS pool at startup; red-first tests (file, name, why red today).
2. S-139: every field app (sales, delivery, warehouse) passes onLog, with the sink decided, so the 'offline:' lines print.
3. S-140: the status never reports 'will not keep' until the open has resolved, and still reports it on a real memory store; the beat and the sheet read it correctly.
4. The re-proof gaps: decide for each whether it is required now, and how: (v) the refusal sentence through the UI now that (y) signs out first; the two-distributor rep's sibling sweep (dos_qa has no such salesperson: say whether the prover may add one through the product's own owner API on dos_qa, or it stays NOT TESTED); (y) under a real crash; the full frontend gate after the (z) commits (mandatory at integration); (u) kept drafts on a device; the distributor-switch leave path.
5. reproof: the exact checks the next prover runs on web (cold Metro first loads, the delayed bundles, a production export if it reproduced there, V5A-V5C, the flash watch, the memory console line), Android (the upgrade log line, kept drafts, anything decided in 4) and iOS (a short sanity run because shared code changes).
needsFounder = true only if answer A cannot decide something. summaryForFounder: three plain sentences, no code words.
Write ${R3MD} (under 150 lines) and return the structured result.`

const ENV = `ENVIRONMENT — read carefully:
- Your worktree is "${WT}" on branch ${BR}. Start EVERY Bash command with: cd "${WT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${DB}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree. You MAY READ ${MAIN}/QA/.
- 8 GB RAM shared with other lanes: ONE test file per command unless a step names a wider gate; typecheck and lint only touched packages.
- No git stash, reset --hard, rebase, push or branch deletion. Do NOT start dev servers, emulators or simulators. Do NOT edit docs/22, docs/18, CLAUDE.md or anything under QA/. docs/27 and frontend/libs/offline/README.md change only where the ruling says.`
const RULES = `PRODUCT RULES: screens import only @dos/ui (plus expo-router, @dos/api-client, @dos/offline, @dos/domain, @dos/contracts); data only through @dos/api-client and @dos/offline; universal apps (web + Android + iOS); docs/27 binding; no backend, contract or permission change; no kit type change unless the ruling says so.
QA CHARTER: implement exactly ruling 3's mandatory amendments on top of everything merged, nothing adjacent; red-first tests as the ruling names them; never weaken a test; never report what you did not execute.`

const buildPrompt = (ruling) => `You are implementing DOS-167 ruling 3 on Distribution OS in an isolated worktree, as a careful senior engineer.

${ENV}

${RULES}

${FOUNDER}

RULING 3 (binding; it amends everything before it): cat "${R3MD}" ; structured: ${JSON.stringify(ruling, null, 1)}
Also read: cat "${DESIGN}" "${R1}" "${R2MD}" "${ADD}".
SETUP FIRST: git merge --ff-only main (must fast-forward, else return blocked); cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; cd frontend && pnpm install.
FOR EACH MANDATORY AMENDMENT in the ruling's order: write its red-first tests and confirm each FAILS for the ruling's reason (keep the excerpts); implement; run its tests green, then frontend/libs/offline/src/identity.test.ts, engine.test.ts, frontend/libs/api-client/src/identity.test.ts, the three apps' src/lib/leave.test.ts and frontend/sales-app/src/lib/draft.test.ts (one per command), then typecheck and lint for every touched package; prettier --write on touched files; commit "fix(DOS-167): ruling 3 (<id>) — <short>" with "Test: <file> › <name>" lines and ${CO}.
FINALLY git status clean; return the structured result with one amendments entry per ruling-3 amendment.`

const verifyPrompt = (ruling, b) => `You are the adversarial verifier of DOS-167 ruling 3 on Distribution OS. Assume it is wrong until proven right. You make no commits.

${ENV}

${RULES}

${FOUNDER}

Ruling 3: cat "${R3MD}" ; ${JSON.stringify(ruling, null, 1)}
Implementer report: ${JSON.stringify(b, null, 1)}
1. git log --oneline main..HEAD and git show --stat per commit: only the files the ruling names.
2. PROVE RED per commit C: git diff C^ C -- . ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/package.json' ':(exclude)docs/**' ':(exclude)**/README.md' | git apply -R ; run its tests: each FAILS for the ruling's reason; restore with git checkout -- . and remove untracked leftovers.
3. PROVE GREEN: the new tests; identity.test.ts, engine.test.ts, api-client identity.test.ts, the three leave tests, the sales draft test; typecheck and lint for the touched packages.
4. For every mandatory amendment find the code or test that satisfies it (amendmentsChecked); missing is major.
5. Hunt: any startup path that can still open, create or delete a pool file before or beside the engine's own store on web; an open failure that can hang silently; a memory fallback that is not announced; an app among sales, delivery and warehouse that still passes no onLog; a status that reports 'will not keep' before the open resolves, or never reports it on a real memory store; anything from rulings 1 and 2 or the addenda regressed.
6. git status clean at the end.
verdict 'pass' only if red before, green after, every mandatory amendment satisfied and no blocker or major problem remains.`

const repairPrompt = (ruling, b, v) => `You are repairing DOS-167 ruling 3 on Distribution OS after an adversarial review.

${ENV}

${RULES}

${FOUNDER}

Ruling 3: cat "${R3MD}"
Implementer report: ${JSON.stringify(b, null, 1)}
Verifier verdict: ${JSON.stringify(v, null, 1)}
Fix every blocker, major and unsatisfied amendment with new commits "fix(DOS-167): ruling 3 — address review, <short>" (${CO}); never rewrite history. Re-run the named tests, typecheck and lint. git status clean. Return the structured result for the whole round.`

const reviewPrompt = (b, v) => `${STAND} Review DOS-167 ruling 3 before it merges into main. Read-only: edit nothing except the ONE output file below; no builds, tests or git writes; do not touch .claude/worktrees.

${FOUNDER}

BRANCH ${BR}: git -C "${MAIN}" log --oneline main..${BR} ; git -C "${MAIN}" diff main...${BR}
Ruling 3: cat "${R3MD}". Builder: ${JSON.stringify(b, null, 1)} Verifier: ${JSON.stringify(v, null, 1)}
Lenses: LEAK (no path shows or uploads another person's or distributor's data), LOSS (no change of the same person lost or duplicated), PLATFORM (web OPFS pool under slow and cold loads, a production export, Android and iOS expo-sqlite, the three apps alike). Also: the ruling followed exactly; conflicts with main now and with the lanes b2-money, b2-dos171, b2-dos172 and b2-s108; the walks still needed.
Write ${MAIN}/QA/evidence/batch2/merge-reviews/dos167-ruling3.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const integratePrompt = (review, repairOf) => `You are the INTEGRATOR of DOS-167 ruling 3 for Distribution OS. Merge main into the lane, resolve conflicts keeping both sides, resolve every review blocker, prove the merged tree green with the FULL frontend gate, and commit. You do NOT merge into main.

${ENV}
- INTEGRATOR git: you may merge main INTO ${BR}, use checkout --ours/--theirs while resolving, and merge --abort. You MAY run the full frontend gate below, one turbo task at a time.

${RULES}

${FOUNDER}

REVIEW (binding): cat "${MAIN}/QA/evidence/batch2/merge-reviews/dos167-ruling3.md". Blockers: ${JSON.stringify(review.blockers, null, 1)}
Each blocker was raised against the branch AS REVIEWED: a commit that already existed then is never its fix. Resolve each with a new commit (a failing test first, then the fix).
STEPS:
1. git merge main -m "Merge main into ${BR} before merging it back".
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; cd frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above.
4. The FULL frontend gate on the merged tree, inside frontend: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1; pnpm format:check; pnpm exec turbo run build --concurrency=1 (remove untracked build output). A red result is a blocker unless the identical command shows the identical failure on main (then return blocked and say so).
5. cd backend && pnpm docs:readme:check.
6. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the integration verifier found problems; fix every blocker and major with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const iverifyPrompt = (r, review) => `You verify the integration of DOS-167 ruling 3 before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${ENV}

${FOUNDER}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -15; HEAD equals ${r.headCommit}; tree clean.
2. For each merge commit: git show --cc; every hunk from both sides survived in conflicted files.
3. REVIEW BLOCKERS: ${JSON.stringify(review.blockers, null, 1)}. For EACH, read the file:line it names on HEAD and show the code that resolves it; prove one blocker fix red by reversing its non-test change, then restore.
4. In frontend: pnpm exec turbo run test --continue --concurrency=1 is fully green, and pnpm typecheck exits 0.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the gate passes.`

const mergePrompt = (r) => `Merge DOS-167 ruling 3 into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${BR} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${BR} reports no conflict (else blocked). If any commit in git -C "${MAIN}" log ${BR}..main touches a file this branch changed, return blocked: it needs re-integration.
4. git -C "${MAIN}" merge --no-ff ${BR} -m "Merge QA batch 2 P0 DOS-167 ruling 3: the web store opens under slow loads, the offline log lines print, and the not-kept warning shows only for a real memory store

Ruling 3 (Opus standing in for Fable) from an executed diagnosis of S-138; also S-139 and S-140. Built test-first on Opus with adversarial verification; merge review QA/evidence/batch2/merge-reviews/dos167-ruling3.md; the full frontend gate on the merged tree. Re-proof follows.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const PROOF_ENV = (platform) => `ENVIRONMENT — the live QA stack in the main checkout:
- Work in "${MAIN}" on main, where ruling 3 is merged. Start every Bash command with: cd "${MAIN}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null
- NEVER edit product source, commit, merge, reset or checkout. Write evidence ONLY under ${EV}/${platform}/; the web prover may also edit QA/tools/e2e/s-098-shared-device.mjs. Before returning, git status --short shows changes only under QA/.
${SHARED}
- THE SCRIPT for this run: ruling 3's Re-proof section (cat "${R3MD}") plus the WALKS section of ${MAIN}/QA/evidence/batch2/merge-reviews/dos167-ruling3.md. Earlier evidence for comparison: ${PREV}/.
${FOUNDER}`

const PROOFS = [
  { key: 'web', prompt: (head) => `RE-PROOF — WEB, P0 DOS-167 after ruling 3, main ${head}.

${PROOF_ENV('web')}

PREPARE (you run first): cd backend && pnpm exec turbo run build --filter='./libs/*'; export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_qa && pnpm db:migrate; /health on :3000-:3007 answers 200 (restart with QA/tools/start-services.sh if needed).
RUN every WEB item of ruling 3's re-proof, at minimum: (1) the first load right after a fresh sales Metro start with --clear, three times (restart Metro between runs): the persistent store opens (an OPFS header for the signed-in person, decoded), a manifest call and a pull happen, no 'not a database', the beat fills; (2) a warm Metro with 600 ms added to the expo-sqlite chunk and worker, three times: the same; (3) the production export first visit with the same added latency, three times, if the diagnosis or the ruling requires it; (4) V5A, V5B and V5C once each on the persistent store; (5) a DOM watch at 25 ms or finer through V5A-V5C: the not-kept line never appears on the persistent store; (6) the memory variant without header injection: the console prints the no-persistent-store line, and the not-kept line and the memory sheet show; (7) anything else the ruling lists for web.
Before returning: stop Chromium; LEAVE the services and the sales Metro :5175 running for the Android prover.` },
  { key: 'android', prompt: (head) => `RE-PROOF — ANDROID sales, P0 DOS-167 after ruling 3, main ${head}.

${PROOF_ENV('android')}

The services and the sales Metro :5175 should be running; check and start what is missing.
RUN every ANDROID item of ruling 3's re-proof, at minimum: (1) the long-name upgrade with one queued op (the 199952b JavaScript from the idle worktree ${MAIN}/.claude/worktrees/b2-dos167, as the previous prover did), with logcat showing the kept-store line and the ops intact; (2) kept drafts (ruling u): type an order draft, 'Sign out, keep here' with a change queued, sign back in as the same person: the draft and the queued change are there; (3) a short leak sanity (A signs out, B signs in, no A marker, only B's file); (4) any two-distributor or distributor-switch walk the ruling requires.
Evidence under ${EV}/android/. Before returning: adb emu kill; stop any Metro you started; leave the services running.` },
  { key: 'ios', prompt: (head) => `RE-PROOF — iOS sanity, P0 DOS-167 after ruling 3, main ${head}.

${PROOF_ENV('ios')}

The services should be running; start the sales Metro on :5175 if it is not. Appium on :4723 (start it if not).
RUN every iOS item of ruling 3's re-proof, at minimum: the sales app on the iPhone 16 Pro simulator (Expo Go): A signs in (one store file, decoded), a one-tap sign-out (file gone), B of another distributor signs in (an early screenshot with no A marker, only B's file); then one 'Sign out, keep here' with the office unreachable while the outbox retries, a relaunch at the sign-in form with no new .ips crash report, and the kept op sent once at A's next sign-in.
Evidence under ${EV}/ios/. Before returning: xcrun simctl shutdown all; stop the Metro you started; leave the services and Appium running.` },
]

const judgePrompt = (head, proofs, review) => `${STAND} Judge whether the P0 DOS-167 is closed after ruling 3 merged (${head}). Read-only: no edits, builds or git writes.

${FOUNDER}

Read: cat "${DESIGN}" "${R1}" "${R2MD}" "${ADD}" "${R3MD}"; the merge reviews ${MAIN}/QA/evidence/batch2/merge-reviews/dos167-*.md (this one: ${review ? review.decision : 'none'}).
The previous re-proof (Android delivery and warehouse and iOS sales, delivery and warehouse proven there): ${PROOFS_SO_FAR}
THIS RE-PROOF (evidence under ${EV}/):
${JSON.stringify(proofs, null, 1)}
Open a sample of the evidence at the decisive checkpoints (the OPFS listings on cold and slow loads, the flash watch, the console lines, the logcat line, the kept-draft screenshots, the iOS early screenshot). Do not trust a PASS whose evidence does not show it.
For web sales (persistent, cold and slow loads), web memory variant, Android sales, Android delivery, Android warehouse, iOS sales, iOS delivery and iOS warehouse: proven | failed | partial | not-tested, with the reason; a platform proven in the previous re-proof and untouched by ruling 3's files stays proven unless this run contradicts it. overall = 'closed' only when web sales (persistent, cold and slow) is proven, the S-139 and S-140 checks pass, and nothing failed anywhere; 'partially-proven' when nothing failed but something required is not tested; 'open' when anything failed. List the gaps accepted as NOT TESTED with their reasons and any new defect. summary = three plain sentences for the founder.`

const bad = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity !== 'minor') || (v.amendmentsChecked || []).some((a) => !a.satisfied)
const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity !== 'minor')
const out = {}

phase('Diagnose')
const diag = await agent(diagnosePrompt(), { label: 'diagnose:S-138', phase: 'Diagnose', schema: DIAG, model: 'opus' })
out.diagnosis = diag
if (!diag) return { ...out, final: 'diagnosis-failed' }

phase('Ruling')
const ruling = await agent(rulingPrompt(diag), { label: 'ruling3:dos167', phase: 'Ruling', schema: RULING, model: 'opus' })
out.ruling = ruling
if (!ruling) return { ...out, final: 'ruling-failed' }
if (ruling.needsFounder) { log('DOS-167 ruling 3 needs a founder answer'); return { ...out, final: 'needs-founder' } }

phase('Build')
let b = await agent(buildPrompt(ruling), { label: 'build:ruling3', phase: 'Build', schema: RESULT, model: 'opus' })
out.build = b
if (!b || b.status !== 'fixed') return { ...out, final: 'build-not-fixed' }
let v = await agent(verifyPrompt(ruling, b), { label: 'verify:ruling3', phase: 'Build', schema: VERDICT, model: 'opus' })
if (bad(v)) {
  const r = await agent(repairPrompt(ruling, b, v), { label: 'repair:ruling3', phase: 'Build', schema: RESULT, model: 'opus' })
  if (r) {
    b = r
    v = await agent(verifyPrompt(ruling, b), { label: 'reverify:ruling3', phase: 'Build', schema: VERDICT, model: 'opus' })
  }
}
out.build = b
out.verdict = v
if (bad(v)) return { ...out, final: 'not-verified' }

phase('Review')
const review = await agent(reviewPrompt(b, v), { label: 'review:ruling3', phase: 'Review', schema: REVIEW, model: 'opus' })
out.review = review
if (!review || review.decision === 'DO NOT MERGE') return { ...out, final: 'review-blocked' }

phase('Integrate')
let integ = await agent(integratePrompt(review, null), { label: 'integrate:ruling3', phase: 'Integrate', schema: INTEG, model: 'opus' })
if (!integ || integ.status !== 'ready') return { ...out, final: 'integration-blocked', integration: integ }
let iv = await agent(iverifyPrompt(integ, review), { label: 'integ-verify:ruling3', phase: 'Integrate', schema: IVERDICT, model: 'opus' })
if (ivBad(iv)) {
  const again = await agent(integratePrompt(review, iv), { label: 'integrate-repair:ruling3', phase: 'Integrate', schema: INTEG, model: 'opus' })
  if (again && again.status === 'ready') {
    integ = again
    iv = await agent(iverifyPrompt(integ, review), { label: 'integ-reverify:ruling3', phase: 'Integrate', schema: IVERDICT, model: 'opus' })
  }
}
out.integration = integ
out.integrationVerdict = iv
if (ivBad(iv)) return { ...out, final: 'integration-verify-failed' }
const merged = await agent(mergePrompt(integ), { label: 'merge:ruling3', phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
out.merge = merged
if (!merged || merged.status !== 'merged') return { ...out, final: 'merge-blocked' }
log(`DOS-167 ruling 3 merged ${merged.mainHead}`)

phase('Proof')
const proofs = []
for (const p of PROOFS) {
  const res = await agent(p.prompt(merged.mainHead), { label: `reproof3:${p.key}`, phase: 'Proof', schema: PROOF, model: 'opus' })
  proofs.push(res || { platform: p.key, verdict: 'not-run', steps: [], defects: [], notTested: ['the prover returned nothing'], environment: '' })
  log(`reproof3 ${p.key}: ${res ? res.verdict : 'no result'}`)
}
out.proofs = proofs

phase('Judge')
out.judge = await agent(judgePrompt(merged.mainHead, proofs, review), { label: 'judge3:dos167', phase: 'Judge', schema: JUDGE, model: 'opus' })
return { ...out, final: 'proof-judged' }
