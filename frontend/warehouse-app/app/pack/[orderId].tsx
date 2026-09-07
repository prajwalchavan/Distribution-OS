/**
 * W6 — pack one order, and issue its bill (docs/23 §4.1, coordination §4 step 3).
 *
 * THE MOMENT THE ORDER BECOMES CARTONS. One `warehouse.packs.confirm` does all of it in a single
 * transaction: the picked pieces leave the rack as `sale` ledger rows, the holds close, the order
 * moves `picking → packed`, and `BillingService.issueForPack` issues the invoice from the PACKED
 * quantities. It is the ONLY way a pack invoice is issued, it cannot be undone, and it takes a
 * number out of a locked series — which is why it is an ONLINE call and never queued (docs/20 rule
 * 13, `warehouse.sync.ts`: `pack_confirmations` is deliberately not a writable device table).
 *
 * So the confirmation is a `<Dialog>` that states exactly what will be written, in the words UX-00
 * §6.12 asks for. "Pack without a bill" parks the order in the desk's billing backlog instead: the
 * cartons still leave, the paper follows.
 *
 * The lines come from the DEVICE's own `pick_lines` — the same rows the picker just walked — so this
 * screen opens with no round trip and reads correctly in a shed.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Group,
  ListRow,
  Money,
  NumberPad,
  Row,
  Screen,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { caseLine } from '@dos/ui'
import { newId } from '@dos/api-client'
import { documents, haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { absoluteUrl } from '../../src/config'
import { instantWithClock } from '../../src/lib/dates'
import { useHydrated, useLocalPickLines } from '../../src/lib/local'
import { Async, DeskOnly, LocalAsync, Panel, workFamily } from '../../src/lib/ui'

export default function PackOrder(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ orderId: string }>()
  const orderId = typeof params.orderId === 'string' ? params.orderId : ''
  const signedIn = session !== null

  /** `packs.list` scoped to one order answers "has this been packed already" in one read. */
  const existing = useQuery(
    ['packs', 'order', orderId],
    () => api.api.warehouse.packs.list({ orderId, limit: 1 }),
    { enabled: signedIn && orderId !== '' },
  )
  const pack = existing.data?.items[0] ?? null

  const order = useQuery(['order', orderId], () => api.api.orders.get({ id: orderId }), {
    enabled: signedIn && orderId !== '',
  })
  /*
   * `OrderDetailSchema` carries no shop NAME — orders reference a retailer by id — and a packer
   * needs the name on the carton, so it comes from `retailers.get` (ANY_MEMBER). Nothing else on
   * that row is drawn: a credit limit is not a godown's business.
   */
  const retailerId = order.data?.item.retailerId ?? ''
  const retailer = useQuery(
    ['retailer', retailerId],
    () => api.api.retailers.get({ id: retailerId }),
    { enabled: signedIn && retailerId !== '' },
  )

  const invoice = useQuery(
    ['invoice', pack?.invoiceId ?? ''],
    () => api.api.billing.invoices.get({ id: pack?.invoiceId ?? '' }),
    { enabled: signedIn && pack?.invoiceId != null },
  )

  const hydrated = useHydrated()
  /* Keyed by ORDER: the picker's own rows for this bill, whichever wave they were walked on. */
  const lines = useLocalPickLines(null, orderId)

  const [packages, setPackages] = useState<number | null>(1)
  const [weight, setWeight] = useState<number | null>(null)
  const [ask, setAsk] = useState<'bill' | 'park' | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const confirm = useMutation(
    (input: { issueInvoice: boolean }, meta) =>
      api.api.warehouse.packs.confirm({
        id: newId(),
        idempotencyKey: meta.idempotencyKey,
        orderId,
        packages: Math.max(1, packages ?? 1),
        ...(weight === null || weight <= 0 ? {} : { weightGrams: weight }),
        issueInvoice: input.issueInvoice,
      }),
    {
      invalidates: [['packs'], ['queue'], ['order'], ['picklists']],
      onSuccess: (result) => {
        haptics.success()
        setAsk(null)
        setToast(
          result.invoice === null
            ? t('w6.packed')
            : t('w6.invoiceIssued', { invoiceNo: result.invoice.invoiceNo ?? '—' }),
        )
      },
      onError: () => {
        haptics.error()
        setAsk(null)
      },
    },
  )

  const print = useMutation(
    (input: { id: string }) => api.api.billing.invoices.pdf({ id: input.id }),
    {
      onSuccess: (result) => {
        const url = absoluteUrl(result.url)
        if (result.status === 'ready' && url !== null) void documents.print(url)
        else setToast(t('w6.billQueued'))
      },
    },
  )

  const shop = pack?.retailerName ?? retailer.data?.item.name ?? '—'
  const orderNo = order.data?.item.orderNo ?? pack?.orderNo ?? orderId.slice(0, 8)
  const packed = pack !== null

  return (
    <Screen
      title={orderNo}
      context={shop}
      chips={
        packed ? (
          <StatusChip
            label={pack.invoiceNo ?? t('w6.noBill')}
            family={pack.invoiceNo === null ? 'ochre' : 'moss'}
          />
        ) : (
          <StatusChip
            label={order.data?.item.state ?? 'picking'}
            family={workFamily(order.data?.item.state ?? 'picking')}
          />
        )
      }
      testID="w6-order-screen"
      bottomBar={
        packed ? undefined : (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('w6.packages')} {String(packages ?? 1)}
            </Txt>
            <Row gap={4} wrap>
              <Button
                label={t('w6.parkIt')}
                variant="secondary"
                onPress={() => {
                  setAsk('park')
                }}
                testID="w6-park"
              />
              <Button
                label={t('w6.packIt')}
                variant="primary"
                loading={confirm.status === 'pending'}
                onPress={() => {
                  setAsk('bill')
                }}
                testID="w6-pack"
              />
            </Row>
          </Row>
        )
      }
    >
      <Stack gap={6}>
        {packed ? (
          <Panel title={t('w6.packed')} meta={instantWithClock(pack.packedAt)} testID="w6-packed">
            <Stack gap={3}>
              <Row gap={4} wrap>
                <Txt field="moneyM" desk="cell" numeric>
                  {t('w6.packages')} {String(pack.packages)}
                </Txt>
                {pack.shortPacked ? (
                  <StatusChip label={t('w6.shortPacked')} family="ochre" />
                ) : null}
              </Row>
              {pack.invoiceId === null ? (
                <DeskOnly>{t('w6.noBill')}</DeskOnly>
              ) : (
                <Stack gap={3}>
                  <Async state={invoice} rows={2}>
                    <Row justify="between" align="center" gap={4} wrap>
                      <Txt field="body" desk="body">
                        {invoice.data?.item.invoiceNo ?? '—'}
                      </Txt>
                      <Money
                        value={invoice.data?.item.totalPaise ?? null}
                        size="moneyM"
                        testID="w6-invoice-total"
                      />
                    </Row>
                  </Async>
                  <Button
                    label={t('w6.printBill')}
                    variant="secondary"
                    loading={print.status === 'pending'}
                    onPress={() => {
                      print.mutate({ id: pack.invoiceId ?? '' })
                    }}
                    testID="w6-print"
                  />
                </Stack>
              )}
              <DeskOnly>{t('w6.ewbIsDesk')}</DeskOnly>
            </Stack>
          </Panel>
        ) : (
          <Panel title={t('w6.packages')} testID="w6-count">
            <Stack gap={4}>
              <NumberPad
                testID="w6-packages-pad"
                mode="count"
                label={t('w6.packages')}
                value={packages}
                onChange={setPackages}
                doneLabel={t('w6.weight')}
                onDone={() => {
                  haptics.tap()
                }}
              />
              <NumberPad
                testID="w6-weight-pad"
                mode="count"
                label={t('w6.weight')}
                value={weight}
                onChange={setWeight}
                doneLabel={t('action.done')}
                onDone={() => {
                  haptics.tap()
                }}
              />
            </Stack>
          </Panel>
        )}

        <Panel title={t('w6.lines')} testID="w6-lines">
          <LocalAsync
            loading={lines.loading}
            hydrated={hydrated}
            empty={lines.rows.length === 0}
            emptyMessage={t('w.nothingHere')}
            waitingMessage={t('w.filling')}
          >
            <Group>
              {lines.rows.map((row) => (
                <ListRow
                  key={row.line.id}
                  testID={`w6-line-${row.line.id}`}
                  primary={row.variantName}
                  secondary={caseLine(row.line.picked_qty_pcs, row.caseSize, t)}
                  trailing={
                    row.line.picked_qty_pcs < row.line.requested_qty_pcs ? (
                      <StatusChip
                        label={t('w6.shortQty')}
                        family="ochre"
                        testID={`w6-short-${row.line.id}`}
                      />
                    ) : (
                      <StatusChip label={t('w6.packedQty')} family="moss" />
                    )
                  }
                  {...(row.line.short_reason === null ? {} : { reason: row.line.short_reason })}
                />
              ))}
            </Group>
          </LocalAsync>
        </Panel>

        {confirm.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {confirm.error.message}
          </Txt>
        )}

        <Button
          label={t('w.close')}
          variant="ghost"
          onPress={() => {
            router.push('/pack')
          }}
          testID="w6-close"
        />
      </Stack>

      <Dialog
        open={ask !== null}
        onClose={() => {
          setAsk(null)
        }}
        title={t('w6.confirmTitle', { order: orderNo })}
        body={t(ask === 'park' ? 'w6.parkBody' : 'w6.confirmBody', {
          packages: packages ?? 1,
          shop,
        })}
        confirmLabel={t(ask === 'park' ? 'w6.parkIt' : 'w6.packIt')}
        busy={confirm.status === 'pending'}
        onConfirm={() => {
          confirm.mutate({ issueInvoice: ask !== 'park' })
        }}
        testID="w6-dialog"
      />
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w6-toast"
      />
    </Screen>
  )
}
