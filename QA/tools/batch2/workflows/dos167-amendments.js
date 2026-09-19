export const meta = {
  name: 'qa-batch2-dos167-amendments',
  description: "DOS-167: implement Fable's five binding amendments to ruling 3 (the persistent widening threaded through every hop, the memory fallback releasing the failed hold, a single-VFS assertion in the S-138 gate, a second tab of the same person, and the timeout path closing rather than destroying a late handle), verify adversarially, let Fable review, merge, re-prove only the cases they touch, and have Fable judge whether DOS-167 closes",
  phases: [
    { title: 'Build', detail: 'implementer and adversarial verifier, one repair round' },
    { title: 'Review', detail: 'Fable, architect — the amendments are hers' },
    { title: 'Integrate', detail: 'merge main into the lane, full frontend gate, merge into main' },
    { title: 'Proof', detail: 'only the four cases the amendments add, on web, plus an Android sanity pass' },
    { title: 'Judge', detail: 'Fable decides whether DOS-167 is closed' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const WT = MAIN + '/.claude/worktrees/b2-dos167amd'
const BRANCH = 'qa/b2-dos167amd'
const DB = 'dos_test_b2_dos167amd'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const EV = MAIN + '/QA/evidence/batch2/dos-167/amendments'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

const AMENDMENTS = `FABLE'S FIVE AMENDMENTS TO RULING 3 (2026-09-19, binding; full text in ${VERD}/DOS-167-ruling-3-architect-review.md, verdict SOUND WITH AMENDMENTS):
A1. The \`persistent: boolean | null\` widening (ruling 3 amendment ee) must be threaded through EVERY hop, not only the endpoints the ruling named: LeaveSession.persistent, the three _layout device props, the LeaveSheet prop, leaveButtons/leaveSentence, and the owner, manager and retailer consumers. Prove it red first with a FAILING \`pnpm typecheck\` that names the un-threaded hops, then thread them.
A2. The never-a-hang memory fallback (ruling 3 amendment cc.2) must RELEASE the failed persistent file's holdFile hold. Prove it with a test where a persistent store is corrupted after opening, drops to memory, and a second engine opened on the same store name still opens instead of blocking on the stale hold.
A3. The promoted S-138 gate must assert AT MOST ONE VFS construction and ONE WASM init per load. The concurrency mode fired at delay 0 (the warm-instr case), and the pool-header check alone can pass over a latent second VFS.
A4. A SECOND TAB of the same person must be proven to fall to an honest memory store without corrupting or evicting the first tab's persistent file. Ruling 3 omits this case; it needs a test and a re-proof.
A5. The 15 s timeout path (ruling 3 amendment cc.1) must be tested to CLOSE a late-arriving persistent handle, never destroy it, and to keep the on-disk file. The deadline must be generous enough that a slow-but-succeeding OPFS open is not abandoned.`

const FOUNDER = `FOUNDER RULING (2026-09-14, answer A, binding): when a person signs out, their unsent changes stay on THAT phone for THAT person only and go first at that person's next sign-in. Nothing is thrown away, and nobody else on the device may ever see them. DOS-167 is the P0 that guarantees it. Web is the target that was still failing (S-138); ruling 3 and these amendments are its repair.`

const LIMITS = `STANDING RULES: never touch the founder's own databases (dos, dos_qa); never force-push, reset --hard, rebase or delete a branch; never weaken a test, a validation or a permission to make something pass; never report a command you did not run or an outcome you did not see.`

const RULES = `PRODUCT RULES: screens import only @dos/ui, never react-native or react-dom; anything platform-specific lives in @dos/ui/platform as a .web.ts/.native.ts pair behind one signature; universal apps (web + Android + iOS from one codebase); docs/27 is binding for the offline client; the offline engine never loses a queued op and never shows one person's rows to another.
QA CHARTER: implement exactly the amendments above, nothing adjacent; red-first tests whose names carry DOS-167; an existing test changes only where an amendment says so.`

const RESULT = { type: 'object', required: ['status', 'commits', 'amendments', 'filesChanged', 'deviations', 'followUps'], properties: {
  status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] }, commits: { type: 'array', items: { type: 'string' } },
  amendments: { type: 'array', items: { type: 'object', required: ['id', 'done', 'failBefore', 'passAfter', 'test'], properties: { id: { type: 'string' }, done: { type: 'boolean' }, failBefore: { type: 'string' }, passAfter: { type: 'string' }, test: { type: 'string' } } } },
  filesChanged: { type: 'array', items: { type: 'string' } }, deviations: { type: 'string' }, followUps: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['verdict', 'amendmentsChecked', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] },
  amendmentsChecked: { type: 'array', items: { type: 'object', required: ['id', 'satisfied', 'redProven', 'detail'], properties: { id: { type: 'string' }, satisfied: { type: 'boolean' }, redProven: { type: 'boolean' }, detail: { type: 'string' } } } },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'file', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, detail: { type: 'string' } } } },
  evidence: { type: 'string' } } }
