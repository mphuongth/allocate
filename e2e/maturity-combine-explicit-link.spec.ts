import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Explicit deposit↔recurring link. When a goal funds several recurring bank
// savings, name/sole matching can't tell which one belongs to a maturing
// deposit — so the combine flow stays ambiguous (user must pick). A recurring
// can instead be hard-linked to a specific deposit (recurring_savings
// .linked_deposit_tx_id = the deposit's transaction_id, stable across renewals).
// This proves the EXPLICIT tier wins: with two same-goal recurrings whose names
// don't match the deposit, the linked one is the one folded in.

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

async function gotoFreshDashboard(page: Page) {
  await page.goto('/settings')
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('dashboardOverviewCache')).forEach((k) => localStorage.removeItem(k))
  })
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])
}

// fulfilled flag for a saving in the current month, straight from the API.
async function fulfilledMap(page: Page): Promise<Record<string, boolean>> {
  const now = new Date()
  const res = await page.request.get(`/api/v1/recurring-savings?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  const out: Record<string, boolean> = {}
  for (const s of json.savings ?? []) out[s.saving_id] = !!s.fulfilled
  return out
}

test.describe('Term-deposit maturity — explicit deposit↔recurring link', () => {
  test('the deposit-linked recurring is folded in, not a same-goal sibling', async ({ page }) => {
    test.slow()
    const now = new Date()
    const goal = await api.createGoal({ goal_name: 'E2E Link Goal', target_amount: 100_000_000 })
    const plan = await api.createMonthlyPlan({ month: now.getMonth() + 1, year: now.getFullYear(), salary_vnd: 30_000_000 })
    const deposit = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 12_000_000,
      investment_date: iso(-400),
      interest_rate: 6,
      expiry_date: iso(-10), // matured
      goal_id: goal.goal_id,
      notes: 'E2E Link Deposit',
    })
    // Two same-goal recurrings whose names neither match the deposit nor each
    // other → without a link the match is ambiguous. Only the second is linked.
    const sibling = await api.createRecurringSaving({ name: 'E2E Saver One', goal_id: goal.goal_id, amount_vnd: 1_000_000 })
    const linked = await api.createRecurringSaving({
      name: 'E2E Saver Two', goal_id: goal.goal_id, amount_vnd: 3_000_000,
      linked_deposit_tx_id: deposit.transaction_id,
    })
    try {
      await gotoFreshDashboard(page)

      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      await card.getByRole('button', { name: /Handle|Xử lý/i }).first().click()

      // Combine is offered and (via the explicit link) pre-selected.
      await expect(page.getByTestId('maturity-combine')).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: /Save new deposit|Lưu sổ mới/i }).click()
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

      // The LINKED recurring is fulfilled; the sibling is untouched.
      const fulfilled = await fulfilledMap(page)
      expect(fulfilled[linked.saving_id]).toBe(true)
      expect(fulfilled[sibling.saving_id]).toBe(false)
    } finally {
      await api.deleteRecurringSaving(linked.saving_id)
      await api.deleteRecurringSaving(sibling.saving_id)
      await api.deleteTransactionCascade(deposit.transaction_id)
      await api.deleteMonthlyPlan(plan.id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
