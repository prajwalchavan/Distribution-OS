# Lane "kit" — blind check, round 1

Branch `ux/kit-signin`, worktree `.claude/worktrees/ux-kit`, head `96a44c47` (three commits on `46b13020`).
Checked 2026-09-28 by a separate agent that did not build it. No code was changed and nothing was committed.

**Verdict: PASS** (no blocker, no major). Seven minors, listed at the end. Three things NOT TESTED, with reasons.

---

## 1. Gates (run by me, in the worktree, `frontend/`)

| Gate | Exit | Notes |
| --- | --- | --- |
| `pnpm format:check` | 0 | |
| `pnpm lint` | 0 | first run was a full turbo cache replay (the builder's own run), so I ran it again with `TURBO_FORCE=true`: 6 tasks, 0 cached, exit 0 |
| `pnpm typecheck` | 0 | `TURBO_FORCE=true`: 6 tasks, 0 cached, exit 0 (includes `parity.types.ts`, which binds all seven new blocks and `QtyStepper` on both renderers) |
| `pnpm test` | 0 | `TURBO_FORCE=true`: 5 tasks, 0 cached. ui 37 files / 501 tests, dos-app 126 / 623, api-client 13 / 130, offline 11 / 110, admin-app 4 / 14 |
| web export | 0 | 1318 modules, 15.9 s. See the note below on how it was run |

Logs: `scratchpad/kit/gates.log` (cached) and `scratchpad/kit/gates-forced.log` (uncached).

**How the export was run, and why it differs from the brief's line.** The builder reported that the brief's line reuses a
shared Metro cache and produced a bundle pointing at `api.distributionos.in`. Loading such a bundle and pressing Sign in
sends a request to production, which the hard rules forbid. So I ran the same export with a private cache and the auth URL
added, and checked the bundle before serving it:

```
TMPDIR=<scratchpad>/kit/metro-tmp/ EXPO_PUBLIC_API_URL=http://127.0.0.1:3700 EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth \
  pnpm exec expo export --platform web --clear --output-dir <scratchpad>/kit-web
```

`grep -rl distributionos.in kit-web` → nothing. The bundle holds `http://127.0.0.1:3700` once and `http://127.0.0.1:3700/auth`
once, and no `127.0.0.1:3000`. Nothing was sent to distributionos.in by this check. NOT TESTED: whether the brief's exact line
really produces a production bundle (running it would read and write the Metro cache the other lanes share).

Served on :5710 (`serve-static.mjs`), driven with Playwright on :9710 (`pw.mjs`). Both stopped at the end.

---

## 2. Sign-in, Welcome, Continue as, change password — measured

The measuring script reads the `<section data-centered="true">` that `<Screen centered>` draws, its column (heading +
form), and every input and button. "Form" below is the form alone (fields, error, button, help line) without the heading.

| Screen | Window | Column centre vs window (dx, dy) | Form alone: dy, % of height | Header band | Fields / button height | Corners |
| --- | --- | --- | --- | --- | --- | --- |
| Welcome, first run (`verify-welcome-390.png`) | 390 × 844 | 0, 0 | — | none | button 63 | 12 px |
| Welcome, first run (`verify-welcome-1280.png`) | 1280 × 800 | 0, 0 | — | none | button 52 | 12 px |
| Sign-in, returning device (`verify-signin-390-returning.png`) | 390 × 844 | 0, 0 | +50 px, 5.92 % | none (heading is part of the column, transparent, no border) | 63 / 63 / 63 | 12 px |
| Sign-in (`verify-signin-1280.png`) | 1280 × 800 | 0, 0 | +44 px, 5.50 % | none | 52 / 52 / 52 (was 32) | 12 px |
| Sign-in (`verify-signin-360.png`) | 360 × 740 | 0, 0 | — | none | 63 | 12 px |
| Sign-in with the error showing (`verify-signin-error-390.png`) | 390 × 844 | 0, 0 | — | none | 63 | 12 px |
| Continue as (`verify-continue-as-1280.png`) | 1280 × 800 | 0, 0 | — | none | rows 56, Continue 52 | 12 px on Continue |
| Continue as (`verify-continue-as-390.png`) | 390 × 844 | 0, 0 | — | none | rows 72, Continue 63 | 12 px on Continue |
| Change password, voluntary, as a driver (`verify-change-password-voluntary-1280.png`) | 1280 × 800 | 0, 0 | +63 px, 7.88 % | none | 69 (the driver's floor) | 12 px |
| Change password, forced (`verify-change-password-forced-390.png`) | 390 × 844 | 0, 0 | — | none | 63 | 12 px |

Every case: horizontal centre within 0 px of the window's centre (limit 8), vertical centre within 8 % (worst 7.88 %, the
form alone on change password; the column with its heading is at 0), no header band, every field and button ≥ 48 px, no
horizontal page scroll (`scrollWidth == clientWidth` at 360, 390 and 1280).

Keyboard-sized window, 390 × 400 (`verify-signin-390x400.png`, `-scrolled.png`): the column is 495 px in 400, it scrolls from
the top (heading at y 32, not lost above the fold), and after scrolling the Sign in button sits at y 275–338, fully visible.

Before, for comparison (the builder's, from main): `before-signin-1280.png` — header band with a hairline, the form pinned
top-left, 32 px fields.

Dark: the app renders light under `prefers-color-scheme: dark` (`verify-signin-390-dark.png`); same as before, not in scope.

## 3. Sign-in still works

| Check | Result | Evidence |
| --- | --- | --- |
| First run shows Welcome; Sign in on it stores `dos.welcome.seen` and shows the form | yes (`localStorage` keys after: `dos.device`, `dos.welcome.seen`) | `verify-welcome-*.png`, `verify-signin-1280.png` |
| Returning device goes straight to the form | yes | `verify-signin-390-returning.png` |
| Wrong password | "Invalid username or password" in words, in its tint box between the password and the button; username kept, password kept (10 chars), Sign in enabled; server answered 401 | `verify-signin-error-390.png` |
| Form usable after the error | yes: typed the right password into the same form and signed in | — |
| Show / Hide | `password / Show` → `text / Hide` → `password / Show` | `verify-signin-show-390.png` |
| Owner `sunil.tarsun` (Enter key to submit, 1280) | "Continue as" with six roles, Owner pre-selected → Continue → `/owner` | `verify-continue-as-1280.png`, `verify-owner-home-1280.png` |
| Owner at 390 | "Continue as" → `/owner` | `verify-continue-as-390.png` |
| Delivery `ganesh.more` (390) | → `/delivery` | `verify-delivery-landing-390.png` |
| Shopkeeper `ramesh.gupta` (390, three distributors) | → `/retailer` | `verify-shopkeeper-after-signin-390.png` |
| Forced change password (my own new driver, temporary password) | sign-in → `/change-password`; three fields, Set password off with its reason in words until filled; submitted → `/delivery`; database shows the change (below) | `verify-change-password-forced-390.png`, `-filled-390.png`, `verify-after-change-password-390.png` |
| Voluntary change password | opens from the driver's ⋯ menu ("Change your password") | `verify-change-password-from-menu-390.png` |
| Sign out | from ⋯ (phone) and the account menu (desk) → `/sign-in`, Welcome shown again (by design: `clearWelcomeSeen` on sign-out) | — |

## 4. The seven blocks

| Block | web | native | web barrel | native barrel | parity binding | tests |
| --- | --- | --- | --- | --- | --- | --- |
| JobCard | `src/web/jobs.tsx` | `src/native/jobs.tsx` | yes | yes | `_JobCard` | 12 in `web/home-blocks.test.tsx` + 4 source guards |
| JobList | same | same | yes | yes | `_JobList` | 3 + guard |
| MoreGroup | same | same | yes | yes | `_MoreGroup` | 2 + guard + the memory in `shop-blocks.test.ts` |
| ProductTile | `src/web/shop.tsx` | `src/native/shop.tsx` | yes | yes | `_ProductTile` | 7 + guard |
| TileGrid | same | same | yes | yes | `_TileGrid` | 1 + guard + column counts |
| BrandTile | same | same | yes | yes | `_BrandTile` | 1 + brand colour tests |
| CartBar | same | same | yes | yes | `_CartBar` | 3 + guard |

`src/index.web.ts` re-exports `./web/index.js` and `src/index.native.ts` re-exports `./native/index.js`; both barrels carry the
two new lines. New test counts: `shop-blocks.test.ts` 15, `web/home-blocks.test.tsx` 33, `home-blocks.guard.test.ts` 14
`it(` blocks (15 runs, one loops per renderer) = 63 as claimed.

**A button in a JobCard does not fire the card's press.** Code: in both renderers the body (`<button>` on web, `Pressable` on
native) and the actions block are SIBLINGS inside the card's outer `div`/`View` (`{body}{actions}`); the actions are kit
`<Button>`s, never inside the body. Test: `pressing a button does its job and NEVER also opens the card` presses all three
buttons in a jsdom DOM and asserts the calls are exactly `['primary','partial','failed']`; `pressing the body…` asserts
`['card']`; `never nests a button inside another button` asserts `button button` is empty. The native half is pinned by a
source guard (`{body}\s*{actions}`). In a real browser (the kit gallery, built with vite into the served folder, `/gallery/`):
`button button` count 0; pressing "Delivered, all items" on the first card opened ONLY its confirm ("Shree Ganesh Kirana gets
every item on the bill. The money is typed on the next screen."), confirming turned that card into the quiet done line, the next
card became "Do this next", the summary went 1 → 2 of 4, a toast said "Shree Ganesh Kirana delivered", and `scrollY` stayed at
7968 before and after (`verify-gallery-confirm-390.png`, `verify-gallery-jobs-390.png`, `verify-gallery-jobs-after-390.png`).

Card sizes measured at 390 in the gallery: next card 322 px tall (body 128), default 300, done line 69; buttons 69 tall.

## 5. Nothing else changed

- `git diff --stat main...HEAD -- backend` → empty. Nothing under `backend/` changed on this branch.
- `git diff --name-only main...HEAD -- frontend/dos-app/app` → only `app/sign-in.tsx` and `app/change-password.tsx`. No
  `app/<group>/` file and nothing under `src/groups/` changed: no role's home was edited.
- `main` has moved on by 9 commits since `46b13020` (QA, docs and the DOS-290/291/293 backend fixes); none touches a file this
  branch touches, and `git merge-tree --write-tree main HEAD` is clean.

## 6. SQL (database `dos_test_ux`, read only)

```sql
select u.id, u.username, m.role, u.must_change_password, u.failed_login_count, u.locked_until, u.password_changed_at
from users u join memberships m on m.user_id = u.id where u.id = '01a0e621-15e7-7a31-815f-525898893d1a';
-- before:  01a0e621-…|kitv.drv323111|delivery|t|0||2026-09-28 09:18:43.159+05:30
-- after:   kitv.drv323111|f|0|2026-09-28 09:19:47.469+05:30   (password changed through the screen; the wrong-password try left failed_login_count 0 once the right one went in)
```

Rows I wrote to `dos_test_ux` (all through the API or the screens, nothing bulk): one staff user `kitv.drv323111` (delivery,
Tarsun) created by the owner API `POST /owner/tenancy/staff`; its password changed once; sign-in sessions for `sunil.tarsun`
(3, one from the script), `ganesh.more` (1), `ramesh.gupta` (1), `kitv.drv323111` (1), each signed out through the app except
the script's (its logout answered 400); one refused login for `kitv.drv323111`. I used my own user for the wrong password and
the password change, so no shared demo account was locked or had its password changed.

## 7. Would a first-time person know what to do in five seconds?

**Sign-in: yes.** What helps: the product's name and one line ("Sign in to start your day.") in the middle, two labelled fields
of 63 px on a phone, one big Sign in, the one help line under it; nothing else on the page. What gets in the way: nothing
real. Welcome shows "Distribution OS" twice and still says "through six apps" (pre-existing).

**JobCard / JobList (as shown in the gallery): mostly yes.** Helps: "DO THIS NEXT" in words plus the accent bar on exactly one
card; the shop's name first in large type; the state as one word in a chip; the amount on the right; the next step as the one
filled button. Gets in the way: with three 69 dp buttons on every card, a card is 300–322 px, so a 390 × 844 phone shows about
two jobs, and "Delivered, all items" repeats on every card, which weakens the "next" signal. The home lanes should give the
secondaries (or even the primary) only to the next card, which the kit already allows.

**Shop tiles: yes.** Brand letter on its colour, name, price "a piece", MRP, offer chip, a big "+ Add"; the stepper replaces
Add after the first tap. "2 cs = 48 pc" is trade shorthand a shopkeeper will know, but it is an abbreviation.

## 8. Findings

Blockers: none. Majors: none.

Minors:

1. **Stepper below the floor on a 360 dp phone.** In a two-across ProductTile the stacked − / + are 67.75 px wide at 360 (69
   tall; builder-declared), 64 px in the gallery's padded page. 360 dp is a very common Android width in India; settle it
   (one-column stepper, or a smaller column gap) before the shopkeeper home uses the tile.
2. **Secondary labels overflow on narrow cards.** Buttons are `white-space: nowrap` with visible overflow. At a 328 px card (a
   360 phone) "Could not deliver" (17 chars) fits with 0 px to spare; at 288 px (a 320 phone) it overflows its button by
   ~6 px (`verify-gallery-jobs-288.png`). Rule 5 allows 20 characters, so an 18–20 character secondary will overflow at 360.
3. **`<Screen bottomBar={null|false}>` no longer draws its empty strip.** Intended (for CartBar) and an improvement, but it
   changes the look of every existing screen that passes `cond ? <X/> : null` (about 36 `bottomBar=` call sites, among them
   the delivery home before a trip and manager fulfilment), so the bottom edge of some role homes changes without their source
   changing.
4. **Welcome (pre-existing):** "Distribution OS" printed twice, and the tagline still says "through six apps" in the one app.
5. **Alignment on the centred forms:** heading and help centred, field labels start-aligned, and change password's last line
   ("Your other devices will be signed out.") start-aligned while sign-in's help line is centred. The Continue-as roles are
   still a bordered group box. Polish.
6. **Accessibility:** the tile's "+ Add" is announced as just "Add" on every tile (`shop.addItem` "Add {name}" is defined but
   never used); the sign-in error has no `role="alert"`/live region (pre-existing in `ErrorState`).
7. **admin-app / app-template:** their Welcome is now centred but their sign-in forms are not (builder-declared, outside the
   brief).

NOT TESTED:

- Native rendering on Android/iOS (builds are forbidden on this Mac): `<Screen centered>` keyboard avoidance, native JobCard,
  TileGrid, CartBar. The native halves exist, typecheck against the one contract and are pinned by source guards.
- The brief's exact export line (see §1): not run, to keep the shared Metro cache and production untouched.
- Continue as → a role other than owner (only owner was elected).

Processes started and stopped: static server :5710, Playwright :9710.
