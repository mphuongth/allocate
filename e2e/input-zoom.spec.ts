import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// ─── iOS auto-zoom on text fields (issue #265) ───────────────────────────────
// iOS Safari zooms the viewport when a focused native field has font-size < 16px
// and never resets it, leaving the whole app zoomed. Every native <input>,
// <textarea>, and <select> the user can focus must render at >= 16px on mobile.
//
// These tests assert the *rendered* font-size (the user-visible outcome), not the
// markup, so a regression in any backing style — Tailwind class, .cn-input, or an
// inline style override — is caught.

test.use({ viewport: { width: 390, height: 844 } })

// Native fields that trigger the zoom. Buttons (incl. base-ui Select triggers),
// checkboxes, ranges, etc. don't zoom, so they're excluded.
const ZOOMABLE_FIELDS =
  'textarea, select, ' +
  'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color])' +
  ':not([type=file]):not([type=submit]):not([type=button]):not([type=reset])' +
  ':not([type=hidden]):not([type=image])'

async function expectNoZoomFields(page: Page) {
  const sizes = await page.locator(`${ZOOMABLE_FIELDS}`).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null) // visible only
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? null,
        hint: el.id || el.getAttribute('placeholder') || el.getAttribute('name') || '',
        fontSize: parseFloat(getComputedStyle(el).fontSize),
      }))
  )
  expect(sizes.length).toBeGreaterThan(0)
  const tooSmall = sizes.filter((f) => f.fontSize < 16)
  expect(tooSmall, `fields below 16px would trigger iOS zoom: ${JSON.stringify(tooSmall)}`).toEqual([])
}

async function useEnglish(page: Page) {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
}

test.describe('Settings — no field triggers iOS zoom', () => {
  test('profile sheet inputs render at >=16px', async ({ page }) => {
    await useEnglish(page)
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /profile/i }).click()
    await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 5_000 })
    await expectNoZoomFields(page)
  })
})

test.describe('Fund library — no field triggers iOS zoom', () => {
  test('search input renders at >=16px', async ({ page }) => {
    await useEnglish(page)
    await page.goto('/funds')
    await page.waitForLoadState('networkidle')
    const search = page.getByTestId('mobile-funds').getByPlaceholder(/search|tìm/i)
    await expect(search).toBeVisible({ timeout: 10_000 })
    const fontSize = await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
  })

  test('add-fund form inputs render at >=16px', async ({ page }) => {
    await useEnglish(page)
    await page.goto('/funds')
    await page.waitForLoadState('networkidle')
    await page.getByTestId('mobile-top-bar').getByRole('button', { name: /add/i }).click()
    // The name field's placeholder confirms the form is open.
    await expect(page.getByPlaceholder(/Vanguard|S&P/i)).toBeVisible({ timeout: 5_000 })
    await expectNoZoomFields(page)
  })

  // Regression for #321: the DCA goal <select> only renders for DCA-enabled funds,
  // so the loads-a-fresh-page tests above never exercise it. iOS persists the
  // focus-zoom across reloads, so a <16px select left the whole Fund page zoomed
  // on subsequent first loads.
  test('DCA goal select renders at >=16px', async ({ page }) => {
    const fund = await api.createFund({
      name: 'E2E Zoom DCA Fund', code: 'E2EZM', fund_type: 'equity', nav: 45000,
      is_dca: true, dca_monthly_amount_vnd: 1_000_000,
    })
    cleanup.add(() => api.deleteFund(fund.id))

    await useEnglish(page)
    await page.goto('/funds')
    await page.waitForLoadState('networkidle')

    const select = page.getByTestId('mobile-funds').getByTestId(`dca-goal-${fund.id}`)
    await expect(select).toBeVisible({ timeout: 10_000 })
    const fontSize = await select.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(fontSize).toBeGreaterThanOrEqual(16)
  })
})
