import type { Role, Team } from '@onic/shared'
import { supabase } from './supabase'

export interface Access {
  userId: string
  fullName: string
  email: string
  team: Team | null
  roles: Role[]
  needsMfa: boolean
  disabled: boolean
}

/** The signed-in person's own roles and team, readable before two-step sign-in. */
export const loadAccess = async (): Promise<Access | null> => {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('my_access').maybeSingle()
  if (error || !data) return null
  const row = data as {
    user_id: string
    full_name: string
    email: string
    team: Team | null
    roles: Role[]
    needs_mfa: boolean
    disabled: boolean
  }
  return {
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    team: row.team,
    roles: row.roles,
    needsMfa: row.needs_mfa,
    disabled: row.disabled,
  }
}

export type MfaStep = 'none' | 'enroll' | 'challenge'

/**
 * Admin/Approver without a verified authenticator → enroll.
 * Anyone with an authenticator who hasn't entered a code this session → challenge.
 */
export const mfaStep = async (needsMfa: boolean): Promise<MfaStep> => {
  if (!supabase) return 'none'
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (data?.currentLevel === 'aal2') return 'none'
  if (data?.nextLevel === 'aal2') return 'challenge'
  return needsMfa ? 'enroll' : 'none'
}

/** Calls an Edge Function and returns its plain-language error message, if any. */
export const callFunction = async <T,>(name: string, body: Record<string, unknown>): Promise<{ data?: T; message?: string }> => {
  if (!supabase) return { message: 'Not connected.' }
  const { data, error } = await supabase.functions.invoke<T>(name, { body })
  if (!error) return { data: data ?? undefined }
  const context = (error as { context?: Response }).context
  if (context && typeof context.json === 'function') {
    try {
      const payload = (await context.json()) as { message?: string }
      if (payload.message) return { message: payload.message }
    } catch {
      // fall through
    }
  }
  return { message: undefined }
}
