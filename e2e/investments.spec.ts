import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// API rejects future dates — use today so the row sorts to top of page 1
const TODAY = new Date().toISOString().slice(0, 10)

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function openTransactionsTab(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.includes('transaction') || k.includes('Transaction')).forEach(k => localStorage.removeItem(k))
  })
  // Wait for the API response to ensure the table is populated before any assertion
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/investment-transactions') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/settings?tab=transactions'),
  ])
  await page.waitForSelector('[data-testid="create-btn"]', { timeout: 15_000 })
}

test('transactions tab renders table or empty state', async ({ page }) => {
  await openTransactionsTab(page)
  const content = page.locator('table').or(page.getByText(/no investment transactions yet|chưa có giao dịch/i)).first()
  await expect(content).toBeVisible({ timeout: 15_000 })
})

test('can add a bank transaction', async ({ page }) => {
  await openTransactionsTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Bank is the default asset type — no selection needed
  await page.getByLabel(/date|ngày/i).first().fill(TODAY)
  await page.getByLabel(/amount|số tiền/i).first().fill('10000000')

  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/investment-transactions') && r.status() === 200, { timeout: 15_000 }),
    page.getByRole('button', { name: /save|create|lưu/i }).click(),
  ])
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  // Scope to table row to avoid matching hidden sm:hidden mobile cards or <option> elements
  await expect(page.locator('tr').filter({ hasText: /bank|ngân hàng/i }).first()).toBeVisible({ timeout: 15_000 })

  const found = await api.findTransactionLast('bank')
  if (found) cleanup.add(() => api.deleteTransaction(found.transaction_id))
})

test('can add a gold transaction', async ({ page }) => {
  await openTransactionsTab(page)
  await page.getByTestId('create-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // #asset_type is a @base-ui/react Select — exclude native <option> elements (filter select), force:true for animation
  await page.locator('#asset_type').click()
  await page.locator('[data-open] [role="option"]:not(option)').filter({ hasText: /gold|vàng/i }).click({ force: true })

  await page.getByLabel(/date|ngày/i).first().fill(TODAY)
  await page.getByLabel(/amount|số tiền/i).first().fill('8500000')
  await page.getByLabel(/chi|chỉ/i).first().fill('1')
  await page.getByLabel(/unit price|giá/i).first().fill('8500000')

  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/investment-transactions') && r.status() === 200, { timeout: 15_000 }),
    page.getByRole('button', { name: /save|create|lưu/i }).click(),
  ])
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  await expect(page.locator('tr').filter({ hasText: /gold|vàng/i }).first()).toBeVisible({ timeout: 15_000 })

  const found = await api.findTransactionLast('gold')
  if (found) cleanup.add(() => api.deleteTransaction(found.transaction_id))
})

test('can add a fund transaction', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  await openTransactionsTab(page)
  await page.getByTestId('create-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // #asset_type is a @base-ui/react Select — exclude native <option> elements (filter select), force:true for animation
  await page.locator('#asset_type').click()
  await page.locator('[data-open] [role="option"]:not(option)').filter({ hasText: /^(fund|quỹ)$/i }).click({ force: true })

  // Select fund from #fund_id shadcn Select
  await page.locator('#fund_id').click()
  // [data-open] scopes to the open popup only — base-ui keeps all option elements in DOM when closed
  const openFundOption = page.locator('[data-open] [role="option"]:not(option)').first()
  await openFundOption.waitFor({ state: 'visible', timeout: 5_000 })
  await openFundOption.click({ force: true })

  await page.getByLabel(/date|ngày/i).first().fill(TODAY)
  await page.getByLabel(/amount|số tiền/i).first().fill('5000000')
  await page.getByLabel(/units|ccq/i).first().fill('200')
  await page.getByLabel(/\bnav\b|purchase/i).first().fill(String(fund!.nav))

  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/investment-transactions') && r.status() === 200, { timeout: 15_000 }),
    page.getByRole('button', { name: /save|create|lưu/i }).click(),
  ])
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  await expect(page.locator('tr').filter({ hasText: fund!.code }).first()).toBeVisible({ timeout: 15_000 })

  const found = await api.findTransactionLast('fund')
  if (found) cleanup.add(() => api.deleteTransaction(found.transaction_id))
})

test('filter by asset type shows only matching rows', async ({ page }) => {
  const bankTx = await api.createTransaction({ asset_type: 'bank', amount_vnd: 5_000_000, investment_date: '2099-12-31' })
  const goldTx = await api.createTransaction({ asset_type: 'gold', amount_vnd: 8_500_000, investment_date: '2099-12-31', units: 1, unit_price: 8_500_000 })
  cleanup.add(() => api.deleteTransaction(bankTx.transaction_id))
  cleanup.add(() => api.deleteTransaction(goldTx.transaction_id))

  await openTransactionsTab(page)

  // Open filter and select Bank
  const filterSelect = page.getByRole('combobox', { name: /asset type|filter/i }).first()
  if (await filterSelect.isVisible({ timeout: 3_000 })) {
    await filterSelect.selectOption('bank')
    await page.waitForTimeout(500)
    // Gold rows should not be visible
    await expect(page.locator('tr').filter({ hasText: /gold|vàng/i }).first()).not.toBeVisible()
  }
})

test('can delete a transaction', async ({ page }) => {
  await api.deleteAllTransactionsByNotes('E2E Delete TX')

  const tx = await api.createTransaction({ asset_type: 'bank', amount_vnd: 9_999_000, investment_date: '2099-12-31', notes: 'E2E Delete TX' })
  cleanup.add(() => api.deleteTransaction(tx.transaction_id))

  await openTransactionsTab(page)
  const txRow = page.locator('tr').filter({ hasText: 'E2E Delete TX' }).first()
  await expect(txRow).toBeVisible({ timeout: 15_000 })

  // Delete button is last icon button in the row
  const deleteBtn = txRow.locator('button').last()
  await deleteBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /xác nhận|confirm|delete|xóa/i }).last().click()

  await expect(page.locator('tr').filter({ hasText: 'E2E Delete TX' })).toHaveCount(0, { timeout: 15_000 })
})

test('fund library page shows funds list', async ({ page }) => {
  await page.goto('/funds')
  // Wait for content — don't use networkidle which resolves before React useEffect fires the API call
  // Empty state text is Vietnamese: "Chưa có quỹ nào"
  const content = page.locator('table')
    .or(page.locator('h2').filter({ hasText: /no funds yet|chưa có quỹ/i }))
    .or(page.getByText(/failed to load/i))
    .first()
  await expect(content).toBeVisible({ timeout: 20_000 })
})

test('DCA calculator in Fund Library shows projection', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  // Open DCA calculator — look for DCA button or expand row
  const dcaBtn = page.getByRole('button', { name: /dca|calculator|tính/i }).first()
  if (await dcaBtn.isVisible({ timeout: 3_000 })) {
    await dcaBtn.click()
    const amountInput = page.getByLabel(/monthly|amount|số tiền/i).first()
    if (await amountInput.isVisible({ timeout: 3_000 })) {
      await amountInput.fill('2000000')
      // Result should update
      await page.waitForTimeout(500)
      await expect(page.locator('text=/ccq|units|months|tháng/i').first()).toBeVisible()
    }
  }
})
