import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Accumulating ("Loại 2") books in the Unallocated list. A book is normally goal-
// assigned, but an unallocated one (created without a goal) must read as ONE row
// (its tranches rolled up), and assigning it must move the WHOLE book to the goal
// — the /assign route cascades a book's goal atomically, never splitting it.

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

test.describe('Accumulating book in the Unallocated list', () => {
  test('an unallocated book rolls its tranches into one row with the combined value', async ({ page }) => {
    test.slow()
    // A goal-less book: anchor 30M + a 20M top-up = 50M across two tranches.
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, notes: 'E2E Unalloc Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-30), expiry_date: iso(60) },
    })).json()
    expect(anchor.deposit_group_id).toBe(anchor.transaction_id)
    expect(anchor.goal_id).toBeNull()
    await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 3.6, investment_date: iso(-10) },
    })
    try {
      await gotoFreshDashboard(page)
      // Exactly one Unallocated row for the book, showing the SUMMED value (~50M) —
      // not two rows, and not just the anchor's 30M.
      const row = page.getByTestId('unallocated-row').filter({ hasText: 'E2E Unalloc Book' })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(/5\d\.\dM/) // 50–59M (anchor-only would be 30.xM)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
    }
  })

  test('assigning an unallocated book moves the whole book to the goal (cascade, no split)', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Unalloc Assign Goal', target_amount: 100_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, notes: 'E2E Unalloc Assign', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-30), expiry_date: iso(60) },
    })).json()
    const tranche = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 3.6, investment_date: iso(-10) },
    })).json()
    try {
      // Assign the book (its anchor) to the goal — what the Unallocated "Assign" action POSTs.
      const res = await page.request.put(`/api/v1/investment-transactions/${anchor.transaction_id}/assign`, {
        data: { goal_id: goal.goal_id },
      })
      expect(res.ok()).toBeTruthy()
      // Both tranches followed — the book moved as a whole, not split across goals.
      const anchorNow = await (await page.request.get(`/api/v1/investment-transactions/${anchor.transaction_id}`)).json()
      const trancheNow = await (await page.request.get(`/api/v1/investment-transactions/${tranche.transaction_id}`)).json()
      expect(anchorNow.goal_id).toBe(goal.goal_id)
      expect(trancheNow.goal_id).toBe(goal.goal_id)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
