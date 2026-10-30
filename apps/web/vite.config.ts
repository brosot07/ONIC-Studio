import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Mirrors vercel.json so local preview and e2e tests get the same browser rules as production. */
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}
const securityHeaders = Object.fromEntries(vercel.headers[0]!.headers.map((h) => [h.key, h.value]))

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  preview: { headers: securityHeaders },
})
