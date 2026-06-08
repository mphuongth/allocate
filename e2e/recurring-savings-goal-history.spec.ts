import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Regression: a recurring saving allocated to a goal must surface on the goal —
// both in the History tab and in the goal's saved/progress value — for months
// that have arrived (the real-saved model, mirroring insurance). Previously
// recurring savings lived only in the recurring_savings table and were never
// counted toward the goal, so they showed up nowhere on the goal detail.

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

const now = new Date()
const MONTH = now.getMonth() + 1
const YEAR = now.getFullYear()
const MONTH_START = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`

test('recurring saving shows in goal history and counts toward progress', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Recurring Goal', target_amount: 100_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  // The current (realized) month must have a plan for the saving to be counted.
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  const saving = await api.createRecurringSaving({
    name: 'E2E VCB Recurring',
    goal_id: goal.goal_id,
    amount_vnd: 7_000_000,
    effective_from: MONTH_START,
  })
  cleanup.add(() => api.deleteRecurringSaving(saving.saving_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const goalCard = page.getByText('E2E Recurring Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 10_000 })
  await goalCard.click()

  const panel = page.getByTestId('desktop-goal-detail')
  await expect(panel).toBeVisible({ timeout: 5_000 })

  // Progress: the goal's saved value reflects the realized recurring saving (7M).
  await expect(panel.getByTestId('desktop-goal-detail-value')).toContainText('7.000.000', { timeout: 5_000 })

  // History: the recurring saving is listed as a contribution row.
  await panel.getByRole('button', { name: /^(History|Lịch sử)$/ }).click()
  await expect(panel.getByText('E2E VCB Recurring')).toBeVisible({ timeout: 5_000 })
})
