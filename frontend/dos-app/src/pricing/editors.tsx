/**
 * DOS-212 and DOS-214 — the desk's credit and pricing editors, shared by the owner and the manager.
 *
 * `PERMISSIONS` gives `retailers.setCredit`, `pricing.priceLists.setItems`, `pricing.overrides.upsert`
 * and `pricing.schemes.upsert` to exactly the owner and the manager (MANAGEMENT); the accountant and the
 * field never reach these surfaces (the screens gate on `can(...)`, and the server answers 403 anyway).
 * Two desks, one editor each: the conversions are `./forms` and these are the surfaces around them.
 * They live at install level because docs/31 §6.4 lets a group import `src/` and never another group.
 *
 * THE SAVE STATE IS HONEST (never-list #12). A surface says "saved" only after the 2xx: it closes and
 * the screen shows its toast. A refused write keeps the surface open, keeps every field as typed, and
 * prints the service's own sentence where the button is (the DOS-029 rule, through `useRefusal`). A
 * draft the contract would refuse is never sent: the first thing wrong with it is printed instead.
 *
 * Screens import only `@dos/ui` for rendering, and so does this file.
 */
import type {
  PriceList,
  PriceListItem,
  Retailer,
  RetailerPriceOverride,
  Scheme,
} from '@dos/contracts'
import { useApi, useMutation, useQuery, useRefusal, useSession } from '@dos/api-client/react'
import { isAllowed, permissionFor, type PermissionRole } from '@dos/contracts'
import {
  Button,
  Chips,
  Dialog,
  RupeeInput,
  Segments,
  Sheet,
  Stack,
  TextInput,
  Txt,
  formatINR,
  paise,
  useColors,
  useStrings,
  wordFor,
} from '@dos/ui'
import { businessDate, uuidv7 } from '@dos/domain'
import { useState, type ReactNode } from 'react'

import {
  AMOUNT_REWARDS,
  CREDIT_MODES,
  PAYMENT_TERMS,
  PCT_REWARDS,
  REWARD_KINDS,
  TIERS,
  creditDraftOf,
  creditPayload,
  creditUnchanged,
  endOverride,
  newOverrideDraft,
  newSchemeDraft,
  overrideDraftOf,
  overridePayload,
  overrideState,
  priceItemPayload,
  schemeDraftOf,
  schemePayload,
  type CreditDraft,
  type CreditMode,
  type OverrideDraft,
  type PaymentTerms,
  type RewardKind,
  type SchemeDraft,
  type ScopeMode,
  type Tier,
} from './forms'

/** Today in IST, the business calendar every date on these editors is read in. */
export function todayIst(): string {
  return businessDate().date
}

const MAX_MATCHES = 8

/**
 * Whether the signed-in role may make this write, from the SAME matrix the server enforces
 * (`PERMISSIONS`). A control the matrix refuses is absent, never greyed out without a cause.
 */
export function useMayWrite(): (path: string) => boolean {
  const { session } = useSession()
  const role = session?.role as PermissionRole | undefined
  return (path) => isAllowed(permissionFor(path), role ?? null)
}

// ---------------------------------------------------------------------------------------------------------------
// small furniture

/** A problem with the draft (a `px.*` key) or the service's refusal, in the refusal colour. */
function Problem({ text, testID }: { text: string | null; testID: string }): React.JSX.Element {
  const colors = useColors()
  if (text === null) return <></>
  return (
    <Txt field="body" desk="body" color={colors.status.brick.fg} testID={testID}>
      {text}
    </Txt>
  )
}

function Hint({ children }: { children: ReactNode }): React.JSX.Element {
  const colors = useColors()
  return (
    <Txt field="label" desk="meta" color={colors.text.secondary}>
      {children}
    </Txt>
  )
}

/** The service's sentence for the last refused write of a surface; a lost connection says so plainly. */
function useRefusalText(
  writes: Parameters<typeof useRefusal>[0],
  scope: string | null,
): string | null {
  const t = useStrings()
  const refusal = useRefusal(writes, scope)
  if (refusal === undefined) return null
  return refusal.kind === 'network' ? t('app.writeNoConnection') : refusal.message
}

