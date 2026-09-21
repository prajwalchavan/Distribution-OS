export const meta = {
  name: 'qa-batch2-web-first',
  description: 'Re-shaped to the founder of 2026-09-21: the smoke gate worked failure by failure, every walk that a browser on this Mac can prove, one basic Android sanity pass, and no iOS until the complete device validation at the end',
  phases: [
    { title: 'Build', detail: "the architect's list-order ruling, which is a stale comment and a client-side re-sort to delete" },
    { title: 'Smoke', detail: 'run it, then work every BROKEN it reports on its own merits' },
    { title: 'Walks', detail: 'browser-measured walks on this Mac, then ONE basic Android sanity pass' },
  ],
}

/**
 * The founder re-ordered this work on 2026-09-21, and the three sentences are in docs/22 §8:
 *   "Smoke gate to be done for failed ones" — run it, then work each BROKEN on its own merits. There is
 *     no all-or-nothing bar any more and nothing waits for a perfect run.
 *   "IOS and andriod to be validated completely in the end / For now basics can be done" — one complete
 *     device pass at the end, basics until then. So: NO iOS in this run, and Android only as a short
 *     sanity walk. The per-lane "platform proof follows" debt of 2026-09-14 is folded into that end pass.
 *   "As working and user tests and all other are more imp that can be done on system it self" — what can
 *     be exercised in a browser against the running services on this Mac comes first.
 *
 * So this run proves, on this machine, everything that does not need a phone — including the money legs
 * of the merge-gate ruling, which are ledger claims read out of the journal and the trial balance, not
 * screen claims. What genuinely needs a device is named and left for the end pass rather than guessed at.
 */

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const FIND = MAIN + '/QA/findings/12-batch2-new-findings.md'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const WALKS = MAIN + '/QA/evidence/batch2/walks'
const CO = 'Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

const WT = MAIN + '/.claude/worktrees/b2-walks'
const WDB = 'dos_test_b2_walks'

const LIMITS = `HOUSE RULES OF THIS PROGRAMME — they override any habit:
- Never report a command you did not run or an outcome you did not see. "not-tested" and "not-proven" are honest answers and are always accepted; an invented one is the only unforgivable result. A walk that disproves its own finding is a GOOD result — say so plainly.
- MEASURE, never eyeball. Read the rendered geometry — element boxes, scroll offsets, what is inside the viewport, what a uiautomator dump says — and quote the numbers. "It looks right" is not evidence.
- Test data only. Destructive work only on a database whose name carries "test". dos and dos_qa are never touched.
- zsh here has no \${PIPESTATUS[0]}: capture an exit code with "cmd > log 2>&1; echo $?".
- vitest 4: run one file as "pnpm --filter <pkg> exec vitest run <file>".
- If a git operation is refused by the tool permission layer, try twice, then return blocked with the exact command.`

const RULES = `PRODUCT RULES that outrank any instruction below:
- docs/22-source-of-truth.md is what the founder has decided; read it there, never from a note elsewhere.
- Money is integer paise, quantities integer pieces, business dates IST. Mutations are idempotent and carry the client UUIDv7 id.
- A screen imports only @dos/ui (plus expo-router, @dos/api-client, @dos/offline, @dos/domain, @dos/contracts) — never react-native or react-dom.
- Never widen a permission, a policy or a validation to make a walk pass. Purchase cost never reaches a salesperson, delivery or retailer role; a shop's credit limit and outstanding never reach the shop's own device.
- Never say work is saved when it is not, and never claim a reading the device did not take.`

const DEVICE = `DEVICE AND SERVICE RULES — this stage MAY start what it needs:
- Port rule, absolute: if :3000-:3007 are already held, do NOT kill what you did not start. Run what you need on a free port (the all-in-one on :3100 is the standard way) and point the app at it with EXPO_PUBLIC_API_URL. Stop only what you started, before you return.
- Android: export ANDROID_HOME=$HOME/Library/Android/sdk; export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home; export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"; emulator -avd Pixel_7_API_36 -memory 3072 -no-snapshot-save. NEVER Android Studio's bundled jbr (JDK 25's stderr warning fails the AGP build).
- iOS: drive the simulator headlessly with xcrun simctl and QA/tools/ios-drive.mjs. NEVER open the iOS simulator panel in the Claude app (founder, 2026-09-06).
- BEFORE booting anything, check the machine: vm_stat and sysctl vm.swapusage. If free RAM is under ~300 MB or swap is over ~85% full, say so, walk the web legs only, and return the device legs as not-proven with that reading quoted. Wave 3 lost a simulator walk to exactly this and was right to refuse rather than thrash.
- One screenshot per claim, into ${WALKS}/, named <walk-key>-<platform>-<screen>.png.`

