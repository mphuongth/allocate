import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Book withdrawal for accumulating ("Loại 2") books — full close AND partial. A
// full close writes one withdrawal per tranche at full principal; a partial spreads
// the principal across tranches PROPORTIONALLY (book stays, blended rate intact).
// Drives the API + the UI (withdraw from goal-detail).

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

// Books leak withdrawal rows if torn down naively (parent_transaction_id is ON
// DELETE SET NULL), and a full close clears the group so the membership is gone by
// teardown time. Each test snapshots its tranche set while the book is still grouped
// and registers a cascade on the stack — the stack runs LIFO with a per-fn catch, so
// one failing step can't strand the rest (raw try/finally did).
const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

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
    cleanup.add(() => api.deleteGoal(goal.goal_id))
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Withdraw Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-60), expiry_date: iso(60) },
    })).json()
    const topUp = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })).json()
    const tranches = await api.snapshotBookTranches(anchor.transaction_id)
    cleanup.add(() => api.deleteBookCascade(anchor.transaction_id, tranches))

    const res = await page.request.post(`/api/v1/investment-transactions/${anchor.transaction_id}/withdraw-book`, {
      data: { withdraw_principal: 50_000_000, total_received: 50_500_000, investment_date: iso(0), affects_progress: true },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).withdrawn_tranches).toBe(2)

    const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
    const rows = all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null; transaction_type: string; parent_transaction_id: string | null; principal_withdrawn: number | null }>
    // Each tranche got a full-principal withdrawal row → 30M + 20M out.
    const trancheIds = [anchor.transaction_id, topUp.transaction_id]
    const withdrawals = rows.filter((r) => r.transaction_type === 'withdrawal' && r.parent_transaction_id != null && trancheIds.includes(r.parent_transaction_id))
    expect(withdrawals).toHaveLength(2)
    expect(withdrawals.reduce((s, w) => s + (w.principal_withdrawn ?? 0), 0)).toBe(50_000_000)
    // A full close SETTLES the book — the group is cleared so it can't be revived.
    expect(rows.find((r) => r.transaction_id === anchor.transaction_id)!.deposit_group_id).toBeNull()
  })

  test('full close from the goal-detail Withdraw action removes the book', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Book Close UI', target_amount: 100_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Close UI Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-60), expiry_date: iso(60) },
    })).json()
    await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 20_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })
    const tranches = await api.snapshotBookTranches(anchor.transaction_id)
    cleanup.add(() => api.deleteBookCascade(anchor.transaction_id, tranches))

    await gotoFreshDashboard(page)
    await page.getByText('E2E Book Close UI').first().click()
    const panel = page.getByTestId('desktop-goal-detail')
    await expect(panel).toBeVisible({ timeout: 5_000 })
    await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
    // Withdraw is offered for a book → editable sheet; "All" = full close.
    await page.getByRole('button', { name: /Withdraw|Rút tiền/i }).first().click()
    await expect(page.getByTestId('sell-amount-input')).toBeVisible({ timeout: 5_000 })
    await page.getByTestId('sell-all-btn').click()
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/withdraw-book') && r.request().method() === 'POST'),
      page.getByTestId('sell-confirm-btn').click(),
    ])
    expect(resp.status()).toBe(200)

    // The book is settled: full close cleared the group (no live book remains).
    const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
    const stillGrouped = (all.transactions as Array<{ deposit_group_id: string | null }>)
      .filter((r) => r.deposit_group_id === anchor.transaction_id)
    expect(stillGrouped).toHaveLength(0)
    expect((all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null }>)
      .find((r) => r.transaction_id === anchor.transaction_id)!.deposit_group_id).toBeNull()
  })

  test('a full close settles the book — group cleared + recurring unlinked, no resurrection', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Close Settle Goal', target_amount: 100_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))
    // A live (non-matured) book with a recurring linked to it — the early-close vector.
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Close Settle Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-30), expiry_date: iso(90) },
    })).json()
    const tranches = await api.snapshotBookTranches(anchor.transaction_id)
    cleanup.add(() => api.deleteBookCascade(anchor.transaction_id, tranches))
    const saving = await api.createRecurringSaving({ name: 'E2E Close Settle Rec', goal_id: goal.goal_id, amount_vnd: 2_000_000, linked_deposit_tx_id: anchor.transaction_id })
    cleanup.add(() => api.deleteRecurringSaving(saving.saving_id))

    const res = await page.request.post(`/api/v1/investment-transactions/${anchor.transaction_id}/withdraw-book`, {
      data: { withdraw_principal: 30_000_000, total_received: 30_200_000, investment_date: iso(0), affects_progress: true },
    })
    expect(res.status()).toBe(200)

    // The book is truly settled: the anchor is no longer a book (group cleared)…
    const anchorNow = await (await page.request.get(`/api/v1/investment-transactions/${anchor.transaction_id}`)).json()
    expect(anchorNow.deposit_group_id).toBeNull()
    // …and the recurring's link was nulled (the book it fed is gone).
    const savingNow = await api.getRecurringSaving(saving.saving_id)
    expect(savingNow!.linked_deposit_tx_id).toBeNull()
    // A resurrection attempt (recurring top-up) now fails cleanly, not revives it.
    const revive = await page.request.post(`/api/v1/recurring-savings/${saving.saving_id}/topup`, {
      data: { book_id: anchor.transaction_id, amount_vnd: 2_000_000, interest_rate: 3.0, investment_date: iso(0), ym: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` },
    })
    expect(revive.status()).toBe(400) // link no longer points at that book
  })

  test('a partial withdrawal spreads across tranches proportionally and leaves the book', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Partial Goal', target_amount: 100_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))
    // Book: 40M anchor + 10M top-up = 50M principal. Withdraw 10M (1/5) → each
    // tranche loses 1/5: anchor 8M, top-up 2M.
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Partial Book', amount_vnd: 40_000_000, interest_rate: 3.0, investment_date: iso(-60), expiry_date: iso(60) },
    })).json()
    const topUp = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })).json()
    const tranches = await api.snapshotBookTranches(anchor.transaction_id)
    cleanup.add(() => api.deleteBookCascade(anchor.transaction_id, tranches))

    const res = await page.request.post(`/api/v1/investment-transactions/${anchor.transaction_id}/withdraw-book`, {
      data: { withdraw_principal: 10_000_000, total_received: 10_100_000, investment_date: iso(0), affects_progress: true },
    })
    expect(res.status()).toBe(200)

    const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
    const rows = all.transactions as Array<{ transaction_type: string; parent_transaction_id: string | null; principal_withdrawn: number | null }>
    const wdFor = (txId: string) => rows.filter((r) => r.transaction_type === 'withdrawal' && r.parent_transaction_id === txId)
      .reduce((s, w) => s + (w.principal_withdrawn ?? 0), 0)
    // Proportional: 1/5 of each tranche's principal.
    expect(wdFor(anchor.transaction_id)).toBe(8_000_000)
    expect(wdFor(topUp.transaction_id)).toBe(2_000_000)
    // Total withdrawn = exactly the requested principal (no rounding drift).
    expect(wdFor(anchor.transaction_id) + wdFor(topUp.transaction_id)).toBe(10_000_000)
  })
})
