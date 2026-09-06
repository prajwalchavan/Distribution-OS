/**
 * WhatsApp and voice drafts, waiting for a human — docs/22 §4 and docs/23 §3 "AI drafts to confirm".
 *
 * A shop sends "bhai 2 case campa 1L kal bhej dena" and the parser reads it into LINES. It never
 * creates an order, whatever its confidence: `ai.drafts.confirm` is the only way one becomes a sales
 * order, and it runs `orders.create` → `setLines` → `submit` in one transaction, so the price engine,
 * the credit verdict and the approval queue behave exactly as they do for a typed order. There is no
 * softer path into `sales_orders`, and this screen does not invent one.
 *
 * What a rep does here is agree, correct the quantity, or throw it away with a reason — and a
 * rejected draft is kept, because it is the training signal that matters most.
 *
 * Online only: the queue and the parse both live on the service.
 */
import { useApi, useMutation, useQuery } from '@dos/api-client/react'
import { uuidv7 } from '@dos/domain'
import {
  Button,
  Group,
  ListRow,
  QtyStepper,
  Row,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  TextInput,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'

import { deviceId } from '../../src/api'
import { instantWithClock } from '../../src/lib/dates'
import { useLocalState } from '../../src/lib/local'
import { Async, PageTabs, Panel } from '../../src/lib/ui'
import { formatBps, useWord } from '../../src/lib/words'

type View = 'pending' | 'confirmed' | 'rejected'

export default function Drafts(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const word = useWord()
  const local = useLocalState()
  const [view, setView] = useState<View>('pending')
  const [openId, setOpenId] = useState<string | null>(null)

  /*
   * "Pending" is TWO statuses, not one. The parser leaves a draft `parsed` when it is confident and
   * `needs_review` when it is not, and both are waiting for the same human — so asking the service
   * for one of them (or filtering a single unfiltered page in the app, which silently loses whatever
   * sits past the page) would hide half the queue.
   */
  const parsed = useQuery(
    ['ai', 'drafts', 'parsed'],
    () => api.api.ai.drafts.list({ limit: 30, status: 'parsed' }),
    { staleTime: 60_000, enabled: view === 'pending' },
  )
  const needsReview = useQuery(
    ['ai', 'drafts', 'needs_review'],
    () => api.api.ai.drafts.list({ limit: 30, status: 'needs_review' }),
    { staleTime: 60_000, enabled: view === 'pending' },
  )
  const decided = useQuery(
    ['ai', 'drafts', view],
    () => api.api.ai.drafts.list({ limit: 30, status: view as 'confirmed' | 'rejected' }),
    { staleTime: 60_000, enabled: view !== 'pending' },
  )

  const rows =
    view === 'pending'
      ? [...(needsReview.data?.items ?? []), ...(parsed.data?.items ?? [])].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        )
      : (decided.data?.items ?? [])

  return (
    <Screen
      title={t('ai.title')}
      chips={local.online ? undefined : <StatusChip label={t('s0.offlineChip')} family="ochre" />}
    >
      <Stack gap={4}>
        <PageTabs group="/me" active="/me/drafts" />

        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {t('ai.explain')}
        </Txt>

        <Segments
          testID="draft-view"
          value={view}
          onChange={(id) => {
            setView(id as View)
          }}
          items={[
            { id: 'pending', label: t('ai.viewPending') },
            { id: 'confirmed', label: t('ai.viewConfirmed') },
            { id: 'rejected', label: t('ai.viewRejected') },
          ]}
        />

        <Async
          state={view === 'pending' ? [needsReview, parsed] : [decided]}
          rows={4}
          empty={rows.length === 0}
          emptyMessage={t('ai.empty')}
        >
          <Group>
            {rows.map((draft) => (
              <ListRow
                key={draft.id}
                primary={draft.preview}
                secondary={[
                  draft.retailerName ?? t('ai.unknownShop'),
                  word(draft.source),
                  instantWithClock(draft.createdAt),
                ].join(' · ')}
                trailing={
                  <Stack gap={1} align="end">
                    <StatusChip
                      label={word(draft.status)}
                      family={
                        draft.status === 'confirmed'
                          ? 'moss'
                          : draft.status === 'rejected' || draft.status === 'expired'
                            ? 'brick'
                            : 'ochre'
                      }
                    />
                    <StatusChip
                      label={t('ai.confidence', { pct: formatBps(draft.confidenceBps) })}
                      family={draft.confidenceBps >= 8000 ? 'moss' : 'ochre'}
                      figure
                    />
                  </Stack>
                }
                onPress={() => {
                  setOpenId(draft.id)
                }}
              />
            ))}
          </Group>
        </Async>
      </Stack>

      <DraftSheet
        draftId={openId}
        onClose={() => {
          setOpenId(null)
        }}
        online={local.online}
      />
    </Screen>
  )
}

/**
 * One draft, line by line, with the quantity under a thumb.
 *
 * A line the parser could not match to a variant cannot be ordered — `ai.drafts.confirm` needs a
 * `variantId` per line — so it is shown with its raw words and left out of the confirm, and the sheet
 * says how many were dropped rather than silently sending fewer lines than the shop asked for.
 */
