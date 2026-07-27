import { test, expect } from '@playwright/test'

// Desktop viewport — the two-column DesktopSettingsView.
//
// Presence/render coverage (headings, profile card, Edit modal prefill/close,
// language + appearance pills, Currency-removed, Price sync / Data rows, Sign out,
// version) lives in the fast component test
// app/(app)/settings/components/__tests__/DesktopSettingsView.test.tsx. Only the two
// real round-trips that a component test (which mocks Supabase/fetch) cannot prove
// stay here: a profile save propagating to the live desktop sidebar via
// NavigationContext, and Sync now reaching the real user-scoped refresh endpoints
// with a session the server accepts.
test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
})

// Both views shared the same broken wiring, so both specs asserted the cron URL
// and both stayed green while the button reported "Sync failed" (#552). The
// mobile spec carries the fuller coverage; this keeps the desktop view honest
// about the one thing that differs — its own handler.
test('desktop: Sync now calls the user-scoped endpoints and is authenticated', async ({ page }) => {
  const navResponse = page.waitForResponse(
    r => r.url().includes('/api/v1/funds/refresh-nav'),
    { timeout: 20_000 }
  )
  const goldResponse = page.waitForResponse(
    r => r.url().includes('/api/v1/gold-price/refresh'),
    { timeout: 20_000 }
  )
  await page.getByRole('button', { name: /sync now/i }).click()
  const [nav, gold] = await Promise.all([navResponse, goldResponse])

  // 401 is exactly what the cron routes returned to a browser.
  expect(nav.status(), 'NAV refresh must not reject the session').not.toBe(401)
  expect(gold.status(), 'gold refresh must not reject the session').not.toBe(401)

  await expect(page.getByRole('button', { name: /sync now/i })).toBeEnabled({ timeout: 10_000 })
})

test('desktop: Sync now reports success when both refreshes succeed', async ({ page }) => {
  await page.route('**/api/v1/funds/refresh-nav', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"updated":0}' }))
  await page.route('**/api/v1/gold-price/refresh', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"price_per_chi":8500000}' }))

  await page.getByRole('button', { name: /sync now/i }).click()

  await expect(page.getByText(/updated/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/sync failed/i)).toHaveCount(0)
})

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
