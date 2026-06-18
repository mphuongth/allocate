import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Accumulating ("Loại 2") bank deposits: one book, many tranches (top-ups), each
// with its own locked rate, all sharing the book's maturity. These drive the real
// stack: the book (1) rolls up to one holding valued as the sum of its tranches,
// (2) shows a top-up history + avg rate, (3) accepts a UI top-up, (4) is guarded
// server-side against single-row renew + book withdrawal, (5) cascades book-level
// edits to every tranche, and (6) is kept out of the term maturity card + can't
// be topped up once matured.

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const digits = (s: string | null) => Number((s ?? '').replace(/[^0-9]/g, '')) || 0

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

test.describe('Accumulating bank deposits (Loại 2)', () => {
  test('a live book rolls up its tranches, shows history, accepts a UI top-up, and is renew/withdraw-guarded', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Accum Goal', target_amount: 200_000_000 })
    // Anchor via the route so it self-groups. Future maturity = a live book.
    const anchorRes = await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Flex Save', amount_vnd: 50_000_000, interest_rate: 3.0, investment_date: iso(-150), expiry_date: iso(40) },
    })
    expect(anchorRes.status()).toBe(201)
    const anchor = await anchorRes.json()
    expect(anchor.deposit_group_id).toBe(anchor.transaction_id) // self-grouped
    const topUp1 = await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 3.5, investment_date: iso(-20) },
    })
    expect(topUp1.status()).toBe(201)
    const t1 = await topUp1.json()
    expect(t1.deposit_group_id).toBe(anchor.transaction_id)
    expect(t1.expiry_date).toBe(anchor.expiry_date) // book maturity copied down

    try {
      await gotoFreshDashboard(page)
      await page.getByText('E2E Accum Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      // (1) Two tranches roll up to ONE holding → one Options button.
      await expect(panel.getByRole('button', { name: 'Options', exact: true })).toHaveCount(1)
      const valueBefore = digits(await panel.getByTestId('desktop-goal-detail-value').textContent())
      expect(valueBefore).toBeGreaterThan(0)

      // (2) Options → two tranches with the top-up history + avg rate.
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      await expect(page.getByTestId('tranche-history')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('tranche-row')).toHaveCount(2)
      await expect(page.getByTestId('bank-info-strip')).toContainText(/Avg rate|Lãi suất TB/i)

      // (3) Top up via the UI → a third tranche joins the same book.
      await page.getByTestId('top-up-btn').click()
      await expect(page.getByTestId('top-up-modal')).toBeVisible({ timeout: 5_000 })
      await page.getByTestId('top-up-amount').fill('4000000')
      await page.getByTestId('top-up-rate').fill('3.4')
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/investment-transactions') && r.request().method() === 'POST'),
        page.getByTestId('top-up-submit').click(),
      ])
      expect(resp.status()).toBe(201)
      expect((await resp.json()).deposit_group_id).toBe(anchor.transaction_id)

      // (4) Server guards: a book can't be renewed (single-row) or withdrawn yet.
      const renewRes = await page.request.post(`/api/v1/investment-transactions/${anchor.transaction_id}/renew`, {
        data: { amount_vnd: 50_000_000, interest_rate: 3.0, expiry_date: iso(120), investment_date: iso(40) },
      })
      expect(renewRes.status()).toBe(400)
      const wd = await page.request.post('/api/v1/investment-transactions', {
        data: { transaction_type: 'withdrawal', asset_type: 'bank', parent_transaction_id: anchor.transaction_id, investment_date: iso(0), amount_vnd: 1_000_000, principal_withdrawn: 1_000_000 },
      })
      expect(wd.status()).toBe(400)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('editing the book goal / maturity cascades to every tranche', async ({ page }) => {
    const goalA = await api.createGoal({ goal_name: 'E2E Book A', target_amount: 100_000_000 })
    const goalB = await api.createGoal({ goal_name: 'E2E Book B', target_amount: 100_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goalA.goal_id, notes: 'E2E Book', amount_vnd: 30_000_000, interest_rate: 3.0, investment_date: iso(-100), expiry_date: iso(40) },
    })).json()
    const tranche = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 3.5, investment_date: iso(-10) },
    })).json()
    try {
      // Book-level edit (goal + maturity) + a tranche-level edit (the anchor's own
      // amount) in one PUT — the atomic update_deposit_book RPC handles both.
      const newExpiry = iso(70)
      const put = await page.request.put(`/api/v1/investment-transactions/${anchor.transaction_id}`, {
        data: { goal_id: goalB.goal_id, expiry_date: newExpiry, amount_vnd: 35_000_000 },
      })
      expect(put.ok()).toBeTruthy()
      // The top-up tranche followed the BOOK fields — same goal + same maturity.
      const trancheNow = await (await page.request.get(`/api/v1/investment-transactions/${tranche.transaction_id}`)).json()
      expect(trancheNow.goal_id).toBe(goalB.goal_id)
      expect(trancheNow.expiry_date).toBe(newExpiry)
      // …but the TRANCHE-level amount edit stayed on the anchor only (not cascaded).
      expect(trancheNow.amount_vnd).toBe(2_000_000)
      const anchorNow = await (await page.request.get(`/api/v1/investment-transactions/${anchor.transaction_id}`)).json()
      expect(anchorNow.amount_vnd).toBe(35_000_000)
      expect(anchorNow.goal_id).toBe(goalB.goal_id)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteGoal(goalA.goal_id)
      await api.deleteGoal(goalB.goal_id)
    }
  })

  test('a matured book surfaces in the maturity card as one grouped row and still can\'t be topped up', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Matured Book', target_amount: 100_000_000 })
    // Matured anchor — now surfaces in the "needs attention" card (book-level
    // renewal exists), grouped to one row that opens the collapse flow.
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Matured Flex', amount_vnd: 20_000_000, interest_rate: 3.0, investment_date: iso(-200), expiry_date: iso(-5) },
    })).json()
    try {
      await gotoFreshDashboard(page)
      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card).toContainText('E2E Matured Flex')
      // Topping up a matured book is rejected (a tranche dated today would accrue 0).
      const late = await page.request.post('/api/v1/investment-transactions', {
        data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 1_000_000, interest_rate: 3.0, investment_date: iso(0) },
      })
      expect(late.status()).toBe(400)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
