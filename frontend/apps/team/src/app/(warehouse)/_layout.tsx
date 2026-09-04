import { Stack } from 'expo-router'

/** Route group "(warehouse)". Mounted by the root layout only when the session holds the matching role. */
export default function WarehouseLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Warehouse' }} />
}
