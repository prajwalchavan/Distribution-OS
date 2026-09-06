/**
 * The theme every component reads: semantic colours, the app's touch floor, the string translator and
 * the distributor's brand.
 *
 * White-label rule (UX-00 section 11, docs/22 section 9 item 10): the distributor supplies a NAME and a LOGO.
 * A tenant-controlled accent would void every contrast ratio in UX-00 section 3, so `tenant.primary` sets
 * exactly one thing — `theme.brand`, a decorative mark colour — and never `accent.*`, `text.*` or any
 * other semantic. An app that deliberately wants the tenant colour as the accent must pass
 * `allowTenantAccent` and owns the contrast consequences.
 *
 * This module uses `react` only, so web and native share one context, one provider contract and one
 * set of hooks. The renderers add their own `<ThemeProvider>` wrappers on top of `<ThemeContext>`.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { createTranslator, type Locale, type StringParams, type Translator } from './strings.js'
import { size, themes, type SemanticColors, type SizeName, type ThemeName } from './tokens.js'

/** What the distributor supplies. `logoUrl` is a signed read URL; absent means the initials fallback. */
export interface TenantBrand {
  /** `branding.display_name`, else `tenants.legal_name`. */
  readonly name: string
  /** Signed URL for `branding.logo_object_key`. Absent or null means no logo. */
  readonly logoUrl?: (string | null) | undefined
  /** Decorative mark colour only. Ignored unless it is a `#rrggbb` value. */
  readonly primary?: (string | null) | undefined
}

export interface ThemeValue {
  readonly colors: SemanticColors
  readonly name: ThemeName
  /** Which of the four touch floors this app's shell fixes (UX-00 section 5.2). */
  readonly touch: SizeName
  /** The height, in dp/px, of `touch`. */
  readonly touchSize: number
  /** Desk apps render registers as tables and may use `text.tertiary`; field apps never do. */
  readonly density: 'desk' | 'field'
  readonly tenant: TenantBrand | null
  /** Decorative brand mark colour. Defaults to `accent.solid`. */
  readonly brand: string
  readonly locale: Locale
  readonly t: Translator
}

const fallbackTheme: ThemeValue = {
  colors: themes.light,
  name: 'light',
  touch: 'desk',
  touchSize: size.desk,
  density: 'desk',
  tenant: null,
  brand: themes.light.accent.solid,
  locale: 'en',
  t: createTranslator('en'),
}

const ThemeContext = createContext<ThemeValue>(fallbackTheme)

export interface ThemeProviderProps {
  children: ReactNode
  /** Light everywhere today; `dark` is the desk-only v2 theme. Field apps never pass it. */
  theme?: ThemeName | undefined
  /** `field` 69 · `floor` 76 · `phone` 63 · `desk` 32. The shell sets it once for the whole app. */
  touch?: SizeName | undefined
  density?: ('desk' | 'field') | undefined
  tenant?: (TenantBrand | null) | undefined
  locale?: Locale | undefined
  /** App string namespaces, merged over the kit catalogue. */
  strings?: Readonly<Record<string, string>> | undefined
  /**
   * Let `tenant.primary` become `accent.*`. Off by default and off in every shipped app: UX-00
   * section 11 forbids a tenant accent because it voids the computed contrast ratios.
   */
  allowTenantAccent?: boolean | undefined
}

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Builds the theme value. Exported so the web and native providers share one implementation and can
 * never drift; screens use `<ThemeProvider>` from `@dos/ui/web` or `@dos/ui/native`.
 */
export function buildTheme(props: Omit<ThemeProviderProps, 'children'>): ThemeValue {
  const name: ThemeName = props.theme ?? 'light'
  const touch: SizeName = props.touch ?? 'desk'
  const base = themes[name]
  const tenant = props.tenant ?? null
  const tenantColor = tenant?.primary && HEX.test(tenant.primary) ? tenant.primary : null
  const colors: SemanticColors =
    tenantColor && props.allowTenantAccent
      ? { ...base, accent: { ...base.accent, solid: tenantColor, fg: tenantColor } }
      : base
  return {
    colors,
    name,
    touch,
    touchSize: size[touch],
    density: props.density ?? (touch === 'desk' ? 'desk' : 'field'),
    tenant,
    brand: tenantColor ?? base.accent.solid,
    locale: props.locale ?? 'en',
    t: createTranslator(props.locale ?? 'en', props.strings ?? {}),
  }
}

/** Renderer-agnostic provider. `@dos/ui/web` wraps it with the injected stylesheet. */
export function ThemeContextProvider({ children, ...rest }: ThemeProviderProps): React.JSX.Element {
  const value = useMemo(
    () => buildTheme(rest),
    // The primitive fields are the identity of a theme; `strings` and `tenant` are compared by field.
    [
      rest.theme,
      rest.touch,
      rest.density,
      rest.locale,
      rest.allowTenantAccent,
      rest.tenant?.name,
      rest.tenant?.logoUrl,
      rest.tenant?.primary,
      rest.strings,
    ],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** The theme. Outside a provider this is the light desk theme, so a component never crashes. */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}

/** Just the colours — the most common read. */
export function useColors(): SemanticColors {
  return useContext(ThemeContext).colors
}

/** The translator. `const t = useStrings(); t('status.low', { cases: 4 })`. */
export function useStrings(): Translator {
  return useContext(ThemeContext).t
}

/** The distributor whose name and logo this app is showing. Null before sign-in. */
export function useTenant(): TenantBrand | null {
  return useContext(ThemeContext).tenant
}

export type { StringParams }
