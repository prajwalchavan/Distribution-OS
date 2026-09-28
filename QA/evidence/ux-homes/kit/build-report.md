# Lane "kit" — the shared blocks for every home, and the sign-in page

Branch `ux/kit-signin`, worktree `.claude/worktrees/ux-kit`, three commits on top of `46b13020`:

| Commit     | What                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `8aba1ff0` | Kit: JobCard, JobList, MoreGroup, ProductTile, TileGrid, BrandTile, CartBar (web + native); `<Screen centered>` + the comfortable form scale; `Txt align`; `QtyStepper layout="stacked"`; gallery; tests |
| `9b500cab` | dos-app: sign-in, Continue as and change password on `<Screen centered>`; one new string `app.signInLine`                                                                               |
| `96a44c47` | Fixes found by looking at the screens: job card title gets the full width (was cut to "Shree Ganesh…"), error message takes the form's soft corner, change-password last line back to start-aligned |

Nothing under `backend/` changed (`git diff --name-only 46b13020..HEAD` lists only `frontend/libs/ui/**` and
`frontend/dos-app/**`, 33 files). No role's home was touched. No route was added or removed.

---

## 1. The sign-in page, top to bottom (what the person sees now)

Founder, 2026-09-28: "login page can be more user friendly, placed in middle, not boxy".

Before (`before-signin-390.png`, `before-signin-1280.png`): a header band with a hairline under it ("Distribution OS" small,
"Sign in" as the title), the form pinned to the top-left, 32 px thin fields and a 32 px button on a desk.

Now (`after-signin-390.png`, `after-signin-1280.png`), in the middle of the window both ways, one column 420 px wide:

1. **Distribution OS** — the product's name, centred (32 sp on a phone, 24 px on a desk; the same typeface and ink).
2. **Sign in to start your day.** — one friendly line, centred, secondary text colour.
3. **Username** field — 63 px tall on a phone (the app's own floor), 52 px on a desk (was 32), 12 px corners (was 6).
4. **Password** field — same size; the **Show / Hide** toggle still works (checked in the browser: type `password` → `text` →
   `password`, and in `web/home-blocks.test.tsx`).
5. The error, when there is one — plain words from the server ("Invalid username or password"), in its brick-tint box, between
   the password and the button (`after-signin-error-390.png`). Because the column is centred, it moves the form up by half its own
   height (measured at 1280: heading top 207 → 171 px; fields and button 52 px).
6. **Sign in** — primary, full width, same height as the fields, 12 px corners.
7. **Use the username your distributor gave you.** — the one line of help, centred.

No header band, no hairline, no new colour (every colour is a token; the only visual changes are position, height and corner).
In a window 400 px tall (a phone with its keyboard open) the column scrolls and Sign in stays reachable: measured at 390 × 400,
the scroller is 569 px of content in 400, the button at y 275 (`after-signin-keyboard-390x400.png`).

The same frame is used, unchanged in behaviour, by:

- **Welcome** (first run) — wordmark, the line about the product, the app's name, Sign in; now centred (`after-welcome-*.png`).
- **Continue as** (same route, after the password, for a membership with more than one role) — the distributor's name above,
  "Continue as" as the heading, "Pick the work you are doing now…" under it, the role rows, Continue (`after-continue-as-*.png`;
  signed in as `sunil.tarsun`, who may elect six roles).
- **Change password** — the distributor's name, "Change your password", the forced/voluntary sentence under it, three fields,
  Set password with its reason when it is off, "Your other devices will be signed out." (`after-change-password-*.png`).

### How it is built (a kit capability, not styling in the screen)

- `ScreenProps.centered` (both renderers). The screen is exactly the window's height and scrolls itself (Expo's web root has
  `body { overflow: hidden }`); the column is centred with **auto margins**, which centre while there is room and fall to zero when
  there is not, so an overflowing form scrolls from its top instead of losing the heading above the fold. `context`, `title` and
  the new `subtitle` become the centred heading of the column. Native: `KeyboardAvoidingView behavior="padding"` + `ScrollView`
  whose content grows to the window and centres; insets from `react-native-safe-area-context`.
