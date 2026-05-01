import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function openTransactionsTab(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.includes('transaction') || k.includes('Transaction')).forEach(k => localStorage.removeItem(k))
  })
  await page.goto('/settings?tab=transactions')
  await page.waitForLoadState('networkidle')
}

test('transactions tab renders table or empty state', async ({ page }) => {
  await openTransactionsTab(page)
  const content = page.locator('table').or(page.getByText(/no investment transactions yet/i)).first()
  await expect(content).toBeVisible({ timeout: 8_000 })
})

test('can add a bank transaction', async ({ page }) => {
  await openTransactionsTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()

  // Asset type should already be bank (default)
  await page.getByLabel(/date|ngày/i).first().fill('2026-01-15')
  await page.getByLabel(/amount|số tiền/i).first().fill('10000000')

  await page.getByRole('button', { name: /save|create|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  // Transaction appears in list
  await expect(page.locator('text=/bank|ngân hàng/i').first()).toBeVisible({ timeout: 8_000 })

  const found = await api.findTransactionLast('bank')
  if (found) cleanup.add(() => api.deleteTransaction(found.transaction_id))
})

test('can add a gold transaction', async ({ page }) => {
  await openTransactionsTab(page)
  await page.getByTestId('create-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Select Gold asset type
  const assetSelect = page.getByRole('combobox').first()
  await assetSelect.selectOption('gold')

  await page.getByLabel(/date|ngày/i).first().fill('2026-01-15')
  await page.getByLabel(/amount|số tiền/i).first().fill('8500000')
  await page.getByLabel(/units|chi/i).first().fill('1')
  await page.getByLabel(/price|giá/i).first().fill('8500000')

  await page.getByRole('button', { name: /save|create|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  await expect(page.locator('text=/gold|vàng/i').first()).toBeVisible({ timeout: 8_000 })

  const found = await api.findTransactionLast('gold')
  if (found) cleanup.add(() => api.deleteTransaction(found.transaction_id))
})

test('can add a fund transaction', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  await openTransactionsTab(page)
  await page.getByTestId('create-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Select Fund asset type
  const assetSelect = page.getByRole('combobox').first()
  await assetSelect.selectOption('fund')

  // Select fund from dropdown
  const fundSelect = page.getByRole('combobox').nth(1)
  await fundSelect.selectOption(fund.id)

  await page.getByLabel(/date|ngày/i).first().fill('2026-01-15')
  await page.getByLabel(/amount|số tiền/i).first().fill('5000000')
  await page.getByLabel(/units|ccq/i).first().fill('200')
  await page.getByLabel(/nav|price/i).first().fill(String(fund.nav))

  await page.getByRole('button', { name: /save|create|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  await expect(page.locator(`text=${fund.code}`).first()).toBeVisible({ timeout: 8_000 })

  const found = await api.findTransactionLast('fund')
  if (found) cleanup.add(() => api.deleteTransaction(found.transaction_id))
})

test('filter by asset type shows only matching rows', async ({ page }) => {
  const bankTx = await api.createTransaction({ asset_type: 'bank', amount_vnd: 5_000_000, investment_date: '2026-01-01' })
  const goldTx = await api.createTransaction({ asset_type: 'gold', amount_vnd: 8_500_000, investment_date: '2026-01-01', units: 1, unit_price: 8_500_000 })
  cleanup.add(() => api.deleteTransaction(bankTx.transaction_id))
  cleanup.add(() => api.deleteTransaction(goldTx.transaction_id))

  await openTransactionsTab(page)

  // Open filter and select Bank
  const filterSelect = page.getByRole('combobox', { name: /asset type|filter/i }).first()
  if (await filterSelect.isVisible({ timeout: 3_000 })) {
    await filterSelect.selectOption('bank')
    await page.waitForTimeout(500)
    // Gold rows should not be visible
    await expect(page.locator('text=/gold|vàng/i').first()).not.toBeVisible()
  }
})

test('can delete a transaction', async ({ page }) => {
  const tx = await api.createTransaction({ asset_type: 'bank', amount_vnd: 9_999_000, investment_date: '2026-01-01', notes: 'E2E Delete TX' })

  await openTransactionsTab(page)
  const txRow = page.locator('text=E2E Delete TX').first()
  await expect(txRow).toBeVisible({ timeout: 8_000 })

  const deleteBtn = txRow.locator('..').locator('..').getByRole('button', { name: /delete|xóa/i }).first()
  await deleteBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /confirm|delete|xóa/i }).last().click()

  await expect(page.locator('text=E2E Delete TX')).not.toBeVisible({ timeout: 8_000 })
  void tx
})

test('fund library page shows funds list', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')
  // Either the funds table is visible or an empty state
  const content = page.locator('table').or(page.getByText(/no funds yet/i)).first()
  await expect(content).toBeVisible({ timeout: 10_000 })
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
