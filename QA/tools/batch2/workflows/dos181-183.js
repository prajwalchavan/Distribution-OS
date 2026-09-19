export const meta = {
  name: 'qa-batch2-dos181-183',
  description: "The three defects the DOS-167 walks found: unsent web work that does not go first at sign-in (DOS-183, on the P0 path), an Android delivery button that never fires so a driver cannot close a stop (DOS-181), and a pick sheet that locks the picker out for six minutes with no signal (DOS-182). Fable designs the engine fix, Opus builds test-first, Fable reviews, both lanes merge, then the web goes-first walk and the Android delivery walk re-run and Fable re-judges DOS-167.",
  phases: [
    { title: 'Design', detail: 'Fable: the shape of the flush-before-pull fix and the reconnect gap' },
    { title: 'Build', detail: 'two lanes — the offline engine, and the two app defects' },
    { title: 'Review', detail: 'Fable per lane' },
    { title: 'Integrate', detail: 'gates on the merged tree, engine merges first' },
    { title: 'Proof', detail: 'the web goes-first walk and the Android delivery walk, on real targets' },
    { title: 'Judge', detail: 'Fable decides whether DOS-167 closes' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const EV = MAIN + '/QA/evidence/batch2/dos-181-183'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

const FOUNDER = `FOUNDER ANSWER A (2026-09-14, binding, the whole point of DOS-167): when a person signs out, their unsent changes stay on THAT device for THAT person only and **go FIRST at that person's next sign-in**. Nothing is thrown away and nobody else may see them. Never-list #11, #12, #13 apply.`

const LIMITS = `STANDING RULES: never touch the founder's own databases (dos, dos_qa) from a lane; never force-push, reset --hard, rebase or delete a branch; never weaken a test, a validation or a permission; never report a command you did not run or an outcome you did not see. If ports :3000-:3007 are already held, do NOT kill them: use backend/all-in-one on :3100 with --base.`

const RULES = `PRODUCT RULES: screens import only @dos/ui; anything platform-specific lives in @dos/ui/platform behind one signature; docs/27 is binding for the offline client; /sync/upload never answers 4xx; every mutation idempotent with a client UUIDv7 id; money integer paise.`

const DESIGN = { type: 'object', required: ['file', 'decisions', 'openQuestions'], properties: { file: { type: 'string' },
  decisions: { type: 'array', items: { type: 'object', required: ['id', 'rule', 'where', 'redTest'], properties: { id: { type: 'string' }, rule: { type: 'string' }, where: { type: 'string' }, redTest: { type: 'string' } } } },
  openQuestions: { type: 'array', items: { type: 'string' } } } }
const RESULT = { type: 'object', required: ['lane', 'status', 'itemsDone', 'commits', 'filesChanged', 'deviations', 'followUps'], properties: {
  lane: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
  itemsDone: { type: 'array', items: { type: 'object', required: ['id', 'failBefore', 'passAfter', 'test'], properties: { id: { type: 'string' }, failBefore: { type: 'string' }, passAfter: { type: 'string' }, test: { type: 'string' } } } },
  commits: { type: 'array', items: { type: 'string' } }, filesChanged: { type: 'array', items: { type: 'string' } }, deviations: { type: 'string' }, followUps: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['verdict', 'itemsChecked', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] },
  itemsChecked: { type: 'array', items: { type: 'object', required: ['id', 'redProven', 'greenProven', 'detail'], properties: { id: { type: 'string' }, redProven: { type: 'boolean' }, greenProven: { type: 'boolean' }, detail: { type: 'string' } } } },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, detail: { type: 'string' } } } },
  evidence: { type: 'string' } } }
