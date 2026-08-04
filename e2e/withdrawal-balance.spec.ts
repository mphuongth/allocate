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

  // The shape rules, through the real route: a withdrawal that omits the number to
  // be measured is a bad request, not a withdrawal of nothing (see the decision
  // table in the PR / migration header).
  test('a withdrawal must record what it takes out', async ({ request }) => {
    // Bank: principal is the delta, and it is required.
    for (const principal of [undefined, 0]) {
      const res = await request.post('/api/v1/investment-transactions', {
        data: { ...withdraw(10_000_000), principal_withdrawn: principal },
      })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toMatch(/principal_withdrawn is required/)
    }

    // Bank needs no units, so an ordinary withdrawal still goes through.
    expect((await request.post('/api/v1/investment-transactions', { data: withdraw(10_000_000) })).status()).toBe(201)
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

  // parent_transaction_id is ON DELETE SET NULL, so deleting a partly withdrawn
  // deposit orphans its children through an update that lands on the trigger.
  // That used to be permitted, and the cash stayed in history filed under no
  // holding at all — #607. #608 refuses it from both ends: an edit may not take a
  // source below what has left it, and a delete is that edit taken all the way.
  //
  // This is the one path that has to be driven through the ROUTE rather than a
  // helper: the helpers delete children first, so they never produce the orphan,
  // and it is the route that has to turn the refusal into a 409 the user can act
  // on instead of a 500.
  test('a source that has been partly withdrawn cannot be deleted under its withdrawal', async ({ request }) => {
    expect((await request.post('/api/v1/investment-transactions', { data: withdraw(30_000_000) })).status()).toBe(201)

    const refused = await request.delete(`/api/v1/investment-transactions/${depositId}`)
    expect(refused.status()).toBe(409)
    expect((await refused.json()).code).toBe('withdrawal_invariant')

    // Still there, and still whole.
    let listed = await (await request.get(
      `/api/v1/investment-transactions?goal_id=${goalId}&limit=100`)).json()
    let rows = listed.transactions as Array<{ transaction_id: string; transaction_type: string }>
    expect(rows.find((t) => t.transaction_id === depositId)).toBeDefined()

    // The remedy is the ledger's own: remove the withdrawal, then the holding.
    const wd = rows.find((t) => t.transaction_type === 'withdrawal')!
    expect((await request.delete(`/api/v1/investment-transactions/${wd.transaction_id}`)).status()).toBe(200)
    expect((await request.delete(`/api/v1/investment-transactions/${depositId}`)).status()).toBe(200)

    listed = await (await request.get(
      `/api/v1/investment-transactions?goal_id=${goalId}&limit=100`)).json()
    rows = listed.transactions as Array<{ transaction_id: string; transaction_type: string }>
    expect(rows.find((t) => t.transaction_id === depositId)).toBeUndefined()
  })

  // The edit half of the same rule, through the route: PUT already maps the
  // family to a 400, so shrinking a deposit under what has left it must read as a
  // refused edit rather than a 404 or a server fault.
  test('a source cannot be edited below what has been withdrawn from it', async ({ request }) => {
    expect((await request.post('/api/v1/investment-transactions', { data: withdraw(80_000_000) })).status()).toBe(201)

    const refused = await request.put(`/api/v1/investment-transactions/${depositId}`, {
      data: { amount_vnd: 50_000_000 },
    })
    expect(refused.status()).toBe(400)
    expect((await refused.json()).code).toBe('withdrawal_invariant')

    // Down to exactly what is left is an ordinary correction, not an overdraw.
    expect((await request.put(`/api/v1/investment-transactions/${depositId}`, {
      data: { amount_vnd: 80_000_000 },
    })).status()).toBe(200)
  })

  // Selling a gold lot whose principal doesn't divide evenly by its units: the
  // client used to derive the cost basis through a rounded per-unit price, which
  // posts a đồng MORE than the holding has — so the balance guard would refuse an
  // ordinary "sell all". The basis is now stated exactly for a full sale; this
  // drives the arithmetic through the route to prove the two agree.
  test('selling a whole gold holding is not refused by cost-basis rounding', async ({ request }) => {
    const gold = await api.createTransaction({
      asset_type: 'gold', goal_id: goalId, amount_vnd: 123_456_789, units: 10,
      unit_price: 12_345_679, investment_date: '2026-01-01', notes: 'E2E wd balance gold',
    })
    try {
      const res = await request.post('/api/v1/investment-transactions', {
        data: {
          transaction_type: 'withdrawal', asset_type: 'gold',
          parent_transaction_id: gold.transaction_id, investment_date: '2026-02-01',
          amount_vnd: 130_000_000, units_withdrawn: 10,
          principal_withdrawn: 123_456_789, goal_id: goalId,
        },
      })
      expect(res.status()).toBe(201)
    } finally {
      await api.deleteTransactionCascade(gold.transaction_id)
    }
  })

  // fund_id is ON DELETE SET NULL too, so deleting a fund orphans its sells
  // through the same kind of update as deleting a deposit. Same failure mode, a
  // different route — and the helpers hide it the same way.
  test('a fund that has been sold from can still be deleted', async ({ request }) => {
    const fund = await api.createFund({
      name: `E2E WdBalance Del ${Date.now()}`,
      code: `WBD${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
    })
    const buy = await api.createTransaction({
      asset_type: 'fund', fund_id: fund.id, goal_id: goalId,
      amount_vnd: 2_000_000, units: 100, unit_price: 20_000, investment_date: '2026-01-01',
    })
    const sell = await request.post('/api/v1/investment-transactions', {
      data: {
        transaction_type: 'withdrawal', asset_type: 'fund', fund_id: fund.id,
        investment_date: '2026-02-01', amount_vnd: 1_000_000,
        units_withdrawn: 50, principal_withdrawn: 1_000_000, goal_id: goalId,
        notes: 'E2E wd balance fund',
      },
    })
    expect(sell.status()).toBe(201)

    try {
      const del = await request.delete(`/api/funds/${fund.id}`)
      expect(del.ok()).toBeTruthy()
    } finally {
      await api.deleteTransactionCascade(buy.transaction_id)
      await api.deleteAllTransactionsByNotes('E2E wd balance fund')
      await api.deleteFund(fund.id)
    }
  })

  // Assigning a fund moves its purchases AND its sells to the new goal in one
  // statement (#589). A row-level check saw that half-applied, so whether it
  // passed depended on heap order — and editing the buy is enough to flip it.
  // This is the plain sequence a user does: buy, sell some, fix the buy, then
  // assign the fund to a goal.
  test('a fund with sell history can still be assigned to a goal', async ({ request }) => {
    const fund = await api.createFund({
      name: `E2E WdBalance Assign ${Date.now()}`,
      code: `WBA${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
    })
    const target = await api.createGoal({ goal_name: `E2E WdBalance Target ${Date.now()}` })
    const buy = await api.createTransaction({
      asset_type: 'fund', fund_id: fund.id,
      amount_vnd: 2_000_000, units: 100, unit_price: 20_000, investment_date: '2026-01-01',
    })
    try {
      const sell = await request.post('/api/v1/investment-transactions', {
        data: {
          transaction_type: 'withdrawal', asset_type: 'fund', fund_id: fund.id,
          investment_date: '2026-02-01', amount_vnd: 600_000,
          units_withdrawn: 30, principal_withdrawn: 600_000, goal_id: null,
          notes: 'E2E wd balance fund',
        },
      })
      expect(sell.status()).toBe(201)

      // Editing the purchase rewrites it later in the heap, so the assign's single
      // UPDATE reaches the sell first — the order that used to fail.
      const edit = await request.put(`/api/v1/investment-transactions/${buy.transaction_id}`, {
        data: {
          asset_type: 'fund', fund_id: fund.id, investment_date: '2026-01-02',
          amount_vnd: 2_000_000, units: 100, unit_price: 20_000,
        },
      })
      expect(edit.ok()).toBeTruthy()

      const assign = await request.post('/api/v1/fund-investments/assign', {
        data: { fund_id: fund.id, from_goal_id: null, to_goal_id: target.goal_id },
      })
      expect(assign.status()).toBe(200)
      // The sell moved with its purchases — the bucket did not split.
      expect((await assign.json()).moved).toBe(2)
    } finally {
      await api.deleteTransactionCascade(buy.transaction_id)
      await api.deleteAllTransactionsByNotes('E2E wd balance fund')
      await api.deleteFund(fund.id)
      await api.deleteGoal(target.goal_id)
    }
  })

  // The basis a fund sale takes out now comes from the dashboard as a number
  // (`costBasis`) instead of being reconstructed from the averaged purchase price.
  // This drives the real DTO → helper → route → invariant path, on a bucket whose
  // basis divides into no whole đồng per unit, which is where the old arithmetic
  // landed a đồng above the holding and the invariant refused an ordinary sale.
  test('the dashboard reports a fund cost basis a full sale can take exactly', async ({ request }) => {
    const fund = await api.createFund({
      name: `E2E WdBalance Basis ${Date.now()}`,
      code: `WBB${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
    })
    // 1,000,001 over 3 units: no third of it is a whole đồng.
    const buy = await api.createTransaction({
      asset_type: 'fund', fund_id: fund.id, goal_id: goalId,
      amount_vnd: 1_000_001, units: 3, unit_price: 333_334, investment_date: '2026-01-01',
    })
    try {
      const overview = await (await request.get('/api/v1/dashboard/overview')).json()
      const bucket = (overview.goals as Array<{ goalId: string; funds: Array<{ fundId: string; costBasis: number; quantity: number }> }>)
        .find((g) => g.goalId === goalId)!
        .funds.find((f) => f.fundId === fund.id)!
      // The DTO carries it, so no client has to rebuild it from an average.
      expect(bucket.costBasis).toBe(1_000_001)

      const sell = await request.post('/api/v1/investment-transactions', {
        data: {
          transaction_type: 'withdrawal', asset_type: 'fund', fund_id: fund.id,
          investment_date: '2026-02-01', amount_vnd: 1_000_001,
          units_withdrawn: bucket.quantity, principal_withdrawn: bucket.costBasis,
          goal_id: goalId, notes: 'E2E wd balance fund',
        },
      })
      expect(sell.status()).toBe(201)

      // And a đồng more than the basis is still an overdraw.
      const over = await request.post('/api/v1/investment-transactions', {
        data: {
          transaction_type: 'withdrawal', asset_type: 'fund', fund_id: fund.id,
          investment_date: '2026-03-01', amount_vnd: 1000,
          units_withdrawn: 0.0001, principal_withdrawn: 1000,
          goal_id: goalId, notes: 'E2E wd balance fund',
        },
      })
      expect(over.status()).toBe(400)
    } finally {
      await api.deleteTransactionCascade(buy.transaction_id)
      await api.deleteAllTransactionsByNotes('E2E wd balance fund')
      await api.deleteFund(fund.id)
    }
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
