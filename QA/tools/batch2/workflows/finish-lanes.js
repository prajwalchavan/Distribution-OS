export const meta = {
  name: 'qa-batch2-finish-lanes',
  description: 'Finish the founder-approved batch-2 lanes after the weekly limit interrupted them: verify the money settlement slice, build the money phone slice and the DOS-172 app slice, review what is unreviewed, then integrate and merge in the order money, DOS-171, DOS-172, with S-108 whenever it is ready',
  phases: [
    { title: 'Build', detail: 'Opus implementer and adversarial verifier per unfinished slice, one repair round', model: 'opus' },
    { title: 'Review', detail: 'Opus merge reviews standing in for Fable (limit reached) for the lanes that have none', model: 'opus' },
    { title: 'Integrate', detail: 'Opus integrator and verifier on the merged tree; merges serialized: money, then DOS-171, then DOS-172; S-108 first', model: 'opus' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const REV = MAIN + '/QA/evidence/batch2/merge-reviews'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
const LIMIT = 2

const FOUNDER = `FOUNDER APPROVAL (2026-09-14, "Approved", binding): DOS-168..DOS-173 are in QA batch 2 and the S-108 challan-poll fix is approved. Answers, all A: (1) DOS-169: a cash or cheque receipt that reaches the office after its trip settled is refused (409 trip_settled online, a trip_settled sync rejection offline, one sentence at every door) and the driver hands the money to the cashier; UPI and bank transfer are accepted. (2) DOS-172: no trip departs carrying a packed bill that no confirmed load sheet counted out; a bill returned undelivered waits on its van until check-in, then re-enters planning and the loading list. (3) Money already wrong in the founder's own database is repaired later by the main session; no lane touches dos or dos_qa. The designs (Fable, revised by the Opus stand-in) are binding. Fable's limit is reached, so Opus stands in for architect reviews, labelled as such.
WHERE THIS RUN PICKS UP: the first build run (2026-09-14) was cut off by the weekly usage limit. Already committed on the lane branches and adversarially verified: money receivables (9c44458, d19d39d), money settlement (1b4e022, verified once with minors, then a repair round whose re-verification never ran), DOS-171 backend and app (cafb0ef, 483685a, both verified, review written), S-108 (0f49863, verified, review says MERGE), DOS-172 backend (60b55f2, f61f265, verified). Nothing merged into main.`

const RESULT = { type: 'object', required: ['id', 'status', 'commits', 'failBefore', 'passAfter', 'testsAdded', 'testsCorrected', 'filesChanged', 'amendments', 'deviations', 'followUps'], properties: {
  id: { type: 'string' }, status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
  commits: { type: 'array', items: { type: 'string' } }, failBefore: { type: 'string' }, passAfter: { type: 'string' },
  testsAdded: { type: 'array', items: { type: 'object', required: ['file', 'name'], properties: { file: { type: 'string' }, name: { type: 'string' } } } },
  testsCorrected: { type: 'array', items: { type: 'object', required: ['file', 'name', 'before', 'after', 'why'], properties: { file: { type: 'string' }, name: { type: 'string' }, before: { type: 'string' }, after: { type: 'string' }, why: { type: 'string' } } } },
  filesChanged: { type: 'array', items: { type: 'string' } },
  amendments: { type: 'array', items: { type: 'object', required: ['amendment', 'done', 'how'], properties: { amendment: { type: 'string' }, done: { type: 'boolean' }, how: { type: 'string' } } } },
  deviations: { type: 'string' }, followUps: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['id', 'verdict', 'failBeforeConfirmed', 'passAfterConfirmed', 'amendmentsChecked', 'problems', 'evidence'], properties: {
  id: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'fail'] }, failBeforeConfirmed: { type: 'boolean' }, passAfterConfirmed: { type: 'boolean' },
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

const block = (id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'`

const LANES = [
  { key: 's108', ids: ['S-108'], after: [], worktree: MAIN + '/.claude/worktrees/b2-s108', branch: 'qa/b2-s108', db: 'dos_test_b2_s108',
    reviewFile: REV + '/s108-1.md', lenses: [], slices: [],
    inputs: `  grep -n '^| S-108 ' "${FIND}" ; cat "${REV}/s108-1.md"`,
    hunt: 'a stale poll answer after close; a new poll after reopening; the web user-gesture rule; the document-URL guard' },
  { key: 'money', ids: ['DOS-168', 'DOS-169', 'DOS-170'], after: [], worktree: MAIN + '/.claude/worktrees/b2-money', branch: 'qa/b2-money', db: 'dos_test_b2_money',
    reviewFile: null,
    inputs: `  cat "${VERD}/DOS-168-169-170-design.md"
  ${block('DOS-168')} ; ${block('DOS-169')} ; ${block('DOS-170')}`,
    verifyFirst: { key: 'settlement', title: 'day-end counts every trip payment however it reached the office',
      scope: `THE SLICE TO VERIFY = backend/libs/core/src/modules/delivery (settlement.service.ts, delivery.sync.ts, delivery.mappers.ts), the contracts JSDoc the design names, and delivery/settlement-money.spec.ts — commit 1b4e022 on this branch, on top of the verified receivables slice (9c44458, d19d39d). An earlier verifier passed it with minors and a repair round ran; its re-verification never happened, so verify the slice as it stands now.` },
    slices: [ { key: 'phone', title: 'the phone cannot check the vehicle in while it still holds unsent payments',
      scope: `THIS SLICE = frontend/delivery-app: app/day.tsx, the d8 block of src/strings.ts, and the NEW src/lib/check-in.ts with src/lib/check-in.test.ts, as the design says. The backend slices are committed on this branch. DOS-167 ruling 2 is merged on main (the delivery layout and leave flow changed): do not touch them. The DOS-171 lane also appends to delivery strings.ts (the d6 block); keep the d8 block separate.` } ],
    lenses: [
      'LEDGER AND CONCURRENCY: every money move happens exactly once (deposit, undo, settlement, allocation, both sync doors); journals balance; one lock order; trip_settled refused at every door with one sentence while UPI and bank transfer are accepted; settlement counts receipts net of reversals; docs/22 §6 as approved',
      'OFFLINE AND PLATFORM: the delivery phone queue and the check-in gate, D8 on web and phone widths and on Android and iOS, docs/27 guarantees, smoke and README invariants, and fixtures that survive DOS-172 merging last',
    ],
    hunt: 'a money move that can still happen twice; a lock taken in two orders; a journal that can fail to balance; a trip_settled refusal that differs between POST /receipts, the receipts op and the collections op; a UPI receipt refused; a reversed receipt counted at settlement; a settled trip whose figures change later; D8 adding phone-held money on a settled trip' },
  { key: 'dos171', ids: ['DOS-171'], after: ['money'], worktree: MAIN + '/.claude/worktrees/b2-dos171', branch: 'qa/b2-dos171', db: 'dos_test_b2_dos171',
    reviewFile: REV + '/dos171-1.md', lenses: [], slices: [],
    inputs: `  cat "${VERD}/DOS-171-design.md" ; cat "${REV}/dos171-1.md" ; ${block('DOS-171')}`,
    hunt: 'a headline that is not the bill total; a breakdown that does not add up; the planned_collection_paise increment outside the trip lock or applied twice; a cash-discount line that names money the bill never takes off' },
  { key: 'dos172', ids: ['DOS-172'], after: ['money', 'dos171'], worktree: MAIN + '/.claude/worktrees/b2-dos172', branch: 'qa/b2-dos172', db: 'dos_test_b2_dos172',
    reviewFile: null,
    inputs: `  cat "${VERD}/DOS-172-design.md" ; ${block('DOS-172')}`,
    slices: [ { key: 'apps', title: 'the godown and desk planning screens show held bills, and depart names the bills still to count',
      scope: `THIS SLICE = the design's app files (warehouse W7 and W10, manager M7, and the delivery depart message if the design lists it) and their tests. The backend slice is committed on this branch (60b55f2, f61f265). An interrupted earlier run left two UNCOMMITTED files in this worktree: frontend/manager-app/src/trips-held-bills.test.ts and frontend/warehouse-app/src/trips-held-bills.test.ts. Read them, keep what is correct, rewrite what is not, and finish with a clean git status.` } ],
    lenses: [
      'FULFILMENT RULES: only a draft sheet holds a bill, the road hold until check-in, the depart gate before consent, challans and e-way bills, the offline stop failure, and every spec or smoke fixture that departs',
      'SCREENS AND CONTRACTS: the additive planning output, W7, W10, M7 and D2 on web and phone widths and on Android, READMEs, docs/23, and conflicts with main after money and DOS-171 merged',
    ],
    hunt: 'a confirmed sheet that still claims a bill; a returned bill offered for loading before check-in; a trip that departs with an uncounted packed bill by any route; a fixture that still departs without a sheet; a contract change beyond the additive field' },
]

const env = (l) => `ENVIRONMENT — read carefully:
- Your worktree is "${l.worktree}" on branch ${l.branch}. Start EVERY Bash command with: cd "${l.worktree}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${l.db}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}" or in another worktree (the other lanes and a DOS-167 lane work there). You MAY READ ${MAIN}/QA/.
- Database: ${l.db} is a copy of dos_test_batch2b_template; you may drop and recreate ONLY it (dropdb -h 127.0.0.1 -p 5439 -U dos --force ${l.db} && createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${l.db} && (cd backend && pnpm db:migrate)). Never connect to dos, dos_qa or a template.
- 8 GB RAM shared with other agents: ONE spec or test file per command unless a step names a wider gate; typecheck and lint only the packages you touched.
- Libraries are consumed from dist: after editing @dos/contracts or @dos/core rebuild them (cd backend && pnpm exec turbo run build --filter=<pkg>...).
- No git stash, reset --hard, rebase, push or branch deletion; the only merge an implementer may run is a SETUP fast-forward.
- Do NOT start dev servers, emulators or simulators. Do NOT edit docs/22, docs/18, CLAUDE.md or anything under QA/. docs/23 and docs/27 change only where the design lists them.`

const RULES = `PRODUCT RULES: backend modules talk only through index.ts exports or outbox events; wire shapes only in backend/libs/contracts; PERMISSIONS is the single matrix; every mutation idempotent with a client UUIDv7 id; states change only through machine.next(); ledgers append-only and journals balance at commit; money integer paise, quantities integer pieces; tenant data only through withTenant; /sync/upload never answers 4xx; screens import only @dos/ui; universal apps.
QA CHARTER: implement exactly the signed-off design as amended, nothing adjacent; red-first tests named with the id; never weaken a test, validation or permission; an existing test changes only where the design says so; never report what you did not execute.`

const implPrompt = (l, s) => `You are implementing the remaining slice of a founder-approved fix for Distribution OS in an isolated worktree, as a careful senior engineer. Lane: ${l.key} (${l.ids.join(', ')}). Slice: "${s.key}" — ${s.title}.

${env(l)}

${RULES}

${FOUNDER}

INPUTS (read all):
${l.inputs}
Re-read every file before editing; main has moved since the design was written. Commits already on this branch: git log --oneline main..HEAD.

${s.scope}
SETUP FIRST: git merge --ff-only main (it must fast-forward; if it cannot, return blocked); cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate; cd frontend && pnpm install.

STEP 1: write this slice's red-first tests exactly as the design names them (each name carries its id), run them, and confirm each FAILS for the design's reason. Keep the excerpts.
STEP 2: implement the slice with every amendment it owns. If the code proves the design wrong, fix the real cause and say so in deviations.
STEP 3: run the new tests green, each whole test file you touched (one per command), then typecheck and lint for every package you touched; prettier --write on touched files.
STEP 4: commit only this slice's files: "fix(${l.ids.join('+')}): ${s.title}" + two or three sentences + "Test: <file> › <name>" lines + ${CO}.
STEP 5: git status clean. Return the structured result (id "${l.key}/${s.key}").`

const verifyPrompt = (l, s, impl) => `You are the adversarial verifier of one slice of a founder-approved fix for Distribution OS. Lane ${l.key} (${l.ids.join(', ')}), slice "${s.key}". Assume it is wrong until proven right. You make no commits.

${env(l)}

${RULES}

${FOUNDER}

${s.scope}

${impl ? 'Implementer report:\n' + JSON.stringify(impl, null, 1) : 'There is no fresh implementer report: verify the slice as committed on the branch.'}

Inputs:
${l.inputs}
1. git log --oneline main..HEAD and git show --stat for this slice's commits: only this slice's files; no QA/, no docs/22.
2. PROVE RED per commit C: git diff C^ C -- . ':(exclude)**/*.spec.ts' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)**/pnpm-lock.yaml' ':(exclude)**/package.json' ':(exclude)docs/**' ':(exclude)**/README.md' | git apply -R ; rebuild affected libraries; run the slice's tests and confirm each FAILS for the design's reason; restore with git checkout -- ., remove untracked leftovers, rebuild again.
3. PROVE GREEN: the slice's tests, each whole touched test file, typecheck and lint for the touched packages.
4. For every design section and lettered amendment this slice owns, find the code or test that satisfies it (amendmentsChecked). Missing, or different without a code-proven reason, is major.
5. Hunt: ${l.hunt}; weakened assertions; module-boundary violations; money not in paise; a mutation without idempotency; an RLS bypass; a screen importing react-native or react-dom.
6. git status clean at the end.
verdict 'pass' only if red before, green after, every owned amendment satisfied and no blocker or major problem remains.`

const repairPrompt = (l, s, impl, v) => `You are repairing one slice of a founder-approved fix for Distribution OS after an adversarial review. Lane ${l.key}, slice "${s.key}".

${env(l)}

${RULES}

${FOUNDER}

${s.scope}

Implementer report: ${JSON.stringify(impl, null, 1)}
Verifier verdict: ${JSON.stringify(v, null, 1)}
Inputs:
${l.inputs}
Fix every blocker, major and unsatisfied amendment with new commits "fix(${l.ids.join('+')}): address review — <short>" (${CO}); never rewrite history. Re-run the slice's tests, the touched test files, typecheck and lint. git status clean. Return the structured result for the whole slice.`

const reviewPrompt = (l, lens, n, built) => `You stand in for the architect (Fable) as Opus, because the Fable usage limit was reached; review as the architect would. Review ONE lane before it merges into main. Read-only: edit nothing except the ONE output file below; no builds, tests or git writes; do not touch .claude/worktrees.

${FOUNDER}

LANE ${l.key} (${l.ids.join(', ')}), branch ${l.branch}: git -C "${MAIN}" log --oneline main..${l.branch} ; git -C "${MAIN}" diff main...${l.branch}
Inputs:
${l.inputs}
Build reports: ${JSON.stringify(built, null, 1)}

YOUR LENS: ${lens}
Also: the fix matches the design and the founder's answers; the product rules; conflicts with main now and with the other lanes (b2-money, b2-dos171, b2-dos172, b2-s108, b2-dos167r3) and the waiting lean groups; the platform walks still needed; real defects outside the lane with file:line.
Write ${REV}/${l.key}-${n}.md (under 80 lines: **Decision:** MERGE | MERGE AFTER FIXES | DO NOT MERGE; Blockers with file:line and the exact fix; Minors; Conflicts; Walks; Defects outside) and return the structured summary.`

const integratePrompt = (l, reviewFiles, repairOf) => `You are the INTEGRATOR of lane ${l.key} (${l.ids.join(', ')}) for Distribution OS. Merge main into the lane, resolve conflicts keeping both sides, resolve every review blocker, prove the merged tree green and commit. You do NOT merge into main.

${env(l)}
- INTEGRATOR git: you may merge main INTO ${l.branch}, use checkout --ours/--theirs while resolving, and merge --abort. You MAY run the wider gates below, one turbo task at a time.

${RULES}

${FOUNDER}

REVIEWS (binding): ${reviewFiles.map((f) => 'cat "' + f + '"').join(' ; ')}
Read every Blocker in those files. Each was raised against the branch AS REVIEWED: a commit that already existed then is never its fix. Resolve each with a new commit (a test that fails for the blocker's reason, then the fix), or return blocked with the reason.
STEPS:
1. git merge main -m "Merge main into ${l.branch} before merging it back" (resolve keeping both sides; merge --abort and return blocked if a conflict is not explained by this lane).
2. cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*'; recreate ${l.db} from the template and pnpm db:migrate; cd frontend && pnpm install (commit a changed lockfile).
3. The review blockers, as above; apply a minor only when it is one line inside the lane's files.
4. Gates on the merged tree:
   - backend, if touched: every spec file the lane touched (one per command); pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts; the service specs of every service that mounts a touched module (one at a time); for dos172 the WHOLE backend pnpm test with --concurrency=1; typecheck and lint for touched backend packages; pnpm docs:readme then pnpm docs:readme:check (commit changed READMEs).
   - frontend, if touched: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 (this includes the kit's cross-app guards); pnpm format:check; pnpm exec turbo run build --concurrency=1, then remove untracked build output.
   A red test or guard is a blocker unless the identical command shows the identical failure on main (then return blocked and say so in notes).
5. git status clean. Return the structured result with headCommit = git rev-parse --short HEAD.${repairOf ? '\n\nREPAIR ROUND: the integration verifier found problems; fix every blocker and major with new commits and return the updated result:\n' + JSON.stringify(repairOf, null, 1) : ''}`

const iverifyPrompt = (l, r, reviewFiles) => `You verify the integration of lane ${l.key} (${l.ids.join(', ')}) before it merges into main. Assume something was dropped or a review blocker is still open. You make no commits.

${env(l)}

${FOUNDER}

Integrator report: ${JSON.stringify(r, null, 1)}
1. git log --oneline -20; HEAD equals ${r.headCommit}; tree clean.
2. For each merge commit: git show --cc; every hunk from both sides survived in conflicted files.
3. REVIEW BLOCKERS: read them yourself (${reviewFiles.map((f) => 'cat "' + f + '"').join(' ; ')}). For EACH, read the file:line it names on HEAD and show the code that resolves it; a commit that existed when the review was written never counts unless the review says so; prove one blocker fix red by reversing its non-test change, then restore.
4. Re-run the lane's own new test files; for a frontend lane also pnpm exec turbo run test --continue --concurrency=1 in frontend; for a backend lane the touched spec files and docs:readme:check.
verdict 'pass' only when nothing was dropped, every blocker is resolved on HEAD and the tests pass.`

const mergePrompt = (l, r) => `Merge the verified lane ${l.key} (${l.ids.join(', ')}) into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else return blocked).
2. git -C "${MAIN}" rev-parse --short ${l.branch} equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main ${l.branch} reports no conflict (else blocked). If any commit in git -C "${MAIN}" log ${l.branch}..main touches a file this branch changed, return blocked: it needs re-integration.
4. git -C "${MAIN}" merge --no-ff ${l.branch} -m "Merge QA batch 2 lane ${l.key}: ${l.ids.join(', ')}

Founder-approved 2026-09-14 (answers A). Built test-first on Opus in slices with adversarial verification; merge reviews by Opus standing in for Fable under QA/evidence/batch2/merge-reviews/; integration verified on the merged tree. Platform proof follows.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead = git -C "${MAIN}" rev-parse --short HEAD.`

const serious = (v) => !v || v.verdict !== 'pass' || v.problems.some((p) => p.severity !== 'minor') || (v.amendmentsChecked || []).some((a) => !a.satisfied)
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

async function runSlice(l, s, impl) {
  let b = impl
  if (!b) {
    b = await agent(implPrompt(l, s), { label: `impl:${l.key}:${s.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
    if (!b) return { key: s.key, final: 'agent-failed' }
  }
  let v = await agent(verifyPrompt(l, s, impl), { label: `verify:${l.key}:${s.key}`, phase: 'Build', schema: VERDICT, model: 'opus' })
  if (serious(v)) {
    const r = await agent(repairPrompt(l, s, b, v), { label: `repair:${l.key}:${s.key}`, phase: 'Build', schema: RESULT, model: 'opus' })
    if (r) {
      b = r
      v = await agent(verifyPrompt(l, s, b), { label: `reverify:${l.key}:${s.key}`, phase: 'Build', schema: VERDICT, model: 'opus' })
    }
  }
  const final = (!b.status || b.status === 'fixed') && !serious(v) ? 'verified' : 'needs-main-review'
  log(`${l.key}/${s.key}: ${final}`)
  return { key: s.key, final, impl: b, verdict: v }
}

async function runLane(l) {
  const out = { lane: l.key, ids: l.ids, slices: [] }
  try {
    await acquire()
    try {
      if (l.verifyFirst) {
        const r = await runSlice(l, l.verifyFirst, null)
        out.slices.push(r)
        if (r.final !== 'verified') { out.final = `slice-${l.verifyFirst.key}-not-verified`; return out }
      }
      for (const s of l.slices) {
        const r = await runSlice(l, s, null)
        out.slices.push(r)
        if (r.final !== 'verified') { out.final = `slice-${s.key}-not-verified`; return out }
      }
      if (l.lenses.length) {
        const built = out.slices.map((x) => ({ slice: x.key, commits: x.impl.commits, deviations: x.impl.deviations, followUps: x.impl.followUps, verifier: { verdict: x.verdict.verdict, problems: x.verdict.problems } }))
        const reviews = await parallel(l.lenses.map((lens, i) => () => agent(reviewPrompt(l, lens, i + 1, built), { label: `review:${l.key}:${i + 1}`, phase: 'Review', schema: REVIEW, model: 'opus' })))
        out.reviews = reviews
        if (reviews.some((r) => !r || r.decision === 'DO NOT MERGE')) { out.final = 'review-blocked'; return out }
        out.reviewFiles = l.lenses.map((_, i) => `${REV}/${l.key}-${i + 1}.md`)
      } else {
        out.reviewFiles = [l.reviewFile]
      }
    } finally {
      release()
    }
    if (l.after.length) log(`${l.key}: waiting for ${l.after.join(', ')} before integration`)
    await Promise.all(l.after.map((k) => settled[k]))
    const files = out.reviewFiles
    const m = await serialized(async () => {
      await acquire()
      try {
        log(`${l.key}: integrating`)
        let integ = await agent(integratePrompt(l, files, null), { label: `integrate:${l.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
        if (!integ || integ.status !== 'ready') return { final: 'integration-blocked', integration: integ }
        let iv = await agent(iverifyPrompt(l, integ, files), { label: `integ-verify:${l.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
        if (ivBad(iv)) {
          const again = await agent(integratePrompt(l, files, iv), { label: `integrate-repair:${l.key}`, phase: 'Integrate', schema: INTEG, model: 'opus' })
          if (again && again.status === 'ready') {
            integ = again
            iv = await agent(iverifyPrompt(l, integ, files), { label: `integ-reverify:${l.key}`, phase: 'Integrate', schema: IVERDICT, model: 'opus' })
          }
        }
        if (ivBad(iv)) return { final: 'integration-verify-failed', integration: integ, integrationVerdict: iv }
        const merged = await agent(mergePrompt(l, integ), { label: `merge:${l.key}`, phase: 'Integrate', schema: MERGED, model: 'sonnet', effort: 'low' })
        log(`${l.key}: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked'}`)
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
  } finally {
    settle[l.key]()
  }
}

const results = await parallel(LANES.map((l) => () => runLane(l)))
return { lanes: results }