const REVIEW = { type: 'object', required: ['decision', 'blockers', 'minors', 'conflicts', 'walks', 'unfiledDefects'], properties: {
  decision: { type: 'string', enum: ['MERGE', 'MERGE AFTER FIXES', 'DO NOT MERGE'] }, blockers: { type: 'array', items: { type: 'string' } }, minors: { type: 'array', items: { type: 'string' } },
  conflicts: { type: 'array', items: { type: 'string' } }, walks: { type: 'array', items: { type: 'string' } }, unfiledDefects: { type: 'array', items: { type: 'string' } } } }
const PREP = { type: 'object', required: ['status', 'base', 'notes'], properties: { status: { type: 'string', enum: ['ready', 'blocked'] }, base: { type: 'string' }, notes: { type: 'string' } } }
const INTEG = { type: 'object', required: ['status', 'headCommit', 'conflicts', 'fixes', 'testsRun', 'notes'], properties: {
  status: { type: 'string', enum: ['ready', 'blocked'] }, headCommit: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } },
  fixes: { type: 'array', items: { type: 'string' } }, testsRun: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
const IVERDICT = { type: 'object', required: ['verdict', 'problems', 'evidence'], properties: { verdict: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } } } }
const MERGED = { type: 'object', required: ['status', 'mainHead', 'pushed', 'notes'], properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, pushed: { type: 'boolean' }, notes: { type: 'string' } } }
const PROOF = { type: 'object', required: ['case', 'outcome', 'whatWasSeen', 'evidence', 'problems'], properties: {
  case: { type: 'string' }, outcome: { type: 'string', enum: ['pass', 'fail', 'not-tested'] }, whatWasSeen: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }, problems: { type: 'array', items: { type: 'string' } } } }
const JUDGE = { type: 'object', required: ['decision', 'why', 'openItems'], properties: { decision: { type: 'string', enum: ['closed', 'not-closed'] }, why: { type: 'string' }, openItems: { type: 'array', items: { type: 'string' } } } }

const LANES = [
  { key: 'engine', ids: ['DOS-183'], after: [], db: 'dos_test_b2_d183',
    scope: "THIS LANE = frontend/libs/offline only (engine.ts, react.tsx, connection.ts and their tests), plus docs/27 where the design says so. Do not touch an app screen." },
  { key: 'apps', ids: ['DOS-181', 'DOS-182'], after: ['engine'], db: 'dos_test_b2_d181',
    scope: "THIS LANE = frontend/delivery-app/app/deliver.tsx and frontend/warehouse-app/app/pick/[id].tsx and their tests. DOS-181: the footer button's onPress never fires though the pressed style renders — find the real cause (a Pressable swallowed by a parent, a disabled prop, a hit area, a LogBox overlay is NOT it: the style renders, so the view has the touch) and fix it, then pin it with a test that fails without the fix. DOS-182: `locked = liveStatus === undefined || notStarted` waits for a read to reach the office; a wave already on the phone must be pickable with no signal — distinguish 'not loaded yet' from 'loaded and not started'." },
]

