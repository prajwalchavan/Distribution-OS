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
 * WHAT MAY BE SOLD IS THE VAN LESS THIS TRIP'S BILLS (QA DOS-233). The van also carries the cartons of
 * every bill still to be handed over — the next shop's order — and this list used to offer them as stock to
 * sell (`inventory.stock.sellable` at the vehicle: Bourbon 240, Salted Cracker 180 …). It now reads
 * `delivery.vanSales.stock`, which takes those pieces off per lot and says how many it held back; the
 * server refuses a sale that would draw on them in any case. Batch, MRP, expiry — never a cost.
 *
 * ONE CASE MORE IS ONE CASE (QA DOS-239). The stepper steps by the item's SELL-side case — the case the quote
 * and the bill count in, read off `vanSales.stock` — and the "Pieces" pad takes loose pieces. It used to be
 * handed a case of one, so "One case more" on a 60-piece Bourbon case sold one piece and read "1 cs": the
 * crew handed over a carton and billed a packet. Neither control goes past the pieces free on the van; the
 * one availability figure is the row's own "n pc to sell".
 *
 * PAID AT THE DOOR IS NOT CREDIT (QA DOS-240). "How the shop pays" — cash now, UPI now, or on account. Cash
 * or UPI is taken in the same call as the bill (`collect`), so a pay-on-delivery counter, a shop with credit
 * stopped or one overdue can still buy: the office's credit gate stands aside for money in hand and holds for
 * a sale on account. The crew TYPES what it took, against the bill total printed above the pad and never
 * pre-filled into it (UX-01 D6); only the bill is receipted, and cash over it is change. A refusal is the
 * office's own sentence — the shop, why, and what sells — with a one-tap switch to cash.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import {
  Button,
  caseLine,
  formatINR,
  Group,
  ListRow,
  Money,
  paise,
  parsePieces,
  QtyStepper,
  Row,
  RupeeInput,
  Screen,
  Search,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  stepPiece,
  TextInput,
  Txt,
  useColors,
  useStrings,
  useGo,
} from '@dos/ui'
import { haptics } from '@dos/ui/platform'
import { uuidv7 } from '@dos/domain'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'

import { deviceId } from '../../../../src/api'
import { longDate } from '../../../../src/groups/delivery/lib/dates'
import {
  bool,
  useLocalRetailers,
  useLocalStop,
  useLocalTrip,
} from '../../../../src/groups/delivery/lib/local'
import { Async, Panel } from '../../../../src/groups/delivery/lib/ui'
import {
  amountToTake,
  collectFor,
  lineFigure,
  payNowOf,
  piecesToSell,
  saleFigures,
  takenCheck,
  vanStockByVariant,
  type VanPay,
  type VanVariant,
} from '../../../../src/groups/delivery/lib/van-sale'

interface Draft {
  variantId: string
  name: string
  caseSize: number
  pieces: number
}

/** The bill the office issued, as it came back: its number, its own total and the money taken with it. */
interface Billed {
  no: string
  totalPaise: number
  paid: { mode: 'cash' | 'upi'; amountPaise: number; receiptNo: string } | null
}

