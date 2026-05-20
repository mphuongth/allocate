import { test, expect } from '@playwright/test'

// All tests run on Desktop Chrome (1280×800) by default from playwright config.
// These verify the two-column desktop layout for the Overview page.

test.describe('Desktop overview layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('renders two-column desktop layout container', async ({ page }) => {
    await expect(page.getByTestId('desktop-overview')).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel is visible on the right side', async ({ page }) => {
    await expect(page.getByTestId('desktop-net-worth-panel')).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel shows Net worth label', async ({ page }) => {
    await expect(
      page.getByTestId('desktop-net-worth-panel').getByText(/net worth|tài sản ròng/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel shows allocation bar when investments exist', async ({ page }) => {
    // Global setup seeds a bank transaction so allocation data is always present
    await expect(page.getByTestId('allocation-bar')).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel shows download report button', async ({ page }) => {
    await expect(page.getByTestId('generate-report-btn')).toBeVisible({ timeout: 10_000 })
  })

  test('desktop layout is not visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('desktop-overview')).not.toBeVisible()
  })
})
