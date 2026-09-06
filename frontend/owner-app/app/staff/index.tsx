/**
 * O7 — beats and staff (docs/23 §1.1).
 *
 * Who works here, on which beat, on which days, and how much a rep may give away before the owner has
 * to look at it. Creating a person and setting a password are real writes with real consequences, so
 * both go through a confirmation that prints exactly what will happen.
 */
import type { Beat, BeatAssignmentView, RepBound, StaffMember } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Panel, moneyColumn, textColumn } from '../../src/lib/ui'
import { instantWithClock } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
type View = 'staff' | 'beats' | 'assignments' | 'bounds'

export default function StaffScreen(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const [view, setView] = useState<View>('staff')
  const [selected, setSelected] = useState<StaffMember | null>(null)
  const [dialog, setDialog] = useState<'password' | 'status' | null>(null)
  const [password, setPassword] = useState('')

  const staff = useQuery(['tenancy', 'staff'], () => api.api.tenancy.staff.list({}))
  const beats = useQuery(['retailers', 'beats'], () => api.api.retailers.beats.list({}))
  const assignments = useQuery(
    ['retailers', 'beatAssignments'],
    () => api.api.retailers.beats.assignments.list({ limit: 200, currentOnly: false }),
    { enabled: view === 'assignments' },
  )
  const bounds = useQuery(['pricing', 'bounds'], () => api.api.pricing.bounds.list({}), {
    enabled: view === 'bounds',
  })

  const setPasswordFor = useMutation(
    (input: { userId: string; password: string }, meta) =>
      api.api.tenancy.staff.setPassword({
        userId: input.userId,
        idempotencyKey: meta.idempotencyKey,
        temporaryPassword: input.password,
      }),
    { invalidates: [['tenancy', 'staff']] },
  )
  const setStatus = useMutation(
    (input: { userId: string; status: 'active' | 'disabled' }, meta) =>
      api.api.tenancy.staff.setStatus({
        userId: input.userId,
        idempotencyKey: meta.idempotencyKey,
        status: input.status,
      }),
    { invalidates: [['tenancy', 'staff'], ['names']] },
  )

  const staffRows = staff.data?.items ?? []
  const beatRows = beats.data?.items ?? []

  const nameOfUser = (id: string): string =>
    staffRows.find((row) => row.userId === id)?.name ?? id.slice(0, 8)

  const staffColumns: readonly RegisterColumn<StaffMember>[] = [
    textColumn('name', t('o7.person'), (row) => row.name, { priority: 'identity' }),
    textColumn('username', t('o7.username'), (row) => row.username),
    textColumn('role', t('o7.role'), (row) => word(row.role)),
    textColumn('phone', t('o6.phone'), (row) => row.phone),
    textColumn('last', t('o7.lastLogin'), (row) => instantWithClock(row.lastLoginAt)),
    {
      key: 'status',
      head: t('o7.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={word(row.status)}
          family={row.status === 'active' ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const beatColumns: readonly RegisterColumn<Beat>[] = [
    textColumn('name', t('o7.beatName'), (row) => row.name, { priority: 'identity' }),
    textColumn('area', t('o7.area'), (row) => row.area),
    textColumn('days', t('o7.visitDays'), (row) =>
      row.visitDays.map((day) => DAY_NAMES[day % 7]).join(' · '),
    ),
    {
      key: 'active',
      head: t('word.active'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={row.active ? t('word.yes') : t('word.no')}
          family={row.active ? 'moss' : 'neutral'}
        />
      ),
    },
  ]

  const assignmentColumns: readonly RegisterColumn<BeatAssignmentView>[] = [
    textColumn('beat', t('o7.beatName'), (row) => row.beatName, { priority: 'identity' }),
    textColumn('person', t('o7.person'), (row) => row.userName),
    textColumn('from', t('app.from'), (row) => row.validFrom),
    textColumn('to', t('app.to'), (row) => row.validTo),
  ]

  const boundColumns: readonly RegisterColumn<RepBound>[] = [
    textColumn('person', t('o7.person'), (row) => nameOfUser(row.userId), {
      priority: 'identity',
    }),
    textColumn('max', t('o7.maxDiscount'), (row) => `${String(row.maxDiscountBps / 100)}%`),
    moneyColumn('order', t('o5.value'), (row) => row.maxOrderDiscountPaise),
  ]

  return (
    <Screen
      title={t('o7.title')}
      actions={
        <Segments
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'staff', label: t('o7.staff') },
            { id: 'beats', label: t('o7.beats') },
            { id: 'assignments', label: t('o7.assignments') },
            { id: 'bounds', label: t('o7.bounds') },
          ]}
          testID="staff-view"
        />
      }
    >
      <Stack gap={4}>
        {view === 'staff' ? (
          <Async state={[staff]} rows={10} empty={staffRows.length === 0}>
            <Register
              testID="staff-register"
              columns={staffColumns}
              rows={staffRows}
              rowKey={(row) => row.userId}
              frozen="name"
              selectedKey={selected?.userId ?? null}
              onSelect={(row) => {
                setSelected(row)
              }}
              state="ready"
              totals={{ name: t('app.rows', { count: staffRows.length }) }}
            />
          </Async>
        ) : null}

        {view === 'beats' ? (
          <Async state={[beats]} rows={8} empty={beatRows.length === 0}>
            <Register
              testID="beats-register"
              columns={beatColumns}
              rows={beatRows}
              rowKey={(row) => row.id}
              frozen="name"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'assignments' ? (
          <Async state={[assignments]} rows={8} empty={(assignments.data?.items.length ?? 0) === 0}>
            <Register
              testID="assignments-register"
              columns={assignmentColumns}
              rows={assignments.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="beat"
              state="ready"
            />
          </Async>
        ) : null}

        {view === 'bounds' ? (
          <Async state={[bounds]} rows={6} empty={(bounds.data?.items.length ?? 0) === 0}>
            <Stack gap={3}>
              <Txt field="label" desk="meta">
                {t('o7.needsApproval')}
              </Txt>
              <Register
                testID="bounds-register"
                columns={boundColumns}
                rows={bounds.data?.items ?? []}
                rowKey={(row) => row.id}
                frozen="person"
                state="ready"
              />
            </Stack>
          </Async>
        ) : null}

        {selected === null || view !== 'staff' ? null : (
          <Panel title={selected.name} testID="staff-actions">
            <Stack gap={3}>
              <Button
                label={t('o7.resetPassword')}
                variant="secondary"
                onPress={() => {
                  setDialog('password')
                }}
                testID="staff-set-password"
              />
              <Button
                label={selected.status === 'active' ? t('o7.disable') : t('o7.enable')}
                variant={selected.status === 'active' ? 'destructive' : 'primary'}
                onPress={() => {
                  setDialog('status')
                }}
                testID="staff-set-status"
              />
            </Stack>
          </Panel>
        )}
      </Stack>

      <Dialog
        open={dialog !== null}
        onClose={() => {
          setDialog(null)
        }}
        title={dialog === 'password' ? t('o7.resetPassword') : t('o7.status')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {selected?.name ?? ''}
            </Txt>
            {dialog === 'password' ? (
              <TextInput
                label={t('app.newPassword')}
                value={password}
                onChange={setPassword}
                secure
              />
            ) : (
              <Txt field="label" desk="meta">
                {selected?.status === 'active' ? t('o7.disable') : t('o7.enable')}
              </Txt>
            )}
          </Stack>
        }
        confirmLabel={dialog === 'password' ? t('o7.resetPassword') : t('app.save')}
        destructive={dialog === 'status' && selected?.status === 'active'}
        busy={setPasswordFor.status === 'pending' || setStatus.status === 'pending'}
        onConfirm={() => {
          if (selected === null) return
          const done = (): void => {
            setDialog(null)
            setPassword('')
          }
          if (dialog === 'password')
            void setPasswordFor.mutateAsync({ userId: selected.userId, password }).then(done, done)
          else
            void setStatus
              .mutateAsync({
                userId: selected.userId,
                status: selected.status === 'active' ? 'disabled' : 'active',
              })
              .then(done, done)
        }}
        testID="staff-dialog"
      />
    </Screen>
  )
}
