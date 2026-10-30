import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { HttpError } from './http.ts'

const url = Deno.env.get('SUPABASE_URL')!

/** The project's secret key: new-style SUPABASE_SECRET_KEYS, falling back to the legacy service-role key. */
const secretKey = (): string => {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    const key = parsed['default'] ?? Object.values(parsed)[0]
    if (key) return key
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('secret key missing')
  return legacy
}

export const serverClient = (): SupabaseClient =>
  createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })

export interface Caller {
  id: string
  aal: string
  roles: string[]
  teamId: string | null
}

/**
 * Verifies the caller's sign-in token and loads their roles from the database.
 * Never trusts roles or team sent by the browser.
 */
export const requireCaller = async (req: Request, db: SupabaseClient): Promise<Caller> => {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'signed_out', 'Your session has ended. Sign in again.')
  const { data, error } = await db.auth.getClaims(token)
  if (error || !data?.claims?.sub) throw new HttpError(401, 'signed_out', 'Your session has ended. Sign in again.')
  const id = data.claims.sub
  const { data: profile } = await db.from('profiles').select('team_id, disabled').eq('id', id).maybeSingle()
  if (!profile || profile.disabled) throw new HttpError(403, 'disabled', 'This account is turned off. Ask an Admin.')
  const { data: roles } = await db.from('user_roles').select('role').eq('user_id', id)
  return { id, aal: String(data.claims['aal'] ?? 'aal1'), roles: (roles ?? []).map((r) => r.role as string), teamId: profile.team_id }
}

export const requireAdmin = async (req: Request, db: SupabaseClient): Promise<Caller> => {
  const caller = await requireCaller(req, db)
  if (!caller.roles.includes('admin')) throw new HttpError(403, 'not_admin', 'Only Admins can do this.')
  if (caller.aal !== 'aal2') throw new HttpError(403, 'mfa_required', 'Confirm it’s you with your authenticator code first.')
  return caller
}

export const rateLimit = async (db: SupabaseClient, userId: string, bucket: string, max: number, windowSeconds: number) => {
  const { data, error } = await db.rpc('rate_limit_hit', { p_user: userId, p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds })
  if (error) throw error
  if (!data) throw new HttpError(429, 'slow_down', 'Too many changes in a short time. Wait a minute and try again.')
}

export const audit = async (db: SupabaseClient, actor: string, action: string, target: string | null, details: Record<string, unknown> = {}) => {
  const { error } = await db.rpc('audit_event', { p_actor: actor, p_action: action, p_target: target, p_details: details })
  if (error) throw error
}
