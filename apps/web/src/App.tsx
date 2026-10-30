import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { MessageKey } from '@onic/shared'
import { supabase } from './lib/supabase'
import { useIdleTimeout } from './lib/idle'
import { loadAccess, mfaStep, type Access, type MfaStep } from './lib/access'
import { Login } from './screens/Login'
import { Forgot } from './screens/Forgot'
import { Confirm } from './screens/Confirm'
import { SetPassword } from './screens/SetPassword'
import { MfaChallenge, MfaEnroll } from './screens/Mfa'
import { Shell, type Page } from './screens/Shell'
import { Home } from './screens/Home'
import { Users } from './screens/admin/Users'
import { Brand } from './screens/library/Brand'
import { Players } from './screens/library/Players'
import { Sponsors } from './screens/library/Sponsors'

type Flow = 'normal' | 'confirm' | 'set-password'

const initialFlow = (): Flow => (window.location.pathname === '/auth/confirm' ? 'confirm' : 'normal')

export const App = () => {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabase)
  const [flow, setFlow] = useState<Flow>(initialFlow)
  const [forgot, setForgot] = useState(false)
  const [notice, setNotice] = useState<MessageKey | null>(null)
  const [access, setAccess] = useState<Access | null>(null)
  const [mfa, setMfa] = useState<MfaStep | null>(null)
  const [page, setPage] = useState<Page>('home')

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  // Signs out this browser only; "Sign out everywhere" is an Admin action.
  const signOut = useCallback(async (why: MessageKey | null = null) => {
    await supabase?.auth.signOut({ scope: 'local' })
    setAccess(null)
    setMfa(null)
    setPage('home')
    setNotice(why)
    setFlow('normal')
    window.history.replaceState(null, '', '/')
  }, [])

  // Whenever the session changes, re-read who this is and whether a code is needed.
  const userId = session?.user.id
  const aal = session ? (JSON.parse(atob(session.access_token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { aal?: string }).aal : undefined
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      const me = await loadAccess()
      if (cancelled) return
      if (!me || me.disabled) return void signOut('login.error.disabled')
      setAccess(me)
      setMfa(await mfaStep(me.needsMfa))
    })()
    return () => {
      cancelled = true
    }
  }, [userId, aal, signOut])

  const onIdle = useCallback(() => void signOut('login.idle'), [signOut])
  useIdleTimeout(Boolean(session), onIdle)

  const refreshMfa = useCallback(async () => {
    if (access) setMfa(await mfaStep(access.needsMfa))
  }, [access])

  const onConfirmed = useCallback(() => setFlow('set-password'), [])
  const backToLogin = useCallback(() => {
    window.history.replaceState(null, '', '/')
    setFlow('normal')
  }, [])

  if (!ready) return null

  if (flow === 'confirm') return <Confirm onConfirmed={onConfirmed} onBack={backToLogin} />

  if (!session) {
    return forgot ? <Forgot onBack={() => setForgot(false)} /> : <Login notice={notice} onForgot={() => setForgot(true)} />
  }

  // Ignore anything loaded for a previous sign-in.
  if (!access || access.userId !== userId || mfa === null) return null

  if (flow === 'set-password') {
    // Someone with an authenticator must confirm a code before changing their password.
    if (mfa === 'challenge') return <MfaChallenge onDone={() => void refreshMfa()} onSignOut={() => void signOut()} />
    return (
      <SetPassword
        onDone={() => {
          window.history.replaceState(null, '', '/')
          setFlow('normal')
        }}
      />
    )
  }

  if (mfa === 'enroll') return <MfaEnroll onDone={() => void refreshMfa()} onSignOut={() => void signOut()} />
  if (mfa === 'challenge') return <MfaChallenge onDone={() => void refreshMfa()} onSignOut={() => void signOut()} />

  const isAdmin = access.roles.includes('admin')
  return (
    <Shell access={access} page={page} onNavigate={setPage} onSignOut={() => void signOut()}>
      {page === 'admin-users' && isAdmin ? (
        <Users meId={access.userId} />
      ) : page === 'brand' ? (
        <Brand isAdmin={isAdmin} />
      ) : page === 'players' ? (
        <Players isAdmin={isAdmin} />
      ) : page === 'sponsors' ? (
        <Sponsors isAdmin={isAdmin} />
      ) : (
        <Home team={access.team} isAdmin={isAdmin} onNavigate={setPage} />
      )}
    </Shell>
  )
}
