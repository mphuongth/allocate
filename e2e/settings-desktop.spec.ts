import { test, expect } from '@playwright/test'

// Desktop viewport — the two-column DesktopSettingsView.
//
// Presence/render coverage (headings, profile card, Edit modal prefill/close,
// language + appearance pills, Currency-removed, Price sync / Data rows, Sign out,
// version) lives in the fast component test
// app/(app)/settings/components/__tests__/DesktopSettingsView.test.tsx. Only the one
// real round-trip that a component test (which mocks Supabase/fetch) cannot prove
// stays here: a profile save propagating to the live desktop sidebar via
// NavigationContext.
test.use({ viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
})

// Sync now is gone from this spec (#597). Both views drive the same
// useSettingsController, so "which URL does the button call" and "what does it
// report" are one behaviour tested twice at 1280px and at 390px. The mobile spec
// keeps the single un-stubbed round-trip that proves a browser session is
// accepted by the real endpoints (#552); the desktop view's own copy of the
// cron-route guard moved down to DesktopSettingsView.test.tsx.
//
// What stays is the one thing genuinely desktop-shaped: the sidebar only exists
// at this viewport, and nothing but a real save can prove it re-renders from
// NavigationContext without a route refresh.
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
