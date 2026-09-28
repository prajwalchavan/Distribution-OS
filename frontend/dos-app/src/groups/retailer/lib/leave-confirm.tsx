/**
 * "Sign out?" — asked before the shop signs out, from EVERY place that signs out.
 *
 * Signing out empties every basket on the device (`useLeave`, founder 2026-09-28): the basket is kept
 * across restarts now, and the next person to pick the device up must not find the last one's order
 * waiting in it. That makes signing out the one tap in this app that throws away work nobody has sent
 * yet, so it asks first and says what goes. It used to ask only on Me, while the ⋯ sheet's and the
 * account menu's "Sign out" emptied the basket without a word (retailer check, 2026-09-28). Me and the
 * shell now open this same dialog.
 *
 * The body names the basket and no device: the same dialog opens on a counter PC (DOS-179).
 */
import { Dialog, useStrings } from '@dos/ui'
import { useCallback, useState } from 'react'

import { useLeave } from './shopping'

export interface LeaveConfirm {
  /** Opens the dialog. Nothing is emptied and nobody is signed out until its confirm. */
  ask: () => void
  /** Render it once, anywhere under the group's `<ThemeProvider>`; closed, it draws nothing. */
  dialog: React.JSX.Element
}

export function useLeaveConfirm(): LeaveConfirm {
  const t = useStrings()
  const leave = useLeave()
  const [asking, setAsking] = useState(false)
  const ask = useCallback(() => {
    setAsking(true)
  }, [])
  const dialog = (
    <Dialog
      open={asking}
      onClose={() => {
        setAsking(false)
      }}
      title={t('me.signOutTitle')}
      body={t('me.signOutBody')}
      confirmLabel={t('me.signOut')}
      cancelLabel={t('me.stay')}
      onConfirm={() => {
        setAsking(false)
        leave()
      }}
      testID="me-sign-out-dialog"
    />
  )
  return { ask, dialog }
}
