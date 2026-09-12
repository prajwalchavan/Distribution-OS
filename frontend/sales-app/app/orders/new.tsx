/**
 * S3 · Order entry — the screen the pilot is decided on.
 *
 * Ninety seconds in a doorway: a repeat order in **3 taps from a cold open** (shop → Take order →
 * Repeat last order → Place order counts the shop row as tap one), a modified one in ≤ 15. Everything
 * that makes that possible is already on the phone: the catalog, the price lists, the schemes, this
 * shop's overrides and its own last order.
 *
 * THE PRICE IS COMPUTED HERE, WITH THE SERVER'S OWN ENGINE. `priceOrder()` lives in `@dos/domain`,
 * which both halves import, and `src/lib/pricing.ts` feeds it the same inputs
 * `QuoteService.loadInputs` selects. So the running total under the thumb is instant and works with
 * no signal — and it is still not the order's price: `orders.create` re-prices on the server and
 * THAT is what the order, the bill and the shop carry. Where the two ever differ the server wins and
 * the order screen shows the order's own lines.
 *
 * TWO WAYS OUT (ADR 0007). With signal: `orders.create` + `orders.submit` — numbered, credit-checked,
 * approvals raised. Without: the header and its lines go into the outbox as a DRAFT, which is the
 * only thing `orders.sync.ts` accepts from a device, and the rep submits it from My orders when the
 * phone finds signal. The button says which one it is about to do, every time.
 *
 * NOT ONE COST, MARGIN OR LANDED PRICE (docs/23 §3.3). `tenant_product_costs` is not in this role's
 * manifest and `tenantCatalog.costs` refuses a salesperson, so there is nothing here to leak.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { useSyncEngine } from '@dos/offline/react'
import { formatINR, formatQty, paise, pieces, uuidv7 } from '@dos/domain'
import {
  Button,
  EmptyState,
  Group,
  Money,
  QtyStepper,
  Row,
  Screen,
  Search,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { deviceId } from '../../src/api'
import { forgetDraft, useOrderDraft } from '../../src/lib/draft'
import { today } from '../../src/lib/dates'
import {
  useBargains,
  useCatalogIndex,
  useLastOrderOf,
  useLocalState,
  useOrderLines,
  useOverrides,
  usePriceLists,
  useSchemes,
  useShop,
  type CatalogItem,
} from '../../src/lib/local'
import { quoteOnDevice, type DraftLine } from '../../src/lib/pricing'
import { OrderLineRow, Panel } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'
import { useEnqueueOrder } from '../../src/lib/queue'

export default function OrderEntry(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const api = useApi()
  const params = useLocalSearchParams<{ retailerId?: string }>()
  const retailerId = typeof params.retailerId === 'string' ? params.retailerId : ''
  const local = useLocalState()

  const shop = useShop(retailerId)
  const { byVariant, items: catalog } = useCatalogIndex()
  const { lists, items: listItems } = usePriceLists()
  const schemes = useSchemes()
  const overrides = useOverrides(retailerId)
  const bargains = useBargains(retailerId)
  const lastOrder = useLastOrderOf(retailerId)
  const lastLines = useOrderLines(lastOrder?.id ?? null)

  const { draft, restored, setQty, setNote, replaceLines, clear } = useOrderDraft(retailerId)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [bargainFor, setBargainFor] = useState<string | null>(null)
  const [placed, setPlaced] = useState<string | null>(null)

  /**
   * Available-to-promise, when there is signal.
   *
   * `sellable_stock` is NOT in the salesperson's device manifest, so with no signal the stepper
   * simply carries no availability line rather than an invented one. Over-available is an `ochre`
   * warning and never a block (UX-00 §6.4): the godown short-supplies, the doorway does not.
   */
  const stock = useQuery(
    ['inventory', 'sellable', 'all'],
    () => api.api.inventory.stock.sellable({ limit: 500 }),
    { staleTime: 120_000 },
  )
  const availableByVariant = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of stock.data?.items ?? [])
      totals.set(row.variantId, (totals.get(row.variantId) ?? 0) + row.available)
    return totals
  }, [stock.data])

  const quote = useMemo(() => {
    if (shop === null) return { result: null, unpriced: [], error: null }
    return quoteOnDevice(draft.lines, {
      retailer: shop,
      catalog: byVariant,
      priceLists: lists,
      priceListItems: listItems,
      schemes,
      overrides,
      bargains,
      pricingDate: today(),
      orderId: draft.id,
    })
  }, [shop, draft.lines, draft.id, byVariant, lists, listItems, schemes, overrides, bargains])

  const pricedById = useMemo(
    () => new Map((quote.result?.lines ?? []).map((line) => [line.lineId, line])),
    [quote.result],
  )

  /** The shop's own last basket, ready to be the whole order in one tap. */
  const usual: DraftLine[] = useMemo(
    () =>
      lastLines.map((line) => ({
        id: uuidv7(),
        variantId: line.variant_id,
        qtyPcs: line.qty_pcs ?? 0,
        enteredQty: line.entered_qty,
        enteredUnit: line.entered_unit === 'case' ? 'case' : 'piece',
      })),
    [lastLines],
  )

  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const inDraft = new Set(draft.lines.map((line) => line.variantId))
    const pool = catalog.filter((item) => !inDraft.has(item.variantId))
    if (needle === '') return pool.slice(0, 12)
    return pool
      .filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.productName.toLowerCase().includes(needle) ||
          (item.brandName ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 30)
  }, [catalog, query, draft.lines])

  const enqueueOrder = useEnqueueOrder()
  const engine = useSyncEngine()

  const place = useMutation(
    async (_input: null, meta) => {
      const lines = draft.lines
        .filter((line) => line.qtyPcs > 0)
        .map((line) => ({
          id: line.id,
          variantId: line.variantId,
          enteredQty: line.enteredQty,
          enteredUnit: line.enteredUnit,
        }))
      if (lines.length === 0) throw new Error(t('s3.noLines'))

      if (!local.online) {
        await enqueueOrder({
          orderId: draft.id,
          retailerId,
          note: draft.note,
          expectedDeliveryDate: draft.expectedDeliveryDate,
          lines: draft.lines.filter((line) => line.qtyPcs > 0),
          catalog: byVariant,
        })
        return { id: draft.id, queued: true as const }
      }

      /*
       * Two writes, two keys. A create and a submit are different intents against the same order, so
       * they cannot share an idempotency key (same key + different payload is a 409, by design) — and
       * both keys are derived from the ORDER's id, so a retry of a lost reply replays the same intent
       * instead of writing a second order.
       */
      await api.api.orders.create({
        id: draft.id,
        idempotencyKey: `${draft.id}:create`,
        retailerId,
        source: 'salesperson',
        pricingDateMode: 'order',
        note: draft.note.trim() === '' ? null : draft.note.trim(),
        expectedDeliveryDate: draft.expectedDeliveryDate,
        deviceId: deviceId(),
        lines,
      })
      await api.api.orders.submit({
        id: draft.id,
        idempotencyKey: `${draft.id}:submit`,
        deviceId: deviceId(),
      })
      void meta
      return { id: draft.id, queued: false as const }
    },
    {
      invalidates: [['orders']],
      onSuccess: (result) => {
        void forgetDraft(retailerId)
        setPlaced(result.id)
        /*
         * Pull straight away rather than waiting out the 60-second foreground tick: the order the rep
         * just placed is the one row they are about to open, and until it comes back down the device
         * has no copy of it (My orders, the shop card's order list and the order screen all read the
         * phone). A queued order needs no nudge — the outbox flushes on its own and the pull after a
         * successful upload batch brings the server's answer with it.
         */
        if (local.online) void engine?.sync('order placed')
      },
    },
  )

  if (shop === null) {
    return (
      <Screen title={t('s3.title')}>
        <EmptyState message={t('s2.notOnDevice')} />
      </Screen>
    )
  }

  const totalPcs = draft.lines.reduce((sum, line) => sum + line.qtyPcs, 0)
  const netPaise = quote.result?.totals.netPaise ?? 0
  const discountPaise = quote.result?.totals.discountPaise ?? 0

  return (
    <Screen
      title={t('s3.title')}
      context={shop.name}
      chips={
        <Row gap={2} wrap>
          <StatusChip
            label={t('s3.linesCount', { count: draft.lines.length })}
            family="neutral"
            figure
          />
          {discountPaise > 0 ? (
            <StatusChip
              label={t('s3.schemeTotal', { amount: formatINR(paise(discountPaise)) })}
              family="clay"
              figure
            />
          ) : null}
          {local.online ? null : <StatusChip label={t('s0.offlineChip')} family="ochre" />}
        </Row>
      }
      bottomBar={
        <Row gap={3} justify="between" align="center" padX={4} padY={2} wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('s3.summary', {
                lines: draft.lines.length,
                qty: formatQty(pieces(totalPcs), caseSizeOf(draft.lines, byVariant)),
              })}
            </Txt>
            <Money value={netPaise} size="moneyL" />
            {/*
              BEFORE GST, AND IT SAYS SO.

              `priceOrder()` answers the net of the lines; the bill this becomes adds GST on top —
              SO-1113 was ₹19,495.89 net and ₹21,781.00 on the invoice. The rate comes from the dated
              HSN table, which is NOT in this role's device manifest, so the phone genuinely cannot
              compute the tax. Printing the net as if it were the total is what a rep would read out
              across the counter, and it would be ₹2,285 short of the bill.
            */}
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('s3.beforeGst')}
            </Txt>
          </Stack>
          <Button
            testID="place-order"
            variant="primary"
            /*
             * The verb is the truth about what this tap does, and it changes with the radio: with
             * signal it PLACES the order (numbered, credit-checked); without one it saves it on the
             * phone and nothing has reached the office. `successLabel` is deliberately not used —
             * the kit renders it in place of the label from the first frame, so a button that
             * declares one reads "Order placed" before anybody has tapped it.
             */
            label={
              placed !== null
                ? local.online
                  ? t('s3.placed')
                  : t('s3.queued')
                : local.online
                  ? t('s3.place')
                  : t('s3.queue')
            }
            disabled={draft.lines.length === 0 || placed !== null}
            disabledReason={draft.lines.length === 0 ? t('s3.noLines') : undefined}
            loading={place.status === 'pending'}
            onPress={() => {
              place.mutate(null)
            }}
          />
        </Row>
      }
    >
      <Stack gap={5}>
        {placed !== null ? (
          <Panel
            title={local.online ? t('s3.placedTitle') : t('s3.queuedTitle')}
            meta={local.online ? t('s3.placedBody') : t('s3.queuedBody')}
          >
            <Row gap={3} wrap>
              <Button
                label={t('s3.openOrder')}
                onPress={() => {
                  router.replace(`/orders/${placed}`)
                }}
              />
              <Button
                label={t('s3.backToBeat')}
                variant="secondary"
                onPress={() => {
                  router.replace('/')
                }}
              />
            </Row>
          </Panel>
        ) : null}

        {place.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg}>
            {place.error.message}
          </Txt>
        )}

        {quote.unpriced.length > 0 ? (
          <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
            {t('s3.unpriced', {
              names: quote.unpriced
                .map((id) => byVariant.get(id)?.name ?? id.slice(0, 8))
                .join(', '),
            })}
          </Txt>
        ) : null}

        {draft.lines.length === 0 && usual.length > 0 ? (
          <Button
            testID="repeat-last"
            variant="primary"
            label={t('s3.repeatLast', { count: usual.length })}
            fullWidth
            onPress={() => {
              replaceLines(usual)
            }}
          />
        ) : null}

        <Panel
          title={t('s3.thisOrder')}
          actions={
            draft.lines.length === 0 ? undefined : (
              <Button
                label={t('s3.clear')}
                variant="ghost"
                onPress={() => {
                  clear()
                  setEditing(null)
                }}
              />
            )
          }
        >
          {!restored ? null : draft.lines.length === 0 ? (
            <EmptyState message={t('s3.emptyOrder')} />
          ) : (
            <Group footer={discountPaise > 0 ? schemeFooter(t, discountPaise) : undefined}>
              {draft.lines.map((line) => {
                const item = byVariant.get(line.variantId)
                const priced = pricedById.get(line.id)
                const caseSize = item?.caseSize ?? 1
                const available = availableByVariant.get(line.variantId)
                const schemeLabel = describeScheme(
                  priced?.discountPaise ?? 0,
                  priced?.freeQtyPcs ?? 0,
                  t,
                )
                return (
                  <OrderLineRow
                    key={line.id}
                    testID={`line-${line.variantId}`}
                    name={item?.name ?? line.variantId.slice(0, 8)}
                    qtyLine={
                      available === undefined
                        ? formatQty(pieces(line.qtyPcs), caseSize)
                        : `${formatQty(pieces(line.qtyPcs), caseSize)} · ${t('s3.available', {
                            cases: Math.floor(available / Math.max(1, caseSize)),
                          })}`
                    }
                    rateLine={
                      priced === undefined
                        ? undefined
                        : t('s3.rateLine', {
                            rate: formatINR(priced.ratePaise),
                            caseSize,
                          })
                    }
                    lineTotalPaise={priced?.lineNetPaise ?? null}
                    schemeLabel={schemeLabel}
                    editing={editing === line.id}
                    onPress={() => {
                      setEditing(editing === line.id ? null : line.id)
                    }}
                    stepper={
                      <Stack gap={3}>
                        <QtyStepper
                          testID={`stepper-${line.variantId}`}
                          pieces={line.qtyPcs}
                          caseSize={caseSize}
                          availablePieces={available ?? null}
                          onChange={(pieces) => {
                            setQty(line.variantId, pieces, 'case', caseSize)
                          }}
                          onOpenPieces={() => {
                            setQty(line.variantId, line.qtyPcs + 1, 'piece', caseSize)
                          }}
                        />
                        <Row gap={2} wrap>
                          <Button
                            label={t('s4.ask')}
                            variant="secondary"
                            onPress={() => {
                              setBargainFor(line.variantId)
                            }}
                          />
                          <Button
                            label={t('s3.removeLine')}
                            variant="ghost"
                            onPress={() => {
                              setQty(line.variantId, 0, 'case', caseSize)
                              setEditing(null)
                            }}
                          />
                        </Row>
                      </Stack>
                    }
                  />
                )
              })}
            </Group>
          )}
        </Panel>

        <Panel title={t('s3.addItems')} meta={t('s3.addItemsMeta', { count: catalog.length })}>
          <Stack gap={3}>
            <Search
              testID="item-search"
              value={query}
              onChange={setQuery}
              placeholder={t('s3.searchItems')}
              state={
                query.trim() === '' ? 'idle' : suggestions.length === 0 ? 'noResults' : 'results'
              }
            />
            <Group>
              {suggestions.map((item) => (
                <SuggestionRow
                  key={item.variantId}
                  item={item}
                  available={availableByVariant.get(item.variantId)}
                  onAdd={() => {
                    setQty(item.variantId, item.caseSize, 'case', item.caseSize)
                    setQuery('')
                  }}
                />
              ))}
            </Group>
          </Stack>
        </Panel>

        <Panel title={t('s3.note')}>
          <TextInput
            label={t('s3.noteLabel')}
            value={draft.note}
            onChange={setNote}
            capitalize="sentences"
            helper={t('s3.noteHelp')}
          />
        </Panel>
      </Stack>

      <BargainSheet
        open={bargainFor !== null}
        onClose={() => {
          setBargainFor(null)
        }}
        retailerId={retailerId}
        orderId={draft.id}
        item={bargainFor === null ? null : (byVariant.get(bargainFor) ?? null)}
        listRatePaise={
          bargainFor === null
            ? 0
            : (pricedById.get(draft.lines.find((line) => line.variantId === bargainFor)?.id ?? '')
                ?.listRatePaise ?? 0)
        }
        qtyPcs={draft.lines.find((line) => line.variantId === bargainFor)?.qtyPcs ?? 0}
        online={local.online}
      />
    </Screen>
  )
}

