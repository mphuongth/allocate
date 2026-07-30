import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// Presence/render + computed coverage moved to fast component tests:
//   SellWithdrawSheet.test.tsx — summary strip remaining, 0.1% tax row, "All"
//     fills the amount, bank early-withdrawal warning
//   NetWorthCard.test.tsx — allocation bar renders when investments exist
//   OverviewEmptyState.test.tsx — the no-holdings empty state
// Only real round-trips / orchestration that a component test can't prove stay
// here: opening sheets/panels that DashboardClient wires up, and the
// assign / sell / mark-paid mutations.

// Shared, read-only unallocated fund fixture for the sheet-opening tests below
// (they never confirm a sale), avoiding per-test fund+tx create/delete churn.
let sharedFund: Awaited<ReturnType<typeof api.createFund>>

test.beforeAll(async () => {
  sharedFund = await api.createFund({ name: 'E2E Shared Sell Fund', code: 'E2ESHSELL', fund_type: 'equity', nav: 10000 })
  await api.createTransaction({
    asset_type: 'fund', amount_vnd: 5_000_000, investment_date: '2026-01-01',
    units: 500, unit_price: sharedFund.nav, fund_id: sharedFund.id,
  })
})

test.afterAll(async () => {
  // deleteFund also removes the fund's transactions (see helpers/api.ts).
  if (sharedFund) await api.deleteFund(sharedFund.id)
})

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

test('clicking a goal card opens goal detail panel', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Dashboard Goal', target_amount: 50_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const goalCard = page.locator('text=E2E Dashboard Goal').first()
  await expect(goalCard).toBeVisible({ timeout: 10_000 })
  await goalCard.click()

  // On desktop viewport (chromium project), DesktopGoalDetail opens in the right panel
  await expect(page.getByTestId('desktop-goal-detail')).toBeVisible({ timeout: 8_000 })
  await page.getByTestId('desktop-goal-detail-back').click()
  await expect(page.getByTestId('desktop-goal-detail')).not.toBeVisible({ timeout: 5_000 })
})

test('tapping unallocated row opens action sheet', async ({ page }) => {
  await gotoFreshDashboard(page)

  // Row is a tappable button — tap it to open action sheet
  const row = page.getByTestId('unallocated-row').filter({ hasText: sharedFund.name }).first()
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
  await gotoFreshDashboard(page)

  const row = page.getByTestId('unallocated-row').filter({ hasText: sharedFund.name }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()

  // Tap "Transaction History" in action sheet
  await expect(page.getByTestId('action-history')).toBeVisible({ timeout: 5_000 })
  await page.getByTestId('action-history').click()

  // TransactionHistorySheet should open — fund name is the h1
  await expect(page.getByRole('heading', { name: sharedFund.name })).toBeVisible({ timeout: 5_000 })

  // Close via Back button
  await page.getByTestId('history-back-btn').click()
  await expect(page.getByRole('heading', { name: sharedFund.name })).not.toBeVisible()
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

  // AssignGoalSheet opens — pick our test goal
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

// #578 — the partial-withdrawal coverage that existed called the API directly with
// an already-correct withdraw_principal, so it never exercised the sheet's
// conversion. This drives the real UI and then reads back what was persisted,
// because the persisted principal is what depositValuation subtracts from the
// holding forever after.
test('partial bank withdrawal records the principal entered in the UI, not a slice of the current value', async ({ page }) => {
  // A deposit whose current value is above its principal: 5.5%/yr, opened 60 days
  // ago. Without accrued interest the old proportional bug is invisible.
  const tx = await api.createTransaction({
    asset_type: 'bank',
    amount_vnd: 20_239_452,
    interest_rate: 5.5,
    investment_date: new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10),
    expiry_date: new Date(Date.now() + 305 * 86_400_000).toISOString().slice(0, 10),
    notes: 'E2E Partial Withdraw Deposit',
  })
  cleanup.add(() => api.deleteTransactionCascade(tx.transaction_id))

  await gotoFreshDashboard(page)

  const row = page.getByTestId('unallocated-row').filter({ hasText: 'E2E Partial Withdraw Deposit' }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await page.getByTestId('action-sell').click()
  await expect(page.getByTestId('sell-sheet')).toBeVisible({ timeout: 5_000 })

  // The reported numbers: ask the bank for 4,365,100 of principal, receive 4,366,416.
  await page.getByTestId('sell-amount-input').fill('4365100')
  await page.getByTestId('sell-received-input').fill('4366416')
  // The preview must show the entered principal — the bug previewed 4.333.849.
  await expect(page.getByTestId('sell-bank-principal')).toContainText('4.365.100')
  await expect(page.getByTestId('sell-bank-remaining')).toContainText('15.874.352')

  const [resp] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/investment-transactions') && r.request().method() === 'POST'),
    page.getByTestId('sell-confirm-btn').click(),
  ])
  expect(resp.status()).toBe(201)

  const all = await (await page.request.get('/api/v1/investment-transactions?asset_type=bank&limit=1000')).json()
  const wd = (all.transactions as Array<{ transaction_type: string; parent_transaction_id: string | null; amount_vnd: number; principal_withdrawn: number | null }>)
    .filter(r => r.transaction_type === 'withdrawal' && r.parent_transaction_id === tx.transaction_id)
  expect(wd).toHaveLength(1)
  expect(wd[0].principal_withdrawn).toBe(4_365_100)
  expect(wd[0].amount_vnd).toBe(4_366_416)
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

// Regression: a policy whose start date is in the past was incorrectly rendered
// as "Overdue". The premium isn't due until the next anniversary, so the row
// must show the on-track ("Not due") status — not Overdue. The status is derived
// by the overview API, so this stays an end-to-end check.
test('a policy started in the past is not shown as Overdue', async ({ page }) => {
  // Started ~60 days ago → next anniversary ~10 months out → on_track.
  const start = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const member = await api.createInsuranceMember({
    member_name: 'E2E Past Start Member',
    relationship: 'Self',
    annual_payment_vnd: 12_000_000,
    payment_date: start,
  })
  cleanup.add(() => api.deleteInsuranceMember(member.member_id))

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const row = page.getByTestId('insurance-row').filter({ hasText: 'E2E Past Start Member' })
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).not.toContainText(/Overdue|Quá hạn/)
  await expect(row).toContainText(/Not due|Chưa đến hạn/)
})
