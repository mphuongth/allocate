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

async function netWorth(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get('/api/v1/dashboard/overview')
  expect(res.ok()).toBeTruthy()
  return (await res.json()).netWorth.netWorth as number
}

test('recurring saving shows in goal history and counts toward progress', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Recurring Goal', target_amount: 100_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  // The current (realized) month must have a plan for the saving to be counted.
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  // Net worth baseline before the recurring saving exists (delta is robust to
  // whatever else lives in the test account).
  const before = await netWorth(page)

  const saving = await api.createRecurringSaving({
    name: 'E2E VCB Recurring',
    goal_id: goal.goal_id,
    amount_vnd: 7_000_000,
    effective_from: MONTH_START,
  })
  cleanup.add(() => api.deleteRecurringSaving(saving.saving_id))

  // Net worth: the realized recurring saving (7M) is now counted. Use a tolerance
  // rather than exact equality — the account's interest-bearing deposits accrue
  // projected interest against the wall clock, so net worth drifts by a few VND
  // between the two reads.
  const delta = (await netWorth(page)) - before
  expect(delta).toBeGreaterThan(6_999_000)
  expect(delta).toBeLessThan(7_010_000)

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

test('a fulfilled recurring month is hidden from goal history (already folded into a deposit)', async ({ page }) => {
  // Regression: when a recurring saving's month is folded into a renewed/topped-up
  // deposit, a recurring_saving_fulfillments row records it and the amount lives in
  // that deposit's principal. The goal detail must NOT also synthesize the recurring
  // contribution row, or the goal shows it twice — once as the recurring row, once
  // inside the deposit. The dashboard overview already honours fulfillments; the
  // goal-detail recurring-contributions endpoint must too.
  const goal = await api.createGoal({ goal_name: 'E2E Fulfilled Month Goal', target_amount: 100_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  // A real deposit so the goal card reliably renders and History has a concrete row.
  const deposit = await api.createTransaction({
    asset_type: 'bank', amount_vnd: 20_000_000, investment_date: MONTH_START,
    interest_rate: 5, goal_id: goal.goal_id, notes: 'E2E Folded Deposit',
  })
  cleanup.add(() => api.deleteTransaction(deposit.transaction_id))

  const saving = await api.createRecurringSaving({
    name: 'E2E Folded Recurring', goal_id: goal.goal_id, amount_vnd: 5_000_000, effective_from: MONTH_START,
  })
  cleanup.add(() => api.deleteRecurringSaving(saving.saving_id))

  // The month was settled by folding the recurring into the deposit.
  const ym = `${YEAR}-${String(MONTH).padStart(2, '0')}`
  await api.createRecurringFulfillment({ recurring_saving_id: saving.saving_id, ym, amount_vnd: 5_000_000 })
  cleanup.add(() => api.deleteRecurringFulfillments(saving.saving_id))

  // Endpoint: the fulfilled month yields no synthesized contribution.
  const res = await page.request.get(`/api/v1/savings-goals/${goal.goal_id}/recurring-contributions`)
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).contributions).toHaveLength(0)

  // UI: History shows the real deposit but NOT the folded recurring row.
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  const goalCard = page.getByText('E2E Fulfilled Month Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 10_000 })
  await goalCard.click()
  const panel = page.getByTestId('desktop-goal-detail')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await panel.getByRole('button', { name: /^(History|Lịch sử)$/ }).click()
  await expect(panel.getByText('E2E Folded Deposit')).toBeVisible({ timeout: 5_000 })
  await expect(panel.getByText('E2E Folded Recurring')).toHaveCount(0)
})