const wt = (l) => MAIN + '/.claude/worktrees/b2-' + l.key
const branchOf = (l) => 'qa/b2-' + l.key
const block = (id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'`
const blocks = (l) => l.ids.map(block).join(' ; ')
const env = (l) => `ENVIRONMENT: your worktree is "${wt(l)}" on branch ${branchOf(l)}. Start EVERY Bash command with: cd "${wt(l)}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${l.db}
- Never edit anything in "${MAIN}" or another worktree. Do NOT start dev servers, emulators or simulators.
- 8 GB RAM shared with other agents: one test file per command unless a step names a wider gate.`

const designPrompt = () => `You are Fable, the ARCHITECT. Design the fix for DOS-183, the one clause of the founder's P0 that still fails. READ-ONLY except the ONE output file below.

${FOUNDER}

WHAT WAS MEASURED, on a real browser, one tab, twice: a sign-in over a store file holding an unsent order **pulled first and uploaded only at +60 753 ms** on the poll tick; and a page that booted offline made **no call for 49.5 s** after a genuine online event, then pulled before uploading. Cause read after observing: \`engine.ts:452-488\` \`start()\` runs \`sync('start')\` and never \`flush()\`; the only pre-pull flush is \`applyManifest\`'s stale branch (\`:1088-1097\`), reached only when \`dropReadSet\` nulled the manifest state — so a sign-out from another tab, a crash or a closed window leaves the promise unmet. Separately, \`setNetworkHint(true)\` (\`engine.ts:1012-1023\`) returns early because \`radio()\` falls back to \`navigator.onLine\`, already true inside the online handler, so a page that booted offline never gets its reconnect flush.

READ: ${MAIN}/docs/27-offline-sync-client-design.md (binding — §4, §12, §14 especially), frontend/libs/offline/src/engine.ts, react.tsx, connection.ts, and ${block('DOS-183')}

DECIDE:
- Exactly where the flush belongs so that unsent work goes FIRST on every path into a session: a fresh sign-in, a sign-in over a kept file, a reload, a page that booted offline and then found the network, and a second tab. Say what must NOT change — the pull must still happen, the outbox must stay FIFO with the original opId, and a flush that fails must not block the pull for ever.
- What \`radio()\` and \`setNetworkHint\` should do so a reconnect is never swallowed, without adding a poll.
- The ORDER guarantee in words a test can assert: what must be observably true, and against what clock.
- Whether docs/27 needs a line changed, and which.
- Any risk this creates: a thundering flush on a cold start, a flush racing a pull, an op sent twice, a stale manifest applied over fresh local rows.
For each decision name the RED-FIRST test: file, test name carrying DOS-183, and what must fail before the fix.

Write ${VERD}/DOS-183-design.md (under 90 lines), sign it "Fable, architect", date 2026-09-20. Return the structured summary.`

const implPrompt = (l, design) => `You are implementing a founder-approved fix for Distribution OS in an isolated worktree, as a careful senior engineer. Lane ${l.key}: ${l.ids.join(', ')}.

${env(l)}

${RULES}

${LIMITS}

${FOUNDER}

${l.key === 'engine' ? 'THE DESIGN IS BINDING: cat "' + VERD + '/DOS-183-design.md"\nArchitect summary: ' + JSON.stringify(design, null, 1) : 'No architect design was needed for these two: they are plain defects. Fix the cause, not the symptom.'}

${l.scope}

Findings:
${blocks(l)}

SETUP: the worktree and database are prepared. cd frontend && pnpm install; cd ../backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' if you touch anything backend.
For EACH item: write the red-first test FIRST (its name carries the id), run it, confirm it fails for the finding's reason, then fix at the cause, then green. Run the whole touched test files, typecheck and lint the touched packages, prettier --write. Commit each item alone: "fix(<ID>): <one line>" + two sentences + "Test: <file> › <name>" + ${CO}.
For DOS-181 especially: a test that only checks the handler is wired is not enough — prove the press reaches it.
git status clean. Return the structured result.`

const verifyPrompt = (l, impl) => `You are the adversarial verifier of lane ${l.key} (${l.ids.join(', ')}). Assume every item is wrong until proven right. You make no commits.

${env(l)}

${RULES}

${LIMITS}

${FOUNDER}

Implementer report: ${JSON.stringify(impl, null, 1)}
Findings:
${blocks(l)}
${l.key === 'engine' ? 'Design: cat "' + VERD + '/DOS-183-design.md"' : ''}

1. git log --oneline main..HEAD — one commit per item, nothing adjacent.
2. PROVE RED per commit: reverse the non-test change, rebuild the affected library, run that item's test, confirm it fails for the finding's reason, restore.
3. PROVE GREEN: each item's test, then every whole touched test file, then in frontend pnpm typecheck, pnpm lint and pnpm exec turbo run test --continue --concurrency=1 **--force** (a cache hit cannot prove the cross-app guards — S-155).
4. Hunt, per item. DOS-183: an op sent twice; the outbox losing FIFO or its original opId; a failed flush blocking the pull for ever; a stale manifest applied over fresher local rows; a flush that fires on every render. DOS-181: a fix that only works under the test's own harness; a press that still misses on a real device. DOS-182: a picker now allowed to pick a wave that genuinely is not on the phone.
5. git status clean.
verdict 'pass' only when every item was red before and green after and no blocker or major remains.`

const repairPrompt = (l, impl, v) => `You are repairing lane ${l.key} after an adversarial review.

${env(l)}

${RULES}

${LIMITS}

Implementer report: ${JSON.stringify(impl, null, 1)}
Verifier verdict: ${JSON.stringify(v, null, 1)}
Fix every blocker and major with NEW commits "fix(<ID>): address review — <short>" (${CO}); never rewrite history. Re-run each test, the touched files, typecheck and lint. git status clean. Return the updated result.`

const reviewPrompt = (l, built) => `You are Fable, the ARCHITECT. Review lane ${l.key} (${l.ids.join(', ')}) before it merges into main. Read-only except the ONE output file.

${FOUNDER}

LANE: git -C "${MAIN}" log --oneline main..${branchOf(l)} ; git -C "${MAIN}" diff main...${branchOf(l)}
${l.key === 'engine' ? 'Your design: cat "' + VERD + '/DOS-183-design.md"' : ''}
Findings:
${blocks(l)}
Build reports: ${JSON.stringify(built, null, 1)}

Judge: is the fix at the cause; would the test fail without it; does the founder's "goes first" now hold on every path into a session, including the ones nobody walked; is anything at risk of being sent twice or lost. Name the walks still owed and any defect outside the lane with file:line.
Write ${REV}/${l.key}.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const preparePrompt = (l) => `Prepare an isolated lane for Distribution OS QA batch 2, lane ${l.key}. Mechanical setup only.

${LIMITS}

1. cd "${MAIN}" && git rev-parse --short main — the base.
2. If "${wt(l)}" does not exist: git -C "${MAIN}" worktree add -b ${branchOf(l)} "${wt(l)}" main. If it exists: cd in, confirm the branch, git merge --ff-only main (blocked if it cannot fast-forward).
3. dropdb -h 127.0.0.1 -p 5439 -U dos --force ${l.db} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${l.db}; point THIS worktree's backend/.env at ${l.db}.
4. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install
5. mkdir -p "${EV}". git status --short clean apart from that .env. Return the structured result.`

const integratePrompt = (l) => `You are the INTEGRATOR of lane ${l.key} (${l.ids.join(', ')}). Merge main into the lane, resolve every review blocker, prove the merged tree green, commit. You do NOT merge into main.

${env(l)}
- You may merge main INTO ${branchOf(l)}, use checkout --ours/--theirs, and merge --abort.

${RULES}

${LIMITS}

REVIEW (binding): cat "${REV}/${l.key}.md". A commit that already existed when the review was written is never its fix.
1. git merge main -m "Merge main into ${branchOf(l)} before merging it back". Main is moving tonight: the DOS-175..180 lanes land around the same time and touch frontend/libs/offline and the delivery app. Resolve keeping both sides.
2. cd frontend && pnpm install (commit a changed lockfile); backend the same if touched.
3. Every review blocker, each with a test that fails for its reason.
4. Gates on the merged tree, in frontend: pnpm lint; pnpm typecheck; **pnpm exec turbo run test --continue --concurrency=1 --force**; pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output. Backend gates too if anything backend changed.
5. git status clean. Return the result with headCommit = git rev-parse --short HEAD.`

const iverifyPrompt = (l, r) => `You verify the integration of lane ${l.key} before it merges into main. Assume something was dropped. You make no commits.

${env(l)}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. git show --cc on the merge: every hunk from both sides survived — frontend/libs/offline is being edited by more than one lane tonight.
3. Review blockers, read on HEAD, each with the resolving code; prove one red by reversal, then restore.
4. Re-run in frontend: pnpm exec turbo run test --continue --concurrency=1 --force and pnpm typecheck. A cache hit is not evidence.
verdict 'pass' only when nothing was dropped, every blocker is closed and the gates are green.`

const mergePrompt = (l, r) => `Merge the verified lane ${branchOf(l)} into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else blocked).
2. git -C "${MAIN}" rev-parse --short ${branchOf(l)} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${branchOf(l)} reports no conflict (else blocked).
4. git -C "${MAIN}" merge --no-ff ${branchOf(l)} -m "Merge QA batch 2 lane ${l.key}: ${l.ids.join(', ')}