const env = (device) => `ENVIRONMENT:
- Work in "${WT}" on branch main (a read-only walking copy — you do not develop here unless a step says to). Start EVERY Bash command with: cd "${WT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${WDB}
- NEVER edit, commit, reset or checkout anything in the main checkout "${MAIN}". You MAY READ it.
- Database ${WDB} is yours: drop and recreate it from dos_test_batch2b_template, migrate and seed as each walk needs. Never connect to dos, dos_qa or a template.
- You MAY write files under ${WALKS}/ — that is where your evidence goes — and nothing else under QA/.
${device ? DEVICE : '- Do NOT start dev servers, emulators or simulators in this stage.'}`

const rulePrompt = () => `You are Fable, the ARCHITECT of the Distribution OS QA programme. The founder has just handed you a decision: "go as per your (FABLE's) recommendation". Rule on it. Read-only — edit nothing except the one output file named below, run no builds, tests or git writes.

THE QUESTION. The founder decided on 2026-09-20 (docs/22 §8, QA DOS-023): "Every list in every app orders by server time, newest first, with the record id only as a tie-break." The lane \`lean-manager-order-lifecycle\` applied it and found one place it does not fit cleanly, and recorded the tension instead of deciding it — read that row yourself:
  grep -n 'DOS-009' "${MAIN}/docs/22-source-of-truth.md"
  grep -n 'DOS-023' "${MAIN}/docs/22-source-of-truth.md"
Orders now sort by \`created_at\`. Bills and trips sort by \`invoice_date\` and \`trip_date\` — the column each list's own window filters on — with the row id as tie-break and a (date, id) keyset cursor. The lane's argument: a bill dated 14 Aug that was typed today would otherwise jump to the top of a 1-31 Aug window, so in a DATED REGISTER the register's own date is the order the reader expects.

READ BEFORE RULING (this is a product decision, so read the product, not only the code):
  the two docs/22 rows above, and §4 and §6 of that file
  git -C "${MAIN}" show 65bc1e1 --stat ; git -C "${MAIN}" log --oneline -12
  the actual queries: grep -rn 'orderBy' "${MAIN}/backend/libs/core/src/modules/billing" "${MAIN}/backend/libs/core/src/modules/delivery" "${MAIN}/backend/libs/core/src/modules/orders" | head -40
  the contracts that document the order, and what the apps' list screens tell the reader about it
  ${MAIN}/QA/findings/12-batch2-new-findings.md for DOS-009 and DOS-023

RULE ON IT. The founder's rule is the rule; you are deciding whether a dated register is an exception to it or a misreading of it. Judge, at least:
- What does a distributor actually look for in a bill register or a trip list — the newest row, or the row for the date they are standing on?
- Does a (date, id) keyset cursor stay correct and stable under paging when rows arrive out of date order?
- Does the exception create a SECOND rule a future reader must learn, and can it be stated in one sentence a new developer will not get wrong?
- What breaks if every list moves to \`created_at\`: which indexes are needed, which windows read differently, which screens change what they show?
- Is there a third answer better than both — for example, order by the register's own date but SAY so on the screen, or keep server time and make the window filter on it too?

Write ${VERD}/DOS-009-list-order-ruling.md (under 60 lines): the question, what you read, the RULING in one sentence a developer cannot misread, the reasoning, exactly what must change in code if anything, how it is proven, and what you deliberately left alone. Then return the structured summary. You are deciding for the founder, in his seat, by his own instruction: decide, do not hedge.`

