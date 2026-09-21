export const meta = {
  name: 'qa-day1-cross-role-chain',
  description: 'Day 1 of the five-day plan: one order carried through all seven apps by the people who would carry it, with the hand-off checked at every hop — then the days that go wrong. Browser-driven on this Mac; also the regression.',
  phases: [
    { title: 'Stage', detail: 'own database, own ports, machine headroom measured before anything starts' },
    { title: 'Chain', detail: 'rep → manager → warehouse → delivery → retailer → payment → owner, one continuous story' },
    { title: 'Wrong days', detail: 'rejected, cancelled mid-pick, partial, failed, reassigned, returned, part-paid, refused' },
    { title: 'Verify', detail: 'a blind check of every hand-off claim against the database' },
  ],
}

/**
 * Day 1 of QA/10-DAY-PLAN.md (five-day form). The founder folded the standalone regression into this:
 * walking one order through all seven apps IS walking all seven apps. So this run is Phase 2 of
 * QA/PHASES.md, and its output file is QA/09-cross-role-workflows.md.
 *
 * Another run (web-first.js) may still hold :3000-:3007, :3100, :5173-:5179 and the emulator. The port rule
 * is absolute: never kill what you did not start. This run uses :3200 and :5273-:5279 and its own database.
 */

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const WT = MAIN + '/.claude/worktrees/b2-chain'
const DB = 'dos_test_chain'
const OUT = MAIN + '/QA/09-cross-role-workflows.md'
const EV = MAIN + '/QA/evidence/chain'
const CO = 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>'

const LIMITS = `HOUSE RULES — they override any habit:
- Never report a command you did not run or an outcome you did not see. "not-tested" is always accepted; an invented result is the only unforgivable one. A hop that FAILS is a result, not your failure — file it and say which hand-off broke.
- MEASURE, never eyeball: read what the next screen actually shows (DOM text, network responses, SQL rows) and quote it.
- Test data only: ${DB} and nothing else. Never dos, never dos_qa, never a template.
- Port rule: :3000-:3007, :3100 and :5173-:5179 may be held by another run. Do NOT touch them. You use :3200 and :5273-:5279. Stop only what you started.
- Before starting anything: vm_stat | head -6 ; sysctl vm.swapusage. If free RAM is under ~300 MB or swap over ~85%, run ONE app server at a time (start, walk, stop) rather than all seven at once, and say so.
- zsh has no \${PIPESTATUS[0]}: "cmd > log 2>&1; echo $?".
- Every action is taken AS THE PERSON WHO WOULD TAKE IT, IN THAT PERSON'S APP. If a role cannot do in its app what the business needs, that is a finding — never do it through the API instead.`

const ENV = `ENVIRONMENT:
- Worktree "${WT}" detached on current main. Start EVERY Bash command with: cd "${WT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=4 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${DB}
- Never edit, commit or checkout anything in "${MAIN}"; you MAY read it. You may write only under ${EV}/ and the one output file a step names.
- Backend: ALL_IN_ONE_PORT=3200 pnpm --filter @dos/all-in-one dev (all eight services + worker in one process; confirm the worker is running). Apps: pnpm --filter @dos/<role>-app web with EXPO_PUBLIC_API_URL=http://127.0.0.1:3200 on ports owner 5273, manager 5274, sales 5275, warehouse 5276, delivery 5277, retailer 5278, admin 5279.
- Sign-ins (password Dos@1234): owner sunil.tarsun · manager vikas.kadam · accountant meena.joshi · warehouse dinesh.patil · delivery ganesh.more · sales rahul.deshmukh · retailer ramesh.gupta · console dos.admin. Confirm against ${MAIN}/docs/18-build-log.md.
- Playwright (frontend has it): 1280x800 for desk roles; the sales and delivery legs ALSO at 390x844.`

const stagePrompt = () => `Stage the day-1 chain run for Distribution OS. Mechanical only.

${LIMITS}

1. If "${WT}" does not exist: git -C "${MAIN}" worktree add --detach "${WT}" main ; else cd into it and git checkout --detach main.
2. dropdb -h 127.0.0.1 -p 5439 -U dos --force ${DB} 2>/dev/null; createdb -h 127.0.0.1 -p 5439 -U dos -T dos_test_batch2b_template ${DB}; point "${WT}/backend/.env" at ${DB} and nothing else.
3. cd "${WT}/backend" && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate && pnpm db:seed ; cd ../frontend && pnpm install
4. mkdir -p "${EV}". Report headroom: vm_stat | head -6 ; sysctl vm.swapusage ; df -h "${MAIN}" | tail -1. Report which of :3000-:3007, :3100, :5173-:5179, :3200, :5273-:5279 are held (lsof -nP -iTCP -sTCP:LISTEN).
5. Return the structured result.`

