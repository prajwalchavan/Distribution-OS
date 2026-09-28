/**
 * The shop for React DOM: `<ProductTile>`, `<TileGrid>`, `<BrandTile>`, `<CartBar>` (founder,
 * 2026-09-28: the shopkeeper's home "must have a shopping app feel, not some complex feel", and it
 * starts without product photos). Contract in `../types.ts` §6.19; `@dos/ui/native` renders the same.
 *
 * THE PICTURE BEFORE THERE ARE PICTURES is the brand's initial on its own colour, and the colour is
 * a hash of the brand's name over the families the tokens already have (`brandColors`), so Campa is
 * the same block on every tile, in every app, on the web and on a phone — and no hex is added.
 *
 * THE TILE HAS NO BOX. Two across on a 360 px phone leaves a tile 154 px wide once the 19 px gap
 * between two tiles' buttons is taken (UX-00 §5.2: adjacent targets). A bordered, padded card would
 * leave 138 px inside — too narrow for the stepper's − and + at the 69 dp floor with 19 dp between
 * them (157). So the tinted picture block is the tile's shape and everything else aligns to its
 * edges, which is also what "not boxy" asked for.
 */
import { formatMoney } from '../money.js'
import { useHideBottomBar } from '../bottom-bar.js'
import { stepByCase } from '../qty.js'
import { brandColors, brandInitial, tileColumns } from '../shop-blocks.js'
import { useTheme } from '../theme.js'
import { gap, radius, space, typeField } from '../tokens.js'
import type { BrandTileProps, CartBarProps, ProductTileProps, TileGridProps } from '../types.js'
import { Txt, typeStyle } from './base.js'
import { Button } from './controls.js'
import { Money, QtyStepper } from './money.js'
import { useViewport } from './viewport.js'

/** The tinted block with the brand's initial: the tile's picture until there are photographs. */
function BrandBlock({ brand, height }: { brand: string; height: number }): React.JSX.Element {
  const theme = useTheme()
  const tone = brandColors(theme.colors, brand)
  return (
    <span
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height,
        width: '100%',
        borderRadius: radius.md,
        background: tone.background,
        color: tone.foreground,
        ...typeStyle(typeField.hero),
      }}
    >
      {brandInitial(brand)}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ProductTile
// ---------------------------------------------------------------------------

