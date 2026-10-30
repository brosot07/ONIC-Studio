import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { usePrefs } from './lib/prefs'
import { Login } from './screens/Login'
import { PrefsBar } from './ui/PrefsBar'

export const App = () => {
  const { t } = usePrefs()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return null

  if (!session) return <Login />

  return (
    <main className="placeholder">
      <PrefsBar />
      <p>{t('login.signedIn')}</p>
      <button type="button" className="btn btn-quiet" onClick={() => void supabase?.auth.signOut()}>
        {t('login.signOut')}
      </button>
    </main>
  )
}