const chainPrompt = (stage) => `You are running Phase 2 of the Distribution OS QA programme: the cross-role end-to-end business flow, as the people who do it. Read QA/PHASES.md "Phase 2" first: sed -n '60,89p' "${MAIN}/QA/PHASES.md". Then QA/24-simulation-design.md §3 (the rule that governs every action) — it applies here too.

${ENV}

${LIMITS}

Stage report: ${JSON.stringify(stage, null, 1)}

Start the all-in-one on :3200 and the worker; confirm /health on it. Start app servers per the headroom rule.

THE CHAIN — one order, one continuous story, and at EVERY hop write down what the next person saw:
1. Sales (rahul.deshmukh, 390x844 AND 1280): open today's beat, check in at a shop, book an order (cases + pieces, watch the live ATP hint and the price engine), submit. Record: order number, lines, total in paise, the applied rules shown.
   → Hop check: does the manager's queue show it, with the same total?
2. Manager (vikas.kadam, 1280): open the queue, approve it (or, if it needs no approval, confirm what the manager sees and why). If a credit approval is needed, do it as the OWNER (sunil.tarsun) and note that the shop's limit stays unchanged.
   → Hop check: does the warehouse see it in fulfilment with the same lines?
3. Warehouse (dinesh.patil, 1280 and 390): pick list (consolidated by SKU, FEFO — note which lot it chose and why), pick actual lots, pack → the invoice is issued at pack. Record: invoice number, PDF present, own name and logo on it.
   → Hop check: is the bill on the planning board with the same amount?
4. Trip: plan a trip from the board (warehouse W10 or manager M7), build the load sheet, and have the MANAGER approve it with PIN from the manager app; confirm the crew count; depart it as the crew or the desk. Prove the warehouse role CANNOT depart a trip and nothing departs past a draft sheet.
   → Hop check: does the driver's app show the trip with this stop and the bill amount?
5. Delivery (ganesh.more, 390x844 AND 1280): open the trip, the stop (overdue dues shown?), deliver with proof of delivery, collect — cash for part, UPI with a UTR for the rest. Record the receipt numbers.
   → Hop check: does the retailer app (ramesh.gupta) show the bill, the receipt and the new outstanding — and the same rupees?
6. Check in and settle the trip at the desk; the accountant (meena.joshi) banks the cash.
   → Hop check: does the owner's app (sunil.tarsun) show today's revenue, the stock movement for those lots, and the shop's outstanding — and do they equal SQL? Run the SQL and quote both.
7. Admin console (dos.admin, 5279): read Tarsun's counts; assert no rupee of its trade is visible.

For every hop: one screenshot into ${EV}/hop-N-<role>.png, the DOM text of the thing you claim, and the SQL row(s) behind it. A hop where the next person did NOT get what they needed — lost, delayed, duplicated, or silently different — is a FINDING: file it as a DOS block in ${MAIN}/QA/findings/12-batch2-new-findings.md (next free number) and keep going if the story can continue; stop the story where it cannot.

Write the first half of ${OUT}: the chain, hop by hop, with what each person saw and the numbers. Leave a heading "## The days that go wrong" for the next agent. Stop the app servers you started; leave the all-in-one on :3200 running for the next agent and say so. Return the structured result.`

const wrongPrompt = (chain) => `You are continuing Phase 2 of the Distribution OS QA programme: the days that go wrong. The happy chain has been walked; its report is the first half of ${OUT} — read it, and reuse the all-in-one on :3200 if it is still up (start it if not).

${ENV}

${LIMITS}

Chain result: ${JSON.stringify(chain, null, 1).slice(0, 4000)}

Walk EACH of these as the people involved, each on a fresh order where it needs one, and at each write what the next person saw and what the database holds:
1. Order REJECTED by the manager — the rep learns why; nothing reserved.
2. Order CANCELLED mid-pick by the desk — the picker is told which lines to put back; stock returns to the right lot; no invoice.
3. PARTIAL delivery — per-line short with a reason → a credit note; the shop's outstanding is the delivered amount, not the billed one.
4. FAILED delivery — stock stays on the van; the bill goes back to planning, not to the shop; the shop sees nothing delivered.
5. Delivery REASSIGNED mid-route to another crew — the new driver sees the stop; the old one does not; the bill rides on one trip only.
6. RETURN after delivery, booked at the desk — damaged goods to the damaged bin (prove they never reappear as sellable), a credit note, the shop's outstanding reduced.
7. PARTIAL payment — allocated oldest bill first; the remainder ages correctly.
8. Retailer REFUSES goods at the door — the stop outcome, the stock, the bill, and what the desk does next.

Each one gets a screenshot into ${EV}/wrong-N-<what>.png and the SQL. Each one that behaves wrongly is a finding, filed as above. Write "## The days that go wrong" into ${OUT} with the eight, and a closing "## What the next person did not get" list — every hand-off in either half where something was lost, delayed, duplicated or silently different. Stop everything you started. Return the structured result.`

