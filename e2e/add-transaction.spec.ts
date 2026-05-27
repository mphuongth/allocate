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

test('FAB is visible on planning page', async ({ page }) => {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: /add transaction/i })).toBeVisible()
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

test('Add transaction sheet — title stays pinned when body scrolls', async ({ page }) => {
  // Short viewport so the form definitely overflows and the body can scroll
  await page.setViewportSize({ width: 390, height: 400 })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()

  const title = page.getByRole('heading', { name: /add transaction/i })
  await expect(title).toBeVisible({ timeout: 5_000 })

  const initialBox = await title.boundingBox()
  expect(initialBox).not.toBeNull()

  // Find the first overflow-y:auto descendant inside the sheet and scroll it
  const scrolledTop = await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll('h3')).find((h) =>
      /add transaction/i.test(h.textContent ?? '')
    )
    const sheet = heading?.closest('div')?.parentElement
    if (!sheet) return -1
    const scroller = Array.from(sheet.querySelectorAll<HTMLElement>('div')).find((el) => {
      const cs = getComputedStyle(el)
      return cs.overflowY === 'auto' && el.scrollHeight > el.clientHeight
    })
    if (!scroller) return -1
    scroller.scrollTop = 200
    return scroller.scrollTop
  })
  expect(scrolledTop).toBeGreaterThan(0)

  await page.waitForTimeout(100)
  const scrolledBox = await title.boundingBox()
  expect(scrolledBox).not.toBeNull()
  expect(Math.round(scrolledBox!.y)).toBe(Math.round(initialBox!.y))
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

test('switching to Bank type shows Deposit and Withdraw directions', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /add transaction/i }).click()
  await expect(page.locator('text=Add transaction').first()).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^bank$/i }).click()
  await expect(page.getByRole('button', { name: /^deposit$/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /^withdraw$/i })).toBeVisible()
})
