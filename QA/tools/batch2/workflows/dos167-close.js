export const meta = {
  name: 'qa-batch2-dos167-close',
  description: "The single item between DOS-167 and closed: re-prove 'unsent work goes FIRST at the next sign-in' on Android and on iOS at the main tip, because the engine's start path changed after the phone measurements were taken. Then Fable decides.",
  phases: [
    { title: 'Proof', detail: 'Android sales on the Pixel 7, then iOS sales on the simulator — one device at a time' },
    { title: 'Judge', detail: 'Fable: is DOS-167 closed' },
  ],
}

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const VERD = MAIN + '/QA/evidence/batch2/verdicts'
const EV = MAIN + '/QA/evidence/batch2/dos-167/close'

const FOUNDER = `FOUNDER ANSWER A (2026-09-14, binding): when a person signs out, their unsent changes stay on THAT device for THAT person only and **go FIRST at that person's next sign-in**. Nothing is thrown away; nobody else may see them.`

const LIMITS = `STANDING RULES: never touch dos or dos_qa destructively; if ports :3000-:3007 are already held, do NOT kill them — use backend/all-in-one on :3100 and point the app at it. Never report a step you did not perform. 'not-tested' is an honest answer; a guess is not. You change no product code and make no commits; write only under "${EV}".`

const WHY = `WHY THIS WALK EXISTS. On the web this clause now passes, measured on the merged tree: a sign-in over a kept file uploaded at **+287 ms**, before the manifest at +405 ms and the pull at +417 ms; a page that booted offline uploaded **+38 ms** after the browser's online event. The phone measurements, however, date from \`ce3dc8c\`, and the engine's start path has changed since — \`start()\` now drains the queue before the handshake, \`setNetworkHint\` no longer defers to \`navigator.onLine\`, and the poll drains before it pulls. The architect will not close a P0 on a measurement taken before the code changed. So: measure it again, on the phone, on the tip.`

const PROOF = { type: 'object', required: ['platform', 'outcome', 'ordering', 'whatWasSeen', 'evidence', 'problems'], properties: {
  platform: { type: 'string' }, outcome: { type: 'string', enum: ['pass', 'fail', 'not-tested'] },
  ordering: { type: 'string' }, whatWasSeen: { type: 'string' },
  evidence: { type: 'array', items: { type: 'string' } }, problems: { type: 'array', items: { type: 'string' } } } }
const JUDGE = { type: 'object', required: ['decision', 'why', 'openItems'], properties: {
  decision: { type: 'string', enum: ['closed', 'not-closed'] }, why: { type: 'string' }, openItems: { type: 'array', items: { type: 'string' } } } }

const android = (head) => `Prove on a REAL device, at main ${head}, that unsent work goes FIRST at the next sign-in — the sales app on Android.

${FOUNDER}

${WHY}

${LIMITS}
- Pixel_7_API_36 booted with -memory 3072, ANDROID_HOME and openjdk@21 per ${MAIN}/CLAUDE.md. Drive with Appium/UiAutomator2 by resource-id or text, never raw coordinates.
- This emulator needs MORE than airplane mode to be truly offline: remove the adb reverse for the service port AND stop the service the app talks to. Airplane mode alone leaves /sync/pull reaching the office. LogBox draws over the footer — dismiss it rather than tapping through.

THE WALK: sign in as a sales rep; let the store open and sync. Cut the office off. Place an order so it queues. Sign out, keeping the change (the sheet offers it). Bring the office back. Sign in as the SAME person.
MEASURE THE ORDER OF CALLS, not an impression: capture the request timeline (the service's own access log, or a proxy you put in front of it) and report the millisecond offsets of the first \`/sync/upload\`, the first \`/sync/manifest\` and the first \`/sync/pull\` of that sign-in. PASS means the upload is recorded BEFORE the manifest and the pull, with no 60-second wait — and the order reaches the office exactly ONCE (check \`sync_ops\`, one row per op).
Then the isolation half: sign in as a DIFFERENT person on the same phone and show they see none of it.
Evidence into "${EV}/"; name every file, including the timeline you measured from.`

const ios = (head) => `Prove the same clause on iOS, at main ${head} — the sales app on the iPhone simulator.

${FOUNDER}

${WHY}

${LIMITS}
- **Never open the iOS simulator panel in the Claude app** (founder, 2026-09-06). Drive it headlessly with \`xcrun simctl\` and Appium/XCUITest; screenshots with \`xcrun simctl io booted screenshot\`. ${MAIN}/QA/tools/ios-drive.mjs is the existing driver.
- To make the office unreachable for the simulator alone, put a loopback proxy in front of the service and take it down — do not stop a service another lane is using.

THE WALK and the PASS CONDITION are the same as the Android one: queue an order offline, sign out keeping it, sign in again as the same person, and show the upload recorded BEFORE the manifest and the pull with the millisecond offsets, the order landing once, and a different person seeing none of it.
If the simulator or Appium cannot be driven, report 'not-tested' with exactly what failed — do not report a pass you did not see.
Evidence into "${EV}/"; name every file.`

const judgePrompt = (head, proofs) => `You are Fable, the ARCHITECT, deciding whether DOS-167 is CLOSED. Read-only.

${FOUNDER}

You judged it not-closed twice. The web clause is now fixed and measured on the merged tree (upload +287 ms before manifest +405 and pull +417; a booted-offline page uploading +38 ms after the online event; every op accepted once). Your remaining item was the unexecuted half of your own condition: **that the upload still precedes the pull on Android and on iOS at the tip**, because the engine's start path changed after those phone measurements were taken.

Your previous judgements: cat "${VERD}/DOS-167-judge.md" ; cat "${VERD}/DOS-167-judge-2.md"
Main is at ${head}. The fresh phone proofs, as executed:
${JSON.stringify(proofs, null, 1)}

Decide 'closed' ONLY if, on every target, unsent changes survive sign-out on that device, GO FIRST at the next sign-in, and never reach anybody else. A 'not-tested' is not a pass. If you close it, list what remains as OTHER findings' work and say so plainly, so nobody reads a closed P0 as a finished area. If you do not close it, name exactly what must run.
Write ${VERD}/DOS-167-judge-3.md (under 50 lines), sign it "Fable, architect", date 2026-09-20. Return the structured decision.`

phase('Proof')
const head = 'the current main tip (read it with git -C "' + MAIN + '" rev-parse --short HEAD)'
const proofs = []
for (const [key, prompt] of [['android-goes-first', android], ['ios-goes-first', ios]]) {
  const res = await agent(prompt(head), { label: 'proof:' + key, phase: 'Proof', schema: PROOF, model: 'opus' })
  proofs.push(res || { platform: key, outcome: 'not-tested', ordering: '', whatWasSeen: 'agent failed', evidence: [], problems: ['agent failed'] })
  log(key + ': ' + (res ? res.outcome : 'agent failed'))
}

phase('Judge')
const judge = await agent(judgePrompt(head, proofs), { label: 'judge3:dos167', phase: 'Judge', schema: JUDGE, model: 'fable' })
log('DOS-167: ' + (judge ? judge.decision : 'no decision'))
return { proofs, judge }
