import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { totp } from './totp'

/** Connection details of the LOCAL Supabase stack (`supabase start`). Never a hosted project. */
export const local = (() => {
  const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' })) as Record<string, string>
  return { url: status['API_URL']!, publishable: status['PUBLISHABLE_KEY']!, secret: status['SECRET_KEY']!, mailpit: status['MAILPIT_URL']! }
})()

export const PASSWORD = 'Correct-Horse-9-Battery'

export const serverClient = (): SupabaseClient =>
  createClient(local.url, local.secret, { auth: { persistSession: false, autoRefreshToken: false } })

export const userClient = (): SupabaseClient =>
  createClient(local.url, local.publishable, { auth: { persistSession: false, autoRefreshToken: false } })

type Role = 'admin' | 'approver' | 'social_designer' | 'merch_designer'

/** Creates a confirmed user with profile and roles directly (test setup only). */
export const createPerson = async (email: string, roles: Role[], team: 'social' | 'merch' | null) => {
  const db = serverClient()
  const { data, error } = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  const id = data.user.id
  const teamId = team ? (await db.from('teams').select('id').eq('slug', team).single()).data!.id : null
  const p = await db.from('profiles').insert({ id, org_id: '00000000-0000-4000-8000-000000000001', team_id: teamId, full_name: email.split('@')[0], email })
  if (p.error) throw p.error
  const r = await db.from('user_roles').insert(roles.map((role) => ({ user_id: id, role })))
  if (r.error) throw r.error
  return id
}

/** Signs in and, if a TOTP secret is given, completes two-step sign-in. Returns the client at aal2. */
export const signIn = async (email: string, totpSecret?: string): Promise<SupabaseClient> => {
  const client = userClient()
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  if (totpSecret) {
    const factors = await client.auth.mfa.listFactors()
    const factor = factors.data!.totp[0]!
    const { error: vErr } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(totpSecret) })
    if (vErr) throw vErr
  }
  return client
}

/** Enrols TOTP for a signed-in client and returns the secret. */
export const enrolTotp = async (client: SupabaseClient): Promise<string> => {
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'test' })
  if (error) throw error
  const { error: vErr } = await client.auth.mfa.challengeAndVerify({ factorId: data.id, code: totp(data.totp.secret) })
  if (vErr) throw vErr
  return data.totp.secret
}

export const resetLocalUsers = async () => {
  const db = serverClient()
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 })
  for (const u of data.users) await db.auth.admin.deleteUser(u.id)
}
