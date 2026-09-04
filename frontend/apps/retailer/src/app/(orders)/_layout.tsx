import { Stack } from 'expo-router'

/** Route group "(orders)". Mounted by the root layout only when the session holds the matching role. */
export default function OrdersLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Orders' }} />
}