export default function VanSale(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const go = useGo()
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
  const tripId = localTrip?.id ?? stop?.trip_id ?? null
  const stock = useQuery(
    ['van-stock', tripId],
    () => api.api.delivery.vanSales.stock({ tripId: tripId ?? '' }),
    { enabled: signedIn && tripId !== null },
  )
  const allowed: boolean | null =
    stock.data?.vanSalesAllowed ??
    trip.data?.item.vanSalesAllowed ??
    (localTrip === null ? null : bool(localTrip.van_sales_enabled))
  const unknown = allowed === null

  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Record<string, Draft>>({})
  const [billed, setBilled] = useState<Billed | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** DOS-240: how the shop pays, what the crew typed it took, and the UPI reference. */
  const [pay, setPay] = useState<VanPay>('cash')
  const [takenPaise, setTakenPaise] = useState<number | null>(null)
  const [reference, setReference] = useState('')
  /** The office's own "take this much" off the last refusal, for the lines it refused. */
  const [officeSays, setOfficeSays] = useState<{ key: string; paise: number } | null>(null)
  /** DOS-239: the SKU whose loose-pieces pad is open. */
  const [pieceRow, setPieceRow] = useState<VanVariant | null>(null)

  const rows = stock.data?.items
  /** One row per variant: the van may hold two lots of the same SKU and the shopkeeper buys the SKU. */
  const byVariant = useMemo(() => vanStockByVariant(rows ?? []), [rows])
  /** Pieces on the van that belong to this trip's bills: said, never offered (DOS-233). */
  const heldForBills = (rows ?? []).reduce((n, row) => n + row.heldForBillsPcs, 0)

  const shown =
    query.trim() === ''
      ? byVariant
      : byVariant.filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()))

  const lines = Object.values(draft).filter((line) => line.pieces > 0)
  const linesKey = lines.map((line) => `${line.variantId}:${String(line.pieces)}`).join(',')

  /** One SKU's pieces on the sale, never past what is free on the van (DOS-239). */
  const setPieces = (row: VanVariant, pieces: number): void => {
    setDraft((held) => ({
      ...held,
      [row.variantId]: {
        variantId: row.variantId,
        name: row.name,
        caseSize: row.caseSize,
        pieces: piecesToSell(pieces, row.available),
      },
    }))
    setError(null)
  }

  const quote = useQuery(
    ['quote', stop?.retailer_id ?? null, linesKey],
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

  const figures = saleFigures(quote.data)
  /** DOS-240: what a paid sale takes — the bill, or the larger figure the office named for these lines. */
  const toTake = amountToTake(
    figures?.billPaise ?? null,
    officeSays !== null && officeSays.key === linesKey ? officeSays.paise : null,
  )
  const taken = takenCheck(pay, takenPaise, toTake)
  const needsUtr = pay === 'upi' && reference.trim() === ''
  const rupees = (value: number | null): string => formatINR(paise(value ?? 0))
  const takenWords = (problem: 'enter' | 'short' | 'upiExact'): string =>
    problem === 'enter'
      ? t('d6.enterTaken')
      : problem === 'short'
        ? t('d6.takeAll', { amount: rupees(toTake) })
        : t('d6.upiExact', { amount: rupees(toTake) })
  /** A different sale is a different sum: the typed money goes when the lines change. */
  useEffect(() => {
    setTakenPaise(null)
  }, [linesKey])

  const create = useMutation(
    (_input: { at: number }, meta) => {
      // DOS-240: the bill is receipted, never the change; nothing for a sale on account
      const collect = collectFor(pay, toTake, reference, { id: uuidv7(), receiptId: uuidv7() })
      return api.api.delivery.vanSales.create({
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
        ...(collect === undefined ? {} : { collect }),
      })
    },
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
        const receipt = result.receipt
        setBilled({
          no: result.invoice.invoiceNo ?? result.invoice.id.slice(0, 8),
          totalPaise: result.invoice.totalPaise,
          paid:
            receipt === null || (receipt.mode !== 'cash' && receipt.mode !== 'upi')
              ? null
              : {
                  mode: receipt.mode,
                  amountPaise: receipt.amountPaise,
                  receiptNo: receipt.receiptNo ?? receipt.id.slice(0, 8),
                },
        })
        haptics.success()
        void engine?.sync('van-sale')
      },
      onError: (failed) => {
        haptics.error()
        setError(failed.message)
        const payNow = payNowOf(failed.data)
        setOfficeSays(payNow === null ? null : { key: linesKey, paise: payNow })
      },
    },
  )

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
              label={
                pay === 'cash'
                  ? t('d6.createCash')
                  : pay === 'upi'
                    ? t('d6.createUpi')
                    : t('d6.create')
              }
              variant="primary"
              size="floor"
              fullWidth
              loading={create.status === 'pending'}
              disabled={
                allowed !== true ||
                lines.length === 0 ||
                !status.online ||
                (pay !== 'account' && (toTake === null || taken.problem !== null || needsUtr))
              }
              disabledReason={
                unknown
                  ? t('d6.unknown')
                  : allowed === false
                    ? t('d6.off')
                    : !status.online
                      ? t('d6.online')
                      : lines.length === 0
                        ? t('d6.needsLine')
                        : toTake === null
                          ? t('d6.nothingToCharge')
                          : taken.problem !== null
                            ? takenWords(taken.problem)
                            : t('d6.needsUtr')
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
              router.replace(go.href(`/stop/${String(stopId ?? '')}`))
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
              {billed.paid === null ? (
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('d6.billedNext')}
                </Txt>
              ) : (
                <Txt field="bodyStrong" desk="body" testID="d6-billed-paid">
                  {t(billed.paid.mode === 'cash' ? 'd6.paidCash' : 'd6.paidUpi', {
                    amount: rupees(billed.paid.amountPaise),
                    no: billed.paid.receiptNo,
                  })}
                </Txt>
              )}
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
                    secondary={caseLine(line.pieces, line.caseSize, t)}
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

        {billed !== null || lines.length === 0 ? null : (
          <Panel title={t('d6.pay')} testID="d6-pay">
            <Stack gap={4}>
              <Segments
                testID="d6-pay-mode"
                items={[
                  { id: 'cash', label: t('d6.payCash') },
                  { id: 'upi', label: t('d6.payUpi') },
                  { id: 'account', label: t('d6.payAccount') },
                ]}
                value={pay}
                onChange={(id) => {
                  setPay(id as VanPay)
                  setError(null)
                }}
              />
              {pay === 'account' ? (
                <Txt field="body" desk="body" color={colors.text.secondary} testID="d6-on-account">
                  {t('d6.onAccount')}
                </Txt>
              ) : (
                <Stack gap={3}>
                  <Txt field="bodyStrong" desk="body" testID="d6-take">
                    {toTake === null
                      ? t('d6.nothingToCharge')
                      : t(pay === 'cash' ? 'd6.takeCash' : 'd6.takeUpi', {
                          amount: rupees(toTake),
                        })}
                  </Txt>
                  {/* The bill prints ABOVE the pad and is never pre-filled into it (UX-01 D6). */}
                  <RupeeInput
                    testID="d6-taken"
                    label={t('d6.taken')}
                    value={takenPaise}
                    onChange={setTakenPaise}
                    expected={toTake}
                    expectedLabel={t('d6.expected')}
                    {...(takenPaise !== null && taken.problem !== null && taken.problem !== 'enter'
                      ? { error: takenWords(taken.problem) }
                      : {})}
                  />
                  {taken.changePaise > 0 ? (
                    <Txt field="bodyStrong" desk="body" testID="d6-change">
                      {t('d6.change', { amount: rupees(taken.changePaise) })}
                    </Txt>
                  ) : null}
                  {pay === 'upi' ? (
                    <TextInput
                      testID="d6-reference"
                      label={t('d5.reference')}
                      value={reference}
                      onChange={setReference}
                      maxLength={64}
                      {...(needsUtr && takenPaise !== null ? { error: t('d6.needsUtr') } : {})}
                    />
                  ) : null}
                </Stack>
              )}
            </Stack>
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
              {heldForBills === 0 ? null : (
                <Txt
                  field="label"
                  desk="meta"
                  color={colors.text.secondary}
                  testID="d6-held-for-bills"
                >
                  {t('d6.heldForBills', { pieces: heldForBills })}
                </Txt>
              )}
              <Async
                state={[trip, stock]}
                empty={byVariant.length === 0}
                emptyMessage={t('d6.nothingToSell')}
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
                      {/*
                        DOS-239: one case of THIS item per tap — its sell-side case, the one the quote
                        and the bill count in — and loose pieces on the pad. No `availablePieces`: the
                        row already says "n pc to sell", and the screen stops at it rather than printing
                        a second figure in cases or a "short-supplied" line a van sale cannot have.
                      */}
                      <QtyStepper
                        testID={`d6-qty-${row.variantId}`}
                        pieces={draft[row.variantId]?.pieces ?? 0}
                        caseSize={row.caseSize}
                        onChange={(pieces) => {
                          setPieces(row, pieces)
                        }}
                        onOpenPieces={() => {
                          setPieceRow(row)
                        }}
                      />
                      {(draft[row.variantId]?.pieces ?? 0) >= row.available ? (
                        <Txt
                          field="label"
                          desk="meta"
                          color={colors.text.secondary}
                          testID={`d6-all-${row.variantId}`}
                        >
                          {t('d6.allOfIt')}
                        </Txt>
                      ) : null}
                    </Stack>
                  ))}
                </Stack>
              </Async>
            </Stack>
          </Panel>
        )}

        {error === null ? null : (
          <Stack gap={3}>
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="d6-error">
              {`${t('d6.failed')} — ${error}`}
            </Txt>
            {/* DOS-240: the office said money in hand sells; one tap turns the sale into a cash sale. */}
            {pay === 'account' && toTake !== null && officeSays?.key === linesKey ? (
              <Button
                testID="d6-use-cash"
                label={t('d6.useCash', { amount: rupees(toTake) })}
                variant="secondary"
                fullWidth={false}
                onPress={() => {
                  setPay('cash')
                  setError(null)
                }}
              />
            ) : null}
          </Stack>
        )}
      </Stack>

      <PiecesSheet
        row={pieceRow}
        pieces={pieceRow === null ? 0 : (draft[pieceRow.variantId]?.pieces ?? 0)}
        onClose={() => {
          setPieceRow(null)
        }}
        onSet={(pieces) => {
          if (pieceRow !== null) setPieces(pieceRow, pieces)
          setPieceRow(null)
        }}
      />
    </Screen>
  )
}

