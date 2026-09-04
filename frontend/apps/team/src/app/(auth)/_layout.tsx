import { Stack } from 'expo-router'

/** Route group "(auth)". Mounted by the root layout only when the session holds the matching role. */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Auth' }} />
}
