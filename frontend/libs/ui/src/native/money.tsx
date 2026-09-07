/**
 * UX-00 sections 6.3 and 6.4 for React Native: `<Money>`, `<RupeeInput>`, `<NumberPad>`, `<QtyStepper>`.
 *
 * Integer paise in, integer paise out. The pad appends DIGITS (1 2 3 4 -> ₹12.34), so no float and no
 * locale parser ever stands between the loader's thumb and the ledger.
 */
import { useEffect, useState } from 'react'
import { Modal, Pressable, TextInput as RNTextInput, View } from 'react-native'

import { formatMoney, parseRupees, speakMoney, splitMoney, toEditableRupees } from '../money.js'
import { availableLine, caseLine, formatCount, qtyState, splitQty, stepByCase } from '../qty.js'
import { useTheme } from '../theme.js'
import {
  gap,
  radius,
  size as sizeTokens,
  space,
  typeDesk,
  typeField,
  type TypeToken,
} from '../tokens.js'
import type {
  MoneyProps,
  MoneySize,
  MoneyTone,
  NumberPadProps,
  QtyStepperProps,
  RupeeInputProps,
} from '../types.js'
import { Txt, typeStyle, useTypeStyle } from './base.js'
import { Button } from './controls.js'

const FIELD_SIZE: Record<MoneySize, TypeToken> = {
  hero: typeField.hero,
  moneyL: typeField.moneyL,
  moneyM: typeField.moneyM,
  cell: typeField.moneyM,
  body: typeField.body,
}
const DESK_SIZE: Record<MoneySize, TypeToken> = {
  hero: typeDesk.kpi,
  moneyL: typeDesk.kpi,
  moneyM: typeDesk.cellMoney,
  cell: typeDesk.cellMoney,
  body: typeDesk.body,
}
const COMPOSED: ReadonlySet<MoneySize> = new Set<MoneySize>(['hero', 'moneyL'])

export function Money({
  value,
  size = 'moneyM',
  tone = 'default',
  symbol = true,
  testID,
}: MoneyProps): React.JSX.Element {
  const theme = useTheme()
  const token = theme.density === 'desk' ? DESK_SIZE[size] : FIELD_SIZE[size]
  const toneColor: Record<MoneyTone, string> = {
    default: theme.colors.text.primary,
    positive: theme.colors.status.moss.fg,
    critical: theme.colors.status.brick.fg,
    secondary: theme.colors.text.secondary,
  }
  if (value === null) {
    return (
      <Txt
        field="moneyM"
        desk="cellMoney"
        testID={testID}
        color={theme.colors.text.secondary}
        style={typeStyle(token)}
      >
        {theme.t('money.none')}
      </Txt>
    )
  }
  const spoken = speakMoney(value, theme.t)
  if (!COMPOSED.has(size)) {
    return (
      <Txt
        field="moneyM"
        desk="cellMoney"
        testID={testID}
        numeric
        accessibilityLabel={spoken}
        color={toneColor[tone]}
        style={typeStyle(token)}
      >
        {formatMoney(value, { symbol })}
      </Txt>
    )
  }
  const parts = splitMoney(value)
  const smaller = {
    fontSize: Math.round(token.size * 0.72),
    fontWeight: token.weight === 700 ? ('600' as const) : ('500' as const),
    color: theme.colors.text.secondary,
  }
  return (
    <Txt
      field="hero"
      desk="kpi"
      testID={testID}
      numeric
      accessibilityLabel={spoken}
      color={toneColor[tone]}
      style={typeStyle(token)}
    >
      {parts.sign}
      {symbol ? (
        <Txt field="hero" desk="kpi" style={smaller}>
          {parts.symbol}
        </Txt>
      ) : null}
      {parts.integer}
      <Txt field="hero" desk="kpi" style={smaller}>
        {`.${parts.fraction}`}
      </Txt>
    </Txt>
  )
}

// ---------------------------------------------------------------------------
// 6.3 NumberPad — the full-screen pad (field.keypad digits, floor-height keys)
// ---------------------------------------------------------------------------

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const

