import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function openInsuranceTab(page: import('@playwright/test').Page) {
  await page.goto('/settings')
  await page.getByRole('button', { name: /insurance members|bảo hiểm/i }).click()
  await page.waitForLoadState('networkidle')
}

test('insurance tab renders table or empty state', async ({ page }) => {
  await openInsuranceTab(page)
  const content = page.locator('table, [role="table"], text=/no members|empty|chưa có/i').first()
  await expect(content).toBeVisible({ timeout: 8_000 })
})

test('can add an insurance member', async ({ page }) => {
  await openInsuranceTab(page)
  await page.getByRole('button', { name: /add|create|thêm/i }).first().click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#member_name').fill('E2E Insurance Member')

  const relationshipSelect = page.locator('#relationship')
  await relationshipSelect.selectOption({ index: 1 })

  await page.locator('#annual_payment_vnd').fill('12000000')

  await page.getByRole('button', { name: /save|add|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  await expect(page.locator('text=E2E Insurance Member').first()).toBeVisible({ timeout: 8_000 })
  // Monthly fee: 12,000,000 / 12 = 1,000,000
  await expect(page.locator('text=/1.000.000|1,000,000/').first()).toBeVisible({ timeout: 5_000 })

  // Cleanup
  const { data } = await (await import('@supabase/supabase-js'))
    .createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
    .from('insurance_members')
    .select('member_id')
    .eq('member_name', 'E2E Insurance Member')
    .single()
  if (data) cleanup.add(() => api.deleteInsuranceMember(data.member_id))
})

test('can edit insurance member annual premium', async ({ page }) => {
  const member = await api.createInsuranceMember({
    member_name: 'E2E Edit Insurance',
    relationship: 'Spouse',
    annual_payment_vnd: 12_000_000,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await openInsuranceTab(page)
  const memberRow = page.locator('text=E2E Edit Insurance').first()
  await expect(memberRow).toBeVisible({ timeout: 8_000 })

  const editBtn = memberRow.locator('..').locator('..').getByRole('button', { name: /edit|sửa/i }).first()
  await editBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const annualInput = page.locator('#annual_payment_vnd')
  await annualInput.clear()
  await annualInput.fill('24000000')

  await page.getByRole('button', { name: /save|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  // Monthly should now be 24,000,000 / 12 = 2,000,000
  await expect(page.locator('text=/2.000.000|2,000,000/').first()).toBeVisible({ timeout: 5_000 })
})

test('can delete an insurance member', async ({ page }) => {
  const member = await api.createInsuranceMember({
    member_name: 'E2E Delete Insurance',
    relationship: 'Self',
    annual_payment_vnd: 6_000_000,
  })

  await openInsuranceTab(page)
  const memberRow = page.locator('text=E2E Delete Insurance').first()
  await expect(memberRow).toBeVisible({ timeout: 8_000 })

  const deleteBtn = memberRow.locator('..').locator('..').getByRole('button', { name: /delete|xóa/i }).first()
  await deleteBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /confirm|delete|xóa/i }).last().click()

  await expect(page.locator('text=E2E Delete Insurance')).not.toBeVisible({ timeout: 8_000 })
  void member
})
