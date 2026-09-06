/**
 * O21 — the imports wizard (docs/23 §1.1, docs/17 §D7).
 *
 * Six steps, and the screen shows which one an import is on: upload → preview → map columns → dry run
 * → commit → confirm. A committed import can still be rolled back until it is confirmed, which is why
 * both buttons exist and why the row's own status decides which is live.
 */
import type { ImportJob } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Register,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, PageTabs, Panel, textColumn, useNames } from '../../src/lib/ui'
import { instantWithClock } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const IMPORT_FAMILY: Readonly<Record<string, StatusFamily>> = {
  queued: 'neutral',
  staged: 'ochre',
  running: 'ochre',
  committed: 'clay',
  confirmed: 'moss',
  rolled_back: 'neutral',
  failed: 'brick',
  cancelled: 'neutral',
}

export default function Imports(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const api = useApi()
  const names = useNames()
  const [selected, setSelected] = useState<string | null>(null)

  const list = useQuery(['integrations', 'imports'], () =>
    api.api.integrations.imports.list({ limit: 100 }),
  )
  const detail = useQuery(
    ['integrations', 'imports', 'get', selected ?? 'none'],
    () => api.api.integrations.imports.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const preview = useQuery(
    ['integrations', 'imports', 'preview', selected ?? 'none'],
    () => api.api.integrations.imports.preview({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const profiles = useQuery(['integrations', 'profiles'], () =>
    api.api.integrations.profiles.list({}),
  )

  const dryRun = useMutation(
    (id: string, meta) =>
      api.api.integrations.imports.dryRun({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['integrations', 'imports']] },
  )
  const commit = useMutation(
    (id: string, meta) =>
      api.api.integrations.imports.commit({ id, idempotencyKey: meta.idempotencyKey }),
    { invalidates: [['integrations', 'imports']] },
  )
  const rollback = useMutation(
    (id: string, meta) =>
      api.api.integrations.imports.rollback({
        id,
        idempotencyKey: meta.idempotencyKey,
        reason: 'Rolled back from the owner app',
      }),
    { invalidates: [['integrations', 'imports']] },
  )

  const rows = list.data?.items ?? []
  const job = detail.data?.item

  const columns: readonly RegisterColumn<ImportJob>[] = [
    textColumn('file', t('o21.file'), (row) => row.fileName, { priority: 'identity' }),
    textColumn('source', t('o21.source'), (row) => word(row.source)),
    textColumn('target', t('o21.target'), (row) => word(row.target)),
    textColumn('rows', t('o21.rows'), (row) => row.totalRows),
    textColumn('ok', t('o21.ok'), (row) => row.okRows),
    textColumn('errors', t('o21.errors'), (row) => row.errorRows),
    {
      key: 'status',
      head: t('o21.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip
          label={word(row.status)}
          family={IMPORT_FAMILY[row.status] ?? 'neutral'}
          solid={row.status === 'failed'}
        />
      ),
    },
    textColumn('when', t('o22.requested'), (row) => instantWithClock(row.createdAt)),
  ]

  return (
    <Screen
      title={t('o21.title')}
      chips={<PageTabs group="/settings" active="/settings/imports" />}
    >
      <Stack gap={4}>
        <Panel title={t('o21.profiles')}>
          <Async state={[profiles]} rows={2} empty={(profiles.data?.items.length ?? 0) === 0}>
            <Txt field="body" desk="body">
              {(profiles.data?.items ?? []).map((profile) => profile.name).join(' · ')}
            </Txt>
          </Async>
        </Panel>

        <Async state={[list]} rows={8} empty={rows.length === 0} emptyMessage={t('o21.empty')}>
          <Register
            testID="imports-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="file"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={job?.fileName ?? t('o21.title')}
        testID="import-panel"
      >
        <Async state={[detail]} rows={5}>
          {job === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('o21.source')}>{job.source}</Field>
              <Field label={t('o21.target')}>{job.target}</Field>
              <Field label={t('o21.status')}>
                <StatusChip
                  label={word(job.status)}
                  family={IMPORT_FAMILY[job.status] ?? 'neutral'}
                />
              </Field>
              <Field label={t('o21.rows')}>
                {`${String(job.okRows)} / ${String(job.totalRows)}`}
              </Field>
              <Field label={t('o7.person')}>{names.staff(job.requestedBy)}</Field>
              <Panel title={t('o21.preview')}>
                <Txt field="body" desk="cell" numberOfLines={4}>
                  {(preview.data?.columns ?? []).map((column) => column.header).join(' · ')}
                </Txt>
              </Panel>
              <Button
                label={t('o21.dryRun')}
                variant="secondary"
                disabled={job.status !== 'staged'}
                disabledReason={t('o21.status')}
                loading={dryRun.status === 'pending'}
                onPress={() => {
                  dryRun.mutate(job.id)
                }}
                testID="import-dry-run"
              />
              <Button
                label={t('o21.commit')}
                variant="primary"
                disabled={job.status !== 'staged'}
                disabledReason={t('o21.status')}
                loading={commit.status === 'pending'}
                onPress={() => {
                  commit.mutate(job.id)
                }}
                testID="import-commit"
              />
              <Button
                label={t('o21.rollback')}
                variant="destructive"
                disabled={job.committedAt === null || job.confirmedAt !== null}
                disabledReason={t('o21.status')}
                loading={rollback.status === 'pending'}
                onPress={() => {
                  rollback.mutate(job.id)
                }}
              />
            </Stack>
          )}
        </Async>
      </Sheet>
    </Screen>
  )
}
