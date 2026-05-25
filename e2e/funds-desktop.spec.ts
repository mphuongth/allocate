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
  await expect(toolbar.getByPlaceholder(/search code or name|tìm theo mã/i)).toBeVisible()
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
  await toolbar.getByPlaceholder(/search code or name|tìm theo mã/i).fill('DTSRCH')

  const table = page.getByTestId('desktop-funds-table')
  await expect(table.getByTestId(`fund-row-${fund.id}`)).toBeVisible({ timeout: 8_000 })
})

test('desktop funds clicking a row opens the detail panel', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop Detail Fund', code: 'DTDET1', fund_type: 'equity', nav: 33000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  await table.getByTestId(`fund-row-${fund.id}`).click()

  const panel = page.getByTestId('desktop-fund-detail-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await expect(panel.getByText('DTDET1')).toBeVisible()
})

test('desktop fund detail panel closes when back button is clicked', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Desktop Back Fund', code: 'DTBCK1', fund_type: 'debt', nav: 28000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  await table.getByTestId(`fund-row-${fund.id}`).click()

  const panel = page.getByTestId('desktop-fund-detail-panel')
  await expect(panel).toBeVisible({ timeout: 5_000 })
  await panel.getByRole('button', { name: /back|quay lại/i }).click()
  await expect(panel).not.toBeVisible()
})

test('desktop funds add fund button opens add modal', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const toolbar = page.getByTestId('desktop-funds-toolbar')
  await toolbar.getByRole('button', { name: /add fund|thêm quỹ/i }).click()

  await expect(page.getByTestId('fund-modal')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('fund-modal').getByText(/add fund|thêm quỹ/i)).toBeVisible()
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
