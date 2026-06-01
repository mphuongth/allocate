import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function openInsuranceTab(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await page.evaluate(() => localStorage.removeItem('insuranceMembersCache'))
  await page.goto('/settings?tab=insurance')
  await page.waitForSelector('[data-testid="create-btn"]', { timeout: 15_000 })
}

test('insurance tab renders table or empty state', async ({ page }) => {
  await openInsuranceTab(page)
  const content = page.locator('table').or(page.getByText(/no insurance members yet|chưa có thành viên/i)).first()
  await expect(content).toBeVisible({ timeout: 15_000 })
})

test('can add an insurance member', async ({ page }) => {
  await openInsuranceTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#member_name').fill('E2E Insurance Member')

  // #relationship is a @base-ui/react Select — exclude native <option> elements, force:true for animation
  await page.locator('#relationship').click()
  await page.locator('[data-open] [role="option"]:not(option)').first().click({ force: true })

  await page.locator('#annual_payment_vnd').fill('12000000')

  // Tie the dialog-close assertion to the actual create request so a slow
  // shared DB (parallel CI shards) can't trip a fixed timeout.
  await Promise.all([
    page.waitForResponse(
      r => r.url().includes('/api/v1/insurance-members') && r.request().method() === 'POST' && r.status() < 400,
      { timeout: 20_000 }
    ),
    page.getByRole('dialog').getByRole('button', { name: /save|add|lưu/i }).click(),
  ])
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

  // Scope to table row (avoids hidden sm:hidden mobile cards)
  const memberRow = page.locator('tr').filter({ hasText: 'E2E Insurance Member' }).first()
  await expect(memberRow).toBeVisible({ timeout: 15_000 })
  // Monthly fee: 12,000,000 / 12 = 1,000,000
  await expect(memberRow.locator('text=/1.000.000|1,000,000/').first()).toBeVisible({ timeout: 5_000 })

  const found = await api.findInsuranceMemberByName('E2E Insurance Member')
  if (found) cleanup.add(() => api.deleteInsuranceMember(found.member_id))
})

test('can edit insurance member annual premium', async ({ page }) => {
  const member = await api.createInsuranceMember({
    member_name: 'E2E Edit Insurance',
    relationship: 'Spouse',
    annual_payment_vnd: 12_000_000,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await openInsuranceTab(page)
  const memberRow = page.locator('tr').filter({ hasText: 'E2E Edit Insurance' }).first()
  await expect(memberRow).toBeVisible({ timeout: 15_000 })

  // Edit button is first icon button in the row
  const editBtn = memberRow.locator('button').nth(0)
  await editBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const annualInput = page.locator('#annual_payment_vnd')
  await annualInput.clear()
  await annualInput.fill('24000000')

  await Promise.all([
    page.waitForResponse(
      r => r.url().includes('/api/v1/insurance-members/') && r.request().method() === 'PUT' && r.status() < 400,
      { timeout: 20_000 }
    ),
    page.getByRole('button', { name: /save|lưu/i }).click(),
  ])
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

  // Monthly should now be 24,000,000 / 12 = 2,000,000
  const updatedRow = page.locator('tr').filter({ hasText: 'E2E Edit Insurance' }).first()
  await expect(updatedRow.locator('text=/2.000.000|2,000,000/').first()).toBeVisible({ timeout: 5_000 })
})

test('can delete an insurance member', async ({ page }) => {
  await api.deleteAllInsuranceMembersByName('E2E Delete Insurance')

  const member = await api.createInsuranceMember({
    member_name: 'E2E Delete Insurance',
    relationship: 'Self',
    annual_payment_vnd: 6_000_000,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await openInsuranceTab(page)
  const memberRow = page.locator('tr').filter({ hasText: 'E2E Delete Insurance' }).first()
  await expect(memberRow).toBeVisible({ timeout: 15_000 })

  // Delete button is second icon button in the row
  const deleteBtn = memberRow.locator('button').nth(1)
  await deleteBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /xác nhận|confirm|delete|xóa/i }).last().click()

  await expect(page.locator('tr').filter({ hasText: 'E2E Delete Insurance' })).toHaveCount(0, { timeout: 15_000 })
})
