import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// The per-plan insurance-override DELETE endpoint was missing, so "restore
// insurance member" could never clear a lingering override (the request 404'd
// and was silently ignored). This drives the real route end-to-end. (#467)
test.describe('insurance override DELETE (#467)', () => {
  let memberId: string
  let planId: string

  test.beforeEach(async () => {
    await api.deleteMonthlyPlanByDate(8, 2099)
    const member = await api.createInsuranceMember({
      member_name: `E2E InsOverride ${Date.now()}`, relationship: 'self', annual_payment_vnd: 12_000_000, payment_date: '2099-08-01',
    })
    memberId = member.member_id
    const plan = await api.createMonthlyPlan({ month: 8, year: 2099, salary_vnd: 50_000_000 })
    planId = plan.id
  })

  test.afterEach(async () => {
    if (planId) await api.deleteMonthlyPlan(planId)
    if (memberId) await api.deleteInsuranceMember(memberId)
  })

  test('creating then deleting a per-plan insurance override removes it', async ({ request }) => {
    const create = await request.post(`/api/v1/monthly-plans/${planId}/insurance-overrides`, {
      data: { member_id: memberId, monthly_amount_override_vnd: 700_000 },
    })
    expect(create.ok()).toBeTruthy()

    const listed = await (await request.get(`/api/v1/monthly-plans/${planId}/insurance-overrides`)).json()
    const override = listed.find((o: { member_id: string }) => o.member_id === memberId)
    expect(override).toBeTruthy()

    const del = await request.delete(`/api/v1/monthly-plans/${planId}/insurance-overrides/${override.id}`)
    expect(del.status()).toBe(204)

    const after = await (await request.get(`/api/v1/monthly-plans/${planId}/insurance-overrides`)).json()
    expect(after.some((o: { member_id: string }) => o.member_id === memberId)).toBe(false)
  })

  test('rejects a malformed override id (400)', async ({ request }) => {
    const res = await request.delete(`/api/v1/monthly-plans/${planId}/insurance-overrides/not-a-uuid`)
    expect(res.status()).toBe(400)
  })
})