/**
 * DOS-239 · the "Pieces" pad: sell an exact count — 12 packets out of a 60-piece case — or nudge it a piece at
 * a time. The kit's `parsePieces` reads what was typed (whole pieces, "1,200" included, "1.5" refused rather
 * than truncated) and the count stops at what is free on the van. The sale's count fills the field when the
 * pad opens and is never live-updated while it is open.
 */
function PiecesSheet({
  row,
  pieces,
  onClose,
  onSet,
}: {
  row: VanVariant | null
  pieces: number
  onClose: () => void
  onSet: (pieces: number) => void
}): React.JSX.Element {
  const t = useStrings()
  const [text, setText] = useState('')

  useEffect(() => {
    // the count is read when the pad opens (`row` changes), never while it is open
    if (row !== null) setText(String(pieces))
  }, [row])

  const typed = parsePieces(text)
  const over = typed.ok && row !== null && typed.pieces > row.available

  return (
    <Sheet
      open={row !== null}
      onClose={onClose}
      title={t('qty.piecesTitle')}
      testID="d6-pieces-sheet"
    >
      <Stack gap={4}>
        <Txt field="bodyStrong" desk="body">
          {row?.name ?? ''}
        </Txt>
        <TextInput
          testID="d6-pieces-input"
          label={t('qty.piecesLabel')}
          value={text}
          onChange={setText}
          keyboard="decimal"
          autoFocus
          {...(text.trim() !== '' && !typed.ok ? { error: t('qty.piecesInvalid') } : {})}
          {...(over ? { helper: t('d6.piecesAtMost', { pieces: row.available }) } : {})}
        />
        <Row gap={3}>
          <Button
            testID="d6-piece-less"
            label={t('qty.pieceLess')}
            variant="secondary"
            disabled={!typed.ok || typed.pieces <= 0}
            onPress={() => {
              if (typed.ok) setText(String(stepPiece(typed.pieces, -1)))
            }}
          />
          <Button
            testID="d6-piece-more"
            label={t('qty.pieceMore')}
            variant="secondary"
            disabled={!typed.ok || (row !== null && typed.pieces >= row.available)}
            disabledReason={
              row === null ? undefined : t('d6.piecesAtMost', { pieces: row.available })
            }
            onPress={() => {
              if (typed.ok) setText(String(stepPiece(typed.pieces, 1)))
            }}
          />
        </Row>
        <Button
          testID="d6-pieces-set"
          variant="primary"
          size="floor"
          fullWidth
          label={t('qty.piecesSet')}
          disabled={!typed.ok}
          disabledReason={t('qty.piecesInvalid')}
          onPress={() => {
            if (typed.ok) onSet(typed.pieces)
          }}
        />
      </Stack>
    </Sheet>
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
