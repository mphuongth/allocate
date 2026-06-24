import { test, expect } from '@playwright/test'

// Desktop viewport — tests the new two-column DesktopSettingsView
test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
})

// ─── Page header ───────────────────────────────────────────────────────────────

test('desktop settings shows Preferences heading', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Preferences' })).toBeVisible()
})

test('desktop settings shows Settings subtitle', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=Settings')).toBeVisible()
})

// ─── Profile card ──────────────────────────────────────────────────────────────

test('desktop: profile card shows user email', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-profile-card"]')).toContainText('@')
})

test('desktop: Edit button on profile card is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^edit$/i })).toBeVisible()
})

test('desktop: clicking Edit opens profile modal', async ({ page }) => {
  await page.getByRole('button', { name: /^edit$/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('textbox').first()).toBeVisible()
})

test('desktop: profile modal prefills name and email', async ({ page }) => {
  await page.getByRole('button', { name: /^edit$/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  const nameVal = await page.getByRole('textbox').first().inputValue()
  const emailVal = await page.getByRole('textbox').nth(1).inputValue()
  expect(nameVal.length).toBeGreaterThan(0)
  expect(emailVal).toContain('@')
})

test('desktop: profile modal closes when Cancel is clicked', async ({ page }) => {
  await page.getByRole('button', { name: /^edit$/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^cancel$/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
})

// ─── Preferences — Language ────────────────────────────────────────────────────

test('desktop: Language label is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=Language')).toBeVisible()
})

test('desktop: English and Tiếng Việt language pills are visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tiếng Việt' })).toBeVisible()
})

// ─── Preferences — Appearance ──────────────────────────────────────────────────

test('desktop: Appearance label is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=Appearance')).toBeVisible()
})

test('desktop: Light, Dark, System appearance pills are visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^light$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^dark$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^system$/i })).toBeVisible()
})

// ─── Preferences — Currency (removed) ──────────────────────────────────────────

test('desktop: Currency control is removed (was a dead control)', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'VND' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'USD' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'EUR' })).toHaveCount(0)
})

// ─── Price sync ────────────────────────────────────────────────────────────────

test('desktop: Price sync section heading is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=Price sync')).toBeVisible()
})

test('desktop: Sync now button is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /sync now/i })).toBeVisible()
})

test('desktop: Fund NAV row is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=Fund NAV')).toBeVisible()
})

test('desktop: Gold price row is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=/gold price/i')).toBeVisible()
})

test('desktop: clicking Sync now triggers cron API calls', async ({ page }) => {
  const syncResponse = page.waitForResponse(
    r => r.url().includes('/api/cron/refresh'),
    { timeout: 15_000 }
  )
  await page.getByRole('button', { name: /sync now/i }).click()
  await syncResponse
  await expect(page.getByRole('button', { name: /sync now/i })).toBeEnabled({ timeout: 5_000 })
})

// ─── Data ─────────────────────────────────────────────────────────────────────

test('desktop: Data section heading is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').getByText('Data', { exact: true })).toBeVisible()
})

test('desktop: Export data row is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /export data/i })).toBeVisible()
})

test('desktop: clicking Export data opens download report sheet', async ({ page }) => {
  await page.getByRole('button', { name: /export data/i }).click()
  await expect(page.locator('text=Portfolio report').first()).toBeVisible({ timeout: 8_000 })
})

// ─── Profile save propagates to sidebar ────────────────────────────────────────

test('desktop: saving a new name updates the sidebar avatar/name without a refresh', async ({ page }) => {
  const sidebar = page.locator('[data-testid="desktop-sidebar"]')
  await expect(sidebar).toBeVisible()

  // Capture the sidebar's pre-save name so we can assert it changed afterward.
  const before = (await sidebar.innerText()).trim()

  await page.getByRole('button', { name: /^edit$/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  const nameInput = page.getByRole('textbox').first()
  await nameInput.fill('Sidebar Sync Test')
  await page.getByRole('button', { name: /^save$/i }).click()

  // No router.refresh, no page reload — the sidebar should reflect the new
  // name purely through NavigationContext.setUserName.
  await expect(sidebar).toContainText('Sidebar Sync Test', { timeout: 5_000 })
  // Avatar initials reflect the new name ("Sidebar Sync Test" → "SS").
  await expect(sidebar).toContainText('SS')
  expect(before).not.toContain('Sidebar Sync Test')
})

// ─── Sign out ──────────────────────────────────────────────────────────────────

test('desktop: Sign out button is visible', async ({ page }) => {
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
})

// ─── Version ──────────────────────────────────────────────────────────────────

test('desktop: version text is visible', async ({ page }) => {
  await expect(page.locator('[data-testid="desktop-settings-view"]').locator('text=/v\\d/')).toBeVisible()
})
