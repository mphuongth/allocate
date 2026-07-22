import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// DB-level integration test for the atomic DCA auto-seeding RPC (#466).
//
// The old `GET /api/v1/monthly-plans?full=true` read existing DCA rows and
// inserted the missing ones in *separate* operations, so two concurrent loads
// could both see a row missing and both insert it — there was no uniqueness
// constraint to stop them. The fix moves seeding into `seed_and_sync_plan_dca`,
// an atomic RPC whose insert relies on a partial unique index + ON CONFLICT DO
// NOTHING. That guarantee lives entirely in the database, so it's exercised
// here at the DB layer (service-role client, no browser) — the lowest layer
// that can actually catch a duplicate-row race.
test.describe('atomic DCA seeding (#466)', () => {
  let fundId: string
  let planId: string
  let goalId: string

  const FUND_PREFIX = 'E2E DCA Atomic Fund'
  const PLAN_MONTH = 11
  const PLAN_YEAR = 2099

  test.beforeEach(async () => {
    // Sweep anything an interrupted prior run may have left behind, so this
    // spec never trips over its own leftovers on the fixed plan date / a stale
    // fund before it reaches the behavior under test.
    await api.deleteFundsByNamePrefix(FUND_PREFIX)
    await api.deleteMonthlyPlanByDate(PLAN_MONTH, PLAN_YEAR)

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const goal = await api.createGoal({ goal_name: `E2E DCA Atomic ${stamp}` })
    goalId = goal.goal_id
    const fund = await api.createFund({
      name: `${FUND_PREFIX} ${stamp}`,
      // Randomized so a leftover fund from a failed teardown can't collide on
      // the (user_id, code) uniqueness before the sweep above removes it.
      code: `E2E${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
      is_dca: true,
      dca_monthly_amount_vnd: 2_000_000,
      dca_goal_id: goalId,
    })
    fundId = fund.id
    // A far-future month keeps this plan clear of the shared test user's other
    // specs, which all key off 2026 dates (unique on user_id, month, year).
    const plan = await api.createMonthlyPlan({ month: PLAN_MONTH, year: PLAN_YEAR, salary_vnd: 50_000_000 })
    planId = plan.id
  })

  test.afterEach(async () => {
    if (fundId) await api.deleteFund(fundId) // also deletes its investment rows
    if (planId) await api.deleteMonthlyPlan(planId)
    if (goalId) await api.deleteGoal(goalId)
  })

  test('concurrent seeds create exactly one DCA row', async () => {
    // Fire many seeders at once against an empty plan. Every one observes the
    // row missing; the unique index must let only a single insert win.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => api.rpcSeedPlanDca(planId)),
    )
    for (const r of results) expect(r.error).toBeNull()

    const rows = await api.getPlanDcaRows(planId, fundId)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount_vnd).toBe(2_000_000)
    expect(rows[0].goal_id).toBe(goalId)
    expect(rows[0].is_dca_seeded).toBe(true)
  })

  test('repeated seeds stay idempotent and sync the current DCA amount', async () => {
    const first = await api.rpcSeedPlanDca(planId)
    expect(first.error).toBeNull()
    expect(await api.countPlanDcaRows(planId, fundId)).toBe(1)

    // The DCA amount changes (e.g. the user re-toggled DCA). A re-seed should
    // update the pending row in place, never add a second one.
    await api.setFundDca(fundId, { dca_monthly_amount_vnd: 3_500_000 })
    const second = await api.rpcSeedPlanDca(planId)
    expect(second.error).toBeNull()

    const rows = await api.getPlanDcaRows(planId, fundId)
    expect(rows).toHaveLength(1)
    expect(rows[0].amount_vnd).toBe(3_500_000)
  })
})
