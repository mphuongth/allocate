import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function openGoalsTab(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await page.evaluate(() => localStorage.removeItem('savingsGoalsCache'))
  await page.goto('/settings?tab=goals')
  await page.waitForSelector('[data-testid="create-btn"]', { timeout: 15_000 })
}

test('goals tab renders list or empty state', async ({ page }) => {
  await openGoalsTab(page)
  await expect(page.locator('h2, h1').first()).toBeVisible({ timeout: 15_000 })
})

test('can create a new savings goal', async ({ page }) => {
  await openGoalsTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Goal form has no htmlFor/id association on Label+Input, so use type selectors
  await page.locator('[role="dialog"] input[type="text"]').first().fill('E2E Test Goal')
  await page.locator('[role="dialog"] input[type="number"]').first().fill('10000000')
  await page.getByRole('dialog').getByRole('button', { name: /save|create|tạo|lưu/i }).click()

  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
  // Goal name renders in an h3 in the card grid (no sm:hidden issue)
  await expect(page.locator('h3').filter({ hasText: 'E2E Test Goal' }).first()).toBeVisible({ timeout: 15_000 })

  const found = await api.findGoalByName('E2E Test Goal')
  if (found) cleanup.add(() => api.deleteGoal(found.goal_id))
})

test('can edit an existing savings goal', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Edit Goal', target_amount: 20_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await openGoalsTab(page)
  const goalCard = page.locator('h3').filter({ hasText: 'E2E Edit Goal' }).first()
  await expect(goalCard).toBeVisible({ timeout: 15_000 })

  // Edit button (first button) is in the flex header next to the h3's grandparent
  const editBtn = goalCard.locator('..').locator('..').locator('button').nth(0)
  await editBtn.click()

  await expect(page.getByRole('dialog')).toBeVisible()
  const nameInput = page.locator('[role="dialog"] input[type="text"]').first()
  await nameInput.clear()
  await nameInput.fill('E2E Edit Goal Updated')
  await page.getByRole('button', { name: /save|lưu/i }).click()

  await expect(page.locator('h3').filter({ hasText: 'E2E Edit Goal Updated' }).first()).toBeVisible({ timeout: 15_000 })
})

test('can delete a savings goal', async ({ page }) => {
  const stale = await api.findGoalByName('E2E Delete Goal')
  if (stale) await api.deleteGoal(stale.goal_id)

  const goal = await api.createGoal({ goal_name: 'E2E Delete Goal' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await openGoalsTab(page)
  const goalCard = page.locator('h3').filter({ hasText: 'E2E Delete Goal' }).first()
  await expect(goalCard).toBeVisible({ timeout: 15_000 })

  // Delete button (second button) is in the flex header next to the h3's grandparent
  const deleteBtn = goalCard.locator('..').locator('..').locator('button').nth(1)
  await deleteBtn.click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /xác nhận|confirm|delete|xóa/i }).last().click()

  await expect(page.locator('h3').filter({ hasText: 'E2E Delete Goal' })).toHaveCount(0, { timeout: 15_000 })
})

test('view goal detail and back button returns to list', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E View Goal', target_amount: 30_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("goal-back-btn").first().click()
  await expect(page.locator('h3').filter({ hasText: 'E2E View Goal' }).first()).toBeVisible({ timeout: 5_000 })
})

test('sell / withdraw fund investment from Goal Detail', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  const goal = await api.createGoal({ goal_name: 'E2E Sell Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund!.nav,
    fund_id: fund!.id,
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  const sellBtn = page.getByRole('button', { name: /sell|bán/i }).first()
  await expect(sellBtn).toBeVisible({ timeout: 5_000 })
  await sellBtn.click()

  const unitsInput = page.getByLabel(/units|ccq/i).first()
  if (await unitsInput.isVisible()) {
    await unitsInput.fill('50')
  }
  await page.getByRole('button', { name: /confirm|sell|bán/i }).last().click()

  await page.waitForTimeout(2_000)
})

test('un-assign investment from goal in Goal Detail', async ({ page }) => {
  // unassign-btn lives in the "Other" tab (bank/gold/stock), not the fund tab
  const goal = await api.createGoal({ goal_name: 'E2E Unlink Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'bank',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  // Switch to "Other Investments" tab where the unassign button lives
  await page.getByRole('button', { name: /other investments|tiết kiệm/i }).first().click()
  await page.waitForTimeout(500)

  const unlinkBtn = page.getByTestId("unassign-btn").first()
  await expect(unlinkBtn).toBeVisible({ timeout: 10_000 })
  await unlinkBtn.click()

  const confirmBtn = page.getByRole('button', { name: /xác nhận|confirm|yes|ok/i }).last()
  if (await confirmBtn.isVisible({ timeout: 2_000 })) {
    await confirmBtn.click()
  }

  await expect(page.getByTestId('unassign-btn')).toHaveCount(0, { timeout: 10_000 })
})
