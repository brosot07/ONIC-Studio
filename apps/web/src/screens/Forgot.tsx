import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { AuthLayout } from '../ui/AuthLayout'
import { ErrorNote, OkNote } from '../ui/Notice'

export const Forgot = ({ onBack }: { onBack: () => void }) => {
  const { t } = usePrefs()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !email.trim()) return
    setBusy(true)
    setFailed(false)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm`,
    })
    setBusy(false)
    // Same answer whether or not the account exists, so the form can't be used to find accounts.
    if (error && error.status !== 400 && error.status !== 404) setFailed(true)
    else setSent(true)
  }

  return (
    <AuthLayout>
      <form className="stack" onSubmit={(e) => void onSubmit(e)} noValidate>
        <h1>{t('forgot.title')}</h1>
        <p className="lede">{t('forgot.lede')}</p>
        {sent ? (
          <OkNote>{t('forgot.sent')}</OkNote>
        ) : (
          <>
            <label className="field">
              <span>{t('login.email')}</span>
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
            </label>
            {failed && <ErrorNote>{t('common.error.network')}</ErrorNote>}
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
              {busy ? t('common.working') : t('forgot.submit')}
            </button>
          </>
        )}
        <button type="button" className="link" onClick={onBack}>
          {t('forgot.back')}
        </button>
      </form>
    </AuthLayout>
  )
}
