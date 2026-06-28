import { test, expect } from '@playwright/test'

// Mobile viewport — FAB is md:hidden
test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
})

// ─── FAB visibility ──────────────────────────────────────────────────────────

test('FAB is visible on dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /add transaction/i })).toBeVisible()
})

// The FAB is contextual (PR #390): it belongs only on Overview and Funds. On Plan
// you add via the plan's own rows, so the FAB must NOT appear there.
test('FAB is hidden on planning page', async ({ page }) => {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /add transaction/i })).toHaveCount(0)
})

test('FAB is hidden on settings page', async ({ page }) => {
  await page.goto('/settings')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /add transaction/i })).toHaveCount(0)
})

test('FAB is visible on funds page', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /add transaction/i })).toBeVisible()
})

// ─── Sheet open / close ──────────────────────────────────────────────────────

test('clicking FAB opens Add transaction sheet', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
})

test('Add transaction sheet has Fund, Bank, Gold type options', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: /^fund$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^bank$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^gold$/i })).toBeVisible()
})

test('Add transaction sheet has Buy and Sell direction buttons', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: /^buy$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^sell$/i })).toBeVisible()
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

test('Add transaction sheet has a Save button', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible()
})

test('Add transaction sheet closes when Cancel is clicked', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^cancel$/i }).click()
  await expect(page.locator('text=Add transaction').first()).not.toBeVisible({ timeout: 5_000 })
})

// ─── Background scroll lock (issue #219) ─────────────────────────────────────
// While the sheet is open the page behind it must not scroll, otherwise the user
// can drag the underlying page around behind the modal.
test('opening the sheet locks background scroll', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.evaluate(() => getComputedStyle(document.body).overflow)).resolves.not.toBe('hidden')

  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })

  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
})

test('closing the sheet restores background scroll', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')

  await page.getByRole('button', { name: /^cancel$/i }).click()
  await expect(page.locator('text=Add transaction').first()).not.toBeVisible({ timeout: 5_000 })
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
})

test('switching to Bank type shows Deposit and Withdraw directions', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^bank$/i }).click()
  await expect(page.getByRole('button', { name: /^deposit$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^withdraw$/i })).toBeVisible()
})