const verifyPrompt = (chain, wrong) => `You are the blind verifier of the day-1 chain run for Distribution OS. You have NOT read the two operators' narrative; you are given only their structured claims below and the database. Assume a claim is wrong until the database agrees with it. You make no commits and start no services.

${ENV}

${LIMITS}

Claims: ${JSON.stringify({ chain, wrong }, null, 1).slice(0, 9000)}

For every numbered hop and every "wrong day": find the rows in ${DB} (orders, invoices, receipts, stock_ledger, stock_balances, journal_lines, trips, stops, credit_notes, sync_ops) and state whether the claim is TRUE, FALSE, or NOT DECIDABLE from the database. Check specifically: totals in paise equal across order → invoice → receipt + outstanding; stock_ledger rows exist for pack and for the return, with the right lot; the damaged bin never appears in sellable_stock; CASH_VAN nets to 0 after settlement; every journal balances; invoice and receipt numbers unique per series and FY; no negative stock_balances anywhere.
Then read ${OUT} once, at the end, and say where its words are stronger than its evidence.
Write ${EV}/verify.md and return the structured verdict.`

const STAGE = { type: 'object', properties: { status: { type: 'string', enum: ['ready', 'blocked'] }, headroom: { type: 'string' }, portsHeld: { type: 'string' }, notes: { type: 'string' } }, required: ['status', 'notes'] }
const RUN = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'stopped-at-hop', 'blocked'] },
    hops: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, role: { type: 'string' }, did: { type: 'string' }, nextPersonSaw: { type: 'string' }, sql: { type: 'string' }, ok: { type: 'boolean' } }, required: ['n', 'role', 'did', 'nextPersonSaw', 'ok'] } },
    findings: { type: 'array', items: { type: 'string' } },
    notExercised: { type: 'array', items: { type: 'string' } },
    servicesLeftRunning: { type: 'string' },
    file: { type: 'string' },
  },
  required: ['status', 'hops', 'findings', 'notExercised', 'file'],
}
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['holds', 'holds-with-findings', 'broken'] },
    claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, result: { type: 'string', enum: ['TRUE', 'FALSE', 'NOT DECIDABLE'] }, evidence: { type: 'string' } }, required: ['claim', 'result', 'evidence'] } },
    strongerThanEvidence: { type: 'array', items: { type: 'string' } },
    file: { type: 'string' },
  },
  required: ['verdict', 'claims', 'strongerThanEvidence', 'file'],
}

phase('Stage')
const stage = await agent(stagePrompt(), { label: 'stage:chain', phase: 'Stage', schema: STAGE, model: 'sonnet', effort: 'low' })
if (!stage || stage.status !== 'ready') return { final: 'stage-blocked', stage }
log(`staged; headroom: ${(stage.headroom || '').slice(0, 140)}`)

phase('Chain')
const chain = await agent(chainPrompt(stage), { label: 'chain:happy-path', phase: 'Chain', schema: RUN, model: 'opus' })
log(`chain: ${chain ? chain.status + ', ' + chain.findings.length + ' findings' : 'agent returned nothing'}`)

phase('Wrong days')
const wrong = await agent(wrongPrompt(chain), { label: 'chain:wrong-days', phase: 'Wrong days', schema: RUN, model: 'opus' })
log(`wrong days: ${wrong ? wrong.status + ', ' + wrong.findings.length + ' findings' : 'agent returned nothing'}`)

phase('Verify')
const verdict = await agent(verifyPrompt(chain, wrong), { label: 'verify:chain', phase: 'Verify', schema: VERDICT, model: 'opus' })
log(`verdict: ${verdict ? verdict.verdict : 'agent returned nothing'}`)

return { run: 'day1-chain', stage, chain, wrong, verdict, final: verdict ? verdict.verdict : 'unverified' }
