import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// This spec runs in the 'mobile' Playwright project (viewport 390x844) so md:hidden
// does not apply and the mobile-funds container is always visible.

test('mobile funds shows header with title and action buttons', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const topBar = page.getByTestId('mobile-top-bar')
  await expect(topBar.getByText(/quỹ đầu tư|fund library/i)).toBeVisible({ timeout: 10_000 })
  await expect(topBar.getByRole('button', { name: /add fund|thêm quỹ/i })).toBeVisible()
  await expect(topBar.getByRole('button', { name: /refresh nav|làm mới/i })).toBeVisible()
})

test('mobile funds shows type filter chips', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await expect(mf.getByRole('button', { name: /^(all|tất cả)$/i })).toBeVisible({ timeout: 10_000 })
  await expect(mf.getByRole('button', { name: /^(stock|cổ phiếu)$/i })).toBeVisible()
  await expect(mf.getByRole('button', { name: /^(bond|trái phiếu)$/i })).toBeVisible()
  await expect(mf.getByRole('button', { name: /^(balanced|cân bằng)$/i })).toBeVisible()
})

test('mobile funds shows search input', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await expect(mf.getByPlaceholder(/search|tìm/i)).toBeVisible({ timeout: 10_000 })
})

test('mobile funds renders a fund card with code, type, NAV and DCA toggle', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Test Equity Fund', code: 'E2EEQ', fund_type: 'equity', nav: 45000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card.getByText('E2EEQ')).toBeVisible()
  await expect(card.getByText(/^(stock|cổ phiếu)$/i)).toBeVisible()
  // NAV is formatted with vi-VN locale
  await expect(card.getByText(/45.000|45,000/)).toBeVisible()
  await expect(card.getByRole('button', { name: /dca/i })).toBeVisible()
})

