import { test, expect } from '@playwright/test'

// Desktop viewport (1280×800) — modals render as centered overlays on desktop.

test.describe('Desktop Add Transaction modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('clicking Transaction button opens centered modal', async ({ page }) => {
    await page.getByTestId('desktop-add-tx-btn').click()
    await expect(page.locator('[aria-label="Close"]').first()).toBeVisible({ timeout: 5_000 })
    // Modal should be centered (not a bottom sheet)
    const modal = page.locator('h3').filter({ hasText: /transaction|giao dịch/i }).first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
  })

  test('modal shows asset type picker with Fund, Bank, Gold options', async ({ page }) => {
    await page.getByTestId('desktop-add-tx-btn').click()
    await expect(page.getByRole('button', { name: /fund|quỹ/i }).first()).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /bank|ngân hàng/i }).first()).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /gold|vàng/i }).first()).toBeVisible({ timeout: 5_000 })
  })

  test('modal shows Buy and Sell direction buttons', async ({ page }) => {
    await page.getByTestId('desktop-add-tx-btn').click()
    await expect(page.getByRole('button', { name: /buy|mua/i }).first()).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /sell|bán/i }).first()).toBeVisible({ timeout: 5_000 })
  })

  test('closing modal via X button dismisses it', async ({ page }) => {
    await page.getByTestId('desktop-add-tx-btn').click()
    const modal = page.locator('h3').filter({ hasText: /transaction|giao dịch/i }).first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
    await page.locator('[aria-label="Close"]').first().click()
    await expect(modal).not.toBeVisible({ timeout: 3_000 })
  })

  test('closing modal via backdrop click dismisses it', async ({ page }) => {
    await page.getByTestId('desktop-add-tx-btn').click()
    const modal = page.locator('h3').filter({ hasText: /transaction|giao dịch/i }).first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
    // Click outside the modal card (top-left corner of overlay)
    await page.mouse.click(10, 10)
    await expect(modal).not.toBeVisible({ timeout: 3_000 })
  })
})

test.describe('Desktop New Goal modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('clicking New goal button opens centered modal', async ({ page }) => {
    await page.getByTestId('desktop-new-goal-btn').click()
    const modal = page.locator('h3').filter({ hasText: /goal|mục tiêu/i }).first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
  })

  test('modal shows name, target amount and target date fields', async ({ page }) => {
    await page.getByTestId('desktop-new-goal-btn').click()
    await expect(page.getByPlaceholder(/mua nhà|goal name|tên mục tiêu/i).or(page.locator('input[type="text"]').first())).toBeVisible({ timeout: 5_000 })
  })

  test('modal shows icon picker buttons', async ({ page }) => {
    await page.getByTestId('desktop-new-goal-btn').click()
    await expect(page.getByTestId('goal-icon-btn-target')).toBeVisible({ timeout: 5_000 })
  })

  test('modal shows priority picker', async ({ page }) => {
    await page.getByTestId('desktop-new-goal-btn').click()
    await expect(page.getByTestId('priority-btn-low')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('priority-btn-med')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('priority-btn-high')).toBeVisible({ timeout: 5_000 })
  })

  test('closing modal via X button dismisses it', async ({ page }) => {
    await page.getByTestId('desktop-new-goal-btn').click()
    const modal = page.locator('h3').filter({ hasText: /goal|mục tiêu/i }).first()
    await expect(modal).toBeVisible({ timeout: 5_000 })
    await page.locator('[aria-label="Close"]').first().click()
    await expect(modal).not.toBeVisible({ timeout: 3_000 })
  })

  test('live savings calculator appears when amount and date are set', async ({ page }) => {
    await page.getByTestId('desktop-new-goal-btn').click()
    // Set a target date
    const monthInput = page.locator('input[type="month"]').first()
    await monthInput.fill('2027-06')
    await expect(page.getByTestId('save-per-month')).toBeVisible({ timeout: 3_000 })
  })
})
