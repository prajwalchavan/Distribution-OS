/**
 * "ADD A DISTRIBUTOR" and "WAITING FOR APPROVAL" — the shopkeeper's own account (founder, 2026-09-29, docs/22 §8
 * "The shopkeeper is independent").
 *
 * A shopkeeper who signed up alone asks a distributor to join them to their shop, in one of two ways:
 *  - the SHOP CODE printed on that distributor's bill: the code is looked up first and shown back — the
 *    distributor's name and the shop's name on its books — so the shopkeeper confirms before anything is asked;
 *  - the distributor PICKED BY NAME from the ones that take requests, with the shop's name as the shopkeeper calls
 *    it, for a shop that has no bill in hand.
 * Every request the account has made is listed with its state: waiting (with a way to withdraw), approved, refused
 * (with the one line the desk wrote), withdrawn. The distributor's owner or manager decides after seeing who asks;
 * until then nothing of the distributor is shown here but its name.
 *
 * ONE COMPONENT, TWO PLACES. On `/join` it is the whole app for an account that no distributor has joined yet
 * (`mode="account"`): it re-reads the requests while one waits, and the moment one is approved it asks for a fresh
 * pair — the root's ladder then opens that distributor's shop. Inside the shop's own group (`/retailer/add-distributor`,
 * `mode="shop"`) it adds another distributor to an account that already has one; the new one appears in the
 * distributor switcher at the next refresh.
 *
 * It lives at install level, beside `src/shops/`, because a group may import `src/` and never another group
 * (docs/31 §6.4). Screens import only `@dos/ui` for rendering, and so does this file.
 */
import type { MyJoinRequest, ShopCodeLookupOut } from '@dos/contracts'
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import { normalizeShopCode } from '@dos/domain'
import {
  Button,
  Dialog,
  ErrorState,
  Group,
  ListRow,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Toast,
  Txt,
  useColors,
  useStrings,
  type StatusFamily,
} from '@dos/ui'
import { useEffect, useRef, useState } from 'react'

export interface AddDistributorProps {
  /** `account`: no distributor has joined the account yet (`/join`). `shop`: inside the shop's own group. */
  mode: 'account' | 'shop'
}

/** How often the list is read again while a request waits: a distributor decides in minutes, not seconds. */
const WAITING_POLL_MS = 30_000

const FAMILY: Record<MyJoinRequest['state'], StatusFamily> = {
  waiting: 'ochre',
  approved: 'moss',
  refused: 'brick',
  withdrawn: 'neutral',
}