export function NumberPad({
  label,
  value,
  onChange,
  onDone,
  mode = 'money',
  expected,
  expectedLabel,
  doneLabel,
  testID,
}: NumberPadProps): React.JSX.Element {
  const theme = useTheme()
  const keyHeight = Math.max(sizeTokens.floor, 64)
  const keyGap = theme.touch === 'floor' ? gap.warehouse : space[3]
  const digits = value === null ? '' : String(Math.abs(Math.trunc(value)))

  const press = (key: (typeof KEYS)[number]): void => {
    if (key === 'clear') return onChange(null)
    if (key === 'back') {
      const next = digits.slice(0, -1)
      return onChange(next === '' ? null : Number(next))
    }
    const next = `${digits}${key}`.replace(/^0+(?=\d)/, '')
    if (next.length > 12) return
    onChange(Number(next))
  }

  return (
    <View
      testID={testID}
      style={{ flex: 1, padding: space[4], backgroundColor: theme.colors.bg.surface }}
    >
      <Txt field="label" desk="label" color={theme.colors.text.secondary}>
        {label}
      </Txt>
      {/*
       * The expected amount sits ABOVE the pad and is never pre-filled into it (UX-01 D6) — and it
       * follows `mode`, exactly as `value` does. Drawn through `<Money>` in every mode, the van
       * check-in's "expected on the vehicle" printed **Rs 2.01 for 201 pieces**.
       */}
      {expected !== null && expected !== undefined ? (
        <View style={{ marginTop: space[2] }}>
          <Txt field="label" desk="label" color={theme.colors.text.secondary}>
            {expectedLabel ?? ''}
          </Txt>
          {mode === 'money' ? (
            <Money value={expected} size="moneyL" />
          ) : (
            <Txt field="moneyL" desk="kpi" numeric>
              {formatCount(expected)}
            </Txt>
          )}
        </View>
      ) : null}
      <Txt
        field="keypad"
        desk="kpi"
        numeric
        style={{ ...typeStyle(typeField.keypad), textAlign: 'right', marginVertical: space[4] }}
      >
        {mode === 'money' ? formatMoney(value ?? 0) : String(value ?? 0)}
      </Txt>
      {/*
       * THREE ROWS OF THREE, LAID OUT WITH FLEX — never `width: '30%'` inside a wrapping row.
       *
       * UX-00 §5.2: adjacent targets sit >= 19 dp apart, >= 25 dp on every warehouse screen. A pad
       * key is a target, and this pad is where the two BLIND counts of the product are typed. But
       * three 30% keys plus two 25 dp gaps is wider than the box, so a wrapping row silently drops
       * to TWO keys a line — measured on the Pixel 7: the gate count came out 1 2 / 3 4 / 5 6, a
       * dialler nobody has ever used. Percentage widths and a pixel gap cannot both be right; the
       * width is now whatever is left after the gaps.
       */}
      <View style={{ gap: keyGap }}>
        {[0, 3, 6, 9].map((from) => (
          <View key={from} style={{ flexDirection: 'row', gap: keyGap }}>
            {KEYS.slice(from, from + 3).map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={key}
                onPress={() => {
                  press(key)
                }}
                style={{
                  flex: 1,
                  height: keyHeight,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: theme.colors.border.strong,
                  backgroundColor: theme.colors.bg.surface,
                }}
              >
                <Txt field="title" desk="pageTitle" numeric>
                  {key === 'clear' ? theme.t('action.clear') : key === 'back' ? '⌫' : key}
                </Txt>
              </Pressable>
            ))}
          </View>
        ))}
      </View>
      <View style={{ marginTop: keyGap }}>
        <Button
          label={doneLabel ?? theme.t('action.done')}
          variant="primary"
          size="floor"
          onPress={onDone}
        />
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// 6.3 RupeeInput — a pad on a field app, a decimal field on a desk one
// ---------------------------------------------------------------------------

export function RupeeInput({
  label,
  value,
  onChange,
  placeholder,
  helper,
  error,
  disabled,
  bound,
  boundMessage,
  expected,
  expectedLabel,
  size,
  autoFocus,
  testID,
}: RupeeInputProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const bodyStyle = useTypeStyle('moneyM', 'body')
  const [padOpen, setPadOpen] = useState(false)
  const [text, setText] = useState(() => toEditableRupees(value))
  useEffect(() => {
    setText(toEditableRupees(value))
  }, [value])

  const overBound =
    bound !== null && bound !== undefined && value !== null && value > bound ? boundMessage : null
  const message = error ?? overBound ?? helper
  const messageColor = error
    ? theme.colors.status.brick.fg
    : overBound
      ? theme.colors.status.ochre.fg
      : theme.colors.text.secondary

  const frame = {
    height,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: error ? theme.colors.status.brick.edge : theme.colors.border.strong,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.bg.surface,
    paddingHorizontal: space[3],
  }

  return (
    <View style={{ width: '100%' }}>
      <Txt
        field="label"
        desk="label"
        color={theme.colors.text.secondary}
        style={{ marginBottom: space[1] }}
      >
        {label}
      </Txt>
      {theme.density === 'field' ? (
        <Pressable
          testID={testID}
          disabled={disabled === true}
          onPress={() => {
            setPadOpen(true)
          }}
          style={frame}
        >
          <Money value={value} size="moneyM" />
        </Pressable>
      ) : (
        <View style={frame}>
          <Txt field="moneyM" desk="body" color={theme.colors.text.secondary}>
            {theme.t('money.rupeeSymbol')}
          </Txt>
          <RNTextInput
            testID={testID}
            value={text}
            editable={disabled !== true}
            autoFocus={autoFocus}
            keyboardType="decimal-pad"
            placeholder={placeholder ?? '0.00'}
            placeholderTextColor={theme.colors.text.secondary}
            onChangeText={(next) => {
              setText(next)
              const result = parseRupees(next)
              if (result.ok) onChange(result.paise)
              else if (result.reason === 'empty') onChange(null)
            }}
            onBlur={() => {
              const result = parseRupees(text)
              setText(result.ok ? toEditableRupees(result.paise) : toEditableRupees(value))
            }}
            style={[
              bodyStyle,
              { flex: 1, textAlign: 'right', color: theme.colors.text.primary, height: '100%' },
            ]}
          />
        </View>
      )}
      <View style={{ minHeight: 18, marginTop: space[1] }}>
        {message ? (
          <Txt field="label" desk="meta" color={messageColor}>
            {message}
          </Txt>
        ) : null}
      </View>
      <Modal
        visible={padOpen}
        animationType="slide"
        onRequestClose={() => {
          setPadOpen(false)
        }}
      >
        <NumberPad
          label={label}
          value={value}
          onChange={onChange}
          mode="money"
          expected={expected ?? null}
          expectedLabel={expectedLabel}
          onDone={() => {
            setPadOpen(false)
          }}
        />
      </Modal>
    </View>
  )
}

