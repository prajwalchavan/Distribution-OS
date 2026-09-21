/**
 * M-staff — who works on this floor, and what else their login may open (docs/29 §2).
 *
 * The manager's half of the staff screen, and deliberately only that half: hiring, passwords and
 * disabling stay the owner's. What a manager needs day to day is the one thing this screen does —
 * when the godown keeper drives the second van on Tuesdays, the manager adds `delivery` to his
 * membership and he opens the delivery app with his OWN username, instead of the van phone being
 * signed in on somebody else's password.
 *
 * It is a downward grant and never a way up: the manager may hand out only the three roles it already
 * administers (salesperson, warehouse, delivery), only to the people it already administers, and the
 * server refuses anything else before the database is asked. The accountant does not see this page at
 * all — the rail reads `tenancy.memberships.update` from the same matrix manager-service enforces.
 */
import type { ExtraRole, StaffMember } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { isGrantableExtraRole } from '@dos/domain'
import {
  Button,
  Chips,
  Register,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useEffect, useState } from 'react'

import { Async, Panel, Refusal, stayOpen, textColumn } from '../../src/lib/ui'
import { instantWithClock } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

/** docs/29 §2: a manager may grant only the three roles it already administers. */
const MANAGER_MAY_GRANT = [
  'salesperson',
  'warehouse',
  'delivery',
] as const satisfies readonly ExtraRole[]

export default function ManagerStaffScreen(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const [selected, setSelected] = useState<StaffMember | null>(null)
  const [extraRoles, setExtraRoles] = useState<readonly ExtraRole[]>([])

  const staff = useQuery(['tenancy', 'staff'], () => api.api.tenancy.staff.list({}))

  const save = useMutation(
    (input: { userId: string; extraRoles: readonly ExtraRole[] }, meta) =>
      api.api.tenancy.memberships.update({
        userId: input.userId,
        idempotencyKey: meta.idempotencyKey,
        extraRoles: [...input.extraRoles],
      }),
    { invalidates: [['tenancy', 'staff']] },
  )

  useEffect(() => {
    setExtraRoles(selected?.extraRoles ?? [])
  }, [selected])

  const rows = staff.data?.items ?? []
  /** The floor: the manager administers these three and nobody else (`assertMayAdminister`). */
  const mine = rows.filter((row) => isGrantableExtraRole(row.role))
  const mayGrant =
    selected !== null && (MANAGER_MAY_GRANT as readonly string[]).includes(selected.role)

  const columns: readonly RegisterColumn<StaffMember>[] = [
    textColumn('name', t('m22.person'), (row) => row.name, { priority: 'identity' }),
    textColumn('username', t('m22.username'), (row) => row.username),
    textColumn('role', t('m22.role'), (row) => word(row.role)),
    textColumn('extra', t('m22.extraRoles'), (row) =>
      row.extraRoles.length === 0 ? null : row.extraRoles.map(word).join(' · '),
    ),
    textColumn('last', t('m22.lastLogin'), (row) => instantWithClock(row.lastLoginAt)),
    {
      key: 'status',
      head: t('m22.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={word(row.status)}
          family={row.status === 'active' ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  return (
    <Screen title={t('m22.title')}>
      <Stack gap={4}>
        <Async state={[staff]} rows={8} empty={mine.length === 0}>
          <Register
            testID="staff-register"
            columns={columns}
            rows={mine}
            rowKey={(row) => row.userId}
            frozen="name"
            selectedKey={selected?.userId ?? null}
            onSelect={(row) => {
              setSelected(row)
            }}
            state="ready"
            totals={{ name: t('app.rows', { count: mine.length }) }}
          />
        </Async>

        {selected === null ? null : (
          <Panel title={selected.name} testID="staff-actions">
            <Stack gap={3}>
              <Txt field="label" desk="meta">
                {t('m22.extraRoles')}
              </Txt>
              {mayGrant ? (
                <>
                  <Chips
                    testID="staff-extra-roles"
                    items={MANAGER_MAY_GRANT.filter((role) => role !== selected.role).map(
                      (role) => ({
                        id: role,
                        label: word(role),
                        selected: extraRoles.includes(role),
                      }),
                    )}
                    onToggle={(id) => {
                      if (!isGrantableExtraRole(id)) return
                      setExtraRoles((held) =>
                        held.includes(id) ? held.filter((r) => r !== id) : [...held, id],
                      )
                    }}
                  />
                  <Txt field="label" desk="meta">
                    {t('m22.extraRolesHelp')}
                  </Txt>
                  <Refusal of={[save]} scope={selected.userId} testID="staff-extra-roles-refusal" />
                  <Button
                    label={t('m22.saveRoles')}
                    variant="secondary"
                    loading={save.status === 'pending'}
                    onPress={() => {
                      void save.mutateAsync({ userId: selected.userId, extraRoles }).catch(stayOpen)
                    }}
                    testID="staff-save-extra-roles"
                  />
                </>
              ) : (
                <Txt field="body" desk="body">
                  {t('m22.askOwner')}
                </Txt>
              )}
            </Stack>
          </Panel>
        )}
      </Stack>
    </Screen>
  )
}
