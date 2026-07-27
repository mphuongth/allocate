import { test, expect } from '@playwright/test'

// Settings page uses md:hidden — must run at mobile viewport.
//
// Presence/render coverage (every "X is visible", sheet/modal open-close, prefill,
// localized labels, Currency-removed, etc.) lives in the fast component test
// app/(app)/settings/components/__tests__/MobileSettingsView.test.tsx. Only the two
// real round-trips that a component test (which mocks Supabase/fetch) cannot prove
// stay here: a profile save propagating to the live sidebar via NavigationContext,
// and Sync now reaching the real user-scoped refresh endpoints with a session
// the server accepts.
test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  // Force English locale (app defaults to 'vi' when no cookie is set)
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
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

// This is the test that let #552 through: it waited for *a response* and a
// re-enabled button, and a 401 satisfies both. The button had been calling the
// cron routes, which need CRON_SECRET in a header a browser never sends, so it
// reported "Sync failed" to every user while the spec stayed green.
//
// Split in two, because the two halves need different things to be real:
//   • that the request is authenticated has to hit the actual endpoint;
//   • that the UI reports success must not depend on a third-party site being
//     up, so those responses are stubbed.
test('Sync now calls the user-scoped endpoints and is authenticated', async ({ page }) => {
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

  // 401 is the precise failure #552 was: the browser could not authenticate to
  // the endpoint the button called. A 502 (upstream provider down) is fine here —
  // that's the scrape's problem, not the wiring's.
  expect(nav.status(), 'NAV refresh must not reject the session').not.toBe(401)
  expect(gold.status(), 'gold refresh must not reject the session').not.toBe(401)

  await expect(page.getByRole('button', { name: /sync now/i })).toBeEnabled({ timeout: 10_000 })
})

test('Sync now reports success when both refreshes succeed', async ({ page }) => {
  // Stubbed so the assertion is about the app's own success path rather than
  // whether DOJI and the fund providers happen to be reachable right now.
  await page.route('**/api/v1/funds/refresh-nav', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[{"id":"f1","nav":10000}]}' }))
  await page.route('**/api/v1/gold-price/refresh', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"price_per_chi":8500000}' }))

  await page.getByRole('button', { name: /sync now/i }).click()

  await expect(page.getByText(/updated/i).first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/sync failed/i)).toHaveCount(0)
})

test('Sync now distinguishes a rate-limited sync from a failure', async ({ page }) => {
  await page.route('**/api/v1/funds/refresh-nav', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"results":[{"id":"f1","nav":10000}]}' }))
  await page.route('**/api/v1/gold-price/refresh', r =>
    r.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'Retry-After': '30' },
      body: '{"error":"Too many refresh requests."}',
    }))

  await page.getByRole('button', { name: /sync now/i }).click()

  await expect(page.getByText(/too many syncs/i)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/sync failed/i)).toHaveCount(0)
})
