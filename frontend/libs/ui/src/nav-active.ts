/**
 * Which navigation item is lit for the route the person is on.
 *
 * One rule, in one file, because the rail (UX-00 §8.1) and the phone tab bar (§8.2) are two
 * renderings of the same answer and the two shells used to carry a copy each.
 *
 * A section lights on itself and on anything below it: `/orders` is lit for `/orders/abc`. The HOME
 * is the exception — it is a prefix of everything, so it lights only when it is exactly where the
 * person is. Today's apps spell that home `'/'`; the one app gives every group a segment of its own
 * (`/owner`, `/delivery` — docs/31 §1.1, ruling Q1), so the home is a parameter rather than a
 * literal and the group layout passes its own base. The default is `'/'`, which is byte-for-byte the
 * behaviour the console and the template have today.
 *
 * `/orders` never lights for `/orders-archive`: the descendant test is on the separator, not on the
 * characters.
 */

/** A path with no trailing slash, so `/owner/` and `/owner` are the same place. The root stays `/`. */
function normalise(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path
}

export function isActive(activeHref: string, href: string, homeHref = '/'): boolean {
  const here = normalise(activeHref)
  const target = normalise(href)
  if (target === normalise(homeHref)) return here === target
  return here === target || here.startsWith(`${target}/`)
}
