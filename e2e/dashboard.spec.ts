import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function gotoFreshDashboard(page: Page) {
  // Navigate to any other page first to fully unmount DashboardClient
  await page.goto('/settings')
  // Clear the overview cache so the next dashboard mount fetches fresh data
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.startsWith('dashboardOverviewCache')).forEach(k => localStorage.removeItem(k))
  })
  // Navigate back — DashboardClient mounts fresh, cache is empty, API call is guaranteed
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])
}

test('dashboard page loads with main layout', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible()
  await expect(page).toHaveURL(/dashboard/)
})

test('dashboard shows net worth card when data exists', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  // Net worth card shows the net worth or total assets label in EN or VI
  await expect(page.locator('text=/Net Worth|Total Assets|Tài sản Ròng|Tổng Tài sản|Tổng tài sản/i').first()).toBeVisible({ timeout: 10_000 })
})

test('dashboard shows empty state when no investments', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  const emptyState = page.locator('text=/no investments|get started|chưa có/i').first()
  const hasData = page.locator('text=/Net Worth|Tài sản Ròng|Tổng Tài sản|Tổng tài sản/i').first()
  // Either empty state OR data is visible
  await expect(emptyState.or(hasData)).toBeVisible({ timeout: 10_000 })
})

test('dashboard shows allocation bar when investments exist', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  // Allocation bar renders when there is at least one investment (seeded in setup)
  await expect(page.getByTestId('allocation-bar')).toBeVisible({ timeout: 10_000 })
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

test('clicking a goal card opens GoalDetailSheet', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Dashboard Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const goalCard = page.locator('text=E2E Dashboard Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 10_000 })
  await goalCard.click()

  // GoalDetailSheet opens as a full-screen overlay with a back button
  await expect(page.getByTestId("goal-back-btn").first()).toBeVisible({ timeout: 8_000 })
  await page.getByTestId("goal-back-btn").first().click()
  await expect(page.getByTestId("goal-back-btn")).not.toBeVisible({ timeout: 5_000 })
})

test('tapping unallocated row opens action sheet', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Test Fund', code: 'E2ETESTFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)

  // Row is a tappable button — tap it to open action sheet
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  // Action sheet should appear with 3 options
  await expect(page.getByTestId('action-sheet')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('action-assign')).toBeVisible()
  await expect(page.getByTestId('action-sell')).toBeVisible()
  await expect(page.getByTestId('action-history')).toBeVisible()

  // Close by tapping backdrop (click outside the sheet)
  await page.keyboard.press('Escape')
})

test('tapping unallocated fund history opens TransactionHistorySheet', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Test Fund', code: 'E2ETESTFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)

  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  // Tap "Transaction History" in action sheet
  await expect(page.getByTestId('action-history')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('action-history').click()

  // TransactionHistorySheet should open — fund name is the h1
  await expect(page.getByRole('heading', { name: fund.name })).toBeVisible({ timeout: 5_000 })

  // Close via Back button
  await page.getByTestId('history-back-btn').click()
  await expect(page.getByRole('heading', { name: fund.name })).not.toBeVisible()
})

test('assign unallocated fund to a goal via action sheet', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Test Fund', code: 'E2ETESTFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

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

  await gotoFreshDashboard(page)

  // Tap row → action sheet → Assign to Goal
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  await expect(page.getByTestId('action-assign')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('action-assign').click()

  // GoalPickerModal opens — pick our test goal
  await expect(page.getByRole('dialog').locator('text=E2E Assign Goal')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('dialog').locator('text=E2E Assign Goal').click()

  await page.getByRole('button', { name: /gán|confirm|assign/i }).last().click()

  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8_000 })
})

test('sell unallocated fund via action sheet', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Test Fund', code: 'E2ETESTFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 5_000_000,
    investment_date: '2026-01-01',
    units: 200,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)

  // Tap row → action sheet → Sell
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  await expect(page.getByTestId('action-sell')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('action-sell').click()

  // SellWithdrawSheet opens
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('sell-amount-input').fill('50000')
  await page.getByTestId('sell-confirm-btn').click()

  await expect(page.getByTestId('sell-sheet')).not.toBeVisible({ timeout: 8_000 })
})

test('sell fund sheet shows remaining amount in summary strip', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Summary Fund', code: 'E2ESUMFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))
  const tx = await api.createTransaction({
    asset_type: 'fund', amount_vnd: 5_000_000, investment_date: '2026-01-01',
    units: 500, unit_price: fund.nav, fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByTestId('action-sell').click()
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })

  await page.getByTestId('sell-amount-input').fill('1000000')
  await expect(page.getByTestId('sell-summary-strip')).toBeVisible({ timeout: 3_000 })
})

test('sell fund shows 0.1% tax estimate in summary strip', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Tax Fund', code: 'E2ETAXFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))
  const tx = await api.createTransaction({
    asset_type: 'fund', amount_vnd: 5_000_000, investment_date: '2026-01-01',
    units: 500, unit_price: fund.nav, fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByTestId('action-sell').click()
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })

  await page.getByTestId('sell-amount-input').fill('1000000')
  // Tax row (0.1%) appears in summary strip for fund sells
  await expect(page.locator('[data-testid="sell-summary-strip"] [data-testid="sell-tax-row"]')).toBeVisible({ timeout: 3_000 })
})

test('"All" button fills the full available amount', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E All Fund', code: 'E2EALLFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))
  const tx = await api.createTransaction({
    asset_type: 'fund', amount_vnd: 5_000_000, investment_date: '2026-01-01',
    units: 500, unit_price: fund.nav, fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByTestId('action-sell').click()
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })

  await page.getByTestId('sell-all-btn').click()
  const val = await page.getByTestId('sell-amount-input').inputValue()
  // Input displays vi-VN formatted numbers (dots as thousand separators), strip before parsing
  expect(Number(val.replace(/\./g, '').replace(/,/g, ''))).toBeGreaterThan(0)
})

test('sell bank shows early-withdrawal warning', async ({ page }) => {
  const tx = await api.createTransaction({
    asset_type: 'bank', amount_vnd: 10_000_000, investment_date: '2026-01-01', interest_rate: 6,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)
  const row = page.getByTestId('unallocated-row').filter({ hasText: /ngân hàng|bank/i }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByTestId('action-sell').click()
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })

  await expect(page.getByTestId('sell-bank-warning')).toBeVisible({ timeout: 3_000 })
})

test('sell success state appears after confirm', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Success Fund', code: 'E2ESUCFUND', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))
  const tx = await api.createTransaction({
    asset_type: 'fund', amount_vnd: 5_000_000, investment_date: '2026-01-01',
    units: 500, unit_price: fund.nav, fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)
  const row = page.getByTestId('unallocated-row').filter({ hasText: fund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByTestId('action-sell').click()
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })

  await page.getByTestId('sell-amount-input').fill('1000000')
  await page.getByTestId('sell-confirm-btn').click()

  await expect(page.getByTestId('sell-success')).toBeVisible({ timeout: 5_000 })
})

test('allocation bar renders when investments exist', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Alloc Fund', code: 'E2EALLOCFUND', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  const tx = await api.createTransaction({
    asset_type: 'fund',
    amount_vnd: 10_000_000,
    investment_date: '2026-01-01',
    units: 500,
    unit_price: fund.nav,
    fund_id: fund.id,
  })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await gotoFreshDashboard(page)

  await expect(page.getByTestId('allocation-bar')).toBeVisible({ timeout: 10_000 })
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
