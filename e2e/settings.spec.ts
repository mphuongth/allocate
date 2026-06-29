import { test, expect } from '@playwright/test'

// Settings page uses md:hidden — must run at mobile viewport.
//
// Presence/render coverage (every "X is visible", sheet/modal open-close, prefill,
// localized labels, Currency-removed, etc.) lives in the fast component test
// app/(app)/settings/components/__tests__/MobileSettingsView.test.tsx. Only the two
// real round-trips that a component test (which mocks Supabase/fetch) cannot prove
// stay here: a profile save propagating to the live sidebar via NavigationContext,
// and Sync now hitting the real cron endpoints.
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
