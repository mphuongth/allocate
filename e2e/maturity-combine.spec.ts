import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Term-deposit maturity "combine" flow (Tất toán & gửi lại / settle & re-deposit,
// merging this month's recurring saving). The correctness risk is a DOUBLE-COUNT:
// the recurring amount gets folded into the (larger) re-deposit principal, so if
// the synthesized recurring contribution isn't also suppressed it is counted
// twice — once in the deposit, once on its own. This closes the loop: combine
// from the UI, then assert the goal's progress value (what the bar renders) moved
// by ~interest only, NOT by the extra recurring amount.

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

async function gotoFreshDashboard(page: Page) {
  await page.goto('/settings') // unmount DashboardClient
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('dashboardOverviewCache')).forEach((k) => localStorage.removeItem(k))
  })
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])
}

// Read the goal's progress value straight from the overview API (no client cache).
async function goalProgressValue(page: Page, goalId: string): Promise<number> {
  const res = await page.request.get('/api/v1/dashboard/overview')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  const g = (json.goals ?? []).find((x: { goalId: string }) => x.goalId === goalId)
  return g?.progressValue ?? 0
}

test.describe('Term-deposit maturity — combine (merge recurring into re-deposit)', () => {
  test('folding this month\'s recurring into the re-deposit does not double-count it', async ({ page }) => {
    test.slow()
    const now = new Date()
    const RECURRING = 2_000_000
    const goal = await api.createGoal({ goal_name: 'E2E Combine Goal', target_amount: 100_000_000 })
    // A realized plan for the current month makes the recurring saving count.
    const plan = await api.createMonthlyPlan({ month: now.getMonth() + 1, year: now.getFullYear(), salary_vnd: 30_000_000 })
    const deposit = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 12_000_000,
      investment_date: iso(-400),
      interest_rate: 6,
      expiry_date: iso(-10), // matured
      goal_id: goal.goal_id,
      notes: 'E2E Combine Deposit',
    })
    // Same name as the deposit → linkedSavingFor resolves it confidently.
    const saving = await api.createRecurringSaving({
      name: 'E2E Combine Deposit',
      goal_id: goal.goal_id,
      amount_vnd: RECURRING,
    })
    try {
      await gotoFreshDashboard(page)
      // Before: deposit (≈12.7M w/ interest) + the synthesized recurring (2M).
      const before = await goalProgressValue(page, goal.goal_id)

      // Open the resolve modal from the Needs attention card.
      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      await card.getByRole('button', { name: /Handle|Xử lý/i }).first().click()

      // Combine is offered (a recurring is due this month) and pre-selected; its
      // inputs (cash-flow recap + re-deposit) are visible.
      await expect(page.getByTestId('maturity-combine')).toBeVisible({ timeout: 10_000 })

      // Confirm with defaults: interest pre-filled, re-deposit = principal +
      // interest + recurring, recurring marked deposited.
      await page.getByRole('button', { name: /Save new deposit|Lưu sổ mới/i }).click()
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

      // After: the recurring now lives inside the deposit principal and is
      // suppressed as a standalone contribution — progress must NOT have jumped by
      // the full recurring amount on top of the folded-in deposit.
      const after = await goalProgressValue(page, goal.goal_id)
      expect(after).toBeLessThan(before + RECURRING / 2)
    } finally {
      await api.deleteRecurringSaving(saving.saving_id) // cascades the fulfillment row
      await api.deleteTransactionCascade(deposit.transaction_id)
      await api.deleteMonthlyPlan(plan.id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
