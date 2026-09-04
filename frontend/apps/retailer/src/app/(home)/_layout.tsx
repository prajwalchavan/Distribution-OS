import { Stack } from 'expo-router'

/** Route group "(home)". Mounted by the root layout only when the session holds the matching role. */
export default function HomeLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Home' }} />
}
