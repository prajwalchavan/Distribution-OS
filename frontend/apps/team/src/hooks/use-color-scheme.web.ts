import { useSyncExternalStore } from 'react'
import { useColorScheme as useRNColorScheme } from 'react-native'

const subscribe = () => () => {}

/** Static rendering on web has no color scheme until hydration; report 'light' until then. */
export function useColorScheme() {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const colorScheme = useRNColorScheme()
  return hydrated ? colorScheme : 'light'
}