Found by the DOS-167 walks. Designed by Fable where the shape needed deciding, built
test-first with adversarial verification, reviewed by Fable, gated on the merged tree.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.
IF A PERMISSION CLASSIFIER REFUSES THE MERGE rather than git: stop after two tries, return status 'blocked' saying exactly that and naming the branch head. The main session finishes such a merge by hand.`

const PROOFS = [
  { key: 'web-goes-first', prompt: (head) => `Prove DOS-183 on a REAL browser, on main at ${head}. Operate the app; do not infer from code.
Sales app on web against the running services. Build the exact state that failed: a store file holding an unsent order whose previous session did NOT end through end() on that file — a sign-out from another tab, or a closed window. Sign in.
PASS means: the upload of the unsent order happens BEFORE the first pull, in the same session start, with no 60-second wait — record the millisecond offsets from the network log, not an impression. Then do it again on a page that BOOTED OFFLINE and then found the network: the flush must follow the online event within a second or two, not 49 s.
Also show nothing regressed: the pull still happens, the op is sent ONCE, and the order lands in the office exactly once. Evidence into "${EV}/"; name every file.` },
  { key: 'android-delivery-button', prompt: (head) => `Prove DOS-181 on a REAL device, on main at ${head}. Pixel_7_API_36 with -memory 3072, Appium/UiAutomator2 addressing by resource-id or text, never raw coordinates.
