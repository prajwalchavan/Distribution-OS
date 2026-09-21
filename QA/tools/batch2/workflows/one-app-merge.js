export const meta = {
  name: 'one-app-merge',
  description: 'Execute docs/31 under the architect\'s ruling: the six business apps become one Expo project — six move lanes in parallel, then the root + chooser + strings + api-client lane, then guards, retirement and docs, then gates and a blind verifier; the architect merges',
  phases: [
    { title: 'Ground', detail: 'lane 0: re-derive the root sections from HEAD, land the isActive fix and routeFor with specs' },
    { title: 'Move', detail: 'six lanes, one per group, each touching only its own group' },
    { title: 'Assemble', detail: 'root layout, the Continue-as chooser, config, strings swap, serviceFor / apiUrlFor / actAs' },
    { title: 'Retire', detail: 'guards re-pointed, the six apps deleted, launch.json, generate-readmes, docs' },
    { title: 'Prove', detail: 'the full gates on the whole tree, then a blind verifier; the architect reads the diff before merge' },
  ],
}

/**
 * docs/31-one-app-layout.md is the plan; its final section, "Architect's ruling (Fable, 2026-09-21
 * evening)", is binding and wins over any earlier sentence. This runner does not restate the plan — each
 * lane reads the sections it is told to and executes them. It MUST NOT be launched before the
 * role-election lane is merged with ruling B1 applied (the elected role survives a refresh); the Ground
 * lane checks that first and returns blocked if it is not on main.
 *
 * One branch for the whole merge: qa/one-app. Every lane commits to it in its own worktree slice? No —
 * git cannot share one branch across worktrees, so the six move lanes work in ONE worktree on ONE
 * branch, serialized by a lock they take around their commits, each touching only its own group's
 * files. The assemble and retire lanes follow in the same worktree.
 */

const MAIN = '/Users/prajwalchavan/Desktop/Distribution OS'
const WT = MAIN + '/.claude/worktrees/one-app'
const BR = 'qa/one-app'
const DB = 'dos_test_one_app'
const PLAN = MAIN + '/docs/31-one-app-layout.md'
const CO = 'Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>'
const GROUPS = ['owner', 'manager', 'sales', 'warehouse', 'delivery', 'retailer']

const LIMITS = `HOUSE RULES:
- Never report a command you did not run or an outcome you did not see. "not-tested" is accepted; an invented result is not.
- Worktree "${WT}" on branch ${BR}, shared by every lane of this run. Start EVERY Bash command with: cd "${WT}" && export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH && eval "$(fnm env)" && fnm use 24 >/dev/null && export DATABASE_POOL_MAX=3 && export DATABASE_URL=postgres://dos:dos@127.0.0.1:5439/${DB}
- COMMIT LOCK: before \`git add\`/\`git commit\`, take the lock: while ! mkdir "${WT}/.commit-lock" 2>/dev/null; do sleep 5; done — and rmdir it right after the commit. Never commit another lane's files: \`git add\` only the paths you own. Never rebase, reset, stash or push.
- NEVER edit, commit or checkout anything in the main checkout "${MAIN}"; you MAY read it. Do NOT edit docs/22, docs/29, docs/31 or QA/ except the one file a step names.
- 8 GB shared with other runs: one test file per command unless a step names a wider gate; check vm_stat before any \`turbo run build\`.
- zsh has no \${PIPESTATUS[0]}: "cmd > log 2>&1; echo $?". vitest 4: "pnpm --filter <pkg> exec vitest run <file>".
- Screens import ONLY @dos/ui (and expo-router, @dos/api-client, @dos/offline, @dos/domain, @dos/contracts) — never react-native or react-dom. Screens MOVE; they do not change, except the route-literal rewrite the plan names.
- If the plan and the ruling cannot both be followed on a point, the ruling wins; if the ruling cannot be built as written, STOP on that item and say why — you do not re-decide it.`

