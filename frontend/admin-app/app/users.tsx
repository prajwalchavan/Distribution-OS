/**
 * P7 — the global sign-in directory.
 *
 * A user in this product is GLOBAL: one phone, one login, however many distributorships it belongs
 * to — a shopkeeper who buys from three of them, or a person who works for two (docs/22 §2, ADR
 * 0006). This console is the only place that view exists, and deliberately so: no tenant-scoped
 * surface may reveal that a phone appears in another distributor's network (docs/17 item 27), which
 * is why `retailers.linkIdentity` is back-office only and why `admin.users.list` lives here alone.
 *
 * The one action is the platform kill switch: `admin.users.disable` stops this login working in
 * every distributorship at once and ends every open session. It does NOT remove anyone from a
 * distributorship — that is their own owner's to do, through `tenancy.staff.setStatus`. Its undo is
 * `admin.users.enable` (DOS-107), super-only and audited like the lock: the login works again from
 * its next sign-in, and the sessions the lock ended stay ended.
 */
import { usePlatformApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  ErrorState,
  Register,
  Row,
  Screen,
  Search,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { uuidv7 } from '@dos/domain'
import type { AdminMembership, AdminUser } from '@dos/contracts'
import { useState } from 'react'

import {
  Async,
  Field,
  Note,
  chipColumn,
  searchState,
  showingCount,
  textColumn,
  useCan,
} from '../src/lib/ui'
import { instantWithClock } from '../src/lib/dates'
import { useWord } from '../src/lib/words'

/**
 * Every distributorship a person belongs to, one line each: the Sheet's "Member of", and the lock and
 * unlock confirmations, which name exactly what the press spans.
 */
function MembershipLines({
  memberships,
}: {
  memberships: readonly AdminMembership[]
}): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  if (memberships.length === 0) {
    return (
      <Txt field="body" desk="body">
        {t('p7.membershipNone')}
      </Txt>
    )
  }
  return (
    <Stack gap={2}>
      {memberships.map((membership) => (
        <Row key={`${membership.tenantId}-${membership.role}`} justify="between" gap={3}>
          <Txt field="body" desk="cell" numberOfLines={1}>
            {membership.tenantName}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {`${word(membership.role)} · ${word(membership.status)}`}
          </Txt>
        </Row>
      ))}
    </Stack>
  )
}

