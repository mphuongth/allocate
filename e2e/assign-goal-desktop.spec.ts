import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Desktop Chrome (1280×800) — unallocated section uses the two-step inline
// DModal flow (desktopCard + onDesktopAssign) introduced in PR #199.

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// Pre-clean any stale E2E goals from a previous interrupted run
test.beforeAll(async () => {
  const names = [
    'E2E Assign Picker Test Goal',
    'E2E Pct Goal',
    'E2E Back Button Goal',
    'E2E Confirm Disabled Goal',
    'E2E Select Enables Confirm Goal',
    'E2E Success State Goal',
  ]
  for (const name of names) {
    const existing = await api.findGoalByName(name)
    if (existing) await api.deleteGoal(existing.goal_id)
  }
  await api.deleteAllTransactionsByNotes('E2E Success State TX')
})

test.describe('Desktop assign-to-goal two-step modal (PR #199)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('clicking unallocated row opens Options modal', async ({ page }) => {
    const row = page.getByTestId('unallocated-row').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    const sheet = page.getByTestId('action-sheet')
    await expect(sheet).toBeVisible({ timeout: 5_000 })
    await expect(sheet.locator('h3').filter({ hasText: /options|tùy chọn/i })).toBeVisible({ timeout: 5_000 })
  })

  test('Options modal shows Assign to goal action button', async ({ page }) => {
    await page.getByTestId('unallocated-row').first().click()
    await expect(page.getByTestId('action-assign')).toBeVisible({ timeout: 5_000 })
  })

  test('Assign to goal transitions the modal to the goal picker step', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Assign Picker Test Goal', target_amount: 50_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    await page.getByTestId('unallocated-row').first().click()
    await page.getByTestId('action-assign').click()

    const sheet = page.getByTestId('action-sheet')
    await expect(sheet.locator('h3').filter({ hasText: /assign to goal|gán vào mục tiêu/i })).toBeVisible({ timeout: 5_000 })
    await expect(sheet.getByText('E2E Assign Picker Test Goal')).toBeVisible({ timeout: 5_000 })
  })

  test('goal picker shows progress percentage for goals with a target amount', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Pct Goal', target_amount: 50_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    await page.getByTestId('unallocated-row').first().click()
    await page.getByTestId('action-assign').click()

    const sheet = page.getByTestId('action-sheet')
    await expect(sheet.getByText('E2E Pct Goal')).toBeVisible({ timeout: 5_000 })
    // 0% shown because no investments are assigned yet
    await expect(sheet.getByText('0%')).toBeVisible({ timeout: 5_000 })
  })

  test('Back button returns to the Options step', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Back Button Goal', target_amount: 50_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    await page.getByTestId('unallocated-row').first().click()
    await page.getByTestId('action-assign').click()

    const sheet = page.getByTestId('action-sheet')
    await expect(sheet.locator('h3').filter({ hasText: /assign to goal|gán vào mục tiêu/i })).toBeVisible({ timeout: 5_000 })

    await sheet.getByRole('button', { name: /back|quay lại/i }).click()

    await expect(sheet.locator('h3').filter({ hasText: /options|tùy chọn/i })).toBeVisible({ timeout: 5_000 })
  })

  test('Confirm button is disabled until a goal is selected', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Confirm Disabled Goal', target_amount: 50_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    await page.getByTestId('unallocated-row').first().click()
    await page.getByTestId('action-assign').click()

    const sheet = page.getByTestId('action-sheet')
    await expect(sheet.getByText('E2E Confirm Disabled Goal')).toBeVisible({ timeout: 5_000 })
    await expect(sheet.getByRole('button', { name: /confirm assignment|xác nhận gán/i })).toBeDisabled()
  })

  test('selecting a goal enables the Confirm button', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Select Enables Confirm Goal', target_amount: 50_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    await page.getByTestId('unallocated-row').first().click()
    await page.getByTestId('action-assign').click()

    const sheet = page.getByTestId('action-sheet')
    await sheet.getByText('E2E Select Enables Confirm Goal').click()
    await expect(sheet.getByRole('button', { name: /confirm assignment|xác nhận gán/i })).not.toBeDisabled()
  })

  test('confirming shows "Assigned to" success state with the goal name', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Success State Goal', target_amount: 50_000_000 })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    // Create a dedicated unallocated tx so the global-setup bank tx remains unallocated
    const tx = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 3_000_000,
      investment_date: '2026-02-01',
      interest_rate: 5,
      notes: 'E2E Success State TX',
    })
    cleanup.add(() => api.deleteTransaction(tx.transaction_id))

    await page.reload()
    await page.waitForLoadState('networkidle')

    const targetRow = page.getByTestId('unallocated-row').filter({ hasText: 'E2E Success State TX' })
    await expect(targetRow).toBeVisible({ timeout: 10_000 })
    await targetRow.click()

    const sheet = page.getByTestId('action-sheet')
    await page.getByTestId('action-assign').click()
    await sheet.getByText('E2E Success State Goal').click()
    await sheet.getByRole('button', { name: /confirm assignment|xác nhận gán/i }).click()

    // Success state: "Assigned to" + goal name
    await expect(sheet.getByText(/assigned to|đã gán vào/i)).toBeVisible({ timeout: 8_000 })
    await expect(sheet.getByText('E2E Success State Goal')).toBeVisible({ timeout: 5_000 })
  })

  test('backdrop click closes the Options modal', async ({ page }) => {
    await page.getByTestId('unallocated-row').first().click()
    const sheet = page.getByTestId('action-sheet')
    await expect(sheet.locator('h3').filter({ hasText: /options|tùy chọn/i })).toBeVisible({ timeout: 5_000 })

    await page.mouse.click(10, 10)

    await expect(sheet).not.toBeVisible({ timeout: 3_000 })
  })

  test('X button dismisses the Options modal', async ({ page }) => {
    await page.getByTestId('unallocated-row').first().click()
    const sheet = page.getByTestId('action-sheet')
    await expect(sheet.locator('h3').filter({ hasText: /options|tùy chọn/i })).toBeVisible({ timeout: 5_000 })

    await sheet.getByRole('button', { name: /close/i }).click()

    await expect(sheet).not.toBeVisible({ timeout: 3_000 })
  })
})
