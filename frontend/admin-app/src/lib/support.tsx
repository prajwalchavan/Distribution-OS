/**
 * Support access — the console's half of it, written once and used on a distributorship's page and
 * on the Support register.
 *
 * THE RULE THIS FILE EXISTS TO KEEP. Nothing in `admin.*` can open a window: the console ASKS
 * (`admin.support.request`) and can withdraw its own ask or hand a window back early
 * (`admin.support.revoke`), and the distributor's OWN owner decides, in their own app, through
 * `tenancy.support.approve` — a procedure no service this app talks to even mounts (docs/17 §B [57],
 * docs/22 §2). So `<InsidePanel>` has exactly three faces, and which one it wears is decided by the
 * grant, never by this app:
 *
 *   shut     — nothing of their trade is readable, and the panel says so and offers to ask.
 *   waiting  — asked, and their owner has not answered. Still nothing readable.
 *   open     — an approved window with time left. Only here does a read of their data exist at all,
 *              and it goes to THEIR service with the `x-support-grant` pass, which their service
 *              verifies, narrows to GET while the scope is read-only, and writes to `platform_audit`.
 */
import { usePlatformApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  ErrorState,
  Row,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import type { AdminSupportGrant, SupportScope } from '@dos/contracts'
import { useEffect, useState } from 'react'

import { Field, Note, Panel, askLapsed, grantFamily, useCan } from './ui'
import { instantWithClock, untilInstant } from './dates'
import { useWord } from './words'

const HOURS: readonly number[] = [1, 2, 4, 8, 24, 72]

/**
 * `platform_audit.after` is free-form JSON written by the distributor's own service. The
 * `support.read` rows put the request there as `route: "GET /retailers"` — the one field this panel
 * prints. Anything else (a shape that changes, a row from an older build) falls back to the action.
 */
function routeOf(after: Readonly<Record<string, unknown>> | null): string | null {
  const route = after?.['route']
  return typeof route === 'string' ? route : null
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

export interface AskForAccessProps {
  open: boolean
  onClose: () => void
  tenantId: string
  tenantName: string
  testID?: string
}

/**
 * The ask. `reason` is shown to their owner VERBATIM and is the whole basis of their decision, so it
 * is a real sentence with a ten-character floor from the contract, not a ticket number on its own.
 */
export function AskForAccess({
  open,
  onClose,
  tenantId,
  tenantName,
  testID,
}: AskForAccessProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = usePlatformApi()
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState<SupportScope>('read_only')
  const [hours, setHours] = useState(4)
  const [id, setId] = useState(() => uuidv7())
  const can = useCan()

  const ask = useMutation(
    (_input: string, meta) =>
      api.api.admin.support.request({
        idempotencyKey: meta.idempotencyKey,
        id,
        tenantId,
        reason: reason.trim(),
        scope,
        hours,
      }),
    {
      /*
       * `['admin','tenant']` AS WELL AS `['admin','tenants']`. The cache invalidates by key PREFIX,
       * and one distributorship is read under `['admin','tenant', id]` — which the plural key does
       * not prefix. Without it the panel that had just asked for a window went on showing the state
       * before the ask, measured on the pilot's own page: the request reached the server and the
       * screen still read "Lapsed, no answer".
       */
      invalidates: [
        ['admin', 'support'],
        ['admin', 'tenant'],
        ['admin', 'tenants'],
        ['admin', 'audit'],
      ],
      onSuccess: () => {
        setReason('')
        setId(uuidv7())
        onClose()
      },
    },
  )

  const tooShort = reason.trim().length < 10

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('p6.askTitle', { name: tenantName })}
      testID={testID}
    >
      <Stack gap={4}>
        <Note>{t('p6.intro')}</Note>
        {/* `<TextInput>` draws its own label and helper (UX-00 §6.2); a `<Txt>` above it is the
            same words twice. Chips and segments below have no label of their own, so those keep theirs. */}
        <TextInput
          label={t('p6.reason')}
          value={reason}
          onChange={setReason}
          helper={t('p6.reasonHelp')}
          capitalize="sentences"
          maxLength={500}
          testID="ask-reason"
        />
        <Stack gap={2}>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('p6.scope')}
          </Txt>
          <Segments
            testID="ask-scope"
            value={scope}
            onChange={(value) => {
              setScope(value as SupportScope)
            }}
            items={[
              { id: 'read_only', label: t('word.read_only') },
              { id: 'read_write', label: t('word.read_write') },
            ]}
          />
        </Stack>
        <Stack gap={2}>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('p6.hours')}
          </Txt>
          <Chips
            testID="ask-hours"
            items={HOURS.map((value) => ({
              id: String(value),
              label: `${String(value)} h`,
              selected: hours === value,
            }))}
            onToggle={(value) => {
              setHours(Number(value))
            }}
          />
        </Stack>
        {ask.error === undefined ? null : (
          <ErrorState message={ask.error.message} detail={ask.error.kind} />
        )}
        {/* Defence for a sheet opened by state: only a level that may ask is offered the send (DOS-106). */}
        {can('admin.support.request') ? (
          <Button
            label={t('p6.send')}
            variant="primary"
            fullWidth
            testID="ask-submit"
            loading={ask.status === 'pending'}
            disabled={tooShort || ask.status === 'pending'}
            {...(tooShort ? { disabledReason: t('p6.reasonShort') } : {})}
            onPress={() => {
              ask.mutate(id)
            }}
          />
        ) : null}
      </Stack>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface InsidePanelProps {
  tenantId: string
  tenantName: string
  /** Every grant this console has on this distributorship, newest first. */
  grants: readonly AdminSupportGrant[]
  onAsk: () => void
  testID?: string
}

