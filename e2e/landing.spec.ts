import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

// Trimmed in #597. The landing page's static markup — wordmark, nav links and
// their targets, hero copy, the six feature cards, the three numbered steps, the
// plan spotlight, both CTAs — is now pinned where it renders, without a browser:
//   app/__tests__/landingPage.test.tsx      (the page's own tree, en + vi)
//   features/landing/__tests__/LandingMockups.test.tsx      (the two mockups)
//   features/landing/__tests__/LandingProductTour.test.tsx  (tabs, locale, a11y)
// Twenty page loads proved things a server-component render proves for free.
//
// Three things survive here, because each needs a real browser:
//   • the tour PNG must actually decode — the files are produced by a script and
//     imported by no module, so a rename or a missed regeneration yields a broken
//     image that every unit test happily passes through;
//   • the language toggle has to round-trip through the locale cookie and a
//     server re-render, not just re-style a button;
//   • the marketing page has to really route a visitor into the signup flow.

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
})

test('product tour screenshot actually loads', async ({ page }) => {
  await page.goto('/')
  const shot = page.locator('#tour img')
  await expect(shot).toBeVisible()
  await expect.poll(() => shot.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
})

test('hero Get started free CTA lands on the signup page', async ({ page }) => {
  await page.goto('/')
  await page.locator('.lp-hero-ctas').getByRole('link', { name: /get started/i }).click()
  await expect(page).toHaveURL(/auth\/signup/)
})

test('the language toggle round-trips the whole page through the locale cookie', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('perfectly tracked')

  await page.locator('nav').getByRole('button', { name: 'VI' }).click()
  await page.waitForURL('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('mục tiêu')

  await page.locator('nav').getByRole('button', { name: 'EN' }).click()
  await page.waitForURL('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('perfectly tracked')
})
