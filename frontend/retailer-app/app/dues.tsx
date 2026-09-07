/**
 * R3 — the pending-bills file, the way a shopkeeper keeps it: one row per open bill, oldest first,
 * with the age said in words and a UPI QR one tap away (docs/23 §6.1 R3).
 *
 * EVERY FIGURE IS THE SERVER'S. `receivables.outstanding.get` answers the summary, the ageing
 * buckets and the open bills with `openPaise` and `ageDays` already computed against IST today —
 * this screen adds nothing up. A shop and its distributor reading two different totals for the same
 * dues is the argument this product exists to end.
 *
 * THE QR IS RECOMPUTED, NOT PRINTED. `billing.invoices.upiQr` answers the amount STILL due now, not
 * the snapshot printed on the paper bill, so a part-paid bill never asks for the whole amount again.
 */
import { useApi, useQuery, useSession } from '@dos/api-client/react'
import {
  AgeingBuckets,
  Button,
  Group,
  KpiStrip,
  Money,
  Pressable,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import { longDate, shortDate } from '../src/lib/dates'
import { useMyShop } from '../src/lib/shop'
import { Async, PageTabs, Panel, TwoLine } from '../src/lib/ui'

export default function Dues(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const my = useMyShop()
  const retailerId = my.retailerId

  const [qrBillId, setQrBillId] = useState<string | null>(null)

  const dues = useQuery(
    ['outstanding', retailerId, 'bills'],
    () => api.api.receivables.outstanding.get({ retailerId: retailerId ?? '', includeBills: true }),
    { enabled: signedIn && retailerId !== null },
  )
  const qr = useQuery(
    ['upi-qr', qrBillId],
    () => api.api.billing.invoices.upiQr({ id: qrBillId ?? '' }),
    { enabled: signedIn && qrBillId !== null },
  )

  const summary = dues.data
  /** Oldest first: the order a shopkeeper settles in, and the order the allocation engine uses. */
  const bills = [...(summary?.bills ?? [])].sort((a, b) => b.ageDays - a.ageDays)

  const ageWord = (ageDays: number): string =>
    ageDays > 0
      ? t('r3.overdueBy', { days: String(ageDays) })
      : ageDays === 0
        ? t('r3.dueToday')
        : t('r3.dueIn', { days: String(-ageDays) })

  return (
    <Screen
      title={t('r3.title')}
      context={distributor}
      testID="r3-screen"
      bottomBar={
        <Row gap={4} justify="between" align="center" wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('r3.outstanding')}
            </Txt>
            <Money value={summary?.outstandingPaise ?? null} size="moneyL" />
          </Stack>
          <Button
            label={t('r3.payAll')}
            variant="primary"
            disabled={(summary?.outstandingPaise ?? 0) <= 0}
            {...((summary?.outstandingPaise ?? 0) <= 0
              ? {
                  /*
                   * "Nothing is pending. You are clear." IS A CLAIM ABOUT MONEY, and with no answer
                   * from the distributor the app has no figure to make it with: `summary` is
                   * undefined, `?? 0` reads as zero, and a shop owing ₹1,901 was told on the bottom
                   * bar that it was clear. The reason a button is disabled must be the real reason.
                   */
                  disabledReason: summary === undefined ? t('app.noConnection') : t('r3.noBills'),
                }
              : {})}
            onPress={() => {
              router.push('/pay')
            }}
            testID="r3-pay-all"
          />
        </Row>
      }
    >
      <Stack gap={6}>
        <PageTabs group="/dues" active="/dues" />
        <Async state={[my, dues]} rows={5}>
          {my.unlinked ? (
            <Txt field="body" desk="body" testID="r3-unlinked">
              {t('r2.noShopBody', { name: distributor })}
            </Txt>
          ) : (
            <Stack gap={6}>
              <KpiStrip
                testID="r3-kpis"
                items={[
                  {
                    label: t('r3.outstanding'),
                    value: <Money value={summary?.outstandingPaise ?? null} size="cell" />,
                  },
                  {
                    label: t('r3.overdue'),
                    value: <Money value={summary?.overduePaise ?? null} size="cell" />,
                    tone: (summary?.overduePaise ?? 0) > 0 ? 'critical' : 'neutral',
                  },
                  {
                    label: t('r3.credit'),
                    value: <Money value={summary?.unallocatedCreditPaise ?? null} size="cell" />,
                    tone: 'positive',
                  },
                  {
                    label: t('r3.oldest'),
                    value: shortDate(summary?.oldestDueDate ?? null),
                  },
                ]}
              />

              <Panel testID="r3-ageing">
                <AgeingBuckets
                  testID="r3-ageing-ladder"
                  buckets={{
                    '0-7': summary?.buckets.b0_7 ?? 0,
                    '8-15': summary?.buckets.b8_15 ?? 0,
                    '16-30': summary?.buckets.b16_30 ?? 0,
                    '31-60': summary?.buckets.b31_60 ?? 0,
                    '61-90': summary?.buckets.b61_90 ?? 0,
                    '90+': summary?.buckets.b90plus ?? 0,
                  }}
                />
              </Panel>

              <Panel title={t('r3.bills')} testID="r3-bills">
                <Async
                  state={[dues]}
                  rows={4}
                  empty={bills.length === 0}
                  emptyMessage={t('r3.noBills')}
                >
                  <Group>
                    {bills.map((bill) => (
                      <Stack key={bill.id} gap={2} padY={2} border="bottom" borderTone="faint">
                        <Pressable
                          role="row"
                          label={bill.invoiceNo ?? ''}
                          onPress={() => {
                            router.push(`/bills/${bill.id}`)
                          }}
                          testID={`r3-bill-${bill.id}`}
                        >
                          <TwoLine
                            primary={bill.invoiceNo ?? '—'}
                            secondary={`${t('r3.due', {
                              date: longDate(bill.dueDate),
                            })} · ${ageWord(bill.ageDays)}`}
                            trailing={
                              <Stack gap={1} align="end">
                                <Money value={bill.openPaise} size="moneyM" />
                                <StatusChip
                                  label={t('r3.openOf', {
                                    open: formatMoney(bill.openPaise),
                                    total: formatMoney(bill.totalPaise),
                                  })}
                                  family={bill.ageDays > 0 ? 'brick' : 'ochre'}
                                  figure
                                />
                              </Stack>
                            }
                          />
                        </Pressable>
                        {bill.cashDiscountUntil === null || bill.cashDiscountBps === 0 ? null : (
                          <Txt field="label" desk="meta" color={colors.status.moss.fg}>
                            {t('r3.cashDiscount', {
                              date: longDate(bill.cashDiscountUntil),
                              amount: formatMoney(
                                Math.round((bill.openPaise * bill.cashDiscountBps) / 10_000),
                              ),
                            })}
                          </Txt>
                        )}
                        <Row justify="end">
                          <Button
                            label={t('r3.payBill')}
                            variant="ghost"
                            onPress={() => {
                              setQrBillId(bill.id)
                            }}
                            testID={`r3-qr-${bill.id}`}
                          />
                        </Row>
                      </Stack>
                    ))}
                  </Group>
                </Async>
              </Panel>
            </Stack>
          )}
        </Async>
      </Stack>

      {/* The QR itself is the distributor's UPI intent string. The kit draws no QR image — a phone's
          own UPI app takes the intent link, and the payload is shown so it can be scanned or copied
          from a second device. `payeeName` is the distributor's, never ours (docs/23 §6.5). */}
      <Sheet
        open={qrBillId !== null}
        onClose={() => {
          setQrBillId(null)
        }}
        title={t('r3.qr')}
        testID="r3-qr-sheet"
      >
        <Async state={[qr]} rows={3}>
          <Stack gap={4}>
            {qr.data?.payload === null || qr.data === undefined ? (
              <Txt field="body" desk="body">
                {t('r3.qrNone', { name: distributor })}
              </Txt>
            ) : (
              <Stack gap={3}>
                <Txt field="body" desk="body">
                  {t('r3.qrBody', { name: qr.data.payeeName })}
                </Txt>
                <Money value={qr.data.amountPaise} size="hero" />
                <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                  {qr.data.payload}
                </Txt>
                <Button
                  label={t('r5.start')}
                  variant="primary"
                  onPress={() => {
                    setQrBillId(null)
                    router.push('/pay')
                  }}
                  fullWidth
                  testID="r3-qr-pay"
                />
              </Stack>
            )}
          </Stack>
        </Async>
      </Sheet>
    </Screen>
  )
}
