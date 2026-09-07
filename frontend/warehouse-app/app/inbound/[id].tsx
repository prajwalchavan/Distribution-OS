/**
 * W3 — the blind gate count (docs/23 §4.1, UX-00 §9.4 last line).
 *
 * THE ONE PLACE IN THIS PRODUCT WHERE TYPING IS ALLOWED. Everything else on the inbound path is read
 * off the bill by the docint pipeline; what came off the lorry is counted by a person, and the count
 * is BLIND — the expected figure never appears on this screen, before or during. A count that can see
 * the bill is not a count, it is a transcription, and the whole point of §4.1 W3 is to catch the
 * short case the supplier's own paper does not admit to.
 *
 * So: a full-screen `<NumberPad>` per line with nothing else on it, one line at a time, and only at
 * the end a review of what this hand wrote — still with no expected column. `procurement.grns.count`
 * takes it; `grns.open` and `grns.post` are BACK_OFFICE by design (`permissions.ts`) and this screen
 * says so rather than drawing a button that would 403.
 */
import { useApi, useMutation, useQuery, useSession } from '@dos/api-client/react'
import {
  Box,
  Button,
  Group,
  ListRow,
  NumberPad,
  Row,
  Screen,
  Stack,
  StatusChip,
  Toast,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { camera, haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import { useVariantNames } from '../../src/lib/local'
import { Async, DeskOnly, Panel, pl, workFamily } from '../../src/lib/ui'

type Stage = 'count' | 'damaged' | 'review'

const KIND_KEY: Readonly<Record<string, string>> = {
  short: 'w3.kindShort',
  excess: 'w3.kindExcess',
  damaged: 'w3.kindDamaged',
  wrong_item: 'w3.kindWrong',
  price_mismatch: 'w3.kindPrice',
  expiry_near: 'w3.kindExpiry',
}

export default function GateCount(): React.JSX.Element {
  const t = useStrings()
  const api = useApi()
  const colors = useColors()
  const router = useRouter()
  const { session } = useSession()
  const params = useLocalSearchParams<{ id: string }>()
  const grnId = typeof params.id === 'string' ? params.id : ''

  const grn = useQuery(['grn', grnId], () => api.api.procurement.grns.get({ id: grnId }), {
    enabled: session !== null && grnId !== '',
  })
  const lines = grn.data?.item.lines ?? []
  /*
   * `GrnLineSchema` carries `variantId` and no name — the shape is deliberately rate-free, so it
   * carries nothing a salesperson could not see either. The names (and the EANs the scanner needs)
   * come from the DEVICE's own `product_variants`, asked for BY THE IDS ON THIS RECEIPT; see
   * `useVariantNames` for the page-one bug that made this a rule rather than a preference.
   */
  const { names, loading: namesLoading } = useVariantNames(
    useMemo(() => lines.map((row) => row.variantId), [lines]),
  )
  const status = grn.data?.item.status ?? 'counting'
  const countable = status === 'counting'

  const [index, setIndex] = useState(0)
  const [stage, setStage] = useState<Stage>('count')
  const [counted, setCounted] = useState<Record<string, number>>({})
  const [damaged, setDamaged] = useState<Record<string, number>>({})
  const [toast, setToast] = useState<string | null>(null)
  const [scanNote, setScanNote] = useState<string | null>(null)

  const line = lines[index]
  /** A name or an honest blank — never a UUID in front of somebody holding a carton. */
  const nameOf = (variantId: string): string => names.get(variantId)?.name ?? t('w.unknownItem')

  const save = useMutation(
    (
      input: { lines: { grnLineId: string; countedQtyPcs: number; damagedQtyPcs: number }[] },
      meta,
    ) =>
      api.api.procurement.grns.count({
        id: grnId,
        idempotencyKey: meta.idempotencyKey,
        lines: input.lines,
      }),
    {
      invalidates: [['grn'], ['grns']],
      onSuccess: () => {
        haptics.success()
        setToast(t('w3.saved'))
        setStage('review')
      },
      onError: () => {
        haptics.error()
      },
    },
  )

  /** A carton with a barcode jumps to its line; a carton without one is found by hand. Both work. */
  const scan = (): void => {
    void camera.scan().then((code) => {
      if (code === null) {
        setScanNote(t('w.scanNothing'))
        return
      }
      const at = lines.findIndex((row) => names.get(row.variantId)?.ean === code.value)
      if (at < 0) {
        setScanNote(t('w.noMatch', { code: code.value }))
        return
      }
      haptics.tap()
      setScanNote(t('w.scanned', { code: code.value }))
      setIndex(at)
      setStage('count')
    })
  }

  const remaining = lines.filter((row) => counted[row.id] === undefined).length

  // ---------------------------------------------------------------- the pad, full screen
  if (countable && stage !== 'review' && line !== undefined) {
    const isDamaged = stage === 'damaged'
    const value = isDamaged ? (damaged[line.id] ?? null) : (counted[line.id] ?? null)
    return (
      <Screen
        title={nameOf(line.variantId)}
        context={t('w3.line', { index: index + 1, total: lines.length })}
        testID="w3-pad-screen"
        /*
         * The two ways off this line live in the STICKY bar, and the body scrolls.
         *
         * They were in the body under a `scroll={false}` screen, and the keypad alone is taller than
         * a phone: at 375 x 812 the pad's own "Damaged pieces" button was cut in half by the tab bar
         * and Scan and "Review the count" were below it with no way to reach them — on the ONE
         * screen in this product where a person types. On the iPhone the same overflow drew the
         * buttons THROUGH the keypad ("Review the count" printed across the 5 key). `scroll={false}`
         * is for a screen whose own `<List>` scrolls (ScreenProps); this one has no list.
         */
        bottomBar={
          <Row gap={8} align="center">
            <Box grow>
              <Button
                label={t('w.openScanner')}
                variant="secondary"
                onPress={scan}
                disabled={!camera.available}
                {...(camera.available ? {} : { disabledReason: t('w.scanUnavailable') })}
                testID="w3-scan"
              />
            </Box>
            <Box grow>
              <Button
                label={t('w3.review')}
                variant="ghost"
                onPress={() => {
                  setStage('review')
                }}
                testID="w3-to-review"
              />
            </Box>
          </Row>
        }
      >
        <Stack gap={4}>
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('w3.blind')}
          </Txt>
          <NumberPad
            testID={isDamaged ? 'w3-pad-damaged' : 'w3-pad-count'}
            mode="count"
            label={isDamaged ? t('w3.damagedLabel') : t('w3.countLabel')}
            value={value}
            onChange={(next) => {
              if (isDamaged) setDamaged((held) => ({ ...held, [line.id]: next ?? 0 }))
              else setCounted((held) => ({ ...held, [line.id]: next ?? 0 }))
            }}
            /*
             * Neither of these SAVES. `w3.done` ("Save the count") belongs to the review's own
             * button, which calls `procurement.grns.count`; a pad that only advances must not
             * borrow it, or a hand walks away from a count that was never sent.
             */
            doneLabel={
              isDamaged
                ? index + 1 < lines.length
                  ? t('w3.next')
                  : t('w3.review')
                : t('w3.damagedNext')
            }
            onDone={() => {
              haptics.tap()
              if (!isDamaged) {
                setStage('damaged')
                return
              }
              setStage('count')
              if (index + 1 < lines.length) setIndex(index + 1)
              else setStage('review')
            }}
          />
          {scanNote === null ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {scanNote}
            </Txt>
          )}
        </Stack>
      </Screen>
    )
  }

  // ---------------------------------------------------------------- the review
  return (
    <Screen
      title={t('w3.title')}
      context={grn.data?.item.grnNo ?? t('w3.context')}
      chips={<StatusChip label={status} family={workFamily(status)} />}
      testID="w3-screen"
      bottomBar={
        countable ? (
          <Row justify="between" align="center" gap={4} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {remaining === 0 ? t('w3.allCounted') : pl(t, 'w3.remaining', remaining)}
            </Txt>
            <Button
              label={t('w3.done')}
              variant="primary"
              loading={save.status === 'pending'}
              disabled={Object.keys(counted).length === 0}
              {...(Object.keys(counted).length === 0
                ? { disabledReason: pl(t, 'w3.remaining', lines.length) }
                : {})}
              onPress={() => {
                save.mutate({
                  lines: lines
                    .filter((row) => counted[row.id] !== undefined)
                    .map((row) => ({
                      grnLineId: row.id,
                      countedQtyPcs: counted[row.id] ?? 0,
                      damagedQtyPcs: damaged[row.id] ?? 0,
                    })),
                })
              }}
              testID="w3-save"
            />
          </Row>
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Async
          state={[grn, { isLoading: namesLoading && names.size === 0 }]}
          empty={lines.length === 0}
          emptyMessage={t('state.empty')}
        >
          {countable ? null : <DeskOnly>{t('w3.notCounting', { status })}</DeskOnly>}
          <Panel title={t('w3.counted')} meta={t('w3.blind')} testID="w3-lines">
            <Group>
              {lines.map((row, at) => (
                <ListRow
                  key={row.id}
                  testID={`w3-line-${row.id}`}
                  primary={nameOf(row.variantId)}
                  secondary={
                    counted[row.id] === undefined
                      ? t('w3.countLabel')
                      : t('w.pieces', { pieces: counted[row.id] ?? 0 })
                  }
                  trailing={
                    (damaged[row.id] ?? 0) > 0 ? (
                      <StatusChip
                        label={t('w.pieces', { pieces: damaged[row.id] ?? 0 })}
                        family="brick"
                      />
                    ) : counted[row.id] === undefined ? (
                      <StatusChip label={t('w2.stepWaiting')} family="neutral" />
                    ) : (
                      <StatusChip label={t('w.saved')} family="moss" />
                    )
                  }
                  state={counted[row.id] === undefined ? 'needsAttention' : 'default'}
                  {...(countable
                    ? {
                        onPress: () => {
                          setIndex(at)
                          setStage('count')
                        },
                      }
                    : {})}
                />
              ))}
            </Group>
          </Panel>

          <Panel title={t('w3.findings')} testID="w3-findings">
            {(grn.data?.item.discrepancies ?? []).length === 0 ? (
              <Txt field="body" desk="body" color={colors.text.secondary}>
                {t('w3.findingsEmpty')}
              </Txt>
            ) : (
              <Group>
                {(grn.data?.item.discrepancies ?? []).map((finding) => (
                  <ListRow
                    key={finding.id}
                    testID={`w3-finding-${finding.id}`}
                    primary={t(KIND_KEY[finding.kind] ?? 'w3.kindShort')}
                    secondary={finding.note ?? t('w.pieces', { pieces: finding.qtyPcs })}
                    trailing={
                      <StatusChip label={finding.status} family={workFamily(finding.status)} />
                    }
                  />
                ))}
              </Group>
            )}
          </Panel>

          <DeskOnly>{t('w3.postIsDesk')}</DeskOnly>
          {save.error === undefined ? null : (
            <Txt field="body" desk="body" color={colors.status.brick.fg}>
              {save.error.message}
            </Txt>
          )}
          <Button
            label={t('w.close')}
            variant="ghost"
            onPress={() => {
              router.push('/')
            }}
            testID="w3-close"
          />
        </Async>
      </Stack>
      <Toast
        open={toast !== null}
        message={toast ?? ''}
        onDismiss={() => {
          setToast(null)
        }}
        testID="w3-toast"
      />
    </Screen>
  )
}
