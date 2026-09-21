/**
 * O22 — exports and Tally (docs/23 §1.1).
 *
 * An export is a JOB, not a download: the worker renders it and answers a short-lived signed URL, so
 * this screen is a queue with a download beside every finished row. The Tally half is the ledger-name
 * map and the sync log — what this product calls an account against what Tally calls it.
 */
import { parseReportExportKind, REGISTER_WINDOW_DAYS, ReportRegisterSchema } from '@dos/contracts'
import type { ExportJob, ReportRegister, TallyMapping } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Chips,
  Dialog,
  Register,
  Screen,
  Segments,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useGo,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { documents } from '@dos/ui/platform'
import { useEffect, useState } from 'react'

import {
  Async,
  PageTabs,
  RangeSegments,
  textColumn,
  useNames,
} from '../../../src/groups/owner/lib/ui'
import { absoluteUrl } from '../../../src/config'
import {
  clampWindow,
  instantWithClock,
  longDate,
  rangeOf,
  type RangeId,
} from '../../../src/groups/owner/lib/dates'
import { useWord } from '../../../src/groups/owner/lib/words'

const JOB_FAMILY: Readonly<Record<string, StatusFamily>> = {
  queued: 'neutral',
  running: 'ochre',
  succeeded: 'moss',
  failed: 'brick',
  cancelled: 'neutral',
}

export default function Exports(): React.JSX.Element {
  const go = useGo()
  const t = useStrings()
  const word = useWord()

  /*
   * `export_jobs.kind` is one string with two shapes. Reporting queues `report_<register>_<format>`
   * (`report_gstSalesRegister_csv`), which humanises into the nonsense "Report gst sales register
   * csv"; the other modules queue a flat kind (`tally_xml`, `claim_sheet`). The contract owns the
   * split, so the screen asks it rather than parsing the underscores itself.
   */
  const exportKind = (kind: string): string => {
    const report = parseReportExportKind(kind)
    return report === null
      ? word(kind)
      : `${word(report.register)} · ${report.format.toUpperCase()}`
  }
  const api = useApi()
  const names = useNames()
  const [view, setView] = useState<'exports' | 'tally'>('exports')

  /*
   * DOS-014: "Request export" fired a fixed GST-sales export for a fixed 90 days, with no dialog and
   * no message — two identical jobs appeared and the owner learnt nothing. It now asks which register
   * and which period, clamps the window to that register's own cap so no ask can come back 400
   * `window_too_wide`, and says what it queued.
   */
  const [asking, setAsking] = useState(false)
  const [register, setRegister] = useState<ReportRegister>('collections')
  const [range, setRange] = useState<RangeId>('d30')
  const [toast, setToast] = useState<string | null>(null)

  const cap = REGISTER_WINDOW_DAYS[register as keyof typeof REGISTER_WINDOW_DAYS] as
    number | undefined
  const span = clampWindow(rangeOf(range), cap ?? 3_650)

  const jobs = useQuery(['integrations', 'exports'], () =>
    api.api.integrations.exports.list({ limit: 100 }),
  )
  /*
   * A queued job is rendered by the worker off-process, so the list must be re-read until nothing is
   * moving; `useQuery` has no refetch interval, so the screen owns the timer and clears it.
   */
  const working = (jobs.data?.items ?? []).some(
    (row) => row.status === 'queued' || row.status === 'running',
  )
  const refetchJobs = jobs.refetch
  useEffect(() => {
    if (!working) return
    const timer = setInterval(() => {
      void refetchJobs()
    }, 3_000)
    return () => {
      clearInterval(timer)
    }
  }, [working, refetchJobs])
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
        register,
        format: 'csv',
        /*
         * `stockValue` and `outstanding` are point-in-time reads: their inputs carry no `from` / `to`
         * (`StockValueInput`, `OutstandingListInput`), so a window sent here is silently stripped and
         * the whole register is rendered. Send `{}` for them and say so in the dialog, rather than
         * printing a period the file does not honour.
         */
        filters: cap === undefined ? {} : { from: span.from, to: span.to },
      }),
    {
      invalidates: [['integrations', 'exports']],
      onSuccess: () => {
        setAsking(false)
        setToast(t('o22.queuedToast'))
      },
    },
  )

  const open = (id: string): void => {
    void api.api.integrations.exports.downloadUrl({ id }).then((result) => {
      const url = absoluteUrl('owner', result.url)
      if (url !== null) void documents.open(url)
    })
  }

  const jobColumns: readonly RegisterColumn<ExportJob>[] = [
    textColumn('kind', t('o22.kind'), (row) => exportKind(row.kind), { priority: 'identity' }),
    textColumn('file', t('o21.file'), (row) => row.fileName),
    textColumn('rows', t('o22.rowCount'), (row) => row.rowCount),
    textColumn('by', t('o7.person'), (row) => names.staff(row.requestedBy)),
    textColumn('when', t('o22.requested'), (row) => instantWithClock(row.createdAt)),
    {
      key: 'status',
      head: t('o22.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={JOB_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    {
      key: 'download',
      head: t('o22.download'),
      cell: (row) =>
        row.status === 'succeeded' ? (
          <Button
            label={t('o22.download')}
            variant="ghost"
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
    textColumn('entity', t('o22.register'), (row) => word(row.entityType), {
      priority: 'identity',
    }),
    textColumn('local', t('o12.account'), (row) => row.entityLabel),
    textColumn('tally', t('o22.tallyLedger'), (row) => row.tallyName),
  ]

  return (
    <Screen
      title={t('o22.title')}
      chips={<PageTabs group={go.href('/reports')} active={go.href('/reports/exports')} />}
      actions={
        <>
          <Segments
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
            loading={request.status === 'pending'}
            onPress={() => {
              request.reset()
              setAsking(true)
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

      <Dialog
        open={asking}
        onClose={() => {
          setAsking(false)
        }}
        title={t('o22.request')}
        body={
          <Stack gap={3}>
            <Txt field="label" desk="meta">
              {t('o22.register')}
            </Txt>
            <Chips
              testID="exports-register-chips"
              items={ReportRegisterSchema.options.map((id) => ({
                id,
                label: word(id),
                selected: id === register,
              }))}
              onToggle={(id) => {
                setRegister(id as ReportRegister)
              }}
            />
            {cap === undefined ? null : (
              <>
                <Txt field="label" desk="meta">
                  {t('o22.period')}
                </Txt>
                <RangeSegments
                  value={range}
                  onChange={(id) => {
                    setRange(id as RangeId)
                  }}
                  testID="exports-period"
                />
              </>
            )}
            <Txt field="bodyStrong" desk="body" testID="exports-request-summary">
              {cap === undefined
                ? t('o22.requestBodyWhole', { register: word(register), format: 'CSV' })
                : t('o22.requestBody', {
                    register: word(register),
                    format: 'CSV',
                    from: longDate(span.from),
                    to: longDate(span.to),
                  })}
            </Txt>
          </Stack>
        }
        confirmLabel={t('o22.queue')}
        busy={request.status === 'pending'}
        onConfirm={() => {
          request.mutate(null)
        }}
        testID="exports-request-dialog"
      />

      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="exports-toast"
      />
    </Screen>
  )
}
