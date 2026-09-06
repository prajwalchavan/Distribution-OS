/**
 * The string catalogue the KIT owns. Apps add their own namespaces (see `extendStrings`).
 *
 * English only for the pilot (founder, 2026-09-05) — but every user-visible word already has a
 * locale key, so Hindi and Marathi are a translation file, never a rewrite. No component contains a
 * literal English sentence.
 *
 * Writing rules (UX-00 section 12): the trade's own word, labels <= 20 characters, buttons are
 * verb + object, state the next action rather than the problem, and never "Oops", "!" or an emoji.
 */

export const LOCALES = ['en', 'hi', 'mr'] as const
export type Locale = (typeof LOCALES)[number]

/** `en` is the complete catalogue; a second locale is a file with the same keys. */
export const en = {
  // Generic actions the kit's own controls use.
  'action.close': 'Close',
  'action.cancel': 'Cancel',
  'action.clear': 'Clear',
  'action.done': 'Done',
  'action.undo': 'Undo',
  'action.retry': 'Try again',
  'action.details': 'Details',
  'action.export': 'Export',
  'action.print': 'Print',
  'action.open': 'Open',

  // Money and quantity (UX-00 sections 4.5, 6.3, 6.4).
  'money.none': '—',
  'money.rupeeSymbol': '₹',
  'money.spoken': '{rupees} rupees {paise} paise',
  'money.spokenWhole': '{rupees} rupees',
  'qty.case': 'cs',
  'qty.piece': 'pc',
  'qty.caseLine': '{cases} cs = {pieces} pc',
  'qty.caseLineWithLoose': '{cases} cs + {loose} pc = {pieces} pc',
  'qty.available': '{cases} cs available',
  'qty.freeGoods': '{pieces} pc free',
  'qty.at': 'at',
  'bill.lessDiscount': 'less',
  'qty.notOrdered': 'Not ordered',
  'qty.pieces': 'Pieces',
  'qty.decrease': 'One case less',
  'qty.increase': 'One case more',
  'qty.onlyAvailable': 'Only {cases} cs available — rest short-supplied',

  // Search (UX-00 section 6.5).
  'search.placeholder': 'Search items',
  'search.recent': 'RECENT',
  'search.noResults': 'Nothing matches "{query}"',
  'search.addNew': 'Add as new item',
  'search.stale': 'Showing results from {when}',

  // Register (UX-00 section 6.7).
  'register.selected': '{count} selected',
  'register.total': 'Total',
  /* Parenthesised rather than "{count} filters", which reads "1 filters" the moment one is on. */
  'register.filters': 'Filters ({count})',
  'register.clearFilters': 'Clear',
  'register.asOf': 'As of {when}',
  'register.empty': 'Nothing here yet',

  // Connection strip (UX-00 section 6.11) — the honesty contract. Never a "Sync now" button.
  'connection.synced': 'Updated {when}',
  'connection.waiting': '{count} waiting to send',
  'connection.offline': 'Offline since {when}',
  'connection.stale': 'Stock as of {when}',
  'connection.attention': '{count} need attention',
  'connection.justNow': 'just now',
  /* Online, but nothing has come back yet: the strip must not claim a read it has never had. */
  'connection.notYet': 'Not updated yet',
  'connection.minutesAgo': '{count} min ago',
  'connection.hoursAgo': '{count} h ago',

  // Loading, empty, error (UX-00 section 6.13).
  'state.loading': 'Loading',
  'state.empty': 'Nothing here yet',
  'state.error': 'Could not load this',

  // Status vocabulary (UX-00 section 3.3). Colour is never the only channel: the word travels with it.
  'status.inStock': 'In stock',
  'status.low': 'Low · {cases} cs',
  'status.outOfStock': 'Out of stock',
  'status.notStocked': 'Not stocked',
  'status.paid': 'Paid',
  'status.partPaid': 'Part paid · {amount} left',
  'status.due': 'Due {date}',
  'status.overdue': 'Overdue · {days} days',
  'status.cancelled': 'Cancelled',
  'status.writtenOff': 'Written off',
  'status.delivered': 'Delivered',
  'status.partial': 'Partial · {short} of {total} short',
  'status.failed': 'Failed',
  'status.notYet': 'Stop {index} of {total}',
  'status.approved': 'Approved by {name} · {time}',
  'status.pending': 'Waiting for owner',
  'status.rejected': 'Rejected — {reason}',
  'status.owes': 'Owes {amount}',
  'status.limit': 'Limit {amount}',
  'status.clear': 'Clear',

  // Ageing ladder rungs (docs/22 section 6), counted from the invoice date.
  'ageing.0-7': '0–7',
  'ageing.8-15': '8–15',
  'ageing.16-30': '16–30',
  'ageing.31-60': '31–60',
  'ageing.61-90': '61–90',
  'ageing.90+': '90+',
  'ageing.title': 'Money owed, by age',

  // Charts (UX-00 section 6.14). Every chart prints its range and its "as of" time.
  'chart.range': '{from} — {to}',
  'chart.asOf': 'as of {when}',
  'chart.current': 'This period',
  'chart.previous': 'Previous',
  'chart.target': 'Target',
  'chart.other': 'Other',
  'chart.noData': 'No figures for this range',

  // Tenant chrome (UX-00 section 11). The product's own mark never appears here.
  'tenant.logoAlt': '{name} logo',
  'tenant.switch': 'Switch distributor',

  // The shell (UX-00 sections 8.1 and 8.2).
  'nav.sections': 'Sections',
  'nav.more': 'More',
  'account.signOut': 'Sign out',
} as const

