/**
 * D6 — Sell from the van (docs/23 §5.1, ADR 0013).
 *
 * ONLINE ONLY, and the screen says so rather than queueing something it cannot honour: a van sale
 * makes a NUMBERED GST INVOICE, and a number comes from a series under a row lock at the office. It
 * is also one call — `delivery.vanSales.create` creates the order from van stock, submits it, confirms
 * it against the VEHICLE (a shortage is a hard refusal with the short lines: the van never goes
 * negative), bills it on the tenant's normal series, posts the sale ledger rows at the vehicle, writes
 * the delivery at full quantity and, when the crew takes the money there and then, records the
 * collection too. The app must never assemble that out of `orders.create` + `orders.submit`: the crew
 * does not hold `orders.confirm`, and half a van sale is a bill with no stock behind it.
 *
 * PRICED BY THE OFFICE'S OWN ENGINE, AND SHOWN AS THE BILL (DOS-171). `pricing.quote` runs `priceOrder()`
 * — tier price, retailer override, stacked schemes, approved bargain, cash discount reported and not
 * deducted — and adds GST at each item's dated HSN rate with the bill's own rounding to the rupee (DOS-096).
 * The quote's `totalPaise` is the bill's payable figure for every item that carries only GST, so that is
 * what the crew reads under the button, with the breakdown under the lines; the screen reads the quote's
 * money only through `saleFigures` and `lineFigure` (src/lib/van-sale.ts). Cess is not in the quote yet
 * (DOS-079), and the bill rounds the CGST and SGST halves separately, a paisa apart from the quote. That is
 * why the bill is shown again once it is issued: its number and its own total stay on this screen until the
 * crew taps Back to the stop, so the figure they ask the shop for is the bill's, never a toast that vanished
 * under a redirect (DOS-149).
 *
 * The van's stock is `inventory.stock.sellable` at the VEHICLE location. It carries availability,
 * batch and MRP, and no cost column: the crew cannot see what the distributor paid, here or anywhere.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import {
  Button,
  Group,
  ListRow,
  Money,
  QtyStepper,
  Row,
  Screen,
  Search,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { uuidv7 } from '@dos/domain'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../../../src/api'
import { longDate } from '../../../src/lib/dates'
import { bool, useLocalRetailers, useLocalStop, useLocalTrip } from '../../../src/lib/local'
import { Async, Panel } from '../../../src/lib/ui'
import { lineFigure, saleFigures } from '../../../src/lib/van-sale'

interface Draft {
  variantId: string
  name: string
  caseSize: number
  pieces: number
}

/** The bill the office issued, as it came back: its number and its own total. */
interface Billed {
  no: string
  totalPaise: number
}

