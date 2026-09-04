import { Stack } from 'expo-router'

/** Route group "(ledger)". Mounted by the root layout only when the session holds the matching role. */
export default function LedgerLayout() {
  return <Stack screenOptions={{ headerShown: true, title: 'Ledger' }} />
}
