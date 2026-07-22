import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// Ownership of foreign-key targets must be enforced, not just their UUID shape
// (#474). RLS guarantees the row's own user_id, but not that a supplied fund_id
// / goal_id / dca_goal_id belongs to the same user — so a caller who knows
// another user's record UUID could otherwise forge a cross-user link. These hit
// the routes with the authenticated test user while referencing a *second*
// user's records, and expect a 403.
test.describe('FK ownership enforcement (#474)', () => {
  let foreign: { userId: string; goalId: string; fundId: string }
  let ownGoalId: string
  let ownFundId: string

  test.beforeAll(async () => {
    foreign = await api.createForeignOwned()
    const goal = await api.createGoal({ goal_name: `E2E Own FK Goal ${Date.now()}` })
    ownGoalId = goal.goal_id
    const fund = await api.createFund({
      name: `E2E Own FK Fund ${Date.now()}`,
      code: `OWN${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20000,
    })
    ownFundId = fund.id
  })

  test.afterAll(async () => {
    if (ownFundId) await api.deleteFund(ownFundId)
    if (ownGoalId) await api.deleteGoal(ownGoalId)
    if (foreign) await api.deleteForeignUser(foreign.userId)
  })

  // ---- investment-transactions: fund_id ------------------------------------
  test('POST /api/v1/investment-transactions rejects a cross-user fund_id (403)', async ({ request }) => {
    const res = await request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'fund', fund_id: foreign.fundId, amount_vnd: 1_000_000, investment_date: '2026-01-01', unit_price: 20000, units: 50 },
    })
    expect(res.status()).toBe(403)
  })

  test('POST /api/v1/investment-transactions accepts the caller’s own fund_id', async ({ request }) => {
    const res = await request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'fund', fund_id: ownFundId, amount_vnd: 1_000_000, investment_date: '2026-01-01', unit_price: 20000, units: 50, notes: 'E2E own-fund FK' },
    })
    expect(res.status()).toBe(201)
    await api.deleteAllTransactionsByNotes('E2E own-fund FK')
  })

  test('PUT /api/v1/investment-transactions/[id] rejects a cross-user fund_id (403)', async ({ request }) => {
    const tx = await api.createTransaction({
      asset_type: 'fund', fund_id: ownFundId, amount_vnd: 1_000_000, investment_date: '2026-01-01', unit_price: 20000, units: 50, notes: 'E2E fk put',
    })
    try {
      const res = await request.put(`/api/v1/investment-transactions/${tx.transaction_id}`, {
        data: { asset_type: 'fund', fund_id: foreign.fundId, amount_vnd: 1_000_000, investment_date: '2026-01-01', unit_price: 20000, units: 50 },
      })
      expect(res.status()).toBe(403)
    } finally {
      await api.deleteTransaction(tx.transaction_id)
    }
  })

  // ---- funds: dca_goal_id ---------------------------------------------------
  test('POST /api/funds rejects a cross-user dca_goal_id (403)', async ({ request }) => {
    const res = await request.post('/api/funds', {
      data: { name: 'E2E FK Fund', code: `FKX${Math.random().toString(36).slice(2, 6).toUpperCase()}`, fund_type: 'equity', nav: 20000, is_dca: true, dca_monthly_amount_vnd: 1_000_000, dca_goal_id: foreign.goalId },
    })
    expect(res.status()).toBe(403)
  })

  test('POST /api/funds accepts the caller’s own dca_goal_id', async ({ request }) => {
    const code = `FKO${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const res = await request.post('/api/funds', {
      data: { name: 'E2E FK Own Fund', code, fund_type: 'equity', nav: 20000, is_dca: true, dca_monthly_amount_vnd: 1_000_000, dca_goal_id: ownGoalId },
    })
    expect(res.status()).toBe(201)
    await api.deleteFundsByNamePrefix('E2E FK Own Fund')
  })

  test('PUT /api/funds/[id] rejects a cross-user dca_goal_id (403)', async ({ request }) => {
    const fund = await api.createFund({
      name: `E2E FK Put Fund ${Date.now()}`,
      code: `FKP${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20000,
    })
    try {
      const res = await request.put(`/api/funds/${fund.id}`, {
        data: { name: fund.name, code: fund.code, fund_type: 'equity', nav: 20000, is_dca: true, dca_monthly_amount_vnd: 1_000_000, dca_goal_id: foreign.goalId },
      })
      expect(res.status()).toBe(403)
    } finally {
      await api.deleteFund(fund.id)
    }
  })
})