interface CatalogItem {
  variantId: string
  name: string
}

/** The distributor's listed items, named the way its orders name them (listing alias, else the variant). */
function useCatalog(): { items: readonly CatalogItem[]; name: (variantId: string) => string } {
  const api = useApi()
  const catalog = useQuery(['tenantCatalog', 'forPrices'], () =>
    api.api.tenantCatalog.list({ limit: 500, listedOnly: true }),
  )
  const items = (catalog.data?.items ?? []).map((row) => ({
    variantId: row.variantId,
    name: row.localAlias ?? row.name,
  }))
  return {
    items,
    name: (variantId) =>
      items.find((row) => row.variantId === variantId)?.name ?? variantId.slice(0, 8),
  }
}

/** The shops, for the shop picker. Same key and call as the desks' name lookups, so it is one read. */
function useShops(): readonly { id: string; name: string; code: string }[] {
  const api = useApi()
  const shops = useQuery(
    ['names', 'retailers'],
    () => api.api.retailers.list({ limit: 500, activeOnly: true }),
    { staleTime: 300_000 },
  )
  return (shops.data?.items ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    code: 'code' in row ? row.code : '',
  }))
}

/**
 * Type part of a name, pick one of the matches. A select of 171 items is unusable on a phone and a
 * free-text id is unusable anywhere, so the picker is a search field over the list the desk already
 * has and at most eight matches as chips; the picked one stays visible with a tick.
 */
