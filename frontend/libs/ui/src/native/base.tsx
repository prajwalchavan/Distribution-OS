/**
 * React Native primitives every kit component is built from. Not exported to screens.
 *
 * The one difference from the DOM layer is unit handling: `tracking` is em in the tokens and pixels
 * in React Native, so it is multiplied by the size here — the same token produces the same picture.
 */
import { ActivityIndicator, StyleSheet, Text, View, type TextStyle } from 'react-native'

import { useTheme } from '../theme.js'
import type { TxtContract } from '../types.js'
import {
  fontFamily,
  typeDesk,
  typeField,
  type DeskTypeName,
  type FieldTypeName,
  type TypeToken,
} from '../tokens.js'

/** A type token as a React Native text style. */
export function typeStyle(token: TypeToken): TextStyle {
  return {
    fontSize: token.size,
    lineHeight: token.line,
    fontWeight: String(token.weight) as TextStyle['fontWeight'],
    letterSpacing: token.tracking * token.size,
    fontFamily: fontFamily.native,
  }
}

export function useTypeStyle(field: FieldTypeName, desk: DeskTypeName): TextStyle {
  const { density } = useTheme()
  return typeStyle(density === 'desk' ? typeDesk[desk] : typeField[field])
}

export interface TxtProps extends TxtContract {
  style?: TextStyle | undefined
  accessibilityLabel?: string | undefined
}

/** `h1`–`h3` are the one piece of `as` that means something outside a DOM. */
const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3'])

/**
 * The only place text styling happens on native. Numeric text carries `maxFontSizeMultiplier={1.3}`
 * and tabular figures; `allowFontScaling={false}` is banned (UX-00 section 4.5 rule 8).
 */
export function Txt({
  field,
  desk,
  color,
  children,
  style,
  testID,
  numeric,
  numberOfLines,
  accessibilityLabel,
  as,
}: TxtProps): React.JSX.Element {
  const { colors } = useTheme()
  const base = useTypeStyle(field, desk)
  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={as !== undefined && HEADINGS.has(as) ? 'header' : undefined}
      maxFontSizeMultiplier={numeric === true ? 1.3 : undefined}
      style={[
        base,
        { color: color ?? colors.text.primary },
        numeric === true ? styles.numeric : null,
        style,
      ]}
    >
      {children}
    </Text>
  )
}

export function Eyebrow({
  children,
  testID,
}: {
  children: string
  testID?: string | undefined
}): React.JSX.Element {
  const { colors, density } = useTheme()
  return (
    <Txt
      field="eyebrow"
      desk="eyebrow"
      testID={testID}
      color={density === 'desk' ? colors.text.tertiary : colors.text.secondary}
      style={styles.upper}
    >
      {children}
    </Txt>
  )
}

export function Rule({ tone = 'faint' }: { tone?: 'faint' | 'hairline' }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: tone === 'faint' ? colors.border.faint : colors.border.hairline,
      }}
    />
  )
}

export function Spinner({
  size = 16,
  color,
}: {
  size?: number
  color?: string
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <ActivityIndicator size={size > 20 ? 'large' : 'small'} color={color ?? colors.accent.fg} />
  )
}

const styles = StyleSheet.create({
  numeric: { fontVariant: ['tabular-nums'] },
  upper: { textTransform: 'uppercase' },
})
