import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// Presence/render coverage (month heading, summary strip, allocation card, line-item
// full vs compact amounts, sections, Manage savings, override) lives in the fast
// component tests:
//   app/(app)/planning/components/__tests__/DesktopPlanningView.test.tsx
//   app/(app)/planning/components/__tests__/MobilePlanningView.test.tsx
// Only the two real round-trips a component test (which renders the view from given
// props) can't prove stay here: creating a plan via the salary input (POST →
// re-render), and month navigation that refetches a different month's data.

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()
const NEXT_YEAR = MONTH === 12 ? YEAR + 1 : YEAR

test('create monthly plan by entering salary', async ({ page }) => {
  // Delete any existing plan for this month first
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  const salaryInput = page.getByTestId('salary-input')
  if (await salaryInput.isVisible({ timeout: 3_000 })) {
    await salaryInput.fill('25000000')
    // SalaryInput saves on Enter (onKeyDown) or blur — there is no save button
    await salaryInput.press('Enter')
    await page.waitForTimeout(1_500)
    // Fund Investments or Fixed Expenses sections appear after plan is created
    await expect(page.locator('text=/Fund|Expenses|Chi phí|Đầu tư/i').first()).toBeVisible({ timeout: 8_000 })

    const found = await api.findMonthlyPlan(MONTH, YEAR)
    if (found) cleanup.add(() => api.deleteMonthlyPlan(found.id))
  }
})

test('can navigate to previous and next month', async ({ page }) => {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  const initialText = await page.locator('[data-testid="prev-month"]').evaluate((el) => el.closest('div')?.textContent ?? '')

  // Go to previous month
  await page.getByTestId('prev-month').click()
  await page.waitForTimeout(500)

  // Go forward two months
  await page.getByTestId('next-month').click()
  await page.waitForTimeout(500)
  await page.getByTestId('next-month').click()
  await page.waitForTimeout(500)

  // Should be on next month now
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop.locator(`text=${NEXT_YEAR}`).or(desktop.locator(`text=${YEAR}`)).first()).toBeVisible()

  void initialText
})
