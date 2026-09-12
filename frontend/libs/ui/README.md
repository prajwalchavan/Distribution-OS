# @dos/ui — the Distribution OS design system

Layout **A Ledger**, as code. This package is `docs/design/UX-00-design-system.md` in TypeScript: the tokens
of §3–§5 and §7, the English string catalogue, and the §6 components for **both** renderers.

```ts
import { formatMoney, space, useTheme } from '@dos/ui' // tokens, strings, money/qty, chart geometry, theme
import { Button, Money, Register } from '@dos/ui/web' // owner, manager, admin (React DOM)
import { Button, Money, Register } from '@dos/ui/native' // sales, warehouse, delivery, retailer (RN)
```

Both subpaths export the **same names against the same prop types** (`src/types.ts`), so a screen written
against the contract reads identically on either. A screen imports from `@dos/ui`, `@dos/domain` and
`@dos/contracts` only.

Run the gallery — every component, in every state its contract names, on one page:

```bash
cd frontend && pnpm --filter @dos/ui gallery   # http://localhost:5199
```

---

## 1. Layers

| File                      | What it holds                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/tokens.ts`           | Semantic colours (light + dark), the ageing ladder, the field and desk type scales, space, the four touch floors, radii, elevation, motion, chart constants                                                                                                  |
| `src/strings.ts`          | The `en` catalogue for every string the components own, plus `createTranslator` / `extendStrings`                                                                                                                                                            |
| `src/money.ts`            | `formatMoney`, `splitMoney`, `parseRupees`, `speakMoney`, `abbreviateMoney`, and the money pad's `MONEY_PAD_KEYS`, `pressMoneyPadKey`, `padEntryFromPaise`, `paiseFromPadEntry`, `reconcilePadEntry`, `formatPadEntry` — integer paise in, integer paise out |
| `src/qty.ts`              | `splitQty`, `joinQty`, `caseLine`, `stepByCase`, `qtyState` — integer pieces plus a case size                                                                                                                                                                |
| `src/relative-time.ts`    | `relativeTime` ("12 min ago") and `clockTime` ("9:40 am")                                                                                                                                                                                                    |
| `src/charts/geometry.ts`  | Scales, paths, ticks, mix allocation — pure, shared by both chart renderers                                                                                                                                                                                  |
| `src/theme.tsx`           | `ThemeContextProvider`, `useTheme`, `useColors`, `useStrings`, `useTenant`                                                                                                                                                                                   |
| `src/types.ts`            | Every component contract, written once                                                                                                                                                                                                                       |
| `src/web/`, `src/native/` | The two implementations                                                                                                                                                                                                                                      |

**Primitive ramps are private.** `paper`, `petrol`, `slate` never leave `tokens.ts`; a screen names
`colors.accent.solid`, never a hex. There is no hex literal anywhere else in the frontend.

## 2. Tokens

```ts
colors.bg.{ground|surface|raised|sunken|skeleton|handle|backdrop}
colors.text.{primary|secondary|tertiary|disabled|onAccent|onSolid}   // tertiary is DESK ONLY
colors.icon.muted
colors.border.{hairline|faint|strong}                                // strong = anything interactive
colors.accent.{fg|solid|pressed|line|tint}                           // petrol; the only non-status hue
colors.focus.ring
colors.status.{moss|ochre|clay|brick|neutral}.{tint|edge|fg|solid}
colors.chart.{primary|secondary|previous|target|mix[5]|grid|baseline}
```

`typeField` (sp: `keypad hero moneyL moneyM title body bodyStrong label eyebrow`) ·
`typeDesk` (px: `kpi pageTitle railTitle section body nav navActive cell cellMoney label meta eyebrow`) ·
`space` (4 px scale) · `size` (**field 69 · floor 76 · phone 63 · desk 32**) · `gap` · `radius` ·
`elevation` + `cssShadow()` / `nativeShadow()` · `motion` · `AGEING_BUCKETS` + `AGEING_LADDER`.

`flattenColors()` gives every semantic name as a dotted string; the token test asserts that all of them
resolve in **both** themes.

## 3. `<ThemeProvider>` and white-label

```tsx
<ThemeProvider
  theme="light" // 'dark' is the desk-only v2 theme; field apps never pass it
  touch="desk" // field 69 · floor 76 · phone 63 · desk 32 — the shell sets it once
  density="desk" // 'desk' draws registers as tables and may use text.tertiary
  tenant={{ name: session.tenant.displayName, logoUrl: session.tenant.logoUrl }}
  strings={{ 'orders.title': 'Orders' }} // app namespaces, merged over the kit catalogue
