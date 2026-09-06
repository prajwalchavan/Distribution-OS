/**
 * Drafts to confirm — the human end of the `ai` module (founder, 2026-09-05: "always human-confirmed").
 *
 * A shop sends "1 case cola bhej dena kal subah" on WhatsApp, or leaves a voice note; the parser
 * reads it against that shop's own SKU history and files a DRAFT. Nothing is an order until someone
 * here reads the sentence, checks the lines the parser matched and presses Confirm — which is the
 * only reason this screen exists. `ai.drafts.confirm` then creates and submits a normal sales order,
 * priced today, through the same path a rep's order takes.
 *
 * The id of that order and the id of every line are generated HERE (UUIDv7) and travel with the
 * idempotency key, so the same tap twice is one order.
 *
 * `ai.drafts.*` is owner + manager + salesperson + retailer: the accountant never reaches this route,
 * and the rail does not offer it.
 */
import type { OrderDraft } from '@dos/contracts'
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { uuidv7 } from '@dos/domain'
import {
  Button,
  Chips,
  Dialog,
  Register,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
  type RegisterColumn,
  type StatusFamily,
} from '@dos/ui'
import { useState } from 'react'

import { Async, Field, PageTabs, Panel, textColumn, useCan } from '../../src/lib/ui'
import { formatBps, useWord } from '../../src/lib/words'
import { shortInstant } from '../../src/lib/dates'
import { useRegisterKeys } from '../../src/lib/keys'

const STATUS_FAMILY: Readonly<Record<string, StatusFamily>> = {
  parsed: 'ochre',
  needs_review: 'clay',
  confirmed: 'moss',
  rejected: 'neutral',
  expired: 'neutral',
}

const STATUSES = ['parsed', 'needs_review', 'confirmed', 'rejected', 'expired'] as const
type DraftStatus = (typeof STATUSES)[number]

