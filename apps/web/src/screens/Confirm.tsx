import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePrefs } from '../lib/prefs'
import { AuthLayout } from '../ui/AuthLayout'
import { ErrorNote } from '../ui/Notice'

/**
 * Landing page for invite and password-reset emails (/auth/confirm#token_hash=…&type=…).
 * The one-time code travels after '#', so it never reaches the web server or its logs.
 * Exchanges the one-time link for a session, then hands over to "choose a password".
 */
const readLink = (): { tokenHash: string; type: 'invite' | 'recovery' } | null => {
  const params = new URLSearchParams(window.location.hash.slice(1))
  const tokenHash = params.get('token_hash')
  const type = params.get('type')
  return tokenHash && (type === 'invite' || type === 'recovery') ? { tokenHash, type } : null
}

export const Confirm = ({ onConfirmed, onBack }: { onConfirmed: () => void; onBack: () => void }) => {
  const { t } = usePrefs()
  const [link] = useState(readLink)
  const [failed, setFailed] = useState(!link || !supabase)

  useEffect(() => {
    // Remove the one-time token from the address bar and history straight away.
    window.history.replaceState(null, '', '/auth/confirm')
    if (!link || !supabase) return
    void supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type }).then(({ error }) => {
      if (error) setFailed(true)
      else onConfirmed()
    })
  }, [link, onConfirmed])

  return (
    <AuthLayout>
      <div className="stack">
        {failed ? (
          <>
            <ErrorNote>{t('confirm.invalid')}</ErrorNote>
            <button type="button" className="link" onClick={onBack}>
              {t('forgot.back')}
            </button>
          </>
        ) : (
          <p className="lede">{t('confirm.checking')}</p>
        )}
      </div>
    </AuthLayout>
  )
}
