/**
 * W8 — walking one cycle count, lot by lot, blind (docs/23 §4.1).
 *
 * `CycleCountLineSchema` carries `expectedPcs`, and this screen deliberately does not draw it while
 * counting: a count against a number on the same screen is a transcription. The expected figure is
 * the SERVER's business — it froze it when the count was opened, and it works out the variance when
 * the desk posts it.
 *
 * One `<NumberPad>` per lot, saved in one `cycleCounts.count` call. Posting the differences into the
 * ledger is BACK_OFFICE (`permissions.ts`), and the screen says so rather than drawing a 403.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Button,
  Group,
  ListRow,
  NumberPad,
  Row,
  Screen,
  Sheet,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import type { CycleCountLine } from '@dos/contracts'
import { haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'

import { longDate } from '../../../src/lib/dates'
import { useVariantNames } from '../../../src/lib/local'
import { Async, DeskOnly, Panel, workFamily } from '../../../src/lib/ui'

export default function CycleCount(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const countId = typeof params.id === 'string' ? params.id : ''
  const signedIn = session !== null

  const count = useQuery(
    ['cycleCount', countId],
    () => api.api.inventory.cycleCounts.get({ id: countId }),
    { enabled: signedIn && countId !== '' },
  )
  /* The device's whole `product_variants`, not a page of a paging procedure — see `useVariantNames`. */
  const { names, loading: namesLoading } = useVariantNames()

  const [counting, setCounting] = useState<CycleCountLine | null>(null)
  const [pieces, setPieces] = useState<number | null>(null)
  const [entered, setEntered] = useState<Record<string, number>>({})
  const [toast, setToast] = useState<string | null>(null)

  const item = count.data?.item ?? null
  const lines = item?.lines ?? []
  const open = item?.status === 'open'

  const save = useMutation(
    (input: { lines: { lotId: string; countedPcs: number }[] }, meta) =>
      api.api.inventory.cycleCounts.count({
        id: countId,
        idempotencyKey: meta.idempotencyKey,
        lines: input.lines,
      }),
    {
      invalidates: [['cycleCount'], ['cycleCounts']],
      onSuccess: () => {
        haptics.success()
        setToast(t('w8c.saved'))
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  const done = Object.keys(entered).length

  return (
    <Screen
      title={t('w8c.title')}
      context={item === null ? undefined : t('w8c.status', { status: item.status })}
      chips={
        item === null ? undefined : (
          <StatusChip label={item.status} family={workFamily(item.status)} />
        )
      }
      testID="w8c-count-screen"
      bottomBar={
        open ? (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {`${String(done)} / ${String(lines.length)}`}
            </Txt>
            <Button
              label={t('w8c.save')}
              variant="primary"
              loading={save.status === 'pending'}
              disabled={done === 0}
              {...(done === 0 ? { disabledReason: t('w8c.notCounted') } : {})}
              onPress={() => {
                save.mutate({
                  lines: Object.entries(entered).map(([lotId, countedPcs]) => ({
                    lotId,
                    countedPcs,
                  })),
                })
              }}
              testID="w8c-save"
            />
          </Row>
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Async
          state={[count, { isLoading: namesLoading && names.size === 0 }]}
          empty={lines.length === 0}
          emptyMessage={t('w.nothingHere')}
        >
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('w8c.blind')}
          </Txt>
          <Panel title={t('w8c.counts')} testID="w8c-lines">
            <Group>
              {lines.map((line) => (
                <ListRow
                  key={line.id}
                  testID={`w8c-line-${line.lotId}`}
                  primary={names.get(line.variantId)?.name ?? t('w.unknownItem')}
                  secondary={
                    line.batchNo === '' ? t('w.noBatch') : t('w.batch', { batch: line.batchNo })
                  }
                  trailing={
                    entered[line.lotId] === undefined ? (
                      <StatusChip label={t('w8c.notCounted')} family="neutral" />
                    ) : (
                      <StatusChip
                        label={t('w.pieces', { pieces: entered[line.lotId] ?? 0 })}
                        family="moss"
                        figure
                      />
                    )
                  }
                  {...(line.expiryDate === null
                    ? {}
                    : { reason: t('w.expiry', { date: longDate(line.expiryDate) }) })}
                  {...(open
                    ? {
                        onPress: () => {
                          setCounting(line)
                          setPieces(entered[line.lotId] ?? null)
                        },
                      }
                    : {})}
                />
              ))}
            </Group>
          </Panel>

          {save.error === undefined ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg}>
              {save.error.message}
            </Txt>
          )}

          <DeskOnly>{t('w8c.postIsDesk')}</DeskOnly>

          <Button
            label={t('w.close')}
            variant="ghost"
            onPress={() => {
              router.push('/stock/counts')
            }}
            testID="w8c-close"
          />
        </Async>
      </Stack>

      <Sheet
        open={counting !== null}
        onClose={() => {
          setCounting(null)
        }}
        title={counting === null ? '' : (names.get(counting.variantId)?.name ?? t('w.unknownItem'))}
        testID="w8c-sheet"
      >
        <NumberPad
          testID="w8c-pad"
          mode="count"
          label={t('w8c.counted')}
          value={pieces}
          onChange={setPieces}
          doneLabel={t('action.done')}
          onDone={() => {
            if (counting === null) return
            haptics.tap()
            setEntered((held) => ({ ...held, [counting.lotId]: pieces ?? 0 }))
            setCounting(null)
            setPieces(null)
          }}
        />
      </Sheet>
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w8c-toast"
      />
    </Screen>
  )
}
