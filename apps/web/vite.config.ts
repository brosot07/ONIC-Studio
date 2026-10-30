import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Mirrors vercel.json so local preview and e2e tests get the same browser rules as production. */
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const securityHeaders = Object.fromEntries(vercel.headers[0]!.headers.map((h) => [h.key, h.value]))

// End-to-end tests against a LOCAL Supabase stack also need to reach it. Only ever a loopback
// address, and only in `vite preview`; production headers come from vercel.json alone.
const e2eApi = process.env['ONIC_E2E_SUPABASE_URL']
if (e2eApi && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(e2eApi)) {
  const csp = securityHeaders['Content-Security-Policy']!
  securityHeaders['Content-Security-Policy'] = csp
    .replace('connect-src ', `connect-src ${e2eApi} `)
    .replace('img-src ', `img-src ${e2eApi} `)
    .replace('; upgrade-insecure-requests', '')
}

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  preview: { headers: securityHeaders },
})
