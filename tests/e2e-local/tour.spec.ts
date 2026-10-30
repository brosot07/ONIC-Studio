import { test, type Page } from '@playwright/test'
import { createPerson, resetLocalUsers, PASSWORD } from '../support/local'
import { totp } from '../support/totp'

/**
 * Screenshot tour of every screen, for reviews and handover. Run with TOUR=1.
 * Output: test-results/tour/<lang>-<theme>-<nn>-<screen>.png
 */
test.skip(!process.env['TOUR'], 'set TOUR=1 to capture the screenshot tour')

const combos = [
  { lang: 'Bahasa', code: 'id', theme: 'light' },
  { lang: 'English', code: 'en', theme: 'light' },
  { lang: 'English', code: 'en', theme: 'dark' },
] as const

for (const c of combos) {
  test(`tour ${c.code} ${c.theme}`, async ({ page }) => {
    await resetLocalUsers()
    await createPerson('dimas@onic.test', ['admin', 'approver'], null)
    await createPerson('sari@onic.test', ['social_designer'], 'social')
    await createPerson('maya@onic.test', ['merch_designer'], 'merch')
    await createPerson('rafi@onic.test', ['social_designer'], 'social')

    let n = 0
    const shot = async (name: string) =>
      page.screenshot({ path: `test-results/tour/${c.code}-${c.theme}-${String(++n).padStart(2, '0')}-${name}.png` })

    const setup = async (p: Page) => {
      await p.goto('/')
      await p.getByRole('button', { name: c.lang }).click()
      await p.getByRole('combobox').selectOption(c.theme)
    }

    await setup(page)
    await shot('sign-in')

    await page.getByRole('button', { name: /Forgot your password|Lupa kata sandi/ }).click()
    await shot('forgot-password')
    await page.getByRole('button', { name: /Back to sign in|Kembali ke halaman masuk/ }).click()

    // Admin's first sign-in: two-step setup.
    await page.locator('input[type=email]').fill('dimas@onic.test')
    await page.locator('input[type=password]').fill(PASSWORD)
    await page.locator('button[type=submit]').click()
    await page.locator('.secret').waitFor()
    await shot('two-step-setup')
    const secret = (await page.locator('.secret').textContent())!.trim()
    await page.locator('.code-input').fill(totp(secret))
    await page.locator('button[type=submit]').click()
    await page.locator('.sidebar').waitFor()
    await shot('home-admin')

    await page.locator('.nav-item').nth(1).click()
    await page.locator('.table').waitFor()
    await shot('people')
    await page.locator('.page-head .btn-primary').click()
    await page.getByRole('dialog').waitFor()
    await shot('invite')
    await page.keyboard.press('Escape')

    // Next sign-in: code entry.
    await page.locator('.sidebar-foot .btn').click()
    await page.locator('input[type=email]').fill('dimas@onic.test')
    await page.locator('input[type=password]').fill(PASSWORD)
    await page.locator('button[type=submit]').click()
    await page.locator('.code-input').waitFor()
    await shot('code-entry')
    await page.locator('.code-input').fill('123456')
    await page.locator('button[type=submit]').click()
    await page.getByRole('alert').waitFor()
    await shot('code-wrong')
    await page.locator('.code-input').fill(totp(secret))
    await page.locator('button[type=submit]').click()
    await page.locator('.sidebar').waitFor()
    await page.locator('.sidebar-foot .btn').click()

    // Designer.
    await page.locator('input[type=email]').fill('sari@onic.test')
    await page.locator('input[type=password]').fill('wrong-password')
    await page.locator('button[type=submit]').click()
    await page.getByRole('alert').waitFor()
    await shot('sign-in-error')
    await page.locator('input[type=password]').fill(PASSWORD)
    await page.locator('button[type=submit]').click()
    await page.locator('.sidebar').waitFor()
    await shot('home-designer')
  })
}
