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
  await page.getByLabel(/goal name|tên mục tiêu/i).fill('E2E Test Goal')
  await page.getByLabel(/target amount|số tiền mục tiêu/i).fill('10000000')
  await page.getByRole('button', { name: /save|create|tạo/i }).click()

  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
  await expect(page.locator('text=E2E Test Goal').first()).toBeVisible({ timeout: 15_000 })

  const found = await api.findGoalByName('E2E Test Goal')
  if (found) cleanup.add(() => api.deleteGoal(found.goal_id))
})

test('can edit an existing savings goal', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Edit Goal', target_amount: 20_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await openGoalsTab(page)
  const goalCard = page.locator('text=E2E Edit Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 15_000 })

  // Click edit button near the goal
  const editBtn = goalCard.locator('..').locator('..').getByRole('button', { name: /edit|sửa/i }).first()
  await editBtn.click()

  await expect(page.getByRole('dialog')).toBeVisible()
  const nameInput = page.getByLabel(/goal name|tên/i)
  await nameInput.clear()
  await nameInput.fill('E2E Edit Goal Updated')
  await page.getByRole('button', { name: /save|lưu/i }).click()

  await expect(page.locator('text=E2E Edit Goal Updated').first()).toBeVisible({ timeout: 15_000 })
})

test('can delete a savings goal', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Delete Goal' })

  await openGoalsTab(page)
  const goalCard = page.locator('text=E2E Delete Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 15_000 })

  const deleteBtn = goalCard.locator('..').locator('..').getByRole('button', { name: /delete|xóa/i }).first()
  await deleteBtn.click()

  // Confirm modal
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /confirm|delete|xóa/i }).last().click()

  await expect(page.locator('text=E2E Delete Goal')).not.toBeVisible({ timeout: 15_000 })
  // No cleanup needed — deleted via UI
  void goal // suppress unused variable warning
})

test('view goal detail and back button returns to list', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E View Goal', target_amount: 30_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  // GoalDetailView has a back button
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  await page.getByTestId("goal-back-btn").first().click()
  // Returns to goals list
  await expect(page.locator('text=E2E View Goal').first()).toBeVisible({ timeout: 5_000 })
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
    unit_price: fund.nav,
    fund_id: fund.id,
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  // Find the sell button for the fund
  const sellBtn = page.getByRole('button', { name: /sell|bán/i }).first()
  await expect(sellBtn).toBeVisible({ timeout: 5_000 })
  await sellBtn.click()

  // Fill in withdraw form
  const unitsInput = page.getByLabel(/units|ccq/i).first()
  if (await unitsInput.isVisible()) {
    await unitsInput.fill('50')
  }
  await page.getByRole('button', { name: /confirm|sell|bán/i }).last().click()

  // Form closes or shows updated state
  await page.waitForTimeout(2_000)
})

test('un-assign fund investment from goal in Goal Detail', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  const goal = await api.createGoal({ goal_name: 'E2E Unlink Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  // Find the unlink/unassign button for the fund
  const unlinkBtn = page.getByTestId("unassign-btn").first()
  await expect(unlinkBtn).toBeVisible({ timeout: 5_000 })
  await unlinkBtn.click()

  // Confirm if modal appears
  const confirmBtn = page.getByRole('button', { name: /confirm|yes|ok/i }).last()
  if (await confirmBtn.isVisible({ timeout: 2_000 })) {
    await confirmBtn.click()
  }

  // Fund should disappear from goal's list
  await expect(page.locator(`text=${fund.code}`)).not.toBeVisible({ timeout: 15_000 })
})
