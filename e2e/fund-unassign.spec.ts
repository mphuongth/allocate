import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// The fund-unassign flow (goalActions.unassignInvestment) reads GET
// /fund-investments and PATCHes each row's goal back to null. That GET returns a
// BARE ARRAY — a wrong read there silently no-ops the unassign. Drive the real
// route contract end-to-end so a unit mock's shape can't hide it again (#467).
test.describe('fund-investments unassign contract (#467)', () => {
  let goalId: string
  let fundId: string
  let txId: string

  test.beforeEach(async () => {
    const goal = await api.createGoal({ goal_name: `E2E FundUnassign ${Date.now()}` })
    goalId = goal.goal_id
    const fund = await api.createFund({
      name: `E2E FundUnassign Fund ${Date.now()}`,
      code: `FUA${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
    })
    fundId = fund.id
    const tx = await api.createTransaction({
      asset_type: 'fund', fund_id: fundId, goal_id: goalId,
      amount_vnd: 2_000_000, units: 100, unit_price: 20_000, investment_date: '2026-01-01',
    })
    txId = tx.transaction_id
  })

  test.afterEach(async () => {
    if (txId) await api.deleteTransaction(txId)
    if (fundId) await api.deleteFund(fundId)
    if (goalId) await api.deleteGoal(goalId)
  })

  test('GET returns a bare array and PATCH goal=null actually unassigns', async ({ request }) => {
    const listed = await (await request.get(`/api/v1/fund-investments?fund_id=${fundId}`)).json()
    // The production contract: a bare array of rows each with an `id`.
    expect(Array.isArray(listed)).toBe(true)
    const row = listed.find((r: { id: string; goal_id: string | null }) => r.id === txId)
    expect(row).toBeTruthy()
    expect(row.goal_id).toBe(goalId)

    const patch = await request.patch(`/api/v1/fund-investments/${txId}/goal`, {
      data: { goal_id: null },
    })
    expect(patch.ok()).toBeTruthy()

    const after = await (await request.get(`/api/v1/fund-investments?fund_id=${fundId}`)).json()
    const rowAfter = after.find((r: { id: string; goal_id: string | null }) => r.id === txId)
    expect(rowAfter.goal_id).toBeNull()
  })

  test('unassigning a fund from one goal leaves its other-goal rows intact', async ({ request }) => {
    // Same fund split across two goals. The goal_id-scoped query must clear only
    // goalA's row, not goalB's (#467 P1).
    const goalB = await api.createGoal({ goal_name: `E2E FundUnassign B ${Date.now()}` })
    const txB = await api.createTransaction({
      asset_type: 'fund', fund_id: fundId, goal_id: goalB.goal_id,
      amount_vnd: 1_000_000, units: 50, unit_price: 20_000, investment_date: '2026-02-01',
    })
    try {
      // Scoped fetch returns only this goal's row.
      const scoped = await (await request.get(`/api/v1/fund-investments?fund_id=${fundId}&goal_id=${goalId}`)).json()
      expect(scoped.map((r: { id: string }) => r.id)).toEqual([txId])

      const patch = await request.patch(`/api/v1/fund-investments/${txId}/goal`, { data: { goal_id: null } })
      expect(patch.ok()).toBeTruthy()

      const all = await (await request.get(`/api/v1/fund-investments?fund_id=${fundId}`)).json()
      expect(all.find((r: { id: string }) => r.id === txId).goal_id).toBeNull()
      // goalB's row is untouched.
      expect(all.find((r: { id: string }) => r.id === txB.transaction_id).goal_id).toBe(goalB.goal_id)
    } finally {
      await api.deleteTransaction(txB.transaction_id)
      await api.deleteGoal(goalB.goal_id)
    }
  })
})