const REVIEW = { type: 'object', required: ['decision', 'blockers', 'minors', 'conflicts', 'walks', 'unfiledDefects'], properties: {
  decision: { type: 'string', enum: ['MERGE', 'MERGE AFTER FIXES', 'DO NOT MERGE'] }, blockers: { type: 'array', items: { type: 'string' } }, minors: { type: 'array', items: { type: 'string' } },
  conflicts: { type: 'array', items: { type: 'string' } }, walks: { type: 'array', items: { type: 'string' } }, unfiledDefects: { type: 'array', items: { type: 'string' } } } }
const PREP = { type: 'object', required: ['status', 'base', 'notes'], properties: { status: { type: 'string', enum: ['ready', 'blocked'] }, base: { type: 'string' }, notes: { type: 'string' } } }
const INTEG = { type: 'object', required: ['status', 'headCommit', 'conflicts', 'fixes', 'testsRun', 'notes'], properties: {
  status: { type: 'string', enum: ['ready', 'blocked'] }, headCommit: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } },
  fixes: { type: 'array', items: { type: 'string' } }, testsRun: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
const IVERDICT = { type: 'object', required: ['verdict', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } } } }
const MERGED = { type: 'object', required: ['status', 'mainHead', 'pushed', 'notes'], properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, pushed: { type: 'boolean' }, notes: { type: 'string' } } }
const PROOF = { type: 'object', required: ['case', 'outcome', 'whatWasSeen', 'screenshots', 'problems'], properties: {
  case: { type: 'string' }, outcome: { type: 'string', enum: ['pass', 'fail', 'not-tested'] }, whatWasSeen: { type: 'string' },
  screenshots: { type: 'array', items: { type: 'string' } }, problems: { type: 'array', items: { type: 'string' } } } }
const JUDGE = { type: 'object', required: ['decision', 'why', 'openItems'], properties: {
  decision: { type: 'string', enum: ['closed', 'not-closed'] }, why: { type: 'string' }, openItems: { type: 'array', items: { type: 'string' } } } }

const ENV = `ENVIRONMENT — read carefully:
- Your worktree is "${WT}" on branch ${BRANCH}. Start EVERY Bash command with: cd "${WT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${DB}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree. You MAY READ ${MAIN}/QA/.
- 8 GB RAM shared with other agents: ONE test file per command unless a step names a wider gate.
- No git stash, reset --hard, rebase, push or branch deletion. Do NOT edit docs/22, docs/18, CLAUDE.md or anything under QA/ except where a step names the file.`

