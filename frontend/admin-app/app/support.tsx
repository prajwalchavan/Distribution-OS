/**
 * P6 — every support request and window, across every distributorship.
 *
 * The console's whole vocabulary here is ASK and HAND BACK. There is deliberately no
 * `admin.support.approve`: only the distributor's own owner opens a window, from their own app, and
 * it lapses by itself at `expiresAt` with nobody having to remember it. This screen therefore reads
 * as a waiting list — who we asked, what we said, what they answered, and how long is left.
 *
 * A row that is OPEN carries the one door in the product into a distributor's own data, and it is
 * opened on the distributorship's own page, where the reads are shown beside the audit rows they
 * write.
 */
import { usePlatformApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Register,
  Row,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import type { AdminSupportGrant } from '@dos/contracts'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  Field,
  Note,
  Panel,
  ReloadButton,
  chipColumn,
  grantChip,
  showingCount,
  textColumn,
  useCan,
} from '../src/lib/ui'
import { instantWithClock, untilInstant } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

/**
 * The three faces this register has, and why each one is now a SERVER filter.
 *
 * It used to filter on the device, and it had to: `openOnly` on the server was "not revoked AND (not
 * yet approved OR not yet expired)", which kept every ask nobody ever answered for ever, and
 * `status: 'requested'` had the same hole from the other side — a lapsed ask read `requested` on the
 * wire though its owner could no longer open it (409 `request_expired`). Measured on the founder's
 * database, the view headed **"Open now" listed 100 rows of which exactly one was open**. DOS-110
 * gave the server a `lapsed` status derived in one place for both services, so:
 *
 *   open    → `status: 'approved'`, which IS "approved, unexpired, unrevoked" — exactly `active`.
 *   waiting → `status: 'requested'`, which now excludes an ask whose own hours ran out.
 *   all     → no filter, where a lapsed ask reads "Lapsed, no answer" and its panel says why.
 *
 * Nothing is dropped from a page after it arrives, so the header's count is the server's count and
 * the page size means what it says.
 *
 * THREE views, not four: `<Segments>` renders `items.slice(0, 3)` in both renderers, because UX-00
 * §6.10 draws a segmented control with two or three options.
 */
type View = 'open' | 'waiting' | 'all'

