/**
 * DOS-101 — the "Pieces" pad: type an exact piece count, for an item this shop buys below a whole case
 * ("Only 9 pc left") or just wants an odd amount of. It follows the sales app's own (DOS-085).
 *
 * Lifted out of `app/retailer/order.tsx` (founder, 2026-09-28) so every tile on the shop front — the
 * home, a brand page, search — opens the same pad as the order screen's rows, into the same basket.
 * A typed count commits through `onSet`, never through the stepper's own `onChange`, which stays a
 * case +/- tap (docs/17 A3); the basket records pieces and `enteredFor` labels a count that does not
 * divide by the case size as a piece entry when the order is placed.
 */
import {
  Button,
  Row,
  Sheet,
  Stack,
  TextInput,
  Txt,
  parsePieces,
  stepPiece,
  useStrings,
} from '@dos/ui'
import { useEffect, useState } from 'react'

interface PiecesSheetProps {
  open: boolean
  onClose: () => void
  itemName: string
  /** This item's pieces in the basket at the moment the sheet opens — never live-updated while open. */
  initialPieces: number
  onSet: (qtyPcs: number) => void
  testID?: string
}

export function PiecesSheet({
  open,
  onClose,
  itemName,
  initialPieces,
  onSet,
  testID = 'r7-pieces',
}: PiecesSheetProps): React.JSX.Element {
  const t = useStrings()
  const [text, setText] = useState(() => String(initialPieces))

  // Fresh text every time the sheet opens — for THIS item's current count, never a stale value left
  // over from a cancelled edit or from whichever item was open before.
  useEffect(() => {
    if (open) setText(String(initialPieces))
  }, [open, initialPieces])

  const parsed = parsePieces(text)

  return (
    <Sheet open={open} onClose={onClose} title={t('qty.piecesTitle')} testID={testID}>
      <Stack gap={4}>
        <Txt field="bodyStrong" desk="body">
          {itemName}
        </Txt>
        <TextInput
          testID={`${testID}-input`}
          label={t('qty.piecesLabel')}
          value={text}
          onChange={setText}
          keyboard="decimal"
          autoFocus
          error={text.trim() !== '' && !parsed.ok ? t('qty.piecesInvalid') : undefined}
        />
        <Row gap={3}>
          <Button
            label={t('qty.pieceLess')}
            variant="secondary"
            disabled={!parsed.ok || parsed.pieces <= 0}
            onPress={() => {
              if (parsed.ok) setText(String(stepPiece(parsed.pieces, -1)))
            }}
          />
          <Button
            label={t('qty.pieceMore')}
            variant="secondary"
            onPress={() => {
              if (parsed.ok) setText(String(stepPiece(parsed.pieces, 1)))
            }}
          />
        </Row>
        <Button
          testID={`${testID}-set`}
          variant="primary"
          label={t('qty.piecesSet')}
          disabled={!parsed.ok}
          onPress={() => {
            if (parsed.ok) onSet(parsed.pieces)
          }}
        />
      </Stack>
    </Sheet>
  )
}

/**
 * The pad, wired to a basket: `open(variantId)` from any tile or row, and `sheet` rendered once by the
 * screen. `setQty` is the basket's own, so a typed count lands exactly where a tap would.
 */
export function usePiecesEntry(options: {
  nameOf: (variantId: string) => string
  piecesOf: (variantId: string) => number
  setQty: (variantId: string, qtyPcs: number) => void
  testID?: string
}): { open: (variantId: string) => void; sheet: React.JSX.Element } {
  const [piecesFor, setPiecesFor] = useState<string | null>(null)
  const { nameOf, piecesOf, setQty, testID } = options
  const sheet = (
    <PiecesSheet
      open={piecesFor !== null}
      onClose={() => {
        setPiecesFor(null)
      }}
      itemName={piecesFor === null ? '' : nameOf(piecesFor)}
      initialPieces={piecesFor === null ? 0 : piecesOf(piecesFor)}
      onSet={(qtyPcs) => {
        if (piecesFor === null) return
        setQty(piecesFor, qtyPcs)
        setPiecesFor(null)
      }}
      {...(testID === undefined ? {} : { testID })}
    />
  )
  return { open: setPiecesFor, sheet }
}
