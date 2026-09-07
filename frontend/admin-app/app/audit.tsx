/**
 * P8 — the platform audit trail.
 *
 * Every mutation this console can make writes one of these rows: onboarding a distributorship,
 * suspending or reactivating one, changing a plan, asking for a support window or handing it back,
 * locking a login — and, the one that matters most, `support.read`: one row per request made
 * through an owner-approved window, written by the distributor's OWN service, not by this app.
 *
 * The before/after pair is the whole point of an audit row, so the panel prints both rather than
 * summarising them. The window is capped at 92 IST days by the contract (docs/20 rule 3).
 */
import { usePlatformApi, useQuery } from '@dos/api-client/react'
import {
  Register,
  Screen,
  Segments,
  Sheet,
  Stack,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import type { PlatformAuditEntry } from '@dos/contracts'
import { useState } from 'react'

import { Async, Field, Note, Panel, ReloadButton, showingCount, textColumn } from '../src/lib/ui'
import { instantWithClock, shiftDays, today } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

type RangeId = 'd30' | 'd60' | 'd90'
const SPAN: Readonly<Record<RangeId, number>> = { d30: 30, d60: 60, d90: 90 }

export default function Audit(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()

  const [range, setRange] = useState<RangeId>('d30')
  const [selected, setSelected] = useState<string | null>(null)

  const to = today()
  const from = shiftDays(to, -(SPAN[range] - 1))

  const audit = useQuery(['admin', 'audit', from, to], () =>
    api.api.admin.audit.list({ from, to, limit: 200 }),
  )

  const rows = audit.data?.items ?? []
  const current = rows.find((row) => row.id === selected) ?? null

  const columns: readonly RegisterColumn<PlatformAuditEntry>[] = [
    {
      key: 'when',
      head: t('p8.when'),
      priority: 'identity',
      cell: (row) => (
        <Stack gap={1}>
          <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
            {word(row.action)}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
            {instantWithClock(row.occurredAt)}
          </Txt>
        </Stack>
      ),
    },
    {
      key: 'distributor',
      head: t('p8.distributor'),
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numberOfLines={1}>
          {row.tenantSlug ?? '—'}
        </Txt>
      ),
    },
    textColumn('who', t('p8.who'), (row) => word(row.actorRole), { priority: 'chip' }),
    textColumn('entity', t('p8.entity'), (row) => word(row.entityType)),
  ]

  return (
    <Screen
      title={t('p8.title')}
      context={showingCount(t, audit, rows.length)}
      actions={
        <>
          <Segments
            testID="audit-range"
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
            items={[
              { id: 'd30', label: t('app.days30') },
              { id: 'd60', label: t('app.days60') },
              { id: 'd90', label: t('app.days90') },
            ]}
          />
          <ReloadButton
            onPress={() => {
              void audit.refetch()
            }}
          />
        </>
      }
    >
      <Stack gap={4}>
        <Note testID="audit-intro">{t('p8.intro')}</Note>
        <Async state={[audit]} rows={12}>
          <Register
            testID="audit-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="when"
            state="ready"
            selectedKey={selected}
            emptyMessage={t('p8.empty')}
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
        title={current === null ? t('p8.detail') : word(current.action)}
        testID="audit-detail"
      >
        {current === null ? null : (
          <Stack gap={4}>
            <Field label={t('p8.when')}>{instantWithClock(current.occurredAt)}</Field>
            <Field label={t('p8.who')}>{word(current.actorRole)}</Field>
            <Field label={t('p8.distributor')}>{current.tenantSlug ?? '—'}</Field>
            <Field label={t('p8.entity')}>{word(current.entityType)}</Field>
            {current.before === null ? null : (
              <Panel title={t('p8.before')}>
                <Txt field="body" desk="cell" numberOfLines={12}>
                  {JSON.stringify(current.before, null, 1)}
                </Txt>
              </Panel>
            )}
            {current.after === null ? null : (
              <Panel title={t('p8.after')}>
                <Txt field="body" desk="cell" numberOfLines={12}>
                  {JSON.stringify(current.after, null, 1)}
                </Txt>
              </Panel>
            )}
          </Stack>
        )}
      </Sheet>
    </Screen>
  )
}
