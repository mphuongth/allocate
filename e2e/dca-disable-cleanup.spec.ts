import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// Disabling DCA on a fund must drop its pending (un-recorded) seeded allocations
// from every plan, so the fund stops counting toward planned totals — while
// recorded purchases stay put, and re-enabling recreates only the missing rows
// (#473). The cleanup is a DB effect driven by PUT /api/funds/[id], so this runs
// at the route+DB boundary: the authenticated `request` fixture hits the route,
// the service-role client asserts the resulting rows.
test.describe('disabling DCA removes pending plan allocations (#473)', () => {
  const FUND_PREFIX = 'E2E DCA Disable Fund'
  let goalId: string
  let fundId: string
  let fundBody: { name: string; code: string; fund_type: string; nav: number }
  let planPendingId: string // a plan whose seeded row stays pending
  let planRecordedId: string // a plan whose seeded row gets recorded

  test.beforeEach(async () => {
    await api.deleteFundsByNamePrefix(FUND_PREFIX)
    await api.deleteMonthlyPlanByDate(9, 2099)
    await api.deleteMonthlyPlanByDate(10, 2099)

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const goal = await api.createGoal({ goal_name: `E2E DCA Disable Goal ${stamp}` })
    goalId = goal.goal_id
    fundBody = {
      name: `${FUND_PREFIX} ${stamp}`,
      code: `E2E${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      fund_type: 'equity',
      nav: 20_000,
    }
    const fund = await api.createFund({
      ...fundBody,
      is_dca: true,
      dca_monthly_amount_vnd: 2_000_000,
      dca_goal_id: goalId,
    })
    fundId = fund.id

    const planPending = await api.createMonthlyPlan({ month: 9, year: 2099, salary_vnd: 50_000_000 })
    const planRecorded = await api.createMonthlyPlan({ month: 10, year: 2099, salary_vnd: 50_000_000 })
    planPendingId = planPending.id
    planRecordedId = planRecorded.id

    // Seed both plans, then record the buy in one of them.
    await api.rpcSeedPlanDca(planPendingId)
    await api.rpcSeedPlanDca(planRecordedId)
    await api.recordDcaBuy(planRecordedId, fundId, 100, 20_000)
  })

  test.afterEach(async () => {
    if (fundId) await api.deleteFund(fundId)
    if (planPendingId) await api.deleteMonthlyPlan(planPendingId)
    if (planRecordedId) await api.deleteMonthlyPlan(planRecordedId)
    if (goalId) await api.deleteGoal(goalId)
  })

  test('disable drops pending rows, keeps recorded, and re-enable recreates only the missing one', async ({ request }) => {
    // Precondition: both plans have exactly one DCA row.
    expect(await api.countPlanDcaRows(planPendingId, fundId)).toBe(1)
    expect(await api.countPlanDcaRows(planRecordedId, fundId)).toBe(1)

    // Disable DCA through the real route.
    const off = await request.put(`/api/funds/${fundId}`, {
      data: { ...fundBody, is_dca: false },
    })
    expect(off.ok()).toBeTruthy()

    // The pending allocation is gone; the recorded purchase survives.
    expect(await api.countPlanDcaRows(planPendingId, fundId)).toBe(0)
    const recorded = await api.getPlanDcaRows(planRecordedId, fundId)
    expect(recorded).toHaveLength(1)
    expect(recorded[0].units).toBe(100)

    // Re-enable DCA and reload both plans.
    const on = await request.put(`/api/funds/${fundId}`, {
      data: { ...fundBody, is_dca: true, dca_monthly_amount_vnd: 2_000_000, dca_goal_id: goalId },
    })
    expect(on.ok()).toBeTruthy()
    await api.rpcSeedPlanDca(planPendingId)
    await api.rpcSeedPlanDca(planRecordedId)

    // The emptied plan gets a fresh pending row; the recorded plan is untouched
    // (still exactly one row — no duplicate seeded next to the recorded buy).
    expect(await api.countPlanDcaRows(planPendingId, fundId)).toBe(1)
    expect(await api.countPlanDcaRows(planRecordedId, fundId)).toBe(1)
  })
})
