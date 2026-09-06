import { useState, type FormEvent } from 'react'
import { PasswordSchema } from '@dos/contracts'
import { changePassword, ApiError } from '../lib/api.js'

/**
 * Forced after a temporary password (owner/manager set one via tenancy.staff.create/setPassword).
 * Shown instead of the dashboard while `session.user.mustChangePassword` is true; on success the
 * store updates in place and App.tsx's Shell renders the dashboard on the next tick, no reload.
 */
export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policyError = next ? (PasswordSchema.safeParse(next).success ? null : true) : null
  const mismatch = confirm.length > 0 && next !== confirm

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!current || !next || mismatch || policyError) return
    setSubmitting(true)
    setError(null)
    try {
      await changePassword(current, next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card signin">
      <h1>Set a new password</h1>
      <p className="muted">
        A temporary password was set for you. Choose a new one before continuing — this signs every
        other device you were using out.
      </p>
      <form className="stack" onSubmit={(e) => void onSubmit(e)}>
        <label className="field">
          Current (temporary) password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="field">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </label>
        {policyError && (
          <p className="error">8–72 characters, at least one letter and one digit.</p>
        )}
        <label className="field">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {mismatch && <p className="error">Passwords don&rsquo;t match.</p>}
        {error && <p className="error">{error}</p>}
        <button
          className="primary"
          type="submit"
          disabled={submitting || !current || !next || mismatch || !!policyError}
        >
          {submitting ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  )
}