>
```

The distributor supplies **a name and a logo, never a colour**. `tenant.primary` sets exactly one thing —
`theme.brand`, a decorative mark colour — and never `accent.*` or any other semantic, because a
tenant-controlled accent would void every contrast ratio in UX-00 §3. `allowTenantAccent` exists for an app
that deliberately wants otherwise and owns the consequences; no shipped app passes it.

The web provider also injects the generated stylesheet (custom properties, `:focus-visible`, hover,
`::placeholder`, keyframes, reduced motion, the print sheet) so an app needs no CSS import.

## 4. The components

Every one takes `testID`. Sizes default to the app's touch floor from the theme.

### 6.1 `<Button>`

| prop                         | type                                           | notes                                                             |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `label`                      | `string`                                       | Verb + object, ≤ 20 chars. Never "Submit"/"OK"/"Save" for a write |
| `onPress`                    | `() => void`                                   |                                                                   |
| `variant`                    | `primary \| secondary \| ghost \| destructive` | One `primary` per screen; destructive is never a solid red        |
| `size`                       | `field \| floor \| phone \| desk`              | Heights 69 / 76 / 63 dp · 32 px                                   |
| `icon`, `shortcut`           | `ReactNode`, `string`                          | `shortcut` prints on the button on desk                           |
| `disabled`, `disabledReason` | `boolean`, `string`                            | **A reason is required**: never a grey word with no cause         |
| `loading`, `successLabel`    | `boolean`, `string`                            | Width does not move; re-taps are swallowed by the idempotency key |
| `fullWidth`                  | `boolean`                                      | Default true on phone, false on desk                              |

### 6.2 `<TextInput>`

`label` (above, always) · `value` · `onChange` · `placeholder` · `helper` (height reserved) · `error`
(business problem + next action) · `state` (`default|disabled|readonly|error|validating`) · `size` ·
`autoFocus` · `maxLength` · `secure` · `keyboard` (`text|decimal|phone|email` — never `type="number"`) ·
`onSubmit`.

### 6.3 `<Money>` · `<RupeeInput>` · `<NumberPad>`

`<Money value size tone symbol />` — `value` is **integer paise**, `null` renders the em dash;
`size` `hero|moneyL|moneyM|cell|body`; `tone` `default|positive|critical|secondary`; `symbol={false}` in a
column whose head already states `₹`. Hero sizes compose the `₹` and the paise at 0.72 em; every instance
carries `aria-label={speakMoney(paise)}` and tabular figures.

`<RupeeInput label value onChange bound boundMessage expected expectedLabel />` — emits **paise or null**,
never a float. Over `bound` the value is **accepted** and `boundMessage` says what happens; there is no
silent clamping. `expected` prints above the field and is never pre-filled. On native at field density the
field opens the full-screen `<NumberPad>`.

`<NumberPad label value onChange onDone mode expected />` — in `money` mode the pad enters **rupees**
(`4 7 5 6` → `₹4,756.00`) and reaches paise only after `.` (`4 7 5 6 . 5` → `₹4,756.50`), with Clear beside
Done; the typed entry goes through `parseRupees`, so no float stands between a driver's thumb and the ledger.
In `count` mode digits are appended (`1 2 3 4` → `1234`).

### 6.4 `<QtyStepper>`

`pieces` · `caseSize` · `onChange(pieces)` · `availablePieces` · `blocked` + `blockedReason` · `disabled` ·
`schemeLabel` · `size` · `onOpenPieces`. Steps by whole cases, never below zero. States: `atZero`
("Not ordered"), `default`, `overAvailable` (ochre, **accepted**), `blocked` (brick + reason), `disabled`.
The case line (`2 cs = 48 pc · 40 cs available`) is a **figure**, set in `moneyM`.

### 6.5 `<Search>`

`value` · `onChange` · `state` (`idle|typing|results|noResults|error`) · `children` (results, **under** the
field, never an overlay) · `onAddNew` (offered on `noResults`) · `staleLabel` · `size`.

### 6.6 `<Group>` · `<ListRow>`

`<Group title footer>` — `title` is the UPPERCASE eyebrow; `footer` is the `accent.tint` scheme strip.
`<ListRow leading primary secondary trailingMoney trailingSize trailing state reason onPress>` — states
`default|selected|waiting|needsAttention|disabled`; the whole row is the tap target; a row derives nothing.

### 6.7 `<Register>`

One contract, two renderings. `columns` (`{key, head, align, width, cell, priority}`) · `rows` · `rowKey` ·
`frozen` · `totals` · `onSelect` · `selectedKey` · `state` (`ready|loading|empty|error|partial|filtered`) ·
`filters` + `onClearFilters` · `asOf` · `errorMessage` · `emptyMessage`. On desk it is a real `<table>` with
32 px rows, a sticky head, a frozen first column, no zebra and a print stylesheet; on a phone (and in every
field app) it is `<Group>`ed `<ListRow>`s in `priority` order — `identity`, `value`, `chip`.

### 6.8 `<KpiStrip>` · `<BarLadder>` · `<AgeingBuckets>`

`<KpiStrip items={[{label, value, delta, tone, spark}]} />` — columns divided by hairlines, never cards;
2×2 on a phone. `<BarLadder rows={[{label, value, family, solid}]} title formatValue />` — every rung carries
its number even at zero; `₹` is stated once, in the title. `<AgeingBuckets buckets={{'0-7': paise, …}} />` is
the ladder with the six rungs of `docs/22` §6, always all six, always in order.

### 6.9 `<StatusChip>`

`label` (the word — colour is never the only channel) · `family` · `solid` (reserved for Out of stock,
Overdue, Failed) · `icon` · `figure` (sets `moneyM` and the taller box). A chip is information, never a tap
target.

### 6.10 `<Tabs>` · `<Chips>` · `<Segments>`

`<Tabs items={[{id,label,count}]} value onChange />` — at most four, 3 px accent underline.
`<Chips items={[{id,label,selected}]} onToggle onClear size />` — a filter row never leaves the screen
without its summary and a one-tap clear. `<Segments items value onChange size />` — two or three options.

### 6.11 `<ConnectionStrip>`

`state: {online, lastSyncedAt, pendingWrites, needsAttention, staleSince}` · `onOpenQueue` · `now`.
28 dp and inert while it has nothing to open; a full touch-floor row once something is waiting, whose tap
opens the waiting list. **There is no "Sync now" button and never a modal for sync, GPS or connectivity.**
Over four hours stale it says so, with a clock time.

### 6.12 `<Sheet>` · `<Dialog>` · `<Toast>`

`<Sheet open onClose title>` — a bottom sheet on phone-width, the 360 px right-hand side panel on desk.
`<Dialog open onClose title body confirmLabel onConfirm cancelLabel destructive busy>` — **for irreversible
ledger writes only**, stating exactly what will be written, with the real verb on the confirm.
`<Toast open message actionLabel onAction onDismiss>` — 4 s, one at a time, Undo only for what the machines
can actually reverse.

### 6.13 `<Avatar>` · `<TenantLogo>` · `<EmptyState>` · `<ErrorState>` · `<Skeleton>`

`<TenantLogo size={'rail'|'header'|'card'} name logoUrl withName subtitle />` — falls back to up to two
initials in a **square** mark (it is a mark, not a person). Reads the tenant from the theme when not given.
`<EmptyState message icon actionLabel onAction>` · `<ErrorState message detail actionLabel onAction>`
(business language; codes behind "Details") · `<Skeleton rows rowHeight width>` (real row heights).

### 6.14 Charts — `<TrendChart>` `<CompareBars>` `<StackedMix>` `<Sparkline>` `<BarLadder>`

Inline SVG on web, `react-native-svg` on native, one shared geometry module, **no chart library**. Money
axes start at zero with at most five ticks; gridlines are horizontal hairlines; no fills, gradients or
shadows; every chart prints its own `range` and `asOf`. Fewer than three points renders as a labelled value
list. `<StackedMix>` allocates percentages by largest remainder so the key line adds to exactly 100.

## 5. Strings

```ts
const t = useStrings()
t('status.low', { cases: 4 }) // "Low · 4 cs"
```

English only for the pilot (founder, 2026-09-05) — but every user-visible word already has a locale key, so
Hindi and Marathi are a translation file, never a rewrite. `catalogs.hi` and `catalogs.mr` currently fall
back to `en` key for key. Apps add namespaces through `<ThemeProvider strings={…}>`.

## 6. Tests

```bash
pnpm --filter @dos/ui test
```

71 of them: every semantic name resolves in both themes and is a real colour; the ageing ladder is the six
rungs of `docs/22` §6 in order; the type floors hold (field body 16, money 20, nothing below 14; desk 14 with
the one recorded 12 px eyebrow); money parses and formats paise with no float anywhere; quantities round-trip
cases ↔ pieces for every real case size; chart axes start at zero, reach the data and never collide two
labels; and `<Money>`, `<RupeeInput>`, `<QtyStepper>`, `<StatusChip>` and `<AgeingBuckets>` are rendered for
real (React DOM's static renderer) and asserted on what reaches the screen.
