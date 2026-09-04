import { Stack } from 'expo-router'

/** Route group "(delivery)". Mounted by the root layout only when the session holds the matching role. */
export default function DeliveryLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Delivery' }} />
}
