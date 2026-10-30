import { useState, type FormEvent } from 'react'
import type { MessageKey } from '@onic/shared'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { PrefsBar } from '../ui/PrefsBar'

export const Login = () => {
  const { t } = usePrefs()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(supabase ? null : 'login.error.notConfigured')

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return setError('login.error.notConfigured')
    if (!email.trim() || !password) return setError('login.error.missing')
    setBusy(true)
    setError(null)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) setError(authError.status === 400 ? 'login.error.invalid' : 'login.error.network')
    } catch {
      setError('login.error.network')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-brand" aria-hidden="true">
        <p className="wordmark">
          <span>ONIC</span>
          <span>Studio</span>
        </p>
      </section>

      <section className="login-panel">
        <PrefsBar />
        <form className="login-form" onSubmit={(e) => void onSubmit(e)} noValidate>
          <h1>{t('login.title')}</h1>
          <p className="lede">{t('login.lede')}</p>

          <label className="field">
            <span>{t('login.email')}</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span>{t('login.password')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>

          {error && (
            <p className="form-error" role="alert">
              {t(error)}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy || !supabase}>
            {busy ? t('login.submitting') : t('login.submit')}
          </button>
          <p className="hint">{t('login.inviteOnly')}</p>
        </form>
      </section>
    </div>
  )
}
