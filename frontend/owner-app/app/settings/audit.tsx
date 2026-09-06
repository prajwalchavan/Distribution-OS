/**
 * O25 — audit and security (docs/23 §1.1).
 *
 * Who changed a price, a credit limit or a setting; who took an export; who read a GPS trace — and
 * which devices this sign-in still has open. The before/after pair is the whole point of an audit row,
 * so the panel prints both rather than summarising them.
 */
import type { AuditEntry, AuthSession } from '@dos/contracts'
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Register,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, PageTabs, Panel, textColumn, useNames } from '../../src/lib/ui'
import { instantWithClock, rangeOf, type RangeId } from '../../src/lib/dates'
import { RangeSegments } from '../../src/lib/ui'
import { useWord } from '../../src/lib/words'

export default function Audit(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const names = useNames()
  const { session } = useSession()
  const [view, setView] = useState<'audit' | 'sessions'>('audit')
  const [range, setRange] = useState<RangeId>('d30')
  const [selected, setSelected] = useState<string | null>(null)

  const span = rangeOf(range)
  const audit = useQuery(['tenancy', 'audit', span.from, span.to], () =>
    api.api.tenancy.audit.list({ from: span.from, to: span.to, limit: 200 }),
  )
  /*
   * `auth.*` lives on auth-service :3000, not on owner-service — `client.auth` is the second oRPC
   * client `@dos/api-client` builds for exactly that reason. Calling it through `client.api` would
   * ask :3001 for a route it does not mount and get a 404.
   */
  const sessions = useQuery(['auth', 'sessions'], () => api.auth.sessions(), {
    enabled: view === 'sessions',
  })

  const revoke = useMutation((id: string) => api.auth.revokeSession({ sessionId: id }), {
    invalidates: [['auth', 'sessions']],
  })

  const rows = audit.data?.items ?? []
  const current = rows.find((row) => row.id === selected) ?? null

  const auditColumns: readonly RegisterColumn<AuditEntry>[] = [
    textColumn('when', t('o25.when'), (row) => instantWithClock(row.occurredAt), {
      priority: 'identity',
    }),
    textColumn('who', t('o25.who'), (row) => names.staff(row.actorId)),
    textColumn('role', t('o7.role'), (row) => word(row.actorRole)),
    textColumn('action', t('o25.action'), (row) => word(row.action)),
    textColumn('entity', t('o25.entity'), (row) => word(row.entityType), { priority: 'chip' }),
  ]

  /** `auth.sessions` adds `current` to the stored session row; the contract says so, so we read it. */
  type SessionRow = AuthSession & { current: boolean }

  const sessionColumns: readonly RegisterColumn<SessionRow>[] = [
    textColumn('device', t('o25.device'), (row) => row.deviceName ?? row.deviceId, {
      priority: 'identity',
    }),
    textColumn('platform', t('o7.role'), (row) => word(row.platform)),
    textColumn('created', t('app.session'), (row) => instantWithClock(row.createdAt)),
    textColumn('last', t('o25.lastSeen'), (row) => instantWithClock(row.lastUsedAt)),
    {
      key: 'current',
      head: t('word.active'),
      priority: 'chip',
      cell: (row) =>
        row.current ? (
          <StatusChip label={t('word.yes')} family="moss" />
        ) : (
          <Button
            label={t('app.revoke')}
            variant="ghost"
            onPress={() => {
              revoke.mutate(row.id)
            }}
          />
        ),
    },
  ]

  return (
    <Screen
      title={t('o25.title')}
      context={session?.user.name}
      chips={<PageTabs group="/settings" active="/settings/audit" />}
      actions={
        <>
          <Segments
            value={view}
            onChange={(id) => {
              setView(id as 'audit' | 'sessions')
            }}
            items={[
              { id: 'audit', label: t('o25.title') },
              { id: 'sessions', label: t('o25.sessions') },
            ]}
            testID="audit-view"
          />
          {view === 'audit' ? (
            <RangeSegments
              value={range}
              onChange={(id) => {
                setRange(id as RangeId)
              }}
            />
          ) : null}
        </>
      }
    >
      {view === 'audit' ? (
        <Async state={[audit]} rows={12} empty={rows.length === 0} emptyMessage={t('o25.empty')}>
          <Register
            testID="audit-register"
            columns={auditColumns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="when"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
          />
        </Async>
      ) : (
        <Async state={[sessions]} rows={5} empty={(sessions.data?.items.length ?? 0) === 0}>
          <Register
            testID="sessions-register"
            columns={sessionColumns}
            rows={sessions.data?.items ?? []}
            rowKey={(row) => row.id}
            frozen="device"
            state="ready"
          />
        </Async>
      )}

      <Sheet
        open={current !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={current?.action}
        testID="audit-panel"
      >
        {current === null ? null : (
          <Stack gap={4}>
            <Field label={t('o25.when')}>{instantWithClock(current.occurredAt)}</Field>
            <Field label={t('o25.who')}>{names.staff(current.actorId)}</Field>
            <Field
              label={t('o25.entity')}
            >{`${current.entityType} ${current.entityId ?? ''}`}</Field>
            <Panel title={t('o25.before')}>
              <Txt field="body" desk="cell" numberOfLines={8}>
                {JSON.stringify(current.before ?? {}, null, 1)}
              </Txt>
            </Panel>
            <Panel title={t('o25.after')}>
              <Txt field="body" desk="cell" numberOfLines={8}>
                {JSON.stringify(current.after ?? {}, null, 1)}
              </Txt>
            </Panel>
          </Stack>
        )}
      </Sheet>
    </Screen>
  )
}
