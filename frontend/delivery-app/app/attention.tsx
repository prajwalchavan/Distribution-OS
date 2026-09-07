/**
 * D10 — Needs attention: what is still on this phone, and what the office could not accept.
 *
 * `sync.upload` never answers 4xx (ADR 0007): a rejection is a 2xx plus a `sync_errors` row, so one
 * impossible write can never wedge a day's deliveries and receipts behind it. That design only pays
 * off if the rejection becomes a piece of WORK for a person, which is this screen — readable with no
 * network, because the engine mirrors the errors into the device's own tables.
 *
 * Two lists, and they are different things. **Waiting to send** is the outbox: the delivery is on the
 * phone, nothing is wrong, it goes the moment there is a signal. **The office could not accept these**
 * is a refusal with a reason in the trade's own words ("trip TRIP-0031 is settled; money is collected
 * while the trip is out"), and the crew decides: send it again now the trip has moved, or throw the
 * write away.
 */
import { useNeedsAttention, useOutbox, useSyncStatus } from '@dos/offline/react'
import {
  Button,
  EmptyState,
  Group,
  ListRow,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  wordFor,
} from '@dos/ui'
import { useRouter } from 'expo-router'

import { instantWithClock } from '../src/lib/dates'

/** The three tables this app may push, in the words a driver uses for them. */
const TABLE_WORDS: Readonly<Record<string, string>> = {
  trip_stops: 'd3.title',
  deliveries: 'd4.title',
  receipts: 'd5.title',
}

export default function NeedsAttention(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const outbox = useOutbox()
  const attention = useNeedsAttention()
  const status = useSyncStatus()

  const waiting = outbox.rows.filter((row) => row.status === 'queued' || row.status === 'sending')
  const word = (table: string): string => {
    const key = TABLE_WORDS[table]
    return key === undefined ? table : t(key)
  }

  return (
    <Screen
      title={t('tray.title')}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            testID="tray-waiting-count"
            label={t('tray.waitingCount', { count: waiting.length })}
            family={waiting.length === 0 ? 'neutral' : 'ochre'}
            figure
          />
          <StatusChip
            testID="tray-rejected-count"
            label={t('tray.rejectedCount', { count: attention.items.length })}
            family={attention.items.length === 0 ? 'neutral' : 'brick'}
            solid={attention.items.length > 0}
            figure
          />
        </Row>
      }
      testID="tray-screen"
    >
      <Stack gap={6}>
        <Txt field="label" desk="meta" color={colors.text.secondary} testID="tray-store">
          {status.persistent ? t('tray.storeDisk') : t('tray.storeMemory')}
        </Txt>

        <Stack gap={3}>
          <Txt field="title" desk="section" as="h2">
            {t('tray.waiting')}
          </Txt>
          {waiting.length === 0 ? (
            <EmptyState message={t('tray.waitingEmpty')} testID="tray-waiting-empty" />
          ) : (
            <Group>
              {waiting.map((row) => (
                <ListRow
                  key={row.opId}
                  testID={`tray-waiting-${row.opId}`}
                  primary={word(row.table)}
                  secondary={instantWithClock(row.createdAt)}
                  trailing={
                    <StatusChip
                      label={wordFor(t, row.status)}
                      family={row.status === 'sending' ? 'clay' : 'ochre'}
                    />
                  }
                />
              ))}
            </Group>
          )}
        </Stack>

        <Stack gap={3}>
          <Txt field="title" desk="section" as="h2">
            {t('tray.rejected')}
          </Txt>
          {attention.items.length === 0 ? (
            <EmptyState message={t('tray.rejectedEmpty')} testID="tray-rejected-empty" />
          ) : (
            <Stack gap={4}>
              {attention.items.map((entry) => (
                <Stack
                  key={entry.error.opId}
                  gap={3}
                  pad={4}
                  background="surface"
                  radius="md"
                  border="all"
                  borderTone="strong"
                  testID={`tray-rejected-${entry.error.opId}`}
                >
                  <Txt field="bodyStrong" desk="cell">
                    {entry.error.message}
                  </Txt>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {`${word(entry.error.table)} · ${entry.error.code} · ${instantWithClock(
                      entry.error.createdAt,
                    )}`}
                  </Txt>
                  <Row gap={8} wrap>
                    <Button
                      label={t('tray.retry')}
                      variant="primary"
                      onPress={() => {
                        void outbox.retry(entry.error.opId)
                      }}
                      testID={`tray-retry-${entry.error.opId}`}
                    />
                    <Button
                      label={t('tray.discard')}
                      variant="destructive"
                      onPress={() => {
                        void outbox.discard(entry.error.opId)
                      }}
                      testID={`tray-discard-${entry.error.opId}`}
                    />
                  </Row>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>

        <Button
          testID="tray-close"
          label={t('d1.title')}
          variant="ghost"
          onPress={() => {
            router.push('/')
          }}
        />
      </Stack>
    </Screen>
  )
}
