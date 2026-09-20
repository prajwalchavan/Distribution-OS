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
 *
 * THERE IS A START STEP (DOS-040). A wave the desk raises is `open`, and the device handler accepts a
 * pick only on a `picking` sheet — starting moves every order `confirmed → picking` and takes away the
 * manager's cancel, so it is an online call (`warehouse.picklists.start`), never a side effect of a
 * queued pick. Until the device knows the sheet has started (the Start reply, or the next pull) the
 * rows show what to pick but carry no Picked / Short, and the bottom bar holds only "Start picking":
 * a tap that could only ever be refused is never queued.
 */
import { useApi, useMutation } from '@dos/api-client/react'
import { useSyncEngine, useSyncStatus } from '@dos/offline/react'
import {
  Box,
  Button,
  Group,
  ListRow,
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
import { keepKey } from '../../src/lib/keep'
import { pickGate } from '../../src/lib/pick-gate'
import { sheetStatus } from '../../src/lib/sheet-status'
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

  const api = useApi()
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const hydrated = useHydrated()
  const { sheet, loading: sheetLoading } = useLocalPicklist(picklistId)
  const { rows, loading } = useLocalPickLines(picklistId)
  const recordPick = useRecordPick()

  const start = useMutation(
    (id: string, meta) =>
      api.api.warehouse.picklists.start({ id, idempotencyKey: meta.idempotencyKey }),
    {
      invalidates: [['picklists']],
      onSuccess: () => {
        haptics.success()
        void engine?.sync('picklist-started')
      },
      onError: () => {
        haptics.error()
      },
    },
  )
  /*
   * The Start reply wins until the next pull repaints the local row: `engine.sync` returns early while
   * a pull is already running, so the local `picklists` row can still read `open` after a start that
   * succeeded. The reply counts only for THIS sheet, in case the router reuses the screen for another id.
   *
   * An unknown status is NOT a fourth way of saying "open" (DOS-182), and it is not a way of saying
   * "pickable" either: `pickGate` answers `waiting` for a sheet this device does not hold, so nothing
   * is offered over a wave that may still be arriving. The precedence itself lives in `pickGate`.
   */
  const startedHere =
    start.data !== undefined && start.data.item.id === picklistId
      ? start.data.item.status
      : undefined
  /*
   * DOS-120: and the reply stops speaking the moment the row it stands in for does. This used to be
   * `startedHere ?? sheet?.status`, which kept "picking" for as long as the screen stayed mounted —
   * PICK-0083's chip said `picking` beside "7 of 7 picked" with the confirm enabled, and only said
   * `picked` after navigating away and back. The rule is `sheetStatus`, beside `pickGate`.
   */
  const liveStatus = sheetStatus({ startedHere, deviceStatus: sheet?.status })
  const gate = pickGate({ startedHere, deviceStatus: sheet?.status ?? null })
  const notStarted = gate === 'not-started'
  const locked = gate !== 'pickable'

  const [shortFor, setShortFor] = useState<PickRow | null>(null)
  const [shortPieces, setShortPieces] = useState<number | null>(null)
  /*
   * NULL, AND IT STAYS NULL UNTIL THE PICKER SAYS OTHERWISE (DOS-051).
   *
   * This used to open on `REASON_KEYS[0]`, so Short pressed with nothing chosen saved "Not on the
   * rack" — measured on PICK-0079: `picked_qty_pcs 0`, `short_reason 'Not on the rack'`, a reason
   * nobody had touched. The desk rings the supplier and holds a batch on the strength of that word,
   * so a default here writes fiction into the short report. `warehouse.sync.ts` refuses a short with
   * no reason as well; a screen is not a guarantee, and the two halves say the same thing.
   */
  const [shortReason, setShortReason] = useState<string | null>(null)
  const [scanNote, setScanNote] = useState<string | null>(null)
  const [view, setView] = useState<'todo' | 'all'>('todo')
  /*
   * DOS-041: a batch row the wave asked N pieces of can never save more than N — the server refuses it,
   * because the pack would take the extra pieces from a lot that was never asked to hold them. The pad
   * still takes every key (UX-00 §6.3, no silent clamping): over the ask it says why, and Short refuses
   * to save. A split row asks for nothing of its own (0) and is bounded by its line, as on the server.
   */
  const ask = shortFor?.line.requested_qty_pcs ?? 0
  const overAsk = shortFor !== null && ask > 0 && (shortPieces ?? 0) > ask
  /*
   * DOS-051: pieces left on the rack are explained, or they are not recorded. A pick that is NOT
   * under the ask needs no reason — nothing was left behind — and a split row asks for nothing of its
   * own (0), which is the same rule `applyPicks` and `warehouse.sync.ts` apply on the server.
   */
  const shortOfAsk = shortFor !== null && ask > 0 && (shortPieces ?? 0) < ask
  const needsReason = shortOfAsk && shortReason === null

  const picked = rows.filter((row) => row.state !== 'todo').length
  const shown = useMemo(
    () => (view === 'todo' ? rows.filter((row) => row.state === 'todo') : rows),
    [rows, view],
  )
  const left = rows.length - picked

  /** A tap that means "all of it came off the rack" — the common case, one tap, no keypad. */
  const pickInFull = (row: PickRow): void => {
    if (locked) return
    haptics.success()
    void recordPick({
      line: row.line,
      pickedQtyPcs: row.line.requested_qty_pcs,
      shortReason: null,
    })
  }

  const saveShort = (): void => {
    const row = shortFor
    if (row === null || locked) return
    if (overAsk || needsReason) {
      haptics.error()
      return
    }
    haptics.warning()
    void recordPick({
      line: row.line,
      pickedQtyPcs: shortPieces ?? 0,
      shortReason: shortReason === null ? null : t(shortReason),
    })
    setShortFor(null)
    setShortPieces(null)
    setShortReason(null)
  }

  /** Scanning is a convenience, never the only way: every row is reachable by thumb (docs/23 §4.1). */
  const scan = (): void => {
    if (locked) return
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
          <StatusChip
            label={liveStatus ?? sheet.status}
            family={workFamily(liveStatus ?? sheet.status)}
          />
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
          {/*
           * "0 OF 0 PICKED" IS AN ANSWER, AND THIS SCREEN DOES NOT HAVE ONE YET (DOS-119).
           *
           * A wave raised a second ago is on the server and not on this phone, so the figure counted
           * rows the device had not been given: PICK-0083 read "Nothing here yet · 0 of 0 picked" for
           * 57 s after its 200 reply. The gate already knows the difference — `waiting` is the device
           * not having answered — so while it says so the bar says that instead of counting. W4 asks
           * for the pull the moment the wave exists (`pullAfterWrite`); this is what the picker reads
           * for the second it takes.
           */}
          {gate === 'waiting' ? (
            <Txt field="label" desk="meta" color={colors.text.secondary} testID="w5-waiting">
              {t('w5.waiting')}
            </Txt>
          ) : (
            <Txt field="moneyM" desk="cell" numeric>
              {t('w5.progress', { picked, total: rows.length })}
            </Txt>
          )}
          {/*
           * NOTHING STANDS BETWEEN THE PICKER AND THE FIRST ROW (DOS-182, merge review 2026-09-20).
           *
           * Both of these used to be lines of the BODY, above the list. Measured on a Pixel 7 at a
           * cold start with the office away, the offline promise and "Still filling this phone from
           * the server" together pushed the first card's Picked / Short under the sticky bar — the
           * one thing UX-00 section 9.4 puts above the fold, below it, which is what a prover reading
           * only the first viewport then filed as a lock. They belong here, where the thumb already
           * is and where they cost the list nothing; the filling sentence now prints UNDER the rows
           * (`LocalAsyncBody`). Said WHEN IT IS TRUE, not always: online, the connection strip
           * already carries "Updated just now".
           */}
          {status.online ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary} testID="w5-offline">
              {t(keepKey('offlineNote', status.persistent))}
            </Txt>
          )}
          {scanNote === null ? null : (
            <Txt field="label" desk="meta" color={colors.text.secondary} testID="w5-scan-note">
              {scanNote}
            </Txt>
          )}
          {/*
           * Not started: ONE action. Scan is hidden rather than disabled, because the kit prints a
           * disabled button's reason beneath it — the not-started sentence would be said twice on a
           * phone, over the scanner's own "unavailable" reason.
           */}
          {/*
           * Nothing is offered while the device has not answered (DOS-182). Scan and "Take it to
           * packing" over rows that refuse to be picked is the bar contradicting the sheet.
           */}
          {gate === 'waiting' ? null : notStarted ? (
            <Button
              label={t('w5.start')}
              variant="primary"
              loading={start.status === 'pending'}
              disabled={!status.online}
              {...(status.online ? {} : { disabledReason: t('w5.startOffline') })}
              onPress={() => {
                start.mutate(picklistId)
              }}
              testID="w5-start"
            />
          ) : (
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
          )}
        </Stack>
      }
    >
      <Stack gap={5}>
        {notStarted ? (
          <Txt field="body" desk="body" testID="w5-not-started">
            {t('w5.notStarted')}
          </Txt>
        ) : null}
        {start.error === undefined ? null : (
          <Txt field="body" desk="body" color={colors.status.brick.fg} testID="w5-start-error">
            {`${t('w5.startFailed')}: ${start.error.message}`}
          </Txt>
        )}
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

        <LocalAsync
          loading={loading || sheetLoading}
          hydrated={hydrated}
          empty={rows.length === 0}
          // A sheet this device has not read is not an empty sheet (DOS-119).
          emptyMessage={gate === 'waiting' ? t('w5.waiting') : t('state.empty')}
          waitingMessage={t('w.filling')}
        >
          <Stack gap={4}>
            {shown.map((row) => (
              <PickLineCard
                key={row.line.id}
                row={row}
                locked={locked}
                onPicked={() => {
                  pickInFull(row)
                }}
                onShort={() => {
                  setShortFor(row)
                  setShortPieces(row.line.picked_qty_pcs)
                  setShortReason(null)
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
          <Txt field="bodyStrong" desk="cell">
            {t('w5.shortReason')}
          </Txt>
          {/*
           * STACKED, NOT SHARED (DOS-165). Measured on an iPhone 16 Pro at 402 pt, the three reasons
           * in one segmented row laid the third out at x 331-487 and printed it as "Batcl", half of
           * it off the screen; a tap at its centre landed on nothing and the preselected first chip
           * stayed selected. Three labels of the trade's own length do not fit one phone line, so
           * they take a row each, exactly as D4's return reasons do (DOS-163). The words themselves
           * are never shortened: the desk's short report prints them.
           */}
          <Group testID="w5-short-reason">
            {REASON_KEYS.slice(0, 3).map((key) => (
              <ListRow
                key={key}
                testID={`w5-short-reason-${key}`}
                primary={t(key)}
                state={shortReason === key ? 'selected' : 'default'}
                onPress={() => {
                  setShortReason(key)
                }}
              />
            ))}
          </Group>
          {/*
           * EVERY REASON A SHORT IS REFUSED PRINTS HERE, ABOVE THE PAD (DOS-118).
           *
           * Measured at 390 x 844: the over-ask sentence used to follow the keypad and was laid out
           * at y 836-880 in an 844-px viewport, UNDER its own Short button at y 728-804 — a sliver of
           * red at the screen edge, so a picker pressed Short, saw nothing happen, and pressed it
           * again. `NumberPadProps` has no `disabled`, so the fix is the order of the sheet: a
           * refusal belongs at the top, beside the reasons and the requested figure, where no keypad
           * can push it off a phone. At 1280 x 800 nothing moves, which is why the desk never saw it.
           */}
          {needsReason ? (
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="w5-short-noreason">
              {t('w5.chooseReason')}
            </Txt>
          ) : null}
          {overAsk ? (
            <Txt field="body" desk="body" color={colors.status.brick.fg} testID="w5-short-over">
              {t('w5.overAsk', { pieces: ask })}
            </Txt>
          ) : null}
          <NumberPad
            testID="w5-short-pad"
            mode="count"
            label={t('w5.enterPieces')}
            value={shortPieces}
            expected={ask > 0 ? ask : null}
            expectedLabel={t('w5.bin', { pieces: ask })}
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
 *
 * The actions are HIDDEN while the sheet is locked, not disabled: the kit prints `disabledReason` under
 * every disabled button, so two per row would repeat one sentence down the whole sheet.
 */
function PickLineCard({
  row,
  locked,
  onPicked,
  onShort,
}: {
  row: PickRow
  /** The sheet is not known to be started: show what to pick, offer no Picked / Short (DOS-040). */
  locked: boolean
  onPicked: () => void
  onShort: () => void
}): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  /* DOS-179: the chip below claims a keep, so it has to know what this device's store turned out to be. */
  const status = useSyncStatus()
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
            <StatusChip label={t(keepKey('savedOnDevice', status.persistent))} family="clay" />
          ) : null}
        </Row>
      ) : locked ? null : (
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
