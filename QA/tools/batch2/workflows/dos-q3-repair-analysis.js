export const meta = {
  name: 'qa-dos-q3-repair-analysis',
  description: "READ-ONLY analysis of the founder's own data (on a copy, never the live database): find every receipt banked twice, every trip payment a settlement left out, and every undo that took money from the van after day-end, then turn them into a trip-by-trip list the founder can sign off one line at a time. Nothing is written to the founder's database by this run.",
  phases: [
    { title: 'Analyse', detail: 'two independent analysts, different lenses, each on the copy' },
    { title: 'Cross-check', detail: 'an adversarial checker re-runs every claim and kills what it cannot reproduce' },
    { title: 'List', detail: 'the trip-by-trip sign-off list, with the balancing entry each line would append' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const DB = 'postgres://dos:dos@127.0.0.1:5439/dos_test_q3_repair'
const EV = MAIN + '/QA/evidence/batch2/dos-q3-repair'

const GROUND = `WHAT THIS IS. The founder's own live database (\`dos\`) carries money recorded before the batch-2 fixes landed. It has just been migrated to the current schema (48 migrations) and dumped to a backup. You are working on \`dos_test_q3_repair\`, a TEMPLATE COPY of it taken at that moment — the real data, safely copied.

ABSOLUTE RULES:
- Connect ONLY to ${DB}. Never to \`dos\`, never to \`dos_qa\`, never to a template. If a command would name one of those, do not run it.
- SELECT only. No INSERT, UPDATE, DELETE, TRUNCATE, ALTER or DDL, even on the copy — a query that changes a row makes the next analyst's numbers wrong.
- Never report a number you did not read from a query you ran. Paste the query beside every figure.
- Money is integer paise everywhere. Convert to rupees only in the human-readable list, and say so.

THE FOUNDER'S RULING (2026-09-14, binding): money already wrong is corrected by ADDING, never by editing. Each wrong figure becomes ONE appended balancing entry. The founder approves the list trip by trip, including whether the crew handed that cash over or still holds it. Nothing is ever edited or deleted.

THE SCHEMA YOU NEED: \`receipts\` (id, tenant_id, receipt_no, retailer_id, mode, amount_paise, received_at, trip_id, status, reverses_receipt_id, deposited_at, deposit_ref, deposit_account_id, bounced_at), \`trips\`, \`trip_settlements\`, \`journal_entries\` (ref_type, ref_id, entry_date, reversed_by_entry_id), \`journal_lines\` (entry_id, account_id, amount_paise — positive is a debit, negative a credit; check that convention yourself before you rely on it), \`accounts\` (code: CASH, CASH_VAN, BANK, AR, …; there are four tenants, so always scope by tenant_id). Read the current code for what each posting SHOULD look like: backend/libs/core/src/modules/receivables and backend/libs/core/src/modules/delivery (settlement.service.ts).`

const FINDINGS = { type: 'object', required: ['lens', 'tenantsSeen', 'findings', 'queriesRun', 'limits'], properties: {
  lens: { type: 'string' },
  tenantsSeen: { type: 'array', items: { type: 'string' } },
  findings: { type: 'array', items: { type: 'object', required: ['kind', 'tenantId', 'tripId', 'receiptIds', 'amountPaise', 'whatIsWrong', 'query', 'proposedEntry'], properties: {
    kind: { type: 'string', enum: ['banked-twice', 'trip-cash-missed', 'undo-took-van-cash', 'other'] },
    tenantId: { type: 'string' }, tripId: { type: 'string' }, receiptIds: { type: 'array', items: { type: 'string' } },
    amountPaise: { type: 'number' }, whatIsWrong: { type: 'string' }, query: { type: 'string' }, proposedEntry: { type: 'string' } } } },
  queriesRun: { type: 'number' }, limits: { type: 'string' } } }

const CHECK = { type: 'object', required: ['confirmed', 'rejected', 'missed', 'notes'], properties: {
  confirmed: { type: 'array', items: { type: 'object', required: ['kind', 'tenantId', 'tripId', 'amountPaise', 'reproducedBy'], properties: { kind: { type: 'string' }, tenantId: { type: 'string' }, tripId: { type: 'string' }, amountPaise: { type: 'number' }, reproducedBy: { type: 'string' } } } },
  rejected: { type: 'array', items: { type: 'object', required: ['claim', 'why'], properties: { claim: { type: 'string' }, why: { type: 'string' } } } },
  missed: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } }

const LIST = { type: 'object', required: ['file', 'lines', 'totals', 'questionsForFounder'], properties: {
  file: { type: 'string' },
  lines: { type: 'array', items: { type: 'object', required: ['tripLabel', 'tenantName', 'date', 'whatHappened', 'amountRupees', 'entryToAppend', 'askTheFounder'], properties: {
    tripLabel: { type: 'string' }, tenantName: { type: 'string' }, date: { type: 'string' }, whatHappened: { type: 'string' },
    amountRupees: { type: 'string' }, entryToAppend: { type: 'string' }, askTheFounder: { type: 'string' } } } },
  totals: { type: 'string' }, questionsForFounder: { type: 'array', items: { type: 'string' } } } }

const LENSES = [
  { key: 'banking', text: `LENS 1 — MONEY BANKED MORE THAN ONCE, AND MONEY BANKED THAT SHOULD NOT HAVE BEEN.
Before the fix, two desks pressing Bank on the same receipt in the same moment could both win (DOS-168). Find every receipt where that left a double effect: more than one BANK debit for one receipt, a deposit_ref that repeats across receipts where it should not, a deposited receipt whose trip had not settled at the time (DOS-132's rule, added later), and a bounced cheque whose reversal is missing or duplicated. For each, say what the books show now and what they should show.` },
  { key: 'settlement', text: `LENS 2 — TRIP CASH THE SETTLEMENT LEFT OUT, AND UNDOS THAT TOOK MONEY FROM THE VAN AFTER DAY-END.
Before the fix, day-end counted only what had reached the office by then, so a payment taken at a door with no signal and synced later was missed (DOS-169); and reversing a trip receipt after settlement credited CASH_VAN again, sending van cash negative while office CASH stayed overstated (DOS-170). For every settled trip, compare the settlement's figures against the receipts that actually belong to that trip (including ones received after the settlement time, and net of reversals). For every reversing receipt, read which account its journal actually credited and when, relative to its trip's settlement.` },
]

const analysePrompt = (lens) => `You are analysing the founder's own Distribution OS data to find money that was recorded wrongly before the batch-2 fixes. You write no report file — return structured data.

${GROUND}

${lens.text}

METHOD:
1. First establish the ground truth of the schema by querying it: which \`accounts.code\` values exist per tenant, whether a positive \`journal_lines.amount_paise\` is a debit or a credit (find a posting whose direction you can infer from an invoice), and how a receipt's journal entry is linked (\`journal_entries.ref_type\`/\`ref_id\`). State what you established in \`limits\` — if you could not establish one of these, say so and do not guess.
2. Then hunt. Prefer ONE query per claim, written so it returns the rows themselves, not just a count.
3. For every finding, work out the ONE balancing entry that would put it right — which accounts, which direction, how many paise, and the narration. Never propose an edit or a delete.
4. Scope every query by tenant_id: there are four tenants and only some are the pilot's real trade.
5. Say plainly in \`limits\` what you could NOT determine from the data — above all, whether cash a crew was short actually reached the office later. That is the founder's knowledge, not the database's.

Return the structured findings. An empty findings list is a perfectly good answer if the data is clean; do not invent work.`

const checkPrompt = (results) => `You are the adversarial checker of an analysis of the founder's own money data. Assume every claim is wrong until you reproduce it yourself. You write no report file.

${GROUND}

THE CLAIMS:
${JSON.stringify(results, null, 1)}

For EACH claim: run its query yourself, and then run a DIFFERENT query that would have to agree. Confirm it only if both agree and the figure is exactly right to the paisa. Reject it if the claim is an artefact — a receipt correctly cancelled, a reversal that is properly paired, a settlement that legitimately excluded a receipt belonging to another trip, a tenant that is demo data rather than the pilot's real trade, or an account-direction assumption the analyst got backwards.
Then hunt for what BOTH analysts missed: take the three fault shapes (banked twice, trip cash missed at settlement, an undo taking van cash after day-end) and write your own query for each, from scratch, without reading theirs first.
Say in \`notes\` whether the direction convention for \`journal_lines.amount_paise\` is what the analysts assumed, with the query that settles it — every rupee figure depends on that one fact.`

const listPrompt = (checked) => `You are writing the list the founder signs off, trip by trip, for the repair of their own data. Write ONE file and return the structured list.

${GROUND}

CONFIRMED FINDINGS (only these; anything the checker rejected is gone):
${JSON.stringify(checked, null, 1)}

Write ${EV}/sign-off-list.md. It is read by the founder, not by an engineer:
- One section per trip, newest first, headed with the trip's own label (its number and date) and the distributor's name — never a raw uuid in a heading.
- Per line: what happened in one plain sentence ("the same ₹4,500 was banked twice on 12 July"), the amount in rupees, the ONE entry that would be appended to put it right in plain words, and — where it matters — the question only the founder can answer, above all **did the crew hand that cash over, or is it still with them?**
- A totals line per distributor and an overall total.
- A short closing section: what this repair does NOT touch, and the fact that nothing is edited or deleted — every correction is an added entry, reversible by another one.
Keep every figure exactly as the checker confirmed it, to the paisa, converted to rupees for reading. If the confirmed list is empty, say so plainly in the file and return an empty \`lines\` array: "no wrong money found in the founder's data" is a good outcome, not a failure.
Also return \`questionsForFounder\`: the short list of things the founder must answer before any entry is appended.`

phase('Analyse')
const results = await parallel(LENSES.map((l) => () => agent(analysePrompt(l), { label: `analyse:${l.key}`, phase: 'Analyse', schema: FINDINGS, model: 'opus' })))
const good = results.filter(Boolean)
log(`analysts returned ${good.reduce((n, r) => n + r.findings.length, 0)} claim(s)`)

phase('Cross-check')
const checked = await agent(checkPrompt(good), { label: 'cross-check', phase: 'Cross-check', schema: CHECK, model: 'opus' })
if (!checked) return { final: 'check-failed', analysts: good }
log(`confirmed ${checked.confirmed.length}, rejected ${checked.rejected.length}, missed-and-found ${checked.missed.length}`)

phase('List')
const list = await agent(listPrompt(checked), { label: 'sign-off-list', phase: 'List', schema: LIST, model: 'opus' })
return { analysts: good, checked, list, final: 'done' }
