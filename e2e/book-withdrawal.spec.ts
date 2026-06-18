import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Whole-book withdrawal (full close) for accumulating ("Loại 2") books. A book
// can't be withdrawn tranche-by-tranche, but a FULL close needs no spreading: one
// withdrawal row per live tranche at its full principal, so the book nets to zero
// and drops out of the holdings. Drives the API + the UI (close from goal-detail).

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

test.describe('Whole-book withdrawal (full close)', () => {
  test('closing a book writes a withdrawal per tranche and zeroes the holding', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Book Withdraw Goal', target_amount: 100_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Withdraw Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-60), expiry_date: iso(60) },
    })).json()
    await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })
    try {
      const res = await page.request.post(`/api/v1/investment-transactions/${anchor.transaction_id}/withdraw-book`, {
        data: { total_received: 50_500_000, investment_date: iso(0), affects_progress: true },
      })
      expect(res.status()).toBe(200)
      expect((await res.json()).withdrawn_tranches).toBe(2)

      // Each tranche got a full-principal withdrawal row → the book nets to zero,
      // so the goal-detail Investments tab no longer lists it.
      const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
      const rows = all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null; transaction_type: string; parent_transaction_id: string | null; principal_withdrawn: number | null }>
      const tranches = rows.filter((r) => r.deposit_group_id === anchor.transaction_id && r.transaction_type === 'investment')
      const withdrawals = rows.filter((r) => r.transaction_type === 'withdrawal' && tranches.some((t) => t.transaction_id === r.parent_transaction_id))
      expect(withdrawals).toHaveLength(2)
      const withdrawnPrincipal = withdrawals.reduce((s, w) => s + (w.principal_withdrawn ?? 0), 0)
      expect(withdrawnPrincipal).toBe(50_000_000) // 30M + 20M full principal
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteTransactionCascade(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('full close from the goal-detail Withdraw action removes the book', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Book Close UI', target_amount: 100_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Close UI Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-60), expiry_date: iso(60) },
    })).json()
    await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })
    try {
      await gotoFreshDashboard(page)
      await page.getByText('E2E Book Close UI').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 5_000 })
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      // Withdraw is offered for a book now → full-close sheet, prefilled balance.
      await page.getByRole('button', { name: /Withdraw|Rút tiền/i }).first().click()
      await expect(page.getByTestId('sell-book-balance')).toBeVisible({ timeout: 5_000 })
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/withdraw-book') && r.request().method() === 'POST'),
        page.getByTestId('sell-confirm-btn').click(),
      ])
      expect(resp.status()).toBe(200)

      // The book is gone (every tranche fully withdrawn).
      const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
      const liveTranches = (all.transactions as Array<{ deposit_group_id: string | null; transaction_type: string }>)
        .filter((r) => r.deposit_group_id === anchor.transaction_id && r.transaction_type === 'investment')
      const withdrawals = (all.transactions as Array<{ transaction_type: string }>).filter((r) => r.transaction_type === 'withdrawal')
      expect(liveTranches).toHaveLength(2) // the investment rows remain (history)…
      expect(withdrawals.length).toBeGreaterThanOrEqual(2) // …fully offset by withdrawals
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteTransactionCascade(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
