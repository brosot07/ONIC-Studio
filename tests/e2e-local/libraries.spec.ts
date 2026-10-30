import { test, expect, type Page } from '@playwright/test'
import { createPerson, enrolTotp, PASSWORD, resetLocalUsers, serverClient, signIn } from '../support/local'
import { totp } from '../support/totp'
import { testPng } from '../support/png'

const LOGO_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#FFD31A"/></svg>')
const EVIL_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10"/></svg>')
const DOCTYPE_SVG = Buffer.from('<!DOCTYPE svg [<!ENTITY ns "x">]><svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')

let adminSecret = ''

const resetLibraries = async () => {
  const db = serverClient()
  for (const t of ['player_assets', 'players', 'sponsor_assets', 'sponsors', 'brand_assets', 'brand_colors', 'voice_guides']) {
    await db.from(t).delete().not('id', 'is', null)
  }
}

const signInAs = async (page: Page, email: string, secret?: string) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'English' }).click()
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  if (secret) {
    await page.getByLabel('6-digit code').fill(totp(secret))
    await page.getByRole('button', { name: 'Confirm' }).click()
  }
  await page.locator('.sidebar').waitFor()
}

test.beforeEach(async () => {
  await resetLocalUsers()
  await resetLibraries()
  await createPerson('boss@onic.test', ['admin', 'approver'], null)
  await createPerson('sari@onic.test', ['social_designer'], 'social')
  adminSecret = await enrolTotp(await signIn('boss@onic.test'))
})

test('Admin sees the setup checklist on Home and uploads the primary logo', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  await expect(page.getByRole('heading', { name: 'Set up ONIC Studio' })).toBeVisible()
  const slot = page.locator('.slot', { hasText: 'ONIC logo, primary' })
  await expect(slot.locator('.pill')).toHaveText('Needed')
  await slot.locator('input[type=file]').setInputFiles({ name: 'onic-primary.svg', mimeType: 'image/svg+xml', buffer: LOGO_SVG })
  await expect(slot.getByText('onic-primary.svg added')).toBeVisible()
  await expect(slot.locator('.pill').first()).toHaveText('Ready')
  await expect(slot.locator('.tile img')).toBeVisible()
  await page.screenshot({ path: 'test-results/local/setup.png', fullPage: true })
})

test('an SVG with code in it is stored with the code removed', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  const slot = page.locator('.slot', { hasText: 'ONIC logo, mono' })
  await slot.locator('input[type=file]').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: EVIL_SVG })
  await expect(slot.getByText('evil.svg added')).toBeVisible()
  const db = serverClient()
  const { data: row } = await db.from('brand_assets').select('path').eq('variant', 'mono').single()
  const stored = await (await db.storage.from('brand').download(row!.path)).data!.text()
  expect(stored).toContain('<rect')
  expect(stored).not.toMatch(/onload|script|alert/)
})

test('an SVG with a document-type header is refused with instructions', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  const slot = page.locator('.slot', { hasText: 'ONIC logo, white' })
  await slot.locator('input[type=file]').setInputFiles({ name: 'illustrator.svg', mimeType: 'image/svg+xml', buffer: DOCTYPE_SVG })
  await expect(slot.locator('.is-refused')).toContainText('Export it again as a plain SVG')
  await expect(slot.locator('.pill').first()).toHaveText('Needed')
})

test('a non-transparent player cutout is refused with a clear message; a transparent one is accepted', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await page.getByRole('button', { name: 'Add a player' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Full name').fill('Kairi Rayosdelsol')
  await dialog.getByLabel('IGN').fill('KAIRI')
  await dialog.getByLabel('The player agreed to appear in ONIC content').check()
  await dialog.getByRole('button', { name: 'Save' }).click()

  const row = page.locator('.entity', { hasText: 'KAIRI' })
  const cutout = row.locator('.entity-drops > div', { hasText: 'Cutout (transparent PNG)' }).locator('input[type=file]')
  await cutout.setInputFiles({ name: 'kairi-white-bg.png', mimeType: 'image/png', buffer: testPng(900, 1200, false) })
  await expect(row.locator('.is-refused')).toHaveText(
    'kairi-white-bg.png: This cutout has a solid background. Export it as a PNG with a transparent background, then upload it again.',
  )
  await cutout.setInputFiles({ name: 'kairi.png', mimeType: 'image/png', buffer: testPng(900, 1200, true) })
  await expect(row.getByText('kairi.png added')).toBeVisible()
  await expect(row.locator('.tile img')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/local/players.png', fullPage: true })
})

test('players are imported from a spreadsheet', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  const csv = 'name,ign,role_lane,team_name,status,rights_expires_on,consent,notes\nA One,ALPHA,Mid,ONIC ID,active,2030-01-01,yes,\nB Two,BETA,Gold,ONIC ID,loaned,,no,\nBad Row,,,,,,,\n'
  await page.locator('.csv input[type=file]').setInputFiles({ name: 'players.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('status')).toHaveText('2 rows imported.')
  await expect(page.getByRole('alert')).toContainText('Row 4')
  await expect(page.locator('.entity')).toHaveCount(2)
})

test('designers see libraries read-only, and never players with expired rights', async ({ page }) => {
  const db = serverClient()
  await db.from('players').insert([
    { name: 'Usable', ign: 'SHOWN', consent: true, rights_expires_on: '2099-01-01' },
    { name: 'Expired', ign: 'HIDDEN', consent: true, rights_expires_on: '2020-01-01' },
  ])
  await db.from('sponsors').insert([
    { name: 'Running Co', contract_start: '2020-01-01', contract_end: '2099-01-01' },
    { name: 'Ended Co', contract_start: '2020-01-01', contract_end: '2021-01-01' },
  ])
  await signInAs(page, 'sari@onic.test')
  await expect(page.getByRole('heading', { name: 'Set up ONIC Studio' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Players', exact: true }).click()
  await expect(page.getByText('SHOWN')).toBeVisible()
  await expect(page.getByText('HIDDEN')).toHaveCount(0)
  await expect(page.getByText('Only Admins can change the libraries.')).toBeVisible()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Sponsors', exact: true }).click()
  await expect(page.getByText('Running Co')).toBeVisible()
  await expect(page.getByText('Ended Co')).toHaveCount(0)
})
