/**
 * DOS-125 — there is no clipboard on the phone in this batch, and the interface says so out loud.
 *
 * A native clipboard means pinning `expo-clipboard`, which the Expo SDK governs like every other
 * native module (docs/08 §0) — a decision for the SDK bump, not for a QR fix. It is not missed here:
 * on a phone the shop taps "Open a UPI app", which hands the intent straight to the app that will
 * pay, and the QR is there to be scanned by another phone. So `available` is false, the screens hide
 * their Copy button, and `copy` answers false rather than pretending.
 *
 * It is NOT faked with the share sheet. Sharing a payment intent is a different act with a different
 * consequence, and a button labelled Copy that opens a share sheet is a lie about what happened.
 */
import type { PlatformClipboard } from './types.js'

export const clipboard: PlatformClipboard = {
  copy: async () => Promise.resolve(false),
  available: false,
}
