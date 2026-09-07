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
 * PRICED BY THE OFFICE'S OWN ENGINE. `pricing.quote` runs `priceOrder()` — tier price, retailer
 * override, stacked schemes, approved bargain, cash discount reported and not deducted — so the figure
 * a shopkeeper is shown at the van door is the figure the bill will carry, to the paisa.
 *
 * The van's stock is `inventory.stock.sellable` at the VEHICLE location. It carries availability,
 * batch and MRP, and no cost column: the crew cannot see what the distributor paid, here or anywhere.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncStatus } from '@dos/offline/react'
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
  Toast,
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

interface Draft {
  variantId: string
  name: string
  caseSize: number
  pieces: number
}

export default function VanSale(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const stopId = typeof params.id === 'string' ? params.id : null
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
  const [toast, setToast] = useState<string | null>(null)
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
      onSuccess: (result) => {
        haptics.success()
        setToast(t('d6.created', { no: result.invoice.invoiceNo ?? result.invoice.id.slice(0, 8) }))
        router.replace(`/stop/${String(stopId ?? '')}`)
      },
      onError: (failed) => {
        haptics.error()
        setError(failed.message)
      },
    },
  )

  const netPaise = quote.data?.totals.netPaise ?? null

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
        <Stack gap={2}>
          <Row justify="between" align="center" gap={3}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('d6.total')}
            </Txt>
            <Money value={netPaise} size="moneyL" testID="d6-total" />
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
      }
      testID="d6-screen"
    >
      <Stack gap={6}>
        {status.online ? null : (
          <Txt field="body" desk="body" color={colors.status.ochre.fg} testID="d6-offline">
            {t('d6.online')}
          </Txt>
        )}

        {lines.length === 0 ? null : (
          <Panel title={t('d6.lines')} meta={t('d6.quote')} testID="d6-lines">
            <Group>
              {lines.map((line) => {
                const quoted = quote.data?.lines.find((one) => one.lineId === line.variantId)
                return (
                  <ListRow
                    key={line.variantId}
                    testID={`d6-line-${line.variantId}`}
                    primary={line.name}
                    secondary={t('d.pieces', { pieces: line.pieces })}
                    trailingMoney={quoted?.lineNetPaise ?? null}
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

        {error === null ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d6-error">
            {`${t('d6.failed')} — ${error}`}
          </Txt>
        )}
      </Stack>

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
      />
    </Screen>
  )
}
