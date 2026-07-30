import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// Moving a fund between goal buckets is now one scoped UPDATE — POST
// /fund-investments/assign (#589). What a unit test cannot check is whether that
// statement's WHERE clause really selects the bucket we mean against a live
// database, so the scoping cases run here.
//
// GET /fund-investments still backs the fund detail views and returns a BARE
// ARRAY; a wrong read there once silently no-op'd the unassign (#467), so its
// shape stays pinned too.
test.describe('fund-investments goal-move contract (#467, #589)', () => {
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

  // The scoped move is one UPDATE statement inside PostgREST, so its WHERE clause
  // is the only thing standing between an assign and another goal's rows (#589).
  // A unit test can assert the filters were *asked for*; only a real database
  // shows that they select what we think they do.
  test('assigning the Unallocated bucket moves only the unallocated rows', async ({ request }) => {
    const goalB = await api.createGoal({ goal_name: `E2E FundAssign B ${Date.now()}` })
    const goalC = await api.createGoal({ goal_name: `E2E FundAssign C ${Date.now()}` })
    // Same fund in goalA (txId, from beforeEach), in goalB, and twice unallocated.
    const txB = await api.createTransaction({
      asset_type: 'fund', fund_id: fundId, goal_id: goalB.goal_id,
      amount_vnd: 1_000_000, units: 50, unit_price: 20_000, investment_date: '2026-02-01',
    })
    const free1 = await api.createTransaction({
      asset_type: 'fund', fund_id: fundId,
      amount_vnd: 600_000, units: 30, unit_price: 20_000, investment_date: '2026-03-01',
    })
    const free2 = await api.createTransaction({
      asset_type: 'fund', fund_id: fundId,
      amount_vnd: 400_000, units: 20, unit_price: 20_000, investment_date: '2026-04-01',
    })
    try {
      const res = await request.post('/api/v1/fund-investments/assign', {
        data: { fund_id: fundId, from_goal_id: null, to_goal_id: goalC.goal_id },
      })
      expect(res.status()).toBe(200)
      expect((await res.json()).moved).toBe(2)

      const rows = await (await request.get(`/api/v1/fund-investments?fund_id=${fundId}`)).json()
      const goalOf = (id: string) => rows.find((r: { id: string }) => r.id === id).goal_id
      // Both unallocated rows moved together...
      expect(goalOf(free1.transaction_id)).toBe(goalC.goal_id)
      expect(goalOf(free2.transaction_id)).toBe(goalC.goal_id)
      // ...and the rows that already belonged to a goal stayed there. The old
      // client-side loop moved these too.
      expect(goalOf(txId)).toBe(goalId)
      expect(goalOf(txB.transaction_id)).toBe(goalB.goal_id)

      // Nothing unallocated is left, so a stale repeat is a conflict, not a
      // silent success the dashboard can't explain.
      const repeat = await request.post('/api/v1/fund-investments/assign', {
        data: { fund_id: fundId, from_goal_id: null, to_goal_id: goalC.goal_id },
      })
      expect(repeat.status()).toBe(409)
    } finally {
      await api.deleteTransaction(free1.transaction_id)
      await api.deleteTransaction(free2.transaction_id)
      await api.deleteTransaction(txB.transaction_id)
      await api.deleteGoal(goalB.goal_id)
      await api.deleteGoal(goalC.goal_id)
    }
  })

  test('unassigning a fund from one goal leaves its other-goal rows intact', async ({ request }) => {
    // Same fund split across two goals. The goal-scoped move must clear only
    // goalA's row, not goalB's (#467 P1).
    const goalB = await api.createGoal({ goal_name: `E2E FundUnassign B ${Date.now()}` })
    const txB = await api.createTransaction({
      asset_type: 'fund', fund_id: fundId, goal_id: goalB.goal_id,
      amount_vnd: 1_000_000, units: 50, unit_price: 20_000, investment_date: '2026-02-01',
    })
    try {
      const res = await request.post('/api/v1/fund-investments/assign', {
        data: { fund_id: fundId, from_goal_id: goalId, to_goal_id: null },
      })
      expect(res.status()).toBe(200)
      expect((await res.json()).moved).toBe(1)

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
