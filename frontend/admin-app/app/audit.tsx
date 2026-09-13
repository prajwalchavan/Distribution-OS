/**
 * P8 — the platform audit trail.
 *
 * Every mutation this console can make writes one of these rows: onboarding a distributorship,
 * suspending or reactivating one, changing a plan, asking for a support window or handing it back,
 * locking a login — and, the one that matters most, `support.read`: one row per request made
 * through an owner-approved window, written by the distributor's OWN service, not by this app.
 *
 * A row answers who, where, why and what changed (DOS-109): the staff member by name (admin-service
 * resolves it; this console cannot read a colleague's login), the distributorship by its legal name,
 * the reason typed into the dialog, and one "before → after" line read from what the writer recorded
 * (`src/lib/audit.ts`). Everything the writer recorded stays one tap away in the entry's sheet. The trail
 * narrows by action (the chips, from the contract's `PLATFORM_AUDIT_ACTIONS`) and, from any row, to
 * that person or that distributorship; each filter is sent to the server, never applied to a page. The
 * window is capped at 92 IST days by the contract (docs/20 rule 3).
 */
import { usePlatformApi, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  formatMoney,
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
import {
  PLATFORM_AUDIT_ACTIONS,
  type PlatformAuditAction,
  type PlatformAuditEntry,
} from '@dos/contracts'
import { useState } from 'react'

import { auditChange, auditReason, auditWho, type AuditFormat } from '../src/lib/audit'
import { Async, Field, Note, Panel, ReloadButton, showingCount, textColumn } from '../src/lib/ui'
import { instantWithClock, shiftDays, today } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

type RangeId = 'd30' | 'd60' | 'd90'
const SPAN: Readonly<Record<RangeId, number>> = { d30: 30, d60: 60, d90: 90 }

/** A filter picked from a row: the id the server narrows by, and the words its chip shows. */
interface Picked {
  readonly id: string
  readonly label: string
}

/** The distributorship as a person reads it: its legal name, its handle only when the name is absent. */
function distributorOf(row: PlatformAuditEntry): string {
  return row.tenantName ?? row.tenantSlug ?? '—'
}

export default function Audit(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()

  const [range, setRange] = useState<RangeId>('d30')
  const [selected, setSelected] = useState<string | null>(null)
  const [action, setAction] = useState<PlatformAuditAction | null>(null)
  const [tenant, setTenant] = useState<Picked | null>(null)
  const [actor, setActor] = useState<Picked | null>(null)

  const to = today()
  const from = shiftDays(to, -(SPAN[range] - 1))

  // The key keeps the `['admin', 'audit']` prefix, so every invalidation elsewhere still refetches it.
  const audit = useQuery(
    ['admin', 'audit', from, to, tenant?.id ?? '', actor?.id ?? '', action ?? ''],
    () =>
      api.api.admin.audit.list({
        from,
        to,
        limit: 200,
        ...(tenant === null ? {} : { tenantId: tenant.id }),
        ...(actor === null ? {} : { actorId: actor.id }),
        ...(action === null ? {} : { action }),
      }),
  )

  const rows = audit.data?.items ?? []
  const current = rows.find((row) => row.id === selected) ?? null
  const currentTenantId = current?.tenantId ?? null
  const filtered = action !== null || tenant !== null || actor !== null
  const fmt: AuditFormat = { t, word, money: (paise) => formatMoney(paise) }

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
          {distributorOf(row)}
        </Txt>
      ),
    },
    textColumn('who', t('p8.who'), (row) => auditWho(row, word), { priority: 'chip' }),
    textColumn('entity', t('p8.entity'), (row) => word(row.entityType)),
    textColumn('change', t('p8.change'), (row) => auditChange(row, fmt), { priority: 'detail' }),
    textColumn('reason', t('p8.reason'), (row) => auditReason(row), { priority: 'detail' }),
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
        {tenant === null && actor === null ? null : (
          <Chips
            testID="audit-filters"
            items={[
              ...(tenant === null ? [] : [{ id: 'tenant', label: tenant.label, selected: true }]),
              ...(actor === null ? [] : [{ id: 'actor', label: actor.label, selected: true }]),
            ]}
            onToggle={(id) => {
              if (id === 'tenant') setTenant(null)
              if (id === 'actor') setActor(null)
            }}
            onClear={() => {
              setTenant(null)
              setActor(null)
            }}
          />
        )}
        <Chips
          testID="audit-actions"
          items={PLATFORM_AUDIT_ACTIONS.map((id) => ({
            id,
            label: word(id),
            selected: action === id,
          }))}
          onToggle={(id) => {
            setAction((value) => (value === id ? null : (id as PlatformAuditAction)))
          }}
          {...(action === null
            ? {}
            : {
                onClear: () => {
                  setAction(null)
                },
              })}
        />
        <Async state={[audit]} rows={12}>
          <Register
            testID="audit-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="when"
            state="ready"
            selectedKey={selected}
            emptyMessage={filtered ? t('p8.emptyFiltered') : t('p8.empty')}
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
            <Field label={t('p8.who')}>{auditWho(current, word)}</Field>
            <Field label={t('p8.distributor')}>{distributorOf(current)}</Field>
            <Field label={t('p8.entity')}>{word(current.entityType)}</Field>
            <Field label={t('p8.reason')}>
              <Txt field="body" desk="body" testID="audit-reason">
                {auditReason(current) ?? '—'}
              </Txt>
            </Field>
            <Field label={t('p8.change')}>
              <Txt field="body" desk="body" testID="audit-change">
                {auditChange(current, fmt) ?? '—'}
              </Txt>
            </Field>
            <Stack gap={2}>
              <Button
                label={t('p8.onlyPerson')}
                variant="ghost"
                testID="audit-only-person"
                onPress={() => {
                  setActor({ id: current.actorId, label: auditWho(current, word) })
                  setSelected(null)
                }}
              />
              {currentTenantId === null ? null : (
                <Button
                  label={t('p8.onlyTenant')}
                  variant="ghost"
                  testID="audit-only-tenant"
                  onPress={() => {
                    setTenant({
                      id: currentTenantId,
                      label: current.tenantName ?? current.tenantSlug ?? currentTenantId,
                    })
                    setSelected(null)
                  }}
                />
              )}
            </Stack>
            {current.before === null ? null : (
              <Panel title={t('p8.before')}>
                <Txt field="body" desk="cell" numberOfLines={12}>
                  {JSON.stringify(current.before, null, 1)}
                </Txt>
              </Panel>
            )}
            {current.after === null ? null : (
              <Panel title={current.before === null ? t('p8.payload') : t('p8.after')}>
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
