/**
 * S10 · Shops I am losing.
 *
 * `reporting.retailers.lapsed` is pre-scoped by the service: a salesperson gets its OWN beats and
 * nothing else, so there is no filter here to get wrong. `lapsedRisk` arrives computed — the row
 * derives nothing (UX-03 D6).
 *
 * Online only, and it says so: the risk is a rollup the phone does not hold. A rep who opens this in
 * a dead spot gets the sentence, not an empty list pretending nobody is being lost.
 */
import { useApi, useQuery } from '@dos/api-client/react'
import { Row, Screen, Stack, StatusChip, Txt, useColors, useGo, useStrings } from '@dos/ui'

import { shortInstant } from '../../../src/groups/sales/lib/dates'
import { useLocalState } from '../../../src/groups/sales/lib/local'
import { Async, PageTabs, TwoLine, countText, pagedCount } from '../../../src/groups/sales/lib/ui'

export default function Lapsed(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const go = useGo()
  const api = useApi()
  const local = useLocalState()

  const lapsed = useQuery(
    ['reporting', 'lapsed'],
    () => api.api.reporting.retailers.lapsed({ limit: 100 }),
    { staleTime: 300_000 },
  )
  const count = pagedCount(lapsed)

  return (
    <Screen
      title={t('s10.title')}
      chips={
        <StatusChip
          label={t('s10.count', { count: countText(count, t('s10.none')) })}
          family={(count.count ?? 0) === 0 ? 'neutral' : 'ochre'}
          figure
        />
      }
    >
      <Stack gap={4}>
        <PageTabs group={go.href('/shops')} active={go.href('/shops/lapsed')} />

        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {local.online ? t('s10.explain') : t('s0.needsSignal')}
        </Txt>

        <Async
          state={[lapsed]}
          rows={6}
          empty={(lapsed.data?.items.length ?? 0) === 0}
          emptyMessage={t('s10.empty')}
        >
          <Stack testID="lapsed-list">
            {(lapsed.data?.items ?? []).map((shop) => (
              <TwoLine
                key={shop.retailerId}
                primary={shop.retailerName}
                secondary={[
                  shop.beatName,
                  shop.lastOrderAt === null
                    ? t('s10.neverOrdered')
                    : t('s10.lastOrder', { when: shortInstant(shop.lastOrderAt) }),
                  t('s10.ordersLast30', { count: shop.ordersLast30 }),
                ]
                  .filter((part) => part !== null && part !== '')
                  .join(' · ')}
                trailing={
                  <Row gap={2} align="center">
                    <StatusChip
                      label={t('s10.risk', { pct: shop.lapsedRisk })}
                      family={
                        shop.lapsedRisk >= 70
                          ? 'brick'
                          : shop.lapsedRisk >= 40
                            ? 'ochre'
                            : 'neutral'
                      }
                      solid={shop.lapsedRisk >= 70}
                      figure
                    />
                  </Row>
                }
                onPress={() => {
                  go.push(`/shops/${shop.retailerId}`)
                }}
              />
            ))}
          </Stack>
        </Async>
      </Stack>
    </Screen>
  )
}
