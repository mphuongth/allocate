// Desktop Fund Library E2E tests — runs on Chromium (1280px viewport)
import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

test('desktop funds toolbar shows search, type filter pills, refresh and add buttons', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 10_000 })
  await expect(toolbar.getByPlaceholder(/search|tìm/i)).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /all|tất cả/i })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /stock|cổ phiếu/i })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /bond|trái phiếu/i })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /balanced|cân bằng/i })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /refresh|làm mới/i })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /add fund|thêm quỹ/i })).toBeVisible()
})

test('desktop funds table shows fund code, type chip, and NAV columns', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop Equity Fund', code: 'DTEQ01', fund_type: 'equity', nav: 55000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  await expect(table).toBeVisible({ timeout: 10_000 })
  const row = table.getByTestId(`fund-row-${fund.id}`)
  await expect(row).toBeVisible({ timeout: 8_000 })
  await expect(row.getByText('DTEQ01')).toBeVisible()
  await expect(row.getByText(/stock|cổ phiếu/i)).toBeVisible()
  await expect(row.getByText(/55.000|55,000/)).toBeVisible()
})

test('desktop funds type filter pill filters by equity', async ({ page }) => {
  const equityFund = await api.createFund({ name: 'E2E Desktop Equity', code: 'DTEQF', fund_type: 'equity', nav: 10000 })
  const bondFund = await api.createFund({ name: 'E2E Desktop Bond', code: 'DTBDF', fund_type: 'debt', nav: 10000 })
  cleanup.add(() => api.deleteFund(equityFund.id))
  cleanup.add(() => api.deleteFund(bondFund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await toolbar.getByRole('button', { name: /stock|cổ phiếu/i }).click()

  const table = page.getByTestId('desktop-funds-table')
  await expect(table.getByTestId(`fund-row-${equityFund.id}`)).toBeVisible({ timeout: 8_000 })
  await expect(table.getByTestId(`fund-row-${bondFund.id}`)).not.toBeVisible()
})

test('desktop funds search filters by fund code', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop Search Fund', code: 'DTSRCH', fund_type: 'balanced', nav: 20000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await toolbar.getByPlaceholder(/search|tìm/i).fill('DTSRCH')

  const table = page.getByTestId('desktop-funds-table')
  await expect(table.getByTestId(`fund-row-${fund.id}`)).toBeVisible({ timeout: 8_000 })
})


test('desktop funds add fund button opens add modal', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await toolbar.getByRole('button', { name: /add fund|thêm quỹ/i }).click()

  await expect(page.getByTestId('fund-modal')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('fund-modal-title')).toHaveText(/add fund|thêm quỹ/i)
})

test('desktop funds add modal Type dropdown excludes gold, matching mobile (#3)', async ({ page }) => {
  // Parity: mobile filters gold out of the create form (gold is handled
  // separately via byType), but the desktop <select> listed it. Gold must
  // not be selectable when creating a fund on desktop either.
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await toolbar.getByRole('button', { name: /add fund|thêm quỹ/i }).click()

  const modal = page.getByTestId('fund-modal')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  const typeSelect = modal.locator('select')
  // The three allowed types are present; gold is not.
  await expect(typeSelect.locator('option')).toHaveCount(3)
  await expect(typeSelect.locator('option[value="gold"]')).toHaveCount(0)
})

test('desktop funds edit button opens edit modal prefilled', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop Edit Fund', code: 'DTEDT1', fund_type: 'balanced', nav: 42000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  await table.getByTestId(`fund-row-${fund.id}`).getByTestId('fund-edit-btn').click()

  const modal = page.getByTestId('fund-modal')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal.locator('input').first()).toHaveValue('E2E Desktop Edit Fund')
})

test('desktop funds delete button opens delete confirmation modal', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop Delete Fund', code: 'DTDEL1', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  await table.getByTestId(`fund-row-${fund.id}`).getByTestId('fund-delete-btn').click()

  await expect(page.getByTestId('delete-fund-modal')).toBeVisible({ timeout: 5_000 })
})