export default function Drafts(): React.JSX.Element {
  const t = useStrings()
  const word = useWord()
  const colors = useColors()
  const api = useApi()
  const can = useCan()

  const mayDecide = can('ai.drafts.confirm')
  const [statuses, setStatuses] = useState<readonly DraftStatus[]>(['parsed', 'needs_review'])
  const [selected, setSelected] = useState<string | null>(null)
  const [acting, setActing] = useState<'confirm' | 'reject' | null>(null)
  const [reason, setReason] = useState('')

  const list = useQuery(['ai', 'drafts', statuses.join(',')], () =>
    api.api.ai.drafts.list({
      limit: 200,
      ...(statuses.length === 1 ? { status: statuses[0] } : {}),
    }),
  )
  const detail = useQuery(
    ['ai', 'drafts', 'get', selected ?? 'none'],
    () => api.api.ai.drafts.get({ id: selected ?? '' }),
    { enabled: selected !== null },
  )
  const draft = detail.data?.item

  const confirm = useMutation(
    (
      input: {
        id: string
        /* `retailerId` is optional on the contract: a draft that already names its shop keeps it. */
        retailerId: string | null
        lines: readonly { variantId: string; qtyPcs: number; lineNo: number }[]
      },
      meta,
    ) =>
      api.api.ai.drafts.confirm({
        id: input.id,
        idempotencyKey: meta.idempotencyKey,
        orderId: meta.id,
        ...(input.retailerId === null ? {} : { retailerId: input.retailerId }),
        lines: input.lines.map((line) => ({
          id: uuidv7(),
          variantId: line.variantId,
          enteredQty: line.qtyPcs,
          enteredUnit: 'piece' as const,
          draftLineNo: line.lineNo,
        })),
      }),
    { invalidates: [['ai'], ['orders'], ['reporting']] },
  )
  const reject = useMutation(
    (input: { id: string; reason: string }, meta) =>
      api.api.ai.drafts.reject({
        id: input.id,
        reason: input.reason,
        idempotencyKey: meta.idempotencyKey,
      }),
    { invalidates: [['ai']] },
  )

  const rows = (list.data?.items ?? []).filter(
    (row) => statuses.length === 0 || statuses.includes(row.status),
  )

  const columns: readonly RegisterColumn<OrderDraft>[] = [
    textColumn('shop', t('ai.shop'), (row) => row.retailerName, { priority: 'identity' }),
    textColumn('preview', t('ai.preview'), (row) => row.preview),
    textColumn('source', t('ai.source'), (row) => word(row.source)),
    textColumn(
      'lines',
      t('ai.lines'),
      (row) => `${String(row.matchedLineCount)}/${String(row.lineCount)}`,
      {
        align: 'right',
      },
    ),
    textColumn('confidence', t('ai.confidence'), (row) => formatBps(row.confidenceBps), {
      align: 'right',
      priority: 'value',
    }),
    {
      key: 'status',
      head: t('ai.status'),
      priority: 'chip',
      cell: (row) => (
        <StatusChip label={word(row.status)} family={STATUS_FAMILY[row.status] ?? 'neutral'} />
      ),
    },
    textColumn('when', t('ai.when'), (row) => shortInstant(row.createdAt)),
  ]

  useRegisterKeys({
    rows,
    rowKey: (row) => row.id,
    selected,
    onSelect: (row) => {
      setSelected(row.id)
    },
    enabled: acting === null,
  })

  const matched = (draft?.lines ?? []).filter(
    (line): line is typeof line & { variantId: string } =>
      line.status === 'matched' && line.variantId !== null,
  )

  const commit = (): void => {
    if (draft === undefined || acting === null) return
    const done = (): void => {
      setActing(null)
      setReason('')
      setSelected(null)
    }
    if (acting === 'confirm')
      void confirm
        .mutateAsync({
          id: draft.id,
          retailerId: draft.retailerId,
          lines: matched.map((line) => ({
            variantId: line.variantId,
            qtyPcs: line.qtyPcs ?? 0,
            lineNo: line.lineNo,
          })),
        })
        .then(done, done)
    if (acting === 'reject')
      void reject.mutateAsync({ id: draft.id, reason: reason.trim() }).then(done, done)
  }

  return (
    <Screen title={t('ai.title')} chips={<PageTabs group="/orders" active="/orders/drafts" />}>
      <Stack gap={4}>
        <Chips
          testID="drafts-status"
          items={STATUSES.map((status) => ({
            id: status,
            label: word(status),
            selected: statuses.includes(status),
          }))}
          onToggle={(id) => {
            setStatuses((current) =>
              current.includes(id as DraftStatus)
                ? current.filter((s) => s !== id)
                : [...current, id as DraftStatus],
            )
          }}
        />

        <Async state={[list]} rows={8} empty={rows.length === 0} emptyMessage={t('ai.empty')}>
          <Register
            testID="drafts-register"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            frozen="shop"
            selectedKey={selected}
            onSelect={(row) => {
              setSelected(row.id)
            }}
            state="ready"
            filters={statuses.map((status) => ({ id: status, label: word(status) }))}
            onClearFilters={() => {
              setStatuses([])
            }}
            totals={{ shop: t('app.rows', { count: rows.length }) }}
          />
        </Async>
      </Stack>

      <Sheet
        open={selected !== null}
        onClose={() => {
          setSelected(null)
        }}
        title={
          draft === undefined
            ? undefined
            : t('ai.detail', { shop: draft.retailerName ?? t('app.none') })
        }
        testID="draft-panel"
      >
        <Async state={[detail]} rows={6}>
          {draft === undefined ? null : (
            <Stack gap={4}>
              <Field label={t('ai.source')}>{word(draft.source)}</Field>
              <Field label={t('ai.preview')}>
                {draft.rawText ?? draft.preview ?? t('app.none')}
              </Field>
              {draft.transcript === null ? null : (
                <Field label={t('ai.transcript')}>{draft.transcript}</Field>
              )}
              <Field label={t('ai.confidence')}>{formatBps(draft.confidenceBps)}</Field>
              {draft.needsHumanConfirmation ? (
                <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
                  {t('ai.needsHuman')}
                </Txt>
              ) : null}

              <Panel title={t('ai.lines')}>
                <Stack gap={2}>
                  {draft.lines.map((line) => (
                    <Stack key={line.lineNo} gap={1} border="bottom" borderTone="faint" padY={2}>
                      <Txt field="body" desk="cell" numberOfLines={1}>
                        {line.variantName ?? line.rawText}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {`${line.rawText} · ${String(line.qtyPcs ?? 0)} ${word('pcs')} · ${word(line.status)}`}
                      </Txt>
                    </Stack>
                  ))}
                </Stack>
              </Panel>

              {draft.unmatchedLineCount > 0 ? (
                <Txt field="label" desk="meta" color={colors.status.clay.fg}>
                  {t('ai.unmatched', { count: draft.unmatchedLineCount })}
                </Txt>
              ) : null}

              {mayDecide && (draft.status === 'parsed' || draft.status === 'needs_review') ? (
                <Stack gap={3}>
                  <Button
                    label={t('ai.confirm')}
                    variant="primary"
                    disabled={matched.length === 0}
                    disabledReason={t('ai.unmatched', { count: draft.lineCount })}
                    onPress={() => {
                      setActing('confirm')
                    }}
                    testID="draft-confirm"
                  />
                  <Button
                    label={t('ai.reject')}
                    variant="destructive"
                    onPress={() => {
                      setActing('reject')
                    }}
                    testID="draft-reject"
                  />
                </Stack>
              ) : null}
            </Stack>
          )}
        </Async>
      </Sheet>

      <Dialog
        open={acting !== null}
        onClose={() => {
          setActing(null)
        }}
        title={acting === 'confirm' ? t('ai.confirm') : t('ai.reject')}
        body={
          <Stack gap={3}>
            <Txt field="body" desk="body">
              {draft?.retailerName ?? ''}
            </Txt>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {acting === 'confirm' ? t('ai.confirmBody') : ''}
            </Txt>
            {acting === 'reject' ? (
              <TextInput
                label={t('ai.rejectReason')}
                value={reason}
                onChange={setReason}
                capitalize="sentences"
                testID="draft-reason"
              />
            ) : null}
          </Stack>
        }
        confirmLabel={acting === 'confirm' ? t('ai.confirm') : t('ai.reject')}
        destructive={acting === 'reject'}
        busy={confirm.status === 'pending' || reject.status === 'pending'}
        onConfirm={commit}
        testID="draft-dialog"
      />
    </Screen>
  )
}
