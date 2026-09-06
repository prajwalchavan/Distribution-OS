/**
 * Web `<ThemeProvider>`: the shared theme context plus the generated stylesheet.
 *
 * The sheet is injected into `document.head` once per theme, so an app never has to remember a CSS
 * import and a second provider (a print preview, a portal) costs nothing. Everything the sheet needs
 * is derived from the tokens.
 */
import { useEffect, useMemo, type ReactNode } from 'react'

import { ThemeContextProvider, buildTheme, type ThemeProviderProps } from '../theme.js'
import { fontFamily } from '../tokens.js'
import { buildStylesheet } from './css.js'

const injected = new Set<string>()

function injectStylesheet(id: string, css: string): void {
  if (typeof document === 'undefined' || injected.has(id)) return
  const style = document.createElement('style')
  style.dataset['dosTheme'] = id
  style.textContent = css
  document.head.appendChild(style)
  injected.add(id)
}

export interface WebThemeProviderProps extends ThemeProviderProps {
  /** Extra class on the root element. */
  className?: string
  children: ReactNode
}

export function ThemeProvider({
  children,
  className,
  ...rest
}: WebThemeProviderProps): React.JSX.Element {
  const theme = useMemo(
    () => buildTheme(rest),
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
  const sheetId = `${theme.name}${theme.brand}`
  const css = useMemo(
    () => buildStylesheet(theme.colors, fontFamily.sans, theme.name),
    [theme.colors, theme.name],
  )
  useEffect(() => {
    injectStylesheet(sheetId, css)
  }, [sheetId, css])

  return (
    <ThemeContextProvider {...rest}>
      <div
        className={['dos-root', className ?? ''].join(' ').trim()}
        data-theme={theme.name}
        style={{ minHeight: '100%' }}
      >
        {children}
      </div>
    </ThemeContextProvider>
  )
}
