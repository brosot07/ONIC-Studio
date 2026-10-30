import { useEffect, useState, type FormEvent } from 'react'
import type { MessageKey } from '@onic/shared'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { AuthLayout } from '../ui/AuthLayout'
import { ErrorNote } from '../ui/Notice'

const CodeForm = ({ onSubmit, busy, error }: { onSubmit: (code: string) => void; busy: boolean; error: MessageKey | null }) => {
  const { t } = usePrefs()
  const [code, setCode] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(code.replace(/\s/g, ''))
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <label className="field">
        <span>{t('mfa.code')}</span>
        <input
          className="code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && <ErrorNote>{t(error)}</ErrorNote>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? t('common.working') : t('mfa.submit')}
      </button>
    </form>
  )
}

const useVerify = (onDone: () => void) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(null)
  const verify = async (factorId: string, code: string) => {
    if (!supabase) return
    if (!/^\d{6}$/.test(code)) return setError('mfa.error.format')
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setBusy(false)
    if (verifyError) setError('mfa.error.code')
    else onDone()
  }
  return { busy, error, verify, setError }
}

/** First sign-in for Admin/Approver: scan a code with an authenticator app. */
export const MfaEnroll = ({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) => {
  const { t } = usePrefs()
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const { busy, error, verify, setError } = useVerify(onDone)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    void (async () => {
      // Clear half-finished setups from earlier attempts before starting a new one.
      const { data: list } = await supabase.auth.mfa.listFactors()
      for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ONIC Studio' })
      if (cancelled) return
      if (enrollError || !data) return setError('common.error.generic')
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    })()
    return () => {
      cancelled = true
    }
  }, [setError])

  return (
    <AuthLayout>
      <h1>{t('mfa.enroll.title')}</h1>
      <p className="lede">{t('mfa.enroll.lede')}</p>
      {factor ? (
        <>
          <img className="qr" src={factor.qr} alt="" width={180} height={180} />
          <p className="hint">
            {t('mfa.enroll.manual')} <code className="secret">{factor.secret}</code>
          </p>
          <CodeForm busy={busy} error={error} onSubmit={(code) => void verify(factor.id, code)} />
        </>
      ) : error ? (
        <ErrorNote>{t(error)}</ErrorNote>
      ) : (
        <p className="hint">{t('mfa.enroll.loading')}</p>
      )}
      <button type="button" className="link" onClick={onSignOut}>
        {t('login.signOut')}
      </button>
    </AuthLayout>
  )
}

/** Every later sign-in: type the current 6-digit code. */
export const MfaChallenge = ({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) => {
  const { t } = usePrefs()
  const [factorId, setFactorId] = useState<string | null>(null)
  const { busy, error, verify } = useVerify(onDone)

  useEffect(() => {
    void supabase?.auth.mfa.listFactors().then(({ data }) => setFactorId(data?.totp[0]?.id ?? null))
  }, [])

  return (
    <AuthLayout>
      <h1>{t('mfa.challenge.title')}</h1>
      <p className="lede">{t('mfa.challenge.lede')}</p>
      <CodeForm busy={busy || !factorId} error={error} onSubmit={(code) => factorId && void verify(factorId, code)} />
      <button type="button" className="link" onClick={onSignOut}>
        {t('login.signOut')}
      </button>
    </AuthLayout>
  )
}
