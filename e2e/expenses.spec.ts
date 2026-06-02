import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Fixed expenses are now managed from the Plan page (Manage button on the Fixed
// expenses section) instead of the removed Settings → Fixed Expenses tab.
test.use({ viewport: { width: 1280, height: 800 } })

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()

// Ensure a plan exists for the current month so the Fixed expenses section
// (and its Manage button) renders. Only schedule deletion for plans we create.
async function ensurePlan() {
  const existing = await api.findMonthlyPlan(MONTH, YEAR)
  if (existing) return
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))
}

async function openManager(page: Page) {
  await ensurePlan()
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop).toBeVisible({ timeout: 8_000 })
  await desktop.getByTestId('desktop-manage-fixed').click()
  await expect(page.getByTestId('fixed-expense-manager')).toBeVisible({ timeout: 5_000 })
}

async function closeManager(page: Page) {
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('fixed-expense-manager')).not.toBeVisible({ timeout: 5_000 })
}

test('manage modal opens from the plan page', async ({ page }) => {
  await openManager(page)
  await expect(page.getByTestId('fe-add')).toBeVisible()
})

test('can create a fixed expense from the plan page', async ({ page }) => {
  await api.deleteAllFixedExpensesByName('E2E Plan Rent')
  await openManager(page)

  await page.getByTestId('fe-add').click()
  await page.getByTestId('fe-name').fill('E2E Plan Rent')
  await page.getByTestId('fe-category').selectOption('Housing')
  await page.getByTestId('fe-amount').fill('5000000')
  await page.getByTestId('fe-save').click()

  // Returns to the list view with the new row (scope to the desktop view —
  // the mobile view is also mounted but md:hidden, so an unscoped .first()
  // could match the hidden mobile copy of the same text).
  await expect(
    page.getByTestId('desktop-planning').getByText('E2E Plan Rent').first()
  ).toBeVisible({ timeout: 8_000 })

  // Close loop: the expense appears in the plan's Fixed expenses section
  await closeManager(page)
  await expect(
    page.getByTestId('desktop-planning').locator('text=E2E Plan Rent').first()
  ).toBeVisible({ timeout: 8_000 })

  const found = await api.findFixedExpenseByName('E2E Plan Rent')
  expect(found).toBeTruthy()
  if (found) cleanup.add(() => api.deleteFixedExpense(found.expense_id))
})

test('can edit a fixed expense from the plan page', async ({ page }) => {
  await api.deleteAllFixedExpensesByName('E2E Plan Edit')
  await api.deleteAllFixedExpensesByName('E2E Plan Edit Updated')
  const expense = await api.createFixedExpense({
    expense_name: 'E2E Plan Edit',
    amount_vnd: 3_000_000,
    category: 'Housing',
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await openManager(page)

  const row = page.getByTestId(`fe-row-${expense.expense_id}`)
  await expect(row).toBeVisible({ timeout: 8_000 })
  await row.getByTestId('fe-edit').click()

  const name = page.getByTestId('fe-name')
  await expect(name).toHaveValue('E2E Plan Edit')
  await name.fill('E2E Plan Edit Updated')
  await page.getByTestId('fe-save').click()

  // Scope to the desktop view (mobile view is mounted but md:hidden).
  await expect(
    page.getByTestId('desktop-planning').getByText('E2E Plan Edit Updated').first()
  ).toBeVisible({ timeout: 8_000 })
})

test('can delete a fixed expense from the plan page', async ({ page }) => {
  await api.deleteAllFixedExpensesByName('E2E Plan Delete')
  const expense = await api.createFixedExpense({
    expense_name: 'E2E Plan Delete',
    amount_vnd: 2_000_000,
    category: 'Housing',
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await openManager(page)

  const row = page.getByTestId(`fe-row-${expense.expense_id}`)
  await expect(row).toBeVisible({ timeout: 8_000 })
  await row.getByTestId('fe-delete').click()
  await page.getByTestId('fe-delete-confirm').click()

  await expect(page.getByTestId(`fe-row-${expense.expense_id}`)).toHaveCount(0, { timeout: 8_000 })
})

test('effective period hides expense outside date range on planning page', async ({ page }) => {
  const currentMonthStr = `${YEAR}-${String(MONTH).padStart(2, '0')}-01`

  // Expense valid for the current month only
  const expense = await api.createFixedExpense({
    expense_name: 'E2E Period Expense',
    amount_vnd: 1_000_000,
    category: 'Housing',
    effective_from: currentMonthStr,
    effective_to: currentMonthStr,
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await ensurePlan()

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop.locator('text=E2E Period Expense').first()).toBeVisible({ timeout: 15_000 })

  // Next month — expense should NOT appear
  await desktop.getByTestId('next-month').click()
  await page.waitForLoadState('networkidle')
  await expect(desktop.locator('text=E2E Period Expense')).not.toBeVisible({ timeout: 5_000 })
})
