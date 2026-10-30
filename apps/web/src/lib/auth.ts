import type { AuthError } from '@supabase/supabase-js'
import type { MessageKey } from '@onic/shared'

export const isNetworkError = (e: unknown): boolean =>
  e instanceof TypeError || (typeof e === 'object' && e !== null && 'name' in e && (e as { name: string }).name === 'AuthRetryableFetchError')

/** Maps Supabase password errors to plain-language messages. */
export const passwordErrorKey = (error: AuthError): MessageKey => {
  const code = error.code ?? ''
  if (code === 'weak_password') {
    const reasons = (error as AuthError & { reasons?: string[] }).reasons ?? []
    return reasons.includes('pwned') ? 'password.leaked' : 'password.weak'
  }
  if (code === 'same_password') return 'password.same'
  if (isNetworkError(error)) return 'common.error.network'
  return 'common.error.generic'
}

/** Mirrors the server rule so people get instant feedback; the server still decides. */
export const isStrongPassword = (p: string): boolean =>
  p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p)
