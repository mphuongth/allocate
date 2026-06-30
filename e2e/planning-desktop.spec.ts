import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Force desktop viewport for every test in this file
test.use({ viewport: { width: 1280, height: 800 } })

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()

// Presence/render coverage (DTopBar title, month picker + prev/next, empty state,
// summary strip Income/Outflow/Remaining + the remaining = income − outflow math,
// line-item full-vs-compact amounts, By goal / Fixed expenses / Insurance sections,
// allocation card, Manage savings opens the manager) lives in the fast component test
// app/(app)/planning/components/__tests__/DesktopPlanningView.test.tsx.
//
// Only this one stays E2E: a real DCA fund seeded under its goal (the goal_id fix)
// must group correctly AND its Record-buy must open the canonical Add-Transaction
// sheet — a data-driven, cross-component round-trip a single-view component test
// can't reproduce.
test('desktop planning: a DCA fund is grouped under its goal with a Buy action and contributed footer', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: `E2E DCA Goal ${Date.now()}` })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({
    name: 'E2E DCA Fund', code: `EDCA${Date.now() % 100000}`, fund_type: 'equity', nav: 10000,
    is_dca: true, dca_monthly_amount_vnd: 3_000_000, dca_goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteFund(fund.id))
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  const desktop = page.getByTestId('desktop-planning')

  // The DCA fund is seeded under its goal (goal_id fix) and shows a Record buy pill.
  // CI runs the app in Vietnamese, so match the aria-label bilingually.
  await expect(desktop.getByText('E2E DCA Fund')).toBeVisible({ timeout: 8_000 })
  await expect(desktop.getByRole('button', { name: /Record buy|Ghi nhận mua/i }).first()).toBeVisible()
  // The allocation card shows the contributed-this-month footer.
  await expect(desktop.getByTestId('planning-contributed')).toBeVisible()

  // Clicking Buy opens the canonical Add-Transaction sheet (pre-filled), not a
  // mini popup — the asset-type picker (Fund / Bank / Gold) is the giveaway.
  // The asset-type labels are hard-coded English, so they're locale-proof in CI.
  await desktop.getByRole('button', { name: /Record buy|Ghi nhận mua/i }).first().click()
  await expect(page.getByRole('button', { name: 'Gold', exact: true })).toBeVisible({ timeout: 5_000 })
})
