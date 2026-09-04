import { Stack } from 'expo-router'

/** Route group "(owner)". Mounted by the root layout only when the session holds the matching role. */
export default function OwnerLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Owner' }} />
}
