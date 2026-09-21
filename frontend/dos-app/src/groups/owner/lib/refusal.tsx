/**
 * A refused owner write, printed where it was pressed.
 *
 * `RefusalProps`, `Refusal` and `stayOpen` below are the manager app's (`frontend/manager-app/src/lib/ui.tsx`),
 * copied word for word with their DOS-029 comment, because apps cannot import each other. They live in a
 * file of their own, not in `./ui`, so every owner surface that stops closing its dialog on a refusal
 * imports this one copy. The first is Settings › Support access (DOS-108); the owner app's other
 * `.then(done, done)` dialogs are not converted yet. Where the comments say "manager", read "owner":
 * nothing queues an owner write either.
 */
import { useRefusal, type WriteOutcome } from '@dos/api-client/react'
import { Txt, useColors, useStrings } from '@dos/ui'

// ---------------------------------------------------------------------------
// A refused write, where the person pressed
// ---------------------------------------------------------------------------

export interface RefusalProps {
  /** Every write the dialog or panel serves. */
  of: readonly WriteOutcome[]
  /** The bill, shop or document the surface is about; a different one hides the last refusal. */
  scope?: string | null | undefined
  testID?: string | undefined
}

/**
 * DOS-029: the service's own sentence for a refused write, on the surface where it was pressed.
 *
 * Every confirm on this app used to close its dialog on failure as well as on success
 * (`.then(done, done)`), so a 400, a 409 and a 501 all looked like nothing had happened. A surface now
 * closes only on success (`stayOpen` is the rejection handler) and this line says why it did not: the
 * last child of a dialog's body, directly above the buttons, or directly above a panel's submit button.
 *
 * WHICH refusal is `useRefusal`'s rule (@dos/api-client): the latest among `of`, hidden while any of
 * them is pending, never one already there when the surface opened, reset when `scope` changes.
 *
 * A lost connection is the one sentence replaced. The client's default promises "This will send when
 * the signal is back", true of a queued field write and false here: nothing queues a manager write.
 */
export function Refusal({ of, scope, testID }: RefusalProps): React.JSX.Element {
  const t = useStrings()
  const colors = useColors()
  const refusal = useRefusal(of, scope ?? null)
  if (refusal === undefined) return <></>
  return (
    <Txt field="body" desk="body" color={colors.status.brick.fg} testID={testID}>
      {refusal.kind === 'network' ? t('app.writeNoConnection') : refusal.message}
    </Txt>
  )
}

/**
 * The rejection handler of every confirm on this app: `.then(done, stayOpen)`. The dialog or panel stays
 * open, the refusal stays on the mutation's state, and `<Refusal>` prints it.
 */
export function stayOpen(): void {
  /* the refusal stays on the mutation state; <Refusal> prints it */
}
