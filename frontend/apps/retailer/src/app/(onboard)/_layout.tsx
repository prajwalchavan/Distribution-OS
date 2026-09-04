import { Stack } from 'expo-router'

/** Route group "(onboard)". Mounted by the root layout only when the session holds the matching role. */
export default function OnboardLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Onboard' }} />
}
