import { Stack } from 'expo-router'

/** Route group "(sales)". Mounted by the root layout only when the session holds the matching role. */
export default function SalesLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Sales' }} />
}
