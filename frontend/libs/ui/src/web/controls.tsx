/**
 * UX-00 sections 6.1, 6.2, 6.5 and 6.10 for React DOM: Button, TextInput, Search, Tabs, Chips, Segments.
 */
import { useId, useState } from 'react'

import { useTheme } from '../theme.js'
import { gap, radius, size as sizeTokens, space } from '../tokens.js'
import type {
  ButtonProps,
  ChipsProps,
  SearchProps,
  SegmentsProps,
  TabsProps,
  TextInputProps,
} from '../types.js'
import { Spinner, Txt, useTypeStyle } from './base.js'

// ---------------------------------------------------------------------------
// 6.1 Button
// ---------------------------------------------------------------------------

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size,
  icon,
  shortcut,
  disabled = false,
  disabledReason,
  loading = false,
  successLabel,
  fullWidth,
  testID,
}: ButtonProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const isDesk = (size ?? theme.touch) === 'desk'
  const labelStyle = useTypeStyle('bodyStrong', 'label')
  const shown = successLabel ?? label
  return (
    <div style={{ width: (fullWidth ?? !isDesk) ? '100%' : undefined }}>
      <button
        type="button"
        data-testid={testID}
        className={`dos-btn dos-btn-${variant}`}
        disabled={disabled || loading}
        aria-disabled={disabled || loading}
        aria-busy={loading}
        onClick={() => {
          if (!disabled && !loading) onPress()
        }}
        style={{
          height,
          minHeight: height,
          width: (fullWidth ?? !isDesk) ? '100%' : undefined,
          borderRadius: radius.md,
          ...labelStyle,
        }}
      >
        {loading ? <Spinner size={16} color="currentColor" /> : icon}
        <span>{shown}</span>
        {shortcut ? <span className="dos-btn-shortcut">{shortcut}</span> : null}
      </button>
      {disabled && disabledReason ? <div className="dos-btn-reason">{disabledReason}</div> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.2 TextInput
// ---------------------------------------------------------------------------

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  helper,
  error,
  state,
  size,
  autoFocus,
  maxLength,
  secure,
  keyboard = 'text',
  capitalize = 'none',
  onSubmit,
  testID,
}: TextInputProps): React.JSX.Element {
  const theme = useTheme()
  const id = useId()
  const height = sizeTokens[size ?? theme.touch]
  const resolved = error ? 'error' : (state ?? 'default')
  const bodyStyle = useTypeStyle('body', 'body')
  const inputMode = keyboard === 'text' ? undefined : keyboard === 'phone' ? 'tel' : keyboard
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
      <input
        id={id}
        data-testid={testID}
        className="dos-input"
        data-state={resolved}
        type={secure ? 'password' : 'text'}
        inputMode={inputMode}
        // The same build is the website on that phone (docs/08 §0), and a mobile browser
        // auto-capitalises and spell-corrects a text input exactly the way iOS does.
        autoCapitalize={capitalize}
        autoCorrect="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        readOnly={resolved === 'readonly'}
        disabled={resolved === 'disabled'}
        aria-invalid={resolved === 'error'}
        aria-errormessage={error ? `${id}-msg` : undefined}
        onChange={(e) => {
          onChange(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) onSubmit()
        }}
        style={{ height, minHeight: height, ...bodyStyle }}
      />
      {/* Helper height is reserved so a validation message never moves the layout. */}
      <div id={`${id}-msg`} style={{ minHeight: 18, marginTop: space[1] }}>
        {error || helper ? (
          <Txt
            field="label"
            desk="meta"
            color={error ? theme.colors.status.brick.fg : theme.colors.text.secondary}
          >
            {error ?? helper}
          </Txt>
        ) : null}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.5 Search
// ---------------------------------------------------------------------------

export function Search({
  value,
  onChange,
  placeholder,
  state = 'idle',
  children,
  onAddNew,
  staleLabel,
  size,
  autoFocus,
  testID,
}: SearchProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const bodyStyle = useTypeStyle('body', 'body')
  const t = theme.t
  return (
    <div style={{ width: '100%' }}>
      <input
        data-testid={testID}
        className="dos-input"
        type="search"
        role="searchbox"
        aria-label={placeholder ?? t('search.placeholder')}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder ?? t('search.placeholder')}
        onChange={(e) => {
          onChange(e.currentTarget.value)
        }}
        style={{ height, minHeight: height, ...bodyStyle }}
      />
      {staleLabel ? (
        <Txt
          field="label"
          desk="meta"
          color={theme.colors.status.ochre.fg}
          as="div"
          style={{ marginTop: space[1] }}
        >
          {t('search.stale', { when: staleLabel })}
        </Txt>
      ) : null}
      {/* Results sit UNDER the field, never in an overlay (UX-00 6.5). */}
      <div style={{ marginTop: space[2] }}>
        {state === 'noResults' ? (
          <div>
            <Txt field="body" desk="body" color={theme.colors.text.secondary} as="div">
              {t('search.noResults', { query: value })}
            </Txt>
            {onAddNew ? (
              <div style={{ marginTop: space[2] }}>
                <Button label={t('search.addNew')} variant="secondary" onPress={onAddNew} />
              </div>
            ) : null}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 6.10 Tabs, Chips, Segments
// ---------------------------------------------------------------------------

export function Tabs({ items, value, onChange, testID }: TabsProps): React.JSX.Element {
  const theme = useTheme()
  const height = Math.max(sizeTokens[theme.touch], 40)
  const labelStyle = useTypeStyle('bodyStrong', 'nav')
  return (
    <div
      role="tablist"
      data-testid={testID}
      style={{
        display: 'flex',
        borderBottom: `1px solid ${theme.colors.border.hairline}`,
        background: theme.colors.bg.surface,
      }}
    >
      {items.slice(0, 4).map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => {
              onChange(item.id)
            }}
            style={{
              height,
              padding: `0 ${space[4]}px`,
              background: 'transparent',
              border: 0,
              borderBottom: `3px solid ${active ? theme.colors.accent.line : 'transparent'}`,
              color: active ? theme.colors.accent.fg : theme.colors.text.secondary,
              fontFamily: 'inherit',
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              ...labelStyle,
            }}
          >
            {item.label}
            {item.count === undefined ? null : (
              <span className="dos-num" style={{ marginLeft: 6 }}>
                {item.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Chips({ items, onToggle, size, onClear, testID }: ChipsProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const labelStyle = useTypeStyle('bodyStrong', 'label')
  const selected = items.filter((i) => i.selected).length
  return (
    <div
      data-testid={testID}
      style={{ display: 'flex', flexWrap: 'wrap', gap: gap.adjacent / 2, alignItems: 'center' }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={item.selected === true}
          onClick={() => {
            onToggle(item.id)
          }}
          style={{
            height,
            minHeight: height,
            padding: `0 ${space[3]}px`,
            borderRadius: radius.sm,
            border: `1px solid ${item.selected ? theme.colors.accent.fg : theme.colors.border.strong}`,
            background: item.selected ? theme.colors.accent.tint : theme.colors.bg.surface,
            color: item.selected ? theme.colors.accent.fg : theme.colors.text.primary,
            fontFamily: 'inherit',
            cursor: 'pointer',
            ...labelStyle,
          }}
        >
          {item.selected ? '✓ ' : ''}
          {item.label}
        </button>
      ))}
      {/* A filter row never leaves the screen without its summary and a one-tap clear. */}
      {selected > 0 && onClear ? (
        <Button
          label={`${theme.t('register.filters', { count: selected })} · ${theme.t('register.clearFilters')}`}
          variant="ghost"
          size={size ?? theme.touch}
          onPress={onClear}
        />
      ) : null}
    </div>
  )
}

export function Segments({
  items,
  value,
  onChange,
  size,
  testID,
}: SegmentsProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const labelStyle = useTypeStyle('bodyStrong', 'label')
  return (
    <div
      role="radiogroup"
      data-testid={testID}
      style={{
        display: 'inline-flex',
        background: theme.colors.bg.sunken,
        borderRadius: radius.sm,
        padding: 2,
        gap: 2,
      }}
    >
      {items.slice(0, 3).map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              onChange(item.id)
            }}
            style={{
              height: height - 4,
              minHeight: height - 4,
              padding: `0 ${space[4]}px`,
              borderRadius: radius.sm - 2,
              border: active ? `1px solid ${theme.colors.border.faint}` : '1px solid transparent',
              background: active ? theme.colors.bg.surface : 'transparent',
              color: active ? theme.colors.text.primary : theme.colors.text.secondary,
              fontFamily: 'inherit',
              cursor: 'pointer',
              ...labelStyle,
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** Local state helper for a controlled `<Search>` that keeps its own text. */
export function useSearchState(initial = ''): {
  value: string
  onChange: (v: string) => void
} {
  const [value, onChange] = useState(initial)
  return { value, onChange }
}