test('desktop funds chrome is localized to Vietnamese when locale=vi (#2/C)', async ({ page, context }) => {
  // Regression #2/C: the desktop view ignored locale and rendered hardcoded
  // English (toolbar, type chips, NAV banner) even in the vi app.
  await context.addCookies([{ name: 'locale', value: 'vi', url: 'http://localhost:3000' }])
  const fund = await api.createFund({ name: 'E2E VN Chrome Fund', code: 'DTVNC1', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await expect(toolbar.getByRole('button', { name: /làm mới/i })).toBeVisible({ timeout: 10_000 })
  await expect(toolbar.getByRole('button', { name: /thêm/i })).toBeVisible()
  // Type chip uses the Vietnamese label.
  const row = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await expect(row.getByText(/^Cổ phiếu$/)).toBeVisible({ timeout: 8_000 })
  // NAV info banner localized.
  await expect(page.getByTestId('desktop-funds').getByText(/Về cập nhật NAV/i)).toBeVisible()
})

test('desktop funds add + delete modals are localized to Vietnamese when locale=vi (#2/E)', async ({ page, context }) => {
  await context.addCookies([{ name: 'locale', value: 'vi', url: 'http://localhost:3000' }])
  const fund = await api.createFund({ name: 'E2E VN Modal Fund', code: 'DTVNM1', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  // Add modal: title + a form label come from i18n.
  await toolbar.getByRole('button', { name: /thêm/i }).click()
  const modal = page.getByTestId('fund-modal')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('fund-modal-title')).toHaveText(/thêm quỹ/i)
  await expect(modal.getByText('Tên Quỹ')).toBeVisible()
  await modal.getByRole('button', { name: /^Hủy$/i }).click()

  // Delete modal: title localized ("Xóa …?" not "Delete …?").
  const row = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('fund-delete-btn').click()
  const del = page.getByTestId('delete-fund-modal')
  await expect(del).toBeVisible({ timeout: 5_000 })
  await expect(del.getByText(/^Xóa DTVNM1\?$/)).toBeVisible()
})

test('DCA enabled on desktop is reflected when switching to mobile viewport', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Cross View DCA', code: 'DXVDCA', fund_type: 'equity', nav: 20000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  // Enable DCA on desktop
  const row = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  const amountInput = row.getByPlaceholder(/amount|số tiền/i)
  await amountInput.fill('1500000')
  await amountInput.press('Enter')
  await page.waitForLoadState('networkidle')

  // Switch to mobile viewport
  await page.setViewportSize({ width: 390, height: 844 })

  // Mobile card must show DCA as active
  const card = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(card).toBeVisible({ timeout: 8_000 })
  await expect(card.getByRole('button', { name: /disable dca/i })).toBeVisible({ timeout: 5_000 })
})

test('desktop funds DCA toggle enables inline amount input', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop DCA Fund', code: 'DTDCA1', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  const row = table.getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  await expect(row.getByPlaceholder(/amount|số tiền/i)).toBeVisible({ timeout: 5_000 })
})

test('desktop funds DCA shows goal target dropdown when enabled', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop DCA Goal', code: 'DTDCG1', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  const row = table.getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  const select = row.getByTestId(`dca-goal-${fund.id}`)
  await expect(select).toBeVisible({ timeout: 5_000 })
  await expect(select).toHaveValue('')
})

test('desktop funds DCA goal selection persists across reload', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Desktop DCA Goal Target' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({ name: 'E2E Desktop DCA Persist', code: 'DTDCP1', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  const row = table.getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  const select = row.getByTestId(`dca-goal-${fund.id}`)
  await expect(select).toBeVisible({ timeout: 5_000 })
  // Wait for the persisting PUT to land before reloading (avoids racing the save).
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    select.selectOption(goal.goal_id),
  ])

  await page.reload()
  await page.waitForLoadState('networkidle')
  const rowAfter = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await expect(rowAfter.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })
})

test('desktop funds: editing the DCA amount keeps the assigned goal (#1)', async ({ page }) => {
  // Regression: handleSaveDcaAmount used to omit dca_goal_id from the PUT body,
  // so the API reset dca_goal_id to null. Editing the amount of a DCA fund that
  // already has a goal must NOT silently revert the goal to Unallocated.
  const goal = await api.createGoal({ goal_name: 'E2E Desktop DCA Amount-Edit Goal' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({
    name: 'E2E Desktop DCA Amount Edit',
    code: 'DTDAE1',
    fund_type: 'equity',
    nav: 15000,
    is_dca: true,
    dca_monthly_amount_vnd: 3_000_000,
    dca_goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  const row = table.getByTestId(`fund-row-${fund.id}`)
  // Goal starts assigned.
  await expect(row.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })

  // Re-edit just the amount.
  await row.getByTestId(`dca-amount-btn-${fund.id}`).click()
  const input = row.getByTestId(`dca-amount-input-${fund.id}`)
  await expect(input).toBeVisible({ timeout: 5_000 })
  await input.fill('5000000')
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    input.press('Enter'),
  ])

  // After reload the goal must still be assigned (not reset to Unallocated).
  await page.reload()
  await page.waitForLoadState('networkidle')
  const rowAfter = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await expect(rowAfter.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })
})
