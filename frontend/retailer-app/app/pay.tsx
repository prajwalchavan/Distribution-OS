/**
 * R5 — pay online (docs/23 §6.1 R5). `receivables.payments.initiate` is SHOPKEEPER_ONLY: this is the
 * one write in the product that only a shop can make.
 *
 * WHAT IT IS AND WHAT IT IS NOT. It mints a UPI intent against this shop's own dues and answers the
 * payee's VPA, the DISTRIBUTOR's own display name (never ours, docs/23 §6.5) and a `paymentRef` the
 * shop quotes and the distributor's desk matches the UTR against. It does NOT move money and does
 * not mark a bill paid: the gateway callback is a later slice, so the screen says plainly that the
 * amount shows against the bills once the distributor has matched it. Promising more here would be
 * the app telling a shopkeeper their bill is settled when nobody has been paid.
 *
 * Choosing bills is optional by design: an empty choice means "against my dues, oldest first", which
 * is the same allocation rule the desk uses, so the two never disagree.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  Money,
  RupeeInput,
  Row,
  Screen,
  Stack,
  StatusChip,
  Txt,
  formatMoney,
  useColors,
  useStrings,
} from '@dos/ui'
import { links } from '@dos/ui/platform'
import { useState } from 'react'

import { instantWithClock, longDate } from '../src/lib/dates'
import { useMyShop } from '../src/lib/shop'
import { Async, Panel } from '../src/lib/ui'

export default function Pay(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const { session } = useSession()
  const signedIn = session !== null
  const distributor = session?.tenant.displayName ?? ''
  const my = useMyShop()
  const retailerId = my.retailerId

  const [amount, setAmount] = useState<number | null>(null)
  const [chosen, setChosen] = useState<readonly string[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  /**
   * `links.open` answers false when no app on the phone takes a `upi://` link, and the tap would otherwise
   * do nothing at all. A browser cannot tell, so on the web this never shows.
   */
  const [noUpiApp, setNoUpiApp] = useState(false)

  const dues = useQuery(
    ['outstanding', retailerId, 'bills'],
    () => api.api.receivables.outstanding.get({ retailerId: retailerId ?? '', includeBills: true }),
    { enabled: signedIn && retailerId !== null },
  )
  const bills = [...(dues.data?.bills ?? [])].sort((a, b) => b.ageDays - a.ageDays)
  const owed = dues.data?.outstandingPaise ?? 0

  const initiate = useMutation(
    (input: { amountPaise: number | null; invoiceIds: readonly string[] }, meta) =>
      api.api.receivables.payments.initiate({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        ...(input.amountPaise === null ? {} : { amountPaise: input.amountPaise }),
        ...(input.invoiceIds.length === 0 ? {} : { invoiceIds: [...input.invoiceIds] }),
      }),
  )
  const intent = initiate.data

  const toggle = (id: string): void => {
    setChosen((current) =>
      current.includes(id) ? current.filter((one) => one !== id) : [...current, id],
    )
  }

  /** The chosen bills sum to the amount, so a shop that ticks three bills does not retype the total. */
  const chosenTotal = bills
    .filter((bill) => chosen.includes(bill.id))
    .reduce((sum, bill) => sum + bill.openPaise, 0)
  const payable = chosen.length > 0 ? chosenTotal : (amount ?? owed)

  return (
    <Screen
      title={t('r5.title')}
      context={distributor}
      testID="r5-screen"
      bottomBar={
        <Row gap={4} justify="between" align="center" wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('r5.amount')}
            </Txt>
            <Money value={payable} size="moneyL" />
          </Stack>
          <Button
            label={t('r5.start')}
            variant="primary"
            loading={initiate.status === 'pending'}
            disabled={payable <= 0}
            {...(payable <= 0
              ? {
                  disabledReason: dues.data === undefined ? t('app.noConnection') : t('r3.noBills'),
                }
              : {})}
            onPress={() => {
              setFailure(null)
              setNoUpiApp(false)
              void initiate
                .mutateAsync({
                  amountPaise: chosen.length > 0 ? chosenTotal : amount,
                  invoiceIds: chosen,
                })
                .catch((error: unknown) => {
                  setFailure(error instanceof Error ? error.message : t('r5.failed'))
                })
            }}
            testID="r5-start"
          />
        </Row>
      }
    >
      <Stack gap={6}>
        <Async state={[my, dues]} rows={4}>
          <Stack gap={6}>
            {failure === null ? null : (
              <Txt field="body" desk="body" color={colors.status.brick.fg} testID="r5-failure">
                {failure}
              </Txt>
            )}

            {intent === undefined ? (
              <Stack gap={5}>
                <RupeeInput
                  label={t('r5.amount')}
                  value={amount ?? owed}
                  onChange={setAmount}
                  helper={t('r5.amountHelper')}
                  bound={owed}
                  boundMessage={t('r5.overDues')}
                  disabled={chosen.length > 0}
                  testID="r5-amount"
                />
                <Panel title={t('r5.choose')} meta={t('r5.chooseBody')} testID="r5-bills">
                  <Group>
                    {bills.map((bill) => (
                      <ListRow
                        key={bill.id}
                        primary={bill.invoiceNo ?? '—'}
                        secondary={t('r3.due', { date: longDate(bill.dueDate) })}
                        trailingMoney={bill.openPaise}
                        trailing={
                          chosen.includes(bill.id) ? (
                            <StatusChip label={t('action.done')} family="moss" />
                          ) : undefined
                        }
                        state={chosen.includes(bill.id) ? 'selected' : 'default'}
                        onPress={() => {
                          toggle(bill.id)
                        }}
                        testID={`r5-bill-${bill.id}`}
                      />
                    ))}
                  </Group>
                </Panel>
              </Stack>
            ) : (
              <Panel
                title={t('r5.payee', { name: intent.payeeName ?? distributor })}
                testID="r5-intent"
              >
                <Stack gap={4}>
                  <Money value={intent.amountPaise} size="hero" />
                  {intent.upiIntentUrl === null ? (
                    <Txt field="body" desk="body" testID="r5-no-vpa">
                      {t('r5.noVpa', { name: distributor })}
                    </Txt>
                  ) : (
                    <Stack gap={3}>
                      <Button
                        label={t('r5.openUpi')}
                        variant="primary"
                        onPress={async () => {
                          setNoUpiApp(false)
                          if (!(await links.open(intent.upiIntentUrl ?? ''))) setNoUpiApp(true)
                        }}
                        fullWidth
                        testID="r5-open-upi"
                      />
                      {noUpiApp ? (
                        <Txt
                          field="body"
                          desk="body"
                          color={colors.status.ochre.fg}
                          testID="r5-no-upi-app"
                        >
                          {t('r5.noUpiApp', { vpa: intent.payeeVpa ?? '' })}
                        </Txt>
                      ) : null}
                      <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                        {intent.upiQrPayload ?? ''}
                      </Txt>
                    </Stack>
                  )}
                  <Txt field="bodyStrong" desk="body" numeric testID="r5-ref">
                    {t('r5.ref', { ref: intent.paymentRef })}
                  </Txt>
                  <Txt field="label" desk="meta" color={colors.text.secondary}>
                    {t('r5.expires', { when: instantWithClock(intent.expiresAt) })}
                  </Txt>
                  <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="r5-pending">
                    {t('r5.pending', { name: distributor })}
                  </Txt>
                  <Panel title={t('r5.covers', { count: String(intent.bills.length) })}>
                    <Group>
                      {intent.bills.map((bill) => (
                        <ListRow
                          key={bill.id}
                          primary={bill.invoiceNo ?? '—'}
                          secondary={`${t('r3.due', {
                            date: longDate(bill.dueDate),
                          })} · ${formatMoney(bill.totalPaise)}`}
                          trailingMoney={bill.openPaise}
                        />
                      ))}
                    </Group>
                  </Panel>
                </Stack>
              </Panel>
            )}
          </Stack>
        </Async>
      </Stack>
    </Screen>
  )
}
