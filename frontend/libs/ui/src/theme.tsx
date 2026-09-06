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
import type { ViewportKind } from './types.js'

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
  /**
   * Which shell is on screen. The renderer's `<ThemeProvider>` fills this in from `useViewport()`;
   * an app never passes it. See `buildTheme` for the one thing it changes.
   */
  viewport?: ViewportKind | undefined
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
  /*
   * UX-00 section 5.2 names four floors and says each app's SHELL fixes which one applies — and
   * since 2026-09-06 the shell is chosen by viewport, not by app (docs/08 section 0), so the floor
   * has to follow it. The `phone` floor is written there as "the owner and manager PHONE surfaces";
   * the same build opened on a laptop is the desk shell, where the same section says a button is
   * 32 px. `field` (69) and `floor` (76) do NOT shrink: those are stated per SCREEN — "every tap
   * target ... in sales, delivery and retailer", "on every warehouse screen" — glove-and-thumb
   * floors that a big monitor does not repeal.
   */
  const declared: SizeName = props.touch ?? 'desk'
  const touch: SizeName = declared === 'phone' && props.viewport === 'desk' ? 'desk' : declared
  /*
   * Density follows the viewport for the same reason, and UX-00 says so twice: section 2 ends "every
   * desk screen is designed twice, on purpose, at BOTH densities", and section 8.2 is headed "the
   * phone shell (sales, warehouse, delivery, retailer; AND THE DESK APPS' PHONE SURFACES)". So the
   * owner app on a 375 px phone is a field surface — 16 sp body (UX-01 U8's floor, which 14 px desk
   * text is under), grouped list cards, "never a table" (UX-02 R20) — from the same screen files.
   * A field app does NOT become a desk one on a big monitor: section 2 gives field apps no table.
   */
  const declaredDensity: 'desk' | 'field' =
    props.density ?? (declared === 'desk' ? 'desk' : 'field')
  const density: 'desk' | 'field' =
    declaredDensity === 'desk' && props.viewport === 'phone' ? 'field' : declaredDensity
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
    density,
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
      rest.viewport,
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
