/**
 * R9 + R10 — the offers this shop qualifies for, said in words, and the answers to the rates it has
 * asked for (docs/23 §6.1 R9 and R10).
 *
 * BOTH OF THESE WERE MISMATCHES IN docs/23 AND ARE NOT ANY MORE. `pricing.schemes.list` and
 * `pricing.bargains.list` are ANY_MEMBER in `permissions.ts` today, and the handlers narrow: the shop
 * gets the PUBLIC scheme shape — the economics that price an order, never the funding source, never
 * whether the distributor can claim it back from the brand — and only the schemes whose
 * `applicability` (tier, retailer, beat) actually includes this shop.
 *
 * WHAT A SCHEME MEANS is `offerSentence()`; what it DID to a particular order is on the order screen,
 * from `pricing.quote`. Those are two different questions and this screen answers only the first.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  Group,
  ListRow,
  Screen,
  Stack,
  StatusChip,
  Txt,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'

import { instantWithClock, longDate, today } from '../src/lib/dates'
import { offerSentence, runningToday, scopeSentence, slabSentence } from '../src/lib/offer'
import { useItemNames, useMyShop } from '../src/lib/shop'
import { Async, Panel } from '../src/lib/ui'
import { useWord } from '../src/lib/words'

export default function Deals(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null
  const my = useMyShop()
  const names = useItemNames()
  const on = today()

  const schemes = useQuery(
    ['schemes', on],
    () => api.api.pricing.schemes.list({ activeOnly: true, on, limit: 100 }),
    { enabled: signedIn, staleTime: 300_000 },
  )
  const brands = useQuery(['brands'], () => api.api.catalog.manufacturers(), {
    enabled: signedIn,
    staleTime: 600_000,
  })
  const bargains = useQuery(
    ['bargains', my.retailerId],
    () => api.api.pricing.bargains.list({ retailerId: my.retailerId ?? '', limit: 50 }),
    { enabled: signedIn && my.retailerId !== null },
  )

  /** brandId → brand name, so "On Balaji" reads as a brand rather than a uuid. */
  const brandName = (id: string | null): string | undefined => {
    if (id === null) return undefined
    for (const manufacturer of brands.data?.items ?? [])
      for (const brand of manufacturer.brands) if (brand.id === id) return brand.name
    return undefined
  }

  const running = (schemes.data?.items ?? []).filter((scheme) => runningToday(scheme, on))
  /*
   * NEWEST FIRST, AND THE ITEM NAMED.
   *
   * `bargains.list` pages by id and the rows carry a `variantId`, so the first draft of this panel
   * printed fifty rows that all read "They agreed ₹13.85" in no particular order — a shop could not
   * tell which product any of them was about. The item's own name is the identity of the row.
   */
  const asks = [...(bargains.data?.items ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )

  return (
    <Screen title={t('r9.title')} context={session?.tenant.displayName} testID="r9-screen">
      <Stack gap={6}>
        <Panel title={t('r9.running')} testID="r9-schemes">
          <Async
            state={[schemes]}
            rows={4}
            empty={running.length === 0}
            emptyMessage={t('r9.none')}
          >
            <Stack gap={4}>
              {running.map((scheme) => {
                const slabs = slabSentence(t, scheme)
                return (
                  <Stack
                    key={scheme.id}
                    gap={2}
                    padY={3}
                    border="bottom"
                    borderTone="faint"
                    testID={`r9-scheme-${scheme.id}`}
                  >
                    <Txt field="bodyStrong" desk="cell">
                      {scheme.name}
                    </Txt>
                    <Txt field="body" desk="body">
                      {offerSentence(t, scheme, names.nameOf(scheme.freeVariantId ?? ''))}
                    </Txt>
                    {slabs === null ? null : (
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {slabs}
                      </Txt>
                    )}
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {`${scopeSentence(t, scheme, brandName(scheme.brandId))} · ${t('r9.until', {
                        date: longDate(scheme.validTo),
                      })}`}
                    </Txt>
                    {scheme.final ? <StatusChip label={t('r9.finalNote')} family="ochre" /> : null}
                  </Stack>
                )
              })}
            </Stack>
          </Async>
        </Panel>

        <Panel title={t('r9.requests')} testID="r9-bargains">
          <Async
            state={[bargains]}
            rows={3}
            empty={asks.length === 0}
            emptyMessage={t('r9.noRequests')}
          >
            <Group>
              {asks.map((ask) => (
                <ListRow
                  key={ask.id}
                  primary={names.nameOf(ask.variantId) ?? t('r8.itemUnknown')}
                  secondary={`${
                    ask.approvedRatePaise === null
                      ? t('r9.asked', { rate: formatMoney(ask.askedRatePaise) })
                      : t('r9.gotRate', { rate: formatMoney(ask.approvedRatePaise) })
                  } · ${
                    ask.expiresAt === null
                      ? instantWithClock(ask.createdAt)
                      : `${instantWithClock(ask.createdAt)} · ${t('r9.expires', {
                          when: instantWithClock(ask.expiresAt),
                        })}`
                  }`}
                  trailing={
                    <StatusChip
                      label={word(ask.status)}
                      family={
                        ask.status === 'approved' || ask.status === 'auto_approved'
                          ? 'moss'
                          : ask.status === 'rejected' || ask.status === 'expired'
                            ? 'brick'
                            : 'ochre'
                      }
                    />
                  }
                  trailingMoney={ask.approvedRatePaise ?? ask.askedRatePaise}
                  testID={`r9-bargain-${ask.id}`}
                />
              ))}
            </Group>
          </Async>
        </Panel>
      </Stack>
    </Screen>
  )
}