function DraftSheet({
  draftId,
  onClose,
  online,
}: {
  draftId: string | null
  onClose: () => void
  online: boolean
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const api = useApi()
  const router = useRouter()
  const [qty, setQty] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('')

  const draft = useQuery(
    ['ai', 'draft', draftId ?? 'none'],
    () => api.api.ai.drafts.get({ id: draftId ?? '' }),
    { enabled: draftId !== null, staleTime: 30_000 },
  )

  /* The parser's own quantities are the starting point; a correction is the rep's, per line. */
  useEffect(() => {
    const lines = draft.data?.item.lines
    if (lines === undefined) return
    setQty(Object.fromEntries(lines.map((line) => [line.lineNo, line.qtyPcs])))
  }, [draft.data])

  const item = draft.data?.item
  const usable = (item?.lines ?? []).filter(
    (line) => line.variantId !== null && (qty[line.lineNo] ?? 0) > 0,
  )
  const dropped = (item?.lines ?? []).length - usable.length

  const confirm = useMutation(
    (_input: null, meta) =>
      api.api.ai.drafts.confirm({
        id: item?.id ?? '',
        idempotencyKey: meta.idempotencyKey,
        // `meta.id` is this intent's own UUIDv7 and survives a retry, so a lost reply cannot make two orders.
        orderId: meta.id,
        lines: usable.map((line) => ({
          id: uuidv7(),
          variantId: line.variantId ?? '',
          /*
           * The shopkeeper's own unit, kept as they said it (docs/17 A3): "2 case" stays two cases on
           * the bill. A line spoken in pieces is sent in pieces, and a quantity the rep corrected is
           * sent in pieces too, because that is what the stepper moved.
           */
          enteredQty:
            line.unit === 'case' && (qty[line.lineNo] ?? 0) === line.qtyPcs && line.cases !== null
              ? line.cases
              : (qty[line.lineNo] ?? 0),
          enteredUnit:
            line.unit === 'case' && (qty[line.lineNo] ?? 0) === line.qtyPcs && line.cases !== null
              ? ('case' as const)
              : ('piece' as const),
          draftLineNo: line.lineNo,
        })),
        deviceId: deviceId(),
      }),
    {
      invalidates: [['ai'], ['orders']],
      onSuccess: (result) => {
        onClose()
        router.push(`/orders/${result.order.id}`)
      },
    },
  )

  const reject = useMutation(
    (input: { reason: string }, meta) =>
      api.api.ai.drafts.reject({
        id: item?.id ?? '',
        idempotencyKey: meta.idempotencyKey,
        reason: input.reason,
      }),
    {
      invalidates: [['ai']],
      onSuccess: () => {
        onClose()
      },
    },
  )

  return (
    <Sheet
      open={draftId !== null}
      onClose={onClose}
      title={t('ai.draftTitle')}
      testID="draft-sheet"
    >
      <Async state={[draft]} rows={3}>
        <Stack gap={4}>
          <Panel
            title={item?.retailerName ?? t('ai.unknownShop')}
            meta={item?.rawText ?? item?.transcript ?? item?.preview}
          >
            <Group>
              {(item?.lines ?? []).map((line) => (
                <Stack
                  key={line.lineNo}
                  gap={2}
                  padY={3}
                  padX={3}
                  border="bottom"
                  borderTone="faint"
                >
                  <Row justify="between" gap={3} align="start">
                    <Stack gap={1} grow>
                      <Txt field="bodyStrong" desk="cell">
                        {line.variantName ?? t('ai.noMatch')}
                      </Txt>
                      <Txt field="label" desk="meta" color={colors.text.secondary}>
                        {line.rawText}
                      </Txt>
                    </Stack>
                    <StatusChip
                      label={formatBps(line.confidenceBps)}
                      family={line.variantId === null ? 'brick' : 'moss'}
                      figure
                    />
                  </Row>
                  {line.variantId === null ? (
                    <Txt field="label" desk="meta" color={colors.status.brick.fg}>
                      {t('ai.lineDropped')}
                    </Txt>
                  ) : (
                    <QtyStepper
                      testID={`draft-qty-${String(line.lineNo)}`}
                      pieces={qty[line.lineNo] ?? 0}
                      caseSize={line.packSize ?? 1}
                      onChange={(pieces) => {
                        setQty((held) => ({ ...held, [line.lineNo]: pieces }))
                      }}
                    />
                  )}
                </Stack>
              ))}
            </Group>
          </Panel>

          {dropped === 0 ? null : (
            <Txt field="label" desk="meta" color={colors.status.ochre.fg}>
              {t('ai.droppedCount', { count: dropped })}
            </Txt>
          )}
          {confirm.error === undefined ? null : (
            <Txt field="label" desk="meta" color={colors.status.brick.fg}>
              {confirm.error.message}
            </Txt>
          )}

          <Button
            testID="confirm-draft"
            variant="primary"
            label={t('ai.confirm', { count: usable.length })}
            fullWidth
            disabled={!online || usable.length === 0 || item?.status === 'confirmed'}
            disabledReason={online ? undefined : t('s0.needsSignal')}
            loading={confirm.status === 'pending'}
            onPress={() => {
              confirm.mutate(null)
            }}
          />

          <TextInput
            label={t('ai.rejectReason')}
            value={reason}
            onChange={setReason}
            capitalize="sentences"
          />
          <Button
            label={t('ai.reject')}
            variant="destructive"
            fullWidth
            disabled={!online || reason.trim() === ''}
            disabledReason={reason.trim() === '' ? t('ai.rejectNeedsReason') : undefined}
            loading={reject.status === 'pending'}
            onPress={() => {
              reject.mutate({ reason: reason.trim() })
            }}
          />
        </Stack>
      </Async>
    </Sheet>
  )
}
