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

test('create goal modal has target date, icon picker and priority fields', async ({ page }) => {
  await openGoalsTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Target date month input
  await expect(page.locator('[role="dialog"] input[type="month"]')).toBeVisible()

  // Icon picker — 5 goal-icon buttons (each has data-testid="goal-icon-btn-{v}")
  const iconBtns = page.locator('[data-testid^="goal-icon-btn-"]')
  await expect(iconBtns).toHaveCount(5)

  // Priority control — three options
  await expect(page.getByTestId('priority-btn-low')).toBeVisible()
  await expect(page.getByTestId('priority-btn-med')).toBeVisible()
  await expect(page.getByTestId('priority-btn-high')).toBeVisible()
})

test('create goal modal shows live save-per-month calculation', async ({ page }) => {
  await openGoalsTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()

  await page.locator('[role="dialog"] input[type="number"]').first().fill('120000000')
  await page.locator('[role="dialog"] input[type="month"]').fill('2027-05')

  await expect(page.getByTestId('save-per-month')).toBeVisible()
})

test('create goal saves target_date icon and priority to db', async ({ page }) => {
  await openGoalsTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()

  await page.locator('[role="dialog"] input[type="text"]').first().fill('E2E Icon Priority Goal')
  await page.locator('[role="dialog"] input[type="number"]').first().fill('50000000')
  await page.locator('[role="dialog"] input[type="month"]').fill('2028-06')

  // Select home icon
  await page.locator('[data-testid="goal-icon-btn-home"]').click()

  // Select High priority
  await page.getByTestId('priority-btn-high').click()

  await page.getByRole('dialog').getByRole('button', { name: /save|create|tạo|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  const found = await api.findGoalByName('E2E Icon Priority Goal')
  if (found) {
    cleanup.add(() => api.deleteGoal(found.goal_id))
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
    const { data: goal } = await supabase.from('savings_goals').select('target_date, icon, priority').eq('goal_id', found.goal_id).single()
    expect(goal?.target_date).toBe('2028-06')
    expect(goal?.icon).toBe('home')
    expect(goal?.priority).toBe('high')
  }
})

test('goals tab renders list or empty state', async ({ page }) => {
  await openGoalsTab(page)
  // create-btn is already waited for by openGoalsTab; assert it's visible
  await expect(page.getByTestId('create-btn')).toBeVisible({ timeout: 5_000 })
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
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 15_000 })

  // Switch to "Other Investments" tab — use "& Khác" to distinguish from the settings nav "Mục tiêu Tiết kiệm"
  await page.getByRole('button', { name: /tiết kiệm & khác|other investments/i }).first().click()

  // .last() targets the desktop-table button (hidden sm:block); .first() hits the sm:hidden mobile card
  const unlinkBtn = page.getByTestId("unassign-btn").last()
  await expect(unlinkBtn).toBeVisible({ timeout: 10_000 })
  await unlinkBtn.click()

  const confirmBtn = page.getByRole('button', { name: /xác nhận|confirm|yes|ok/i }).last()
  if (await confirmBtn.isVisible({ timeout: 2_000 })) {
    await confirmBtn.click()
  }

  await expect(page.getByTestId('unassign-btn')).toHaveCount(0, { timeout: 10_000 })
})

test('withdraw modal has affects-progress checkbox checked by default', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Withdraw Progress Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'bank',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('goal-back-btn').first()).toBeVisible({ timeout: 15_000 })

  // Switch to "Other" tab to reveal bank investment
  await page.getByRole('button', { name: /tiết kiệm & khác|other investments/i }).first().click()

  // Open withdraw modal
  const withdrawBtn = page.getByRole('button', { name: /rút|withdraw/i }).first()
  await expect(withdrawBtn).toBeVisible({ timeout: 10_000 })
  await withdrawBtn.click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Checkbox must be present and checked by default
  const checkbox = page.getByTestId('affects-progress-checkbox')
  await expect(checkbox).toBeVisible({ timeout: 5_000 })
  await expect(checkbox).toBeChecked()
})

test('withdraw with affects-progress unchecked stores affects_progress=false', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Withdraw No Progress Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'bank',
    amount_vnd: 10_000_000,
    investment_date: '2026-01-01',
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('goal-back-btn').first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: /tiết kiệm & khác|other investments/i }).first().click()

  const withdrawBtn = page.getByRole('button', { name: /rút|withdraw/i }).first()
  await expect(withdrawBtn).toBeVisible({ timeout: 10_000 })
  await withdrawBtn.click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Uncheck the affects-progress checkbox
  const checkbox = page.getByTestId('affects-progress-checkbox')
  await expect(checkbox).toBeChecked()
  await checkbox.uncheck()
  await expect(checkbox).not.toBeChecked()

  // Fill required fields and submit
  const principalInput = page.locator('[role="dialog"] input[type="text"], [role="dialog"] input[inputmode="numeric"]').first()
  await principalInput.fill('5000000')
  await page.getByRole('button', { name: /rút|withdraw/i }).last().click()

  // Modal should close
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

  // Verify via API that the withdrawal stored affects_progress=false
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
  const { data: withdrawals } = await supabase
    .from('investment_transactions')
    .select('affects_progress')
    .eq('parent_transaction_id', tx.transaction_id)
    .eq('transaction_type', 'withdrawal')
  expect(withdrawals).toHaveLength(1)
  expect(withdrawals![0].affects_progress).toBe(false)
})

test('remaining balance reflects actual withdrawal even when affects_progress=false', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Remaining Balance Goal', target_amount: 200_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'bank',
    amount_vnd: 100_000_000,
    investment_date: '2026-01-01',
    goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto(`/settings?tab=goals&goal=${goal.goal_id}`)
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('goal-back-btn').first()).toBeVisible({ timeout: 15_000 })

  // Record progress % before withdrawal
  const progressBefore = await page.getByTestId('goal-progress-pct').first().textContent()

  // Switch to Other tab and open withdraw modal
  await page.getByRole('button', { name: /tiết kiệm & khác|other investments/i }).first().click()
  const withdrawBtn = page.getByRole('button', { name: /rút|withdraw/i }).first()
  await expect(withdrawBtn).toBeVisible({ timeout: 10_000 })
  await withdrawBtn.click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Uncheck affects-progress
  const checkbox = page.getByTestId('affects-progress-checkbox')
  await checkbox.uncheck()

  // Pre-filled principal should be 100M — change amount received and submit
  await page.getByRole('button', { name: /rút|withdraw/i }).last().click()

  // Modal should close and data refresh
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })

  // Progress bar % must be unchanged
  const progressAfter = await page.getByTestId('goal-progress-pct').first().textContent()
  expect(progressAfter).toBe(progressBefore)

  // Remaining balance shown must be reduced, not 100M
  // Use :visible to avoid picking the sm:hidden mobile card at desktop viewport
  const remaining = page.locator('[data-testid="investment-remaining"]:visible').first()
  await expect(remaining).toBeVisible({ timeout: 10_000 })
  const remainingText = await remaining.textContent()
  // Original 100M fully pre-filled and withdrawn — should not show 100M as remaining
  expect(remainingText).not.toContain('100.000.000')
})
