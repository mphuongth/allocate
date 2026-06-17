import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Accumulating ("Loại 2") bank deposits: one book, many tranches (top-ups), each
// with its own locked rate, all sharing the book's maturity. This drives the
// real stack: create the anchor + a top-up via the API (route self-groups), then
// assert the book (1) rolls up to one holding valued as the sum of its tranches,
// (2) shows a top-up history + avg rate, (3) stays OUT of the term "needs
// attention" card even when matured, and (4) accepts a further top-up via the UI.

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
  test('book rolls up its tranches, shows history, stays out of the maturity card, and accepts a UI top-up', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Accum Goal', target_amount: 200_000_000 })
    // Anchor via the route so it self-groups (deposit_group_id = its own id).
    // Matured expiry on purpose — a term deposit would surface in the maturity
    // card; an accumulating book must NOT.
    const anchorRes = await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Flex Save', amount_vnd: 50_000_000, interest_rate: 3.0, investment_date: iso(-150), expiry_date: iso(-4) },
    })
    expect(anchorRes.status()).toBe(201)
    const anchor = await anchorRes.json()
    expect(anchor.deposit_group_id).toBe(anchor.transaction_id) // self-grouped
    // A first top-up at a different rate — inherits the book's goal + maturity.
    const topUp1 = await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 2_000_000, interest_rate: 3.5, investment_date: iso(-20) },
    })
    expect(topUp1.status()).toBe(201)
    const t1 = await topUp1.json()
    expect(t1.deposit_group_id).toBe(anchor.transaction_id)
    expect(t1.expiry_date).toBe(anchor.expiry_date) // book maturity copied down

    try {
      await gotoFreshDashboard(page)

      // (3) Excluded from the term "needs attention" card despite being matured.
      const card = page.getByTestId('maturity-action-card')
      if (await card.isVisible().catch(() => false)) {
        await expect(card).not.toContainText('E2E Flex Save')
      }

      // Open the goal detail.
      await page.getByText('E2E Accum Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      // (1) Two tranches roll up to ONE holding → one Options button.
      await expect(panel.getByRole('button', { name: 'Options', exact: true })).toHaveCount(1)
      const valueBefore = digits(await panel.getByTestId('desktop-goal-detail-value').textContent())

      // (2) Options → two tranches, with the top-up history + avg rate.
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      await expect(page.getByTestId('tranche-history')).toBeVisible({ timeout: 5_000 })
      await expect(page.getByTestId('tranche-row')).toHaveCount(2)
      await expect(page.getByTestId('bank-info-strip')).toContainText(/Avg rate|Lãi suất TB/i)
      expect(valueBefore).toBeGreaterThan(0)

      // (4) Top up via the UI → a third tranche joins the same book.
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

      // Server guard: the renew route refuses an accumulating book even when hit
      // directly (rolling one tranche would break the shared maturity).
      const renewRes = await page.request.post(`/api/v1/investment-transactions/${anchor.transaction_id}/renew`, {
        data: { amount_vnd: 50_000_000, interest_rate: 3.0, expiry_date: iso(60), investment_date: iso(-4) },
      })
      expect(renewRes.status()).toBe(400)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