export function AddDistributor({ mode }: AddDistributorProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const { refreshSession, signOut } = useSession()
  const [how, setHow] = useState<'code' | 'name'>('code')
  const [code, setCode] = useState('')
  const [codeProblem, setCodeProblem] = useState<string | null>(null)
  const [found, setFound] = useState<{ code: string; shop: ShopCodeLookupOut } | null>(null)
  const [looking, setLooking] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ tenantId: string; name: string } | null>(null)
  const [shopName, setShopName] = useState('')
  const [nameProblem, setNameProblem] = useState<string | null>(null)
  const [withdrawing, setWithdrawing] = useState<MyJoinRequest | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const mine = useQuery(['auth', 'joins', 'mine'], () => api.auth.joins.mine())
  const searching = q.trim().length >= 2
  const distributors = useQuery(
    ['auth', 'joins', 'distributors', q.trim()],
    () => api.auth.joins.distributors({ q: q.trim(), limit: 20 }),
    { enabled: how === 'name' && searching },
  )
  const ask = useMutation(
    (
      input: { by: 'code'; code: string } | { by: 'name'; tenantId: string; shopName: string },
      meta,
    ) => api.auth.joins.ask({ idempotencyKey: meta.idempotencyKey, id: meta.id, ...input }),
    { invalidates: [['auth', 'joins', 'mine']] },
  )
  const withdraw = useMutation(
    (id: string, meta) => api.auth.joins.withdraw({ idempotencyKey: meta.idempotencyKey, id }),
    { invalidates: [['auth', 'joins', 'mine']] },
  )

  const requests = mine.data?.items ?? []
  const waiting = requests.some((r) => r.state === 'waiting')
  const approved = requests.find((r) => r.state === 'approved')

  /* While a request waits, read the list again now and then: the desk may decide at any moment. */
  const refetchMine = mine.refetch
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      void refetchMine()
    }, WAITING_POLL_MS)
    return () => {
      clearInterval(timer)
    }
  }, [waiting, refetchMine])

  /*
   * An account with no distributor yet opens its shop the moment one approves: a fresh pair is a session on that
   * distributor, and the root's ladder moves there. Asked once per approved request this screen has seen.
   */
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (mode !== 'account' || approved === undefined || opened.current === approved.id) return
    opened.current = approved.id
    void refreshSession().catch(() => undefined)
  }, [mode, approved, refreshSession])

  const find = (): void => {
    const normal = normalizeShopCode(code)
    setFound(null)
    if (normal === null) {
      setCodeProblem(t('join.codeBad'))
      return
    }
    setCodeProblem(null)
    setLooking(true)
    void api.auth.joins
      .lookup({ code: normal })
      .then(
        (shop) => {
          setFound({ code: normal, shop })
        },
        (error: unknown) => {
          setCodeProblem(error instanceof Error ? error.message : t('join.failed'))
        },
      )
      .finally(() => {
        setLooking(false)
      })
  }

  const sent = (): void => {
    setToast(t('join.asked'))
    setFound(null)
    setCode('')
    setPicked(null)
    setShopName('')
    setQ('')
  }

  const askByCode = (): void => {
    if (found === null) return
    void ask.mutateAsync({ by: 'code', code: found.code }).then(sent, () => undefined)
  }

  const askByName = (): void => {
    if (picked === null) {
      setNameProblem(t('join.pickNeeded'))
      return
    }
    if (shopName.trim().length < 2) {
      setNameProblem(t('join.nameNeeded'))
      return
    }
    setNameProblem(null)
    void ask
      .mutateAsync({ by: 'name', tenantId: picked.tenantId, shopName: shopName.trim() })
      .then(sent, () => undefined)
  }

  const checkAgain = (): void => {
    setChecking(true)
    void Promise.all([refetchMine(), refreshSession().catch(() => undefined)]).finally(() => {
      setChecking(false)
    })
  }

  const secondary = (r: MyJoinRequest): string =>
    r.state === 'refused' && r.reason !== null
      ? `${r.shop} · ${t('join.refusedWhy', { reason: r.reason })}`
      : r.state === 'waiting'
        ? `${r.shop} · ${t('join.waitingBody', { distributor: r.distributor })}`
        : r.state === 'approved'
          ? t('join.approvedBody', { distributor: r.distributor, shop: r.shop })
          : r.shop

  return (
    <Screen
      title={t('join.title')}
      subtitle={mode === 'account' ? t('join.noneYet') : t('join.addAnotherBody')}
      testID="join-screen"
    >
      <Stack gap={6}>
        {requests.length === 0 ? null : (
          <Group title={waiting ? t('join.waitingTitle') : t('join.mine')} testID="join-mine">
            {requests.map((r) => (
              <ListRow
                key={r.id}
                primary={r.distributor}
                secondary={secondary(r)}
                trailing={
                  <StatusChip label={t(`join.state.${r.state}`)} family={FAMILY[r.state]} />
                }
                {...(r.state === 'waiting'
                  ? {
                      onPress: () => {
                        setWithdrawing(r)
                      },
                    }
                  : {})}
                testID={`join-request-${r.id}`}
              />
            ))}
          </Group>
        )}
        {mode === 'account' && approved !== undefined ? (
          <Button
            label={t('join.open')}
            variant="primary"
            onPress={checkAgain}
            loading={checking}
            fullWidth
            testID="join-open"
          />
        ) : null}
        {waiting ? (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="join-waiting-hint">
            {t('join.tapToWithdraw')}
          </Txt>
        ) : null}

        <Stack gap={3}>
          <Segments
            items={[
              { id: 'code', label: t('join.byCode') },
              { id: 'name', label: t('join.byName') },
            ]}
            value={how}
            onChange={(id) => {
              setHow(id === 'name' ? 'name' : 'code')
            }}
            testID="join-how"
          />
          {how === 'code' ? (
            <Stack gap={3}>
              <TextInput
                label={t('join.code')}
                value={code}
                onChange={(value) => {
                  setCode(value)
                  setFound(null)
                  setCodeProblem(null)
                }}
                helper={t('join.codeHelp')}
                error={codeProblem ?? undefined}
                maxLength={16}
                onSubmit={find}
                testID="join-code"
              />
              {found === null ? (
                <Button
                  label={t('join.find')}
                  variant="secondary"
                  onPress={find}
                  loading={looking}
                  fullWidth
                  testID="join-find"
                />
              ) : (
                <Group title={t('join.foundTitle')} testID="join-found">
                  <ListRow
                    primary={found.shop.shop}
                    secondary={t('join.found', {
                      shop: found.shop.shop,
                      distributor: found.shop.distributor,
                    })}
                  />
                  <Stack gap={2}>
                    {ask.status === 'error' && ask.error !== undefined ? (
                      <ErrorState message={ask.error.message} testID="join-ask-error" />
                    ) : null}
                    <Button
                      label={t('join.ask')}
                      variant="primary"
                      onPress={askByCode}
                      loading={ask.status === 'pending'}
                      fullWidth
                      testID="join-ask-code"
                    />
                  </Stack>
                </Group>
              )}
            </Stack>
          ) : (
            <Stack gap={3}>
              <TextInput
                label={t('join.search')}
                value={q}
                onChange={(value) => {
                  setQ(value)
                  setPicked(null)
                }}
                helper={t('join.searchHelp')}
                capitalize="words"
                testID="join-search"
              />
              {searching ? (
                (distributors.data?.items ?? []).length === 0 ? (
                  distributors.isLoading ? null : (
                    <Txt field="label" desk="meta" color={colors.text.secondary}>
                      {t('join.searchEmpty')}
                    </Txt>
                  )
                ) : (
                  <Group testID="join-distributors">
                    {(distributors.data?.items ?? []).map((d) => (
                      <ListRow
                        key={d.tenantId}
                        primary={d.name}
                        state={picked?.tenantId === d.tenantId ? 'selected' : 'default'}
                        onPress={() => {
                          setPicked(d)
                          setNameProblem(null)
                        }}
                        testID={`join-distributor-${d.tenantId}`}
                      />
                    ))}
                  </Group>
                )
              ) : null}
              <TextInput
                label={t('join.shopName')}
                value={shopName}
                onChange={setShopName}
                helper={t('join.shopNameHelp')}
                capitalize="words"
                error={nameProblem ?? undefined}
                testID="join-shop-name"
              />
              {ask.status === 'error' && ask.error !== undefined ? (
                <ErrorState message={ask.error.message} testID="join-ask-error" />
              ) : null}
              <Button
                label={t('join.ask')}
                variant="primary"
                onPress={askByName}
                loading={ask.status === 'pending'}
                fullWidth
                testID="join-ask-name"
              />
            </Stack>
          )}
        </Stack>

        {mode === 'account' ? (
          <Stack gap={2}>
            <Button
              label={t('join.checkAgain')}
              variant="secondary"
              onPress={checkAgain}
              loading={checking}
              fullWidth
              testID="join-check-again"
            />
            <Button
              label={t('join.signOut')}
              variant="ghost"
              onPress={() => {
                void signOut()
              }}
              fullWidth
              testID="join-sign-out"
            />
          </Stack>
        ) : null}
      </Stack>

      <Dialog
        open={withdrawing !== null}
        onClose={() => {
          setWithdrawing(null)
        }}
        title={t('join.withdrawTitle')}
        body={
          <Txt field="body" desk="body">
            {t('join.withdrawBody', { distributor: withdrawing?.distributor ?? '' })}
          </Txt>
        }
        confirmLabel={t('join.withdraw')}
        destructive
        busy={withdraw.status === 'pending'}
        onConfirm={() => {
          if (withdrawing === null) return
          const id = withdrawing.id
          void withdraw.mutateAsync(id).then(
            () => {
              setWithdrawing(null)
              setToast(t('join.withdrawn'))
            },
            (error: unknown) => {
              setWithdrawing(null)
              setToast(error instanceof Error ? error.message : t('join.failed'))
            },
          )
        }}
        testID="join-withdraw-dialog"
      />
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="join-toast"
      />
    </Screen>
  )
}
