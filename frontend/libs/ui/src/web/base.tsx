/**
 * Web primitives every kit component is built from. Not exported to screens: a screen composes the
 * section 6 components, never these.
 */
import type { CSSProperties, ReactNode } from 'react'

import { useTheme } from '../theme.js'
import {
  typeDesk,
  typeField,
  type DeskTypeName,
  type FieldTypeName,
  type TypeToken,
} from '../tokens.js'

/** A type token as CSS. `tracking` is em, so it becomes `letterSpacing` in em. */
export function typeStyle(token: TypeToken): CSSProperties {
  return {
    fontSize: token.size,
    lineHeight: `${token.line}px`,
    fontWeight: token.weight,
    letterSpacing: token.tracking === 0 ? undefined : `${token.tracking}em`,
  }
}

/** Picks the desk or the field scale by the app's density, so one screen file serves both. */
export function useTypeStyle(field: FieldTypeName, desk: DeskTypeName): CSSProperties {
  const { density } = useTheme()
  return typeStyle(density === 'desk' ? typeDesk[desk] : typeField[field])
}

export interface TxtProps {
  field: FieldTypeName
  desk: DeskTypeName
  color?: string | undefined
  children: ReactNode
  style?: CSSProperties | undefined
  testID?: string | undefined
  as?: ('span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'label') | undefined
  numeric?: boolean | undefined
}

/** The only place text styling happens on web. */
export function Txt({
  field,
  desk,
  color,
  children,
  style,
  testID,
  as = 'span',
  numeric,
}: TxtProps): React.JSX.Element {
  const { colors } = useTheme()
  const base = useTypeStyle(field, desk)
  const Tag = as
  return (
    <Tag
      data-testid={testID}
      className={numeric ? 'dos-num' : undefined}
      style={{ color: color ?? colors.text.primary, margin: 0, ...base, ...style }}
    >
      {children}
    </Tag>
  )
}

/** UPPERCASE eyebrow, <= 14 characters, the one uppercase the system allows (UX-00 section 4.4). */
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
      as="div"
      style={{ textTransform: 'uppercase' }}
    >
      {children}
    </Txt>
  )
}

/** A hairline rule. `faint` inside a group, `hairline` for the rules that structure a page. */
export function Rule({ tone = 'faint' }: { tone?: 'faint' | 'hairline' }): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <div
      style={{
        height: 1,
        background: tone === 'faint' ? colors.border.faint : colors.border.hairline,
        width: '100%',
      }}
    />
  )
}

/** A determinate-looking 16 dp spinner for the loading button and the validating input. */
export function Spinner({
  size = 16,
  color,
}: {
  size?: number
  color?: string
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        border: `2px solid ${color ?? colors.border.strong}`,
        borderTopColor: 'transparent',
        animation: 'dos-spin 700ms linear infinite',
      }}
    />
  )
}
