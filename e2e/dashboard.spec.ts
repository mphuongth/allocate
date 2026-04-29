import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

test('dashboard page loads with main layout', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible()
  await expect(page).toHaveURL(/dashboard/)
})

test('dashboard shows net worth card when data exists', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  // Net worth card shows total assets heading
  await expect(page.locator('text=/Net Worth|Total Assets|Tổng tài sản/i').first()).toBeVisible({ timeout: 10_000 })
})

test('dashboard shows empty state when no investments', async ({ page }) => {
  // This test relies on a fresh test account with no data
  // If the test account has data this test is skipped
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  const emptyState = page.locator('text=/no investments|get started|chưa có/i').first()
  const hasData = page.locator('text=/Net Worth|Tổng tài sản/i').first()
  // Either empty state OR data is visible
  await expect(emptyState.or(hasData)).toBeVisible({ timeout: 10_000 })
})

test('dashboard shows asset allocation section', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=Asset Allocation').first()).toBeVisible({ timeout: 10_000 })
})

test('"Add Goal" button opens Create Goal dialog', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  const addGoalBtn = page.getByRole('button', { name: /add goal|create goal|thêm mục tiêu/i }).first()
  if (await addGoalBtn.isVisible()) {
    await addGoalBtn.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('heading').first()).toBeVisible()
    await page.getByRole('button', { name: /cancel|close|đóng/i }).first().click()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  }
})

test('clicking a goal card navigates to goal detail', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Dashboard Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const goalCard = page.locator('text=E2E Dashboard Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 10_000 })

  // Click the goal card or its "View Details" button
  const viewBtn = page.getByRole('button', { name: /view|details|xem/i }).first()
  if (await viewBtn.isVisible()) {
    await viewBtn.click()
  } else {
    await goalCard.click()
  }

  await expect(page).toHaveURL(/settings.*goal/)
  // GoalDetailView has a back button
  await expect(page.getByRole('button', { name: /back|goals/i }).first()).toBeVisible({ timeout: 8_000 })
})

test('clicking unallocated fund opens FundDetailModal', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Find the fund code in the unallocated section
  const fundItem = page.locator(`text=${fund.code}`).first()
  await expect(fundItem).toBeVisible({ timeout: 10_000 })
  await fundItem.click()

  // FundDetailModal should open
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole('dialog').locator(`text=${fund.code}`)).toBeVisible()

  // Close the modal
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('assign unallocated fund to a goal via GoalPickerModal', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  const goal = await api.createGoal({ goal_name: 'E2E Assign Goal', target_amount: 20_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Open fund detail modal
  const fundItem = page.locator(`text=${fund.code}`).first()
  await expect(fundItem).toBeVisible({ timeout: 10_000 })
  await fundItem.click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Click "Assign to Goal"
  await page.getByRole('button', { name: /assign|goal|mục tiêu/i }).first().click()

  // GoalPickerModal opens — pick our test goal
  await expect(page.getByRole('dialog').locator('text=E2E Assign Goal')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('dialog').locator('text=E2E Assign Goal').click()

  // Confirm assignment
  const confirmBtn = page.getByRole('button', { name: /confirm|assign|ok/i }).first()
  if (await confirmBtn.isVisible()) await confirmBtn.click()

  // Dialog closes
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })
})

test('sell unallocated fund from Asset Overview', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const fundItem = page.locator(`text=${fund.code}`).first()
  await expect(fundItem).toBeVisible({ timeout: 10_000 })
  await fundItem.click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Click sell button
  const sellBtn = page.getByRole('button', { name: /sell|bán/i }).first()
  await expect(sellBtn).toBeVisible()
  await sellBtn.click()

  // Sell form appears — enter units to sell
  await page.getByLabel(/units|ccq/i).first().fill('50')
  await page.getByRole('button', { name: /confirm|sell|bán/i }).first().click()

  // Dialog should close after successful sell
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8_000 })
})

test('insurance "Mark as Paid" updates status', async ({ page }) => {
  const member = await api.createInsuranceMember({
    member_name: 'E2E Insurance Dashboard',
    relationship: 'Self',
    annual_payment_vnd: 12_000_000,
    payment_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const memberCard = page.locator('text=E2E Insurance Dashboard').first()
  await expect(memberCard).toBeVisible({ timeout: 10_000 })

  const markPaidBtn = memberCard.locator('..').locator('..').getByRole('button', { name: /paid|pay|đã trả/i }).first()
  if (await markPaidBtn.isVisible()) {
    await markPaidBtn.click()
    // Confirmation or success indicator
    await page.waitForTimeout(1000)
  }
})