const buildPrompt = (ruling) => `You are building the architect's ruling on the list-order question for Distribution OS, in an isolated worktree, test-first.

${env(false)}
- For THIS stage only, work in "${MAIN}/.claude/worktrees/b2-list-order" on branch qa/b2-list-order, and use database dos_test_b2_list_order. Create both if they do not exist: git -C "${MAIN}" worktree add -b qa/b2-list-order "${MAIN}/.claude/worktrees/b2-list-order" main ; dropdb -h 127.0.0.1 -p 5439 -U dos --force dos_test_b2_list_order 2>/dev/null ; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template dos_test_b2_list_order ; point that worktree's backend/.env at it; cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install

${RULES}

${LIMITS}

THE RULING (binding — you implement it, you do not re-argue it):
  cat "${VERD}/DOS-009-list-order-ruling.md"
Summary returned by the architect: ${JSON.stringify(ruling, null, 1)}

1. Write the red-first test that fails for the ruling's stated reason, run it, keep the excerpt.
2. Make the smallest change that turns it green. If the ruling needs a new index, generate the migration the normal way (docs/16: a drizzle-generated expand migration plus the hand-written guarantees sibling if it needs one, and the next free index from _journal.json).
3. Run the touched spec files whole, then typecheck and lint the packages you touched; prettier --write.
4. Commit: "fix(DOS-009): <the ruling in one line>" + two sentences + "Test: <file> › <name>" + ${CO}.
5. Then the gates on your tree: backend \`pnpm lint && pnpm typecheck && pnpm build && pnpm docs:readme:check\` and the touched spec files; frontend \`pnpm lint && pnpm typecheck\` and \`pnpm exec turbo run test --continue --concurrency=1 --force\` if you touched anything there.
6. Do NOT touch docs/22 — the ruling is already recorded there by the main session (rows dated 2026-09-21). Read it to check your change matches what is written, and say so if it does not.
7. git status clean. Return the structured result with headCommit.`

const mergeRulingPrompt = (r) => `Merge the list-order ruling into main for Distribution OS. Only git in "${MAIN}" (quote the path); never build, test or touch worktrees.
0. While "${MAIN}/.git/index.lock" exists, wait 20 s and check again, for up to 10 minutes.
1. git -C "${MAIN}" rev-parse --abbrev-ref HEAD prints main; git -C "${MAIN}" status --short shows changes only under QA/ (else blocked).
2. git -C "${MAIN}" rev-parse --short qa/b2-list-order equals ${r.headCommit} (else blocked).
3. git -C "${MAIN}" merge-tree --write-tree main qa/b2-list-order reports no conflict (else blocked).
4. git -C "${MAIN}" merge --no-ff qa/b2-list-order -m "Merge QA batch 2: the list-order ruling (DOS-009)

The founder handed the one open clause of his DOS-023 rule to the architect seat
on 2026-09-21 ("go as per your (FABLE's) recommendation"). Fable's ruling is at
QA/evidence/batch2/verdicts/DOS-009-list-order-ruling.md and is recorded in
docs/22 as his decision, delegated.

${CO}"
5. On any conflict: git -C "${MAIN}" merge --abort and return blocked.
6. git -C "${MAIN}" push -q origin main (retry once). Return mainHead.`

const prepWalkPrompt = () => `Prepare the single walking copy every walk in this run shares. Mechanical setup only.

${LIMITS}

1. git -C "${MAIN}" rev-parse --short main — record it.
2. If "${WT}" does not exist: git -C "${MAIN}" worktree add --detach "${WT}" main. If it exists: cd into it and git checkout --detach main so it sits exactly on current main.
3. dropdb -h 127.0.0.1 -p 5439 -U dos --force ${WDB} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${WDB}
4. Point "${WT}/backend/.env" at ${WDB} and nothing else.
5. cd "${WT}/backend" && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate && pnpm db:seed ; cd ../frontend && pnpm install
6. Report the machine's headroom so the walks can size themselves: vm_stat | head -6 ; sysctl vm.swapusage ; df -h "${MAIN}" | tail -1
7. Return the structured result.`