function Picker({
  label,
  helper,
  noMatch,
  options,
  picked,
  onPick,
  multi = false,
  testID,
}: {
  label: string
  helper: string
  noMatch: string
  options: readonly { id: string; label: string }[]
  picked: readonly string[]
  onPick: (id: string) => void
  multi?: boolean
  testID: string
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const matches =
    needle === ''
      ? []
      : options.filter((row) => row.label.toLowerCase().includes(needle)).slice(0, MAX_MATCHES)
  const pickedRows = options.filter((row) => picked.includes(row.id))
  const shown = [...pickedRows, ...matches.filter((row) => !picked.includes(row.id))]
  return (
    <Stack gap={2}>
      <TextInput
        label={label}
        value={q}
        onChange={setQ}
        helper={helper}
        capitalize="none"
        testID={`${testID}-search`}
      />
      {needle !== '' && matches.length === 0 ? <Hint>{noMatch}</Hint> : null}
      {shown.length === 0 ? null : (
        <Chips
          testID={`${testID}-matches`}
          items={shown.map((row) => ({
            id: row.id,
            label: row.label,
            selected: picked.includes(row.id),
          }))}
          onToggle={(id) => {
            onPick(id)
            if (!multi) setQ('')
          }}
        />
      )}
    </Stack>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-212 — the credit dialog

/**
 * Limit, days to pay, what happens over the limit, and how the shop pays — the four things the desk
 * decides about a shop's credit, in one `retailers.setCredit`. The dialog opens on the shop's CURRENT
 * values, printed first in one line, so the desk reads what it is changing before it changes it.
 */
export function CreditDialog({
  shop,
  open,
  onClose,
  onSaved,
}: {
  shop: Retailer | null
  open: boolean
  onClose: () => void
  onSaved: (message: string) => void
}): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const [draft, setDraft] = useState<CreditDraft | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  const save = useMutation(
    (input: Extract<ReturnType<typeof creditPayload>, { ok: true }>['input'], meta) =>
      api.api.retailers.setCredit({ ...input, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['retailers'], ['receivables'], ['names']] },
  )
  const refusal = useRefusalText([save], shop?.id ?? null)

  // A new opening starts from the shop as it is now (the pattern React documents for derived state).
  const key = open && shop !== null ? shop.id : null
  if (key !== openedFor) {
    setOpenedFor(key)
    setDraft(shop === null ? null : creditDraftOf(shop))
    setProblem(null)
  }
  const current = draft ?? (shop === null ? null : creditDraftOf(shop))
  const update = (patch: Partial<CreditDraft>): void => {
    if (current === null) return
    setDraft({ ...current, ...patch })
    setProblem(null)
  }

  return (
    <Dialog
      open={open && shop !== null}
      onClose={onClose}
      title={t('px.creditTitle', { shop: shop?.name ?? '' })}
      testID="credit-dialog"
      body={
        shop === null || current === null ? (
          <></>
        ) : (
          <Stack gap={3}>
            <Hint>
              {t('px.creditNow', {
                limit: formatINR(paise(shop.creditLimitPaise)),
                days: shop.creditDays,
                mode: wordFor(t, shop.creditMode),
                terms: wordFor(t, shop.paymentTerms),
              })}
            </Hint>
            <RupeeInput
              label={t('px.creditLimit')}
              value={current.limitPaise}
              onChange={(limitPaise) => {
                update({ limitPaise })
              }}
              testID="credit-limit"
            />
            <TextInput
              label={t('px.creditDays')}
              value={current.daysText}
              onChange={(daysText) => {
                update({ daysText })
              }}
              keyboard="decimal"
              testID="credit-days"
            />
            <Stack gap={1}>
              <Txt field="label" desk="meta">
                {t('px.creditMode')}
              </Txt>
              <Segments
                testID="credit-mode"
                value={current.mode}
                onChange={(mode) => {
                  update({ mode: mode as CreditMode })
                }}
                items={CREDIT_MODES.map((mode) => ({ id: mode, label: wordFor(t, mode) }))}
              />
              <Hint>{t(`px.creditModeHelp.${current.mode}`)}</Hint>
            </Stack>
            <Stack gap={1}>
              <Txt field="label" desk="meta">
                {t('px.terms')}
              </Txt>
              <Segments
                testID="credit-terms"
                value={current.terms}
                onChange={(terms) => {
                  update({ terms: terms as PaymentTerms })
                }}
                items={PAYMENT_TERMS.map((terms) => ({ id: terms, label: wordFor(t, terms) }))}
              />
              <Hint>{t(`px.termsHelp.${current.terms}`)}</Hint>
            </Stack>
            <Problem text={problem ?? refusal} testID="credit-problem" />
          </Stack>
        )
      }
      confirmLabel={t('px.saveCredit')}
      busy={save.status === 'pending'}
      onConfirm={() => {
        if (shop === null || current === null) return
        if (creditUnchanged(shop, current)) {
          setProblem(t('px.nothingChanged'))
          return
        }
        const built = creditPayload(shop, current)
        if (!built.ok) {
          setProblem(t(built.problem))
          return
        }
        void save.mutateAsync(built.input).then(
          () => {
            onClose()
            onSaved(t('px.creditSaved'))
          },
          () => {
            /* stays open: the refusal is on the mutation and printed above */
          },
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-214 — one rate on a price list

/**
 * Change one rate, or add an item to the list. One `pricing.priceLists.setItems` with ONE item: the
 * server upserts per variant, so no other rate on the list is re-sent or overwritten.
 */
export function PriceRateDialog({
  list,
  item,
  open,
  onClose,
  onSaved,
}: {
  list: PriceList | null
  /** The row being changed; `null` = add an item to the list. */
  item: PriceListItem | null
  open: boolean
  onClose: () => void
  onSaved: (message: string) => void
}): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const catalog = useCatalog()
  const [ratePaise, setRatePaise] = useState<number | null>(null)
  const [inclusive, setInclusive] = useState(false)
  const [variantId, setVariantId] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  /* A new row's id is minted per OPENING, so a second "add" never re-uses the first one's row. */
  const [newId, setNewId] = useState(() => uuidv7())

  const save = useMutation(
    (input: Extract<ReturnType<typeof priceItemPayload>, { ok: true }>['input'], meta) =>
      api.api.pricing.priceLists.setItems({ ...input, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['pricing']] },
  )

  const key = open && list !== null ? `${list.id}:${item?.id ?? 'new'}` : null
  const refusal = useRefusalText([save], key)
  if (key !== openedFor) {
    setOpenedFor(key)
    setNewId(uuidv7())
    setRatePaise(item?.ratePaise ?? null)
    setInclusive(item?.inclusiveOfGst ?? false)
    setVariantId(item?.variantId ?? '')
    setProblem(null)
  }

  const existing =
    item ?? list?.items.find((row) => row.variantId === variantId && variantId !== '') ?? null

  return (
    <Dialog
      open={open && list !== null}
      onClose={onClose}
      title={item === null ? t('px.addItemTitle', { list: list?.name ?? '' }) : t('px.changeRate')}
      testID="rate-dialog"
      body={
        <Stack gap={3}>
          {item === null ? (
            <>
              <Picker
                label={t('px.findItem')}
                helper={t('px.findItemHelp')}
                noMatch={t('px.noItemMatch')}
                options={catalog.items.map((row) => ({ id: row.variantId, label: row.name }))}
                picked={variantId === '' ? [] : [variantId]}
                onPick={(id) => {
                  setVariantId(id === variantId ? '' : id)
                  const onList = list?.items.find((row) => row.variantId === id)
                  if (onList !== undefined) {
                    setRatePaise(onList.ratePaise)
                    setInclusive(onList.inclusiveOfGst)
                  }
                  setProblem(null)
                }}
                testID="rate-item"
              />
              {existing === null ? null : (
                <Hint>{t('px.alreadyOnList', { rate: formatINR(paise(existing.ratePaise)) })}</Hint>
              )}
            </>
          ) : (
            <>
              <Txt field="bodyStrong" desk="body">
                {item.variantName}
              </Txt>
              <Hint>
                {t('px.rateNow', {
                  rate: formatINR(paise(item.ratePaise)),
                  list: list?.name ?? '',
                })}
              </Hint>
            </>
          )}
          <RupeeInput
            label={t('px.newRate')}
            value={ratePaise}
            onChange={(value) => {
              setRatePaise(value)
              setProblem(null)
            }}
            testID="rate-value"
          />
          <Stack gap={1}>
            <Txt field="label" desk="meta">
              {t('px.gst')}
            </Txt>
            <Segments
              testID="rate-gst"
              value={inclusive ? 'incl' : 'excl'}
              onChange={(id) => {
                setInclusive(id === 'incl')
              }}
              items={[
                { id: 'excl', label: t('px.gstExcluded') },
                { id: 'incl', label: t('px.gstIncluded') },
              ]}
            />
          </Stack>
          <Hint>{t('px.rateApplies')}</Hint>
          <Problem text={problem ?? refusal} testID="rate-problem" />
        </Stack>
      }
      confirmLabel={item === null ? t('px.addItem') : t('px.saveRate')}
      busy={save.status === 'pending'}
      onConfirm={() => {
        if (list === null) return
        const built = priceItemPayload({
          priceListId: list.id,
          itemId: existing?.id ?? newId,
          variantId,
          ratePaise,
          inclusiveOfGst: inclusive,
        })
        if (!built.ok) {
          setProblem(t(built.problem))
          return
        }
        void save.mutateAsync(built.input).then(
          () => {
            onClose()
            onSaved(t('px.rateSaved'))
          },
          () => {
            /* stays open with the refusal printed */
          },
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-214 — a shop's own rate

/**
 * Set a shop's own rate for one item — optionally FINAL, so no scheme comes off it — or change or end
 * one. The engine prices with the newest running rate of a shop and item, so setting a rate for a pair
 * that already has one running edits that row instead of stacking a second.
 */
export function OverrideSheet({
  open,
  row,
  rows,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The rate being changed; `null` = a new one. */
  row: RetailerPriceOverride | null
  /** Every shop rate the screen has, to find a running one for the same shop and item. */
  rows: readonly RetailerPriceOverride[]
  onClose: () => void
  onSaved: (message: string) => void
}): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const catalog = useCatalog()
  const shops = useShops()
  const today = todayIst()
  const [draft, setDraft] = useState<OverrideDraft>(() => newOverrideDraft(today))
  const [problem, setProblem] = useState<string | null>(null)
  const [ending, setEnding] = useState(false)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const [newId, setNewId] = useState(() => uuidv7())

  const save = useMutation(
    (input: Extract<ReturnType<typeof overridePayload>, { ok: true }>['input'], meta) =>
      api.api.pricing.overrides.upsert({ ...input, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['pricing']] },
  )

  const key = open ? (row?.id ?? 'new') : null
  const refusal = useRefusalText([save], key)
  if (key !== openedFor) {
    setOpenedFor(key)
    setNewId(uuidv7())
    setDraft(row === null ? newOverrideDraft(today) : overrideDraftOf(row))
    setProblem(null)
    setEnding(false)
  }
  const update = (patch: Partial<OverrideDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setProblem(null)
  }

  const shopName = (id: string): string => shops.find((s) => s.id === id)?.name ?? id.slice(0, 8)
  const running =
    row ??
    rows.find(
      (r) =>
        r.retailerId === draft.retailerId &&
        r.variantId === draft.variantId &&
        overrideState(r, today) === 'running',
    ) ??
    null
  const ended = row === null ? null : endOverride(row, today)

  const submit = (payload: Parameters<typeof save.mutateAsync>[0], message: string): void => {
    void save.mutateAsync(payload).then(
      () => {
        setEnding(false)
        onClose()
        onSaved(message)
      },
      () => {
        /* stays open with the refusal printed */
      },
    )
  }

  return (
    <>
      <Sheet
        open={open && !ending}
        onClose={onClose}
        title={row === null ? t('px.setShopRate') : t('px.editShopRate')}
        testID="override-sheet"
      >
        <Stack gap={4}>
          {row === null ? (
            <>
              <Picker
                label={t('px.findShop')}
                helper={t('px.findShopHelp')}
                noMatch={t('px.noShopMatch')}
                options={shops.map((s) => ({
                  id: s.id,
                  label: s.code === '' ? s.name : `${s.name} · ${s.code}`,
                }))}
                picked={draft.retailerId === '' ? [] : [draft.retailerId]}
                onPick={(id) => {
                  update({ retailerId: id === draft.retailerId ? '' : id })
                }}
                testID="override-shop"
              />
              <Picker
                label={t('px.findItem')}
                helper={t('px.findItemHelp')}
                noMatch={t('px.noItemMatch')}
                options={catalog.items.map((c) => ({ id: c.variantId, label: c.name }))}
                picked={draft.variantId === '' ? [] : [draft.variantId]}
                onPick={(id) => {
                  update({ variantId: id === draft.variantId ? '' : id })
                }}
                testID="override-item"
              />
              {running === null ? null : (
                <Hint>{t('px.replaces', { rate: formatINR(paise(running.ratePaise)) })}</Hint>
              )}
            </>
          ) : (
            <Stack gap={1}>
              <Txt field="bodyStrong" desk="body">
                {t('px.pickedShop', { name: shopName(row.retailerId) })}
              </Txt>
              <Txt field="body" desk="body">
                {t('px.pickedItem', { name: catalog.name(row.variantId) })}
              </Txt>
              <Hint>{t(`px.state.${overrideState(row, today)}`)}</Hint>
            </Stack>
          )}
          <RupeeInput
            label={t('px.shopRate')}
            value={draft.ratePaise}
            onChange={(ratePaise) => {
              update({ ratePaise })
            }}
            testID="override-rate"
          />
          <Stack gap={1}>
            <Txt field="label" desk="meta">
              {t('px.final')}
            </Txt>
            <Segments
              testID="override-final"
              value={draft.final ? 'final' : 'open'}
              onChange={(id) => {
                update({ final: id === 'final' })
              }}
              items={[
                { id: 'open', label: t('px.finalNo') },
                { id: 'final', label: t('px.finalYes') },
              ]}
            />
            <Hint>{t('px.finalHelp')}</Hint>
          </Stack>
          <TextInput
            label={t('px.from')}
            value={draft.validFrom}
            onChange={(validFrom) => {
              update({ validFrom })
            }}
            testID="override-from"
          />
          <TextInput
            label={t('px.to')}
            value={draft.validTo}
            onChange={(validTo) => {
              update({ validTo })
            }}
            testID="override-to"
          />
          <TextInput
            label={t('px.note')}
            value={draft.note}
            onChange={(note) => {
              update({ note })
            }}
            capitalize="sentences"
            maxLength={200}
            testID="override-note"
          />
          <Problem text={problem ?? refusal} testID="override-problem" />
          <Button
            label={t('px.saveShopRate')}
            variant="primary"
            loading={save.status === 'pending'}
            onPress={() => {
              const built = overridePayload(running?.id ?? newId, draft)
              if (!built.ok) {
                setProblem(t(built.problem))
                return
              }
              submit(built.input, t('px.shopRateSaved'))
            }}
            testID="override-save"
          />
          {row === null || overrideState(row, today) === 'ended' ? null : (
            <Button
              label={t('px.endRate')}
              variant="destructive"
              onPress={() => {
                setEnding(true)
              }}
              testID="override-end"
            />
          )}
          <Button label={t('px.cancel')} variant="ghost" onPress={onClose} />
        </Stack>
      </Sheet>
      <Dialog
        open={open && ending && row !== null}
        onClose={() => {
          setEnding(false)
        }}
        title={t('px.endRateTitle')}
        destructive
        testID="override-end-dialog"
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {row === null || ended === null
                ? ''
                : t('px.endRateBody', {
                    shop: shopName(row.retailerId),
                    item: catalog.name(row.variantId),
                    date: ended.backOn,
                  })}
            </Txt>
            <Problem text={refusal} testID="override-end-problem" />
          </Stack>
        }
        confirmLabel={t('px.endRate')}
        busy={save.status === 'pending'}
        onConfirm={() => {
          if (ended === null) return
          submit(ended.payload, t('px.rateEnded'))
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// DOS-214 — a scheme

/** Narrow a `schemes.list` row to the back-office shape (the desk always gets it). */
export function deskScheme<T extends { id: string }>(row: T): (T & Scheme) | null {
  return 'fundingSource' in row ? (row as T & Scheme) : null
}

/**
 * Create or edit a scheme: what it gives, when it applies, on which items and shops, for which dates,
 * whether it stacks with the others or applies on its own, who pays for it, and whether it is running.
 * What the editor does not offer (slabs, a brand scope, named shops, the claim) is kept as it was and
 * says so, so saving an existing scheme never changes what nobody touched.
 */
export function SchemeSheet({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean
  /** The scheme being edited; `null` = a new one. */
  row: Scheme | null
  onClose: () => void
  onSaved: (message: string) => void
}): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const catalog = useCatalog()
  const today = todayIst()
  const [draft, setDraft] = useState<SchemeDraft>(() => newSchemeDraft(today))
  const [problem, setProblem] = useState<string | null>(null)
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  const [newId, setNewId] = useState(() => uuidv7())

  const save = useMutation(
    (input: Extract<ReturnType<typeof schemePayload>, { ok: true }>['input'], meta) =>
      api.api.pricing.schemes.upsert({ ...input, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['pricing']] },
  )

  const key = open ? (row?.id ?? 'new') : null
  const refusal = useRefusalText([save], key)
  if (key !== openedFor) {
    setOpenedFor(key)
    setNewId(uuidv7())
    setDraft(row === null ? newSchemeDraft(today) : schemeDraftOf(row))
    setProblem(null)
  }
  const update = (patch: Partial<SchemeDraft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setProblem(null)
  }

  const kept: string[] = []
  if (draft.kept.slabs !== null && draft.kept.slabs.length > 0) kept.push(t('px.keptSlabs'))
  if (draft.kept.retailerIds !== undefined || draft.kept.beatIds !== undefined)
    kept.push(t('px.keptShops'))
  if (draft.kept.claimable) kept.push(t('px.keptClaim'))

  const pct = PCT_REWARDS.includes(draft.rewardKind)
  const amount = AMOUNT_REWARDS.includes(draft.rewardKind)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={row === null ? t('px.newScheme') : t('px.editScheme')}
      testID="scheme-sheet"
    >
      <Stack gap={4}>
        <TextInput
          label={t('px.schemeName')}
          value={draft.name}
          onChange={(name) => {
            update({ name })
          }}
          capitalize="sentences"
          maxLength={120}
          testID="scheme-name"
        />

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.gives')}
          </Txt>
          <Chips
            testID="scheme-reward-kind"
            items={REWARD_KINDS.map((kind) => ({
              id: kind,
              label: t(`px.reward.${kind}`),
              selected: draft.rewardKind === kind,
            }))}
            onToggle={(id) => {
              update({ rewardKind: id as RewardKind })
            }}
          />
        </Stack>
        {amount ? (
          <RupeeInput
            label={t('px.amount')}
            value={draft.rewardPaise}
            onChange={(rewardPaise) => {
              update({ rewardPaise })
            }}
            testID="scheme-reward-amount"
          />
        ) : (
          <TextInput
            label={pct ? t('px.percent') : t('px.freePieces')}
            helper={pct ? t('px.percentHelp') : t('px.freeHelp')}
            value={draft.rewardText}
            onChange={(rewardText) => {
              update({ rewardText })
            }}
            keyboard="decimal"
            testID="scheme-reward-value"
          />
        )}

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.when')}
          </Txt>
          <Segments
            testID="scheme-trigger-kind"
            value={draft.triggerKind}
            onChange={(id) => {
              update({
                triggerKind: id as SchemeDraft['triggerKind'],
                triggerUnit:
                  id === 'value' ? 'inr' : draft.triggerUnit === 'inr' ? 'pcs' : draft.triggerUnit,
              })
            }}
            items={[
              { id: 'qty', label: t('px.whenQty') },
              { id: 'value', label: t('px.whenValue') },
              ...(draft.triggerKind === 'mix' ? [{ id: 'mix', label: t('px.whenMix') }] : []),
            ]}
          />
        </Stack>
        {draft.triggerKind === 'value' ? (
          <RupeeInput
            label={t('px.billAtLeast')}
            value={draft.triggerPaise}
            onChange={(triggerPaise) => {
              update({ triggerPaise })
            }}
            testID="scheme-trigger-value"
          />
        ) : draft.triggerUnit === 'inr' ? null : (
          <>
            <Stack gap={1}>
              <Txt field="label" desk="meta">
                {t('px.unit')}
              </Txt>
              <Segments
                testID="scheme-trigger-unit"
                value={draft.triggerUnit}
                onChange={(id) => {
                  update({ triggerUnit: id as SchemeDraft['triggerUnit'] })
                }}
                items={[
                  { id: 'pcs', label: t('px.unitPcs') },
                  { id: 'case', label: t('px.unitCase') },
                ]}
              />
            </Stack>
            <TextInput
              label={t('px.atLeast')}
              value={draft.triggerCountText}
              onChange={(triggerCountText) => {
                update({ triggerCountText })
              }}
              keyboard="decimal"
              testID="scheme-trigger-count"
            />
          </>
        )}

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.on')}
          </Txt>
          <Segments
            testID="scheme-scope"
            value={draft.scopeMode}
            onChange={(id) => {
              update({ scopeMode: id as ScopeMode })
            }}
            items={[
              { id: 'all', label: t('px.onAll') },
              { id: 'items', label: t('px.onItems') },
              ...(row !== null && schemeDraftOf(row).scopeMode === 'kept'
                ? [{ id: 'kept', label: t('px.onKept') }]
                : []),
            ]}
          />
          {draft.scopeMode === 'kept' ? <Hint>{t('px.onKeptHelp')}</Hint> : null}
        </Stack>
        {draft.scopeMode === 'items' ? (
          <Stack gap={1}>
            <Picker
              label={t('px.findItem')}
              helper={t('px.findItemHelp')}
              noMatch={t('px.noItemMatch')}
              options={catalog.items.map((c) => ({ id: c.variantId, label: c.name }))}
              picked={draft.variantIds}
              multi
              onPick={(id) => {
                update({
                  variantIds: draft.variantIds.includes(id)
                    ? draft.variantIds.filter((v) => v !== id)
                    : [...draft.variantIds, id],
                })
              }}
              testID="scheme-items"
            />
            <Hint>{t('px.itemsPicked', { count: draft.variantIds.length })}</Hint>
          </Stack>
        ) : null}

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.shops')}
          </Txt>
          <Chips
            testID="scheme-tiers"
            items={TIERS.map((tier) => ({
              id: tier,
              label: t('px.tier', { tier }),
              selected: draft.tiers.includes(tier),
            }))}
            onToggle={(id) => {
              const tier = id as Tier
              update({
                tiers: draft.tiers.includes(tier)
                  ? draft.tiers.filter((x) => x !== tier)
                  : [...draft.tiers, tier],
              })
            }}
          />
          <Hint>{t('px.shopsHelp')}</Hint>
        </Stack>

        <TextInput
          label={t('px.from')}
          value={draft.validFrom}
          onChange={(validFrom) => {
            update({ validFrom })
          }}
          testID="scheme-from"
        />
        <TextInput
          label={t('px.toRequired')}
          value={draft.validTo}
          onChange={(validTo) => {
            update({ validTo })
          }}
          testID="scheme-to"
        />

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.stacking')}
          </Txt>
          <Segments
            testID="scheme-exclusive"
            value={draft.exclusive ? 'alone' : 'stacks'}
            onChange={(id) => {
              update({ exclusive: id === 'alone' })
            }}
            items={[
              { id: 'stacks', label: t('px.stacks') },
              { id: 'alone', label: t('px.exclusive') },
            ]}
          />
          <Hint>{t('px.exclusiveHelp')}</Hint>
        </Stack>

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.paidBy')}
          </Txt>
          <Segments
            testID="scheme-funding"
            value={draft.fundingSource}
            onChange={(id) => {
              update({ fundingSource: id as SchemeDraft['fundingSource'] })
            }}
            items={[
              { id: 'company', label: t('px.paidCompany') },
              { id: 'distributor', label: t('px.paidUs') },
            ]}
          />
        </Stack>

        <Stack gap={1}>
          <Txt field="label" desk="meta">
            {t('px.status')}
          </Txt>
          <Segments
            testID="scheme-active"
            value={draft.active ? 'on' : 'off'}
            onChange={(id) => {
              update({ active: id === 'on' })
            }}
            items={[
              { id: 'on', label: t('px.running') },
              { id: 'off', label: t('px.paused') },
            ]}
          />
        </Stack>

        {kept.length === 0 ? null : <Hint>{t('px.kept', { what: kept.join(', ') })}</Hint>}
        <Problem text={problem ?? refusal} testID="scheme-problem" />
        <Button
          label={t('px.saveScheme')}
          variant="primary"
          loading={save.status === 'pending'}
          onPress={() => {
            const built = schemePayload(row?.id ?? newId, draft)
            if (!built.ok) {
              setProblem(t(built.problem))
              return
            }
            void save.mutateAsync(built.input).then(
              () => {
                onClose()
                onSaved(t('px.schemeSaved'))
              },
              () => {
                /* stays open with the refusal printed */
              },
            )
          }}
          testID="scheme-save"
        />
        <Button label={t('px.cancel')} variant="ghost" onPress={onClose} />
      </Stack>
    </Sheet>
  )
}
