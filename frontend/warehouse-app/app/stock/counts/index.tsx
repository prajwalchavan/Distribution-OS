/**
 * W8 (cycle counts) — the physical counts the godown opens and works (docs/23 §4.1, §8.18).
 *
 * `inventory.cycleCounts.open` and `.count` are STOCK_KEEPERS: the floor freezes the expected pieces
 * per lot and counts them. `.post` is BACK_OFFICE — the differences become `cycle_count` ledger rows,
 * which is a decision about stock value, and a decision about stock value is not the floor's. So the
 * count is opened, walked and saved here, and the last line on this screen says whose step is next.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { newId } from '@dos/api-client'
import { haptics } from '@dos/ui/platform'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { shortDate } from '../../../src/lib/dates'
import { Async, DeskOnly, PageTabs, Panel, pl, workFamily } from '../../../src/lib/ui'

export default function CycleCounts(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null

  const [locationId, setLocationId] = useState<string | null>(null)

  const locations = useQuery(
    ['locations', 'all'],
    () => api.api.inventory.locations.list({ activeOnly: true }),
    { enabled: signedIn },
  )
  const counts = useQuery(
    ['cycleCounts', 'all'],
    () => api.api.inventory.cycleCounts.list({ limit: 30 }),
    { enabled: signedIn },
  )

  const open = useMutation(
    (input: { locationId: string }, meta) =>
      api.api.inventory.cycleCounts.open({
        id: newId(),
        idempotencyKey: meta.idempotencyKey,
        locationId: input.locationId,
      }),
    {
      invalidates: [['cycleCounts']],
      onSuccess: (result) => {
        haptics.success()
        router.push(`/stock/counts/${result.item.id}`)
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const names = new Map((locations.data?.items ?? []).map((one) => [one.id, one.name]))

  return (
    <Screen
      title={t('w8c.title')}
      context={session?.tenant.displayName}
      testID="w8c-screen"
      bottomBar={
        locationId === null ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {names.get(locationId) ?? ''}
            </Txt>
            <Button
              label={t('w8c.open')}
              variant="primary"
              loading={open.status === 'pending'}
              onPress={() => {
                open.mutate({ locationId })
              }}
              testID="w8c-open"
            />
          </Row>
        )
      }
    >
      <Stack gap={6}>
        <PageTabs group="/" active="/stock/counts" />

        <Panel title={t('w.location')} testID="w8c-locations">
          <Async state={locations} empty={(locations.data?.items.length ?? 0) === 0}>
            <Group>
              {(locations.data?.items ?? []).map((location) => (
                <ListRow
                  key={location.id}
                  testID={`w8c-location-${location.id}`}
                  primary={location.name}
                  secondary={location.kind}
                  state={location.id === locationId ? 'selected' : 'default'}
                  onPress={() => {
                    setLocationId(location.id === locationId ? null : location.id)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        <Panel title={t('w8c.counts')} testID="w8c-counts">
          <Async
            state={counts}
            empty={(counts.data?.items.length ?? 0) === 0}
            emptyMessage={t('w8c.countsEmpty')}
          >
            <Group>
              {(counts.data?.items ?? []).map((count) => (
                <ListRow
                  key={count.id}
                  testID={`w8c-count-${count.id}`}
                  primary={names.get(count.locationId) ?? count.locationId.slice(0, 8)}
                  secondary={`${pl(t, 'w.lotsN', count.lineCount)} · ${shortDate(
                    count.createdAt.slice(0, 10),
                  )}`}
                  trailing={<StatusChip label={count.status} family={workFamily(count.status)} />}
                  {...(count.note === null ? {} : { reason: count.note })}
                  onPress={() => {
                    router.push(`/stock/counts/${count.id}`)
                  }}
                />
              ))}
            </Group>
          </Async>
        </Panel>

        {open.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {open.error.message}
          </Txt>
        )}

        <DeskOnly>{t('w8c.postIsDesk')}</DeskOnly>
      </Stack>
    </Screen>
  )
}
