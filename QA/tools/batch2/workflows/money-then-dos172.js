export const meta = {
  name: 'qa-batch2-money-then-dos172',
  description: "Execute Fable's merge-gate ruling of 2026-09-19: re-gate the money lane on current main and merge it (item 0), run pnpm smoke on a database copy (item 1), then rebase DOS-172 onto money, re-gate it and merge it. No dev servers, emulators or simulators — the browser and device walks (items 2-7) run in their own pass afterwards.",
  phases: [
    { title: 'Money', detail: 'merge main into the lane, full gate on the merged tree, merge into main and push' },
    { title: 'Smoke', detail: 'pnpm smoke --run-tag money-1 then --destructive on a fresh database copy; 0 BROKEN' },
    { title: 'DOS-172', detail: 'rebase onto merged main, resolve the trips.service.ts and contract JSDoc hunks, full gate, merge and push' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const EV = MAIN + '/QA/evidence/batch2/dos-168-170'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

const RULING = `FABLE'S MERGE-GATE RULING (architect, 2026-09-19, binding; full text ${VERD}/DOS-168-170-merge-gate-ruling.md): MERGE NOW.
- Item 0: merge main into qa/b2-money and re-run the FULL backend and frontend automated gate plus the kit cross-app guards on that tree — the lane last merged main at 6f2614b, before DOS-171 (d65034b) and the DOS-167 ruling-3 repair (ce3dc8c) landed. Then git merge --no-ff into main and push, with "Platform proof follows" in the message. DOS-168/169/170 are then MERGED, PROOF OWED, and stay OPEN until the walks pass.
- Item 1: pnpm smoke --run-tag money-1, then --destructive, on merged main's dist against a FRESH database copy. It passes only at 0 BROKEN with the collections, settle, receipts and deposit operations OK. Items 0 and 1 run BEFORE DOS-172 rebases.
- Ordering: nothing in money waits for DOS-172, and DOS-172 must NOT merge before money. DOS-172 rebases ONCE onto money, resolving the three trips.service.ts lines and the contract JSDoc hunks, and the duplicate load-out helper is folded at that rebase.
- If a walk later fails: it is a NEW FINDING on top, repaired forward; the merge is reverted only if the merged tree writes money wrong where main did not (an unbalanced journal, a double bank or double count, CASH_VAN not at 0, or a settle against founder answer A) and the forward fix is not on main within one working day. A screen fault never reverts.`

const FOUNDER = `FOUNDER APPROVAL (2026-09-14, "Approved", binding, answers all A): a cash or cheque receipt that reaches the office after its trip settled is REFUSED (409 trip_settled online, a trip_settled sync rejection offline, one sentence at every door) and the driver hands the money to the cashier; UPI and bank transfer are accepted. No trip departs carrying a packed bill that no confirmed load sheet counted out; a bill returned undelivered waits on its van until check-in. Nothing a person has entered is ever thrown away.`

const LIMITS = `STANDING RULES: never touch the founder's own databases (dos, dos_qa) or any template; never force-push, reset --hard, rebase onto a rewritten history, or delete a branch; never weaken a test, a validation or a permission to make something pass; never report a command you did not run or an outcome you did not see. Do NOT start dev servers, emulators or simulators in this run except where the smoke step says so.`

const RULES = `PRODUCT RULES: backend modules talk only through index.ts exports or outbox events; wire shapes only in backend/libs/contracts; PERMISSIONS is the single matrix; every mutation idempotent with a client UUIDv7 id; states change only through machine.next(); ledgers append-only and journals balance at commit; money integer paise; tenant data only through withTenant; /sync/upload never answers 4xx; screens import only @dos/ui.`

const INTEG = { type: 'object', required: ['status', 'headCommit', 'conflicts', 'fixes', 'testsRun', 'notes'], properties: {
  status: { type: 'string', enum: ['ready', 'blocked'] }, headCommit: { type: 'string' }, conflicts: { type: 'array', items: { type: 'string' } },
  fixes: { type: 'array', items: { type: 'string' } }, testsRun: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }
const IVERDICT = { type: 'object', required: ['verdict', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } } } }
const MERGED = { type: 'object', required: ['status', 'mainHead', 'pushed', 'notes'], properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, pushed: { type: 'boolean' }, notes: { type: 'string' } } }
const SMOKE = { type: 'object', required: ['status', 'broken', 'calls', 'operationsChecked', 'notes'], properties: {
  status: { type: 'string', enum: ['pass', 'fail'] }, broken: { type: 'number' }, calls: { type: 'number' },
  operationsChecked: { type: 'array', items: { type: 'object', required: ['operation', 'outcome'], properties: { operation: { type: 'string' }, outcome: { type: 'string' } } } }, notes: { type: 'string' } } }

const env = (wt, db) => `ENVIRONMENT — read carefully:
- Your worktree is "${wt}". Start EVERY Bash command with: cd "${wt}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${db}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree. You MAY READ ${MAIN}/QA/.
- ${db} is a copy of dos_test_batch2b_template; you may drop and recreate ONLY it. Never connect to dos, dos_qa or a template.
- 8 GB RAM shared with other agents: ONE spec file per command unless a step names a wider gate.
- Libraries come from dist: after editing @dos/contracts or @dos/core rebuild them.`

const MONEY_WT = MAIN + '/.claude/worktrees/b2-money'
const MONEY_DB = 'dos_test_b2_money'
const D172_WT = MAIN + '/.claude/worktrees/b2-dos172'
const D172_DB = 'dos_test_b2_dos172'

const moneyIntegrate = (repairOf) => `You are the INTEGRATOR of the money lane (DOS-168, DOS-169, DOS-170) for Distribution OS, executing Fable's ruling item 0. Merge main into the lane, prove the merged tree green and commit. You do NOT merge into main.

${env(MONEY_WT, MONEY_DB)}
- INTEGRATOR git: you may merge main INTO qa/b2-money, use checkout --ours/--theirs while resolving, and merge --abort.

${RULES}

${LIMITS}

${FOUNDER}

${RULING}

REVIEWS (binding, already satisfied once — re-check each on HEAD after the merge): cat "${REV}/money-1.md" ; cat "${REV}/money-2.md"
A blocker was raised against the branch AS REVIEWED: a commit that already existed then is never its fix.

STEPS:
1. git merge main -m "Merge main into qa/b2-money before merging it back". Main now carries DOS-171 (d65034b) and the DOS-167 ruling-3 repair (ce3dc8c): expect conflicts in the delivery app strings and layout. Resolve keeping BOTH sides — DOS-171 owns the delivery d6 strings block, money owns d8, ruling 3 owns the leave flow and the _layout device props. merge --abort and return blocked if a conflict is not explained by these three.
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; drop and recreate ${MONEY_DB} from dos_test_batch2b_template and pnpm db:migrate; cd ../frontend && pnpm install (commit a changed lockfile).
3. Re-read both reviews' blockers and confirm each is still resolved on the merged HEAD, naming the file:line.
4. FULL GATE on the merged tree (the lane touches backend AND frontend):
   - backend: every spec file the lane touched, one per command; pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service mounting a touched module; then the WHOLE backend pnpm test with --concurrency=1; typecheck and lint for touched packages; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs).
   - frontend: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 — this includes the kit CROSS-APP GUARDS (document-urls.test.ts, parity.test.ts); pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   Turbo's cache is content-addressed: if a gate comes back cached, re-run it with --force for the packages this lane touches and stand behind the forced run.
   A red test or guard is a blocker unless the identical command shows the identical failure on main — then return blocked and say so in notes.
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the verifier found problems; fix every blocker and major with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const moneyVerify = (r) => `You verify the integration of the money lane (DOS-168, DOS-169, DOS-170) before it merges into main. Assume something was dropped in the merge with DOS-171 and the DOS-167 ruling-3 repair. You make no commits.

${env(MONEY_WT, MONEY_DB)}

${LIMITS}

${RULING}
NOTE — the walks (items 2-7) are DELIBERATELY not run in this pass: Fable ruled MERGE NOW with the proof owed afterwards. Their absence is NOT a problem to report. Report only what is wrong with the code, the merge or the automated gate.

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. git show --cc on each merge commit: every hunk from money, from DOS-171's d6 strings and from ruling 3's leave flow and _layout props survived. A lost hunk is a blocker.
3. Both reviews' blockers (cat "${REV}/money-1.md" ; cat "${REV}/money-2.md"): read the file:line each names ON HEAD and show the resolving code. Prove ONE blocker fix red by reversing its non-test change, then restore.
4. Re-run the lane's own new spec files, the delivery module spec, and in frontend pnpm exec turbo run test --continue --concurrency=1 and pnpm typecheck.
5. Specifically check, because this merge moved money code next to ruling 3's offline changes: a queued receipt op still carries its original opId; the trip_settled refusal is identical at POST /receipts, the receipts sync op and the collections op; a reversed receipt is not counted at settlement; no journal can fail to balance.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the automated gate is green.`

const moneyMerge = (r) => `Merge the verified money lane (DOS-168, DOS-169, DOS-170) into main for Distribution OS, per Fable's ruling item 0. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short qa/b2-money equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main qa/b2-money reports no conflict (else blocked).
4. git -C "${MAIN}" merge --no-ff qa/b2-money -m "Merge QA batch 2 lane money: DOS-168, DOS-169, DOS-170

Founder-approved 2026-09-14 (answers A): a trip payment that reaches the office after
its trip settled is refused and handed to the cashier, UPI and bank transfer accepted,
and a phone holding unsent payments cannot check its vehicle in. Built test-first with
adversarial verification; two merge reviews; re-gated on merged main. Fable ruled
MERGE NOW on 2026-09-19 (QA/evidence/batch2/verdicts/DOS-168-170-merge-gate-ruling.md).
Platform proof follows — DOS-168/169/170 stay OPEN until the walks pass.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const smokePrompt = (head) => `Run Fable's ruling item 1 for Distribution OS: pnpm smoke against a FRESH database copy on merged main at ${head}. You change no product code and make no commits.

${LIMITS}
- You MAY start the eight backend services and the worker for this step, and you MUST stop every one of them when you are done. Do NOT start any Expo app, emulator or simulator.
- Work in the MAIN checkout "${MAIN}" for reading and building, but NEVER connect any command to dos or dos_qa.

STEPS:
1. Confirm main is at ${head}: git -C "${MAIN}" rev-parse --short HEAD.
2. Create the database: dropdb -h 127.0.0.1 -p 5439 -U dos --force dos_smoke_money 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos dos_smoke_money. Export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/dos_smoke_money for every command from here.
3. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate && pnpm db:seed.
4. Start the eight services and the worker on that DATABASE_URL, each in the background, and wait for /health 200 on every one.
5. pnpm smoke --run-tag money-1 — capture the whole output. Then pnpm smoke --destructive --run-tag money-1.
6. PASS means 0 BROKEN on both runs AND the collections, settle, receipts and deposit operations each report OK. Anything else is a fail: quote the failing call, its input and the answer.
7. Stop every service and the worker. dropdb dos_smoke_money. Confirm nothing is still listening on :3000-:3007.
Return the structured result with the real BROKEN and call counts, and the outcome of each of the four named operations. Never report a count you did not read from the output.`

const d172Integrate = (repairOf) => `You are the INTEGRATOR of the DOS-172 lane for Distribution OS, executing Fable's ruling: DOS-172 rebases ONCE onto money and merges last. Merge main into the lane, prove the merged tree green and commit. You do NOT merge into main.

${env(D172_WT, D172_DB)}
- INTEGRATOR git: you may merge main INTO qa/b2-dos172, use checkout --ours/--theirs while resolving, and merge --abort. Do NOT git rebase — bring main in with a merge; "rebase onto money" in the ruling means "come onto merged main that now contains money".

${RULES}

${LIMITS}

${FOUNDER}

${RULING}

DOS-172: no trip departs carrying a packed bill that no confirmed load sheet counted out; a bill returned undelivered waits on its van until check-in, then re-enters planning and the loading list.
Design: cat "${VERD}/DOS-172-design.md"
This lane has NO merge review on disk yet. Read the design and the branch yourself, and treat the design as binding.

STEPS:
1. git merge main -m "Merge main into qa/b2-dos172 before merging it back". Fable names the expected conflicts: THREE lines in backend/libs/core/src/modules/delivery/trips.service.ts and the contract JSDoc hunks. Resolve keeping BOTH sides — money owns the settled-trip refusal, DOS-172 owns the departure gate. She also says a DUPLICATE load-out helper exists and must be FOLDED into one at this merge: find it, fold it, and say in notes exactly what you folded.
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; drop and recreate ${D172_DB} from dos_test_batch2b_template and pnpm db:migrate; cd ../frontend && pnpm install.
3. FULL GATE on the merged tree: every spec file the lane touched, one per command; pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service mounting a touched module; the WHOLE backend pnpm test with --concurrency=1 (this lane changes departure for every spec, so the whole suite is mandatory); typecheck and lint; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs); then in frontend pnpm lint, pnpm typecheck, pnpm exec turbo run test --continue --concurrency=1 (kit cross-app guards included), pnpm format:check, pnpm exec turbo run build --concurrency=1 and remove untracked build output.
   Every fixture that departs a trip must now depart through a created, approved and confirmed load sheet. A fixture you had to change is a normal part of this lane — list each one in fixes.
   A red test is a blocker unless the identical command shows the identical failure on main.
4. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the verifier found problems; fix every blocker and major with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const d172Verify = (r) => `You verify the integration of the DOS-172 lane before it merges into main. Assume the merge with money dropped something, or that a fixture was changed in a way that hides a real departure. You make no commits.

${env(D172_WT, D172_DB)}

${LIMITS}

${FOUNDER}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. git show --cc on the merge: every hunk from money's settled-trip refusal AND from DOS-172's departure gate survived in trips.service.ts and in the contracts. Name the folded duplicate helper and show there is exactly one left.
3. Prove the departure gate red: reverse its non-test change and show a spec that departs with an uncounted packed bill now passes where it should fail; restore.
4. Re-run: the lane's own spec files, the whole backend pnpm test --concurrency=1, and in frontend pnpm exec turbo run test --continue --concurrency=1 and pnpm typecheck.
5. Hunt: a fixture edited to depart WITHOUT a confirmed sheet (that would erase the finding); a returned bill offered for loading before check-in; any route that still departs an uncounted bill; a contract change beyond the additive field the design allows.
verdict 'pass' only when nothing was dropped, the gate is provably red without its fix, and every gate is green.`

const d172Merge = (r) => `Merge the verified DOS-172 lane into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short qa/b2-dos172 equals ${r.headCommit} (else blocked). Confirm the money merge is an ancestor of qa/b2-dos172 (git -C "${MAIN}" merge-base --is-ancestor) — DOS-172 must never land before money.
3. git -C "${MAIN}" merge-tree --write-tree main qa/b2-dos172 reports no conflict (else blocked).
4. git -C "${MAIN}" merge --no-ff qa/b2-dos172 -m "Merge QA batch 2 lane dos172: DOS-172

Founder-approved 2026-09-14 (answer A): no trip departs carrying a packed bill that no
confirmed load sheet counted out, and a bill returned undelivered waits on its van until
check-in before it re-enters planning. Built test-first with adversarial verification and
re-gated on merged main with the whole backend suite. Platform proof follows.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity !== 'minor')
const out = {}

phase('Money')
let integ = await agent(moneyIntegrate(null), { label: 'integrate:money', phase: 'Money', schema: INTEG, model: 'opus' })
if (!integ || integ.status !== 'ready') return { ...out, final: 'money-integration-blocked', moneyIntegration: integ }
let iv = await agent(moneyVerify(integ), { label: 'integ-verify:money', phase: 'Money', schema: IVERDICT, model: 'opus' })
if (ivBad(iv)) {
  const again = await agent(moneyIntegrate(iv), { label: 'integrate-repair:money', phase: 'Money', schema: INTEG, model: 'opus' })
  if (again && again.status === 'ready') {
    integ = again
    iv = await agent(moneyVerify(integ), { label: 'integ-reverify:money', phase: 'Money', schema: IVERDICT, model: 'opus' })
  }
}
out.moneyIntegration = integ
out.moneyVerdict = iv
if (ivBad(iv)) return { ...out, final: 'money-verify-failed' }
const moneyMerged = await agent(moneyMerge(integ), { label: 'merge:money', phase: 'Money', schema: MERGED, model: 'sonnet', effort: 'low' })
out.moneyMerge = moneyMerged
if (!moneyMerged || moneyMerged.status !== 'merged') return { ...out, final: 'money-merge-blocked' }
log('money merged ' + moneyMerged.mainHead)

phase('Smoke')
out.smoke = await agent(smokePrompt(moneyMerged.mainHead), { label: 'smoke:money', phase: 'Smoke', schema: SMOKE, model: 'opus' })
log('smoke: ' + (out.smoke ? out.smoke.status + ' broken=' + out.smoke.broken : 'agent failed'))

phase('DOS-172')
let i2 = await agent(d172Integrate(null), { label: 'integrate:dos172', phase: 'DOS-172', schema: INTEG, model: 'opus' })
if (!i2 || i2.status !== 'ready') return { ...out, final: 'dos172-integration-blocked', dos172Integration: i2 }
let v2 = await agent(d172Verify(i2), { label: 'integ-verify:dos172', phase: 'DOS-172', schema: IVERDICT, model: 'opus' })
if (ivBad(v2)) {
  const again = await agent(d172Integrate(v2), { label: 'integrate-repair:dos172', phase: 'DOS-172', schema: INTEG, model: 'opus' })
  if (again && again.status === 'ready') {
    i2 = again
    v2 = await agent(d172Verify(i2), { label: 'integ-reverify:dos172', phase: 'DOS-172', schema: IVERDICT, model: 'opus' })
  }
}
out.dos172Integration = i2
out.dos172Verdict = v2
if (ivBad(v2)) return { ...out, final: 'dos172-verify-failed' }
const d172Merged = await agent(d172Merge(i2), { label: 'merge:dos172', phase: 'DOS-172', schema: MERGED, model: 'sonnet', effort: 'low' })
out.dos172Merge = d172Merged
log('dos172: ' + (d172Merged && d172Merged.status === 'merged' ? 'merged ' + d172Merged.mainHead : 'merge blocked'))
return { ...out, final: d172Merged && d172Merged.status === 'merged' ? 'done' : 'dos172-merge-blocked' }