export default function VanSale(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const stopId = typeof params.id === 'string' ? params.id : null
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const signedIn = session !== null

  const { stop } = useLocalStop(stopId)
  const { trip: localTrip } = useLocalTrip(stop?.trip_id ?? null)
  const { byId: shops } = useLocalRetailers(
    useMemo(() => (stop === null ? [] : [stop.retailer_id]), [stop]),
  )
  const shop = stop === null ? undefined : shops.get(stop.retailer_id)

  const trip = useQuery(
    ['trip', localTrip?.id ?? null],
    () => api.api.delivery.trips.get({ id: localTrip?.id ?? '' }),
    { enabled: signedIn && localTrip !== null },
  )
  /*
   * "SWITCHED OFF" AND "NOT KNOWN YET" ARE DIFFERENT SENTENCES. Falling back to `bool(undefined)`
   * turned a trip that had simply not reached the device into a definite refusal: measured in the
   * gate, this screen said "Van sales are switched off for this trip" for the whole first pull, over
   * a trip whose `van_sales_enabled` is true and a feature flag that is on. `null` is the third
   * answer — the screen waits and says it is waiting instead of telling a crew they may not sell.
   */
  const allowed: boolean | null =
    trip.data?.item.vanSalesAllowed ??
    (localTrip === null ? null : bool(localTrip.van_sales_enabled))
  const unknown = allowed === null
  const vehicleLocationId = trip.data?.item.vehicleLocationId ?? null

  const stock = useQuery(
    ['van-stock', vehicleLocationId],
    () =>
      api.api.inventory.stock.sellable({
        locationId: vehicleLocationId ?? '',
        limit: 200,
      }),
    { enabled: signedIn && vehicleLocationId !== null },
  )

  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [billed, setBilled] = useState<Billed | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rows = stock.data?.items ?? []
  /** One row per variant: the van may hold two lots of the same SKU and the shopkeeper buys the SKU. */
  const byVariant = useMemo(() => {
    const map = new Map<
      string,
      {
        variantId: string
        name: string
        available: number
        batch: string | null
        expiry: string | null
      }
    >()
    for (const row of rows) {
      const held = map.get(row.variantId)
      if (held === undefined) {
        map.set(row.variantId, {
          variantId: row.variantId,
          name: row.variantName,
          available: row.available,
          batch: row.batchNo,
          expiry: row.expiryDate,
        })
      } else {
        held.available += row.available
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [rows])

  const shown =
    query.trim() === ''
      ? byVariant
      : byVariant.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()))

  const lines = Object.values(draft).filter((line) => line.pieces > 0)

  const quote = useQuery(
    [
      'quote',
      stop?.retailer_id ?? null,
      lines.map((line) => `${line.variantId}:${String(line.pieces)}`).join(','),
    ],
    () =>
      api.api.pricing.quote({
        retailerId: stop?.retailer_id ?? '',
        lines: lines.map((line) => ({
          lineId: line.variantId,
          variantId: line.variantId,
          qtyPcs: line.pieces,
        })),
      }),
    { enabled: signedIn && stop !== null && lines.length > 0 },
  )

  const create = useMutation(
    (_input: { at: number }, meta) =>
      api.api.delivery.vanSales.create({
        idempotencyKey: meta.idempotencyKey,
        id: meta.id,
        tripId: stop?.trip_id ?? '',
        stopId: stop?.id ?? '',
        retailerId: stop?.retailer_id ?? '',
        invoiceId: uuidv7(),
        deliveryId: uuidv7(),
        deviceId: deviceId(),
        lines: lines.map((line) => ({
          id: uuidv7(),
          variantId: line.variantId,
          enteredQty: line.pieces,
          enteredUnit: 'piece' as const,
        })),
      }),
    {
      invalidates: [['trip'], ['van-stock'], ['settlement']],
      /*
       * THE CREW TAKES THE BILL'S FIGURE. The screen stays on the issued bill — its number and its own
       * total — and the only way on is Back to the stop, so once a reply arrives no further tap can issue
       * a second bill. A tap whose reply was LOST is a separate, open hole (`at: Date.now()` below makes
       * every tap a new intent), recorded as a P1 against this screen and not fixed here. The pull carries
       * the stop's new "owed on the bills here" to D3 and D5; a pull already running makes this call a
       * no-op and the next poll catches up.
       */
      onSuccess: (result) => {
        setBilled({
          no: result.invoice.invoiceNo ?? result.invoice.id.slice(0, 8),
          totalPaise: result.invoice.totalPaise,
        })
        haptics.success()
        void engine?.sync('van-sale')
      },
      onError: (failed) => {
        haptics.error()
        setError(failed.message)
      },
    },
  )

  const figures = saleFigures(quote.data)

  return (
    <Screen
      title={t('d6.title')}
      context={shop?.name ?? t('d3.title')}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            testID="d6-allowed"
            label={unknown ? t('d.filling') : allowed === true ? t('d1.vanSale') : t('d6.off')}
            family={unknown ? 'ochre' : allowed === true ? 'moss' : 'neutral'}
          />
          {trip.data?.item.vehicleRegNo === undefined ? null : (
            <StatusChip label={trip.data.item.vehicleRegNo} family="neutral" />
          )}
        </Row>
      }
      bottomBar={
        billed === null ? (
          <Stack gap={2}>
            <Row justify="between" align="center" gap={3}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('d6.total')}
              </Txt>
              <Money value={figures?.billPaise ?? null} size="moneyL" testID="d6-total" />
            </Row>
            <Button
              testID="d6-create"
              label={t('d6.create')}
              variant="primary"
              size="floor"
              fullWidth
              loading={create.status === 'pending'}
              disabled={allowed !== true || lines.length === 0 || !status.online}
              disabledReason={
                unknown
                  ? t('d6.unknown')
                  : allowed === false
                    ? t('d6.off')
                    : !status.online
                      ? t('d6.online')
                      : t('d6.needsLine')
              }
              onPress={() => {
                setError(null)
                create.mutate({ at: Date.now() })
              }}
            />
          </Stack>
        ) : (
          <Button
            testID="d6-back"
            label={t('d6.back')}
            variant="primary"
            size="floor"
            fullWidth
            onPress={() => {
              router.replace(`/stop/${String(stopId ?? '')}`)
            }}
          />
        )
      }
      testID="d6-screen"
    >
      <Stack gap={6}>
        {status.online ? null : (
          <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="d6-offline">
            {t('d6.online')}
          </Txt>
        )}

        {billed === null ? null : (
          <Panel title={t('d6.billed', { no: billed.no })} testID="d6-billed">
            <Stack gap={2}>
              <Money value={billed.totalPaise} size="moneyL" testID="d6-billed-total" />
              <Txt field="body" desk="body" color={colors.text.secondary}>
                {t('d6.billedNext')}
              </Txt>
            </Stack>
          </Panel>
        )}

        {billed !== null || lines.length === 0 ? null : (
          <Panel title={t('d6.lines')} meta={t('d6.quote')} testID="d6-lines">
            <Group
              footer={
                <Stack gap={1}>
                  <FigureRow
                    label={t('d6.beforeGst')}
                    value={figures?.beforeGstPaise ?? null}
                    testID="d6-before-gst"
                  />
                  <FigureRow
                    label={t('d6.gst')}
                    value={figures?.gstPaise ?? null}
                    testID="d6-gst"
                  />
                  {figures === null || figures.roundOffPaise === 0 ? null : (
                    <FigureRow
                      label={t('d6.roundOff')}
                      value={figures.roundOffPaise}
                      testID="d6-round-off"
                    />
                  )}
                </Stack>
              }
            >
              {lines.map((line) => {
                const quoted = quote.data?.lines.find((one) => one.lineId === line.variantId)
                return (
                  <ListRow
                    key={line.variantId}
                    testID={`d6-line-${line.variantId}`}
                    primary={line.name}
                    secondary={t('d.pieces', { pieces: line.pieces })}
                    trailingMoney={lineFigure(quote.data, line.variantId)}
                    trailingSize="moneyM"
                    {...(quoted === undefined || quoted.freeQtyPcs === 0
                      ? {}
                      : {
                          trailing: (
                            <StatusChip
                              label={t('qty.freeGoods', { pieces: quoted.freeQtyPcs })}
                              family="moss"
                            />
                          ),
                        })}
                  />
                )
              })}
            </Group>
          </Panel>
        )}

        {billed !== null ? null : (
          <Panel title={t('d6.stock')} testID="d6-stock">
            <Stack gap={4}>
              <Search
                testID="d6-search"
                value={query}
                onChange={setQuery}
                state={shown.length === 0 && query.trim() !== '' ? 'noResults' : 'results'}
              />
              <Async
                state={[trip, stock]}
                empty={rows.length === 0}
                emptyMessage={t('d.nothingHere')}
              >
                <Stack gap={4}>
                  {shown.slice(0, 40).map((row) => (
                    <Stack
                      key={row.variantId}
                      gap={3}
                      pad={4}
                      background="surface"
                      radius="md"
                      border="all"
                      borderTone="hairline"
                      testID={`d6-item-${row.variantId}`}
                    >
                      <Row justify="between" gap={3} wrap>
                        <Txt field="bodyStrong" desk="cell">
                          {row.name}
                        </Txt>
                        <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
                          {t('d6.available', { pieces: row.available })}
                        </Txt>
                      </Row>
                      {row.expiry === null ? null : (
                        <Txt field="label" desk="meta" color={colors.text.secondary}>
                          {longDate(row.expiry)}
                        </Txt>
                      )}
                      <QtyStepper
                        testID={`d6-qty-${row.variantId}`}
                        pieces={draft[row.variantId]?.pieces ?? 0}
                        caseSize={1}
                        availablePieces={row.available}
                        onChange={(pieces) => {
                          setDraft((held) => ({
                            ...held,
                            [row.variantId]: {
                              variantId: row.variantId,
                              name: row.name,
                              caseSize: 1,
                              pieces: Math.max(0, pieces),
                            },
                          }))
                        }}
                      />
                    </Stack>
                  ))}
                </Stack>
              </Async>
            </Stack>
          </Panel>
        )}

        {error === null ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d6-error">
            {`${t('d6.failed')} — ${error}`}
          </Txt>
        )}
      </Stack>
    </Screen>
  )
}

/** One figure of the breakdown under the lines: the label on the left, the amount on the right. */
function FigureRow({
  label,
  value,
  testID,
}: {
  label: string
  value: number | null
  testID: string
}): React.JSX.Element {
  const colors = useColors()
  return (
    <Row justify="between" align="center" gap={3}>
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {label}
      </Txt>
      <Money value={value} size="cell" testID={testID} />
    </Row>
  )
}