const WALK_UNITS = [
  {
    key: 'smoke-failures',
    title: 'run the smoke and work every failure it reports',
    device: true,
    what: `The founder, 2026-09-21: "Smoke gate to be done for failed ones." So this is NOT a hunt for a clean run — it is a triage of real failures, and the deliverable is the list plus what each one turns out to be.

The three faults that made a clean run impossible (S-149, S-156, S-157) were fixed in lane \`qa/b2-fix-seed-harness\`; check whether that is on main yet (git -C "${MAIN}" log --oneline | grep -iE 'S-149|S-156|S-157') and say which commit, or that it is not there.

Run it properly on a FRESH \`${WDB}\` from the template — migrate, seed, all eight services plus the worker on free ports per the port rule — then \`pnpm smoke --run-tag wf-1\`, the same again as a replay (\`--run-tag wf-2\`), and \`pnpm smoke --destructive --run-tag wf-3\` followed by a re-seed.

Then, for EVERY BROKEN in any run: the operation, the HTTP status, the server's message, and which of these it is —
  (a) the endpoint is genuinely broken → file it as a DOS block in ${FIND} with the reproduction, and fix it here if the cause is one file and obvious;
  (b) the demo data has no row that qualifies → the harness should say SKIPPED, not BROKEN; that is a harness fault, fix it in backend/tools/smoke-endpoints.mts;
  (c) the published example is wrong → fix the example in backend/libs/core/src/service/examples.ts.
Commit each fix on its own with a test where a test is possible. Report the totals of every run and the full BROKEN list with its classification. A BROKEN you cannot classify is itself the finding — say so rather than guessing.`,
  },
  {
    key: 'money-web',
    title: 'the money ruling legs, read out of the ledger (DOS-168, DOS-169, DOS-170)',
    device: true,
    what: `These are the highest-value walks in the batch: they are about money being right, and they need no phone. Read the ruling and follow its Pass conditions to the letter — do not paraphrase them from this note:
  sed -n '1,40p' "${VERD}/DOS-168-170-merge-gate-ruling.md"
Walk its items 2, 3, 4 and 5 (item 5 at BOTH 1280x800 and 390x844):
  2. Two desks bank one receipt (DOS-168) — two browser contexts pressing Bank in the same second; exactly one 2xx, the loser sees "is deposited, not collected", ONE deposit ref, ONE ChequeDeposited outbox row, ONE Dr BANK line, trial balance balances.
  3. The offline receipt settles (DOS-169) — a trip whose only cash arrived through /sync/upload; the cockpit shows it and settle nets CASH_VAN to 0; a second trip settled on float alone gives 409 settlement_needs_owner, variance -X, one pending approval.
  4. Undo after settlement (DOS-170) — the reversal credits CASH, never CASH_VAN; the bill reopens; the settlement row is untouched. Before/after screenshots plus the receipt_reversal journal lines.
  5. D8 with one receipt held, both widths — both (A) and (B). A note that survives a re-open FAILS the item.
Item 5's airplane-mode half belongs to a phone; do the browser half here with the network offline in the browser context, and name the phone half for the end pass.
These are LEDGER claims: read the journal lines and the trial balance out of the database and quote them, never a screen's summary alone. A leg that fails is a new finding filed in ${FIND} under DOS-168..170, per section (c) of the ruling.`,
  },
  {
    key: 'doorstep-money-web',
    title: 'DOS-172, DOS-174, DOS-175, DOS-176, DOS-177 — the browser half',
    device: true,
    what: `Five findings merged with their proof owed. Read each block and its design, then walk what a browser can prove:
  ${['DOS-172', 'DOS-174', 'DOS-175', 'DOS-176', 'DOS-177'].map((id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); if [ -n "$n" ]; then sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'; fi`).join(' ; ')}
  ls "${VERD}" | grep -iE '175|176|177|172'
DOS-175 matters most to a distributor: a receipt recorded against a trip that did not exist left money permanently un-bankable. Prove the money now lands somewhere a cashier can reach, and read it out of the ledger. DOS-176 (addPod 500) and DOS-177 (consents.grant 500) are server faults — prove the 500 is gone AND that the row it should have written exists. DOS-172 is the loading flow (warehouse + the manager's approval), DOS-174 the challan poll.
Web at 1280 and 390. Name for the end pass anything that only a phone can show.`,
  },
  {
    key: 'wave3-web-walks',
    title: 'every wave-3 walk a browser can settle',
    device: true,
    what: `Eight lanes merged with walks owed. Read what each asked for — those lists are the bar — and settle the browser half of every one:
  for f in lean-kit-polish lean-manager-money lean-delivery-collect lean-manager-order-lifecycle lean-owner-money-approvals lean-sales-rep lean-sales-orders-pricing; do echo "=== $f"; cat "${MAIN}/QA/evidence/batch2/merge-reviews/$f.md"; done
The browser-provable ones include: kit-polish's dialog geometry at 390 and 1280 (the stacked full-width buttons on a field/floor app at a DESK viewport, which is the designed consequence of keying on theme.touch and has never been seen); manager-money's DOS-035/036/038/141 screens; delivery-collect's stop screen; manager-order-lifecycle's W5 "Put back" group and the cancel-mid-pick path; owner-money-approvals' owner desk and phone widths and the manager Money walk; sales-rep's beat chip, scheme count, new-shop line, S12b bills and cancel dialog, plus the offline DOS-086 run with the >50-op straddle through the browser's own offline mode.
ONE of them deserves special attention: \`lean-sales-orders-pricing\` shipped a leak — a shop's credit limit and outstanding reaching the shop's own device through sync.pull — which was caught and closed before merge. Open the RETAILER app and read the network log: confirm no credit figure reaches it. That is a rule in docs/22, not a preference.
Where a review made a fix conditional on what a walk shows, TEST THE CONDITION and record the measurement either way.`,
  },
  {
    key: 'android-basics',
    title: 'one basic Android sanity pass — and nothing more',
    device: true,
    what: `The founder, 2026-09-21: "For now basics can be done." This is a SHORT pass, not the complete validation — that happens once, at the end, on both platforms.

Basics means, on the Pixel 7 (Pixel_7_API_36, -memory 3072): each of the seven apps builds and launches, a real sign-in works, the app's main screen renders with real data from the services, and one write per field app succeeds and reaches the server (sales: an order; delivery: a doorstep delivery; warehouse: a pick). Plus the two phone-only mechanisms this batch changed and nothing else can show: the offline outbox surviving an app kill, and the doorstep money gate at D8.

Check the machine before you boot anything (vm_stat, sysctl vm.swapusage). If it cannot carry the emulator, say so with the readings and return not-proven — do not thrash a machine that other work is sharing.

Do NOT attempt iOS. It is deliberately out of scope for this run and belongs to the end pass.
Anything you find is a finding like any other: file it in ${FIND}.`,
  },
]

