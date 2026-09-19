export const meta = {
  name: 'qa-batch2-finish-175-180',
  description: "Finish the two lanes the first run could not: run the acceptance walk Fable's money-delivery review demands (pnpm smoke on a fresh seeded database with the services actually running — the thing every integrator so far was forbidden to do), then merge it; and repair the two majors the honesty lane still carries (a hand-over line that claims the phone keeps it without going through keepClaim, and an inert DOS-180 guard caused by useRow never restoring loading when its id changes), re-verify, let Fable review, and merge onto it.",
  phases: [
    { title: 'Walk', detail: 'the smoke acceptance the review demands, services running, on a fresh seeded database' },
    { title: 'Money', detail: 'integrate and merge the money-delivery lane once the walk passes' },
    { title: 'Honesty', detail: 'repair the two majors, verify adversarially, Fable review, integrate and merge' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const EV = MAIN + '/QA/evidence/batch2/dos-175-180'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

const MWT = MAIN + '/.claude/worktrees/b2-money-delivery'
const MDB = 'dos_test_b2_d175'
const HWT = MAIN + '/.claude/worktrees/b2-honesty'
const HDB = 'dos_test_b2_d178'

const FOUNDER = `FOUNDER DECISIONS, 2026-09-19 (binding; docs/22 §8, never-list #12 and #13): the four faults DOS-175..DOS-178 are approved for repair; DOS-179 — when a browser or phone cannot keep an offline copy EVERY screen says so and the order button stops claiming it saved; DOS-180 — an order saved with no signal keeps saying so until the office actually confirms it. Never-list #12: the app never tells someone their work is saved on the device when it is not, and never says an order reached the office before it did. Never-list #13: money a person has entered is never offered for deletion.`

const LIMITS = `STANDING RULES: never touch the founder's own databases (dos, dos_qa) or any template; never force-push, reset --hard, rebase or delete a branch; never weaken a test, a validation or a permission to make something pass; never report a command you did not run or an outcome you did not see.`

const RULES = `PRODUCT RULES: backend modules talk only through index.ts exports or outbox events; wire shapes only in backend/libs/contracts; PERMISSIONS is the single matrix; every mutation idempotent with a client UUIDv7 id; ledgers append-only and journals balance at commit; money integer paise; tenant data only through withTenant; /sync/upload never answers 4xx — a refusal is a recorded rejection; screens import only @dos/ui.`

const WALK = { type: 'object', required: ['status', 'broken', 'calls', 'operations', 'gates', 'notes'], properties: {
  status: { type: 'string', enum: ['pass', 'fail'] }, broken: { type: 'number' }, calls: { type: 'number' },
  operations: { type: 'array', items: { type: 'object', required: ['operation', 'outcome', 'detail'], properties: { operation: { type: 'string' }, outcome: { type: 'string', enum: ['OK', 'EXPECTED', 'BROKEN', 'SKIPPED'] }, detail: { type: 'string' } } } },
  gates: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
const RESULT = { type: 'object', required: ['lane', 'status', 'itemsDone', 'commits', 'filesChanged', 'deviations', 'followUps'], properties: {
  lane: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
  itemsDone: { type: 'array', items: { type: 'object', required: ['id', 'failBefore', 'passAfter', 'test'], properties: { id: { type: 'string' }, failBefore: { type: 'string' }, passAfter: { type: 'string' }, test: { type: 'string' } } } },
  commits: { type: 'array', items: { type: 'string' } }, filesChanged: { type: 'array', items: { type: 'string' } },
  deviations: { type: 'string' }, followUps: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['verdict', 'itemsChecked', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] },
  itemsChecked: { type: 'array', items: { type: 'object', required: ['id', 'redProven', 'greenProven', 'detail'], properties: { id: { type: 'string' }, redProven: { type: 'boolean' }, greenProven: { type: 'boolean' }, detail: { type: 'string' } } } },
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

const walkPrompt = () => `You run the ACCEPTANCE WALK that Fable's money-delivery review (blocker 2) demands and that nobody has been able to run: every integrator before you was forbidden to start services, which is exactly why this blocker is still open. You may start services. You change no product code and make no commits.

${LIMITS}
- You MAY start the eight backend services and the worker, and you MUST stop every one of them when you are done. Do NOT start any Expo app, emulator or simulator.
- Ports :3000-:3007 may be free or may be held by someone else. Check first (lsof -ti :3000). If ANYTHING is already listening, do NOT use those ports and do NOT kill it: run \`backend/all-in-one\` instead (DOS_MODE=all WORKER_INLINE=1 ALL_IN_ONE_PORT=3100) and pass \`--base http://127.0.0.1:3100\` to smoke. Getting this wrong once already committed destructive calls against the founder's dos_qa.
- EVERY command that touches a database uses YOUR database and no other.

THE TREE: the lane worktree "${MWT}" on branch qa/b2-money-delivery, head 6cbe235. Start every Bash command with: cd "${MWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3

THE LANE: DOS-175 (a receipt may not name a trip that does not exist, or one not on the road), DOS-176 (proof of delivery 500), DOS-177 (the driver's GPS consent 500). Design: cat "${VERD}/DOS-175-180-design.md". Review: cat "${REV}/money-delivery.md".

STEPS:
1. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'.
2. Database: dropdb -h 127.0.0.1 -p 5439 -U dos --force ${MDB} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos ${MDB}; export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${MDB}; pnpm db:migrate && pnpm db:seed.
3. THE CODE GATES first, on this tree: pnpm --filter @dos/core exec vitest run src/modules/delivery src/modules/receivables src/docs (one command), then pnpm typecheck, pnpm lint and pnpm format:check for the touched packages. Record each in \`gates\`.
4. Start the services (or all-in-one, per the port rule) on that DATABASE_URL and wait for /health 200 on every one.
5. pnpm smoke (with --base if you used all-in-one). THE PASS CONDITION, exactly as the review states it: **0 BROKEN**, and \`receivables.receipts.deposit\` must read **OK — not EXPECTED**, and \`delivery.deliveries.addPod\` and \`delivery.consents.grant\` must answer 200 on the owner, the manager AND the delivery lanes. An operation whose only evidence is a 409 classified EXPECTED is NOT proven: say so.
6. Run smoke a SECOND time on the same database (the review asks for it): a replay must not turn anything BROKEN.
7. Stop every service you started. Drop ${MDB}. Confirm nothing you started is still listening.
Return the structured result with the REAL counts read from the output, and one row per named operation with the outcome you actually saw. If it fails, quote the failing call, its input and the answer.`

const mIntegrate = (walk) => `You are the INTEGRATOR of the money-delivery lane (DOS-175, DOS-176, DOS-177). The acceptance walk has now been run — its result is below — so review blocker 2 is closed by evidence rather than left open. Merge main into the lane, prove the merged tree green, commit. You do NOT merge into main.

ENVIRONMENT: worktree "${MWT}" on branch qa/b2-money-delivery. Start EVERY Bash command with: cd "${MWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${MDB}
- Never edit anything in "${MAIN}" or another worktree. Do NOT start dev servers, emulators or simulators — the walk above already did that part.
- You may merge main INTO the branch, use checkout --ours/--theirs, and merge --abort.

${RULES}

${LIMITS}

${FOUNDER}

THE WALK'S RESULT (evidence for blocker 2): ${JSON.stringify(walk, null, 1)}
THE REVIEW (binding): cat "${REV}/money-delivery.md". Blocker 1 was the id-only look-ups that let a back-office caller receive a FOREIGN row as a 200 replay (deliveries.service.ts addPodInTx and writePod fallback, vehicles.service.ts grantConsent). Read the file:line each names ON THE CURRENT HEAD and confirm the fix is there; if it is not, fix it with a new commit and a test that fails for the blocker's reason.
STEPS:
1. git merge main -m "Merge main into qa/b2-money-delivery before merging it back" (main has moved: the DOS-167 amendments landed at 609388b). Resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this lane.
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${MDB} from dos_test_batch2b_template and pnpm db:migrate.
3. Gates on the MERGED tree: every spec file the lane touched, one per command; pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service mounting a touched module; the WHOLE backend pnpm test --concurrency=1; typecheck and lint; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs). Re-run with --force anything turbo serves from cache and stand behind the forced run.
4. Write the walk's evidence to "${EV}/money-delivery-acceptance.md" (create the directory) — the commands, the counts, the four named operations and their outcomes — and commit it with the lane. That is what closes blocker 2 on the record.
5. git status clean. Return the result with headCommit = git rev-parse --short HEAD.`

const mVerify = (r) => `You verify the integration of the money-delivery lane (DOS-175, DOS-176, DOS-177) before it merges into main. Assume a blocker is still open. You make no commits and start no services.

ENVIRONMENT: worktree "${MWT}". Start every command with: cd "${MWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${MDB}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. git show --cc on the merge: every hunk from both sides survived.
3. BLOCKER 1: read deliveries.service.ts (addPodInTx and the writePod fallback) and vehicles.service.ts (grantConsent) ON HEAD. The id-only look-up must be scoped so a back-office caller cannot be handed a foreign row as a 200 replay. Prove it red: reverse the scoping and show a test fails; restore.
4. BLOCKER 2: "${EV}/money-delivery-acceptance.md" must exist and record deposit OK (not EXPECTED), addPod and consents.grant 200 on owner, manager and delivery, and 0 BROKEN across two runs. A missing or hand-waved file is a blocker.
5. Re-run the lane's own spec files and docs:readme:check.
verdict 'pass' only when both blockers are closed on HEAD and the gates are green.`

const hRepair = () => `You are repairing the last two majors in the honesty lane (DOS-178, DOS-179, DOS-180) for Distribution OS. Both were found by an adversarial verifier and both are real.

ENVIRONMENT: worktree "${HWT}" on branch qa/b2-honesty, head 7de959b. Start EVERY Bash command with: cd "${HWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null
- Never edit anything in "${MAIN}" or another worktree. Do NOT start dev servers, emulators or simulators.

${RULES}

${LIMITS}

${FOUNDER}

Design (binding): cat "${VERD}/DOS-175-180-design.md"

MAJOR 1 — this lane INTRODUCED a keep-claim that bypasses its own rule. Commit cfe2010 added \`tray.handOverBody\` ("{amount} · {shop} · book no {no} — stays on this phone as handed over") and \`tray.handOverBodyNoBook\` (frontend/delivery-app/src/strings.ts:409-410), and app/attention.tsx:330-342 prints one of them unconditionally as the hand-over Dialog's body. That is an "on this phone" claim that does not go through \`keepClaim\`, which the design §3 makes binding for all three apps, and it is never-list #12. \`status.persistent\` is already in scope on that screen — attention.tsx:145-147 prints \`tray.storeMemory\` — so on a memory store the screen contradicts itself in one render. Route it through \`keepClaim\` like every other keep verb.

MAJOR 2 — DOS-180's own guard is INERT, so the banner can still claim an order reached the office before it did. new.tsx:271 passes \`rowKnown: !placedRow.loading\`, and outcome.ts documents that field as what stops a not-yet-read row being taken for an acked one. But \`useRow\` (frontend/libs/offline/src/react.tsx:465-501) never sets \`loading\` back to true when its \`id\` CHANGES: the effect's \`id === null\` branch sets loading false on mount and nothing restores it when \`id\` goes from null to a real id, so for one render after the tap the row reads "acked" and the banner says "Reached the office as a draft" about an order that has only just been queued. Fix \`useRow\` so a changed id means "not known yet" until its read lands — and check every other consumer of \`useRow\` for what that change does to them.

For EACH major: write the red-first test FIRST (its name carries DOS-179 or DOS-180), run it, confirm it fails for the reason above, then fix, then green. Commit each alone: "fix(DOS-179|DOS-180): address review — <short>" + "Test: <file> › <name>" + ${CO}. Then run every whole test file you touched, plus pnpm typecheck and pnpm lint in frontend, and prettier --write on touched files. git status clean. Return the structured result.`

const hVerify = (impl) => `You are the adversarial verifier of the honesty lane (DOS-178, DOS-179, DOS-180) after its second repair. Two majors were open; assume they are still open until you prove otherwise. You make no commits.

ENVIRONMENT: worktree "${HWT}". Start every command with: cd "${HWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null

${RULES}

${LIMITS}

${FOUNDER}

Design: cat "${VERD}/DOS-175-180-design.md"
Repair report: ${JSON.stringify(impl, null, 1)}

1. PROVE RED per new commit: reverse its non-test change and show the test fails for the stated reason; restore.
2. MAJOR 1: grep the three field apps for every "on this phone" / "on this device" / "in this browser" claim and show each one reaches the screen through \`keepClaim\`. One that does not is still a major. Include Dialog bodies, toasts and confirm sheets, not only buttons.
3. MAJOR 2: read \`useRow\` on HEAD and show that a changed \`id\` reads as not-known until its row lands. Then check the OTHER consumers of \`useRow\` — a fix that makes every list flicker, or that leaves a stale row on screen under a new id, is a new defect.
4. PROVE GREEN: every whole test file the lane touched, then pnpm typecheck, pnpm lint and pnpm exec turbo run test --continue --concurrency=1 --force in frontend (--force: a cache hit cannot prove the cross-app guards, S-155).
5. Hunt: a test weakened rather than a fix made; a screen importing react-native or react-dom; a keep verb added anywhere that bypasses keepClaim.
verdict 'pass' only when both majors are closed and nothing new broke.`

const hReview = (built) => `You are Fable, the ARCHITECT. Review the honesty lane (DOS-178, DOS-179, DOS-180) before it merges into main. The design is your own and you already reviewed this lane once; two majors came back from the verifier and have now been repaired. Read-only: edit nothing except the ONE output file below.

${FOUNDER}

LANE: branch qa/b2-honesty — git -C "${MAIN}" log --oneline main..qa/b2-honesty ; git -C "${MAIN}" diff main...qa/b2-honesty
Your design: cat "${VERD}/DOS-175-180-design.md"
Your first review: cat "${REV}/honesty.md"
Build reports: ${JSON.stringify(built, null, 1)}

Judge: does every keep claim in all three field apps now go through \`keepClaim\`; is the DOS-180 banner bound to what happened to that order rather than to the radio, on every path including the one render after the tap; does never-list #12 hold on a memory store, where the app must not contradict itself; and did the \`useRow\` change break anything that reads rows. Name the platform walks still owed, and any real defect outside the lane with file:line.

Write ${REV}/honesty-2.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const hIntegrate = () => `You are the INTEGRATOR of the honesty lane (DOS-178, DOS-179, DOS-180). Merge main into the lane, resolve every blocker from BOTH reviews, prove the merged tree green, commit. You do NOT merge into main.

ENVIRONMENT: worktree "${HWT}" on branch qa/b2-honesty. Start EVERY Bash command with: cd "${HWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${HDB}
- Never edit "${MAIN}" or another worktree. No dev servers, emulators or simulators.
- You may merge main INTO the branch, use checkout --ours/--theirs, and merge --abort.

${RULES}

${LIMITS}

${FOUNDER}

REVIEWS (both binding): cat "${REV}/honesty.md" ; cat "${REV}/honesty-2.md". A commit that already existed when a review was written is never that review's fix.
STEPS:
1. git merge main -m "Merge main into qa/b2-honesty before merging it back". Main now carries the DOS-167 amendments (609388b, which touched frontend/libs/offline and the app guards) and the money-delivery lane. Resolve keeping both sides.
2. cd frontend && pnpm install (commit a changed lockfile); cd ../backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' if anything backend changed underneath.
3. Every blocker from both reviews, each with a test that fails for its reason.
4. Gates on the merged tree, in frontend: pnpm lint; pnpm typecheck; **pnpm exec turbo run test --continue --concurrency=1 --force** (the --force is not optional: a cache hit cannot prove the kit's cross-app guards, which read app files outside their own package — S-155); pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
5. git status clean. Return the result with headCommit = git rev-parse --short HEAD.`

const hIVerify = (r) => `You verify the integration of the honesty lane before it merges into main. Assume something was dropped in the merge with the DOS-167 amendments. You make no commits.

ENVIRONMENT: worktree "${HWT}". Start every command with: cd "${HWT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. git show --cc on the merge: every hunk from both sides survived — especially in frontend/libs/offline (the amendments' tri-state work and this lane's useRow change touch the same file).
3. Both reviews' blockers, read on HEAD, each with the code that resolves it; prove one red by reversal, then restore.
4. Re-run in frontend: pnpm exec turbo run test --continue --concurrency=1 --force and pnpm typecheck. A cache hit is not evidence.
verdict 'pass' only when nothing was dropped, every blocker is closed on HEAD and the gates are green.`

const mergePrompt = (branch, ids, head) => `Merge the verified lane ${branch} into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else blocked).
2. git -C "${MAIN}" rev-parse --short ${branch} equals ${head} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${branch} reports no conflict (else blocked).
4. git -C "${MAIN}" merge --no-ff ${branch} -m "Merge QA batch 2 lane ${branch}: ${ids}

Founder-approved 2026-09-19. Designed by Fable, built test-first with adversarial
verification, reviewed by Fable, gated on the merged tree. Platform proof follows.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.
IF THE MERGE COMMAND IS REFUSED BY A PERMISSION CLASSIFIER rather than by git: do not retry it more than twice. Return status 'blocked' with notes saying exactly that, and record the branch head — the main session completes such a merge by hand.`

const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity === 'blocker')
const out = {}

phase('Walk')
const walk = await agent(walkPrompt(), { label: 'walk:money-acceptance', phase: 'Walk', schema: WALK, model: 'opus' })
out.walk = walk
log('acceptance walk: ' + (walk ? walk.status + ' broken=' + walk.broken : 'agent failed'))

phase('Money')
if (walk && walk.status === 'pass') {
  let integ = await agent(mIntegrate(walk), { label: 'integrate:money-delivery', phase: 'Money', schema: INTEG, model: 'opus' })
  if (integ && integ.status === 'ready') {
    let iv = await agent(mVerify(integ), { label: 'integ-verify:money-delivery', phase: 'Money', schema: IVERDICT, model: 'opus' })
    if (!ivBad(iv)) {
      out.moneyMerge = await agent(mergePrompt('qa/b2-money-delivery', 'DOS-175, DOS-176, DOS-177', integ.headCommit), { label: 'merge:money-delivery', phase: 'Money', schema: MERGED, model: 'sonnet', effort: 'low' })
      log('money-delivery: ' + (out.moneyMerge && out.moneyMerge.status === 'merged' ? 'merged ' + out.moneyMerge.mainHead : 'merge blocked — the main session finishes it by hand'))
    } else { out.moneyFinal = 'integration-verify-failed'; out.moneyVerdict = iv }
  } else { out.moneyFinal = 'integration-blocked'; out.moneyIntegration = integ }
} else {
  out.moneyFinal = 'walk-failed'
  log('money-delivery does not merge: the acceptance walk did not pass, and blocker 2 is exactly that walk')
}

phase('Honesty')
let hb = await agent(hRepair(), { label: 'repair2:honesty', phase: 'Honesty', schema: RESULT, model: 'opus' })
if (!hb) return { ...out, final: 'honesty-repair-failed' }
let hv = await agent(hVerify(hb), { label: 'verify2:honesty', phase: 'Honesty', schema: VERDICT, model: 'opus' })
out.honestyRepair = hb
out.honestyVerdict = hv
if (!hv || hv.verdict !== 'pass' || hv.problems.some((p) => p.severity !== 'minor')) return { ...out, final: 'honesty-not-verified' }
const hrev = await agent(hReview({ commits: hb.commits, itemsDone: hb.itemsDone, deviations: hb.deviations, verifier: { verdict: hv.verdict, problems: hv.problems } }), { label: 'review2:honesty', phase: 'Honesty', schema: REVIEW, model: 'fable' })
out.honestyReview = hrev
if (!hrev || hrev.decision === 'DO NOT MERGE') return { ...out, final: 'honesty-review-blocked' }
let hi = await agent(hIntegrate(), { label: 'integrate:honesty', phase: 'Honesty', schema: INTEG, model: 'opus' })
if (!hi || hi.status !== 'ready') return { ...out, final: 'honesty-integration-blocked', honestyIntegration: hi }
const hiv = await agent(hIVerify(hi), { label: 'integ-verify:honesty', phase: 'Honesty', schema: IVERDICT, model: 'opus' })
if (ivBad(hiv)) return { ...out, final: 'honesty-integration-verify-failed', honestyIntegration: hi, honestyIntegrationVerdict: hiv }
out.honestyMerge = await agent(mergePrompt('qa/b2-honesty', 'DOS-178, DOS-179, DOS-180', hi.headCommit), { label: 'merge:honesty', phase: 'Honesty', schema: MERGED, model: 'sonnet', effort: 'low' })
log('honesty: ' + (out.honestyMerge && out.honestyMerge.status === 'merged' ? 'merged ' + out.honestyMerge.mainHead : 'merge blocked — the main session finishes it by hand'))
return { ...out, final: 'done' }
