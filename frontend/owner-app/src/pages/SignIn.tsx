import { useState, type FormEvent } from 'react'
import { login, ORPCError } from '../lib/api.js'

/** Username + password sign-in. Phone-OTP is a later enhancement; usernames come from `pnpm db:seed`. */
export function SignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!username || !password) return
    setSubmitting(true)
    setError(null)
    try {
      await login(username.trim().toLowerCase(), password, remember)
    } catch (err) {
      // 401 (bad credentials), 423 (locked) and 403 (disabled/no membership) all carry a server
      // message meant for the sign-in screen (see backend/libs/contracts/src/auth.ts).
      setError(err instanceof ORPCError ? err.message : 'Could not reach the server. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card signin">
      <h1>Distribution OS · Owner</h1>
      <p className="muted">Sign in with your username and password.</p>
      <form className="stack" onSubmit={(e) => void onSubmit(e)}>
        <label className="field">
          Username
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="sunil.tarsun"
          />
        </label>
        <label className="field">
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember this device
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={submitting || !username || !password}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