export type StringKey = keyof typeof en
export type Catalog = Readonly<Record<StringKey, string>>

/** Hindi and Marathi are not translated for the pilot; they fall back key-for-key to English. */
export const catalogs: Readonly<Record<Locale, Catalog>> = { en, hi: en, mr: en }

export type StringParams = Readonly<Record<string, string | number>>

/** Replaces `{name}` placeholders. An unknown placeholder is left as written, so it is visible in review. */
export function interpolate(template: string, params?: StringParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key]
    return value === undefined ? whole : String(value)
  })
}

/** `t('status.low', { cases: 4 })`. Extra namespaces an app registers win over the kit's own keys. */
export type Translator = (key: string, params?: StringParams) => string

/**
 * A translator over the kit catalogue plus any app namespaces. A key that exists nowhere is returned
 * as itself — a missing string shows up as `orders.title` on screen instead of an empty box.
 */
export function createTranslator(
  locale: Locale = 'en',
  extra: Readonly<Record<string, string>> = {},
): Translator {
  const base: Readonly<Record<string, string>> = catalogs[locale]
  return (key, params) => interpolate(extra[key] ?? base[key] ?? key, params)
}

/** Merge an app's namespace into the kit catalogue: `extendStrings({ 'orders.title': 'Orders' })`. */
export function extendStrings(
  ...namespaces: readonly Readonly<Record<string, string>>[]
): Readonly<Record<string, string>> {
  return Object.assign({}, ...namespaces) as Readonly<Record<string, string>>
}

/** The default translator, for code outside a React tree (formatters, tests, sync messages). */
export const t: Translator = createTranslator('en')

// ---------------------------------------------------------------------------
// Machine words
// ---------------------------------------------------------------------------

/**
 * A service's own enum value, made readable: `settled_with_variance` -> "Settled with variance",
 * `POST_FULFILLMENT` -> "Post fulfilment", `gstSalesRegister` -> "Gst sales register",
 * `claims.line.add` -> "Claims line add".
 *
 * WHY THE KIT OWNS THIS. Every one of the seven apps renders states, kinds, reasons and modes that
 * arrive as identifiers, and every one of them printed them verbatim to begin with — a `<StatusChip>`
 * reading "settled_with_variance" and a Terms column reading "POST_FULFILLMENT" were both on the
 * owner app's trips and shops registers. UX-00 section 12 asks for the trade's own word, and a
 * database identifier is not one.
 *
 * This is the FALLBACK, not the answer: an app gives a value its own `word.<value>` key when the
 * shop's word differs from the machine's ("POST_FULFILLMENT" is "Credit") or an initialism has to
 * stay upright ("UPI", "GRN"). What this guarantees is the floor — a value nobody has written a word
 * for yet still reaches the screen as words, so a status the backend adds tomorrow degrades into
 * "Partly settled" rather than `partly_settled`.
 */
export function humaniseValue(value: string): string {
  const spaced = value
    // `gstSalesRegister` -> `gst Sales Register`, before the case is flattened.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (spaced === '') return ''
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * One enum value in the reader's language: an app's `word.<value>` key when it has one, the
 * humanised identifier when it has not, and the em dash for nothing at all — so a register cell can
 * hand a nullable column straight to it.
 */
export function wordFor(translate: Translator, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return t('money.none')
  const key = `word.${value}`
  const found = translate(key)
  // `createTranslator` returns the key itself when no catalogue has an entry for it.
  return found === key ? humaniseValue(value) : found
}
