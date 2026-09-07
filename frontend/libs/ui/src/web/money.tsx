/**
 * UX-00 sections 6.3 and 6.4 for React DOM: `<Money>`, `<RupeeInput>`, `<QtyStepper>`.
 *
 * Integer paise in, integer paise out; integer pieces in, integer pieces out. No float crosses this
 * boundary and no component here does arithmetic on a formatted string.
 */
import { useEffect, useRef, useState } from 'react'

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

/** Hero money is composed; column money is uniform (UX-00 section 4.5 rule 4). */
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
      <span
        data-testid={testID}
        className="dos-num"
        style={{ ...typeStyle(token), color: theme.colors.text.secondary }}
      >
        {theme.t('money.none')}
      </span>
    )
  }
  const spoken = speakMoney(value, theme.t)
  if (!COMPOSED.has(size)) {
    return (
      <span
        data-testid={testID}
        className="dos-num"
        aria-label={spoken}
        style={{ ...typeStyle(token), color: toneColor[tone] }}
      >
        {formatMoney(value, { symbol })}
      </span>
    )
  }
  const parts = splitMoney(value)
  const smaller = {
    fontSize: Math.round(token.size * 0.72),
    fontWeight: token.weight === 700 ? 600 : 500,
    color: theme.colors.text.secondary,
  }
  return (
    <span
      data-testid={testID}
      className="dos-num"
      aria-label={spoken}
      style={{ ...typeStyle(token), color: toneColor[tone], whiteSpace: 'nowrap' }}
    >
      {parts.sign}
      {symbol ? <span style={smaller}>{parts.symbol}</span> : null}
      {parts.integer}
      <span style={smaller}>.{parts.fraction}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// 6.3 RupeeInput — a fixed visible ₹ prefix, format on blur, paise out
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
  const [text, setText] = useState(() => toEditableRupees(value))
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // A value changed from outside (a quote, a re-price) while the field is not being typed in.
  useEffect(() => {
    if (!focused) setText(toEditableRupees(value))
  }, [value, focused])

  const parsed = parseRupees(text)
  const invalid = text.trim() !== '' && !parsed.ok && parsed.reason === 'unparseable'
  // No silent clamping: over the bound the value is ACCEPTED and the screen says what happens.
  const overBound =
    bound !== null && bound !== undefined && parsed.ok && parsed.paise > bound ? boundMessage : null

  return (
    <div style={{ width: '100%' }}>
      <Txt
        field="label"
        desk="label"
        as="label"
        color={theme.colors.text.secondary}
        style={{ display: 'block', marginBottom: space[1] }}
      >
        {label}
      </Txt>
      {/* Cash collection prints the expected amount ABOVE the field and never pre-fills it. */}
      {expected !== null && expected !== undefined ? (
        <div style={{ marginBottom: space[2] }}>
          <Txt field="label" desk="label" as="div" color={theme.colors.text.secondary}>
            {expectedLabel ?? ''}
          </Txt>
          <Money value={expected} size="moneyL" />
        </div>
      ) : null}
      {/*
        THE WHOLE CONTROL IS THE TOUCH TARGET, not just the input inside it. The wrapper is the app's
        touch floor (69 / 76 dp); the `<input>` sits inside its 1 px border, so measured on a phone
        it is 67 dp and a thumb landing on the top or bottom edge of a money field focused nothing.
        The rupee sign is part of the field to a driver, so it is part of the field to the browser.
      */}
      <div
        onMouseDown={(event) => {
          if (
            event.target === event.currentTarget ||
            (event.target as HTMLElement).tagName === 'SPAN'
          ) {
            event.preventDefault()
            inputRef.current?.focus()
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          height,
          border: `1px solid ${invalid || error ? theme.colors.status.brick.edge : theme.colors.border.strong}`,
          borderRadius: radius.sm,
          background: theme.colors.bg.surface,
          paddingLeft: space[3],
        }}
      >
        <span className="dos-num" style={{ ...bodyStyle, color: theme.colors.text.secondary }}>
          {theme.t('money.rupeeSymbol')}
        </span>
        <input
          ref={inputRef}
          data-testid={testID}
          className="dos-num"
          type="text"
          inputMode="decimal"
          disabled={disabled === true}
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder ?? '0.00'}
          aria-invalid={invalid || error !== undefined}
          onFocus={() => {
            setFocused(true)
          }}
          onChange={(e) => {
            const next = e.currentTarget.value
            setText(next)
            const result = parseRupees(next)
            if (result.ok) onChange(result.paise)
            else if (result.reason === 'empty') onChange(null)
          }}
          onBlur={() => {
            setFocused(false)
            const result = parseRupees(text)
            // Format on blur; an unparseable value keeps the last committed paise, never a guess.
            setText(result.ok ? toEditableRupees(result.paise) : toEditableRupees(value))
          }}
          style={{
            flex: 1,
            height: '100%',
            border: 0,
            outline: 'none',
            background: 'transparent',
            textAlign: 'right',
            paddingRight: space[3],
            color: disabled === true ? theme.colors.text.disabled : theme.colors.text.primary,
            fontFamily: 'inherit',
            ...bodyStyle,
          }}
        />
      </div>
      <div style={{ minHeight: 18, marginTop: space[1] }}>
        {error || overBound || helper ? (
          <Txt
            field="label"
            desk="meta"
            color={
              error
                ? theme.colors.status.brick.fg
                : overBound
                  ? theme.colors.status.ochre.fg
                  : theme.colors.text.secondary
            }
          >
            {error ?? overBound ?? helper}
          </Txt>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.3 NumberPad — the same pad the field apps open, for phone-width web surfaces
// ---------------------------------------------------------------------------

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'] as const

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
  /*
   * UX-00 §5.2: adjacent targets sit ≥ 19 dp apart, ≥ 25 dp on every warehouse screen. A pad key is
   * a target and a mis-tap here is a wrong figure written into a BLIND count — the gate count and
   * the load-sheet carton count are the two screens in this product where nothing else on screen
   * can contradict what the hand typed. Measured at 375 × 812 before this: 12 px.
   */
  const keyGap = theme.touch === 'floor' ? gap.warehouse : space[3]
  const digits = value === null ? '' : String(Math.abs(Math.trunc(value)))
  const press = (key: (typeof PAD_KEYS)[number]): void => {
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
    <div data-testid={testID} style={{ padding: space[4], background: theme.colors.bg.surface }}>
      <Txt field="label" desk="label" as="div" color={theme.colors.text.secondary}>
        {label}
      </Txt>
      {/*
       * `expected` follows `mode`, exactly as `value` does (NumberPadProps: "integer paise in
       * `money` mode, an integer count in `count` mode"). It was always drawn through `<Money>`, so
       * the van check-in's "expected on the vehicle" printed **₹2.01 for 201 pieces**.
       */}
      {expected !== null && expected !== undefined ? (
        <div style={{ marginTop: space[2] }}>
          <Txt field="label" desk="label" as="div" color={theme.colors.text.secondary}>
            {expectedLabel ?? ''}
          </Txt>
          {mode === 'money' ? (
            <Money value={expected} size="moneyL" />
          ) : (
            <Txt field="moneyL" desk="kpi" as="div" numeric>
              {formatCount(expected)}
            </Txt>
          )}
        </div>
      ) : null}
      <div
        className="dos-num"
        style={{ ...typeStyle(typeField.keypad), textAlign: 'right', margin: `${space[4]}px 0` }}
      >
        {mode === 'money' ? formatMoney(value ?? 0) : String(value ?? 0)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: keyGap }}>
        {PAD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            aria-label={key}
            onClick={() => {
              press(key)
            }}
            style={{
              height: keyHeight,
              borderRadius: radius.sm,
              border: `1px solid ${theme.colors.border.strong}`,
              background: theme.colors.bg.surface,
              color: theme.colors.text.primary,
              fontFamily: 'inherit',
              fontSize: 24,
              cursor: 'pointer',
            }}
          >
            {key === 'clear' ? theme.t('action.clear') : key === 'back' ? '⌫' : key}
          </button>
        ))}
      </div>
      {/*
       * The kit's own <Button>, not a hand-rolled one.
       *
       * This was a raw `<button className="dos-btn">` with no font size, so it fell through to the
       * browser's UA default — measured 13.3333 px on "Damaged pieces" (gate count) and "Done"
       * (load-sheet carton count), under the 14 px floor of UX-00 §4.3 and nowhere near the 16 sp
       * `field.bodyStrong` its native twin has always used. One contract, two renderers, two
       * different type sizes on the same button.
       */}
      <div style={{ marginTop: keyGap }}>
        <Button
          label={doneLabel ?? theme.t('action.done')}
          variant="primary"
          size="floor"
          fullWidth
          onPress={onDone}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.4 QtyStepper — the most-used control
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
  const controlGap = touch === 'floor' ? space[6] : space[3]
  const valueStyle = useTypeStyle('moneyM', 'cellMoney')
  const state = qtyState({
    pieces,
    availablePieces: availablePieces ?? null,
    blocked: blocked === true,
    disabled: disabled === true,
  })
  const q = splitQty(pieces, caseSize)
  const inactive = state === 'disabled'

  const stepperButton = (
    direction: 1 | -1,
    glyph: string,
    label: string,
    off: boolean,
  ): React.JSX.Element => (
    <button
      type="button"
      aria-label={label}
      disabled={off}
      onClick={() => {
        onChange(stepByCase(pieces, direction, caseSize))
      }}
      style={{
        width: height,
        height,
        borderRadius: radius.sm,
        cursor: off ? 'not-allowed' : 'pointer',
        border:
          direction === -1 ? `1px solid ${theme.colors.border.strong}` : '1px solid transparent',
        background: direction === -1 ? theme.colors.bg.surface : theme.colors.accent.solid,
        color: direction === -1 ? theme.colors.text.primary : theme.colors.text.onAccent,
        fontSize: 24,
        lineHeight: 1,
        fontFamily: 'inherit',
      }}
    >
      {glyph}
    </button>
  )

  return (
    <div data-testid={testID}>
      <div style={{ display: 'flex', alignItems: 'center', gap: controlGap }}>
        {stepperButton(-1, '−', theme.t('qty.decrease'), inactive || pieces <= 0)}
        <span
          className="dos-num"
          aria-live="polite"
          style={{ minWidth: 64, textAlign: 'center', ...valueStyle }}
        >
          {q.cases}
          <span style={{ color: theme.colors.text.secondary }}> {theme.t('qty.case')}</span>
        </span>
        {stepperButton(1, '+', theme.t('qty.increase'), inactive)}
        {onOpenPieces ? (
          <button
            type="button"
            onClick={onOpenPieces}
            style={{
              height,
              minHeight: height,
              padding: `0 ${space[3]}px`,
              borderRadius: radius.sm,
              border: `1px solid ${theme.colors.border.strong}`,
              background: theme.colors.bg.surface,
              color: theme.colors.text.primary,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {theme.t('qty.pieces')}
          </button>
        ) : null}
      </div>
      {/* The case line is a FIGURE: moneyM, never label size (UX-00 4.2). */}
      <Txt field="moneyM" desk="cellMoney" as="div" style={{ marginTop: space[1] }} numeric>
        {state === 'atZero'
          ? theme.t('qty.notOrdered')
          : caseLine(pieces, caseSize, theme.t) +
            (availablePieces === null || availablePieces === undefined
              ? ''
              : ` · ${availableLine(availablePieces, caseSize, theme.t)}`)}
      </Txt>
      {state === 'overAvailable' && availablePieces !== null && availablePieces !== undefined ? (
        <Txt field="moneyM" desk="cellMoney" as="div" color={theme.colors.status.ochre.fg} numeric>
          {theme.t('qty.onlyAvailable', { cases: splitQty(availablePieces, caseSize).cases })}
        </Txt>
      ) : null}
      {state === 'blocked' && blockedReason ? (
        <Txt field="body" desk="body" as="div" color={theme.colors.status.brick.fg}>
          {blockedReason}
        </Txt>
      ) : null}
      {schemeLabel ? (
        <span
          className="dos-num"
          style={{
            display: 'inline-block',
            marginTop: space[2],
            height: 28,
            lineHeight: '28px',
            padding: `0 ${space[2]}px`,
            borderRadius: radius.xs,
            background: theme.colors.accent.tint,
            color: theme.colors.accent.fg,
            ...typeStyle(typeField.moneyM),
          }}
        >
          {schemeLabel}
        </span>
      ) : null}
    </div>
  )
}
