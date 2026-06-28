import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Goals are managed from the dashboard now — the legacy Settings goals view
// (/settings?tab=goals) was removed. These cover goal create / edit / delete
// via the dashboard UI. Goal-detail withdraw/sell/affects-progress live in
// goal-detail-desktop.spec.ts. Desktop viewport (Desktop Chrome default).

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// Load the dashboard with a clean overview cache so freshly-created goals show
// (the dashboard caches the overview in localStorage per user).
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

test('create goal modal has target date, icon picker and priority fields', async ({ page }) => {
  await gotoDashboardFresh(page)
  await page.getByTestId('desktop-new-goal-btn').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[type="month"]')).toBeVisible()
  await expect(page.locator('[data-testid^="goal-icon-btn-"]')).toHaveCount(5)
  await expect(page.getByTestId('priority-btn-low')).toBeVisible()
  await expect(page.getByTestId('priority-btn-med')).toBeVisible()
  await expect(page.getByTestId('priority-btn-high')).toBeVisible()
})

test('create goal shows live save-per-month and saves icon/priority/date to db', async ({ page }) => {
  const name = 'E2E Dash Create Goal'
  const stale = await api.findGoalByName(name)
  if (stale) await api.deleteGoal(stale.goal_id)

  await gotoDashboardFresh(page)
  await page.getByTestId('desktop-new-goal-btn').click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.locator('input[type="text"]').first().fill(name)
  await dialog.locator('input[inputmode="numeric"]').first().fill('50000000')
  await dialog.locator('input[type="month"]').fill('2028-06')

  // Live save-per-month appears once amount + date are set.
  await expect(page.getByTestId('save-per-month')).toBeVisible()

  await page.getByTestId('goal-icon-btn-home').click()
  await page.getByTestId('priority-btn-high').click()

  await dialog.locator('button[type="submit"]').click()
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })

  const found = await api.findGoalByName(name)
  expect(found).toBeTruthy()
  cleanup.add(() => api.deleteGoal(found!.goal_id))

  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
  const { data: goal } = await supabase
    .from('savings_goals')
    .select('target_date, icon, priority, target_amount')
    .eq('goal_id', found!.goal_id)
    .single()
  expect(goal?.target_date).toBe('2028-06')
  expect(goal?.icon).toBe('home')
  expect(goal?.priority).toBe('high')
  expect(goal?.target_amount).toBe(50_000_000)
})

test('can edit a savings goal from the goal detail panel', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Dash Edit Goal', target_amount: 20_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await gotoDashboardFresh(page)
  await page.getByText('E2E Dash Edit Goal').first().click()
  const panel = page.getByTestId('desktop-goal-detail')
  await expect(panel).toBeVisible({ timeout: 10_000 })

  // Hero "Goal options" (aria-label is hardcoded, not localised) → Edit.
  await panel.getByRole('button', { name: 'Goal options', exact: true }).click()
  await page.getByText(/^(Edit goal|Chỉnh sửa mục tiêu)$/).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const nameInput = dialog.locator('input[type="text"]').first()
  await nameInput.clear()
  await nameInput.fill('E2E Dash Edit Goal Updated')
  await page.getByRole('button', { name: /Save changes|Lưu thay đổi/i }).click()
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })

  await expect.poll(async () => (await api.findGoalByName('E2E Dash Edit Goal Updated'))?.goal_id, { timeout: 10_000 })
    .toBe(goal.goal_id)
})

test('can delete a savings goal from the goal detail panel', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Dash Delete Goal' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await gotoDashboardFresh(page)
  await page.getByText('E2E Dash Delete Goal').first().click()
  const panel = page.getByTestId('desktop-goal-detail')
  await expect(panel).toBeVisible({ timeout: 10_000 })

  await panel.getByRole('button', { name: 'Goal options', exact: true }).click()
  // Options menu → Delete goal.
  await page.getByText(/^(Delete goal|Xoá mục tiêu)$/).click()
  // Confirm in the delete dialog (its title carries a "?").
  const delDialog = page.getByRole('dialog').filter({ hasText: /Delete goal\?|Xoá mục tiêu\?/ })
  await delDialog.getByRole('button', { name: /^(Delete goal|Xoá mục tiêu)$/ }).click()

  await expect.poll(async () => await api.findGoalByName('E2E Dash Delete Goal'), { timeout: 10_000 }).toBeFalsy()
})

// Mobile goal-detail is a full-screen sheet (GoalDetailSheet), distinct from the
// desktop right panel. Deleting from its ⋯ menu must require a confirm step —
// previously it deleted on a single tap with no undo (data-loss).
test.describe('mobile goal-detail', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('deleting a goal requires confirmation and does not delete on the menu tap', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Mobile Delete Goal' })
    cleanup.add(() => api.deleteGoal(goal.goal_id))

    await gotoDashboardFresh(page)
    // Tap the goal card → full-screen mobile detail sheet.
    await page.getByText('E2E Mobile Delete Goal').first().click()
    await expect(page.getByTestId('goal-back-btn')).toBeVisible({ timeout: 10_000 })

    // ⋯ → Delete goal (opens the actions sheet, then the confirm).
    await page.getByTestId('goal-options-btn').click()
    await page.getByTestId('goal-delete-action').click()

    // A confirm dialog appears and NOTHING is deleted yet.
    const confirmBtn = page.getByTestId('goal-delete-confirm')
    await expect(confirmBtn).toBeVisible()
    // Give any (buggy) immediate-delete a chance to fire before asserting survival.
    await page.waitForTimeout(500)
    expect(await api.findGoalByName('E2E Mobile Delete Goal')).toBeTruthy()

    // Cancel keeps the goal; re-open and confirm actually deletes it.
    await page.getByTestId('goal-delete-cancel').click()
    await expect(confirmBtn).toBeHidden()
    expect(await api.findGoalByName('E2E Mobile Delete Goal')).toBeTruthy()

    await page.getByTestId('goal-options-btn').click()
    await page.getByTestId('goal-delete-action').click()
    await page.getByTestId('goal-delete-confirm').click()

    await expect.poll(async () => await api.findGoalByName('E2E Mobile Delete Goal'), { timeout: 10_000 }).toBeFalsy()
  })
})
