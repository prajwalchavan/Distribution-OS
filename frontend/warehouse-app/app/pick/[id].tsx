/**
 * W5 — the picking sheet (docs/23 §4.1, drawn in UX-00 §9.4).
 *
 * THE SCREEN A HAND HOLDS FOR TWENTY MINUTES BETWEEN A STEEL RACK AND A WALL. It reads the DEVICE,
 * not the service: `picklists` and `pick_lines` are two of the thirteen tables `sync.manifest`
 * publishes for the warehouse role, and `pick_lines` is the ONLY writable one — so every pick lands
 * in the local table on the instant and drains through the outbox when there is a signal again
 * (`warehouse.sync.ts` re-applies the same `PicklistsService.applyPicks` rules an online pick goes
 * through, so the two cannot drift apart).
 *
 * One row per line, in the order the picker walks it: still-to-do first. Each row carries the lot the
 * wave suggested — batch, expiry, MRP — because a picker who is handed "Campa Cola 750 ml" and no
 * batch will take whatever is nearest, which is how FEFO dies. Taking a later lot is a WARNING and
 * never a block (docs/design R03); a short line needs a reason and becomes its own pack row, never an
 * edit to the order.
 *
 * There is no Save step (UX-00 §9.4). "Confirm" only exists to close the sheet in the reader's mind;
 * the pieces have already been recorded, one tap at a time.
 */
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import {
  Box,
  Button,
  Money,
  NumberPad,
  Row,
  Screen,
  Segments,
  Sheet,
  Stack,
  StatusChip,
  Txt,
  useColors,
  useStrings,
} from '@dos/ui'
import { caseLine } from '@dos/ui'
import { camera, haptics } from '@dos/ui/platform'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'

import type { PickRow } from '../../src/lib/local'
import { useHydrated, useLocalPickLines, useLocalPicklist } from '../../src/lib/local'
import { useRecordPick } from '../../src/lib/queue'
import { DeskOnly, ExpiryChip, LocalAsync, Panel, pl, workFamily } from '../../src/lib/ui'

const REASON_KEYS = [
  'w5.reasonRack',
  'w5.reasonDamaged',
  'w5.reasonHeld',
  'w5.reasonOther',
] as const

