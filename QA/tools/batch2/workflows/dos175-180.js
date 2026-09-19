export const meta = {
  name: 'qa-batch2-dos175-180',
  description: "The six faults the founder approved on 2026-09-19: a receipt bookable against a trip that does not exist and then never bankable (DOS-175), proof of delivery 500 (DOS-176), the driver's GPS consent 500 (DOS-177), a refused late payment offered for deletion (DOS-178), and the two honesty faults — a memory store warned about on one screen only (DOS-179) and an offline order re-labelling itself 'Order placed' (DOS-180). Fable designs the four with product shape, Opus builds test-first with adversarial verification, Fable reviews, then backend merges and the frontend merges onto it.",
  phases: [
    { title: 'Design', detail: 'Fable, architect: the shape of DOS-175, DOS-178, DOS-179 and DOS-180' },
    { title: 'Build', detail: 'two lanes — backend money and delivery, frontend honesty — each implementer, adversarial verifier, one repair round' },
    { title: 'Review', detail: 'Fable merge review per lane' },
    { title: 'Integrate', detail: 'full gate on the merged tree; backend merges first, the frontend lane onto it' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
const LIMIT = 2

const FOUNDER = `FOUNDER DECISIONS, 2026-09-19 (binding; docs/22 §8 three rows, §9 never-list #12 and #13, §11):
- "fix all 4 defects": DOS-175, DOS-176, DOS-177, DOS-178 are approved for repair.
- "accept all recommended": DOS-179 — when a browser or phone cannot keep an offline copy, EVERY screen says so, not just the first one, and the order button stops reading "Saved on this phone" over work that dies with the tab. DOS-180 — an order saved with no signal keeps saying so until the office actually confirms it; it never re-labels itself "Order placed" because the signal came back.
- NEVER-LIST #12: the app never tells someone their work is saved on the device when it is not, and never says an order reached the office before it did.
- NEVER-LIST #13: money a person has entered is never offered for deletion; a payment the office refuses is kept and routed to the cashier.
- Standing, from 2026-09-14 answer A: nothing a person has entered is ever thrown away; a cash or cheque payment that reaches the office after its trip settled is refused and handed to the cashier, UPI is accepted.`

const LIMITS = `STANDING RULES: never touch the founder's own databases (dos, dos_qa) or any template; never force-push, reset --hard, rebase or delete a branch; never weaken a test, a validation or a permission to make something pass; never report a command you did not run or an outcome you did not see; do not start dev servers, emulators or simulators.`

const RULES = `PRODUCT RULES: backend modules talk only through index.ts exports or outbox events; wire shapes only in backend/libs/contracts; PERMISSIONS is the single matrix; every mutation idempotent with a client UUIDv7 id; states change only through machine.next(); ledgers append-only and journals balance at commit; money integer paise, quantities integer pieces; tenant data only through withTenant; /sync/upload never answers 4xx — a refusal is a recorded rejection; screens import only @dos/ui, never react-native or react-dom; universal apps.
QA CHARTER: implement exactly the signed-off design; red-first tests named with the finding id; an existing test changes only where the design says so.`

const DESIGN = { type: 'object', required: ['file', 'decisions', 'openQuestions'], properties: {
  file: { type: 'string' },
  decisions: { type: 'array', items: { type: 'object', required: ['id', 'rule', 'where', 'redTest'], properties: { id: { type: 'string' }, rule: { type: 'string' }, where: { type: 'string' }, redTest: { type: 'string' } } } },
  openQuestions: { type: 'array', items: { type: 'string' } } } }
const RESULT = { type: 'object', required: ['lane', 'status', 'itemsDone', 'itemsSkipped', 'commits', 'filesChanged', 'deviations', 'followUps'], properties: {
  lane: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
  itemsDone: { type: 'array', items: { type: 'object', required: ['id', 'failBefore', 'passAfter', 'test'], properties: { id: { type: 'string' }, failBefore: { type: 'string' }, passAfter: { type: 'string' }, test: { type: 'string' } } } },
  itemsSkipped: { type: 'array', items: { type: 'object', required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } } },
  commits: { type: 'array', items: { type: 'string' } }, filesChanged: { type: 'array', items: { type: 'string' } },
  deviations: { type: 'string' }, followUps: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['lane', 'verdict', 'itemsChecked', 'problems', 'evidence'], properties: {
  lane: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fail'] },
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
const IVERDICT = { type: 'object', required: ['verdict', 'problems', 'evidence'], properties: {
  verdict: { type: 'string', enum: ['pass', 'fail'] }, evidence: { type: 'string' },
  problems: { type: 'array', items: { type: 'object', required: ['severity', 'detail'], properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } } } }
const MERGED = { type: 'object', required: ['status', 'mainHead', 'pushed', 'notes'], properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, pushed: { type: 'boolean' }, notes: { type: 'string' } } }

const LANES = [
  { key: 'money-delivery', ids: ['DOS-175', 'DOS-176', 'DOS-177'], after: [], db: 'dos_test_b2_d175',
    scope: `THIS LANE = backend only. DOS-175: 'receivables.receipts.create' must refuse a 'tripId' that names no trip of this tenant — there is no foreign key (receipts→trips is an upstream reference), so service-side validation is the only guard; decide the refusal shape with the design, keep /sync/upload's rejection path (never a 4xx there), and leave the settled-trip deposit guard at receivables.service.ts:1006 exactly as it is. DOS-176: 'delivery.deliveries.addPod' throws 'proof insert returned nothing' from DeliveriesService.writePod → addPodInTx → runIdempotent; find why the insert returns no row and fix the cause. DOS-177: 'delivery.consents.grant' 500s with no message. Both 500s reproduce on a FRESH SEEDED database with the published example bodies, so seed them the same way and prove them red first.` },
  { key: 'honesty', ids: ['DOS-178', 'DOS-179', 'DOS-180'], after: ['money-delivery'], db: 'dos_test_b2_d178',
    scope: `THIS LANE = frontend only. DOS-178: the delivery app's unsent-changes tray must NOT offer Discard on a receipt op the server refused with 'trip_settled' — the op is kept and the screen tells the crew to hand the money to the cashier (never-list #13). Check every other refusal kind while you are there: say in deviations which kinds may still be discarded and why. DOS-179: when the store is a memory store, every screen of the sales app says so, not only the beat screen, and the order button stops reading 'Save on this phone' / 'Saved on this phone'; the honest wording is the design's. The same question is unwalked on delivery and warehouse — apply the same rule there if the design says so. DOS-180: frontend/sales-app/app/orders/new.tsx:387-388 picks the outcome banner's title and meta from 'local.online' at render time; bind it to what happened to THAT order instead, so a queued order never re-labels itself 'Order placed'.` },
]

const wt = (l) => MAIN + '/.claude/worktrees/b2-' + l.key
const branchOf = (l) => 'qa/b2-' + l.key
const block = (id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'`
const blocks = (l) => l.ids.map(block).join(' ; ')

const env = (l) => `ENVIRONMENT — read carefully:
- Your worktree is "${wt(l)}" on branch ${branchOf(l)}. Start EVERY Bash command with: cd "${wt(l)}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${l.db}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree. You MAY READ ${MAIN}/QA/.
- ${l.db} is yours alone; you may drop and recreate ONLY it. Never connect to dos, dos_qa or a template.
- 8 GB RAM shared with other agents: ONE spec or test file per command unless a step names a wider gate.
- Libraries come from dist: after editing @dos/contracts or @dos/core rebuild them (cd backend && pnpm exec turbo run build --filter=<pkg>...).`

const designPrompt = () => `You are Fable, the ARCHITECT of the Distribution OS QA programme (repo root: ${MAIN}). Design four fixes the founder approved today. READ-ONLY except the ONE output file below; run no builds, tests or git writes; do not write into .claude/worktrees.

${FOUNDER}

READ: QA/CHARTER.md; docs/22-source-of-truth.md §6, §7, §9 (never-list #12 and #13 are new today); docs/27-offline-sync-client-design.md (binding for the offline client); and the four finding blocks:
${block('DOS-175')} ; ${block('DOS-178')} ; ${block('DOS-179')} ; ${block('DOS-180')}
Then read the code each one names: backend/libs/core/src/modules/receivables (receipts.create and the settled-trip guard at receivables.service.ts:1006), frontend/libs/offline/src (status(), the memory fallback, the outbox tray), frontend/libs/ui/src (ConnectionStrip and the layout primitives a screen may use), frontend/delivery-app and frontend/sales-app (app/orders/new.tsx:387-388).

DECIDE, precisely enough to build from:
- DOS-175: what makes a tripId acceptable, and what the refusal looks like at each door — the online endpoint, /sync/upload (which never answers 4xx: it records a rejection) and the phone. Say whether an EXISTING bad row can appear in the pilot data and what the operator does about it; do not design a data migration unless it is needed.
- DOS-178: which refusal kinds may be discarded from the tray and which are kept, the wording the crew sees on a kept one, and where the money goes instead. Nothing a person entered is ever thrown away.
- DOS-179: where exactly a memory store is announced so every screen carries it — one shared place, not a line added to each screen — and what the order button says instead of "Save on this phone" when nothing will be kept. Consider delivery and warehouse too, and say whether the same rule applies there.
- DOS-180: what the outcome banner is bound to instead of the live connection, and what each state says.
For EACH, name the RED-FIRST test: the file, the test name carrying the finding id, and what must fail before the fix.
Flag anything that changes a contract, a permission or the database — those need a further founder decision, not your default.

Write ${VERD}/DOS-175-180-design.md (under 120 lines) and return the structured summary.`

const implPrompt = (l, design) => `You are implementing founder-approved fixes for Distribution OS in an isolated worktree, as a careful senior engineer. Lane: ${l.key}. Items: ${l.ids.join(', ')}.

${env(l)}

${RULES}

${LIMITS}

${FOUNDER}

THE DESIGN IS BINDING: cat "${VERD}/DOS-175-180-design.md"
Architect summary: ${JSON.stringify(design, null, 1)}

${l.scope}

Findings:
${blocks(l)}

SETUP FIRST: the worktree and database are already prepared. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install.
For EACH item, in the order listed:
STEP 1: write the red-first test the design names (its name carries the finding id), run it, and confirm it FAILS for the finding's reason. For the two 500s (DOS-176, DOS-177) that means reproducing the real fault on a SEEDED database with the published example body — not a unit test around a mock.
STEP 2: make the smallest fix that turns it green, at the cause.
STEP 3: run that test file whole, then typecheck and lint the packages you touched; prettier --write on touched files.
STEP 4: commit that item alone: "fix(<ID>): <one line>" + two sentences + "Test: <file> › <name>" + ${CO}.
If the design is wrong once you read the code, fix the real cause and say so in deviations.
Finish with git status clean and return the structured result.`

const verifyPrompt = (l, impl) => `You are the adversarial verifier of lane ${l.key} (${l.ids.join(', ')}) for Distribution OS. Assume every item is wrong until proven right. You make no commits.

${env(l)}

${RULES}

${LIMITS}

${FOUNDER}

Design: cat "${VERD}/DOS-175-180-design.md"
Implementer report: ${JSON.stringify(impl, null, 1)}
Findings:
${blocks(l)}

1. git log --oneline main..HEAD — one commit per item, nothing adjacent.
2. PROVE RED per item commit C: git diff C^ C -- . ':(exclude)**/*.spec.ts' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/package.json' ':(exclude)docs/**' ':(exclude)**/README.md' | git apply -R ; rebuild affected libraries; run that item's test and confirm it FAILS for the finding's reason; restore with git checkout -- . , delete untracked leftovers, rebuild.
3. PROVE GREEN: each item's test, then every whole test file the lane touched.
4. Hunt, per item: DOS-175 — a validation that also refuses a LEGITIMATE trip receipt, or that answers 4xx on the /sync/upload path (it must record a rejection instead), or that quietly changes the settled-trip guard; DOS-176 and DOS-177 — a 500 turned into a different error rather than fixed at the cause, or a test that passes without a seeded database; DOS-178 — a Discard still reachable for a refused trip_settled op by any route, or a kept op that no longer reaches the crew's eye; DOS-179 — a screen that still says nothing, or a button that still claims it saved; DOS-180 — a banner still reading the live connection anywhere. Also: any test weakened rather than a fix made; a screen importing react-native or react-dom; money not in paise.
5. git status clean at the end.
verdict 'pass' only when every item was red before and green after, and no blocker or major remains.`

const repairPrompt = (l, impl, v) => `You are repairing lane ${l.key} for Distribution OS after an adversarial review.

${env(l)}

${RULES}

${LIMITS}

Design: cat "${VERD}/DOS-175-180-design.md"
Implementer report: ${JSON.stringify(impl, null, 1)}
Verifier verdict: ${JSON.stringify(v, null, 1)}

Fix every blocker and major with NEW commits "fix(<ID>): address review — <short>" (${CO}); never rewrite history. Re-run each test, the whole touched test files, typecheck and lint. git status clean. Return the updated structured result.`

const reviewPrompt = (l, built) => `You are Fable, the ARCHITECT. Review one lane before it merges into main. The design is your own. Read-only: edit nothing except the ONE output file below; run no builds, tests or git writes.

${FOUNDER}

LANE ${l.key} (${l.ids.join(', ')}), branch ${branchOf(l)}:
  git -C "${MAIN}" log --oneline main..${branchOf(l)} ; git -C "${MAIN}" diff main...${branchOf(l)}
Your design: cat "${VERD}/DOS-175-180-design.md"
Findings:
${blocks(l)}
Build reports: ${JSON.stringify(built, null, 1)}

Judge per item: does the fix match the design; would the test fail without it; is it at the CAUSE rather than the symptom; does never-list #12 or #13 still hold everywhere, including the routes nobody walked. Name conflicts with main and with the other lane, the platform walks still owed, and any real defect outside the lane with file:line.

Write ${REV}/${l.key}.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const preparePrompt = (l) => `Prepare an isolated lane for Distribution OS QA batch 2, lane ${l.key}. Mechanical setup only — write no product code.

${LIMITS}

1. cd "${MAIN}" && git rev-parse --short main — record it as the base.
2. If "${wt(l)}" does not exist: git -C "${MAIN}" worktree add -b ${branchOf(l)} "${wt(l)}" main. If it exists, cd in, confirm the branch and git merge --ff-only main (blocked if it cannot fast-forward).
3. dropdb -h 127.0.0.1 -p 5439 -U dos --force ${l.db} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${l.db}; point THIS worktree's backend/.env at ${l.db} and nothing else.
4. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate && pnpm db:seed ; cd ../frontend && pnpm install
   (this lane needs SEEDED demo rows: two of its faults only appear against the seed's own example bodies).
5. git status --short clean apart from that .env. Return the structured result.`

const integratePrompt = (l, repairOf) => `You are the INTEGRATOR of lane ${l.key} (${l.ids.join(', ')}) for Distribution OS. Merge main into the lane, resolve every review blocker, prove the merged tree green and commit. You do NOT merge into main.

${env(l)}
- INTEGRATOR git: you may merge main INTO ${branchOf(l)}, use checkout --ours/--theirs while resolving, and merge --abort.

${RULES}

${LIMITS}

REVIEW (binding): cat "${REV}/${l.key}.md"
Every Blocker was raised against the branch AS REVIEWED: a commit that already existed then is NEVER its fix. Resolve each with a new commit — a test that fails for the blocker's reason, then the fix — or return blocked.
STEPS:
1. git merge main -m "Merge main into ${branchOf(l)} before merging it back" (resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this lane). Main is moving: the DOS-167 amendment lane merges around the same time and touches frontend/libs/offline and the app _layout files.
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${l.db} from the template, pnpm db:migrate and pnpm db:seed; cd ../frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above.
4. FULL GATE on the merged tree:
   - backend, if touched: every spec file the lane touched, one per command; pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service spec of every service mounting a touched module; typecheck and lint for touched packages; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs).
   - frontend, if touched: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 (the kit CROSS-APP GUARDS are in here); pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   Turbo's cache is content-addressed: re-run any gate that came back cached with --force for the touched packages, and stand behind the forced run.
   A red test is a blocker unless the identical command shows the identical failure on main.
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the verifier found problems; fix every blocker and major with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const iverifyPrompt = (l, r) => `You verify the integration of lane ${l.key} before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${env(l)}

${LIMITS}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. git show --cc on each merge commit: every hunk from both sides survived.
3. REVIEW BLOCKERS: read them yourself (cat "${REV}/${l.key}.md"). For EACH, read the file:line it names ON HEAD and show the resolving code; prove one blocker fix red by reversing its non-test change, then restore.
4. Re-run the lane's own test files and the wider gate its side needs (frontend: turbo run test --continue --concurrency=1 and typecheck; backend: the touched spec files and docs:readme:check).
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the tests pass.`

const mergePrompt = (l, r) => `Merge the verified lane ${l.key} into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${branchOf(l)} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${branchOf(l)} reports no conflict (else blocked). If any commit in git -C "${MAIN}" log ${branchOf(l)}..main touches a file this branch changed, return blocked: it needs re-integration.
4. git -C "${MAIN}" merge --no-ff ${branchOf(l)} -m "Merge QA batch 2 lane ${l.key}: ${l.ids.join(', ')}

Founder-approved 2026-09-19 ("fix all 4 defects", "accept all recommended"). Designed by
Fable, built test-first with adversarial verification, reviewed by Fable, gated on the
merged tree. Platform proof follows.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const serious = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity !== 'minor')
const ivBad = (x) => !x || x.verdict !== 'pass' || x.problems.some((p) => p.severity !== 'minor')

let slots = LIMIT
const waiters = []
const acquire = () => (slots > 0 ? ((slots -= 1), Promise.resolve()) : new Promise((res) => waiters.push(res)))
const release = () => { const w = waiters.shift(); if (w) w(); else slots += 1 }
let mergeChain = Promise.resolve()
const serialized = (fn) => { const p = mergeChain.then(fn, fn); mergeChain = p.catch(() => {}); return p }
const settled = {}
const settle = {}
for (const l of LANES) settled[l.key] = new Promise((res) => { settle[l.key] = res })

phase('Design')
const design = await agent(designPrompt(), { label: 'design:DOS-175-180', phase: 'Design', schema: DESIGN, model: 'fable' })
if (!design) return { final: 'design-failed' }
log('design written: ' + design.file + (design.openQuestions.length ? ' — ' + design.openQuestions.length + ' open question(s) for the founder' : ''))

async function runLane(l) {
  const out = { lane: l.key, ids: l.ids }
  try {
    if (l.after.length) { log(`${l.key}: waiting for ${l.after.join(', ')}`); await Promise.all(l.after.map((k) => settled[k])) }
    await acquire()
    try {
      const prep = await agent(preparePrompt(l), { label: `prep:${l.key}`, phase: 'Build', schema: PREP, model: 'sonnet', effort: 'low' })
      if (!prep || prep.status !== 'ready') { out.final = 'prepare-blocked'; out.prepare = prep; return out }
      let b = await agent(implPrompt(l, design), { label: `impl:${l.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
      if (!b) { out.final = 'agent-failed'; return out }
      let v = await agent(verifyPrompt(l, b), { label: `verify:${l.key}`, phase: 'Build', schema: VERDICT, model: 'opus' })
      if (serious(v)) {
        const r = await agent(repairPrompt(l, b, v), { label: `repair:${l.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
        if (r) { b = r; v = await agent(verifyPrompt(l, b), { label: `reverify:${l.key}`, phase: 'Build', schema: VERDICT, model: 'opus' }) }
      }
      out.impl = b
      out.verdict = v
      if (serious(v)) { out.final = 'not-verified'; return out }
      const review = await agent(reviewPrompt(l, { commits: b.commits, itemsDone: b.itemsDone, deviations: b.deviations, verifier: { verdict: v.verdict, problems: v.problems } }), { label: `review:${l.key}`, phase: 'Review', schema: REVIEW, model: 'fable' })
      out.review = review
      if (!review || review.decision === 'DO NOT MERGE') { out.final = 'review-blocked'; return out }
    } finally { release() }

    const m = await serialized(async () => {
      await acquire()
      try {
        log(`${l.key}: integrating`)
        let integ = await agent(integratePrompt(l, null), { label: `integrate:${l.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
        if (!integ || integ.status !== 'ready') return { final: 'integration-blocked', integration: integ }
        let iv = await agent(iverifyPrompt(l, integ), { label: `integ-verify:${l.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
        if (ivBad(iv)) {
          const again = await agent(integratePrompt(l, iv), { label: `integrate-repair:${l.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
          if (again && again.status === 'ready') { integ = again; iv = await agent(iverifyPrompt(l, integ), { label: `integ-reverify:${l.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' }) }
        }
        if (ivBad(iv)) return { final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
        const merged = await agent(mergePrompt(l, integ), { label: `merge:${l.key}`, phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
        log(`${l.key}: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked'}`)
        return { final: merged && merged.status === 'merged' ? 'merged' : 'merge-blocked', integration: integ, integrationVerdict: iv, merge: merged }
      } finally { release() }
    })
    Object.assign(out, m)
    return out
  } catch (e) {
    out.final = 'error'; out.error = String(e); return out
  } finally { settle[l.key]() }
}

const results = await parallel(LANES.map((l) => () => runLane(l)))
return { design, lanes: results, merged: results.filter((r) => r && r.final === 'merged').map((r) => r.lane) }
