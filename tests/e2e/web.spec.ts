import { test, expect } from '@playwright/test'

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
})

test('injected inline script is blocked', async ({ page }) => {
  await page.goto('/')
  const outcome = await page.evaluate(
    () =>
      new Promise<string>((done) => {
        document.addEventListener('securitypolicyviolation', (e) => done(e.violatedDirective))
        const script = document.createElement('script')
        script.textContent = 'window.__injected = true'
        document.head.append(script)
        setTimeout(() => done('ran'), 500)
      }),
  )
  expect(outcome).toBe('script-src-elem')
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