const groundPrompt = () => `You are lane 0 (GROUND) of the one-app merge for Distribution OS. Read ${PLAN} in full, the ruling last, then act.

${LIMITS}

0. PRECONDITION: git -C "${MAIN}" log --oneline -30 must show the role-election merge and docs/22 §8 must carry the 2026-09-21 election row; grep the auth service on main for the refresh re-validating the ELECTED role (ruling B1). If either is missing return status blocked and say which — nothing else in this run may proceed.
1. Stage: git -C "${MAIN}" worktree add -b ${BR} "${WT}" main (if it exists: checkout ${BR} and merge --ff-only main); dropdb --force ${DB} 2>/dev/null; createdb -T dos_test_batch2b_template ${DB}; point backend/.env at it; cd backend && pnpm install && pnpm exec turbo run build --filter='./libs/*' && pnpm db:migrate ; cd ../frontend && pnpm install.
2. Re-derive §1.3 and §1.4 of ${PLAN} from frontend/libs/app-template/app/_layout.tsx AS IT IS ON HEAD (the Welcome and the landing are merged, 9391c17): rewrite those two sections in the plan file — the ONE docs file this lane may edit — so every later lane reads the truth (ruling B4). Commit "docs(31): §1.3/§1.4 re-derived from HEAD".
3. Land, test-first, in the kit: (a) the isActive home fix (web/shell.tsx and native/shell.tsx) so a group home href like /owner does not light for /owner/orders, with a spec; (b) routeFor(group, path) and useGo() in @dos/ui (or @dos/api-client if the plan says so) with a spec; (c) GROUP_OF: Record<MembershipRole, GroupName>, total, in the place the plan names, with the spec that every MembershipRole maps. Commit each.
4. Create the skeleton frontend/dos-app from the template (package.json name @dos/dos-app, app.json name "Distribution OS", slug dos, bundle ids in.distributionos.app, the TEMPLATE's metro.config.js with the .wasm assetExts block, web port 5173) with an EMPTY app/ except _layout.tsx placeholder — the move lanes fill it. Commit.
5. Return the structured result with the branch head.`

const movePrompt = (g) => `You are the MOVE lane for group "${g}" of the one-app merge for Distribution OS. Read ${PLAN}: §1 (target layout, as re-derived), the ${g} rows of the move table, §3 strings, §4 offline, §5 touch, §6 tests, and the ruling. You touch ONLY: frontend/dos-app/app/${g}/**, frontend/dos-app/src/groups/${g}/**, and the moved tests. Nothing under frontend/${g}-app is deleted by you (the Retire lane does that); you COPY with git mv only where the plan says mv.

${LIMITS}

1. Move every route file of frontend/${g}-app/app/** to frontend/dos-app/app/${g}/** (visible segment, ruling Q1), and src/lib, src/nav.ts, src/strings.ts, src/config.ts's APP block to frontend/dos-app/src/groups/${g}/** exactly as the plan's table says. The group's _layout.tsx keeps what §1.4 (re-derived) says stays; what lifts to the root is NOT recreated here.
2. Rewrite every route literal in your group through routeFor/useGo (router.* calls, nav.ts hrefs AND keys, <PageTabs group/active>) — the plan's count for your group is the bar; a guard will count them.
3. Strings: your group's record stays a whole record (it is SWAPPED in by the root, never merged). Do not rename keys.
4. Offline (sales, warehouse, delivery only): the store prefix comes from GROUPS.${g}.offline, not a literal.
5. Re-path your group's tests (new URL relative paths); the ones §6.5 names for judgement are handled as the plan says.
6. Prove: pnpm --filter @dos/dos-app exec tsc --noEmit -p tsconfig.json for your group's files if the skeleton allows, else typecheck the moved files with the kit's config; run every moved test file. Commit under the lock: "one-app(${g}): routes, group layout, strings and tests moved" + ${CO}.
Return the structured result: files moved (count), literals rewritten (count), tests run, anything you could not do and why.`

