import { test, expect } from '@playwright/test'

test.describe('PDF Report download', () => {
  // Use :visible to target whichever instance is visible at the current viewport
  // (mobile button in MobileTopBar vs desktop button in the content area)
  const reportBtn = (page: import('@playwright/test').Page) =>
    page.locator('[data-testid="generate-report-btn"]:visible').first()

  const exportBtn = (page: import('@playwright/test').Page) =>
    page.locator('[data-testid="export-report-btn"]')

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForSelector('[data-testid="generate-report-btn"]:visible', { timeout: 15_000 })
  })

  test('shows generate report button on dashboard', async ({ page }) => {
    await expect(reportBtn(page)).toBeVisible()
  })

  test('clicking the button opens the report sheet', async ({ page }) => {
    await reportBtn(page).click()
    await expect(exportBtn(page)).toBeVisible({ timeout: 5_000 })
  })

  test('clicking the button downloads a PDF file with the correct filename', { tag: '@smoke' }, async ({ page }) => {
    await reportBtn(page).click()
    await expect(exportBtn(page)).toBeVisible({ timeout: 5_000 })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportBtn(page).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^allocate-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  test('export button becomes disabled while the PDF is generating', async ({ page }) => {
    await reportBtn(page).click()
    await expect(exportBtn(page)).toBeVisible({ timeout: 5_000 })
    await exportBtn(page).click()
    await expect(exportBtn(page)).toBeDisabled()
  })

  test('success indicator appears after download completes', async ({ page }) => {
    await reportBtn(page).click()
    await expect(exportBtn(page)).toBeVisible({ timeout: 5_000 })
    await Promise.all([
      page.waitForEvent('download'),
      exportBtn(page).click(),
    ])
    await expect(page.locator('[data-testid="export-success"]')).toBeVisible({ timeout: 10_000 })
  })
})
