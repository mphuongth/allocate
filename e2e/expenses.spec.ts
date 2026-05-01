import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

async function openExpensesTab(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await page.evaluate(() => {
    Object.keys(localStorage).filter(k => k.startsWith('fixedExpensesCache')).forEach(k => localStorage.removeItem(k))
  })
  await page.goto('/settings?tab=expenses')
  await page.waitForSelector('[data-testid="create-btn"]', { timeout: 15_000 })
}

test('fixed expenses tab renders', async ({ page }) => {
  await openExpensesTab(page)
  const content = page.locator('table').or(page.getByText(/no expenses yet|chưa có chi phí/i)).first()
  await expect(content).toBeVisible({ timeout: 15_000 })
})

test('can create a fixed expense', async ({ page }) => {
  await openExpensesTab(page)
  await page.getByTestId('create-btn').click()

  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('#expense_name').fill('E2E Rent')

  // #category is a @base-ui/react Select — exclude native <option> elements, force:true for animation
  await page.locator('#category').click()
  await page.locator('[data-open] [role="option"]:not(option)').first().click({ force: true })

  await page.locator('#amount_vnd').fill('5000000')

  await page.getByRole('button', { name: /save|create|lưu/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 })

  // Scope to table row (avoids hidden sm:hidden mobile cards)
  await expect(page.locator('tr').filter({ hasText: 'E2E Rent' }).first()).toBeVisible({ timeout: 15_000 })

  const found = await api.findFixedExpenseByName('E2E Rent')
  if (found) cleanup.add(() => api.deleteFixedExpense(found.expense_id))
})

test('can edit a fixed expense', async ({ page }) => {
  const expense = await api.createFixedExpense({
    expense_name: 'E2E Edit Expense',
    amount_vnd: 3_000_000,
    category: 'Housing',
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await openExpensesTab(page)
  const row = page.locator('tr').filter({ hasText: 'E2E Edit Expense' }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })

  // Edit button is first icon button in the row
  const editBtn = row.locator('button').nth(0)
  await editBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()

  const nameInput = page.locator('#expense_name')
  await nameInput.clear()
  await nameInput.fill('E2E Edit Expense Updated')

  await page.getByRole('button', { name: /save|lưu/i }).click()
  await expect(page.locator('tr').filter({ hasText: 'E2E Edit Expense Updated' }).first()).toBeVisible({ timeout: 15_000 })
})

test('can delete a fixed expense', async ({ page }) => {
  await api.deleteAllFixedExpensesByName('E2E Delete Expense')

  const expense = await api.createFixedExpense({
    expense_name: 'E2E Delete Expense',
    amount_vnd: 2_000_000,
    category: 'Housing',
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await openExpensesTab(page)
  const row = page.locator('tr').filter({ hasText: 'E2E Delete Expense' }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })

  // Delete button is second icon button in the row
  const deleteBtn = row.locator('button').nth(1)
  await deleteBtn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /xác nhận|confirm|delete|xóa/i }).last().click()

  await expect(page.locator('tr').filter({ hasText: 'E2E Delete Expense' })).toHaveCount(0, { timeout: 15_000 })
})

test('effective period hides expense outside date range on planning page', async ({ page }) => {
  const today = new Date()
  const month = today.getMonth() + 1
  const year = today.getFullYear()
  const currentMonthStr = `${year}-${String(month).padStart(2, '0')}-01`

  // Create expense valid for current month only
  const expense = await api.createFixedExpense({
    expense_name: 'E2E Period Expense',
    amount_vnd: 1_000_000,
    category: 'Housing',
    effective_from: currentMonthStr,
    effective_to: currentMonthStr,
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  // Verify it appears in settings
  await openExpensesTab(page)
  await expect(page.locator('tr').filter({ hasText: 'E2E Period Expense' }).first()).toBeVisible({ timeout: 15_000 })

  // Navigate to planning for current month — expense should appear
  const plan = await api.createMonthlyPlan({ month, year, salary_vnd: 10_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=E2E Period Expense').first()).toBeVisible({ timeout: 15_000 })

  // Navigate to next month — expense should NOT appear
  await page.getByTestId('next-month').click()
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=E2E Period Expense')).not.toBeVisible({ timeout: 5_000 })
})