/**
 * The one place in this console where a distributor's own rows can appear at all — and only behind
 * an approved, unexpired window.
 */
export function InsidePanel({
  tenantId,
  tenantName,
  grants,
  onAsk,
  testID,
}: InsidePanelProps): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()
  const can = useCan()
  const [handBack, setHandBack] = useState(false)

  const live = grants.find((grant) => grant.active) ?? null
  const waiting = grants.find((grant) => grant.status === 'requested' && !askLapsed(grant)) ?? null
  /** An ask nobody answered inside the hours it asked for: it is shut, and the panel says why. */
  const lapsed = grants.find((grant) => askLapsed(grant)) ?? null

  /**
   * Open the window: mint the five-minute pass on auth-service (the only process holding the signing
   * key), then read through it, on the DISTRIBUTOR's own service, the two things a support call
   * actually starts with — who they are as their own service reports them, and their invoice
   * numbering. Both are configuration; neither is a rupee of their trade, and both are written to
   * `platform_audit` by their service as they are read.
   *
   * NOT `tenancy.me`: that procedure answers "who am I in this distributorship" from the ACTOR's
   * membership row, and a console session has no membership anywhere — measured here, it answers
   * 401 "No active membership for this tenant" through a perfectly valid pass. Recorded as an open
   * point; the pass is not the problem, the question is.
   */
  const openWindow = useMutation(
    async (grantId: string) => {
      const pass = await api.supportPass(grantId)
      const inside = api.openTenant(pass.pass)
      const [branding, numbering] = await Promise.all([
        inside.tenancy.branding.get(),
        inside.tenancy.numbering.list({}),
      ])
      return { pass, branding, numbering }
    },
    {
      /*
       * The two reads below write two `platform_audit` rows, and the panel under them exists to show
       * exactly those rows. Without this the list served its 30-second cache and topped out at the
       * PREVIOUS window's reads — measured: rows written at 20:05:43 under a list whose newest entry
       * was 18:35, on a panel headed "What we have read under this window".
       */
      invalidates: [['admin', 'audit']],
    },
  )

  /**
   * What has been read under THIS window, from the platform's own audit trail.
   *
   * Filtered by `entityId` — the grant's own id, which every `support.read` row carries — and not
   * only by tenant: the panel's heading says "under this window", and a tenant filter would have put
   * last week's window's reads under this one's heading.
   */
  const reads = useQuery(
    ['admin', 'audit', 'support.read', live?.id ?? 'none'],
    () =>
      api.api.admin.audit.list({
        tenantId,
        action: 'support.read',
        entityType: 'support',
        entityId: live?.id ?? '',
        limit: 20,
      }),
    { enabled: live !== null },
  )

  /*
   * AND ONCE MORE, A MOMENT LATER.
   *
   * `SupportAuditInterceptor` writes its row AFTER the answer is on the wire — deliberately, and its
   * own comment says a spec asserting on the row has to poll for it rather than assume it is there
   * when the reply arrives. So the invalidation above, which fires the instant the two reads resolve,
   * races the very rows it is fetching: measured, two rows written at 20:50:28 were still missing
   * from a list refetched (200) at 20:50:28. This panel claims "Every call is in the audit trail", so
   * it asks again once the row can have landed instead of showing a list that quietly proves it
   * wrong.
   */
  const openedAt = openWindow.data?.pass.expiresAt
  /*
   * `reads` is a fresh object on every render and `reads.refetch` is NOT — `useQuery` memoises it on
   * the key. Depending on the object would clear and re-arm these timers on every render, so they
   * would never fire at all.
   */
  const refetchReads = reads.refetch
  useEffect(() => {
    if (openedAt === undefined) return
    const timers = [
      setTimeout(() => void refetchReads(), 1_200),
      setTimeout(() => void refetchReads(), 4_000),
    ]
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [openedAt, refetchReads])

  const revoke = useMutation(
    (grantId: string) =>
      api.api.admin.support.revoke({
        idempotencyKey: uuidv7(),
        id: grantId,
        // Sent to the server, and the distributor's OWNER reads it in their own app — so it is a
        // locale key like every other user-visible sentence, not an English literal in a handler.
        reason: t('p6.handedBack'),
      }),
    {
      invalidates: [
        ['admin', 'support'],
        ['admin', 'tenant'],
        ['admin', 'tenants'],
        ['admin', 'audit'],
      ],
      onSuccess: () => {
        setHandBack(false)
      },
    },
  )

  const opened = openWindow.data

  return (
    <Panel title={t('p4.inside')} testID={testID}>
      <Stack gap={4}>
        {live !== null ? (
          <>
            <Row wrap>
              <StatusChip
                testID="window-state"
                label={t('p4.insideOpen', {
                  when: instantWithClock(live.expiresAt),
                  scope:
                    live.scope === 'read_only' ? t('p4.insideReadOnly') : t('p4.insideReadWrite'),
                })}
                family="moss"
              />
            </Row>
            {live.expiresAt === null ? null : (
              <Txt field="label" desk="meta" color={colors.text.secondary}>
                {t('p6.closesIn', { when: untilInstant(live.expiresAt) })}
              </Txt>
            )}
            <Note>{t('p4.insideProofBody')}</Note>
            {opened === undefined ? (
              <Button
                label={t('p4.insideOpenDoor')}
                variant="primary"
                testID="open-window"
                loading={openWindow.status === 'pending'}
                onPress={() => {
                  openWindow.mutate(live.id)
                }}
              />
            ) : (
              <Stack gap={3} pad={4} background="sunken" radius="sm" testID="window-proof">
                <Txt field="title" desk="section" as="h3">
                  {t('p4.insideProof')}
                </Txt>
                <Field label={t('p4.insideDisplayName')}>{opened.branding.displayName}</Field>
                <Field label={t('p2.name')}>{opened.branding.legalName}</Field>
                <Field label={t('p4.gstin')}>{opened.branding.gstin ?? '—'}</Field>
                <Field label={t('p4.insideSeries')}>
                  <Stack gap={2}>
                    {opened.numbering.items.slice(0, 6).map((series) => (
                      /*
                       * The code on the left, the NEXT NUMBER THAT WILL BE ISSUED on the right —
                       * `INV` · `INV/9171`. Printing `prefix + seriesCode` read "CN/CN" and
                       * "INV/INV", which is the prefix twice and the answer nowhere.
                       */
                      <Row key={series.seriesCode} justify="between" gap={3}>
                        <Txt field="body" desk="cell" numberOfLines={1}>
                          {series.seriesCode}
                        </Txt>
                        <Txt field="body" desk="cell" numeric>
                          {t('p4.insideNextNo', {
                            no: `${series.prefix}${String(series.nextNo)}`,
                          })}
                        </Txt>
                      </Row>
                    ))}
                  </Stack>
                </Field>
                {/*
                  NOT `p6.expires` ("Closes"). The five-minute PASS and the owner's WINDOW are two
                  different clocks, and this block sits directly under a chip reading "A window is
                  open until 10:30 pm" — measured, the same word then said 8:10 pm underneath it,
                  and nothing on screen said which one shut when.
                */}
                <Field label={t('p4.insidePassCloses')}>
                  {instantWithClock(opened.pass.expiresAt)}
                </Field>
                <Txt field="label" desk="meta" color={colors.text.secondary}>
                  {live.scope === 'read_only' ? t('p4.insideReadOnlyNote') : t('word.read_write')}
                </Txt>
              </Stack>
            )}
            {openWindow.error === undefined ? null : (
              <ErrorState
                message={t('p4.insideFailed')}
                detail={openWindow.error.message}
                actionLabel={t('app.retry')}
                onAction={() => {
                  openWindow.mutate(live.id)
                }}
              />
            )}
            <Panel title={t('p4.insideAudit')}>
              {(reads.data?.items.length ?? 0) === 0 ? (
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('p4.insideNoReads')}
                </Txt>
              ) : (
                <Stack gap={2}>
                  {(reads.data?.items ?? []).slice(0, 8).map((row) => (
                    <Txt key={row.id} field="body" desk="cell" numberOfLines={1}>
                      {`${instantWithClock(row.occurredAt)} · ${routeOf(row.after) ?? word(row.action)}`}
                    </Txt>
                  ))}
                </Stack>
              )}
            </Panel>
            {/* Handing a window back: super and support (DOS-106). */}
            {can('admin.support.revoke') ? (
              <>
                <Button
                  label={t('p4.insideHandBack')}
                  variant="destructive"
                  testID="hand-back"
                  onPress={() => {
                    setHandBack(true)
                  }}
                />
                <Dialog
                  open={handBack}
                  onClose={() => {
                    setHandBack(false)
                  }}
                  title={t('p6.handBackTitle')}
                  body={t('p6.handBackBody')}
                  confirmLabel={t('p6.handBack')}
                  destructive
                  busy={revoke.status === 'pending'}
                  onConfirm={() => {
                    revoke.mutate(live.id)
                  }}
                  testID="hand-back-dialog"
                />
              </>
            ) : null}
          </>
        ) : waiting !== null ? (
          <>
            <Row wrap>
              <StatusChip
                testID="window-state"
                label={word(waiting.status)}
                family={grantFamily(waiting.status, false)}
              />
            </Row>
            <Txt field="body" desk="body" color={colors.text.secondary}>
              {t('p4.insideWaiting', {
                when: instantWithClock(waiting.requestedAt),
                name: tenantName,
              })}
            </Txt>
            <Field label={t('p6.reason')}>{waiting.reason}</Field>
          </>
        ) : (
          <>
            <Row wrap>
              <StatusChip
                testID="window-state"
                label={lapsed === null ? t('word.closed') : t('p6.lapsed')}
                family="neutral"
              />
            </Row>
            <Note testID="inside-shut">
              {lapsed === null
                ? t('p4.insideShut')
                : t('p4.insideLapsed', {
                    when: instantWithClock(
                      new Date(
                        Date.parse(lapsed.requestedAt) + lapsed.requestedHours * 3_600_000,
                      ).toISOString(),
                    ),
                  })}
            </Note>
            {/* Asking a distributor's owner for a window: super and support (DOS-106). */}
            {can('admin.support.request') ? (
              <Button
                label={t('p4.insideAsk')}
                variant="secondary"
                testID="ask-access"
                onPress={onAsk}
              />
            ) : null}
          </>
        )}
      </Stack>
    </Panel>
  )
}
