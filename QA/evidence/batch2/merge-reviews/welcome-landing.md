# Merge review — lane welcome-landing (qa/b2-welcome-landing → main)

**First review.** No earlier review of this lane existed (`merge-reviews/welcome-landing.md` and
`verdicts/lean-welcome-landing.md` were both absent), so nothing here is "since last time".

**Decision: MERGE AFTER FIXES** — one blocker, cheap, entirely inside this lane's own files.

Read `6f77718` + `8a3a220` on HEAD, not from the reports. Confirmed independently: `parity.test.ts` and
`root-layout-redirects.test.ts` byte-unchanged; test diff +305/−1 over two files, the one deletion a vitest
import; `Session` (`libs/api-client/src/session.ts:28`) carries no shop name; no contract, permission, RLS or
service touched; `Welcome` returns `<>{children}</>` once set, so a device past it renders today's tree.

## Blocker

**1. The "once per device" flag is cleared on every signed-out launch, not on sign-out — so on a phone the
Welcome returns on every launch, the one thing docs/29 §1 forbids.**
`frontend/libs/app-template/app/_layout.tsx:213` (owner :205, manager :209, sales :220, warehouse :225,
delivery :213, retailer :210, admin :154):

```ts
useEffect(() => { if (!hydrating && session === null) clearWelcomeSeen() }, [hydrating, session])
```

A *state*, not a *transition*: every settled render with no session deletes the key — an abandoned sign-in, a
cold launch nobody has signed into, a launch after a sign-out that already cleared it.

- Web (`src/web/welcome.tsx:52`): the flag is read synchronously in the `useState` initialiser, so the child's
  read wins the launch and the form shows — then the parent effect deletes the key and the **next** launch shows
  the Welcome again. Alternating, on any device sitting signed out.
- Native (`src/native/welcome.tsx:59-69`): the read is `await SecureStore.getItemAsync` from the child's mount
  effect while the parent's clear issues `void SecureStore.deleteItemAsync` in the same tick
  (`src/platform/storage.native.ts:39`) — no ordering guarantee between two native-module calls. If the delete
  lands first, a device already past the Welcome is shown it **on that same launch**; and the key being gone,
  every later signed-out launch shows it too. No test sees this: the flag suite imports only `./web/welcome.js`
  and `parity.test.ts` reads the native barrel as text.

**Fix, in this lane's files.** Make the clear a sign-out transition, as `landingStarts` makes the landing an
arrival: add its sibling to both halves (`web/welcome.tsx:103`, `native/welcome.tsx:122`) —
`sessionEnded(prev, next) => prev !== undefined && prev !== null && next === null` — return it on `LandingGate`
from `useLandingGate` (which holds `state.key`), and make the eight effect lines
`if (landing.signedOut) clearWelcomeSeen()`. Test as `welcome.test.ts:121` does, plus the guards at `:173`.

## Minors

- **Retailer double arrival shows the wrong distributor.** `retailer-app/app/sign-in.tsx` (DOS-102) awaits
  `signIn` then `switchDistributor` — two arrivals — while `Landing`'s timer deps `[onDone, holdMs]` are stable
  (`web/welcome.tsx:139`), so the 2 s runs from arrival A and the shopkeeper reads A's name while B loads.
- **Landing renders over the wrong-role refusal** in sales/warehouse/delivery (one `{landingPanel}` beside one
  `content` expression). Reads as informative, but was not decided — founder's call.
- **No icon on the Welcome**: §1's prose asks for name *and icon*; HEAD renders wordmark, line, `appShortName(appTitle)` and one button — in the prose, not the acceptance list.
- **`parity.types.ts` is edited and is off the lane's owned-file list** (it owns `parity.test.ts`); the edit is
  correct — it binds the three names on both renderers — but it is a conflict surface.
- **Landing a11y**: two `<h1>` for 2 s on web, and the covered app is not `inert`/`aria-hidden`, so a keyboard user tabs underneath an opaque overlay.

## Conflicts

None with main at `6029ce3`; `parity.types.ts` is the only out-of-list file; `docs/22`, `docs/18`, `CLAUDE.md`
and `QA/` are untouched. `pnpm build` (seven `expo export --web`) never ran here — CI bundles the kit file first.

## Walks

- **Android (Pixel 7) — the real gap.** `native/welcome.tsx` has never executed; no test imports it. Walk the
  cold-launch read, the blocker above, `markWelcomeSeen`'s fire-and-forget write surviving an immediate app kill,
  and the 2 s panel at `position:'absolute'` under the shell.
- **Web at 390 and 1280**, one app: Welcome → Sign in → form → landing → home, then sign-out → Welcome. **iOS**
  stays unproven. docs/29 §4 schedules these for the days 2–3 simulation: owed, not a blocker.

## Defects outside / rulings owed

- **docs/29 §1 contradicts itself on the retailer landing**: it asks for "the shop's" name *and* says the shell
  already holds the facts as `session.tenant.displayName` — the distributor. The session has no shop name and §1
  is "UI only, no contract change", so it was unbuildable as written. Correct docs/29, or put the shop on
  the session / `tenancy.me`.
- **docs/29 §1's "sign-in.tsx byte-identical to the template's" is not met and should be retired.** Measured:
  sales/warehouse/delivery differ by one line (the hint string key); owner/manager by a doc comment, a hint key
  and an `onSubmit={submit}` on the username field (real behaviour, not formatting); retailer by 31 lines
  (DOS-102) and admin by 26 (`usePlatformSession()` at `/auth/platform/login`) — the last two uncloseable without
  deleting decided behaviour. The character-identical `<Welcome appTitle={APP.title} role={APP.role}>` guard
  (`welcome.test.ts:100`) is the property that line protects; adopt it and drop byte-identity.