const preparePrompt = () => `Prepare an isolated lane for Distribution OS QA batch 2, DOS-167 amendments. Mechanical setup only — write no product code.

${LIMITS}

1. cd "${MAIN}" && git rev-parse --short main — record it as the base. Ruling 3 must already be merged into main: confirm with git -C "${MAIN}" log --oneline -15 that a DOS-167 ruling-3 merge is there. If it is not, return blocked.
2. git -C "${MAIN}" worktree add -b ${BRANCH} "${WT}" main (if "${WT}" already exists, cd in, confirm the branch and git merge --ff-only main).
3. dropdb -h 127.0.0.1 -p 5439 -U dos --force ${DB} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${DB}; point THIS worktree's backend/.env at ${DB} and nothing else.
4. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install
5. mkdir -p "${EV}". git status --short clean apart from that .env. Return the structured result.`

const implPrompt = () => `You are implementing five binding architect amendments to the DOS-167 web repair for Distribution OS, in an isolated worktree, as a careful senior engineer.

${ENV}

${RULES}

${LIMITS}

${FOUNDER}

${AMENDMENTS}

INPUTS (read all before editing):
  cat "${VERD}/DOS-167-ruling-3-architect-review.md"
  cat "${VERD}/DOS-167-ruling-3.md"
  cat "${VERD}/DOS-167-ruling-2-addendum.md"
  cat "${MAIN}/docs/27-offline-sync-client-design.md"
  git log --oneline -25   # ruling 3 is already merged into main; read its commits before changing anything
The code: frontend/libs/offline/src (engine.ts, shared.ts, log.ts, react.tsx, connection.ts), frontend/libs/ui/src/platform storage and the leave flow, and the app _layout.tsx files.

For EACH amendment A1..A5, in order:
STEP 1: write the red-first proof the amendment names (A1's is a FAILING pnpm typecheck; the others are tests whose names carry DOS-167), run it, and confirm it fails for the amendment's reason. Keep the excerpt.
STEP 2: make the smallest change that satisfies the amendment.
STEP 3: run that proof green, then the whole test files you touched, then typecheck and lint the packages you touched; prettier --write on touched files.
STEP 4: commit that amendment alone: "fix(DOS-167): amendment <A1..A5> — <one line>" + two sentences + "Test: <file> › <name>" + ${CO}.
If an amendment is already satisfied by the merged ruling-3 code, prove that by reversing the relevant non-test change and showing the proof goes red; then record it done with that evidence and no new production change.
Finish with git status clean and return the structured result.`

const verifyPrompt = (impl) => `You are the adversarial verifier of the DOS-167 amendment lane for Distribution OS. Assume each amendment is unsatisfied until proven otherwise. You make no commits.

${ENV}

${RULES}

${LIMITS}

${AMENDMENTS}

Implementer report:
${JSON.stringify(impl, null, 1)}

1. git log --oneline main..HEAD — one commit per amendment, nothing adjacent.
2. PROVE RED per commit C: git diff C^ C -- . ':(exclude)**/*.spec.ts' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/package.json' ':(exclude)docs/**' | git apply -R ; rebuild the affected library; run that amendment's proof and confirm it FAILS for the amendment's reason; restore with git checkout -- . , delete untracked leftovers, rebuild.
3. PROVE GREEN: each amendment's proof, then every whole test file touched, then pnpm typecheck and pnpm lint in frontend.
4. Hunt, specifically: a widening that stops short of one consumer (A1); a holdFile released on the happy path but not on the corruption path, or released twice (A2); an assertion that counts VFS constructions in a way a second latent VFS could still slip past (A3); a second-tab test that never actually opens two engines on one store name, or that leaves the first tab's file changed (A4); a timeout path that destroys rather than closes, or a deadline so tight a slow OPFS open is abandoned (A5); any test weakened rather than a fix made.
5. git status clean at the end.
verdict 'pass' only when all five amendments are red-proven, green and honest.`