export default function Support(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()
  const router = useRouter()
  const can = useCan()

  /** One set of words for every chip on this screen (DOS-110): the row's own status, coloured. */
  const chipWords = { openNow: t('p6.openNow'), word }
  const [view, setView] = useState<View>('open')
  const [selected, setSelected] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  const grants = useQuery(['admin', 'support', view], () =>
    api.api.admin.support.list({
      limit: 100,
      ...(view === 'open' ? { status: 'approved' as const } : {}),
      ...(view === 'waiting' ? { status: 'requested' as const } : {}),
    }),
  )

  const rows = grants.data?.items ?? []
  const current = rows.find((row) => row.id === selected) ?? null

  const revoke = useMutation(
    (grantId: string) =>
      api.api.admin.support.revoke({
        idempotencyKey: uuidv7(),
        id: grantId,
        // The owner sees this beside the row in their own app; it is never left blank.
        reason: t('p6.handedBack'),
      }),
    {
      invalidates: [
        ['admin', 'support'],
        ['admin', 'tenant'],
        ['admin', 'audit'],
      ],
      onSuccess: () => {
        setClosing(false)
        setSelected(null)
      },
    },
  )

  const columns: readonly RegisterColumn<AdminSupportGrant>[] = [
    {
      key: 'tenant',
      head: t('p6.distributor'),
      priority: 'identity',
      /*
       * The reason is a SENTENCE, and a desk table cell is `white-space: nowrap` — so the identity
       * column grew to the width of the longest reason on the page and pushed the state chip off
       * the right edge. Measured at 1440 px: "Lapsed, no…". The column is bounded and the whole
       * reason is one tap away in the row's own panel.
       */
      cell: (row) => (
        <Stack gap={1} maxWidth={380}>
          <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
            {row.tenantName}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
            {row.reason}
          </Txt>
        </Stack>
      ),
    },
    chipColumn('state', t('p6.state'), (row) => grantChip(row, chipWords)),
    textColumn('scope', t('p6.scope'), (row) => word(row.scope)),
    textColumn('askedBy', t('p6.askedBy'), (row) => row.requestedByName),
    textColumn('asked', t('p6.asked'), (row) => instantWithClock(row.requestedAt)),
    textColumn('decided', t('p6.decided'), (row) =>
      row.decidedAt === null ? '—' : instantWithClock(row.decidedAt),
    ),
    {
      key: 'expires',
      head: t('p6.expires'),
      priority: 'value',
      cell: (row) => {
        if (row.expiresAt === null) {
          return (
            <Txt field="body" desk="cell" color={colors.text.secondary}>
              —
            </Txt>
          )
        }
        const left = untilInstant(row.expiresAt)
        return (
          <Txt field="body" desk="cell" numeric>
            {left === '' ? t('p6.expired', { when: instantWithClock(row.expiresAt) }) : left}
          </Txt>
        )
      },
    },
  ]

  return (
    <Screen
      title={t('p6.title')}
      context={showingCount(t, grants, rows.length)}
      actions={
        <ReloadButton
          onPress={() => {
            void grants.refetch()
          }}
        />
      }
    >
      <Stack gap={4}>
        <Note testID="support-intro">{t('p6.intro')}</Note>
        <Segments
          testID="support-view"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'open', label: t('p6.onlyOpen') },
            { id: 'waiting', label: t('word.requested') },
            { id: 'all', label: t('app.all') },
          ]}
        />
        <Async state={[grants]} rows={8}>
          <Register
            testID="support-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="tenant"
            state="ready"
            selectedKey={selected}
            emptyMessage={
              view === 'open'
                ? t('p6.emptyOpen')
                : view === 'waiting'
                  ? t('p6.emptyWaiting')
                  : t('p6.empty')
            }
            onSelect={(row) => {
              setSelected(row.id)
            }}
          />
        </Async>
      </Stack>

      <Sheet
        open={current !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={current?.tenantName}
        testID="support-detail"
      >
        {current === null ? null : (
          <Stack gap={4}>
            <Row gap={2} wrap>
              <StatusChip {...grantChip(current, chipWords)} />
              <StatusChip label={word(current.scope)} family="neutral" />
            </Row>
            <Field label={t('p6.reason')}>{current.reason}</Field>
            <Field label={t('p6.askedBy')}>{current.requestedByName}</Field>
            <Field label={t('p6.asked')}>{instantWithClock(current.requestedAt)}</Field>
            <Field label={t('p6.hours')}>{current.requestedHours}</Field>
            {current.decidedAt === null ? null : (
              <Field label={t('p6.decided')}>{instantWithClock(current.decidedAt)}</Field>
            )}
            {current.decisionNote === null ? null : (
              <Field label={t('p6.decisionNote')}>{current.decisionNote}</Field>
            )}
            {current.expiresAt === null ? null : (
              <Field label={t('p6.expires')}>{instantWithClock(current.expiresAt)}</Field>
            )}
            {current.revokeReason === null ? null : (
              <Field label={t('p6.revokeReason')}>{current.revokeReason}</Field>
            )}
            {current.status === 'rejected' ? (
              <Panel>
                <Txt field="body" desk="body" color={colors.text.secondary}>
                  {t('p6.deniedByOwner')}
                </Txt>
              </Panel>
            ) : current.status === 'lapsed' ? (
              <Note testID="lapsed-note">{t('p6.lapsedNote')}</Note>
            ) : null}
            <Row gap={3} wrap>
              <Button
                label={t('p3.doneOpen')}
                variant="secondary"
                testID="support-open-distributor"
                onPress={() => {
                  router.push(`/distributors/${current.tenantId}`)
                }}
              />
              {/* Withdrawing an ask or handing a window back: super and support (DOS-106). */}
              {(current.status === 'requested' || current.active) && can('admin.support.revoke') ? (
                <Button
                  label={current.active ? t('p6.handBack') : t('p6.withdraw')}
                  variant="destructive"
                  testID="support-close"
                  onPress={() => {
                    setClosing(true)
                  }}
                />
              ) : null}
            </Row>
          </Stack>
        )}
      </Sheet>

      <Dialog
        open={closing && current !== null}
        onClose={() => {
          setClosing(false)
        }}
        title={current?.active === true ? t('p6.handBackTitle') : t('p6.withdrawTitle')}
        body={current?.active === true ? t('p6.handBackBody') : t('p6.withdrawBody')}
        confirmLabel={current?.active === true ? t('p6.handBack') : t('p6.withdraw')}
        destructive
        busy={revoke.status === 'pending'}
        onConfirm={() => {
          if (current !== null) revoke.mutate(current.id)
        }}
        testID="support-close-dialog"
      />
    </Screen>
  )
}