- `ScreenProps.subtitle` (both renderers, both modes): one line under the title. Outside `centered` it prints under the header title.
- **The comfortable form scale** (`src/control-scale.ts`, not exported to screens): a centred screen provides
  `{ minHeight: layout.formControlHeight (52), radius: radius.lg (12) }`; `<Button>`, `<TextInput>` (and its Show/Hide) and
  `<ErrorState>` on both renderers read it. It can only RAISE a control (`Math.max` with the app's floor), so a phone keeps 63 / 69 / 76.
- `TxtContract.align` (`start | center | end`, both renderers) for the centred heading and help lines.
- Two layout tokens: `layout.formWidth` 420, `layout.formControlHeight` 52.
- Deliberate deviation, recorded: UX-00 §5.3 gives a button `radius.md` (8). On these four screens only, fields and buttons are
  `radius.lg` (12) — "not boxy" is the founder's instruction for exactly this page. Nothing else in the app changed corner.

Every existing testID stays (`sign-in-username`, `sign-in-password`, `sign-in-password-reveal`, `sign-in-submit`, `welcome-*`,
`elect-*`, `elect-continue`, `change-password-*`). The election logic in `app/sign-in.tsx` is untouched; only the `<Screen>` line,
the `<Stack>` line and one `align` changed, plus the chooser's body sentence moved into `subtitle` (same words).

### Taps, before and after

| Job                       | Before                                            | After                  |
| ------------------------- | ------------------------------------------------- | ---------------------- |
| First sign-in on a device | Welcome: Sign in (1) → type, type → Sign in (1)   | the same               |
| Owner with several roles  | … Sign in → pick a row (0–1) → Continue (1)       | the same               |
| Forced password change    | three fields → Set password (1)                   | the same               |

The page is where it is and what it looks like; not one tap was added or removed.

---

## 2. The blocks every home will use

All in `frontend/libs/ui`, contract in `src/types.ts` (§6.18, §6.19), web in `src/web/{jobs,shop}.tsx`, native in
`src/native/{jobs,shop}.tsx`, exported from both barrels, bound on both renderers in `parity.types.ts` (the typecheck fails if
either half drifts from the contract), words in the kit's `strings.ts`, shown with state on the gallery page
(`pnpm --filter @dos/ui gallery`, sections 6.18 and 6.19).

### a. `<JobCard>` — one job

Props: `title`, `subtitle`, `trailing` (a node: `<Money>`), `chip` (`{label, family}`), `state` (`next | default | done`),
`onPress` (the card body), `primary` and up to two `secondary` actions (`{label, onPress, disabled, disabledReason, loading, testID}`).

What it draws, phone (`gallery-jobs-390.png`):

1. `DO THIS NEXT` in the accent colour, only on the `next` card, which also carries the 4 px accent bar and accent outline.
2. The title (shop, bill, supplier), up to two lines, full width.
3. The subtitle (where / how much), one line.
4. The chip (the state in one word) on the left and the figure on the right, on one line.
5. The primary button, full width, at the role's floor (69 / 76 / 63).
6. The secondaries sharing one row beneath it.

Desk (`gallery-jobs-1280.png`): the same body on the left, the buttons in one row on the right, the next step last.
`done` folds to one quiet line: a tick, the name, the state word; still opens the detail.

Rules it enforces, each tested:

- **Pressing a button never also fires the card.** The body and the actions are SIBLINGS (a `<button>` inside a `<button>` is
  invalid HTML and bubbles). Proved by pressing all three buttons in a real DOM: only their own handlers ran; pressing the body
  ran only the card's.
- One primary, at most two secondaries: a third is dropped, not squeezed.
- `disabledReason` prints as text under the button (the kit Button's rule), never only a tooltip.
- `loading` shows the spinner and swallows the second tap.
- 19 dp between adjacent targets (25 on a warehouse screen): between the body and the primary, the primary and the row, the two
  secondaries, and one card and the next (UX-00 §5.2).

Measured in the gallery at 390: the `next` card is 322 px tall with three buttons, of which the body (name, place, state, figure) is 128 px; a `default` card 300 px; a `done` line 69 px.

### b. `<JobList>` — the list

`summary` (at most one slim line), the cards in the order given, `loading` (content-shaped placeholders), and the empty state:
"Nothing waiting" plus ONE action (`emptyActionLabel` / `onEmptyAction`).

### c. `<MoreGroup>` — everything that is not a job

`id`, `title` (default "More"), `count`, `defaultOpen`, children. A full-width row at the touch floor: "More [6] … Show ▾".
Opens in place; open/closed is remembered under `id` for as long as the app runs (a module-level map shared by both renderers,
`src/shop-blocks.ts`). The kit's `<Group>` cannot collapse, so this is a new component rather than an extension.

### d. `<ProductTile>` and `<TileGrid>` — the shop, before there are photographs

`name` (two lines), `brand`, `pack`, `rate` (paise) + `rateUnit`, `mrp`, `offer`, `pieces`, `caseSize`, `onChange`,
`onOpenPieces`, `availablePieces`, `disabled` / `disabledReason`, `onPress`.

- The picture is a block in the brand's colour with its initial. The colour is a hash of the brand's name over the families the
  tokens already have — accent, moss, ochre, clay, neutral (brick left out: it means Overdue and Failed) — as tint fill with its
  own ≥ 7:1 letter, so the same brand is the same colour on every tile, in both themes, on web and phone. No hex was added.
- `pieces = 0`: a large **+ Add** (primary, at the floor) that adds one case (`stepByCase(0, 1, caseSize)`).
- `pieces > 0`: the kit's own `<QtyStepper>` — reused, not rebuilt — with a new `layout="stacked"`: − and + share the width
  with 19 dp between them, the case line under them, the **Pieces** entry under that (still reachable).
- The tile has no box. Two across on a phone leaves ~154 px per tile once the 19 px between two tiles' buttons is taken; a
  padded card would leave too little for − 19 + at the 69 dp floor (157). **Measured limit:** on a 360 px phone each stepper
  button is 67.75 px wide (height 69); from 375 px up they are ≥ 69 both ways.
- `<TileGrid>`: 2 across below 600 px, 3 below 1024, 4 below 1280, 5 below 1600, 6 above (`tileColumns`, shared). Web uses a CSS
  grid; native cuts rows and pads the last one, which draws the same equal columns.

### e. `<BrandTile>`

The same coloured initial, the brand's name, an optional second line ("12 items"), `selected`. One button.

### f. `<CartBar>`

"{count} items" ("1 item"), the total as `<Money>`, one button. Pass it as `<Screen bottomBar>`. **An empty cart draws no bar at
all**: the content returns nothing AND tells the screen to hide its strip (a small context, `src/bottom-bar.ts`, internal to the
kit), so no empty white band is left at the bottom. Tested in a real DOM.
Side effect, on purpose: `<Screen bottomBar={null}>` (or `false`) now draws no strip either, where it used to draw an empty one.

---

## 3. Words

Kit strings added (all ≤ 20 characters for labels, no accounting or software word; tested):
`job.next` "Do this next", `job.nothingWaiting` "Nothing waiting", `job.more` "More", `job.show` "Show", `job.hide` "Hide",
`job.moreSpoken` "{title}, {count} things" (screen reader), `shop.add` "Add", `shop.addItem` "Add {name}", `shop.mrp`
"MRP {amount}", `shop.oneItem` "1 item", `shop.items` "{count} items".

dos-app root strings: added `app.signInLine` "Sign in to start your day.".

Replaced on the page (old → new): the header band "Distribution OS / Sign in" → the heading "Distribution OS" with
"Sign in to start your day." under it. `app.signInTitle` ("Sign in") is no longer drawn on the page (the button says it); the
key stays because `src/config.test.ts` pins it. The chooser's and change-password's sentences moved from a body line into
`subtitle` with the same words.

---

## 4. Tests

No existing test was changed or weakened. No guard test pinned the old sign-in layout (the Welcome guard pins the
`<Welcome appTitle={APP.title} role="member">` wrapper line and the testIDs, which are kept).

Added:

- `libs/ui/src/shop-blocks.test.ts` (15): brand colour is stable, case/space-insensitive, never brick, a token pair in both
  themes; initials; column counts per width; row cutting; the "More" memory; the two-secondary cap; label lengths and words.
- `libs/ui/src/web/home-blocks.test.tsx` (33, jsdom, real clicks): JobCard content, button-never-opens-card, body opens card,
  no nested buttons, third secondary dropped, floors 69 / 76 and the 25 px warehouse gap, desk row order, phone column, next
  marked in words, done line, disabled reason as text, loading swallows taps; JobList order, empty state with one action,
  loading; MoreGroup closed with count, opens in place and remembers; ProductTile content, + adds a case, stepper replaces +,
  Pieces reachable, 19 px between − and +, em dash for an unknown rate; TileGrid; BrandTile; CartBar content and the
  empty-cart strip; `<Screen centered>`: no header band, auto-margin centring, 52 px / 12 px on desk, 69 kept on a phone,
  Show/Hide works, and every other screen unchanged (header band, 32 px fields).
- `libs/ui/src/home-blocks.guard.test.ts` (15, two of them one per renderer): the native halves, read as source (`react-native` does not resolve under
  vitest): both barrels export the seven names; native JobCard renders body and actions as siblings, uses the shared cap,
  the adjacent gap and "Do this next"; native shop reuses QtyStepper stacked and the shared brand/grid helpers and hides the
  empty cart's strip; native `<Screen centered>` avoids the keyboard and provides both contexts; both renderers' Button and
  TextInput read the scale; both QtyStepper halves carry the stacked layout.

---

## 5. Gates (run in the worktree, frontend/)

| Gate                                  | Exit | Notes |
| ------------------------------------- | ---- | ----- |
| `pnpm format`                         | 0    | |
| `pnpm format:check`                   | 0    | |
| `pnpm lint`                           | 0    | 6 tasks |
| `pnpm typecheck`                      | 0    | 6 tasks; includes `parity.types.ts` binding every new block on both renderers |
| `pnpm test`                           | 0    | ui 37 files / 501, dos-app 126 / 623, api-client 130, offline 110, admin-app 14 |
| web export, the brief's exact command | 0    | but see finding 1: the bundle it produced points at production |
| web export used for the screenshots   | 0    | private Metro cache + `--clear`, `EXPO_PUBLIC_AUTH_URL=http://127.0.0.1:3700/auth` |

Screenshots (this folder): `before-*` (main, unchanged), `after-*` (this branch, the export above, demo API on :3700),
`gallery-*` (the kit gallery built with vite into the same served folder, at 390, 1280 and 360).

---

## 6. Findings and what I could not do

1. **The brief's export command builds a bundle that talks to production.** Metro's transform cache is shared in `$TMPDIR` and
   its key does not include `EXPO_PUBLIC_*` values, so `EXPO_PUBLIC_API_URL=http://127.0.0.1:3700 expo export` reused a transform
   of `src/config.ts` baked by some earlier production build: the bundle contained `https://api.distributionos.in` and
   `https://api.distributionos.in/auth` and no `127.0.0.1:3700` at all (checked with grep on the bundle, twice). **One request left
   this Mac for that host:** my first "before" screenshot pressed Sign in with the made-up `nobody.kit` / a made-up password, and
   the browser sent a CORS preflight (`OPTIONS …/auth/auth/login`, no body, no credentials) to `api.distributionos.in`; it was
   refused ("No Access-Control-Allow-Origin"), so the POST never went. The screenshot is kept as
   `before-signin-error-390-wrong-host-build.*`. Both production-pointing builds were deleted from my scratchpad. Every later build
   used `TMPDIR=<scratchpad>/metro-tmp/` plus `--clear` (only my private cache) and was checked by grep before it was served.
   **Other lanes running the same command get the same production bundle** — worth telling them now.
2. The brief's command also omits `EXPO_PUBLIC_AUTH_URL`; with a clean cache, sign-in goes to `http://127.0.0.1:3000`, where
   nothing listens. The demo API's auth is `http://127.0.0.1:3700/auth`.
3. **Welcome prints "Distribution OS" twice** in the one app: the wordmark, then "this app's own name", which is
   `appShortName('Distribution OS')` = "Distribution OS" now that there is one app. Pre-existing (`before-welcome-*.png`), left
   as it is because the brief keeps the welcome's behaviour and testIDs; a one-line follow-up could drop the second line when it
   equals the wordmark.
4. **A three-button job card is tall on a phone** (322 px at the 69 dp floor; the body is 128 px of it, the three buttons and their gaps the rest). The
   floors and gaps are UX-00's and were not bent. The home lanes can keep the list short by giving the `next` card all three
   buttons and the others only the primary; the kit allows either.
5. **Native not run.** The brief forbids Android and iOS builds on this 8 GB Mac. The native halves typecheck against the one
   contract and are pinned by the source guard; they have NOT been rendered on a device. NOT TESTED: keyboard avoidance of
   `<Screen centered>` on Android/iOS, the native TileGrid and CartBar.
6. `admin-app` and `libs/app-template` also wrap their sign-in in the kit's `<Welcome>`, so their welcome is now centred while
   their own sign-in forms (outside this brief) still use the old top-left `<Screen>`. Adopting `centered` there is one prop each.
7. No backend gap: nothing in this lane needed a procedure or field that does not exist. (The shop's photos do not exist — the
   catalogue has no image field — which is why the tile draws the brand block; that is the founder's decision, not a gap.)

Servers started and stopped by this lane: static server on 5710, Playwright server on 9710. Rows written to `dos_test_ux`: two
sign-ins and two sign-outs as `sunil.tarsun` (auth sessions), and three refused logins for `kit.nobody`, a username that does not exist.