const repairPrompt = (impl, v) => `You are repairing the DOS-167 amendment lane after an adversarial review.

${ENV}

${RULES}

${LIMITS}

${AMENDMENTS}

Implementer report: ${JSON.stringify(impl, null, 1)}
Verifier verdict: ${JSON.stringify(v, null, 1)}

Fix every blocker, major and unsatisfied amendment with NEW commits "fix(DOS-167): amendment <id> — address review — <short>" (${CO}); never rewrite history. Re-run each proof, the touched test files, typecheck and lint. git status clean. Return the updated structured result.`

const reviewPrompt = (built) => `You are Fable, the ARCHITECT of the Distribution OS QA programme. These five amendments are YOURS: you wrote them reviewing ruling 3 on 2026-09-19. Now judge whether they were actually implemented. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes; do not touch .claude/worktrees other than to READ.

${FOUNDER}

${AMENDMENTS}

THE LANE: branch ${BRANCH}
  git -C "${MAIN}" log --oneline main..${BRANCH} ; git -C "${MAIN}" diff main...${BRANCH}
Your own review: cat "${VERD}/DOS-167-ruling-3-architect-review.md"
Build reports: ${JSON.stringify(built, null, 1)}

For EACH amendment say satisfied or not, naming the file:line that satisfies it. An amendment reported done with no code and no reversal evidence is NOT satisfied. Then judge: does anything here let a person's unsent changes be lost, or let one person's rows reach another on the same browser? Those two are the whole point of DOS-167. Name any real defect outside the lane with file:line, and say which platform walks the amendments still require.

Write ${REV}/dos167-amendments.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; per-amendment verdict with file:line; Blockers with the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const integratePrompt = (repairOf) => `You are the INTEGRATOR of the DOS-167 amendment lane for Distribution OS. Merge main into the lane, resolve every review blocker, prove the merged tree green and commit. You do NOT merge into main.

${ENV}
- INTEGRATOR git: you may merge main INTO ${BRANCH}, use checkout --ours/--theirs while resolving, and merge --abort.

${RULES}

${LIMITS}

REVIEW (binding): cat "${REV}/dos167-amendments.md"
Every Blocker was raised against the branch AS REVIEWED: a commit that already existed when the review was written is NEVER its fix. Resolve each with a new commit — a proof that fails for the blocker's reason, then the fix — or return blocked with the reason.
STEPS:
1. git merge main -m "Merge main into ${BRANCH} before merging it back" (resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this lane).
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' ; cd ../frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above.
4. Gates on the merged tree, in frontend: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 — this includes the kit's CROSS-APP GUARDS (document-urls.test.ts, parity.test.ts and the rest), which a wave-1 integration skipped and turned main red; pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   A red test or guard is a blocker unless the identical command shows the identical failure on main — then return blocked and say so in notes.
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the integration verifier found problems; fix every blocker and major with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const iverifyPrompt = (r) => `You verify the integration of the DOS-167 amendment lane before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${ENV}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. For each merge commit: git show --cc; every hunk from both sides survived in the conflicted files.
3. REVIEW BLOCKERS: read them yourself (cat "${REV}/dos167-amendments.md"). For EACH, read the file:line it names ON HEAD and show the code that resolves it; prove one blocker fix red by reversing its non-test change, then restore.
4. Re-run the lane's own test files and, in frontend, pnpm exec turbo run test --continue --concurrency=1 and pnpm typecheck.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the tests pass.`

const mergePrompt = (r) => `Merge the verified DOS-167 amendment lane into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${BRANCH} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${BRANCH} reports no conflict (else blocked).
4. git -C "${MAIN}" merge --no-ff ${BRANCH} -m "Merge QA batch 2: DOS-167 ruling-3 amendments A1..A5 (Fable)

Fable reviewed ruling 3 on 2026-09-19 and returned SOUND WITH AMENDMENTS. Each amendment
was proven red first and green after, adversarially verified, and reviewed by Fable again
before this merge. Re-proof of the four cases they add follows.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const PROOFS = [
  { key: 'web-memory-fallback', prompt: (head) => `Prove Fable's amendment A2 on a REAL browser, on main at ${head}. Do not read the code for your verdict — operate the app and report what you SAW.
