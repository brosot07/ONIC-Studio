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
  await db.from('events').delete().not('id', 'is', null)
  await db.from('sub_brands').delete().not('name', 'in', '("ONIC ID","ONIC PH","ONIC Padel")')
}

/** Brand, Players and Sponsors sit in the Library menu. */
const openLibrary = async (page: Page, name: 'Brand' | 'Players' | 'Events' | 'Sponsors') => {
  const menu = page.getByRole('button', { name: 'Library' })
  if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click()
  await page.getByRole('button', { name, exact: true }).click()
}

/** The first bytes of an MP4 file: an ftyp box, then some media data. */
const tinyMp4 = () => {
  const b = Buffer.alloc(4096)
  b.writeUInt32BE(24, 0)
  b.write('ftypisom', 4, 'ascii')
  b.writeUInt32BE(4072, 24)
  b.write('mdat', 28, 'ascii')
  return b
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
  await openLibrary(page, 'Players')
  await page.getByRole('button', { name: 'Add a player' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Full name').fill('Kairi Rayosdelsol')
  await dialog.getByLabel('IGN').fill('KAIRI')
  await dialog.getByLabel('The player agreed to appear in ONIC content').check()
  await dialog.getByRole('button', { name: 'Save' }).click()

  await page.locator('.player-card', { hasText: 'KAIRI' }).click()
  const row = page.locator('.page')
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

test('an Admin adds a new sub-brand and files its logo under it', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  const slot = page.locator('.slot', { hasText: 'Sub-brand logos' })
  await slot.getByLabel('Which sub-brand?').selectOption({ label: '+ Add a new sub-brand…' })
  await slot.getByLabel('New sub-brand name').fill('onic ph')
  await slot.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(slot.getByRole('alert')).toContainText('already on the list')
  await slot.getByLabel('New sub-brand name').fill('ONIC MY')
  await slot.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(slot.getByLabel('Which sub-brand?')).toHaveValue('ONIC MY')
  await slot.locator('input[type=file]').setInputFiles({ name: 'onic-my.svg', mimeType: 'image/svg+xml', buffer: LOGO_SVG })
  await expect(slot.getByText('onic-my.svg added')).toBeVisible()
  await expect(slot.locator('.tile-name')).toContainText('ONIC MY')
  await page.screenshot({ path: 'test-results/local/sub-brand.png', fullPage: true })
})

test('player videos: an MP4 is kept with the player, a file that only looks like one is refused', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  await openLibrary(page, 'Players')
  await page.getByRole('button', { name: 'Add a player' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Full name').fill('Sanford Vinuya')
  await dialog.getByLabel('IGN').fill('SANZ')
  await dialog.getByLabel('The player agreed to appear in ONIC content').check()
  await dialog.getByRole('button', { name: 'Save' }).click()

  await page.locator('.player-card', { hasText: 'SANZ' }).click()
  const row = page.locator('.page')
  const videos = row.locator('.entity-drops > div', { hasText: 'Videos (MP4 or MOV)' }).locator('input[type=file]')
  await videos.setInputFiles({ name: 'fake.mp4', mimeType: 'video/mp4', buffer: Buffer.from('<html>not a video</html>') })
  await expect(row.locator('.is-refused')).toContainText('fake.mp4')
  await videos.setInputFiles({ name: 'sanz-intro.mp4', mimeType: 'video/mp4', buffer: tinyMp4() })
  await expect(row.getByText('sanz-intro.mp4 added')).toBeVisible()
  await expect(row.locator('.tile video')).toHaveCount(1)
  const { data } = await serverClient().from('player_assets').select('kind, mime, bytes').eq('kind', 'video')
  expect(data).toEqual([{ kind: 'video', mime: 'video/mp4', bytes: 4096 }])
  await page.screenshot({ path: 'test-results/local/player-video.png' })
})

test('players are imported from a spreadsheet', async ({ page }) => {
  await signInAs(page, 'boss@onic.test', adminSecret)
  await openLibrary(page, 'Players')
  const csv = 'name,ign,role_lane,team_name,status,rights_expires_on,consent,notes\nA One,ALPHA,Mid,ONIC ID,active,2030-01-01,yes,\nB Two,BETA,Gold,ONIC ID,loaned,,no,\nBad Row,,,,,,,\n'
  await page.locator('.csv input[type=file]').setInputFiles({ name: 'players.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('status')).toHaveText('2 rows imported.')
  await expect(page.getByRole('alert')).toContainText('Row 4')
  await expect(page.locator('.player-card')).toHaveCount(2)
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
  await openLibrary(page, 'Players')
  await expect(page.getByText('SHOWN')).toBeVisible()
  await expect(page.getByText('HIDDEN')).toHaveCount(0)
  await expect(page.getByText('Only Admins can change the libraries.')).toBeVisible()
  await expect(page.locator('input[type=file]')).toHaveCount(0)
  await openLibrary(page, 'Sponsors')
  await expect(page.getByText('Running Co')).toBeVisible()
  await expect(page.getByText('Ended Co')).toHaveCount(0)
})

test('match day: a Social designer makes a named event, drops the photos, tags players and finds them again', async ({ page }) => {
  const db = serverClient()
  await db.from('players').insert([
    { name: 'Kairi Rayosdelsol', ign: 'KAIRI', consent: true },
    { name: 'Sanford Vinuya', ign: 'SANZ', consent: true },
  ])
  await signInAs(page, 'sari@onic.test')
  await openLibrary(page, 'Events')
  await page.getByRole('button', { name: 'New event' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Event name').fill('MPL ID S16 W3 · ONIC vs RRQ')
  await dialog.getByLabel('Opponent').fill('RRQ')
  await dialog.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByRole('heading', { name: 'MPL ID S16 W3 · ONIC vs RRQ' })).toBeVisible()
  await page.locator('.drop input[type=file]').setInputFiles([
    { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: testPng(800, 1000, false) },
    { name: 'IMG_0002.jpg', mimeType: 'image/jpeg', buffer: testPng(1000, 800, false) },
    { name: 'IMG_0003.jpg', mimeType: 'image/jpeg', buffer: testPng(900, 900, false) },
  ])
  await expect(page.locator('.media-tile')).toHaveCount(3)
  await expect(page.locator('.media-preview img')).toHaveCount(3)

  // Select the first two (click, then Shift-click) and tag KAIRI.
  await page.locator('.media-hit').nth(0).click()
  await page.locator('.media-hit').nth(1).click({ modifiers: ['Shift'] })
  await expect(page.getByText('2 selected')).toBeVisible()
  await page.locator('.tag-panel').getByRole('button', { name: 'KAIRI' }).click()
  await expect(page.locator('.tag-panel').getByRole('button', { name: 'KAIRI' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('Show').selectOption({ label: 'KAIRI' })
  await expect(page.locator('.media-tile')).toHaveCount(2)
  await page.getByLabel('Show').selectOption({ label: 'Not tagged yet' })
  await expect(page.locator('.media-tile')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/local/event.png', fullPage: true })

  // Find it again: by event name, and by player.
  await page.getByRole('button', { name: '← All events' }).click()
  await page.getByLabel('Search events').fill('rrq')
  await expect(page.locator('.event-card')).toHaveCount(1)
  await expect(page.locator('.event-card')).toContainText('3 photos · 0 videos')
  await page.getByLabel('Search events').fill('evos')
  await expect(page.getByText('No events match your search.')).toBeVisible()
  await page.getByLabel('Find photos of a player').selectOption({ label: 'KAIRI' })
  await expect(page.locator('.media-tile')).toHaveCount(2)
  await expect(page.locator('.media-caption').first()).toHaveText('MPL ID S16 W3 · ONIC vs RRQ')

  // The player's own page shows them too.
  await openLibrary(page, 'Players')
  await page.locator('.player-card', { hasText: 'KAIRI' }).click()
  await expect(page.getByRole('heading', { name: 'Event photos' })).toBeVisible()
  await expect(page.locator('.media-tile')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/local/player-page.png', fullPage: true })
})

test('event photos of a player whose rights ended disappear for designers; merch designers only look', async ({ page }) => {
  const db = serverClient()
  const { data: player } = await db.from('players').insert({ name: 'Kairi', ign: 'KAIRI', consent: true }).select('id').single()
  await createPerson('mira@onic.test', ['merch_designer'], 'merch')
  await signInAs(page, 'sari@onic.test')
  await openLibrary(page, 'Events')
  await page.getByRole('button', { name: 'New event' }).click()
  await page.getByRole('dialog').getByLabel('Event name').fill('Photoshoot Jersey 2027')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.locator('.drop input[type=file]').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: testPng(800, 1000, false) },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: testPng(800, 1000, false) },
  ])
  await expect(page.locator('.media-tile')).toHaveCount(2)
  await page.locator('.media-hit').first().click()
  await page.locator('.tag-panel').getByRole('button', { name: 'KAIRI' }).click()
  await expect(page.locator('.media-tags').first()).toHaveText('KAIRI')

  await db.from('players').update({ rights_expires_on: '2020-01-01' }).eq('id', player!.id)
  await page.reload()
  await page.locator('.sidebar').waitFor()
  await openLibrary(page, 'Events')
  await page.locator('.event-card', { hasText: 'Photoshoot Jersey 2027' }).click()
  await expect(page.locator('.media-tile')).toHaveCount(1)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await signInAs(page, 'mira@onic.test')
  await openLibrary(page, 'Events')
  await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0)
  await expect(page.getByText('Only Admins and Social designers can add events and photos.')).toBeVisible()
  await page.locator('.event-card', { hasText: 'Photoshoot Jersey 2027' }).click()
  await expect(page.locator('.media-tile')).toHaveCount(1)
  await expect(page.locator('.drop')).toHaveCount(0)
})
