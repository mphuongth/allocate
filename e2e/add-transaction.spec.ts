import { test, expect } from '@playwright/test'

// Mobile viewport — the add button lives in the bottom tab bar (md:hidden)
test.use({ viewport: { width: 390, height: 844 } })

// Trimmed in #597. What used to live here — the add button appearing on each of
// the four tabbed pages, the Fund/Bank/Gold chips, the Buy/Sell (and Bank's
// Deposit/Withdraw) pair, the Save/Cancel actions, and the body scroll lock —
// is prop-driven rendering that a browser only re-proved at ~1 page load each:
//   app/components/navigation/__tests__/MobileBottomTabs.test.tsx
//     (the center + on /dashboard, /planning, /funds, /settings)
//   app/assets/components/__tests__/AddTransactionSheet.test.tsx
//     (asset-type / direction matrix, Cancel closes, scroll lock, iOS zoom)
// Two things a browser is still the only witness to stay: the entry point
// actually wiring the tab-bar button to the sheet inside the real layout (the
// smoke gate), and the title's position relative to real scroll containers,
// which depends on layout jsdom does not compute.

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
})

test('clicking the add button opens Add transaction sheet', { tag: '@smoke' }, async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
})

test('Add transaction sheet — title sits outside the scrollable body (structurally pinned)', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()

  const title = page.getByRole('heading', { name: /add transaction/i })
  await expect(title).toBeVisible({ timeout: 5_000 })

  // Structural assertion: no ancestor of the title is an overflow:auto/scroll
  // container — guarantees the title can't scroll away regardless of form length.
  // The sheet is rendered as a sibling of <main> (so we don't hit main's own
  // overflow:auto on the way up).
  const isOutsideScroll = await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find((h) =>
      /add transaction/i.test(h.textContent ?? '')
    )
    if (!heading) return null
    let el: HTMLElement | null = heading.parentElement
    while (el) {
      const cs = getComputedStyle(el)
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return false
      el = el.parentElement
    }
    return true
  })
  expect(isOutsideScroll).toBe(true)
})
