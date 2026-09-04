import { Stack } from 'expo-router'

/** Route group "(discover)". Mounted by the root layout only when the session holds the matching role. */
export default function DiscoverLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Discover' }} />
}