export default function PickingSheet(): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const router = useRouter()
  const params = useLocalSearchParams<{ id: string }>()
  const picklistId = typeof params.id === 'string' ? params.id : ''

  const engine = useSyncEngine()
  const status = useSyncStatus()
  const hydrated = useHydrated()
  const { sheet, loading: sheetLoading } = useLocalPicklist(picklistId)
  const { rows, loading } = useLocalPickLines(picklistId)
  const recordPick = useRecordPick()

  const [shortFor, setShortFor] = useState<PickRow | null>(null)
  const [shortPieces, setShortPieces] = useState<number | null>(null)
  const [shortReason, setShortReason] = useState<string>(REASON_KEYS[0])
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [view, setView] = useState<'todo' | 'all'>('todo')

  const picked = rows.filter((row) => row.state !== 'todo').length
  const shown = useMemo(
    () => (view === 'todo' ? rows.filter((row) => row.state === 'todo') : rows),
    [rows, view],
  )
  const left = rows.length - picked

  /** A tap that means "all of it came off the rack" — the common case, one tap, no keypad. */
  const pickInFull = (row: PickRow): void => {
    haptics.success()
    void recordPick({
      line: row.line,
      pickedQtyPcs: row.line.requested_qty_pcs,
      shortReason: null,
    })
  }

  const saveShort = (): void => {
    const row = shortFor
    if (row === null) return
    haptics.warning()
    void recordPick({
      line: row.line,
      pickedQtyPcs: shortPieces ?? 0,
      shortReason: t(shortReason),
    })
    setShortFor(null)
    setShortPieces(null)
  }

  /** Scanning is a convenience, never the only way: every row is reachable by thumb (docs/23 §4.1). */
  const scan = (): void => {
    void camera.scan().then((code) => {
      if (code === null) {
        setScanNote(t('w.scanNothing'))
        return
      }
      const found = rows.find((row) => row.ean === code.value)
      if (found === undefined) {
        setScanNote(t('w.noMatch', { code: code.value }))
        return
      }
      setScanNote(t('w.scanned', { code: code.value }))
      pickInFull(found)
    })
  }

  return (
    <Screen
      title={sheet?.picklist_no ?? t('w5.title')}
      context={sheet === null ? t('w5.title') : t('w5.progress', { picked, total: rows.length })}
      chips={
        sheet === null ? undefined : (
          <StatusChip label={sheet.status} family={workFamily(sheet.status)} />
        )
      }
      testID="w5-screen"
      /*
       * EVERYTHING THAT IS NOT A PICKABLE ROW LIVES IN THE BOTTOM BAR.
       *
       * UX-00 §9.4's phone sketch is a header line and then rows; measured at 375 × 812 with the
       * scan action in the page header and the view switch above the list, the first row's
       * Picked / Short buttons sat at y = 593 under a sticky bar that starts at 575 — the one thing
       * the sketch puts above the fold, below it. The bar is where the thumb already is, so the
       * scan lives there, and the view switch appears only once there is a second view worth
       * having (nothing is done on a fresh sheet, so "To pick" and "Every line" are the same list).
       */
      bottomBar={
        /*
         * A STACK, not a row. At 375 px the progress figure and two 76 dp buttons on one line left
         * each button ~110 px: "Confirm 4 lines" printed OUTSIDE its own border and the disabled
         * reason wrapped over the tab bar. The figure is a line of its own; the two actions get half
         * the gutter width each.
         */
        <Stack gap={3}>
          <Txt field="moneyM" desk="cell" numeric>
            {t('w5.progress', { picked, total: rows.length })}
          </Txt>
          <Row gap={8} wrap>
            <Box grow>
              <Button
                label={t('w.openScanner')}
                variant="secondary"
                onPress={scan}
                disabled={!camera.available}
                {...(camera.available ? {} : { disabledReason: t('w.scanUnavailable') })}
                testID="w5-scan"
              />
            </Box>
            <Box grow>
              <Button
                label={t('w5.confirm')}
                variant="primary"
                disabled={left > 0}
                {...(left > 0 ? { disabledReason: pl(t, 'w5.linesLeft', left) } : {})}
                onPress={() => {
                  haptics.success()
                  router.push('/pack')
                }}
                testID="w5-confirm"
              />
            </Box>
          </Row>
        </Stack>
      }
    >
      <Stack gap={5}>
        {picked === 0 ? null : (
          <Segments
            testID="w5-view"
            items={[
              { id: 'todo', label: t('w5.viewTodo') },
              { id: 'all', label: t('w5.viewAll') },
            ]}
            value={view}
            onChange={(id) => {
              setView(id === 'all' ? 'all' : 'todo')
            }}
          />
        )}

        {/*
         * The offline promise is said WHEN IT IS TRUE, not always. A standing sentence cost a whole
         * row of the sheet: measured at 375 x 812, the first line's Picked / Short buttons fell
         * below the fold, and the one thing UX-00 section 9.4 puts above it is a pickable row.
         * Online, the connection strip already carries "Updated just now".
         */}
        {status.online ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} testID="w5-offline">
            {t('w5.offlineNote')}
          </Txt>
        )}
        {scanNote === null ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {scanNote}
          </Txt>
        )}

        <LocalAsync
          loading={loading || sheetLoading}
          hydrated={hydrated}
          empty={rows.length === 0}
          emptyMessage={t('state.empty')}
          waitingMessage={t('w.filling')}
        >
          <Stack gap={4}>
            {shown.map((row) => (
              <PickLineCard
                key={row.line.id}
                row={row}
                onPicked={() => {
                  pickInFull(row)
                }}
                onShort={() => {
                  setShortFor(row)
                  setShortPieces(row.line.picked_qty_pcs)
                  setShortReason(REASON_KEYS[0])
                }}
              />
            ))}
          </Stack>
        </LocalAsync>

        <DeskOnly>{t('w5.cancelIsManager')}</DeskOnly>

        <Panel testID="w5-device">
          <Row justify="between" gap={3} wrap>
            <Txt field="label" desk="meta" color={colors.text.secondary}>
              {t('x4.pending', { count: status.pending })}
            </Txt>
            <Button
              label={t('w.refresh')}
              variant="ghost"
              onPress={() => {
                void engine?.sync('picking-sheet')
              }}
              testID="w5-refresh"
            />
          </Row>
        </Panel>
      </Stack>

      <Sheet
        open={shortFor !== null}
        onClose={() => {
          setShortFor(null)
        }}
        title={shortFor === null ? '' : shortFor.variantName}
        testID="w5-short-sheet"
      >
        <Stack gap={4}>
          <Segments
            testID="w5-short-reason"
            items={REASON_KEYS.slice(0, 3).map((key) => ({ id: key, label: t(key) }))}
            value={shortReason}
            onChange={setShortReason}
          />
          <NumberPad
            testID="w5-short-pad"
            mode="count"
            label={t('w5.enterPieces')}
            value={shortPieces}
            onChange={setShortPieces}
            doneLabel={t('w5.short')}
            onDone={saveShort}
          />
        </Stack>
      </Sheet>
    </Screen>
  )
}

