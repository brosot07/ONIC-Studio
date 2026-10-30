import { isAllowedOrigin } from './config.ts'

const corsHeaders = (origin: string | null): Record<string, string> =>
  isAllowedOrigin(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' }

export const json = (req: Request, status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req.headers.get('Origin')) },
  })

/** A failure the person can act on. `message` is shown in the app; never include internals. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export const preflight = (req: Request): Response | null => {
  if (req.method !== 'OPTIONS') return null
  return new Response(null, { status: isAllowedOrigin(req.headers.get('Origin')) ? 204 : 403, headers: corsHeaders(req.headers.get('Origin')) })
}

export const handle =
  (fn: (req: Request) => Promise<Response>) =>
  async (req: Request): Promise<Response> => {
    const early = preflight(req)
    if (early) return early
    if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed', message: 'Use POST.' })
    try {
      return await fn(req)
    } catch (err) {
      if (err instanceof HttpError) return json(req, err.status, { error: err.code, message: err.message })
      // Log the class of error only; request bodies and tokens never reach the logs.
      console.error('unhandled', err instanceof Error ? err.name : typeof err)
      return json(req, 500, { error: 'server_error', message: 'Something went wrong on our side. Try again in a minute.' })
    }
  }