export default function People(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = usePlatformApi()
  const can = useCan()

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'platform' | 'disabled'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [locking, setLocking] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [reason, setReason] = useState('')

  const term = query.trim()
  const search = term.length >= 2 ? term : undefined

  const users = useQuery(['admin', 'users', search ?? '', scope], () =>
    api.api.admin.users.list({
      limit: 100,
      ...(search === undefined ? {} : { q: search }),
      ...(scope === 'platform' ? { platformOnly: true } : {}),
      ...(scope === 'disabled' ? { status: 'disabled' as const } : {}),
    }),
  )

  const rows = users.data?.items ?? []
  const current = rows.find((row) => row.id === selected) ?? null

  const disable = useMutation(
    (input: { id: string; reason: string }) =>
      api.api.admin.users.disable({
        idempotencyKey: uuidv7(),
        id: input.id,
        reason: input.reason.trim(),
      }),
    {
      invalidates: [
        ['admin', 'users'],
        ['admin', 'audit'],
        ['admin', 'metrics'],
      ],
      onSuccess: () => {
        setLocking(false)
        setReason('')
      },
    },
  )

  // A fresh idempotency key on every unlock, exactly as the lock mints one (DOS-107): lock, unlock,
  // lock, unlock with the same reason must run the second unlock, never replay the first one's reply.
  const enable = useMutation(
    (input: { id: string; reason: string }) =>
      api.api.admin.users.enable({
        idempotencyKey: uuidv7(),
        id: input.id,
        reason: input.reason.trim(),
      }),
    {
      invalidates: [
        ['admin', 'users'],
        ['admin', 'audit'],
        ['admin', 'metrics'],
      ],
      onSuccess: () => {
        setUnlocking(false)
        setReason('')
      },
    },
  )

  const membershipLine = (row: AdminUser): string => {
    if (row.memberships.length === 0) return t('p7.membershipNone')
    if (row.memberships.length === 1) {
      const only = row.memberships[0]
      return only === undefined ? t('p7.membershipOne') : `${only.tenantName} · ${word(only.role)}`
    }
    return t('p7.membershipCount', { count: row.memberships.length })
  }

  const columns: readonly RegisterColumn<AdminUser>[] = [
    {
      key: 'name',
      head: t('p7.name'),
      priority: 'identity',
      cell: (row) => (
        <Stack gap={1}>
          <Txt field="bodyStrong" desk="cell" numberOfLines={1}>
            {row.name}
          </Txt>
          <Txt field="label" desk="meta" color={colors.text.secondary} numberOfLines={1}>
            {row.username ?? t('p7.noUsername')}
          </Txt>
        </Stack>
      ),
    },
    chipColumn('status', t('p7.status'), (row) => ({
      label: row.platformRole === null ? word(row.status) : word(row.platformRole),
      family: row.status === 'disabled' ? 'brick' : row.platformRole === null ? 'moss' : 'clay',
      solid: row.status === 'disabled',
    })),
    textColumn('phone', t('p7.phone'), (row) => row.phone),
    {
      key: 'memberships',
      head: t('p7.memberships'),
      priority: 'value',
      cell: (row) => (
        <Txt field="body" desk="cell" numberOfLines={1}>
          {membershipLine(row)}
        </Txt>
      ),
    },
    textColumn('lastLogin', t('p7.lastLogin'), (row) =>
      row.lastLoginAt === null ? t('app.never') : instantWithClock(row.lastLoginAt),
    ),
  ]

  return (
    <Screen title={t('p7.title')} context={showingCount(t, users, rows.length)}>
      <Stack gap={4}>
        <Note testID="people-intro">{t('p7.intro')}</Note>
        <Search
          testID="people-search"
          value={query}
          onChange={setQuery}
          placeholder={t('p7.searchPlaceholder')}
          state={searchState(users, term, rows.length)}
        />
        <Segments
          testID="people-scope"
          value={scope}
          onChange={(id) => {
            setScope(id as 'all' | 'platform' | 'disabled')
          }}
          items={[
            { id: 'all', label: t('app.all') },
            { id: 'platform', label: t('p7.platformOnly') },
            { id: 'disabled', label: t('p7.disabled') },
          ]}
        />
        <Async state={[users]} rows={10}>
          <Register
            testID="people-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="name"
            state="ready"
            selectedKey={selected}
            emptyMessage={t('p7.empty')}
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
        title={current?.name}
        testID="person-detail"
      >
        {current === null ? null : (
          <Stack gap={4}>
            <Row gap={2} wrap>
              <StatusChip
                label={word(current.status)}
                family={current.status === 'disabled' ? 'brick' : 'moss'}
                solid={current.status === 'disabled'}
              />
              {current.platformRole === null ? null : (
                <StatusChip label={word(current.platformRole)} family="clay" />
              )}
              {current.mustChangePassword ? (
                <StatusChip label={t('p7.mustChange')} family="ochre" />
              ) : null}
              {current.lockedUntil === null ? null : (
                <StatusChip
                  label={t('p7.locked', { when: instantWithClock(current.lockedUntil) })}
                  family="ochre"
                />
              )}
            </Row>
            <Field label={t('p7.username')}>{current.username ?? t('p7.noUsername')}</Field>
            <Field label={t('p7.phone')}>{current.phone}</Field>
            <Field label={t('p7.lastLogin')}>
              {current.lastLoginAt === null
                ? t('app.never')
                : instantWithClock(current.lastLoginAt)}
            </Field>
            <Field label={t('p7.membershipsIn')}>
              <MembershipLines memberships={current.memberships} />
            </Field>
            {/* Locking a login, and unlocking it again, is a super administrator's (DOS-106, DOS-107). */}
            {current.status === 'disabled' && can('admin.users.enable') ? (
              <Button
                label={t('p7.enable')}
                variant="primary"
                testID="enable-user"
                onPress={() => {
                  setReason('')
                  setUnlocking(true)
                }}
              />
            ) : null}
            {current.status !== 'disabled' && can('admin.users.disable') ? (
              <Button
                label={t('p7.disable')}
                variant="destructive"
                testID="disable-user"
                onPress={() => {
                  setReason('')
                  setLocking(true)
                }}
              />
            ) : null}
          </Stack>
        )}
      </Sheet>

      <Dialog
        open={locking && current !== null}
        onClose={() => {
          setLocking(false)
        }}
        title={t('p7.disableTitle', { name: current?.name ?? '' })}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('p7.disableBody')}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('p7.lockSpans')}
            </Txt>
            <MembershipLines memberships={current?.memberships ?? []} />
            <TextInput
              label={t('p7.disableReason')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
              maxLength={500}
              testID="disable-reason"
            />
          </Stack>
        }
        confirmLabel={t('p7.disable')}
        destructive
        busy={disable.status === 'pending'}
        onConfirm={() => {
          if (current === null || reason.trim() === '') return
          disable.mutate({ id: current.id, reason })
        }}
        testID="disable-dialog"
      />

      <Dialog
        open={unlocking && current !== null && current.status === 'disabled'}
        onClose={() => {
          setUnlocking(false)
        }}
        title={t('p7.enableTitle', { name: current?.name ?? '' })}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('p7.enableBody')}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('p7.unlockSpans')}
            </Txt>
            <MembershipLines memberships={current?.memberships ?? []} />
            <TextInput
              label={t('p7.enableReason')}
              value={reason}
              onChange={setReason}
              capitalize="sentences"
              maxLength={500}
              testID="enable-reason"
            />
            {enable.error === undefined ? null : (
              <ErrorState message={t('p7.enableFailed')} detail={enable.error.message} />
            )}
          </Stack>
        }
        confirmLabel={t('p7.enable')}
        busy={enable.status === 'pending'}
        onConfirm={() => {
          if (current === null || reason.trim() === '') return
          enable.mutate({ id: current.id, reason })
        }}
        testID="enable-dialog"
      />
    </Screen>
  )
}
