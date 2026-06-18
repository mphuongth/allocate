import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Recurring auto-top-up into an accumulating ("Loại 2") book. A recurring saving
// is linked to a book's anchor; "recording" this month materializes it as a real
// top-up tranche in the book AND marks the month fulfilled — atomically. The
// correctness risk is a DOUBLE-COUNT: the tranche is a real bank row that also
// lands in the overview's logged-deposit pool, so without the fulfillment ledger
// (and consuming the backing deposit) the amount could be counted twice. This
// drives the topup endpoint and asserts (1) the tranche joined the book and
// (2) the goal's progress value did NOT jump by an extra recurring amount.

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

async function goalProgressValue(page: Page, goalId: string): Promise<number> {
  const res = await page.request.get('/api/v1/dashboard/overview')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  const g = (json.goals ?? []).find((x: { goalId: string }) => x.goalId === goalId)
  return g?.progressValue ?? 0
}

test.describe('Recurring auto-top-up into an accumulating book', () => {
  test('recording a book-linked recurring adds a tranche and is not double-counted', async ({ page }) => {
    test.slow()
    const now = new Date()
    const RECURRING = 5_000_000
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const goal = await api.createGoal({ goal_name: 'E2E Topup Goal', target_amount: 200_000_000 })
    const plan = await api.createMonthlyPlan({ month: now.getMonth() + 1, year: now.getFullYear(), salary_vnd: 40_000_000 })
    // A live book (future maturity) so a top-up is accepted.
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Topup Book', amount_vnd: 20_000_000, interest_rate: 3.0, investment_date: iso(-100), expiry_date: iso(60) },
    })).json()
    expect(anchor.deposit_group_id).toBe(anchor.transaction_id)
    // Recurring linked to the book's anchor.
    const saving = await api.createRecurringSaving({ name: 'E2E Topup Recurring', goal_id: goal.goal_id, amount_vnd: RECURRING, linked_deposit_tx_id: anchor.transaction_id })
    try {
      await gotoFreshDashboard(page)
      // Before: the recurring is synthesized into the goal for this realized month.
      const before = await goalProgressValue(page, goal.goal_id)

      // Record the recurring as a book top-up (what the prefilled "Saved" sheet POSTs).
      const res = await page.request.post(`/api/v1/recurring-savings/${saving.saving_id}/topup`, {
        data: { book_id: anchor.transaction_id, amount_vnd: RECURRING, interest_rate: 3.5, investment_date: iso(0), ym, plan_id: plan.id },
      })
      expect(res.status()).toBe(201)

      // (1) A new tranche joined the book (same group, the top-up amount, not the anchor).
      const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
      const tranches = (all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null; amount_vnd: number; interest_rate: number | null }>)
        .filter((t) => t.deposit_group_id === anchor.transaction_id)
      expect(tranches.length).toBe(2) // anchor + the new top-up
      const topup = tranches.find((t) => t.transaction_id !== anchor.transaction_id)
      expect(topup?.amount_vnd).toBe(RECURRING)
      expect(topup?.interest_rate).toBe(3.5)

      // (2) No double-count: the synthesized recurring is now suppressed (fulfilled)
      // and replaced by the real tranche — progress must NOT have jumped by an extra
      // full recurring amount on top.
      await gotoFreshDashboard(page)
      const after = await goalProgressValue(page, goal.goal_id)
      expect(after).toBeLessThan(before + RECURRING / 2)
    } finally {
      await api.deleteRecurringSaving(saving.saving_id) // cascades the fulfillment row
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteTransactionCascade(anchor.transaction_id)
      await api.deleteMonthlyPlan(plan.id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('a recurring can be linked to a book anchor but not to a non-anchor tranche', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Link Goal', target_amount: 100_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Link Book', amount_vnd: 10_000_000, interest_rate: 3.0, investment_date: iso(-50), expiry_date: iso(60) },
    })).json()
    const tranche = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 3.4, investment_date: iso(-5) },
    })).json()
    try {
      // Linking to a non-anchor tranche is rejected (link the book via its anchor).
      const bad = await page.request.post('/api/v1/recurring-savings', {
        data: { name: 'E2E Bad Link', goal_id: goal.goal_id, amount_vnd: 1_000_000, linked_deposit_tx_id: tranche.transaction_id },
      })
      expect(bad.status()).toBe(400)
      // Linking to the anchor succeeds.
      const good = await page.request.post('/api/v1/recurring-savings', {
        data: { name: 'E2E Good Link', goal_id: goal.goal_id, amount_vnd: 1_000_000, linked_deposit_tx_id: anchor.transaction_id },
      })
      expect(good.status()).toBe(201)
      await api.deleteRecurringSaving((await good.json()).saving_id)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