Start the sales app on web (cd "${MAIN}/frontend" && pnpm --filter @dos/sales-app web, port 5175) with the backend services already running; sign in as a sales rep from ${MAIN}/docs/18-build-log.md. Then, with the browser tools: open the app, let the persistent store open, and corrupt it after it opened (the ruling-3 review and ${VERD}/DOS-167-ruling-3.md name how the store is reached from the console). Reload.
PASS means: the app announces an honest memory store rather than hanging; AND a SECOND engine opened on the same store name still opens instead of blocking on a stale hold. Screenshot every state into "${EV}/" and name the files in the result. Report 'fail' with what you saw if either half does not hold.` },
  { key: 'web-second-tab', prompt: (head) => `Prove Fable's amendment A4 on a REAL browser, on main at ${head}. Operate the app; do not infer from code.
Sign the same person in on the sales app web build in TAB 1 and let the persistent store open; queue an unsent change. Open TAB 2 on the same browser, same person. PASS means: tab 2 falls to an honest memory store and says so, AND tab 1's persistent file is neither corrupted nor evicted — tab 1 still holds its unsent change, and after closing tab 2 and reloading tab 1 the change is still there and still goes first. Screenshots into "${EV}/"; name them. Report exactly what each tab showed.` },
  { key: 'web-timeout', prompt: (head) => `Prove Fable's amendment A5 on a REAL browser, on main at ${head}. Operate the app; do not infer from code.
Make the OPFS open slow enough to cross the 15 s deadline (the ruling names how the bundle and the worker are delayed), then let the handle arrive late. PASS means: the app falls back honestly at the deadline; the late handle is CLOSED, never destroyed; the on-disk file survives — reload and the persistent store opens again with its queued change intact. Also show a slow-but-succeeding open (a delay under the deadline) is NOT abandoned. Screenshots into "${EV}/"; name them. Report what you saw.` },
  { key: 'android-sanity', prompt: (head) => `On main at ${head}, re-prove that the amendments broke nothing on Android. Boot Pixel_7_API_36 with -memory 3072 (ANDROID_HOME and openjdk@21 per ${MAIN}/CLAUDE.md), run the sales app, and walk: sign in, queue an offline change, sign out, sign in again as the SAME person (the change is still there and goes first), then sign in as a DIFFERENT person (that person sees none of it). Screenshots into "${EV}/". Report pass or fail with what you saw; 'not-tested' if the emulator cannot boot, with the error.` },
]

const proofPrompt = (p, head) => `You are proving one DOS-167 case by OPERATING the app, for the Distribution OS QA programme. You make no commits and change no product code.

${FOUNDER}

${LIMITS}
- You may start dev servers and the emulator. You may READ the repo. Write only under "${EV}".
- Never report a step you did not perform or a screen you did not see. 'not-tested' is an honest answer; a guess is not.

${p.prompt(head)}`

const judgePrompt = (head, proofs, review) => `You are Fable, the ARCHITECT, deciding whether DOS-167 is CLOSED for Distribution OS. Read-only.

${FOUNDER}

DOS-167 has run through three rulings, three addenda and now your own five amendments. Android and iOS were proven under ruling 2. Web was the open failure (S-138) and is what ruling 3 and these amendments repaired.

Your amendments: cat "${VERD}/DOS-167-ruling-3-architect-review.md"
Your merge review: cat "${REV}/dos167-amendments.md" — ${JSON.stringify(review, null, 1)}
Main is at ${head}.
The re-proofs, as executed:
${JSON.stringify(proofs, null, 1)}
Also read the earlier evidence under ${MAIN}/QA/evidence/batch2/dos-167/ and the findings S-138, S-139, S-140 in ${MAIN}/QA/findings/12-batch2-new-findings.md.

Decide 'closed' ONLY if, on every target, a person's unsent changes survive sign-out on that device, go first at that person's next sign-in, and never reach anybody else — and the web store opens honestly or says honestly that it cannot. A case reported 'not-tested' is not a pass. List every open item.
Write ${MAIN}/QA/evidence/batch2/verdicts/DOS-167-judge.md (under 60 lines) and return the structured decision.`