/** The case size the summary line counts in — the first line's, which is what a rep is holding. */
function caseSizeOf(lines: readonly DraftLine[], catalog: Map<string, CatalogItem>): number {
  const first = lines[0]
  if (first === undefined) return 1
  return catalog.get(first.variantId)?.caseSize ?? 1
}

function schemeFooter(
  t: (key: string, params?: Record<string, string | number>) => string,
  discountPaise: number,
): React.ReactNode {
  return (
    <Txt field="moneyM" desk="cell" numeric>
      {t('s3.schemeFooter', { amount: formatINR(paise(discountPaise)) })}
    </Txt>
  )
}

/** "−₹68 · 12 pc free", the scheme as it prints on the row (UX-00 §6.6). */
function describeScheme(
  discountPaise: number,
  freeQtyPcs: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string | undefined {
  if (discountPaise === 0 && freeQtyPcs === 0) return undefined
  const parts: string[] = []
  if (discountPaise > 0) parts.push(`−${formatINR(paise(discountPaise))}`)
  if (freeQtyPcs > 0) parts.push(t('qty.freeGoods', { pieces: freeQtyPcs }))
  return parts.join(' · ')
}

function SuggestionRow({
  item,
  available,
  onAdd,
}: {
  item: CatalogItem
  available: number | undefined
  onAdd: () => void
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  return (
    <Row
      gap={3}
      align="center"
      justify="between"
      padY={2}
      padX={3}
      border="bottom"
      borderTone="faint"
    >
      <Stack gap={1} grow>
        <Txt field="bodyStrong" desk="cell" numberOfLines={2}>
          {item.name}
        </Txt>
        <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
          {[item.brandName, t('s3.caseOf', { pieces: item.caseSize })]
            .filter((part) => part !== null && part !== '')
            .join(' · ')}
        </Txt>
      </Stack>
      <Row gap={2} align="center">
        {available === undefined ? null : (
          <StatusChip
            label={t('qty.available', {
              cases: Math.floor(available / Math.max(1, item.caseSize)),
            })}
            family={available === 0 ? 'brick' : 'neutral'}
            figure
          />
        )}
        {/*
         * `fullWidth={false}` on purpose, as in warehouse-app/app/pick/index.tsx: an inline row action
         * sizes to its label. A kit `<Button>` fills its parent by default, and on native that
         * `width: '100%'` claimed the whole row and left the growing name column beside it at 0 dp,
         * so the phone drew only anonymous "Add a case" buttons (DOS-077).
         */}
        <Button label={t('s3.addOneCase')} variant="secondary" fullWidth={false} onPress={onAdd} />
      </Row>
    </Row>
  )
}

interface BargainProps {
  open: boolean
  onClose: () => void
  retailerId: string
  orderId: string
  item: CatalogItem | null
  listRatePaise: number
  qtyPcs: number
  online: boolean
}

/**
 * S4 · Bargain request — ask for a lower rate; the server auto-approves it inside the rep's own bound.
 *
 * The bound (`pricing.bounds.list`, a salesperson reads only its own) is shown BEFORE the ask, so a
 * rep knows whether this is a decision or a request. It is not enforced here: `bargains.request`
 * decides, and a second copy of that rule in the app would be the copy that is wrong.
 *
 * There is no offline path. `bargain_requests` has no sync handler (docs/23 §3.4), so with no signal
 * the sheet says so rather than queueing an approval that would never arrive.
 */
function BargainSheet({
  open,
  onClose,
  retailerId,
  orderId,
  item,
  listRatePaise,
  qtyPcs,
  online,
}: BargainProps): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const engine = useSyncEngine()
  const [asked, setAsked] = useState('')
  const bounds = useQuery(['pricing', 'bounds', 'mine'], () => api.api.pricing.bounds.list({}), {
    staleTime: 600_000,
  })
  const bound = bounds.data?.items[0]

  const request = useMutation(
    (input: { askedRatePaise: number }, meta) =>
      api.api.pricing.bargains.request({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        retailerId,
        variantId: item?.variantId ?? '',
        askedRatePaise: input.askedRatePaise,
        qtyPcs: qtyPcs > 0 ? qtyPcs : undefined,
        orderId,
      }),
    {
      invalidates: [['pricing']],
      /*
       * An approved bargain is a PRICE, and the price on this screen is computed from the device's
       * own `bargain_requests` rows. Without a pull the sheet said "approved at once" and the line
       * underneath went on charging the old rate until the next 60-second tick — the rep would have
       * read out a number they had just been told was no longer the number.
       */
      onSuccess: () => {
        void engine?.sync('bargain decided')
      },
    },
  )

  const askedPaise = Math.round(Number(asked.replace(/[^\d.]/g, '')) * 100)
  const valid = Number.isSafeInteger(askedPaise) && askedPaise > 0 && askedPaise < listRatePaise
  const dropBps =
    listRatePaise === 0 || !valid
      ? 0
      : Math.round(((listRatePaise - askedPaise) / listRatePaise) * 10_000)
  const withinBound = bound === undefined ? null : dropBps <= bound.maxDiscountBps

  return (
    <Sheet open={open} onClose={onClose} title={t('s4.title')} testID="bargain-sheet">
      <Stack gap={4}>
        <Txt field="bodyStrong" desk="body">
          {item?.name ?? '—'}
        </Txt>
        <Row gap={4} wrap>
          <Stack gap={1}>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('s4.listRate')}
            </Txt>
            <Money value={listRatePaise} size="moneyM" />
          </Stack>
          {bound === undefined ? null : (
            <Stack gap={1}>
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('s4.yourBound')}
              </Txt>
              <Txt field="moneyM" desk="cell" numeric>
                {t('s4.boundPct', { pct: (bound.maxDiscountBps / 100).toFixed(2) })}
              </Txt>
            </Stack>
          )}
        </Row>

        <TextInput
          label={t('s4.askedRate')}
          value={asked}
          onChange={setAsked}
          keyboard="decimal"
          helper={t('s4.askedHelp')}
          error={asked !== '' && !valid ? t('s4.askedInvalid') : undefined}
        />

        {withinBound === null || !valid ? null : (
          <StatusChip
            label={withinBound ? t('s4.autoApproves') : t('s4.needsApproval')}
            family={withinBound ? 'moss' : 'ochre'}
          />
        )}

        {request.data === undefined ? null : (
          <StatusChip
            label={t('s4.outcome', { status: word(request.data.item.status) })}
            family={
              request.data.item.status === 'auto_approved' ||
              request.data.item.status === 'approved'
                ? 'moss'
                : request.data.item.status === 'rejected'
                  ? 'brick'
                  : 'ochre'
            }
          />
        )}
        {request.data === undefined ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {/*
              The answer is immediate; the PRICE on the row behind this sheet is not. The rate this
              screen charges is computed from the device's own `bargain_requests` rows, and those
              arrive on the next pull — seconds on a warm device, up to a minute while a fresh
              install is still filling up. Saying so beats a rep watching an unchanged figure.
            */}
            {t('s4.appliesAfterSync')}
          </Txt>
        )}
        {request.error === undefined ? null : (
          <Txt field="label" desk="meta" color={colors.status.brick.fg}>
            {request.error.message}
          </Txt>
        )}

        <Button
          testID="ask-bargain"
          variant="primary"
          label={t('s4.ask')}
          fullWidth
          disabled={!online || !valid || item === null}
          disabledReason={online ? undefined : t('s4.needsSignal')}
          loading={request.status === 'pending'}
          onPress={() => {
            request.mutate({ askedRatePaise: askedPaise })
          }}
        />
      </Stack>
    </Sheet>
  )
}
