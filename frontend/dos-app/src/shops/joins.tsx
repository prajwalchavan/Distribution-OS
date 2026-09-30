/**
 * THE DESK DECIDES (founder, 2026-09-29, docs/22 §8 "The shopkeeper is independent") — "Shops asking to join" on the
 * owner's and the manager's shops screen, and the shop code on a shop's page. Shared by both desks; it lives at
 * install level, beside `sign-in.tsx`, because a group may import `src/` and never another group (docs/31 §6.4).
 *
 * A shopkeeper who signed up alone asks to be joined to one of this distributor's shops — by the shop code on its
 * bill, or by finding the distributor by name and typing the shop's name. Each waiting request shows WHO asks (the
 * name and the mobile number of the account, and what they call the shop) and, for a code, WHICH shop. Approve
 * joins them to the shop: they see its bills, dues and rates in their own app, and anyone who already signs in for
 * the shop keeps their sign-in (a shop may have more than one shopkeeper account, each its own person). For a
 * request by name the desk first says which of its shops it is. Refuse asks for the one line the shopkeeper reads.
 *
 * `retailers.joins.*` is the owner's and the manager's alone (PERMISSIONS): for anybody else this renders nothing.
 * Screens import only `@dos/ui` for rendering, and so does this file.
 */
import type { JoinRequest, JoinRequestsListOut, Retailer } from '@dos/contracts'
import {
  useApi,
  useMutation,
  useQuery,
  useRefusal,
  type UseQueryResult,
} from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Group,
  ListRow,
  Row,
  Search,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useState, type ReactNode } from 'react'

import { useMayWrite } from '../pricing/editors'

/** How many of the desk's shops the approve dialog offers at once for a request by name. */
const PICK_ROWS = 5

/** The waiting requests, as both desks' shops screens and homes read them: the same key, one read. */
export const WAITING_JOINS_KEY = ['retailers', 'joins', 'waiting'] as const

/** The owner's and the manager's read of the waiting list; `undefined` for anybody the matrix refuses. */
export function useWaitingJoins(): UseQueryResult<JoinRequestsListOut> & { allowed: boolean } {
  const api = useApi()
  const may = useMayWrite()
  const allowed = may('retailers.joins.list')
  const read = useQuery(
    [...WAITING_JOINS_KEY],
    () => api.api.retailers.joins.list({ state: 'waiting', limit: 100 }),
    { enabled: allowed },
  )
  return { ...read, allowed }
}

type Step =
  | { kind: 'approve'; request: JoinRequest; q: string; shop: { id: string; name: string } | null }
  | { kind: 'refuse'; request: JoinRequest; reason: string; problem: string | null }
  | null

export interface JoinRequestsPanelProps {
  /** The screen's toast, for "Joined to the shop" / "Request refused". */
  onToast: (message: string) => void
}

