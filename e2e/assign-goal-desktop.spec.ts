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

  // This used to assert the "Assigned to" flash itself, and flaked under a full
  // suite run: the flash is a SUCCESS_FLASH_MS transient, so whether Playwright
  // observes it depends on how loaded the machine is, not on the code (#567).
  // The flash's lifecycle is now pinned deterministically with fake timers in
  // app/assets/components/__tests__/UnallocatedSection.test.tsx; what genuinely
  // needs E2E is the round trip this assertion makes instead — confirm really
  // writes the assignment, and the dashboard really reflects it.
  test('confirming assigns the item to the goal and closes the modal', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Success State Goal', target_amount: 50_000_000 })
    // Goal cleanup alone is enough: ON DELETE SET NULL on goal_id FK returns the seed tx to unallocated
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    const row = page.getByTestId('unallocated-row').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    const sheet = page.getByTestId('action-sheet')
    await page.getByTestId('action-assign').click()
    await sheet.getByText('E2E Success State Goal').click()
    await sheet.getByRole('button', { name: /confirm assignment|xác nhận gán/i }).click()

    // The section closes its own modal once the flash ends, then asks for the
    // refresh — so the goal holding the transaction is the settled end state.
    await expect(sheet).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: /E2E Success State Goal/ }))
      .toContainText(/1 (transaction|giao dịch)/i, { timeout: 10_000 })
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
