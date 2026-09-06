/**
 * Native `<ThemeProvider>`. Same props and same behaviour as the web one, minus the stylesheet:
 * React Native has no cascade, so every component reads the theme from the context directly.
 *
 * Field apps never read the system appearance (UX-01 U1): the `theme` prop stays `light` unless a
 * desk app on a tablet deliberately asks for `dark`.
 */
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ThemeContextProvider, buildTheme, type ThemeProviderProps } from '../theme.js'

export interface NativeThemeProviderProps extends ThemeProviderProps {
  children: ReactNode
}

/**
 * The safe-area provider lives HERE, not in each app's root layout, for the same reason the
 * stylesheet lives in the web provider: `<Screen>` reads insets from the first frame (UX-00 section
 * 8.2 — a hard-coded `paddingTop` is a bug), and an app that forgot the wrapper would lay out
 * correctly in a simulator and wrongly on a notched phone.
 */
export function ThemeProvider({ children, ...rest }: NativeThemeProviderProps): React.JSX.Element {
  const theme = buildTheme(rest)
  return (
    <SafeAreaProvider>
      <ThemeContextProvider {...rest}>
        <View style={{ flex: 1, backgroundColor: theme.colors.bg.ground }}>{children}</View>
      </ThemeContextProvider>
    </SafeAreaProvider>
  )
}