Open a stop on the delivery app, reach the deliver screen, and press the footer button — online ("Record the delivery") and again with the office unreachable ("Save on this phone"). PASS means both presses actually DO something: online the delivery is recorded and the office has it; offline a row and an outbox entry exist on the phone, and the op is sent once when the network returns.
Note: airplane mode alone does not cut this app off on this emulator — remove the adb reverse and stop the service too. LogBox draws over the footer; dismiss it rather than tapping through it. Evidence into "${EV}/"; name every file. If a control still cannot be driven, say exactly which and what you tried, and report 'not-tested' rather than a pass you did not see.` },
]

const proofPrompt = (p, head) => `You are proving one fix by OPERATING the app, for the Distribution OS QA programme. You make no commits and change no product code.

${FOUNDER}

${LIMITS}
- You MAY start dev servers and the emulator, and you must stop what you started. Write only under "${EV}".
- Never report a step you did not perform. 'not-tested' is an honest answer; a guess is not.

${p.prompt(head)}`

const judgePrompt = (head, proofs) => `You are Fable, the ARCHITECT, deciding whether DOS-167 is CLOSED for Distribution OS. Read-only.

${FOUNDER}

You judged DOS-167 NOT CLOSED earlier tonight on one clause: on the web, unsent work did not go first — it was uploaded on the 60-second poll tick, and a page that booted offline waited 49.5 s. That is DOS-183, now designed by you, built, reviewed by you and merged. Main is at ${head}.

Your earlier judgement and its open items: cat "${VERD}/DOS-167-judge.md"
Your design: cat "${VERD}/DOS-183-design.md"
The fresh proofs, as executed:
${JSON.stringify(proofs, null, 1)}