// ---------------------------------------------------------------------------
// 6.4 QtyStepper
// ---------------------------------------------------------------------------

export function QtyStepper({
  pieces,
  caseSize,
  onChange,
  availablePieces,
  blocked,
  blockedReason,
  disabled,
  schemeLabel,
  size,
  onOpenPieces,
  testID,
}: QtyStepperProps): React.JSX.Element {
  const theme = useTheme()
  const touch = size ?? theme.touch
  const height = sizeTokens[touch]
  const controlGap = touch === 'floor' ? gap.warehouse : space[3]
  const state = qtyState({
    pieces,
    availablePieces: availablePieces ?? null,
    blocked: blocked === true,
    disabled: disabled === true,
  })
  const q = splitQty(pieces, caseSize)
  const inactive = state === 'disabled'

  const stepper = (
    direction: 1 | -1,
    glyph: string,
    label: string,
    off: boolean,
  ): React.JSX.Element => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={off}
      onPress={() => {
        onChange(stepByCase(pieces, direction, caseSize))
      }}
      style={{
        width: height,
        height,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: direction === -1 ? theme.colors.border.strong : 'transparent',
        backgroundColor: direction === -1 ? theme.colors.bg.surface : theme.colors.accent.solid,
        opacity: off ? 0.999 : 1,
      }}
    >
      <Txt
        field="title"
        desk="pageTitle"
        color={
          off
            ? theme.colors.text.disabled
            : direction === -1
              ? theme.colors.text.primary
              : theme.colors.text.onAccent
        }
      >
        {glyph}
      </Txt>
    </Pressable>
  )

  return (
    <View testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: controlGap }}>
        {stepper(-1, '−', theme.t('qty.decrease'), inactive || pieces <= 0)}
        <Txt field="moneyM" desk="cellMoney" numeric style={{ minWidth: 72, textAlign: 'center' }}>
          {`${q.cases} ${theme.t('qty.case')}`}
        </Txt>
        {stepper(1, '+', theme.t('qty.increase'), inactive)}
        {onOpenPieces ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenPieces}
            style={{
              height,
              justifyContent: 'center',
              paddingHorizontal: space[3],
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: theme.colors.border.strong,
              backgroundColor: theme.colors.bg.surface,
            }}
          >
            <Txt field="bodyStrong" desk="label">
              {theme.t('qty.pieces')}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {/* The case line is a FIGURE: moneyM, never label size. */}
      <Txt field="moneyM" desk="cellMoney" numeric style={{ marginTop: space[1] }}>
        {state === 'atZero'
          ? theme.t('qty.notOrdered')
          : caseLine(pieces, caseSize, theme.t) +
            (availablePieces === null || availablePieces === undefined
              ? ''
              : ` · ${availableLine(availablePieces, caseSize, theme.t)}`)}
      </Txt>
      {state === 'overAvailable' && availablePieces !== null && availablePieces !== undefined ? (
        <Txt field="moneyM" desk="cellMoney" numeric color={theme.colors.status.ochre.fg}>
          {theme.t('qty.onlyAvailable', { cases: splitQty(availablePieces, caseSize).cases })}
        </Txt>
      ) : null}
      {state === 'blocked' && blockedReason ? (
        <Txt field="body" desk="body" color={theme.colors.status.brick.fg}>
          {blockedReason}
        </Txt>
      ) : null}
      {schemeLabel ? (
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: space[2],
            height: 28,
            justifyContent: 'center',
            paddingHorizontal: space[2],
            borderRadius: radius.xs,
            backgroundColor: theme.colors.accent.tint,
          }}
        >
          <Txt field="moneyM" desk="cellMoney" numeric color={theme.colors.accent.fg}>
            {schemeLabel}
          </Txt>
        </View>
      ) : null}
    </View>
  )
}
