import { and, eq, inArray } from 'drizzle-orm'
import { retailerLinks, retailers, type Db } from '@dos/db'
import { currentTenant } from '../../platform/index.js'

/**
 * How a shop may be reached (docs/plans/00-coordination.md §3.9 and §4: notifications → retailers,
 * `contactPreferences`). The one read the notifications module makes of this module: the phone of
 * record, the opt-in and the language live on `retailers` and `retailer_links`, and the global
 * `retailer_identities.phone` is never consulted — a message must not reveal which other distributors
 * share this shopkeeper (DPDP, notifications §4.16).
 *
 * The link that speaks for the shop is its `owner`-role link: `active` first; when the only owner link
 * is `blocked` the shop has OPTED OUT of this distributor and nothing is ever sent. A shop with no link
 * at all is still reachable — by SMS, to the phone the distributor holds for it — because a bill or a
 * receipt for its own purchases is not marketing (docs/17 A6: WhatsApp needs opt-in; SMS is the
 * fallback, never a silent drop).
 *
 * Plain, transaction-scoped functions so the worker's outbox handlers use them without Nest DI
 * (coordination §3.9); `RetailersService.contactPreferences` delegates here.
 */
export interface ContactPreferences {
  retailerId: string
  name: string
  active: boolean
  /** `retailers.phone` of THIS tenant — blank in the row reads as null (nothing to send to). */
  phone: string | null
  /** Free text on the link (`mr`, `hi`, `en`, `mr-IN` …); the caller normalises it. */
  preferredLang: string | null
  whatsappOptinAt: Date | null
  /** DPDP consent recorded on the link (per distributor); null when no link or never recorded. */
  consentedAt: Date | null
  /** The shop's owner-role link is `blocked`: the shop has opted out of this distributor. */
  optedOut: boolean
  /** The login behind the owner-role link, when it has claimed one — the in-app inbox destination. */
  userId: string | null
}

export async function contactPreferences(
  tx: Db,
  retailerId: string,
): Promise<ContactPreferences | null> {
  const found = await contactPreferencesFor(tx, [retailerId])
  return found.get(retailerId) ?? null
}

/**
 * The same, for a bounded set at once (a broadcast's ≤ 500 shops): two indexed queries, never one per
 * shop. A shop that is not this tenant's (RLS) is simply absent from the map.
 */
export async function contactPreferencesFor(
  tx: Db,
  retailerIds: readonly string[],
): Promise<Map<string, ContactPreferences>> {
  const unique = [...new Set(retailerIds)]
  if (unique.length === 0) return new Map()
  const { tenantId } = currentTenant()
  const shops = await tx
    .select({
      id: retailers.id,
      name: retailers.name,
      phone: retailers.phone,
      active: retailers.active,
    })
    .from(retailers)
    .where(and(eq(retailers.tenantId, tenantId), inArray(retailers.id, unique)))
  if (shops.length === 0) return new Map()
  const links = await tx
    .select({
      retailerId: retailerLinks.retailerId,
      userId: retailerLinks.userId,
      status: retailerLinks.status,
      preferredLang: retailerLinks.preferredLang,
      consentedAt: retailerLinks.consentedAt,
      whatsappOptinAt: retailerLinks.whatsappOptinAt,
    })
    .from(retailerLinks)
    .where(
      and(
        eq(retailerLinks.tenantId, tenantId),
        eq(retailerLinks.role, 'owner'),
        inArray(
          retailerLinks.retailerId,
          shops.map((s) => s.id),
        ),
      ),
    )
  const out = new Map<string, ContactPreferences>()
  for (const shop of shops) {
    const own = links.filter((l) => l.retailerId === shop.id)
    // Several active owner links can exist for one shop (a re-linked identity, an import): the one
    // that has claimed a login speaks for the shop, then the one that opted in, then any.
    const actives = own.filter((l) => l.status === 'active')
    const active =
      actives.find((l) => l.userId !== null) ??
      actives.find((l) => l.whatsappOptinAt !== null) ??
      actives[0] ??
      null
    const blocked = active === null && own.some((l) => l.status === 'blocked')
    const phone = shop.phone.trim()
    out.set(shop.id, {
      retailerId: shop.id,
      name: shop.name,
      active: shop.active,
      phone: phone.length > 0 ? phone : null,
      preferredLang: active?.preferredLang ?? null,
      whatsappOptinAt: active?.whatsappOptinAt ?? null,
      consentedAt: active?.consentedAt ?? null,
      optedOut: blocked,
      userId: active?.userId ?? null,
    })
  }
  return out
}
