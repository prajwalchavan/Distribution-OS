/**
 * M11 — brand-DMS bills (docs/23 §2.1; docs/22 never-list 5: "a brand-DMS sale is NEVER re-invoiced").
 *
 * Tarsun's Too Yumm business is billed on FieldAssist, the brand's own DMS. Those bills are legal
 * documents already, so this product stores them VERBATIM (`source = brand_dms_import`) and links
 * them to the brand's own number — it never allots a number of its own for that sale. That is the
 * whole point of this screen, and it is why there is no "make a bill" button on it.
 *
 * Two ways a brand bill gets in, and both are somewhere else because that is where they belong:
 *
 *  - photograph it → `docint.documents.create { kind: 'brand_dms_invoice' }` starts the capture and
 *    the reading, and the reviewed result is committed from the Documents tab;
 *  - a FieldAssist export file → `integrations.imports` (the generic importer, docs/17 §D7). The job
 *    list is shown here so the desk can see what came in; the wizard itself is the owner's screen.
 *
 * `billing.invoices.importBrandDms` also exists for a machine-to-machine import and is deliberately
 * NOT offered as a form: hand-typing a legal document's twenty fields is exactly what this product
 * exists to abolish.
 */
import type { InvoiceListItem } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import {
  Button,
  Dialog,
  ListRow,
  Money,
  Register,
  Screen,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useState } from 'react'

import {
  Async,
  PageTabs,
  Panel,
  RangeSegments,
  Refusal,
  countText,
  moneyColumn,
  pageTotal,
  pagedCount,
  stayOpen,
  textColumn,
  useCan,
  useNames,
} from '../../src/lib/ui'
import { longDate, rangeOf, shortInstant, type RangeId } from '../../src/lib/dates'
import { useWord } from '../../src/lib/words'

export default function BrandDms(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const names = useNames()
  const can = useCan()
  const router = useRouter()

  const mayCapture = can('docint.documents.create')
  const [range, setRange] = useState<RangeId>('d90')
  const [capturing, setCapturing] = useState(false)

  const span = rangeOf(range)
  const list = useQuery(['invoices', 'brandDms', span.from, span.to], () =>
    api.api.billing.invoices.list({
      source: 'brand_dms_import',
      from: span.from,
      to: span.to,
      limit: 200,
    }),
  )
  const imports = useQuery(
    ['integrations', 'imports', 'fieldassist'],
    () => api.api.integrations.imports.list({ source: 'fieldassist', limit: 20 }),
    { enabled: can('integrations.imports.list') },
  )

  const startCapture = useMutation(
    (_input: null, meta) =>
      api.api.docint.documents.create({
        id: meta.id,
        idempotencyKey: meta.idempotencyKey,
        kind: 'brand_dms_invoice',
        expectedPages: 1,
      }),
    { invalidates: [['docint']] },
  )

  const rows = list.data?.items ?? []
  const page = pagedCount(list)

  const columns: readonly RegisterColumn<InvoiceListItem>[] = [
    textColumn('externalNo', t('m11.invoiceNo'), (row) => row.externalInvoiceNo ?? row.invoiceNo, {
      priority: 'identity',
    }),
    textColumn('date', t('m11.date'), (row) => longDate(row.invoiceDate)),
    textColumn('shop', t('m11.shop'), (row) => row.buyerName || names.retailer(row.retailerId)),
    moneyColumn('total', t('m11.value'), (row) => row.totalPaise),
    {
      key: 'source',
      head: t('m11.source'),
      priority: 'chip',
      cell: (row) => <StatusChip label={word(row.source)} family="neutral" />,
    },
  ]

  return (
    <Screen
      title={t('m11.title')}
      chips={<PageTabs group="/billing" active="/billing/brand-dms" />}
      actions={
        <>
          <RangeSegments
            value={range}
            onChange={(id) => {
              setRange(id as RangeId)
            }}
          />
          {mayCapture ? (
            <Button
              label={t('m11.capture')}
              variant="primary"
              onPress={() => {
                setCapturing(true)
              }}
              testID="brand-capture"
            />
          ) : null}
        </>
      }
    >
      <Stack gap={6}>
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('m11.hint')}
        </Txt>

        <Async state={[list]} rows={8} empty={rows.length === 0} emptyMessage={t('m11.empty')}>
          <Register
            testID="brand-dms-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="externalNo"
            state="ready"
            totals={{
              externalNo: countText(page, t('app.none')),
              total: pageTotal(
                page,
                <Money
                  value={rows.reduce((sum, row) => sum + row.totalPaise, 0)}
                  size="cell"
                  symbol={false}
                />,
              ),
            }}
          />
        </Async>

        {can('integrations.imports.list') ? (
          <Panel title={t('m11.import')} testID="brand-imports">
            <Async
              state={[imports]}
              rows={3}
              empty={(imports.data?.items.length ?? 0) === 0}
              emptyMessage={t('m11.empty')}
            >
              <Stack gap={2}>
                {(imports.data?.items ?? []).map((row) => (
                  <ListRow
                    key={row.id}
                    primary={`${word(row.source)} · ${word(row.target)}`}
                    secondary={shortInstant(row.createdAt)}
                    trailing={<StatusChip label={word(row.status)} family="neutral" />}
                  />
                ))}
              </Stack>
            </Async>
          </Panel>
        ) : null}
      </Stack>

      <Dialog
        open={capturing}
        onClose={() => {
          setCapturing(false)
        }}
        title={t('m11.capture')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {t('m3.captureHint')}
            </Txt>
            <Refusal of={[startCapture]} testID="brand-capture-refusal" />
          </Stack>
        }
        confirmLabel={t('m11.capture')}
        busy={startCapture.status === 'pending'}
        onConfirm={() => {
          void startCapture.mutateAsync(null).then(() => {
            setCapturing(false)
            router.push('/inbound/documents')
          }, stayOpen)
        }}
        testID="brand-capture-dialog"
      />
    </Screen>
  )
}