const walkPrompt = (u, prev) => `You are settling one block of the platform-walk debt for Distribution OS: ${u.title}.

${env(u.device)}

${RULES}

${LIMITS}

WHAT THIS BLOCK OWES:

${u.what}

HOW TO SETTLE IT:
1. Bring the tree up if a previous block has not: the worktree is already installed and seeded, but re-seed (\`pnpm db:seed\`) whenever a previous walk left the data spent, and say when you did.
2. Start ONLY what this block needs, on free ports per the port rule. Note what you started and stop it before you return.
3. Walk each claim. MEASURE. One screenshot per claim into ${WALKS}/, named ${u.key}-<platform>-<screen>.png.
4. A claim that fails is a RESULT, not a failure of yours: file it in ${FIND} as a new S-row (or a DOS block if it is a product fault), with the run, the measurement and the screenshot. Do not fix product code here unless the finding's own design already tells you the one-line fix and it is inside the file that finding owns — this is a proving stage, not a building one.
5. Write ${WALKS}/${u.key}.md: what you started and on which ports, each claim with its measured numbers and screenshot, each verdict, and a "Still not proven" section that is honest and complete.
${prev ? `\nWhat the previous block in this queue reported, so you do not repeat its setup or its mistakes:\n${JSON.stringify(prev, null, 1).slice(0, 2500)}` : ''}
Return the structured result.`

const judgePrompt = (walks) => `You are Fable, the ARCHITECT of the Distribution OS QA programme. Judge the platform-walk debt now that the whole queue has run. Read-only except the one output file.

Every walk report: ls "${WALKS}"/*.md and read them all. The results the queue returned:
${JSON.stringify(walks, null, 1).slice(0, 12000)}

Your own merge-gate ruling set the terms: cat "${VERD}/DOS-168-170-merge-gate-ruling.md"

Judge, finding by finding, which of these may now be CLOSED on the evidence and which stay OPEN and why: DOS-168, DOS-169, DOS-170, DOS-172, DOS-174, DOS-175, DOS-176, DOS-177, and the wave-3 lanes' owed walks.

The founder changed the terms on 2026-09-21, and you judge against the NEW terms, which are in docs/22 §8 — read them there:
  - The smoke gate is worked failure by failure. So do not ask "is it re-armed"; ask what the smoke run actually found, whether each BROKEN was classified honestly (a real fault / no qualifying demo row / a wrong example), and which of them are now findings someone must fix.
  - iOS and Android get ONE complete validation at the end; basics until then. So a finding whose only remaining debt is a device walk is CLOSED on its browser evidence and LISTED for the end pass — it does not stay open waiting for a phone. Say clearly, per finding, what the end pass must still see.
  - What this Mac can exercise comes first. So judge the strength of the browser evidence hard: a ledger claim read out of the journal is proof; the same claim read off a screen is not.

Then answer one programme-level question in writing: after this run, what is the honest state of the batch — what is proven, what is asserted, and what is the single largest thing still unproven? Name it plainly.

Write ${VERD}/walk-debt-judgement.md (under 70 lines) and return the structured summary. Where the evidence does not support closing something, leave it open — the value of this programme is that its "closed" means something.`

