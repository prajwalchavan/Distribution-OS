/**
 * O22 — exports and Tally (docs/23 §1.1).
 *
 * An export is a JOB, not a download: the worker renders it and answers a short-lived signed URL, so
 * this screen is a queue with a download beside every finished row. The Tally half is the ledger-name
 * map and the sync log — what this product calls an account against what Tally calls it.
 */
import type { ExportJob, TallyMapping } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Txt,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useState } from 'react'

import { Async, PageTabs, textColumn, useNames } from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { instantWithClock, rangeOf } from '../../src/lib/dates'

const JOB_FAMILY: Readonly<Record<string, StatusFamily>> = {
  queued: 'neutral',
  running: 'ochre',
  succeeded: 'moss',
  failed: 'brick',
  cancelled: 'neutral',
}

export default function Exports(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const names = useNames()
  const [view, setView] = useState<'exports' | 'tally'>('exports')

  const span = rangeOf('d90')
  const jobs = useQuery(['integrations', 'exports'], () =>
    api.api.integrations.exports.list({ limit: 100 }),
  )
  const mappings = useQuery(
    ['integrations', 'tally', 'mappings'],
    () => api.api.integrations.tally.mappings.list({ limit: 200 }),
    { enabled: view === 'tally' },
  )

  const request = useMutation(
    (_input: null, meta) =>
      api.api.reporting.exports.request({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        register: 'gstSalesRegister',
        format: 'csv',
        filters: { from: span.from, to: span.to },
      }),
    { invalidates: [['integrations', 'exports']] },
  )

  const open = (id: string): void => {
    void api.api.integrations.exports.downloadUrl({ id }).then((result) => {
      const url = absoluteUrl(result.url)
      if (url !== null) void documents.open(url)
    })
  }

  const jobColumns: readonly RegisterColumn<ExportJob>[] = [
    textColumn('kind', t('o22.kind'), (row) => row.kind, { priority: 'identity' }),
    textColumn('file', t('o21.file'), (row) => row.fileName),
    textColumn('rows', t('o22.rowCount'), (row) => row.rowCount),
    textColumn('by', t('o7.person'), (row) => names.staff(row.requestedBy)),
    textColumn('when', t('o22.requested'), (row) => instantWithClock(row.createdAt)),
    {
      key: 'status',
      head: t('o22.status'),
      priority: 'chip',
      cell: (row) => <StatusChip label={row.status} family={JOB_FAMILY[row.status] ?? 'neutral'} />,
    },
    {
      key: 'download',
      head: t('o22.download'),
      cell: (row) =>
        row.status === 'succeeded' ? (
          <Button
            label={t('o22.download')}
            variant="ghost"
            size="desk"
            onPress={() => {
              open(row.id)
            }}
          />
        ) : (
          <Txt field="body" desk="cell">
            {row.error ?? '—'}
          </Txt>
        ),
    },
  ]

  const mappingColumns: readonly RegisterColumn<TallyMapping>[] = [
    textColumn('entity', t('o22.register'), (row) => row.entityType, { priority: 'identity' }),
    textColumn('local', t('o12.account'), (row) => row.entityLabel),
    textColumn('tally', t('o22.tallyLedger'), (row) => row.tallyName),
  ]

  return (
    <Screen
      title={t('o22.title')}
      chips={<PageTabs group="/reports" active="/reports/exports" />}
      actions={
        <>
          <Segments
            size="desk"
            value={view}
            onChange={(id) => {
              setView(id as 'exports' | 'tally')
            }}
            items={[
              { id: 'exports', label: t('o22.tab') },
              { id: 'tally', label: t('o22.tally') },
            ]}
            testID="exports-view"
          />
          <Button
            label={t('o22.request')}
            variant="primary"
            size="desk"
            loading={request.status === 'pending'}
            onPress={() => {
              request.reset()
              request.mutate(null)
            }}
            testID="exports-request"
          />
        </>
      }
    >
      <Stack gap={4}>
        {view === 'exports' ? (
          <Async
            state={[jobs]}
            rows={10}
            empty={(jobs.data?.items.length ?? 0) === 0}
            emptyMessage={t('o22.empty')}
          >
            <Register
              testID="exports-register"
              columns={jobColumns}
              rows={jobs.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="kind"
              state="ready"
            />
          </Async>
        ) : (
          <Async state={[mappings]} rows={10} empty={(mappings.data?.items.length ?? 0) === 0}>
            <Register
              testID="tally-register"
              columns={mappingColumns}
              rows={mappings.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="entity"
              state="ready"
            />
          </Async>
        )}
      </Stack>
    </Screen>
  )
}
