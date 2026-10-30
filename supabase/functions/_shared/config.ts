/** Web origins allowed to call Edge Functions and to receive sign-in links. */
const PRODUCTION_ORIGINS: readonly string[] = [
  // Added when Vercel is connected, e.g. 'https://studio.onic.gg'.
]

// Local development and end-to-end tests only: the local stack is never reachable from the internet.
const LOCAL_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:4174']
const isLocalStack = /^http:\/\/(kong|127\.0\.0\.1|localhost)(:\d+)?$/.test(Deno.env.get('SUPABASE_URL') ?? '')

export const ALLOWED_ORIGINS: readonly string[] = isLocalStack ? [...PRODUCTION_ORIGINS, ...LOCAL_ORIGINS] : PRODUCTION_ORIGINS

export const isAllowedOrigin = (origin: string | null): origin is string =>
  origin !== null && ALLOWED_ORIGINS.includes(origin)
