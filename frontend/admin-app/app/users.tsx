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
 * distributorship — that is their own owner's to do, through `tenancy.staff.setStatus`.
 */
import { usePlatformApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
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
import type { AdminUser } from '@dos/contracts'
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
              {current.memberships.length === 0 ? (
                t('p7.membershipNone')
              ) : (
                <Stack gap={2}>
                  {current.memberships.map((membership) => (
                    <Row
                      key={`${membership.tenantId}-${membership.role}`}
                      justify="between"
                      gap={3}
                    >
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {membership.tenantName}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {`${word(membership.role)} · ${word(membership.status)}`}
                      </Txt>
                    </Row>
                  ))}
                </Stack>
              )}
            </Field>
            {/* Locking a login is a super administrator's (DOS-106). */}
            {current.status === 'disabled' || !can('admin.users.disable') ? null : (
              <Button
                label={t('p7.disable')}
                variant="destructive"
                testID="disable-user"
                onPress={() => {
                  setLocking(true)
                }}
              />
            )}
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
    </Screen>
  )
}