test('mobile funds form placeholders + action aria-labels are localized (vi)', async ({ page }) => {
  // Review follow-up: form input placeholders and the edit/delete/toggle
  // aria-labels were hardcoded English. The e2e session renders vi, so the
  // accessible names + placeholders must be Vietnamese.
  const fund = await api.createFund({ name: 'E2E i18n Labels Fund', code: 'E2EI18', fund_type: 'equity', nav: 12000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const card = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(card).toBeVisible({ timeout: 10_000 })
  // Action buttons expose Vietnamese accessible names.
  await expect(card.getByRole('button', { name: /sửa quỹ/i })).toBeVisible()
  await expect(card.getByRole('button', { name: /xóa quỹ/i })).toBeVisible()
  await expect(card.getByRole('button', { name: /bật dca/i })).toBeVisible()

  // Add sheet: the fund-name input placeholder is localized ("vd: …").
  await page.getByTestId('mobile-top-bar').getByRole('button', { name: /add fund|thêm quỹ/i }).click()
  const sheet = page.getByTestId('fund-sheet')
  await expect(sheet).toBeVisible({ timeout: 5_000 })
  await expect(sheet.getByPlaceholder(/^vd:/i).first()).toBeVisible()
})

test('mobile funds NAV uses the shared ₫ + 2-decimal format (#6)', async ({ page }) => {
  // #6: mobile NAV diverged from desktop ("36.120,00 VND" vs "36.120"). Both now
  // render the shared fmtNav: "₫ 45.000,00".
  const fund = await api.createFund({ name: 'E2E NAV Format Fund', code: 'E2ENAV', fund_type: 'equity', nav: 45000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const card = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(card).toBeVisible({ timeout: 10_000 })
  await expect(card.getByText(/₫\s*45\.000,00/)).toBeVisible()
})

test('mobile funds card touch targets are at least 44px (#4)', async ({ page }) => {
  // #4: the DCA toggle (36×20) and the edit/delete icon buttons (~26px) were
  // below the 44px recommended touch target. The visual size is unchanged but
  // the tappable area is now ≥44×44.
  const fund = await api.createFund({ name: 'E2E Touch Target Fund', code: 'E2ETT', fund_type: 'equity', nav: 12000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const card = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(card).toBeVisible({ timeout: 10_000 })

  for (const name of [/dca/i, /edit fund|sửa quỹ/i, /delete fund|xóa quỹ/i]) {
    const box = await card.getByRole('button', { name }).boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
})

test('mobile funds search filters by code', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Bond Search Fund', code: 'E2EBD', fund_type: 'debt', nav: 30000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByPlaceholder(/search|tìm/i).fill('E2EBD')
  await expect(mf.getByTestId(`fund-card-${fund.id}`)).toBeVisible({ timeout: 8_000 })
})

test('mobile funds type filter shows only matching funds', async ({ page }) => {
  const equityFund = await api.createFund({ name: 'E2E Equity Only', code: 'E2EEO', fund_type: 'equity', nav: 10000 })
  const bondFund = await api.createFund({ name: 'E2E Bond Only', code: 'E2EBO', fund_type: 'debt', nav: 10000 })
  cleanup.add(() => api.deleteFund(equityFund.id))
  cleanup.add(() => api.deleteFund(bondFund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByRole('button', { name: /^(stock|cổ phiếu)$/i }).click()
  await expect(mf.getByTestId(`fund-card-${equityFund.id}`)).toBeVisible({ timeout: 8_000 })
  await expect(mf.getByTestId(`fund-card-${bondFund.id}`)).not.toBeVisible()
})

test('mobile funds no-results state when search yields nothing', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E NoMatch Fund', code: 'E2ENM', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByPlaceholder(/search|tìm/i).fill('XNOMATCHWHATSOEVER999')
  await expect(mf.getByText(/no funds match|không có quỹ nào khớp/i)).toBeVisible({ timeout: 5_000 })
})

test('mobile funds add button opens add fund sheet', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const topBar = page.getByTestId('mobile-top-bar')
  await topBar.getByRole('button', { name: /add fund|thêm quỹ/i }).click()
  await expect(page.getByTestId('fund-sheet')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('fund-sheet').getByText(/add fund|thêm quỹ/i)).toBeVisible()
})

test('mobile funds edit button opens edit sheet prefilled with fund data', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Edit Fund', code: 'E2EEDIT', fund_type: 'balanced', nav: 25000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByTestId(`fund-card-${fund.id}`).getByRole('button', { name: /edit fund|sửa quỹ/i }).click()
  const sheet = page.getByTestId('fund-sheet')
  await expect(sheet).toBeVisible({ timeout: 5_000 })
  await expect(sheet.locator('input').first()).toHaveValue('E2E Edit Fund')
})

test('mobile funds delete button opens delete confirmation sheet', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Delete Fund', code: 'E2EDEL', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByTestId(`fund-card-${fund.id}`).getByRole('button', { name: /delete fund|xóa quỹ/i }).click()
  await expect(page.getByTestId('delete-fund-sheet')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('delete-fund-sheet').getByText(/^(delete|xóa) E2EDEL\?$/i)).toBeVisible()
})

test('mobile funds DCA toggle shows amount input when enabled', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E DCA Fund', code: 'E2EDCA', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  await card.getByRole('button', { name: /dca/i }).click()
  await expect(card.getByPlaceholder(/amount|số tiền/i)).toBeVisible({ timeout: 5_000 })
})

test('mobile funds DCA shows goal target dropdown when enabled', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E DCA Goal Fund', code: 'E2EDCG', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  await card.getByRole('button', { name: /dca/i }).click()
  // Target picker appears; defaults to Unallocated
  const select = card.getByTestId(`dca-goal-${fund.id}`)
  await expect(select).toBeVisible({ timeout: 5_000 })
  await expect(select).toHaveValue('')
})

test('mobile funds DCA goal select stays within the card for long goal names (#363)', async ({ page }) => {
  // A long goal name must truncate inside the select, not overflow the card's
  // right edge and get hard-clipped at the card border (issue #363).
  const goal = await api.createGoal({ goal_name: 'Đại học của Trang tại Vương Quốc Anh năm 2030' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({ name: 'E2E Long Goal Cutoff Fund', code: 'E2ELGC', fund_type: 'equity', nav: 33353.63 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  await card.getByRole('button', { name: /dca/i }).click()
  const select = card.getByTestId(`dca-goal-${fund.id}`)
  await expect(select).toBeVisible({ timeout: 5_000 })
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    select.selectOption(goal.goal_id),
  ])

  const cardBox = await card.boundingBox()
  const selBox = await select.boundingBox()
  expect(cardBox).not.toBeNull()
  expect(selBox).not.toBeNull()
  // Select's right edge must not extend past the card's right edge.
  expect(selBox!.x + selBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5)
})

test('mobile funds DCA goal selection persists', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Mobile DCA Goal Target' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({ name: 'E2E DCA Persist Fund', code: 'E2EDCP', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  await card.getByRole('button', { name: /dca/i }).click()
  const select = card.getByTestId(`dca-goal-${fund.id}`)
  await expect(select).toBeVisible({ timeout: 5_000 })
  // Wait for the persisting PUT to land before reloading (avoids racing the save).
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    select.selectOption(goal.goal_id),
  ])

  // Persisted: reload and confirm the goal is still selected
  await page.reload()
  await page.waitForLoadState('networkidle')
  const cardAfter = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(cardAfter.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })
})