const PREP = { type: 'object', properties: { status: { type: 'string', enum: ['ready', 'blocked'] }, base: { type: 'string' }, headroom: { type: 'string' }, notes: { type: 'string' } }, required: ['status', 'notes'] }

const RULING = {
  type: 'object',
  properties: {
    ruling: { type: 'string' },
    exceptionKept: { type: 'boolean' },
    needsCode: { type: 'boolean' },
    whatChanges: { type: 'array', items: { type: 'string' } },
    howProven: { type: 'string' },
    leftAlone: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['ruling', 'exceptionKept', 'needsCode', 'file'],
}

const RESULT = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['fixed', 'partial', 'blocked'] },
    headCommit: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    gates: { type: 'array', items: { type: 'object', properties: { command: { type: 'string' }, outcome: { type: 'string' } }, required: ['command', 'outcome'] } },
    deviations: { type: 'string' },
  },
  required: ['status', 'commits', 'deviations'],
}

const MERGED = { type: 'object', properties: { status: { type: 'string', enum: ['merged', 'blocked'] }, mainHead: { type: 'string' }, reason: { type: 'string' } }, required: ['status'] }

const WALK = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    status: { type: 'string', enum: ['proven', 'partly-proven', 'not-proven', 'claim-false'] },
    started: { type: 'string' },
    claims: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, platform: { type: 'string' }, measured: { type: 'string' }, verdict: { type: 'string' }, screenshot: { type: 'string' } }, required: ['what', 'platform', 'measured', 'verdict'] } },
    newFindings: { type: 'array', items: { type: 'string' } },
    stillNotProven: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['key', 'status', 'claims', 'stillNotProven', 'file'],
}

const JUDGE = {
  type: 'object',
  properties: {
    closed: { type: 'array', items: { type: 'string' } },
    stillOpen: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, whatIsMissing: { type: 'string' } }, required: ['id', 'whatIsMissing'] } },
    smokeFindings: { type: 'array', items: { type: 'string' } },
    forTheEndDevicePass: { type: 'array', items: { type: 'string' } },
    largestUnproven: { type: 'string' },
    file: { type: 'string' },
  },
  required: ['closed', 'stillOpen', 'smokeFindings', 'forTheEndDevicePass', 'largestUnproven', 'file'],
}

const out = { run: 'ruling-and-walks' }

// ---- Phase 1: the architect's ruling, already written, is small to build -------------------------
phase('Build')
const ruling = { ruling: 'Every list orders newest first on the column its own window filters on; the row id only breaks a tie.', needsCode: true, file: VERD + '/DOS-009-list-order-ruling.md' }
const built = await agent(buildPrompt(ruling), { label: 'build:list-order', phase: 'Build', schema: RESULT, model: 'opus' })
out.build = built
if (built && built.status !== 'blocked' && built.headCommit) {
  const merged = await agent(mergeRulingPrompt(built), { label: 'merge:list-order', phase: 'Build', schema: MERGED, model: 'sonnet', effort: 'low' })
  out.mergeRuling = merged
  log(`list-order ruling: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked'}`)
}

// ---- Phase 2: what this Mac can prove, then one basic Android pass -------------------------------
phase('Walks')
const prep = await agent(prepWalkPrompt(), { label: 'prep:walks', phase: 'Walks', schema: PREP, model: 'sonnet', effort: 'low' })
out.prep = prep
if (!prep || prep.status !== 'ready') {
  out.final = 'walk-prep-blocked'
  return out
}
log(`walking copy ready on ${prep.base}; headroom: ${(prep.headroom || '').slice(0, 160)}`)

const walks = []
let prev = null
for (const u of WALK_UNITS) {
  const w = await agent(walkPrompt(u, prev), { label: `walk:${u.key}`, phase: 'Walks', schema: WALK, model: 'opus' })
  walks.push(w)
  prev = w
  log(`${u.key}: ${w ? w.status : 'agent returned nothing'}${w && w.newFindings && w.newFindings.length ? ` (${w.newFindings.length} new findings)` : ''}`)
}
out.walks = walks

const judgement = await agent(judgePrompt(walks.filter(Boolean)), { label: 'judge:walk-debt', phase: 'Walks', schema: JUDGE, model: 'fable' })
out.judgement = judgement
out.final = 'done'
return out