/**
 * One line of the sheet, laid out as UX-00 §9.4 draws it: the item, its lot line, the quantity in
 * cases and pieces, the FEFO warning where there is one, and the two 76 dp buttons.
 *
 * It is not a `<ListRow>`: that row carries one figure and one chip, and this one carries a lot line,
 * a quantity in two units and two full-width actions — which is exactly the case §6.6 says to compose
 * rather than to force.
 */
function PickLineCard({
  row,
  onPicked,
  onShort,
}: {
  row: PickRow
  onPicked: () => void
  onShort: () => void
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const done = row.state !== 'todo'
  return (
    <Stack
      gap={3}
      pad={4}
      background="surface"
      radius="md"
      border="all"
      borderTone={done ? 'faint' : 'strong'}
      testID={`w5-line-${row.line.id}`}
    >
      <Txt field="bodyStrong" desk="cell">
        {row.variantName}
      </Txt>
      <Row gap={3} wrap align="center">
        <Txt field="label" desk="meta" color={colors.text.secondary}>
          {row.batchNo === null ? t('w.noBatch') : t('w.batch', { batch: row.batchNo })}
        </Txt>
        <ExpiryChip expiryDate={row.expiryDate} testID={`w5-exp-${row.line.id}`} />
        {row.mrpPaise === null ? null : (
          <Txt field="label" desk="meta" color={colors.text.secondary} numeric>
            <Money value={row.mrpPaise} size="cell" />
          </Txt>
        )}
      </Row>
      <Txt field="moneyM" desk="cell" numeric>
        {caseLine(row.line.requested_qty_pcs, row.caseSize, t)}
      </Txt>
      {row.fefoOverride ? (
        <StatusChip
          label={t('w5.fefo', { batch: row.batchNo ?? '—' })}
          family="ochre"
          testID={`w5-fefo-${row.line.id}`}
        />
      ) : null}
      {done ? (
        <Row gap={3} wrap align="center">
          <StatusChip
            label={row.state === 'short' ? t('w5.short') : t('w5.pickedAll')}
            family={row.state === 'short' ? 'ochre' : 'moss'}
            testID={`w5-state-${row.line.id}`}
          />
          <Txt field="label" desk="meta" color={colors.text.secondary}>
            {t('w.pieces', { pieces: row.line.picked_qty_pcs })}
            {row.line.short_reason === null ? '' : ` · ${row.line.short_reason}`}
          </Txt>
          {row.line._pending === 'queued' || row.line._pending === 'sending' ? (
            <StatusChip label={t('w.savedOnDevice')} family="clay" />
          ) : null}
        </Row>
      ) : (
        /*
         * UX-00 §9.4 draws these SIDE BY SIDE — "[ Picked ] [ Short ], 76 dp primary-per-row ·
         * secondary, 25 dp gap [UX-01 W1]". A kit `<Button>` at any field size defaults to
         * `fullWidth` (`controls.tsx`: `width: fullWidth ?? !isDesk ? '100%'`), which is right for a
         * bottom bar and wrong here: measured at 1440 px, both buttons came out 1134 px and stacked,
         * so the row was 152 dp tall and "Short" sat where the next line's "Picked" belonged. Each
         * button gets its own `<Box grow>` — one flex half each on both renderers — and `gap={8}` is
         * 32 px, over the 25 dp this app's screens owe between adjacent targets (UX-00 §5.2).
         */
        <Row gap={8} wrap>
          <Box grow>
            <Button
              label={t('w5.picked')}
              variant="primary"
              onPress={onPicked}
              testID={`w5-pick-${row.line.id}`}
            />
          </Box>
          <Box grow>
            <Button
              label={t('w5.short')}
              variant="secondary"
              onPress={onShort}
              testID={`w5-short-${row.line.id}`}
            />
          </Box>
        </Row>
      )}
    </Stack>
  )
}
