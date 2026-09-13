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
import { OverlayStackProvider } from './overlay-host.js'
import { useViewport } from './viewport.js'

export interface NativeThemeProviderProps extends ThemeProviderProps {
  children: ReactNode
}

/**
 * The safe-area provider lives HERE, not in each app's root layout, for the same reason the
 * stylesheet lives in the web provider: `<Screen>` reads insets from the first frame (UX-00 section
 * 8.2 — a hard-coded `paddingTop` is a bug), and an app that forgot the wrapper would lay out
 * correctly in a simulator and wrongly on a notched phone.
 *
 * The overlay stack lives here for the same reason (DOS-164): a Sheet or Dialog opened while another
 * is presented must render inside that one's modal, and an app that forgot the provider would work on
 * web and Android and leave that dialog dead on an iPhone.
 */
export function ThemeProvider({ children, ...props }: NativeThemeProviderProps): React.JSX.Element {
  // The touch floor follows the SHELL, and the shell follows the viewport (docs/08 §0, UX-00 §5.2):
  // a tablet in landscape gets the rail and the desk floor from the same files.
  const rest = { ...props, viewport: useViewport().kind }
  const theme = buildTheme(rest)
  return (
    <SafeAreaProvider>
      <ThemeContextProvider {...rest}>
        <OverlayStackProvider>
          <View style={{ flex: 1, backgroundColor: theme.colors.bg.ground }}>{children}</View>
        </OverlayStackProvider>
      </ThemeContextProvider>
    </SafeAreaProvider>
  )
}
