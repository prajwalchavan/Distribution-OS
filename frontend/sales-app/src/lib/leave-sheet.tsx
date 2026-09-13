/**
 * DOS-167 — the sheet a rep sees on signing out, or switching distributor, while this phone still holds
 * orders the office has not got.
 *
 * It opens only when `leaveDecision` in `@dos/offline/react` says 'ask'; with nothing queued and nothing
 * refused, signing out stays one tap. What it offers is the founder's rule (2026-09-13): "Send now" while
 * there is a signal, or leave keeping them on this phone for this person only. Throwing an order away is
 * never offered here — that stays in the Needs-attention tray with its audit line.
 *
 * On the kit's `Sheet`, which on a phone runs on the overlay host (DOS-164). Not the kit's `Dialog`: a
 * dialog carries exactly one confirm verb, and this choice has two. Every word comes from
 * `src/strings.ts` through `leaveSentence` and the translator.
 */
import { Button, Sheet, Stack, Txt, useColors, useStrings } from '@dos/ui'

import { leaveSentence, type LeaveMode } from './leave'

export interface LeaveSheetProps {
  open: boolean
  mode: LeaveMode
  /** Queued and sending. */
  pending: number
  /** Refused by the office and waiting in the tray. */
  rejected: number
  online: boolean
  /** The person signing out. */
  name: string
  /** The distributor being left, whose file keeps the changes. */
  tenantName: string
  /** A step is running: the buttons swallow a second tap. */
  busy: boolean
  /** Why they are still here after "Send now" with a signal — the strip's own last error — or null. */
  note: string | null
  onSendNow: () => void
  onLeave: () => void
  onCancel: () => void
}

export function LeaveSheet({
  open,
  mode,
  pending,
  rejected,
  online,
  name,
  tenantName,
  busy,
  note,
  onSendNow,
  onLeave,
  onCancel,
}: LeaveSheetProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const sentence = leaveSentence({ mode, pending, rejected, name, tenantName })
  const why = online ? note : t('leave.noSignal')
  return (
    <Sheet open={open} onClose={onCancel} title={sentence.title} testID="leave-sheet">
      <Stack gap={4}>
        {sentence.attention === null ? null : (
          <Txt
            testID="leave-attention"
            field="bodyStrong"
            desk="cell"
            color={colors.status.brick.fg}
          >
            {sentence.attention}
          </Txt>
        )}
        <Txt testID="leave-body" field="body" desk="body">
          {sentence.body}
        </Txt>
        {why === null ? null : (
          <Txt testID="leave-why" field="label" desk="meta" color={colors.text.secondary}>
            {why}
          </Txt>
        )}
        {online ? (
          <Button
            testID="leave-send-now"
            label={t('leave.sendNow')}
            variant="primary"
            loading={busy}
            onPress={onSendNow}
          />
        ) : null}
        <Button
          testID="leave-keep"
          label={mode === 'signOut' ? t('leave.signOutKeep') : t('leave.switchAnyway')}
          variant="secondary"
          loading={busy}
          onPress={onLeave}
        />
        <Button
          testID="leave-cancel"
          label={t('action.cancel')}
          variant="ghost"
          onPress={onCancel}
        />
      </Stack>
    </Sheet>
  )
}
