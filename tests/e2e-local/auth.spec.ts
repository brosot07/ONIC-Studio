import { test, expect, type Page } from '@playwright/test'
import { createPerson, enrolTotp, local, PASSWORD, resetLocalUsers, signIn } from '../support/local'
import { totp } from '../support/totp'

/** Latest email to `to` from the local mail catcher, as HTML. */
const latestEmail = async (to: string): Promise<string> => {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${local.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const list = (await res.json()) as { messages: { ID: string }[] }
    if (list.messages.length) {
      const msg = (await (await fetch(`${local.mailpit}/api/v1/message/${list.messages[0]!.ID}`)).json()) as { HTML: string }
      return msg.HTML
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no email for ${to}`)
}

/** The /auth/confirm link from an email, pointed at the app under test. */
const confirmLink = (html: string, baseURL: string): string => {
  const href = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(html)![1]!.replace(/&amp;/g, '&')
  const url = new URL(href)
  return `${baseURL}/auth/confirm${url.search}`
}

const signInUi = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const clearMail = () => fetch(`${local.mailpit}/api/v1/messages`, { method: 'DELETE' })

test.beforeEach(async () => {
  await resetLocalUsers()
  await clearMail()
})

test('a designer signs in without a code and sees no admin pages', async ({ page }) => {
  await createPerson('sari@onic.test', ['social_designer'], 'social')
  await signInUi(page, 'sari@onic.test')
  await expect(page.getByRole('heading', { name: 'What do you want to make?' })).toBeVisible()
  await expect(page.getByText('Social Media')).toBeVisible()
  await expect(page.getByRole('button', { name: 'People' })).toHaveCount(0)
})

test('wrong password gives a plain-language error', async ({ page }) => {
  await createPerson('sari@onic.test', ['social_designer'], 'social')
  await signInUi(page, 'sari@onic.test', 'Wrong-password-1!')
  await expect(page.getByRole('alert')).toHaveText('That email and password don’t match. Check them and try again.')
})

test('an Admin must set up two-step sign-in before anything else', async ({ page }) => {
  await createPerson('boss@onic.test', ['admin', 'approver'], null)
  await signInUi(page, 'boss@onic.test')
  await expect(page.getByRole('heading', { name: 'Set up two-step sign-in' })).toBeVisible()
  const secret = (await page.locator('.secret').textContent())!.trim()

  await page.getByLabel('6-digit code').fill('000000')
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('alert')).toContainText('That code didn’t work')

  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('button', { name: 'People' })).toBeVisible()
  await page.screenshot({ path: 'test-results/local/home-admin.png' })

  // Next sign-in asks for the code instead of setting it up again.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await signInUi(page, 'boss@onic.test')
  await expect(page.getByRole('heading', { name: 'Enter your sign-in code' })).toBeVisible()
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('button', { name: 'People' })).toBeVisible()
})

test('Admin invites a merch designer, who sets a password and signs in', async ({ page, baseURL }) => {
  await createPerson('boss@onic.test', ['admin', 'approver'], null)
  const secret = await enrolTotp(await signIn('boss@onic.test'))

  await signInUi(page, 'boss@onic.test')
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm' }).click()
  await page.getByRole('button', { name: 'People' }).click()
  await page.getByRole('button', { name: 'Invite someone' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Full name').fill('Maya Merch')
  await dialog.getByLabel('Work email').fill('maya@onic.test')
  await dialog.getByLabel('Social Designer').uncheck()
  await dialog.getByLabel('Merch Designer').check()
  await expect(dialog.getByText('Team: Merchandise')).toBeVisible()
  await dialog.getByRole('button', { name: 'Send invite' }).click()
  await expect(page.getByRole('status')).toHaveText('Invite sent. They’ll get an email to set their password.')
  const row = page.getByRole('row', { name: /Maya Merch/ })
  await expect(row).toContainText('Merchandise')
  await expect(row).toContainText('Invite sent')
  await page.screenshot({ path: 'test-results/local/admin-people.png', fullPage: true })

  const link = confirmLink(await latestEmail('maya@onic.test'), baseURL!)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto(link)
  await expect(page.getByRole('heading', { name: /Choose a password|Buat kata sandi/ })).toBeVisible()
  expect(page.url()).not.toContain('token_hash')
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByLabel('New password').fill('short')
  await page.getByLabel('Type it again').fill('short')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('alert')).toContainText('at least 12 characters')
  await page.getByLabel('New password').fill('Merch-Designer-2026!')
  await page.getByLabel('Type it again').fill('Merch-Designer-2026!')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('heading', { name: 'What do you want to make?' })).toBeVisible()
  await expect(page.getByText('Merchandise')).toBeVisible()

  // The same link can't be used twice.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.goto(link)
  await expect(page.getByRole('alert')).toContainText(/expired|kedaluwarsa/)
})

test('a turned-off account cannot sign in', async ({ page }) => {
  await createPerson('boss@onic.test', ['admin', 'approver'], null)
  await createPerson('sari@onic.test', ['social_designer'], 'social')
  const secret = await enrolTotp(await signIn('boss@onic.test'))

  await signInUi(page, 'boss@onic.test')
  await page.getByLabel('6-digit code').fill(totp(secret))
  await page.getByRole('button', { name: 'Confirm' }).click()
  await page.getByRole('button', { name: 'People' }).click()
  page.once('dialog', (d) => void d.accept())
  await page.getByRole('row', { name: /sari/ }).getByRole('button', { name: 'Turn off account' }).click()
  await expect(page.getByRole('row', { name: /sari/ })).toContainText('Turned off')

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await signInUi(page, 'sari@onic.test')
  await expect(page.getByRole('alert')).toHaveText('This account is turned off. Ask an Admin if you need access.')
})

test('forgot password sends a link that sets a new password', async ({ page, baseURL }) => {
  await createPerson('sari@onic.test', ['social_designer'], 'social')
  await page.goto('/')
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByRole('button', { name: 'Forgot your password?' }).click()
  await page.getByLabel('Work email').fill('sari@onic.test')
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('status')).toContainText('Check your inbox')

  await page.goto(confirmLink(await latestEmail('sari@onic.test'), baseURL!))
  await page.getByLabel('New password').fill('Brand-New-Pass-77?')
  await page.getByLabel('Type it again').fill('Brand-New-Pass-77?')
  await page.getByRole('button', { name: 'Save password' }).click()
  await expect(page.getByRole('heading', { name: 'What do you want to make?' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await signInUi(page, 'sari@onic.test', 'Brand-New-Pass-77?')
  await expect(page.getByRole('heading', { name: 'What do you want to make?' })).toBeVisible()
})

test('30 minutes without activity signs the person out', async ({ page }) => {
  await createPerson('sari@onic.test', ['social_designer'], 'social')
  await page.clock.install()
  await signInUi(page, 'sari@onic.test')
  await expect(page.getByRole('heading', { name: 'What do you want to make?' })).toBeVisible()
  await page.clock.fastForward('31:00')
  await expect(page.getByText('You were signed out after 30 minutes without activity.')).toBeVisible()
})
