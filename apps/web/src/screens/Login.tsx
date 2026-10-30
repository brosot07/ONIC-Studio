import { useState, type FormEvent } from 'react'
import type { MessageKey } from '@onic/shared'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { isNetworkError } from '../lib/auth'
import { AuthLayout } from '../ui/AuthLayout'
import { ErrorNote, OkNote } from '../ui/Notice'

export const Login = ({ notice, onForgot }: { notice?: MessageKey | null; onForgot: () => void }) => {
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
      if (authError) {
        if (authError.code === 'user_banned') setError('login.error.disabled')
        else if (isNetworkError(authError)) setError('login.error.network')
        else setError('login.error.invalid')
      }
    } catch {
      setError('login.error.network')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <form className="stack" onSubmit={(e) => void onSubmit(e)} noValidate>
        <h1>{t('login.title')}</h1>
        <p className="lede">{t('login.lede')}</p>
        {notice && <OkNote>{t(notice)}</OkNote>}

        <label className="field">
          <span>{t('login.email')}</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
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

        {error && <ErrorNote>{t(error)}</ErrorNote>}

        <button type="submit" className="btn btn-primary" disabled={busy || !supabase}>
          {busy ? t('login.submitting') : t('login.submit')}
        </button>
        <button type="button" className="link" onClick={onForgot}>
          {t('login.forgot')}
        </button>
        <p className="hint">{t('login.inviteOnly')}</p>
      </form>
    </AuthLayout>
  )
}
