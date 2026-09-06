/**
 * M13 — Tally export and mapping (docs/23 §2.1).
 *
 * Tarsun already bills on TradeEzee and keeps books in Tally; coexistence is a founder decision
 * (docs/22 §8, 2026-08) and this screen is the coexistence. Three parts:
 *
 *  - EXPORT JOBS. `integrations.exports.request` queues a Tally XML (or GSTR-1 JSON, or a register)
 *    for a window; the WORKER renders it and the row carries a short-lived download URL when it is
 *    ready. Nothing is generated in the browser, so the file the accountant imports and the file the
 *    audit sees are one file.
 *  - MAPPINGS. Tally has its own name for every ledger, item, godown and party. The mapping table is
 *    ours-to-theirs, and it is edited here rather than guessed at export time.
 *  - THE SYNC LEDGER. Which documents an export has already pushed, with the GUID Tally gave them —
 *    the answer to "did this bill go across?", which is the only question anyone asks afterwards.
 *
 * All three are BACK_OFFICE including the writes, so the accountant works this screen fully.
 */
import type { ExportJob, TallyMapping, TallySyncEntry } from '@dos/contracts'
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
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useState } from 'react'

import { Async, PageTabs, RangeSegments, textColumn, useCan, useNames } from '../../src/lib/ui'
import { absoluteUrl } from '../../src/config'
import { rangeOf, shortInstant, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

const JOB_FAMILY: Readonly<Record<string, StatusFamily>> = {
  queued: 'ochre',
  running: 'ochre',
  succeeded: 'moss',
  failed: 'brick',
  cancelled: 'neutral',
}

type ExportKind = 'tally_xml' | 'gstr1_json' | 'sales_register_xlsx' | 'outstanding_xlsx'
type View = 'exports' | 'mappings' | 'sync'

export default function Tally(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()

  const mayQueue = can('integrations.exports.request')
  const mayMap = can('integrations.tally.mappings.upsert')
  const [view, setView] = useState<View>('exports')
  const [range, setRange] = useState<RangeId>('d30')
  const [queueing, setQueueing] = useState(false)
  const [kind, setKind] = useState<ExportKind>('tally_xml')
  const [editing, setEditing] = useState<TallyMapping | null>(null)
  const [tallyName, setTallyName] = useState('')
  const [tallyParent, setTallyParent] = useState('')

  const span = rangeOf(range)
  const jobs = useQuery(['integrations', 'exports'], () =>
    api.api.integrations.exports.list({ limit: 100 }),
  )
  const mappings = useQuery(
    ['integrations', 'tally', 'mappings'],
    () => api.api.integrations.tally.mappings.list({ limit: 200 }),
    { enabled: view === 'mappings' },
  )
  const sync = useQuery(
    ['integrations', 'tally', 'sync'],
    () => api.api.integrations.tally.syncLedger.list({ limit: 200 }),
    { enabled: view === 'sync' },
  )

  const queue = useMutation(
    (input: { kind: ExportKind; from: string; to: string }, meta) =>
      api.api.integrations.exports.request({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        kind: input.kind,
        from: input.from,
        to: input.to,
      }),
    { invalidates: [['integrations']] },
  )
  const setMapping = useMutation(
    (
      input: {
        entityType: TallyMapping['entityType']
        entityId: string
        tallyName: string
        tallyParent: string
      },
      meta,
    ) =>
      api.api.integrations.tally.mappings.upsert({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        entityType: input.entityType,
        entityId: input.entityId,
        tallyName: input.tallyName,
        ...(input.tallyParent === '' ? {} : { tallyParent: input.tallyParent }),
      }),
    { invalidates: [['integrations']] },
  )

  const openJob = (job: ExportJob): void => {
    void api.api.integrations.exports.downloadUrl({ id: job.id }).then((result) => {
      const url = absoluteUrl(result.url)
      if (url !== null) void documents.open(url)
    })
  }

  const jobColumns: readonly RegisterColumn<ExportJob>[] = [
    textColumn('kind', t('m13.kind'), (row) => word(row.kind), { priority: 'identity' }),
    {
      key: 'status',
      head: t('m13.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={JOB_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('rows', t('m13.rows'), (row) => row.rowCount, { align: 'right' }),
    textColumn('by', t('m9.receivedBy'), (row) => names.staff(row.requestedBy)),
    textColumn('at', t('m13.requestedAt'), (row) => shortInstant(row.createdAt)),
    textColumn('file', t('m13.download'), (row) => row.fileName),
  ]

  const mappingColumns: readonly RegisterColumn<TallyMapping>[] = [
    textColumn('entity', t('m13.entity'), (row) => row.entityLabel, { priority: 'identity' }),
    textColumn('type', t('m13.docType'), (row) => word(row.entityType)),
    textColumn('name', t('m13.tallyName'), (row) => row.tallyName, { priority: 'value' }),
    textColumn('parent', t('m13.tallyParent'), (row) => row.tallyParent),
    textColumn('at', t('m13.pushedAt'), (row) => shortInstant(row.updatedAt)),
  ]

  const syncColumns: readonly RegisterColumn<TallySyncEntry>[] = [
    textColumn('doc', t('m13.document'), (row) => row.docId, { priority: 'identity' }),
    textColumn('type', t('m13.docType'), (row) => word(row.docType)),
    textColumn('guid', t('m13.guid'), (row) => row.tallyGuid),
    textColumn('at', t('m13.pushedAt'), (row) => shortInstant(row.exportedAt)),
  ]

  return (
    <Screen
      title={t('m13.title')}
      chips={<PageTabs group="/registers" active="/registers/tally" />}
      actions={
        <>
          <Segments
            testID="tally-view"
            value={view}
            onChange={(id) => {
              setView(id as View)
            }}
            items={[
              { id: 'exports', label: t('m13.exports') },
              { id: 'mappings', label: t('m13.mappings') },
              { id: 'sync', label: t('m13.syncLedger') },
            ]}
          />
          {view === 'exports' ? (
            <RangeSegments
              value={range}
              onChange={(id) => {
                setRange(id as RangeId)
              }}
            />
          ) : null}
          {mayQueue && view === 'exports' ? (
            <Button
              label={t('m13.queue')}
              variant="primary"
              onPress={() => {
                setQueueing(true)
              }}
              testID="queue-export"
            />
          ) : null}
        </>
      }
    >
      <Stack gap={4}>
        {view === 'exports' ? (
          <Async
            state={[jobs]}
            rows={10}
            empty={(jobs.data?.items.length ?? 0) === 0}
            emptyMessage={t('m13.empty')}
          >
            <Register
              testID="exports-register"
              columns={jobColumns}
              rows={jobs.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="kind"
              onSelect={(row) => {
                if (row.status === 'succeeded') openJob(row)
              }}
              state="ready"
              totals={{ kind: t('app.rows', { count: jobs.data?.items.length ?? 0 }) }}
            />
          </Async>
        ) : view === 'mappings' ? (
          <Async
            state={[mappings]}
            rows={10}
            empty={(mappings.data?.items.length ?? 0) === 0}
            emptyMessage={t('m13.noMappings')}
          >
            <Register
              testID="mappings-register"
              columns={mappingColumns}
              rows={mappings.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="entity"
              onSelect={
                mayMap
                  ? (row) => {
                      setEditing(row)
                      setTallyName(row.tallyName)
                      setTallyParent(row.tallyParent ?? '')
                    }
                  : undefined
              }
              state="ready"
            />
          </Async>
        ) : (
          <Async
            state={[sync]}
            rows={10}
            empty={(sync.data?.items.length ?? 0) === 0}
            emptyMessage={t('m13.empty')}
          >
            <Register
              testID="sync-register"
              columns={syncColumns}
              rows={sync.data?.items ?? []}
              rowKey={(row) => row.id}
              frozen="doc"
              state="ready"
            />
          </Async>
        )}
      </Stack>

      <Dialog
        open={queueing}
        onClose={() => {
          setQueueing(false)
        }}
        title={t('m13.queueTitle')}
        body={
          <Stack gap={3}>
            <Segments
              testID="export-kind"
              value={kind}
              onChange={(id) => {
                setKind(id as ExportKind)
              }}
              items={[
                { id: 'tally_xml', label: word('tally_xml') },
                { id: 'gstr1_json', label: word('gstr1_json') },
                { id: 'sales_register_xlsx', label: word('sales_register_xlsx') },
              ]}
            />
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('app.range', { from: span.from, to: span.to })}
            </Txt>
          </Stack>
        }
        confirmLabel={t('m13.queue')}
        busy={queue.status === 'pending'}
        onConfirm={() => {
          void queue.mutateAsync({ kind, from: span.from, to: span.to }).then(
            () => {
              setQueueing(false)
            },
            () => {
              setQueueing(false)
            },
          )
        }}
        testID="export-dialog"
      />

      <Dialog
        open={editing !== null}
        onClose={() => {
          setEditing(null)
        }}
        title={t('m13.setName')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {editing?.entityLabel ?? ''}
            </Txt>
            <TextInput
              label={t('m13.tallyName')}
              value={tallyName}
              onChange={setTallyName}
              capitalize="words"
              testID="tally-name"
            />
            <TextInput
              label={t('m13.tallyParent')}
              value={tallyParent}
              onChange={setTallyParent}
              capitalize="words"
              testID="tally-parent"
            />
          </Stack>
        }
        confirmLabel={t('app.save')}
        busy={setMapping.status === 'pending'}
        onConfirm={() => {
          if (editing === null) return
          void setMapping
            .mutateAsync({
              entityType: editing.entityType,
              entityId: editing.entityId,
              tallyName: tallyName.trim(),
              tallyParent: tallyParent.trim(),
            })
            .then(
              () => {
                setEditing(null)
              },
              () => {
                setEditing(null)
              },
            )
        }}
        testID="mapping-dialog"
      />
    </Screen>
  )
}