const assemblePrompt = (moves) => `You are the ASSEMBLE lane of the one-app merge for Distribution OS. The six groups are in place (reports below). Read ${PLAN} §1.3/§1.4 (re-derived), §2, §3, §4, and the ruling B1–B3, Q2, Q7 and the amendments.

${LIMITS}

Build, test-first, in frontend/dos-app and the two libs:
1. The root app/_layout.tsx: hydrate → Welcome (device-scoped, one key) → sign-in → **the Continue-as chooser** (ruling B3: shown only when the membership permits more than one role under the election table + extra_roles; last-chosen role preselected from platform.storage dos.lastRole; the choice sent as actAs on login and switchTenant; changing role = a fresh election, a new token) → landing → redirect to /<group> by GROUP_OF(session.role) → the group's layout renders ONLY if its group equals the elected group, else the redirect and nothing painted (Q2).
2. Strings SWAPPED per group into ThemeProvider (never merged). Touch floor and density per group.
3. api-client: services.ts (serviceFor, SERVICE_OF, the docs/26 §7 prefixes), CreateApiClientOptions.apiUrlFor evaluated ONCE per request and pinned for its replay; absoluteUrl(group, url); actAs from the chooser, not from a constant. One session per browser profile — say so in a comment where the keys live.
4. Offline: device store keyed by the elected group; sign-out DEVICE-WIDE — the leave flow enumerates the three field prefixes for this person and distributor.
5. Delete the wrong-role screens and their four string pairs IN THE SAME COMMIT that re-targets docs29-field-app-role.guard.test.ts at the chooser (ruling B3).
6. Prove: pnpm --filter @dos/dos-app typecheck && lint; the kit and api-client and offline test files you touched; then start the all-in-one on a free port and sign in through the one app in a browser at 1280 as sunil.tarsun (chooser appears; pick Delivery; you land in /delivery with a delivery token — read the JWT role claim from the network log) and as rahul.deshmukh (no chooser; straight to /sales). Screenshots to QA/evidence/one-app/. Commit under the lock.
Move reports: ${JSON.stringify(moves, null, 1).slice(0, 6000)}
Return the structured result.`

const retirePrompt = () => `You are the RETIRE lane of the one-app merge for Distribution OS. Read ${PLAN} §6, §7 and the ruling's amendment list.

${LIMITS}

1. Re-point every guard the plan and the ruling name (root-layout-redirects, welcome.test, the nine dos-* kit guards, dos-179-keep-claims in libs/offline, the four leave/dates tests, the three cross-app reads) at frontend/dos-app; add the NEW guards: one-app-parity (every file under dos-app/app/** imports only the allowed packages), the cross-group guard (no import across groups; no route literal in app/<g>/** OR src/groups/<g>/** outside /<g>, the pre-election four exempt; serviceFor only from src/api.ts), and the no-duplicate-resolved-route spec (fails today on 14 paths, must pass now).
2. Retire: git rm -r the six frontend/<role>-app directories (admin-app and libs/app-template stay); .claude/launch.json → one dos-app entry (:5173) plus app-template and admin-app; frontend/pnpm-workspace.yaml and turbo if they list apps; frontend/libs/app-template/scripts/new-app.mjs ROLES table → a comment pointing at docs/31; backend/tools/generate-readmes.mts and its siblings → the one app; then from backend/: pnpm docs:readme && pnpm docs:readme:check.
3. Docs in the same commit: docs/22 §2 table + a §11 row; docs/19; docs/23 §1 and §10 paths; docs/28; CLAUDE.md Commands and Layout blocks; docs/18 RESUME HERE. Run python3 docs/tools/render-source-of-truth.py.
4. Commit under the lock. Return the structured result.`

const gatePrompt = () => `You are the GATE of the one-app merge for Distribution OS. On "${WT}" run, in order, and quote every exit code and count:
frontend: pnpm lint; pnpm typecheck; pnpm exec turbo run test --continue --concurrency=1 --force; pnpm format:check; pnpm exec turbo run build --concurrency=1 (the ONE web export plus admin-app) — check vm_stat first and run the build alone if RAM is tight; remove untracked build output.
backend: pnpm docs:readme:check; pnpm --filter @dos/core exec vitest run src/docs/examples.spec.ts.
Then the smoke of the one app in a browser: all-in-one on a free port; sign in at 1280 and 390 as each of sunil.tarsun (chooser → Owner, then re-elect Delivery), vikas.kadam, rahul.deshmukh, dinesh.patil, ganesh.more, ramesh.gupta; each lands in its group, the rail/tabs are the group's, one read per group returns real data from ITS service (read the network log: the base URL must be that role's service), and a foreign URL (/owner/orders as rahul) paints nothing and redirects. Screenshots to QA/evidence/one-app/gate-*.png.
A red gate is a blocker: fix it only if it is one line and inside dos-app or the guards; otherwise return blocked with the output. Commit any fix under the lock. Return the structured result with the branch head.

${LIMITS}`

