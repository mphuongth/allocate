import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// Ownership of foreign-key targets must be enforced, not just their UUID shape
// (#474). RLS guarantees the row's own user_id, but not that a supplied fund_id
// / goal_id / dca_goal_id belongs to the same user — so a caller who knows
// another user's record UUID could otherwise forge a cross-user link. These hit
// the routes with the authenticated test user while referencing a *second*
// user's records, and expect a 403.
test.describe('FK ownership enforcement (#474)', () => {
  let foreign: { userId: string; goalId: string; fundId: string; txId: string }
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

  test('POST /api/v1/investment-transactions rejects a cross-user parent_transaction_id (403)', async ({ request }) => {
    const res = await request.post('/api/v1/investment-transactions', {
      data: { transaction_type: 'withdrawal', parent_transaction_id: foreign.txId, amount_vnd: 500_000, principal_withdrawn: 500_000, investment_date: '2026-01-01' },
    })
    expect(res.status()).toBe(403)
  })

  // A held settlement must name the deposit it closes (#588), so this needs a
  // real source of the caller's own — otherwise the request is refused for being
  // sourceless (400) and the ownership rule is never reached, which is the rule
  // this case exists to pin.
  test('POST /api/v1/investment-transactions rejects a cross-user merge_target_goal_id (403)', async ({ request }) => {
    const src = await api.createTransaction({
      asset_type: 'bank', goal_id: ownGoalId, amount_vnd: 1_000_000,
      interest_rate: 5, expiry_date: '2027-01-01', investment_date: '2026-01-01',
    })
    try {
      const res = await request.post('/api/v1/investment-transactions', {
        data: {
          transaction_type: 'withdrawal', held_for_merge: true,
          parent_transaction_id: src.transaction_id,
          merge_target_goal_id: foreign.goalId,
          amount_vnd: 500_000, investment_date: '2026-01-01',
        },
      })
      expect(res.status()).toBe(403)
    } finally {
      await api.deleteTransactionCascade(src.transaction_id)
    }
  })

  // ---- fund-investments/assign: to_goal_id ---------------------------------
  // The scoped move writes goal_id onto every unallocated row of a fund, so an
  // unchecked target would park the caller's own holdings under a stranger's goal
  // and report a successful move (#589).
  test('POST /api/v1/fund-investments/assign rejects a cross-user to_goal_id (403)', async ({ request }) => {
    const res = await request.post('/api/v1/fund-investments/assign', {
      data: { fund_id: ownFundId, from_goal_id: null, to_goal_id: foreign.goalId },
    })
    expect(res.status()).toBe(403)
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

// #474 covered investment_transactions and funds. #525 extended the same
// guarantee to the plan-scoped override tables and the insurance/recurring
// references — nine relationships that previously validated only the row's own
// scope, so a caller who knew a foreign UUID could attach it.
//
// Each route is hit with the authenticated test user's own plan while pointing
// at a *second* user's record. The DB triggers are the authoritative backstop
// (supabase/tests/fk_ownership_all.test.sql drives all nine directly); these
// assert the API turns that into a 403 instead of a 500 from mid-write.
test.describe('FK ownership enforcement — plan-scoped and user-scoped (#525)', () => {
  let foreign: Awaited<ReturnType<typeof api.createForeignOwned>>
  let planId: string

  test.beforeAll(async () => {
    foreign = await api.createForeignOwned()
    // A month of its own so this can't collide with the planning specs' fixtures.
    const plan = await api.createMonthlyPlan({ month: 3, year: 2031, salary_vnd: 50_000_000 })
    planId = plan.id
  })

  test.afterAll(async () => {
    if (planId) await api.deleteMonthlyPlan(planId)
    if (foreign) await api.deleteForeignUser(foreign.userId)
  })

  test('insurance-overrides rejects a cross-user member_id (403)', async ({ request }) => {
    const res = await request.post(`/api/v1/monthly-plans/${planId}/insurance-overrides`, {
      data: { member_id: foreign.memberId, monthly_amount_override_vnd: 500_000 },
    })
    expect(res.status()).toBe(403)
  })

  test('excluded-insurance rejects a cross-user member_id (403)', async ({ request }) => {
    const res = await request.post(`/api/v1/monthly-plans/${planId}/excluded-insurance`, {
      data: { member_id: foreign.memberId },
    })
    expect(res.status()).toBe(403)
  })

  test('fixed-expense-overrides rejects a cross-user fixed_expense_id (403)', async ({ request }) => {
    const res = await request.post(`/api/v1/monthly-plans/${planId}/fixed-expense-overrides`, {
      data: { fixed_expense_id: foreign.expenseId, monthly_amount_override_vnd: 500_000 },
    })
    expect(res.status()).toBe(403)
  })

  test('recurring-saving-overrides rejects a cross-user recurring_saving_id (403)', async ({ request }) => {
    const res = await request.post(`/api/v1/monthly-plans/${planId}/recurring-saving-overrides`, {
      data: { recurring_saving_id: foreign.recurringId, monthly_amount_override_vnd: 500_000 },
    })
    expect(res.status()).toBe(403)
  })

  test('dca-skips rejects a cross-user fund_id (403)', async ({ request }) => {
    const res = await request.post(`/api/v1/monthly-plans/${planId}/dca-skips`, {
      data: { fund_id: foreign.fundId },
    })
    expect(res.status()).toBe(403)
  })

  test('insurance-savings rejects a cross-user insurance_member_id (403)', async ({ request }) => {
    const res = await request.post('/api/v1/insurance-savings', {
      data: { insurance_member_id: foreign.memberId, amount_saved_vnd: 1_000_000 },
    })
    expect(res.status()).toBe(403)
  })

  test('recurring-savings rejects a cross-user goal_id (403)', async ({ request }) => {
    const res = await request.post('/api/v1/recurring-savings', {
      data: { name: `E2E FK Recurring ${Date.now()}`, amount_vnd: 1_000_000, goal_id: foreign.goalId },
    })
    expect(res.status()).toBe(403)
  })

  // Create and update have to answer the same way. Without a check on the PUT
  // path the trigger fires mid-write and this route's catch-all reports it as
  // "not found" — a 404 about a row that is right there.
  test('recurring-savings PUT rejects a move to a cross-user goal_id (403)', async ({ request }) => {
    const saving = await api.createRecurringSaving({
      name: `E2E FK Put Recurring ${Date.now()}`,
      amount_vnd: 1_000_000,
    })
    try {
      const res = await request.put(`/api/v1/recurring-savings/${saving.saving_id}`, {
        data: { goal_id: foreign.goalId },
      })
      expect(res.status()).toBe(403)
    } finally {
      await api.deleteRecurringSaving(saving.saving_id)
    }
  })

  // The same guard must not get in the way of a legitimate write.
  test('a plan override against the caller’s own record still succeeds', async ({ request }) => {
    const member = await api.createInsuranceMember({
      member_name: `E2E FK Own Member ${Date.now()}`,
      relationship: 'self',
      annual_payment_vnd: 12_000_000,
    })
    try {
      const res = await request.post(`/api/v1/monthly-plans/${planId}/insurance-overrides`, {
        data: { member_id: member.member_id, monthly_amount_override_vnd: 500_000 },
      })
      expect(res.ok()).toBe(true)
    } finally {
      await api.deleteInsuranceMember(member.member_id)
    }
  })
})