export function ProductTile({
  name,
  brand,
  pack,
  rate,
  rateUnit,
  mrp,
  offer,
  pieces,
  caseSize,
  onChange,
  onOpenPieces,
  availablePieces,
  disabled = false,
  disabledReason,
  onPress,
  testID,
}: ProductTileProps): React.JSX.Element {
  const theme = useTheme()
  const about = (
    <>
      <BrandBlock brand={brand} height={theme.density === 'desk' ? 88 : 80} />
      <Txt
        field="bodyStrong"
        desk="section"
        as="div"
        numberOfLines={2}
        style={{ marginTop: space[2] }}
      >
        {name}
      </Txt>
      {pack === undefined ? null : (
        <Txt
          field="label"
          desk="meta"
          as="div"
          color={theme.colors.text.secondary}
          numberOfLines={1}
        >
          {pack}
        </Txt>
      )}
    </>
  )
  return (
    <div
      data-testid={testID}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}
    >
      {onPress === undefined ? (
        <div>{about}</div>
      ) : (
        <button
          type="button"
          onClick={onPress}
          data-testid={testID === undefined ? undefined : `${testID}-open`}
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            border: 0,
            background: 'transparent',
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
            cursor: 'pointer',
            minHeight: theme.touchSize,
          }}
        >
          {about}
        </button>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          columnGap: space[1],
          marginTop: space[1],
        }}
      >
        <Money value={rate} size="moneyM" />
        {rateUnit === undefined ? null : (
          <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
            {rateUnit}
          </Txt>
        )}
      </div>
      {mrp === undefined || mrp === null ? null : (
        <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
          {theme.t('shop.mrp', { amount: formatMoney(mrp) })}
        </Txt>
      )}
      {offer === undefined ? null : (
        /* The scheme chip's own colours (UX-00 §6.6: accent tint, accent word), allowed to wrap. */
        <span
          style={{
            alignSelf: 'flex-start',
            maxWidth: '100%',
            marginTop: space[1],
            padding: `${String(space[1])}px ${String(space[2])}px`,
            borderRadius: radius.xs,
            background: theme.colors.accent.tint,
          }}
        >
          <Txt field="bodyStrong" desk="label" color={theme.colors.accent.fg}>
            {offer}
          </Txt>
        </span>
      )}
      {/* The button sits at the foot of the tile, so a row of tiles lines its buttons up. */}
      <div style={{ marginTop: 'auto', paddingTop: space[3] }}>
        {pieces > 0 ? (
          <QtyStepper
            layout="stacked"
            pieces={pieces}
            caseSize={caseSize}
            onChange={onChange}
            availablePieces={availablePieces}
            disabled={disabled}
            onOpenPieces={onOpenPieces}
            testID={testID === undefined ? undefined : `${testID}-qty`}
          />
        ) : (
          <Button
            label={theme.t('shop.add')}
            icon={
              <span aria-hidden style={{ fontSize: 24, lineHeight: 1, fontWeight: 600 }}>
                +
              </span>
            }
            variant="primary"
            fullWidth
            onPress={() => {
              onChange(stepByCase(0, 1, caseSize))
            }}
            disabled={disabled}
            disabledReason={disabledReason}
            testID={testID === undefined ? undefined : `${testID}-add`}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TileGrid
// ---------------------------------------------------------------------------

export function TileGrid({ children, testID }: TileGridProps): React.JSX.Element {
  const theme = useTheme()
  const viewport = useViewport()
  const columns = tileColumns(viewport.width)
  /* Two tiles' buttons side by side are adjacent targets: 19 dp apart, 25 on a warehouse screen. */
  const columnGap = theme.touch === 'floor' ? gap.warehouse : gap.adjacent
  const rowGap = theme.touch === 'floor' ? gap.warehouse : space[6]
  return (
    <div
      data-testid={testID}
      data-columns={columns}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`,
        columnGap,
        rowGap,
        alignItems: 'stretch',
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BrandTile
// ---------------------------------------------------------------------------

export function BrandTile({
  name,
  onPress,
  detail,
  selected = false,
  testID,
}: BrandTileProps): React.JSX.Element {
  const theme = useTheme()
  return (
    <button
      type="button"
      data-testid={testID}
      aria-pressed={selected}
      onClick={onPress}
      style={{
        display: 'block',
        width: '100%',
        minHeight: theme.touchSize,
        padding: space[2],
        border: `${selected ? '2px' : '1px'} solid ${
          selected ? theme.colors.accent.line : theme.colors.border.faint
        }`,
        borderRadius: radius.lg,
        background: theme.colors.bg.surface,
        textAlign: 'center',
        font: 'inherit',
        color: 'inherit',
        cursor: 'pointer',
      }}
    >
      <BrandBlock brand={name} height={theme.density === 'desk' ? 64 : 56} />
      <Txt
        field="bodyStrong"
        desk="section"
        as="div"
        numberOfLines={1}
        align="center"
        style={{ marginTop: space[2] }}
      >
        {name}
      </Txt>
      {detail === undefined ? null : (
        <Txt
          field="label"
          desk="meta"
          as="div"
          color={theme.colors.text.secondary}
          numberOfLines={1}
          align="center"
        >
          {detail}
        </Txt>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// CartBar
// ---------------------------------------------------------------------------

export function CartBar({
  count,
  total,
  actionLabel,
  onAction,
  loading,
  disabled,
  disabledReason,
  testID,
}: CartBarProps): React.JSX.Element | null {
  const theme = useTheme()
  const empty = count <= 0
  // An empty cart draws no bar at all — not even the screen's strip around this content.
  useHideBottomBar(empty)
  if (empty) return null
  return (
    <div
      data-testid={testID}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[4],
      }}
    >
      <div style={{ flexShrink: 0 }}>
        <Txt field="label" desk="meta" as="div" color={theme.colors.text.secondary}>
          {count === 1 ? theme.t('shop.oneItem') : theme.t('shop.items', { count })}
        </Txt>
        <Money
          value={total}
          size="moneyL"
          testID={testID === undefined ? undefined : `${testID}-total`}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0, maxWidth: 360 }}>
        <Button
          label={actionLabel}
          onPress={onAction}
          variant="primary"
          fullWidth
          loading={loading}
          disabled={disabled}
          disabledReason={disabledReason}
          testID={testID === undefined ? undefined : `${testID}-action`}
        />
      </div>
    </div>
  )
}
