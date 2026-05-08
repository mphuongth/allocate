import { test, expect } from '@playwright/test'

test.describe('PDF Report download', () => {
  // Use :visible to target whichever instance is visible at the current viewport
  // (mobile button in MobileTopBar vs desktop button in the content area)
  const reportBtn = (page: import('@playwright/test').Page) =>
    page.locator('[data-testid="generate-report-btn"]:visible').first()

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="generate-report-btn"]:visible', { timeout: 15_000 })
  })

  test('shows generate report button on dashboard', async ({ page }) => {
    await expect(reportBtn(page)).toBeVisible()
  })

  test('clicking the button downloads a PDF file with the correct filename', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      reportBtn(page).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^allocate-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  test('button becomes disabled while the PDF is generating', async ({ page }) => {
    await reportBtn(page).click()
    await expect(reportBtn(page)).toBeDisabled()
  })

  test('button returns to enabled state after download completes', async ({ page }) => {
    await Promise.all([
      page.waitForEvent('download'),
      reportBtn(page).click(),
    ])
    await expect(reportBtn(page)).toBeEnabled({ timeout: 5_000 })
  })
})