Decide 'closed' ONLY if, on every target, a person's unsent changes survive sign-out on that device, GO FIRST at that person's next sign-in, and never reach anybody else. A case reported 'not-tested' is not a pass. Say plainly which of your earlier open items remain, and which of them are DOS-167's and which belong to other findings.
Write ${VERD}/DOS-167-judge-2.md (under 60 lines) and return the structured decision.`

const serious = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity !== 'minor')
const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity === 'blocker')
const settled = {}
const settle = {}
for (const l of LANES) settled[l.key] = new Promise((res) => { settle[l.key] = res })
let mergeChain = Promise.resolve()
const serialized = (fn) => { const p = mergeChain.then(fn, fn); mergeChain = p.catch(() => {}); return p }
const out = {}

phase('Design')
const design = await agent(designPrompt(), { label: 'design:DOS-183', phase: 'Design', schema: DESIGN, model: 'fable' })
if (!design) return { final: 'design-failed' }
out.design = design

async function runLane(l) {
  const o = { lane: l.key, ids: l.ids }
  try {
    if (l.after.length) await Promise.all(l.after.map((k) => settled[k]))
    const prep = await agent(preparePrompt(l), { label: `prep:${l.key}`, phase: 'Build', schema: PREP, model: 'sonnet', effort: 'low' })
    if (!prep || prep.status !== 'ready') { o.final = 'prepare-blocked'; return o }
    let b = await agent(implPrompt(l, design), { label: `impl:${l.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
    if (!b) { o.final = 'agent-failed'; return o }
    let v = await agent(verifyPrompt(l, b), { label: `verify:${l.key}`, phase: 'Build', schema: VERDICT, model: 'opus' })
    if (serious(v)) {
      const r = await agent(repairPrompt(l, b, v), { label: `repair:${l.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
      if (r) { b = r; v = await agent(verifyPrompt(l, b), { label: `reverify:${l.key}`, phase: 'Build', schema: VERDICT, model: 'opus' }) }
    }
    o.impl = b; o.verdict = v
    if (serious(v)) { o.final = 'not-verified'; return o }
    const review = await agent(reviewPrompt(l, { commits: b.commits, itemsDone: b.itemsDone, deviations: b.deviations, verifier: { verdict: v.verdict, problems: v.problems } }), { label: `review:${l.key}`, phase: 'Review', schema: REVIEW, model: 'fable' })
    o.review = review
    if (!review || review.decision === 'DO NOT MERGE') { o.final = 'review-blocked'; return o }
    const m = await serialized(async () => {
      let integ = await agent(integratePrompt(l), { label: `integrate:${l.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
      if (!integ || integ.status !== 'ready') return { final: 'integration-blocked', integration: integ }
      const iv = await agent(iverifyPrompt(l, integ), { label: `integ-verify:${l.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
      if (ivBad(iv)) return { final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
      const merged = await agent(mergePrompt(l, integ), { label: `merge:${l.key}`, phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
      log(`${l.key}: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked — the main session finishes it by hand'}`)
      return { final: merged && merged.status === 'merged' ? 'merged' : 'merge-blocked', integration: integ, merge: merged }
    })
    Object.assign(o, m)
    return o
  } catch (e) { o.final = 'error'; o.error = String(e); return o } finally { settle[l.key]() }
}

const lanes = await parallel(LANES.map((l) => () => runLane(l)))
out.lanes = lanes
const head = (lanes.find((r) => r && r.merge && r.merge.mainHead) || {}).merge?.mainHead ?? 'main'

phase('Proof')
const proofs = []
for (const p of PROOFS) {
  const res = await agent(proofPrompt(p, head), { label: 'proof:' + p.key, phase: 'Proof', schema: PROOF, model: 'opus' })
  proofs.push(res || { case: p.key, outcome: 'not-tested', whatWasSeen: 'agent failed', evidence: [], problems: ['agent failed'] })
  log(p.key + ': ' + (res ? res.outcome : 'agent failed'))
}
out.proofs = proofs

phase('Judge')
out.judge = await agent(judgePrompt(head, proofs), { label: 'judge2:dos167', phase: 'Judge', schema: JUDGE, model: 'fable' })
return { ...out, final: 'done' }
