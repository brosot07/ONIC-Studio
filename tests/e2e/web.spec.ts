import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const vercel = JSON.parse(readFileSync(resolve(__dirname, '../../apps/web/vercel.json'), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[]
}

/** Smoke + browser-hardening checks against the production build (vite preview mirrors vercel.json). */

test('opens on the sign-in screen in Bahasa Indonesia', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('Masuk')
  await page.screenshot({ path: 'test-results/login.png' })
})

test('language toggle switches to English and is remembered', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.locator('h1')).toHaveText('Sign in')
  await page.reload()
  await expect(page.locator('h1')).toHaveText('Sign in')
})

test('dark mode follows the choice', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox').selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'test-results/login-dark.png' })
})

test('sends strict security headers', async ({ request }) => {
  const res = await request.get('/')
  const h = res.headers()
  expect(h['content-security-policy']).toContain("default-src 'none'")
  expect(h['content-security-policy']).toContain("script-src 'self'")
  expect(h['content-security-policy']).not.toContain('unsafe-inline')
  expect(h['content-security-policy']).not.toContain('unsafe-eval')
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['content-security-policy']).toContain("require-trusted-types-for 'script'")
  // Every production header is served exactly as configured.
  for (const { key, value } of vercel.headers[0]!.headers) expect(h[key.toLowerCase()]).toBe(value)
})

// Enable once the CSP names ONIC's exact Supabase project instead of *.supabase.co.
test.fixme('cannot send data to another Supabase project', async ({ page }) => {
  await page.goto('/')
  const blocked = await page.evaluate(() => fetch('https://evil-project.supabase.co').then(() => false, () => true))
  expect(blocked).toBe(true)
})

test('injected inline script is blocked', async ({ page }) => {
  await page.goto('/')
  const outcome = await page.evaluate(
    () =>
      new Promise<string>((done) => {
        document.addEventListener('securitypolicyviolation', (e) => done(e.violatedDirective))
        try {
          const script = document.createElement('script')
          script.textContent = 'window.__injected = true'
          document.head.append(script)
        } catch {
          // Trusted Types refuses the assignment before CSP is even consulted.
          return done('trusted-types')
        }
        setTimeout(() => done('ran'), 500)
      }),
  )
  expect(['trusted-types', 'require-trusted-types-for', 'script-src-elem']).toContain(outcome)
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined()
})

test('cannot talk to hosts outside the allowlist', async ({ page }) => {
  await page.goto('/')
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com')
      return false
    } catch {
      return true
    }
  })
  expect(blocked).toBe(true)
})
