/**
 * Native `<ThemeProvider>`. Same props and same behaviour as the web one, minus the stylesheet:
 * React Native has no cascade, so every component reads the theme from the context directly.
 *
 * Field apps never read the system appearance (UX-01 U1): the `theme` prop stays `light` unless a
 * desk app on a tablet deliberately asks for `dark`.
 */
import type { ReactNode } from 'react'
import { View } from 'react-native'

import { ThemeContextProvider, buildTheme, type ThemeProviderProps } from '../theme.js'

export interface NativeThemeProviderProps extends ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children, ...rest }: NativeThemeProviderProps): React.JSX.Element {
  const theme = buildTheme(rest)
  return (
    <ThemeContextProvider {...rest}>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg.ground }}>{children}</View>
    </ThemeContextProvider>
  )
}
