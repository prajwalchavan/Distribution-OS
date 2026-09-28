/**
 * The shop for React Native: `<ProductTile>`, `<TileGrid>`, `<BrandTile>`, `<CartBar>` — the same
 * four names, props and rules as `../web/shop.tsx`, whose header carries the argument (founder,
 * 2026-09-28: "a shopping app feel", starting without product photos).
 *
 * One difference, and it is the platform's: there is no CSS grid, so `<TileGrid>` cuts its children
 * into rows of `tileColumns(width)` and pads the last row with empty cells, which draws the same
 * equal columns the web grid does.
 */
import { Children } from 'react'
import { Pressable, View } from 'react-native'

import { useHideBottomBar } from '../bottom-bar.js'
import { formatMoney } from '../money.js'
import { stepByCase } from '../qty.js'
import { brandColors, brandInitial, chunkRows, tileColumns } from '../shop-blocks.js'
import { useTheme } from '../theme.js'
import { gap, radius, space } from '../tokens.js'
import type { BrandTileProps, CartBarProps, ProductTileProps, TileGridProps } from '../types.js'
import { Txt } from './base.js'
import { Button } from './controls.js'
import { Money, QtyStepper } from './money.js'
import { useViewport } from './viewport.js'

/** The tinted block with the brand's initial: the tile's picture until there are photographs. */
function BrandBlock({ brand, height }: { brand: string; height: number }): React.JSX.Element {
  const theme = useTheme()
  const tone = brandColors(theme.colors, brand)
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        backgroundColor: tone.background,
      }}
    >
      <Txt field="hero" desk="kpi" color={tone.foreground}>
        {brandInitial(brand)}
      </Txt>
    </View>
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
  stock,
  disabled = false,
  disabledReason,
  onPress,
  testID,
}: ProductTileProps): React.JSX.Element {
  const theme = useTheme()
  const about = (
    <View>
      <BrandBlock brand={brand} height={theme.density === 'desk' ? 88 : 80} />
      <Txt field="bodyStrong" desk="section" numberOfLines={2} style={{ marginTop: space[2] }}>
        {name}
      </Txt>
      {pack === undefined ? null : (
        <Txt field="label" desk="meta" color={theme.colors.text.secondary} numberOfLines={1}>
          {pack}
        </Txt>
      )}
    </View>
  )
  return (
    <View testID={testID} style={{ flex: 1, minWidth: 0 }}>
      {onPress === undefined ? (
        about
      ) : (
        <Pressable
          testID={testID === undefined ? undefined : `${testID}-open`}
          accessibilityRole="button"
          accessibilityLabel={name}
          onPress={onPress}
          style={({ pressed }) => ({ minHeight: theme.touchSize, opacity: pressed ? 0.82 : 1 })}
        >
          {about}
        </Pressable>
      )}
      <View
        style={{
          flexDirection: 'row',
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
      </View>
      {mrp === undefined || mrp === null ? null : (
        <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
          {theme.t('shop.mrp', { amount: formatMoney(mrp) })}
        </Txt>
      )}
      {offer === undefined ? null : (
        <View
          style={{
            alignSelf: 'flex-start',
            maxWidth: '100%',
            marginTop: space[1],
            paddingHorizontal: space[2],
            paddingVertical: space[1],
            borderRadius: radius.xs,
            backgroundColor: theme.colors.accent.tint,
          }}
        >
          <Txt field="bodyStrong" desk="label" color={theme.colors.accent.fg}>
            {offer}
          </Txt>
        </View>
      )}
      {/* The button sits at the foot of the tile, so a row of tiles lines its buttons up. */}
      <View style={{ marginTop: 'auto', paddingTop: space[3] }}>
        {/* Stock in the caller's words, BEFORE the + as well as after it: a shop sees "Out of
            stock" before it adds, not only once the stepper has an answer to argue with. */}
        {stock === undefined ? null : (
          <Txt
            field="label"
            desk="meta"
            color={theme.colors.status.ochre.fg}
            style={{ marginBottom: space[1] }}
            testID={testID === undefined ? undefined : `${testID}-stock`}
          >
            {stock}
          </Txt>
        )}
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
              <Txt field="title" desk="pageTitle" color={theme.colors.text.onAccent}>
                +
              </Txt>
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
      </View>
    </View>
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
  const rows = chunkRows(Children.toArray(children), columns)
  return (
    <View testID={testID} style={{ gap: rowGap }}>
      {rows.map((row, r) => (
        <View
          key={String(r)}
          style={{ flexDirection: 'row', alignItems: 'stretch', gap: columnGap }}
        >
          {row.map((cell, c) => (
            <View key={String(c)} style={{ flex: 1, minWidth: 0 }}>
              {cell}
            </View>
          ))}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`pad-${String(i)}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchSize,
        padding: space[2],
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent.line : theme.colors.border.faint,
        borderRadius: radius.lg,
        backgroundColor: pressed ? theme.colors.bg.raised : theme.colors.bg.surface,
        alignItems: 'stretch',
      })}
    >
      <BrandBlock brand={name} height={theme.density === 'desk' ? 64 : 56} />
      <Txt
        field="bodyStrong"
        desk="section"
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
          color={theme.colors.text.secondary}
          numberOfLines={1}
          align="center"
        >
          {detail}
        </Txt>
      )}
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// CartBar
// ---------------------------------------------------------------------------

export function CartBar({
  count,
  total,
  approximate = false,
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
  // "about" only in front of a figure: an em dash is already "not known yet".
  const about = approximate && total !== null
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[4],
      }}
    >
      <View>
        <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
          {count === 1 ? theme.t('shop.oneItem') : theme.t('shop.items', { count })}
        </Txt>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[1] }}>
          {about ? (
            <Txt field="label" desk="meta" color={theme.colors.text.secondary}>
              {theme.t('shop.about')}
            </Txt>
          ) : null}
          <Money
            value={total}
            size="moneyL"
            testID={testID === undefined ? undefined : `${testID}-total`}
          />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0, maxWidth: 360 }}>
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
      </View>
    </View>
  )
}