const verifyPrompt = (r) => `You are the BLIND VERIFIER of the one-app merge for Distribution OS. You have not read the lanes' narratives; you have their structured claims and the branch. Assume something was dropped. You make no commits.

${LIMITS}

Claims: ${JSON.stringify(r, null, 1).slice(0, 12000)}
1. Every route file that existed under the six retired apps on main exists under frontend/dos-app/app/<group>/ (diff the two trees by file list; list any missing).
2. The four blockers and every ruling in ${PLAN}'s last section: show the code that satisfies each (B1 on main's auth service; B2 no group in platform; B3 the chooser and actAs; Q1 visible segments and the no-duplicate-route spec; Q2 foreign group paints nothing; strings swapped; store prefix by group; device-wide sign-out; apiUrlFor pinned per request; GROUP_OF total).
3. Re-run: the new guards; welcome.test; root-layout-redirects; one-app-parity; the cross-group guard; the offline identity test; then pnpm exec turbo run test --continue --concurrency=1 --force in frontend.
4. Grep the tree for any surviving reference to a retired app path (frontend/<role>-app) outside git history and docs that describe history.
Verdict pass only when every claim is TRUE on the branch and the gates are green. Write QA/evidence/one-app/verify.md.`

const RES = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'partial', 'blocked'] }, head: { type: 'string' }, counts: { type: 'object', additionalProperties: { type: 'integer' } }, commits: { type: 'array', items: { type: 'string' } }, notDone: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['status', 'commits', 'notDone', 'notes'] }
const VER = { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fail'] }, missingRoutes: { type: 'array', items: { type: 'string' } }, rulingsUnmet: { type: 'array', items: { type: 'string' } }, problems: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } }, required: ['severity', 'detail'] } }, file: { type: 'string' } }, required: ['verdict', 'missingRoutes', 'rulingsUnmet', 'problems', 'file'] }

phase('Ground')
const ground = await agent(groundPrompt(), { label: 'ground', phase: 'Ground', schema: RES, model: 'opus' })
if (!ground || ground.status === 'blocked') return { final: 'ground-blocked', ground }

phase('Move')
const moves = await parallel(GROUPS.map((g) => () => agent(movePrompt(g), { label: `move:${g}`, phase: 'Move', schema: RES, model: 'opus' })))
const bad = moves.map((m, i) => (!m || m.status === 'blocked' ? GROUPS[i] : null)).filter(Boolean)
if (bad.length) return { final: 'move-blocked', ground, moves, blockedGroups: bad }

phase('Assemble')
const assembled = await agent(assemblePrompt(moves), { label: 'assemble', phase: 'Assemble', schema: RES, model: 'opus' })
if (!assembled || assembled.status === 'blocked') return { final: 'assemble-blocked', ground, moves, assembled }

phase('Retire')
const retired = await agent(retirePrompt(), { label: 'retire', phase: 'Retire', schema: RES, model: 'opus' })
if (!retired || retired.status === 'blocked') return { final: 'retire-blocked', ground, moves, assembled, retired }

phase('Prove')
let gate = await agent(gatePrompt(), { label: 'gate', phase: 'Prove', schema: RES, model: 'opus' })
if (gate && gate.status === 'blocked') {
  const repair = await agent(`${gatePrompt()}\n\nREPAIR ROUND — the previous gate returned blocked with: ${JSON.stringify(gate, null, 1).slice(0, 5000)}\nFix at the cause inside dos-app, the libs or the guards, then re-run the whole gate.`, { label: 'gate-repair', phase: 'Prove', schema: RES, model: 'opus' })
  if (repair) gate = repair
}
const verdict = await agent(verifyPrompt({ ground, moves, assembled, retired, gate }), { label: 'verify', phase: 'Prove', schema: VER, model: 'opus' })
log(`one-app: gate ${gate ? gate.status : 'none'}, verifier ${verdict ? verdict.verdict : 'none'} — waiting for the architect to read the diff and merge`)
return { final: verdict && verdict.verdict === 'pass' && gate && gate.status === 'done' ? 'ready-for-architect-merge' : 'not-ready', ground, moves, assembled, retired, gate, verdict, branch: BR }
