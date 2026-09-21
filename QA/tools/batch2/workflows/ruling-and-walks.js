export const meta = {
  name: 'qa-batch2-ruling-and-walks',
  description: 'Fable rules the one open list-order question, its ruling is built if it needs code, and then the whole owed platform-walk debt is settled as one device queue: the smoke that re-arms the main-health gate, the money ruling legs on web, Android and iOS, and every walk the wave-3 lanes recorded as owed',
  phases: [
    { title: 'Rule', detail: 'Fable decides whether bills and trips may keep their own date column, or move to pure server time' },
    { title: 'Build', detail: 'only if the ruling needs code: test-first, adversarial verify, integrate, merge' },
    { title: 'Walks', detail: 'ONE device queue, strictly serial — one Pixel 7, one simulator, and no gate hammering the CPU beside it' },
  ],
}

/**
 * The founder, 2026-09-21: "go as per your (FABLE's) recommendation". He is answering the one question
 * `lean-manager-order-lifecycle` raised rather than decided — his DOS-023 rule says every list orders by
 * server time, and bills and trips are sorted by `invoice_date` / `trip_date` instead, because a bill
 * dated 14 Aug typed today would otherwise jump to the top of a 1-31 Aug window. He has handed the
 * decision to the architect seat, so Fable rules it here and the ruling is written into docs/22 as HIS
 * decision delegated, not as an implementer's convenience.
 *
 * Then the debt this programme has been carrying since 2026-09-14 gets paid. Seven findings are MERGED,
 * PROOF OWED because every lane was forbidden to start a server, and three more lanes added their own owed
 * walks. finish-wave3 proved the walk stage works — web desk, web phone, Pixel 7 and, twice, iOS, with
 * measured geometry rather than eyeballing, and one walk that overturned its own finding honestly.
 *
 * Two rules shape this run and are not negotiable:
 *   - ONE device queue. There is one Pixel 7 and one iOS simulator on this Mac. Every walk is serialized.
 *   - No gate runs beside a walk. A measurement taken while turbo is saturating eight cores and swap is
 *     full is not a measurement. The machine had 40 MB of RAM free during wave 3 and a lane rightly
 *     refused to boot a simulator into it.
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
6. Update docs/22: rewrite the DOS-009 row so it states the ruling as the founder's decision delegated to the architect on 2026-09-21 ("go as per your (FABLE's) recommendation"), add a §11 change-log row, and run \`python3 docs/tools/render-source-of-truth.py\`. That file is the ONE exception to "do not edit docs/22" in this run, because the founder's instruction is what you are recording.
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
    key: 'smoke-main-health',
    title: 'the smoke that re-arms the main-health gate',
    device: true,
    what: `THIS IS THE ONE THAT UNLOCKS THE OTHERS. QA/STATE.md, section "The smoke gate, reshaped": until one observed \`pnpm smoke\` reads 0 BROKEN on a fresh seed and is recorded in STATE with its commit hash, nobody in this programme may be held to 0 BROKEN — and every lane's smoke evidence is weaker than it looks. The three faults that made it unreachable (S-149, S-156, S-157) were fixed in lane qa/b2-fix-seed-harness; confirm on main that they are there before you start (git -C "${MAIN}" log --oneline | grep -iE 'S-149|S-156|S-157').

Run it properly: a FRESH ${WDB} from the template, migrate, seed, all eight services plus the worker on free ports per the port rule, then \`pnpm smoke --run-tag health-1\`, then the same again as a REPLAY (\`--run-tag health-2\`), and then \`pnpm smoke --destructive --run-tag health-3\` followed by a re-seed. Report the exact totals for each run — calls, OK, expected, BROKEN, skipped — and for EVERY BROKEN the operation, the status and the reason. A BROKEN you cannot explain is the finding; file it as an S-row in ${FIND} with the run tag.

If it reads 0 BROKEN: say so with the commit hash of main and the seed's row counts, because that sentence is what re-arms the gate. If it does not: that is an honest and useful answer — the gate stays disarmed and the remaining BROKEN are the next piece of work, named.`,
  },
  {
    key: 'money-web',
    title: 'the money ruling legs that a browser can prove (DOS-168, DOS-169, DOS-170)',
    device: true,
    what: `Fable's merge-gate ruling is binding and names these exactly. Read it first and follow its Pass conditions to the letter — do not paraphrase them from this note:
  sed -n '1,40p' "${VERD}/DOS-168-170-merge-gate-ruling.md"
Walk its items 2, 3, 4 and 5 (item 5 at BOTH 1280x800 and 390x844):
  2. Two desks bank one receipt (DOS-168) — two contexts pressing Bank in the same second; exactly one 2xx, the loser sees "is deposited, not collected", ONE deposit ref, ONE ChequeDeposited outbox row, ONE Dr BANK line, trial balance balances.
  3. The offline receipt settles (DOS-169) — a trip whose only cash came through /sync/upload; the cockpit shows it, settle nets CASH_VAN to 0; the second trip's float-alone settle gives 409 settlement_needs_owner with variance -X and one pending approval.
  4. Undo after settlement (DOS-170) — the reversal credits CASH, never CASH_VAN; the bill reopens; the settlement row is untouched. Before/after screenshots plus the receipt_reversal journal lines.
  5. D8 with one receipt held, both widths — both (A) and (B). A note that survives a re-open FAILS the item.
These are LEDGER claims: read the journal lines and the trial balance out of the database and quote them, never a screen's summary alone. A leg that fails is a new finding filed in ${FIND} under DOS-168..170, per section (c) of the ruling — and per that same section, only money written WRONG where main did not would justify a revert, which is a judgement for the architect, not for you.`,
  },
  {
    key: 'money-android-ios',
    title: 'the money legs that only a device can prove (ruling items 6 and 7)',
    device: true,
    what: `Ruling items 6 and 7, read them first: sed -n '1,40p' "${VERD}/DOS-168-170-merge-gate-ruling.md"
  6. ANDROID, REAL DEVICE REQUIRED — the SQLite outbox, airplane mode and the tray exist only here. Pixel_7_API_36 -memory 3072, delivery dev build, the driver from docs/18. Airplane on → D5 cash → D8 disabled with the pending sentence and the note; airplane off → Updated → re-open → note gone, enabled → check in (trips.return 200) → the desk settles green with float + X on web. Then leg 5(B) on a second trip. adb exec-out screencap per step. Pass: the op sent ONCE, no ANR.
  7. iOS — sanity of the same renderer, xcrun simctl + QA/tools/ios-drive.mjs, never the panel. Stop delivery-service, queue one receipt, confirm the gate sentence and the disabled button, restart, confirm it clears. Three screenshots. A failure here that Android does not reproduce is P3 and never blocks.
iOS is this repository's one unproven target and has been since 2026-09-06. If the machine cannot carry a simulator right now, say that with the vm_stat and swapusage readings and return iOS as not-proven — do not guess it from Android.`,
  },
  {
    key: 'delivery-loading-walks',
    title: 'DOS-172, DOS-174 and the doorstep money findings (DOS-175, DOS-176, DOS-177)',
    device: true,
    what: `Five findings merged with their proof owed. Read each one's block and its design, then walk what each says it needs:
  ${['DOS-172', 'DOS-174', 'DOS-175', 'DOS-176', 'DOS-177'].map((id) => `n=$(grep -n '^### ${id} ' "${FIND}" | head -1 | cut -d: -f1); if [ -n "$n" ]; then sed -n "$n,\\$p" "${FIND}" | awk 'NR>1 && /^### DOS-/{exit} {print}'; fi`).join(' ; ')}
  ls "${VERD}" | grep -iE '175|176|177|172'
DOS-172 is the loading flow (warehouse + manager approval). DOS-174 is the challan poll. DOS-175 is the one that matters most to a distributor: a receipt recorded against a trip that does not exist left money permanently un-bankable — walk that the money now lands somewhere a cashier can reach. DOS-176 (addPod 500) and DOS-177 (consents.grant 500) are server faults: prove the 500 is gone AND that the row it should have written exists.
Web at 1280 and 390, then the Pixel 7 for anything the phone owns.`,
  },
  {
    key: 'wave3-delivery-manager',
    title: 'the wave-3 walks the delivery and manager lanes recorded as owed',
    device: true,
    what: `Four lanes merged with walks owed. Read what each lane's own review and walk section asked for — they are specific, and they are the bar:
  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-kit-polish.md"
  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-manager-money.md"
  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-delivery-collect.md"
  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-manager-order-lifecycle.md"
The headline ones: kit-polish's RupeeInput pad on a Pixel 7 (title BELOW the status-bar clock after the slide animation; the Done/Clear row clear of the gesture bar; a uiautomator dump showing the emptied amount's content-desc reads "Not entered", DOS-150) and its dialog geometry at 390 and 1280; manager-money's DOS-035/036/038/141 screens; delivery-collect's stop screen; manager-order-lifecycle's W5 "Put back" group and the cancel-mid-pick path.
Where a lane's review made a fix conditional on what the walk shows — kit-polish's paddingBottom is the example, left unapplied on purpose because nobody could test the condition — TEST THE CONDITION and then either apply the fix on a new branch or record that it is not needed, with the measurement.`,
  },
  {
    key: 'wave3-owner-sales-retailer',
    title: 'the wave-3 walks the owner, sales and retailer lanes recorded as owed',
    device: true,
    what: `  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-owner-money-approvals.md"
  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-sales-rep.md"
  cat "${MAIN}/QA/evidence/batch2/merge-reviews/lean-sales-orders-pricing.md"
  cat "${MAIN}/QA/evidence/batch2/walks/lean-retailer-platform.md"
owner-money-approvals owes the owner web desk and phone, the Pixel 7, the manager Money walk and the iOS Chips-in-Dialog pass. sales-rep owes web at 390 and 1280 (beat chip, scheme count, new-shop line, the S12b bills, the cancel dialog), the offline DOS-086 run with the >50-op straddle, the Pixel 7 SQLite run with an app kill between upload and pull, and the iOS checks. sales-orders-pricing owes the credit-notice screens — and note its history: that lane shipped a leak (a shop's credit limit and outstanding reaching the shop's own device through sync.pull) that was caught and closed, so walk the RETAILER app too and confirm with the network log that no credit figure reaches it.
The retailer lane's own iOS leg is the one still open from that walk (no iOS build product for the retailer app exists on this Mac; it needs a fresh CocoaPods + Xcode build). Attempt it only if the machine has the headroom, and say plainly if it does not.`,
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

Judge, finding by finding, which of these may now be CLOSED and which stay OPEN and why: DOS-168, DOS-169, DOS-170, DOS-172, DOS-174, DOS-175, DOS-176, DOS-177, and the wave-3 lanes' owed walks. State for each: closed on measured evidence / still open, and what is missing. Then judge the two programme-level questions:
  (1) Is the main-health smoke gate re-armed — did an observed run read 0 BROKEN on a fresh seed, and on which commit?
  (2) Is iOS proven to the standard this programme has been claiming, or is it still the unproven target it has been since 2026-09-06? Say it plainly either way; it runs through every phase of Stage 2.
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
    smokeGateReArmed: { type: 'boolean' },
    smokeCommit: { type: 'string' },
    iosProven: { type: 'boolean' },
    iosVerdict: { type: 'string' },
    file: { type: 'string' },
  },
  required: ['closed', 'stillOpen', 'smokeGateReArmed', 'iosProven', 'iosVerdict', 'file'],
}

const out = { run: 'ruling-and-walks' }

// ---- Phase 1: the ruling the founder handed to the architect seat -------------------------------
phase('Rule')
const ruling = await agent(rulePrompt(), { label: 'rule:list-order', phase: 'Rule', schema: RULING, model: 'fable' })
out.ruling = ruling
log(ruling ? `ruling: ${ruling.ruling.slice(0, 120)}` : 'ruling: agent returned nothing')

// ---- Phase 2: build it, but only if it needs code ------------------------------------------------
if (ruling && ruling.needsCode) {
  phase('Build')
  const built = await agent(buildPrompt(ruling), { label: 'build:list-order', phase: 'Build', schema: RESULT, model: 'opus' })
  out.build = built
  if (built && built.status !== 'blocked' && built.headCommit) {
    const merged = await agent(mergeRulingPrompt(built), { label: 'merge:list-order', phase: 'Build', schema: MERGED, model: 'sonnet', effort: 'low' })
    out.mergeRuling = merged
    log(`list-order ruling: ${merged && merged.status === 'merged' ? 'merged ' + merged.mainHead : 'merge blocked'}`)
  }
} else {
  log('ruling needs no code — the exception stands as ruled, recorded only')
}

// ---- Phase 3: the walk debt, as ONE serial device queue ------------------------------------------
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
