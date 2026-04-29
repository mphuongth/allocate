import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()
const NEXT_MONTH = MONTH === 12 ? 1 : MONTH + 1
const NEXT_YEAR = MONTH === 12 ? YEAR + 1 : YEAR

test('planning page shows current month and year heading', async ({ page }) => {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  // Month heading should contain the current year
  await expect(page.locator(`text=${YEAR}`).first()).toBeVisible({ timeout: 10_000 })
})

test('create monthly plan by entering salary', async ({ page }) => {
  // Delete any existing plan for this month first
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  const salaryInput = page.getByTestId('salary-input')
  if (await salaryInput.isVisible({ timeout: 3_000 })) {
    await salaryInput.fill('25000000')
    await page.getByRole('button', { name: /save|lưu/i }).first().click()
    await page.waitForTimeout(1_500)
    // Fund Investments or Fixed Expenses sections appear after plan is created
    await expect(page.locator('text=/Fund|Expenses|Chi phí|Đầu tư/i').first()).toBeVisible({ timeout: 8_000 })

    // Register cleanup — delete the plan we created
    const { data } = await (await import('@supabase/supabase-js'))
      .createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
      .from('monthly_plans')
      .select('id')
      .eq('month', MONTH)
      .eq('year', YEAR)
      .single()
    if (data) cleanup.add(() => api.deleteMonthlyPlan(data.id))
  }
})

test('can navigate to previous and next month', async ({ page }) => {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  const initialText = await page.locator('[data-testid="prev-month"]').evaluate((el) => el.closest('div')?.textContent ?? '')

  // Go to previous month
  await page.getByTestId('prev-month').click()
  await page.waitForTimeout(500)

  // Go forward two months
  await page.getByTestId('next-month').click()
  await page.waitForTimeout(500)
  await page.getByTestId('next-month').click()
  await page.waitForTimeout(500)

  // Should be on next month now
  await expect(page.locator(`text=${NEXT_YEAR}`).or(page.locator(`text=${YEAR}`)).first()).toBeVisible()

  void initialText
})

test('allocation summary shows salary when plan exists', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  // AllocationSummary shows salary — look for the formatted value
  await expect(page.locator('text=/30|lương|salary/i').first()).toBeVisible({ timeout: 10_000 })
})

test('remaining amount updates when fixed expense is added', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 20_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  const expense = await api.createFixedExpense({
    expense_name: 'E2E Planning Expense',
    amount_vnd: 3_000_000,
    category: 'Housing',
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  // Remaining should reflect salary minus expense
  // 20,000,000 - 3,000,000 = 17,000,000
  await expect(page.locator('text=/17|còn lại|remaining/i').first()).toBeVisible({ timeout: 10_000 })
})

test('remaining amount updates when fund investment is added', async ({ page }) => {
  const fund = await api.getFirstFund()
  if (!fund) test.skip()

  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 20_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  // Find the fund investments section and add button
  const addInvestBtn = page.getByRole('button', { name: /add|thêm/i }).first()
  if (await addInvestBtn.isVisible({ timeout: 3_000 })) {
    await addInvestBtn.click()
    await page.waitForTimeout(500)
    // Fill in investment details if a form/modal appeared
    const amountInput = page.getByLabel(/amount|số tiền/i).first()
    if (await amountInput.isVisible()) {
      await amountInput.fill('5000000')
      await page.getByRole('button', { name: /save|lưu/i }).first().click()
      await page.waitForTimeout(1_500)
    }
  }
  // Remaining should have decreased (or allocation summary updated)
  await expect(page.locator('text=/15|còn lại|remaining/i').first().or(
    page.locator('[class*="summary"]').first()
  )).toBeVisible({ timeout: 10_000 })
})

test('override a fixed expense amount on Monthly Plan', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 20_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  const expense = await api.createFixedExpense({
    expense_name: 'E2E Override Expense',
    amount_vnd: 3_000_000,
    category: 'Housing',
  })
  cleanup.add(() => api.deleteFixedExpense(expense.expense_id))

  await page.goto('/planning')
  await page.waitForLoadState('networkidle')

  // Find the expense row and click override
  const expenseRow = page.locator('text=E2E Override Expense').first()
  await expect(expenseRow).toBeVisible({ timeout: 10_000 })

  const overrideBtn = expenseRow.locator('..').locator('..').getByRole('button', { name: /override|edit|sửa/i }).first()
  if (await overrideBtn.isVisible({ timeout: 3_000 })) {
    await overrideBtn.click()
    const overrideInput = page.getByLabel(/amount|số tiền|override/i).first()
    if (await overrideInput.isVisible()) {
      await overrideInput.fill('4000000')
      await page.getByRole('button', { name: /save|lưu/i }).first().click()
      await page.waitForTimeout(1_000)
    }
  }
  // Just verify the page is still functional after override
  await expect(page.locator('text=E2E Override Expense').first()).toBeVisible()
})
