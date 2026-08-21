import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { expectRenewalCommitted } from './helpers/maturity'

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
      await expectRenewalCommitted(page)

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

  test('the API rejects an invalid deposit link and auto-clears a cross-goal link on goal change', async ({ page }) => {
    const goalA = await api.createGoal({ goal_name: 'E2E Link A', target_amount: 50_000_000 })
    const goalB = await api.createGoal({ goal_name: 'E2E Link B', target_amount: 50_000_000 })
    const termInB = await api.createTransaction({ asset_type: 'bank', amount_vnd: 5_000_000, investment_date: iso(-100), interest_rate: 6, expiry_date: iso(60), goal_id: goalB.goal_id, notes: 'E2E Term In B' })
    // Flexible (non-term) bank deposit: no rate, no maturity.
    const flexInA = await api.createTransaction({ asset_type: 'bank', amount_vnd: 5_000_000, investment_date: iso(-100), goal_id: goalA.goal_id, notes: 'E2E Flex In A' })
    const termInA = await api.createTransaction({ asset_type: 'bank', amount_vnd: 5_000_000, investment_date: iso(-100), interest_rate: 6, expiry_date: iso(60), goal_id: goalA.goal_id, notes: 'E2E Term In A' })
    const createdSavings: string[] = []
    const post = (data: Record<string, unknown>) => page.request.post('/api/v1/recurring-savings', { data })
    try {
      // Cross-goal: recurring in A linked to a deposit in B → rejected.
      expect((await post({ name: 'X', goal_id: goalA.goal_id, amount_vnd: 1_000_000, linked_deposit_tx_id: termInB.transaction_id })).status()).toBe(400)

      // Non-term: flexible bank deposit (no rate/maturity) → rejected.
      expect((await post({ name: 'X', goal_id: goalA.goal_id, amount_vnd: 1_000_000, linked_deposit_tx_id: flexInA.transaction_id })).status()).toBe(400)

      // Valid: a term deposit in the same goal → accepted and persisted.
      const okRes = await post({ name: 'X', goal_id: goalA.goal_id, amount_vnd: 1_000_000, linked_deposit_tx_id: termInA.transaction_id })
      expect(okRes.status()).toBe(201)
      const saving = await okRes.json()
      createdSavings.push(saving.saving_id)
      expect(saving.linked_deposit_tx_id).toBe(termInA.transaction_id)

      // Moving the recurring to goal B (without re-sending the link) drops the
      // now cross-goal link rather than leaving a stale one.
      const putRes = await page.request.put(`/api/v1/recurring-savings/${saving.saving_id}`, { data: { goal_id: goalB.goal_id } })
      expect(putRes.ok()).toBeTruthy()
      expect((await putRes.json()).linked_deposit_tx_id).toBeNull()
    } finally {
      for (const id of createdSavings) await api.deleteRecurringSaving(id)
      await api.deleteTransactionCascade(termInB.transaction_id)
      await api.deleteTransactionCascade(flexInA.transaction_id)
      await api.deleteTransactionCascade(termInA.transaction_id)
      await api.deleteGoal(goalA.goal_id)
      await api.deleteGoal(goalB.goal_id)
    }
  })
})
