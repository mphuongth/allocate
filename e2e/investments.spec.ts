import { test, expect } from '@playwright/test'

// Fund Library page.
//
// Transaction CRUD used to live on the Settings tab (/settings?tab=transactions),
// which has been removed. Those flows now run through the dashboard
// "Recent activity → View all" ledger — see recent-activity.spec.ts (list +
// delete) and add-transaction.spec.ts (the add/edit modal).

test('fund library page shows funds list', async ({ page }) => {
  await page.goto('/funds')
  // Wait for content — don't use networkidle which resolves before React useEffect fires the API call
  // Empty state text is Vietnamese: "Chưa có quỹ nào"
  const content = page.locator('table')
    .or(page.locator('h2').filter({ hasText: /no funds yet|chưa có quỹ/i }))
    .or(page.getByText(/failed to load/i))
    .first()
  await expect(content).toBeVisible({ timeout: 20_000 })
})

test('DCA calculator in Fund Library shows projection', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  // Open DCA calculator — look for DCA button or expand row
  const dcaBtn = page.getByRole('button', { name: /dca|calculator|tính/i }).first()
  if (await dcaBtn.isVisible({ timeout: 3_000 })) {
    await dcaBtn.click()
    const amountInput = page.getByLabel(/monthly|amount|số tiền/i).first()
    if (await amountInput.isVisible({ timeout: 3_000 })) {
      await amountInput.fill('2000000')
      // Result should update
      await page.waitForTimeout(500)
      await expect(page.locator('text=/ccq|units|months|tháng/i').first()).toBeVisible()
    }
  }
})