/** "Shops asking to join": nothing at all while none waits, so the shops screen stays the register. */
export function JoinRequestsPanel({ onToast }: JoinRequestsPanelProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const may = useMayWrite()
  const waiting = useWaitingJoins()
  const [step, setStep] = useState<Step>(null)

  const shops = useQuery(
    ['retailers', 'list', 'join-pick', step?.kind === 'approve' ? step.q : ''],
    () =>
      api.api.retailers.list({
        // A handful, so the dialog stays one screen on a phone: the search narrows it (the walk at 390 px).
        limit: PICK_ROWS,
        activeOnly: true,
        ...(step?.kind === 'approve' && step.q.trim() !== '' ? { q: step.q.trim() } : {}),
      }),
    { enabled: step?.kind === 'approve' && step.request.shop === null },
  )
  const approve = useMutation(
    (input: { id: string; retailerId?: string }, meta) =>
      api.api.retailers.joins.approve({
        idempotencyKey: meta.idempotencyKey,
        id: input.id,
        membershipId: meta.id,
        ...(input.retailerId === undefined ? {} : { retailerId: input.retailerId }),
      }),
    { invalidates: [['retailers']] },
  )
  const refuse = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.retailers.joins.refuse({
        idempotencyKey: meta.idempotencyKey,
        id: input.id,
        reason: input.reason,
      }),
    { invalidates: [['retailers']] },
  )
  const refusal = useRefusal(
    [approve, refuse],
    step === null ? null : `${step.kind}:${step.request.id}`,
  )
  const refusalText = refusal === undefined ? null : refusal.message

  const items = waiting.data?.items ?? []
  if (!waiting.allowed || items.length === 0) return <></>
  const mayDecide = may('retailers.joins.approve')

  const close = (): void => {
    setStep(null)
  }

  const who = (r: JoinRequest): string =>
    t('sj.who', { person: r.personName, phone: r.personPhone })
  const which = (r: JoinRequest): string =>
    r.shop === null ? t('sj.byName') : t('sj.byCode', { shop: r.shop.name, code: r.shop.code })

  const confirmApprove = (current: Extract<Step, { kind: 'approve' }>): void => {
    const retailerId = current.request.shop?.id ?? current.shop?.id
    if (retailerId === undefined) return
    void approve
      .mutateAsync({
        id: current.request.id,
        ...(current.request.shop === null ? { retailerId } : {}),
      })
      .then(
        () => {
          setStep(null)
          onToast(t('sj.approved'))
        },
        () => undefined,
      )
  }

  const confirmRefuse = (current: Extract<Step, { kind: 'refuse' }>): void => {
    const reason = current.reason.trim()
    if (reason.length < 3) {
      setStep({ ...current, problem: t('sj.reasonNeeded') })
      return
    }
    void refuse.mutateAsync({ id: current.request.id, reason }).then(
      () => {
        setStep(null)
        onToast(t('sj.refused'))
      },
      () => undefined,
    )
  }

  const pickList: readonly Retailer[] = (shops.data?.items ?? [])
    .filter((row): row is Retailer => 'code' in row)
    .slice(0, PICK_ROWS)

  return (
    <Stack gap={2} testID="shop-joins">
      <Group title={t('sj.title')}>
        {items.map((r) => (
          <Stack key={r.id} gap={2} testID={`shop-join-${r.id}`}>
            <ListRow
              primary={who(r)}
              secondary={`${t('sj.typed', { shop: r.shopName })} · ${which(r)}`}
              trailing={<StatusChip label={t('sj.waiting')} family="ochre" />}
            />
            {mayDecide ? (
              <Row gap={2} wrap>
                <Button
                  label={t('sj.approve')}
                  variant="primary"
                  onPress={() => {
                    setStep({ kind: 'approve', request: r, q: '', shop: null })
                  }}
                  testID={`shop-join-approve-${r.id}`}
                />
                <Button
                  label={t('sj.refuse')}
                  variant="ghost"
                  onPress={() => {
                    setStep({ kind: 'refuse', request: r, reason: '', problem: null })
                  }}
                  testID={`shop-join-refuse-${r.id}`}
                />
              </Row>
            ) : null}
          </Stack>
        ))}
      </Group>
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {t('sj.count', { count: items.length })}
      </Txt>

      <Dialog
        open={step?.kind === 'approve'}
        onClose={close}
        title={t('sj.approveTitle')}
        body={
          step?.kind === 'approve' ? (
            <Stack gap={3}>
              <Txt field="body" desk="body">
                {t('sj.approveBody', {
                  person: step.request.personName,
                  shop: step.request.shop?.name ?? step.shop?.name ?? step.request.shopName,
                })}
              </Txt>
              {step.request.shop === null ? (
                <Stack gap={2}>
                  <Txt field="label" desk="meta">
                    {t('sj.pickShop')}
                  </Txt>
                  <Search
                    value={step.q}
                    onChange={(q) => {
                      setStep({ ...step, q })
                    }}
                    placeholder={t('sj.pickShopHelp')}
                    state={step.q === '' ? 'idle' : 'results'}
                    testID="shop-join-pick-search"
                  />
                  <Group>
                    {pickList.map((shop) => (
                      <ListRow
                        key={shop.id}
                        primary={shop.name}
                        secondary={shop.code}
                        state={step.shop?.id === shop.id ? 'selected' : 'default'}
                        onPress={() => {
                          setStep({ ...step, shop: { id: shop.id, name: shop.name } })
                        }}
                        testID={`shop-join-pick-${shop.id}`}
                      />
                    ))}
                  </Group>
                  {step.shop === null ? <Hint>{t('sj.pickNeeded')}</Hint> : null}
                </Stack>
              ) : null}
              <Problem text={refusalText} testID="shop-join-refusal" />
            </Stack>
          ) : null
        }
        confirmLabel={t('sj.approveConfirm')}
        busy={approve.status === 'pending'}
        onConfirm={() => {
          if (step?.kind !== 'approve') return
          if (step.request.shop === null && step.shop === null) return
          confirmApprove(step)
        }}
        testID="shop-join-approve-dialog"
      />

      <Dialog
        open={step?.kind === 'refuse'}
        onClose={close}
        title={t('sj.refuseTitle')}
        body={
          step?.kind === 'refuse' ? (
            <Stack gap={3}>
              <Txt field="body" desk="body">
                {who(step.request)}
              </Txt>
              <TextInput
                label={t('sj.reason')}
                value={step.reason}
                onChange={(reason) => {
                  setStep({ ...step, reason, problem: null })
                }}
                helper={t('sj.reasonHelp')}
                error={step.problem ?? undefined}
                capitalize="sentences"
                maxLength={200}
                testID="shop-join-reason"
              />
              <Problem text={refusalText} testID="shop-join-refusal" />
            </Stack>
          ) : null
        }
        confirmLabel={t('sj.refuseConfirm')}
        destructive
        busy={refuse.status === 'pending'}
        onConfirm={() => {
          if (step?.kind !== 'refuse') return
          confirmRefuse(step)
        }}
        testID="shop-join-refuse-dialog"
      />
    </Stack>
  )
}

/** The shop code on a shop's page: what is printed on its bills, and what a shopkeeper types to ask to join. */
export function ShopCodeLine({ shop }: { shop: Retailer }): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  if (shop.shopCode === undefined) return <></>
  return (
    <Stack gap={1} testID="shop-code">
      <Txt field="label" desk="meta" color={colors.text.secondary}>
        {t('sj.shopCode')}
      </Txt>
      <Txt field="bodyStrong" desk="body" numeric testID="shop-code-value">
        {shop.shopCode}
      </Txt>
      <Hint>{t('sj.shopCodeHelp')}</Hint>
    </Stack>
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

/** The service's own sentence for a refused write, in the refusal colour. */
function Problem({ text, testID }: { text: string | null; testID: string }): React.JSX.Element {
  const colors = useColors()
  if (text === null) return <></>
  return (
    <Txt field="body" desk="body" color={colors.status.brick.fg} testID={testID}>
      {text}
    </Txt>
  )
}
