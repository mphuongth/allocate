import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Insurance members are managed from the dashboard now — the legacy Settings
// insurance tab (/settings?tab=insurance) was removed. Covers add (with the
// coverage round-trip) / edit premium / delete via the dashboard UI.

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// Load the dashboard with a clean overview cache so fresh members show.
async function gotoDashboardFresh(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('dashboardOverviewCache'))
      .forEach((k) => localStorage.removeItem(k))
  )
  await page.reload()
  await page.waitForLoadState('networkidle')
}

test('add an insurance member; its coverage round-trips to the detail panel', async ({ page }) => {
  await api.deleteAllInsuranceMembersByName('E2E Dash Insurance')
  await gotoDashboardFresh(page)

  await page.getByTestId('insurance-add-btn').click()
  const modal = page.getByTestId('add-insurance-modal')
  await expect(modal).toBeVisible()

  await modal.locator('input.cn-input').first().fill('E2E Dash Insurance')
  await modal.getByRole('button', { name: /^(Parent|Cha\/Mẹ)$/ }).click()   // a non-default coverage
  await modal.locator('input[inputmode="numeric"]').fill('12000000')

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/insurance-members') && r.request().method() === 'POST' && r.status() < 400,
      { timeout: 20_000 }
    ),
    modal.getByRole('button', { name: /add member|thêm thành viên/i }).click(),
  ])
  await expect(modal).not.toBeVisible({ timeout: 10_000 })

  const found = await api.findInsuranceMemberByName('E2E Dash Insurance')
  expect(found).toBeTruthy()
  cleanup.add(() => api.deleteInsuranceMember(found!.member_id))

  // Stored as relationship = Parent…
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
  const { data: member } = await supabase
    .from('insurance_members')
    .select('relationship')
    .eq('member_id', found!.member_id)
    .single()
  expect(member?.relationship).toBe('Parent')

  // …and it round-trips back to the detail panel (was broken: read coverage_type).
  const row = page.getByTestId('insurance-row').filter({ hasText: 'E2E Dash Insurance' }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  const panel = page.getByTestId('insurance-detail-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await expect(panel.getByText('Parent')).toBeVisible({ timeout: 10_000 })
})

test('edit an insurance member annual premium', async ({ page }) => {
  const member = await api.createInsuranceMember({
    member_name: 'E2E Dash Edit Insurance',
    relationship: 'Spouse',
    annual_payment_vnd: 12_000_000,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await gotoDashboardFresh(page)
  const row = page.getByTestId('insurance-row').filter({ hasText: 'E2E Dash Edit Insurance' }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  const panel = page.getByTestId('insurance-detail-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await panel.getByTestId('insurance-edit-btn').click()

  const premium = panel.locator('input[inputmode="numeric"]')
  await premium.clear()
  await premium.fill('24000000')

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/v1/insurance-members/') && r.request().method() === 'PUT' && r.status() < 400,
      { timeout: 20_000 }
    ),
    panel.getByRole('button', { name: /^(Save|Lưu)$/ }).click(),
  ])

  await expect.poll(async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
    const { data } = await supabase
      .from('insurance_members')
      .select('annual_payment_vnd')
      .eq('member_id', member.member_id)
      .single()
    return data?.annual_payment_vnd
  }, { timeout: 10_000 }).toBe(24_000_000)
})

test('delete a logged payment from the history and the saved progress drops', async ({ page }) => {
  await api.deleteAllInsuranceMembersByName('E2E Dash Undo Payment')
  const member = await api.createInsuranceMember({
    member_name: 'E2E Dash Undo Payment',
    relationship: 'Self',
    annual_payment_vnd: 12_000_000,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  // Seed an ad-hoc logged contribution in the current cycle.
  const today = new Date().toISOString().slice(0, 10)
  const saving = await api.createInsuranceSaving({
    insurance_member_id: member.member_id,
    amount_saved_vnd: 1_500_000,
    saved_date: today,
  })
  expect(await api.countInsuranceSavings(member.member_id)).toBe(1)

  await gotoDashboardFresh(page)
  const row = page.getByTestId('insurance-row').filter({ hasText: 'E2E Dash Undo Payment' }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  const panel = page.getByTestId('insurance-detail-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  // The logged payment is listed in the history.
  await expect(panel.getByText(/Logged payment|Đã ghi nhận/)).toBeVisible({ timeout: 10_000 })

  // Delete it and confirm.
  await panel.getByTestId(`insurance-delete-savings-${saving.id}`).click()
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/api/v1/insurance-savings/${saving.id}`) && r.request().method() === 'DELETE' && r.status() < 400,
      { timeout: 20_000 }
    ),
    page.getByTestId('insurance-delete-savings-confirm').click(),
  ])

  // Closes the loop: the row is gone from the DB (saved progress drops to match).
  await expect.poll(async () => await api.countInsuranceSavings(member.member_id), { timeout: 10_000 }).toBe(0)
  await expect(panel.getByText(/Logged payment|Đã ghi nhận/)).not.toBeVisible({ timeout: 10_000 })
})

test('delete an insurance member', async ({ page }) => {
  await api.deleteAllInsuranceMembersByName('E2E Dash Delete Insurance')
  const member = await api.createInsuranceMember({
    member_name: 'E2E Dash Delete Insurance',
    relationship: 'Self',
    annual_payment_vnd: 6_000_000,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await gotoDashboardFresh(page)
  const row = page.getByTestId('insurance-row').filter({ hasText: 'E2E Dash Delete Insurance' }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  const panel = page.getByTestId('insurance-detail-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await panel.getByTestId('insurance-remove-btn').click()
  await page.getByTestId('insurance-remove-confirm').click()

  await expect.poll(async () => await api.findInsuranceMemberByName('E2E Dash Delete Insurance'), { timeout: 10_000 }).toBeFalsy()
})
