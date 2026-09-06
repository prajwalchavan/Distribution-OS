/**
 * S5 · Needs attention — the writes the office refused, and the ones still on their way.
 *
 * `sync.upload` never answers 4xx (ADR 0007): a rejection is a 2xx plus a `sync_errors` row, so a
 * device is never wedged by one bad line. That design only pays off if the rejection becomes a piece
 * of WORK for a person, which is this screen — readable with no network, because the engine mirrors
 * the errors locally.
 *
 * Two lists, and they are different things. **Waiting to send** is the outbox: the order is on the
 * phone, nothing is wrong, it goes as soon as there is signal. **Needs you** is a refusal with a
 * reason in the trade's own words ("This retailer is over its credit limit"), and the rep decides:
 * try again after the office has moved, or throw the write away.
 */
import { useNeedsAttention, useOutbox } from '@dos/offline/react'
import {
  Button,
  EmptyState,
  Group,
  ListRow,
  Row,
  Screen,
  Skeleton,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'

import { instantWithClock } from '../../src/lib/dates'
import { useLocalState, useOrder, useShop } from '../../src/lib/local'
import { PageTabs, Panel } from '../../src/lib/ui'

export default function NeedsAttention(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const outbox = useOutbox()
  const attention = useNeedsAttention()
  const local = useLocalState()

  const waiting = outbox.rows.filter((row) => row.status === 'queued' || row.status === 'sending')

  return (
    <Screen
      title={t('s5.trayTitle')}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            label={t('s5.waitingCount', { count: waiting.length })}
            family={waiting.length === 0 ? 'neutral' : 'ochre'}
            figure
          />
          <StatusChip
            label={t('s5.rejectedCount', { count: attention.items.length })}
            family={attention.items.length === 0 ? 'neutral' : 'brick'}
            solid={attention.items.length > 0}
            figure
          />
        </Row>
      }
    >
      <Stack gap={5}>
        <PageTabs group="/orders" active="/orders/attention" />

        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {local.online ? t('s5.trayOnline') : t('s5.trayOffline')}
        </Txt>

        <Panel title={t('s5.needsYou')} meta={t('s5.needsYouMeta')}>
          {attention.loading ? (
            <Skeleton rows={2} />
          ) : attention.items.length === 0 ? (
            <EmptyState message={t('s5.nothingRejected')} />
          ) : (
            <Stack gap={4} testID="tray-rejected">
              {attention.items.map((item) => (
                <Group key={item.error.opId}>
                  <ListRow
                    primary={item.error.message}
                    secondary={`${item.error.table} · ${instantWithClock(item.error.createdAt)}`}
                    state="needsAttention"
                    reason={item.error.code}
                    trailing={<StatusChip label={t('s5.rejected')} family="brick" solid />}
                  />
                  <Row gap={2} padX={3} padY={2} wrap>
                    <Button
                      label={t('s5.tryAgain')}
                      variant="secondary"
                      onPress={() => {
                        void outbox.retry(item.error.opId)
                      }}
                    />
                    <Button
                      label={t('s5.discard')}
                      variant="ghost"
                      onPress={() => {
                        void outbox.discard(item.error.opId)
                      }}
                    />
                    {item.error.table === 'sales_orders' ? (
                      <Button
                        label={t('s5.openOrder')}
                        variant="ghost"
                        onPress={() => {
                          router.push(`/orders/${item.error.rowId}`)
                        }}
                      />
                    ) : null}
                  </Row>
                </Group>
              ))}
            </Stack>
          )}
        </Panel>

        <Panel title={t('s5.waitingToSend')} meta={t('s5.waitingMeta')}>
          {waiting.length === 0 ? (
            <EmptyState message={t('s5.nothingWaiting')} />
          ) : (
            <Group>
              {waiting.map((row) => (
                <WaitingRow
                  key={row.opId}
                  table={row.table}
                  rowId={row.rowId}
                  attempts={row.attempts}
                  createdAt={row.createdAt}
                />
              ))}
            </Group>
          )}
        </Panel>
      </Stack>
    </Screen>
  )
}

/**
 * One queued write, named the way a rep would name it.
 *
 * "PUT sales_orders 01a0…" is what the harness prints; a rep needs the shop. The order the header
 * belongs to is already on the phone (the engine wrote the row locally the moment it was queued), so
 * naming the shop costs nothing and needs no network.
 */
function WaitingRow({
  table,
  rowId,
  attempts,
  createdAt,
}: {
  table: string
  rowId: string
  attempts: number
  createdAt: string
}): React.JSX.Element {
  const t = useStrings()
  const order = useOrder(table === 'sales_orders' ? rowId : null)
  const shop = useShop(order?.retailer_id ?? null)
  return (
    <ListRow
      primary={table === 'sales_orders' ? (shop?.name ?? t('s5.queuedOrder')) : t('s5.queuedLine')}
      secondary={`${table === 'sales_orders' ? t('s5.queuedOrder') : rowId.slice(0, 8)} \u00b7 ${instantWithClock(createdAt)}`}
      state="waiting"
      trailing={
        <StatusChip
          label={attempts === 0 ? t('s5.notTriedYet') : t('s5.attempts', { count: attempts })}
          family="ochre"
        />
      }
    />
  )
}
