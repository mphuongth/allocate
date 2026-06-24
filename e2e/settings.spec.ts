import { test, expect } from '@playwright/test'

// Settings page uses md:hidden — must run at mobile viewport
test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  // Force English locale (app defaults to 'vi' when no cookie is set)
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
})

// ─── Page load ─────────────────────────────────────────────────────────────────

test('settings page loads at /settings', async ({ page }) => {
  await expect(page).toHaveURL(/settings/)
})

// ─── Profile card ──────────────────────────────────────────────────────────────

test('profile card is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /profile/i })).toBeVisible()
})

test('profile card shows user email', async ({ page }) => {
  const card = page.getByRole('button', { name: /profile/i })
  // The test user email contains @
  await expect(card).toContainText('@')
})

test('profile card shows avatar initials', async ({ page }) => {
  const card = page.getByRole('button', { name: /profile/i })
  const text = await card.innerText()
  // Avatar initials: 1-2 uppercase letters appear somewhere in the card text
  expect(text).toMatch(/[A-Z]{1,2}/)
})

// ─── Profile sheet ─────────────────────────────────────────────────────────────

test('clicking profile card opens profile sheet', async ({ page }) => {
  await page.getByRole('button', { name: /profile/i }).click()
  await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 5_000 })
})

test('profile sheet prefills name and email inputs', async ({ page }) => {
  await page.getByRole('button', { name: /profile/i }).click()
  const nameInput = page.getByRole('textbox').first()
  await expect(nameInput).toBeVisible({ timeout: 5_000 })
  const nameVal = await nameInput.inputValue()
  const emailVal = await page.getByRole('textbox').nth(1).inputValue()
  expect(nameVal.length).toBeGreaterThan(0)
  expect(emailVal).toContain('@')
})

test('profile sheet closes when Cancel is clicked', async ({ page }) => {
  await page.getByRole('button', { name: /profile/i }).click()
  await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^cancel$/i }).click()
  await expect(page.getByRole('textbox').first()).not.toBeVisible({ timeout: 5_000 })
})

test('saving a new display name updates the profile card', async ({ page }) => {
  await page.getByRole('button', { name: /profile/i }).click()
  const nameInput = page.getByRole('textbox').first()
  await expect(nameInput).toBeVisible({ timeout: 5_000 })
  await nameInput.fill('E2E Test User')
  await page.getByRole('button', { name: /^save$/i }).click()
  // Target the visible profile card by role — other parts of the layout
  // (desktop sidebar hidden via md:hidden, mobile drawer translated off-screen)
  // also render the name now that it's wired into NavigationContext.
  await expect(page.getByRole('button', { name: /profile/i })).toContainText('E2E Test User', { timeout: 5_000 })
})

// ─── Preferences section ───────────────────────────────────────────────────────

test('Preferences section heading is visible', async ({ page }) => {
  await expect(page.locator('text=Preferences').first()).toBeVisible()
})

test('Language row is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^language$/i })).toBeVisible()
})

test('Appearance row is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^appearance$/i })).toBeVisible()
})

test('Currency row is removed (was a dead control)', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^currency$/i })).toHaveCount(0)
})

test('Language row shows current locale', async ({ page }) => {
  const row = page.getByRole('button', { name: /^language$/i })
  await expect(row).toContainText('English')
})

// ─── Appearance sheet ──────────────────────────────────────────────────────────

test('clicking Appearance row opens appearance sheet', async ({ page }) => {
  await page.getByRole('button', { name: /^appearance$/i }).click()
  await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible({ timeout: 5_000 })
})

test('appearance sheet shows Light, Dark, System options', async ({ page }) => {
  await page.getByRole('button', { name: /^appearance$/i }).click()
  await expect(page.locator('text=Light').first()).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('text=Dark').first()).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('text=System').first()).toBeVisible({ timeout: 5_000 })
})

test('clicking Apply closes appearance sheet', async ({ page }) => {
  await page.getByRole('button', { name: /^appearance$/i }).click()
  await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^apply$/i }).click()
  await expect(page.getByRole('button', { name: /^apply$/i })).not.toBeVisible({ timeout: 5_000 })
})

// ─── Data / Export section ─────────────────────────────────────────────────────

test('Data section heading is visible', async ({ page }) => {
  await expect(page.locator('text=Data').first()).toBeVisible()
})

test('Export data row is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /export data/i })).toBeVisible()
})

test('clicking Export data opens download report sheet', async ({ page }) => {
  await page.getByRole('button', { name: /export data/i }).click()
  await expect(page.locator('text=Portfolio report').first()).toBeVisible({ timeout: 8_000 })
})

test('download report sheet has an export button (PDF-only, no dead CSV picker)', async ({ page }) => {
  await page.getByRole('button', { name: /export data/i }).click()
  await expect(page.locator('text=Portfolio report').first()).toBeVisible({ timeout: 8_000 })
  await expect(page.getByRole('button', { name: /export report/i })).toBeVisible()
  // The CSV option was a dead control (always exported PDF) and was removed.
  await expect(page.getByRole('button', { name: /^csv$/i })).toHaveCount(0)
})

test('download report sheet closes when X close button is clicked', async ({ page }) => {
  await page.getByRole('button', { name: /export data/i }).click()
  await expect(page.locator('text=Portfolio report').first()).toBeVisible({ timeout: 8_000 })
  await page.getByRole('button', { name: /^close$/i }).click()
  await expect(page.locator('text=Portfolio report').first()).not.toBeVisible({ timeout: 5_000 })
})

// ─── Price sync section ────────────────────────────────────────────────────────

test('Price sync section heading is visible', async ({ page }) => {
  await expect(page.locator('text=Price sync').first()).toBeVisible()
})

test('Fund NAV row is visible', async ({ page }) => {
  await expect(page.locator('text=Fund NAV').first()).toBeVisible()
})

test('Gold price row is visible', async ({ page }) => {
  await expect(page.locator('text=/gold price/i').first()).toBeVisible()
})

test('Sync now button is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /sync now/i })).toBeVisible()
})

test('Last synced info is visible', async ({ page }) => {
  await expect(page.locator('text=/last synced/i').first()).toBeVisible()
})

test('clicking Sync now triggers cron API calls', async ({ page }) => {
  // Set up response waiter before click to avoid race condition
  const syncResponse = page.waitForResponse(
    r => r.url().includes('/api/cron/refresh'),
    { timeout: 15_000 }
  )
  await page.getByRole('button', { name: /sync now/i }).click()
  await syncResponse
  // Button is re-enabled after sync completes
  await expect(page.getByRole('button', { name: /sync now/i })).toBeEnabled({ timeout: 5_000 })
})

// ─── Sign out ──────────────────────────────────────────────────────────────────

test('Sign out button is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
})

// ─── Version text ──────────────────────────────────────────────────────────────

test('version text is visible', async ({ page }) => {
  await expect(page.locator('text=/v\\d/').first()).toBeVisible()
})
