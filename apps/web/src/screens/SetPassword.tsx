import { useState, type FormEvent } from 'react'
import type { MessageKey } from '@onic/shared'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { isStrongPassword, passwordErrorKey } from '../lib/auth'
import { AuthLayout } from '../ui/AuthLayout'
import { ErrorNote } from '../ui/Notice'

export const SetPassword = ({ onDone }: { onDone: () => void }) => {
  const { t } = usePrefs()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    if (!isStrongPassword(password)) return setError('password.weak')
    if (password !== repeat) return setError('password.mismatch')
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) return setError(passwordErrorKey(updateError))
    onDone()
  }

  return (
    <AuthLayout>
      <form className="stack" onSubmit={(e) => void onSubmit(e)} noValidate>
        <h1>{t('password.title')}</h1>
        <p className="lede">{t('password.lede')}</p>
        <label className="field">
          <span>{t('password.new')}</span>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span>{t('password.repeat')}</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={busy} />
        </label>
        {error && <ErrorNote>{t(error)}</ErrorNote>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? t('common.working') : t('password.submit')}
        </button>
      </form>
    </AuthLayout>
  )
}