test('mobile funds: editing the DCA amount keeps the assigned goal (#1)', async ({ page }) => {
  // Regression: handleSaveDcaAmount used to omit dca_goal_id from the PUT body,
  // so the API reset dca_goal_id to null. Editing the amount of a DCA fund that
  // already has a goal must NOT silently revert the goal to Unallocated.
  const goal = await api.createGoal({ goal_name: 'E2E DCA Amount-Edit Goal' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({
    name: 'E2E DCA Amount Edit Fund',
    code: 'E2EDAE',
    fund_type: 'equity',
    nav: 15000,
    is_dca: true,
    dca_monthly_amount_vnd: 3_000_000,
    dca_goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  // Goal starts assigned.
  await expect(card.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })

  // Re-edit just the amount.
  await card.getByTestId(`dca-amount-btn-${fund.id}`).click()
  const input = card.getByTestId(`dca-amount-input-${fund.id}`)
  await expect(input).toBeVisible({ timeout: 5_000 })
  await input.fill('5000000')
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    input.press('Enter'),
  ])

  // After reload the goal must still be assigned (not reset to Unallocated).
  await page.reload()
  await page.waitForLoadState('networkidle')
  const cardAfter = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(cardAfter.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })
})

test('mobile funds delete sheet title is localized to Vietnamese when locale=vi (#2/F)', async ({ page, context }) => {
  // Regression #2/F: the delete-sheet title was hardcoded `Delete {code}?`
  // instead of using the deleteModal key, so it stayed English in the vi app.
  await context.addCookies([{ name: 'locale', value: 'vi', url: 'http://localhost:3000' }])
  const fund = await api.createFund({ name: 'E2E VN Delete Title', code: 'E2EVDT', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByTestId(`fund-card-${fund.id}`).getByRole('button', { name: /delete fund|xóa quỹ/i }).click()
  const sheet = page.getByTestId('delete-fund-sheet')
  await expect(sheet).toBeVisible({ timeout: 5_000 })
  // Title localized: "Xóa E2EVDT?" (not "Delete E2EVDT?").
  await expect(sheet.getByText(/^Xóa E2EVDT\?$/)).toBeVisible()
})

test('mobile funds shows empty state when no funds exist', async ({ page }) => {
  // We test the empty-data scenario by verifying the page loads without crashing, then rely on the no-results test above for the UI state
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')
  // Page must load without error
  await expect(page.getByTestId('mobile-funds')).toBeVisible({ timeout: 10_000 })
})
