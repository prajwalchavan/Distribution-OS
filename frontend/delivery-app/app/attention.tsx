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
 *
 * EXCEPT ON MONEY (DOS-178; never-list #13). A refused doorstep payment gets neither button. "Send it
 * again" would replay the server's stored refusal (S-73) — the same answer, for ever — and "Throw it
 * away" would delete the only record anywhere that the shop paid: the phone's, because the office
 * refused it, and the books', because it never reached them. It gets one button instead, and it is not
 * destructive: the crew hands the money and the slip to the cashier, who records it at the office
 * against the same paper-book number. The card then moves to its own section and stays on the phone for
 * ever. Which refusals are money is `trayActions` reading `@dos/offline`'s money-table list — the TABLE,
 * never the rejection code, so it cannot drift as the server adds codes.
 *
 * "STAYS ON THIS PHONE" IS A CLAIM, AND THIS SCREEN OF ALL SCREENS HAS TO MEAN IT (DOS-179). The store
 * line at the top says whether the device keeps anything at all, so the hand-over dialog's own sentence
 * goes through `keepKey` like every button on D4 and D5 — otherwise the phone promised a keep eleven
 * lines under its own admission that it keeps nothing, over money it is the last record of.
 */
import { formatINR, paise } from '@dos/domain'
import { useNeedsAttention, useOutbox, useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Dialog,
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
import { useMemo, useState } from 'react'

import { instantWithClock } from '../src/lib/dates'
import { keepKey } from '../src/lib/keep'
import { useLocalRetailers } from '../src/lib/local'
import { trayActions, type TrayMoney } from '../src/lib/tray'

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
  /** The payment the crew is confirming they handed over; null while no dialog is open. */
  const [handing, setHanding] = useState<string | null>(null)

  const waiting = outbox.rows.filter((row) => row.status === 'queued' || row.status === 'sending')
  const word = (table: string): string => {
    const key = TABLE_WORDS[table]
    return key === undefined ? table : t(key)
  }

  const cards = useMemo(
    () => attention.items.map((entry) => ({ entry, card: trayActions(entry) })),
    [attention.items],
  )
  /* A payment already handed over is not work any more: it sits below, with the time, for ever. */
  const refused = cards.filter(({ card }) => card.handedOverAt === null)
  const handedOver = cards.filter(({ card }) => card.handedOverAt !== null)

  /** Whose money each card is: the shop is the one thing the rejection itself does not carry. */
  const shopIds = useMemo(
    () =>
      cards
        .map(({ entry }) => entry.op?.data?.retailer_id)
        .filter((id): id is string => typeof id === 'string'),
    [cards],
  )
  const shops = useLocalRetailers(shopIds)
  const shopName = (entry: (typeof cards)[number]['entry']): string => {
    const id = entry.op?.data?.retailer_id
    const found = typeof id === 'string' ? shops.byId.get(id) : undefined
    return found?.name ?? t('d.unknown')
  }

  /** "₹2,500 Cash from Alan Stores · book no 41 · 6:30 am" — the figures under the office's sentence. */
  const moneyLine = (money: TrayMoney, shop: string, when: string): string =>
    money.bookNo === null
      ? t('tray.moneyNoBook', {
          amount: formatINR(paise(money.amountPaise)),
          mode: wordFor(t, money.mode),
          shop,
          when,
        })
      : t('tray.money', {
          amount: formatINR(paise(money.amountPaise)),
          mode: wordFor(t, money.mode),
          shop,
          no: money.bookNo,
          when,
        })

  const handingEntry = cards.find(({ entry }) => entry.error.opId === handing)

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
            label={t('tray.rejectedCount', { count: refused.length })}
            family={refused.length === 0 ? 'neutral' : 'brick'}
            solid={refused.length > 0}
            figure
          />
          {handedOver.length === 0 ? null : (
            <StatusChip
              testID="tray-handed-count"
              label={t('tray.handedOverCount', { count: handedOver.length })}
              family="clay"
              figure
            />
          )}
        </Row>
      }
      testID="tray-screen"
    >
      <Stack gap={6}>
        {/* Nothing is claimed about keeping while the store is still opening (DOS-167 ruling 3 (ee)). */}
        {status.persistent === null ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="tray-store">
            {status.persistent ? t('tray.storeDisk') : t('tray.storeMemory')}
          </Txt>
        )}

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
          {refused.length === 0 ? (
            <EmptyState message={t('tray.rejectedEmpty')} testID="tray-rejected-empty" />
          ) : (
            <Stack gap={4}>
              {refused.map(({ entry, card }) => (
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
                  {card.money === null ? null : (
                    <Stack gap={1} testID={`tray-money-${entry.error.opId}`}>
                      <Txt field="bodyStrong" desk="cell">
                        {moneyLine(
                          card.money,
                          shopName(entry),
                          instantWithClock(entry.error.createdAt),
                        )}
                      </Txt>
                      <Txt field="body" desk="body" color={colors.text.secondary}>
                        {t(card.money.instruction)}
                      </Txt>
                    </Stack>
                  )}
                  <Row gap={8} wrap align="center">
                    {card.actions.includes('retry') ? (
                      <Button
                        label={t('tray.retry')}
                        variant="primary"
                        onPress={() => {
                          void outbox.retry(entry.error.opId)
                        }}
                        testID={`tray-retry-${entry.error.opId}`}
                      />
                    ) : card.notHeld === null ? null : (
                      /*
                       * The phone no longer holds this write — a reload emptied the web's memory store
                       * and the tray was refilled from the office — so "Send it again" would send
                       * nothing. Say so; "Throw it away" stays (DOS-056). WHICH sentence is the rule's,
                       * not this screen's: on money it is the one that points at the cashier, never the
                       * one that says throw this away (merge review, 2026-09-19).
                       */
                      <Txt
                        field="label"
                        desk="meta"
                        color={colors.text.secondary}
                        testID={`tray-not-held-${entry.error.opId}`}
                      >
                        {t(card.notHeld)}
                      </Txt>
                    )}
                    {card.actions.includes('handOver') ? (
                      <Button
                        label={t('tray.handedOver')}
                        variant="primary"
                        onPress={() => {
                          setHanding(entry.error.opId)
                        }}
                        testID={`tray-handover-${entry.error.opId}`}
                      />
                    ) : null}
                    {card.actions.includes('discard') ? (
                      <Button
                        label={t('tray.discard')}
                        variant="destructive"
                        onPress={() => {
                          void outbox.discard(entry.error.opId)
                        }}
                        testID={`tray-discard-${entry.error.opId}`}
                      />
                    ) : null}
                  </Row>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>

        {handedOver.length === 0 ? null : (
          <Stack gap={3}>
            <Txt field="title" desk="section" as="h2">
              {t('tray.handedOver')}
            </Txt>
            <Stack gap={4}>
              {handedOver.map(({ entry, card }) => (
                <Stack
                  key={entry.error.opId}
                  gap={2}
                  pad={4}
                  background="surface"
                  radius="md"
                  border="all"
                  testID={`tray-handed-${entry.error.opId}`}
                >
                  {card.money === null ? (
                    <Txt field="bodyStrong" desk="cell">
                      {entry.error.message}
                    </Txt>
                  ) : (
                    <Txt field="bodyStrong" desk="cell">
                      {moneyLine(
                        card.money,
                        shopName(entry),
                        instantWithClock(entry.error.createdAt),
                      )}
                    </Txt>
                  )}
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('tray.handedOverAt', {
                      when: instantWithClock(card.handedOverAt ?? entry.error.createdAt),
                    })}
                  </Txt>
                </Stack>
              ))}
            </Stack>
          </Stack>
        )}

        <Button
          testID="tray-close"
          label={t('d1.title')}
          variant="ghost"
          onPress={() => {
            router.push('/')
          }}
        />
      </Stack>

      {/* Exactly what is about to be recorded, in the figures the cashier will be handed (UX-00 §6.12). */}
      <Dialog
        open={handing !== null && handingEntry?.card.money !== undefined}
        onClose={() => {
          setHanding(null)
        }}
        title={t('tray.handedOver')}
        body={
          handingEntry?.card.money == null
            ? ''
            : handingEntry.card.money.bookNo === null
              ? t(keepKey('handOverBodyNoBook', status.persistent), {
                  amount: formatINR(paise(handingEntry.card.money.amountPaise)),
                  shop: shopName(handingEntry.entry),
                })
              : t(keepKey('handOverBody', status.persistent), {
                  amount: formatINR(paise(handingEntry.card.money.amountPaise)),
                  shop: shopName(handingEntry.entry),
                  no: handingEntry.card.money.bookNo,
                })
        }
        confirmLabel={t('tray.handedOver')}
        onConfirm={() => {
          const opId = handing
          setHanding(null)
          if (opId !== null) void outbox.handOver(opId)
        }}
        testID="tray-handover-dialog"
      />
    </Screen>
  )
}
