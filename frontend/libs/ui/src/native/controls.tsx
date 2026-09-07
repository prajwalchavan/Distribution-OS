/**
 * UX-00 sections 6.1, 6.2, 6.5 and 6.10 for React Native: Button, TextInput, Search, Tabs, Chips, Segments.
 * Same names, same props and same states as `@dos/ui/web`.
 */
import { useState } from 'react'
import { Pressable, ScrollView, TextInput as RNTextInput, View, type ViewStyle } from 'react-native'

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
  disabled = false,
  disabledReason,
  loading = false,
  successLabel,
  fullWidth = true,
  testID,
}: ButtonProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const off = disabled || loading
  const labelStyle = useTypeStyle('bodyStrong', 'label')

  const fills: Record<string, ViewStyle> = {
    primary: { backgroundColor: theme.colors.accent.solid, borderColor: 'transparent' },
    secondary: {
      backgroundColor: theme.colors.bg.surface,
      borderColor: theme.colors.border.strong,
    },
    ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
    destructive: {
      backgroundColor: theme.colors.bg.surface,
      borderColor: theme.colors.status.brick.edge,
    },
  }
  const labelColors: Record<string, string> = {
    primary: theme.colors.text.onAccent,
    secondary: theme.colors.text.primary,
    ghost: theme.colors.accent.fg,
    destructive: theme.colors.status.brick.fg,
  }
  // A disabled control is never greyed: surface fill, strong outline, 8.35:1 label, reason beneath.
  const fill: ViewStyle = off
    ? { backgroundColor: theme.colors.bg.surface, borderColor: theme.colors.border.strong }
    : (fills[variant] ?? fills['secondary'] ?? {})
  const labelColor = off ? theme.colors.text.disabled : (labelColors[variant] ?? '')

  return (
    /*
     * `flexShrink: 1` is the whole of web/native parity for a row of buttons.
     *
     * The web half is a `<div style={{width:'100%'}}>`, and a CSS flex item shrinks by default, so
     * `<Row gap={3}><Button/><Button/></Row>` gives each half the row. React Native's default is
     * `flexShrink: 0`, so the same two children measured 200% of the row and the second one was
     * clipped off the screen — proved on the iPhone 16 Pro: the fulfilment queue's "Select all"
     * was cut mid-word at the right edge and "Clear" could not be reached at all, while the web at
     * 375 px drew both. `minWidth: 0` lets the label ellipsise rather than force the row wider.
     */
    <View style={fullWidth ? { width: '100%', flexShrink: 1, minWidth: 0 } : undefined}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: loading }}
        disabled={off}
        onPress={onPress}
        style={({ pressed }) => [
          {
            height,
            minHeight: height,
            borderRadius: radius.md,
            borderWidth: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space[2],
            paddingHorizontal: space[4],
            transform: [{ scale: pressed && !off ? 0.98 : 1 }],
          },
          fill,
          pressed && !off && variant === 'primary'
            ? { backgroundColor: theme.colors.accent.pressed }
            : null,
        ]}
      >
        {loading ? <Spinner size={16} color={labelColor} /> : icon}
        <Txt field="bodyStrong" desk="label" color={labelColor} style={labelStyle}>
          {successLabel ?? label}
        </Txt>
      </Pressable>
      {disabled && disabledReason ? (
        <Txt
          field="label"
          desk="meta"
          color={theme.colors.text.secondary}
          style={{ marginTop: space[1] }}
        >
          {disabledReason}
        </Txt>
      ) : null}
    </View>
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
  const height = sizeTokens[size ?? theme.touch]
  const resolved = error ? 'error' : (state ?? 'default')
  const bodyStyle = useTypeStyle('body', 'body')
  const keyboardType =
    keyboard === 'decimal'
      ? 'decimal-pad'
      : keyboard === 'phone'
        ? 'phone-pad'
        : keyboard === 'email'
          ? 'email-address'
          : 'default'
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
      <RNTextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.secondary}
        maxLength={maxLength}
        autoFocus={autoFocus}
        editable={resolved !== 'disabled' && resolved !== 'readonly'}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        // A username, a GSTIN or an invoice number is not a sentence: iOS capitalises and corrects
        // a text field unless it is told not to, and both silently corrupt an identifier.
        autoCapitalize={capitalize === 'none' ? 'none' : capitalize}
        autoCorrect={false}
        spellCheck={false}
        onSubmitEditing={onSubmit}
        style={[
          bodyStyle,
          {
            height,
            minHeight: height,
            borderWidth: 1,
            borderStyle: resolved === 'disabled' ? 'dashed' : 'solid',
            borderColor:
              resolved === 'error' ? theme.colors.status.brick.edge : theme.colors.border.strong,
            borderRadius: radius.sm,
            paddingHorizontal: space[3],
            backgroundColor: theme.colors.bg.surface,
            color: resolved === 'disabled' ? theme.colors.text.disabled : theme.colors.text.primary,
          },
        ]}
      />
      {/* Helper height is reserved so a validation message never moves the layout. */}
      <View style={{ minHeight: 18, marginTop: space[1] }}>
        {error || helper ? (
          <Txt
            field="label"
            desk="meta"
            color={error ? theme.colors.status.brick.fg : theme.colors.text.secondary}
          >
            {error ?? helper ?? ''}
          </Txt>
        ) : null}
      </View>
    </View>
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
  return (
    <View style={{ width: '100%' }}>
      <RNTextInput
        testID={testID}
        value={value}
        onChangeText={onChange}
        autoFocus={autoFocus}
        placeholder={placeholder ?? theme.t('search.placeholder')}
        placeholderTextColor={theme.colors.text.secondary}
        accessibilityRole="search"
        style={[
          bodyStyle,
          {
            height,
            minHeight: height,
            borderWidth: 1,
            borderColor: theme.colors.border.strong,
            borderRadius: radius.sm,
            paddingHorizontal: space[3],
            backgroundColor: theme.colors.bg.surface,
            color: theme.colors.text.primary,
          },
        ]}
      />
      {staleLabel ? (
        <Txt
          field="label"
          desk="meta"
          color={theme.colors.status.ochre.fg}
          style={{ marginTop: space[1] }}
        >
          {theme.t('search.stale', { when: staleLabel })}
        </Txt>
      ) : null}
      {/* Results sit UNDER the field, never in an overlay. */}
      <View style={{ marginTop: space[2] }}>
        {state === 'noResults' ? (
          <View>
            <Txt field="body" desk="body" color={theme.colors.text.secondary}>
              {theme.t('search.noResults', { query: value })}
            </Txt>
            {onAddNew ? (
              <View style={{ marginTop: space[2] }}>
                <Button label={theme.t('search.addNew')} variant="secondary" onPress={onAddNew} />
              </View>
            ) : null}
          </View>
        ) : (
          children
        )}
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// 6.10 Tabs, Chips, Segments
// ---------------------------------------------------------------------------

export function Tabs({ items, value, onChange, testID }: TabsProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[theme.touch]
  const phone = theme.density !== 'desk'
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bg.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.hairline,
        /*
         * The same sentence the web half carries, and it matters MORE here: the tab strip sits in the
         * screen header's wrapping chip row, and a row-wrap parent sizes a child to its content — but
         * these children are `flex: 1` with no intrinsic width, so on a phone the whole level-2 tab
         * row collapsed to nothing and left a 63 dp empty band where "Today · Approvals · Live map"
         * should be. A tab row is a full-width control; a DOM `<div>` is that for free.
         */
        ...(phone ? { width: '100%' } : {}),
      }}
    >
      {items.slice(0, 4).map((item) => {
        const active = item.id === value
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              onChange(item.id)
            }}
            style={{
              height,
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderBottomWidth: 3,
              borderBottomColor: active ? theme.colors.accent.line : 'transparent',
            }}
          >
            <Txt
              field="bodyStrong"
              desk="nav"
              numberOfLines={1}
              color={active ? theme.colors.accent.fg : theme.colors.text.secondary}
            >
              {item.count === undefined ? item.label : `${item.label} ${item.count}`}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Chips({ items, onToggle, size, onClear, testID }: ChipsProps): React.JSX.Element {
  const theme = useTheme()
  const height = sizeTokens[size ?? theme.touch]
  const spacing = theme.touch === 'floor' ? gap.warehouse : gap.adjacent
  const selected = items.filter((i) => i.selected).length
  return (
    <ScrollView
      testID={testID}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ flexDirection: 'row', gap: spacing, alignItems: 'center' }}
    >
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ selected: item.selected === true }}
          onPress={() => {
            onToggle(item.id)
          }}
          style={{
            height,
            minHeight: height,
            justifyContent: 'center',
            paddingHorizontal: space[3],
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: item.selected ? theme.colors.accent.fg : theme.colors.border.strong,
            backgroundColor: item.selected ? theme.colors.accent.tint : theme.colors.bg.surface,
          }}
        >
          <Txt
            field="bodyStrong"
            desk="label"
            color={item.selected ? theme.colors.accent.fg : theme.colors.text.primary}
          >
            {item.selected ? `✓ ${item.label}` : item.label}
          </Txt>
        </Pressable>
      ))}
      {selected > 0 && onClear ? (
        <Pressable onPress={onClear} style={{ height, justifyContent: 'center' }}>
          <Txt field="bodyStrong" desk="label" color={theme.colors.accent.fg}>
            {`${theme.t('register.filters', { count: selected })} · ${theme.t('register.clearFilters')}`}
          </Txt>
        </Pressable>
      ) : null}
    </ScrollView>
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
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        backgroundColor: theme.colors.bg.sunken,
        borderRadius: radius.sm,
        padding: 2,
        gap: 2,
      }}
    >
      {items.slice(0, 3).map((item) => {
        const active = item.id === value
        return (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => {
              onChange(item.id)
            }}
            /*
             * Sized by its own label, exactly as the web half is (`padding: 0 space[4]`), NOT `flex: 1`.
             * A segmented control normally sits in the screen header's wrapping action row, which
             * shrinks a flex item to its content: with `flex: 1` and nothing to divide, all three
             * segments collapsed and "7 days · 30 days · 90 days" rendered as an empty 2 px pill on
             * every phone.
             */
            /* The segment IS the touch floor, not the pill around it — see the web half. */
            style={{
              height,
              minHeight: height,
              paddingHorizontal: space[4],
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.sm - 2,
              borderWidth: 1,
              borderColor: active ? theme.colors.border.faint : 'transparent',
              backgroundColor: active ? theme.colors.bg.surface : 'transparent',
            }}
          >
            <Txt
              field="bodyStrong"
              desk="label"
              color={active ? theme.colors.text.primary : theme.colors.text.secondary}
            >
              {item.label}
            </Txt>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Local state helper for a controlled `<Search>`, identical to the web export. */
export function useSearchState(initial = ''): {
  value: string
  onChange: (v: string) => void
} {
  const [value, onChange] = useState(initial)
  return { value, onChange }
}
