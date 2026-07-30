import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// A withdrawal may never take more than its holding still holds (#587). The sell
// sheets capped it client-side; the API took what it was given.
//
// The invariant is a database trigger measuring the balance under a lock on the
// source (supabase/migrations/20260730000002), and unit tests pin its filters and
// the route's 400. What only a real stack can show is the part the whole design
// exists for: two sells racing for the same balance, where exactly one may win.
test.describe('withdrawal balance enforcement (#587)', () => {
  let goalId: string
  let depositId: string

  test.beforeEach(async () => {
    const goal = await api.createGoal({ goal_name: `E2E WdBalance ${Date.now()}` })
    goalId = goal.goal_id
    const tx = await api.createTransaction({
      asset_type: 'bank', goal_id: goalId, amount_vnd: 100_000_000,
      investment_date: '2026-01-01', notes: 'E2E wd balance',
    })
    depositId = tx.transaction_id
  })

  test.afterEach(async () => {
    if (depositId) await api.deleteTransactionCascade(depositId)
    if (goalId) await api.deleteGoal(goalId)
  })

  const withdraw = (principal: number) => ({
    transaction_type: 'withdrawal',
    asset_type: 'bank',
    parent_transaction_id: depositId,
    investment_date: '2026-02-01',
    amount_vnd: principal,
    principal_withdrawn: principal,
    goal_id: goalId,
  })

  test('a withdrawal above the remaining principal is refused, and the balance still spends down to zero', async ({ request }) => {
    const first = await request.post('/api/v1/investment-transactions', { data: withdraw(60_000_000) })
    expect(first.status()).toBe(201)

    // 50M more would take 110M out of a 100M book. Refused — and as a 400 saying
    // why, not the 500 every insert failure used to collapse into.
    const over = await request.post('/api/v1/investment-transactions', { data: withdraw(50_000_000) })
    expect(over.status()).toBe(400)
    expect((await over.json()).error).toMatch(/remaining balance/i)

    // The 40M actually left still goes out: the guard is a cap, not a lock.
    const rest = await request.post('/api/v1/investment-transactions', { data: withdraw(40_000_000) })
    expect(rest.status()).toBe(201)

    // Nothing is left, so even 1 đồng is refused.
    const empty = await request.post('/api/v1/investment-transactions', { data: withdraw(1) })
    expect(empty.status()).toBe(400)
  })

  // The race the invariant exists for. Both requests read the same balance before
  // either commits, so a client-side cap — or a server-side read without a lock —
  // lets both through and the deposit goes past zero.
  test('two sells racing for the same balance: exactly one wins', async ({ request }) => {
    const [a, b] = await Promise.all([
      request.post('/api/v1/investment-transactions', { data: withdraw(100_000_000) }),
      request.post('/api/v1/investment-transactions', { data: withdraw(100_000_000) }),
    ])
    const statuses = [a.status(), b.status()].sort()

    expect(statuses).toEqual([201, 400])

    // And the ledger agrees: one withdrawal, for the whole balance.
    const listed = await (await request.get(
      `/api/v1/investment-transactions?goal_id=${goalId}&limit=100`)).json()
    const outgoing = (listed.transactions as Array<{ transaction_type: string; principal_withdrawn: number | null }>)
      .filter((t) => t.transaction_type === 'withdrawal')
    expect(outgoing).toHaveLength(1)
    expect(outgoing[0].principal_withdrawn).toBe(100_000_000)
  })

  // A fund sell has no parent row: its balance is the (goal, fund) bucket the
  // dashboard aggregates. Units held for one goal must not fund another's sell.
  test('a fund sell draws only on the goal it was picked from', async ({ request }) => {
    const fund = await api.createFund({
      name: `E2E WdBalance Fund ${Date.now()}`,
      code: `WBF${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
    })
    const otherGoal = await api.createGoal({ goal_name: `E2E WdBalance Other ${Date.now()}` })
    const buy = await api.createTransaction({
      asset_type: 'fund', fund_id: fund.id, goal_id: goalId,
      amount_vnd: 2_000_000, units: 100, unit_price: 20_000, investment_date: '2026-01-01',
    })
    const sell = (goal: string | null, units: number) => ({
      transaction_type: 'withdrawal', asset_type: 'fund', fund_id: fund.id,
      investment_date: '2026-02-01', amount_vnd: units * 20_000,
      units_withdrawn: units, principal_withdrawn: units * 20_000, goal_id: goal,
      // A fund sell has no parent row to cascade from, so tag it for cleanup.
      notes: 'E2E wd balance fund',
    })
    try {
      // The other goal holds none of this fund.
      const wrongGoal = await request.post('/api/v1/investment-transactions', { data: sell(otherGoal.goal_id, 10) })
      expect(wrongGoal.status()).toBe(400)

      // Unallocated holds none of it either — this is the bucket the sheet used to
      // post to for a goal-allocated fund.
      const unallocated = await request.post('/api/v1/investment-transactions', { data: sell(null, 10) })
      expect(unallocated.status()).toBe(400)

      // The goal that actually holds the units can sell them, up to its balance.
      expect((await request.post('/api/v1/investment-transactions', { data: sell(goalId, 100) })).status()).toBe(201)
      expect((await request.post('/api/v1/investment-transactions', { data: sell(goalId, 1) })).status()).toBe(400)
    } finally {
      await api.deleteTransactionCascade(buy.transaction_id)
      await api.deleteAllTransactionsByNotes('E2E wd balance fund')
      await api.deleteFund(fund.id)
      await api.deleteGoal(otherGoal.goal_id)
    }
  })
})