const serious = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity !== 'minor') || (v.amendmentsChecked || []).some((a) => !a.satisfied)
const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity !== 'minor')

const out = {}

phase('Build')
const prep = await agent(preparePrompt(), { label: 'prep:dos167amd', phase: 'Build', schema: PREP, model: 'sonnet', effort: 'low' })
if (!prep || prep.status !== 'ready') return { final: 'prepare-blocked', prepare: prep }
out.base = prep.base

let b = await agent(implPrompt(), { label: 'impl:amendments', phase: 'Build', schema: RESULT, model: 'opus' })
if (!b) return { final: 'agent-failed' }
let v = await agent(verifyPrompt(b), { label: 'verify:amendments', phase: 'Build', schema: VERDICT, model: 'opus' })
if (serious(v)) {
  const r = await agent(repairPrompt(b, v), { label: 'repair:amendments', phase: 'Build', schema: RESULT, model: 'opus' })
  if (r) { b = r; v = await agent(verifyPrompt(b), { label: 'reverify:amendments', phase: 'Build', schema: VERDICT, model: 'opus' }) }
}
out.impl = b
out.verdict = v
if (serious(v)) return { ...out, final: 'not-verified' }

phase('Review')
const review = await agent(reviewPrompt({ commits: b.commits, amendments: b.amendments, deviations: b.deviations, verifier: { verdict: v.verdict, problems: v.problems } }), { label: 'review:amendments', phase: 'Review', schema: REVIEW, model: 'fable' })
out.review = review
if (!review || review.decision === 'DO NOT MERGE') return { ...out, final: 'review-blocked' }

phase('Integrate')
let integ = await agent(integratePrompt(null), { label: 'integrate:amendments', phase: 'Integrate', schema: INTEG, model: 'opus' })
if (!integ || integ.status !== 'ready') return { ...out, final: 'integration-blocked', integration: integ }
let iv = await agent(iverifyPrompt(integ), { label: 'integ-verify:amendments', phase: 'Integrate', schema: IVERDICT, model: 'opus' })
if (ivBad(iv)) {
  const again = await agent(integratePrompt(iv), { label: 'integrate-repair:amendments', phase: 'Integrate', schema: INTEG, model: 'opus' })
  if (again && again.status === 'ready') {
    integ = again
    iv = await agent(iverifyPrompt(integ), { label: 'integ-reverify:amendments', phase: 'Integrate', schema: IVERDICT, model: 'opus' })
  }
}
if (ivBad(iv)) return { ...out, final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
const merged = await agent(mergePrompt(integ), { label: 'merge:amendments', phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
out.merge = merged
if (!merged || merged.status !== 'merged') return { ...out, final: 'merge-blocked' }
log('DOS-167 amendments merged ' + merged.mainHead)

phase('Proof')
const proofs = []
for (const p of PROOFS) {
  const res = await agent(proofPrompt(p, merged.mainHead), { label: 'proof:' + p.key, phase: 'Proof', schema: PROOF, model: 'opus' })
  proofs.push(res || { case: p.key, outcome: 'not-tested', whatWasSeen: 'agent failed', screenshots: [], problems: ['agent failed'] })
  log(p.key + ': ' + (res ? res.outcome : 'agent failed'))
}
out.proofs = proofs

phase('Judge')
out.judge = await agent(judgePrompt(merged.mainHead, proofs, review), { label: 'judge:dos167', phase: 'Judge', schema: JUDGE, model: 'fable' })
return { ...out, final: 'done' }
