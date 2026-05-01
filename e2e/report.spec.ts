import { test, expect } from '@playwright/test'

test.describe('PDF Report download', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    // Wait for the generate-report button to confirm the dashboard has loaded
    await page.waitForSelector('[data-testid="generate-report-btn"]', { timeout: 15_000 })
  })

  test('shows generate report button on dashboard', async ({ page }) => {
    await expect(page.getByTestId('generate-report-btn')).toBeVisible()
  })

  test('clicking the button downloads a PDF file with the correct filename', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('generate-report-btn').click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^allocate-report-\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  test('button becomes disabled while the PDF is generating', async ({ page }) => {
    await page.getByTestId('generate-report-btn').click()
    // The button should be disabled immediately after click during generation
    await expect(page.getByTestId('generate-report-btn')).toBeDisabled()
  })

  test('button returns to enabled state after download completes', async ({ page }) => {
    await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('generate-report-btn').click(),
    ])
    await expect(page.getByTestId('generate-report-btn')).toBeEnabled({ timeout: 5_000 })
  })
})
