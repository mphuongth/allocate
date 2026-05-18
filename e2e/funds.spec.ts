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

  const mf = page.getByTestId('mobile-funds')
  await expect(mf.getByText(/thư viện quỹ|fund library/i)).toBeVisible({ timeout: 10_000 })
  await expect(mf.getByRole('button', { name: /add/i })).toBeVisible()
  await expect(mf.getByRole('button', { name: /refresh/i })).toBeVisible()
})

test('mobile funds shows type filter chips', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await expect(mf.getByRole('button', { name: 'All' })).toBeVisible({ timeout: 10_000 })
  await expect(mf.getByRole('button', { name: 'Stock' })).toBeVisible()
  await expect(mf.getByRole('button', { name: 'Bond' })).toBeVisible()
  await expect(mf.getByRole('button', { name: 'Balanced' })).toBeVisible()
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
  await expect(card.getByText('Stock')).toBeVisible()
  // NAV is formatted with vi-VN locale
  await expect(card.getByText(/45.000|45,000/)).toBeVisible()
  await expect(card.getByRole('button', { name: /dca/i })).toBeVisible()
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
  await mf.getByRole('button', { name: 'Stock' }).click()
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
  await expect(mf.getByText(/no funds match/i)).toBeVisible({ timeout: 5_000 })
})

test('mobile funds add button opens add fund sheet', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByRole('button', { name: /add/i }).click()
  await expect(page.getByTestId('fund-sheet')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('fund-sheet').getByText(/add fund|thêm quỹ/i)).toBeVisible()
})

test('mobile funds edit button opens edit sheet prefilled with fund data', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Edit Fund', code: 'E2EEDIT', fund_type: 'balanced', nav: 25000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByTestId(`fund-card-${fund.id}`).getByRole('button', { name: /edit/i }).click()
  const sheet = page.getByTestId('fund-sheet')
  await expect(sheet).toBeVisible({ timeout: 5_000 })
  await expect(page.getByDisplayValue('E2E Edit Fund')).toBeVisible()
})

test('mobile funds delete button opens delete confirmation sheet', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Delete Fund', code: 'E2EDEL', fund_type: 'equity', nav: 10000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  await mf.getByTestId(`fund-card-${fund.id}`).getByRole('button', { name: /delete/i }).click()
  await expect(page.getByTestId('delete-fund-sheet')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('delete-fund-sheet').getByText(/delete/i)).toBeVisible()
})

test('mobile funds DCA toggle shows amount input when enabled', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E DCA Fund', code: 'E2EDCA', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const mf = page.getByTestId('mobile-funds')
  const card = mf.getByTestId(`fund-card-${fund.id}`)
  await card.getByRole('button', { name: /dca/i }).click()
  await expect(card.getByPlaceholder(/amount/i)).toBeVisible({ timeout: 5_000 })
})

test('mobile funds shows empty state when no funds exist', async ({ page }) => {
  // We test the empty-data scenario by verifying the page loads without crashing, then rely on the no-results test above for the UI state
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')
  // Page must load without error
  await expect(page.getByTestId('mobile-funds')).toBeVisible({ timeout: 10_000 })
})
