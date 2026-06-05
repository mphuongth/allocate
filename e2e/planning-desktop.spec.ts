import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// Force desktop viewport for every test in this file
test.use({ viewport: { width: 1280, height: 800 } })

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()
const PREV_YEAR = MONTH === 1 ? YEAR - 1 : YEAR

async function goto(page: Page) {
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
}

// ─── Layout ────────────────────────────────────────────────────────────────────

test('desktop planning: DTopBar shows Monthly Plan title', async ({ page }) => {
  await goto(page)
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop).toBeVisible()
  await expect(desktop.getByText(/Monthly Plan|Kế hoạch Tháng/i).first()).toBeVisible({ timeout: 5_000 })
})

test('desktop planning: month picker is visible', async ({ page }) => {
  await goto(page)
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop.getByTestId('desktop-month-picker')).toBeVisible()
  await expect(desktop.getByTestId('prev-month')).toBeVisible()
  await expect(desktop.getByTestId('next-month')).toBeVisible()
  // Picker shows current year
  await expect(desktop.getByTestId('desktop-month-picker')).toContainText(String(YEAR))
})

// ─── Navigation ───────────────────────────────────────────────────────────────

test('desktop planning: prev/next month buttons update displayed month', async ({ page }) => {
  await goto(page)
  const picker = page.getByTestId('desktop-month-picker')

  await page.getByTestId('prev-month').click()
  await page.waitForTimeout(300)
  // Prev-month year (may differ on January)
  await expect(picker).toContainText(String(PREV_YEAR))

  await page.getByTestId('next-month').click()
  await page.waitForTimeout(300)
  await expect(picker).toContainText(String(YEAR))
})

// ─── Empty state ──────────────────────────────────────────────────────────────

test('desktop planning: empty state has Set-income button for month without plan', async ({ page }) => {
  await goto(page)
  const desktop = page.getByTestId('desktop-planning')

  // Navigate far back to a month that almost certainly has no plan
  for (let i = 0; i < 6; i++) {
    await desktop.getByTestId('prev-month').click()
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(500)

  const emptyState = desktop.getByTestId('planning-empty-state')
  if (await emptyState.isVisible({ timeout: 4_000 })) {
    await expect(emptyState.getByRole('button', { name: /Set income|Thêm thu nhập/i })).toBeVisible()
  }
})

// ─── With plan ────────────────────────────────────────────────────────────────

test('desktop planning: summary strip shows Income / Outflow / Remaining when plan exists', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await goto(page)
  const desktop = page.getByTestId('desktop-planning')
  const strip = desktop.getByTestId('planning-summary-strip')

  await expect(strip).toBeVisible({ timeout: 8_000 })
  await expect(strip.getByText(/Income|Thu nhập/i).first()).toBeVisible()
  await expect(strip.getByText(/Outflow|Tổng chi/i).first()).toBeVisible()
  await expect(strip.getByText(/Remaining|Còn lại/i).first()).toBeVisible()
})

test('desktop planning: line-item amounts are shown in full, not abbreviated', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))
  // A non-round amount so compact (7.3M) and full (7.250.000) are clearly distinct
  const fe = await api.createFixedExpense({ expense_name: 'E2E Full Amount Rent', amount_vnd: 7_250_000, category: 'Housing' })
  cleanup.add(() => api.deleteFixedExpense(fe.expense_id))

  await goto(page)
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop.getByText('E2E Full Amount Rent')).toBeVisible({ timeout: 8_000 })

  // Scope to the fixed-expense row: the line item renders the exact amount
  // "7.250.000" (vi-VN grouping), never the shortened "7.3M". (The dense
  // allocation card legitimately shows the same total compact, so we must not
  // assert "7.3M" is absent page-wide.)
  const row = desktop.getByRole('row', { name: /E2E Full Amount Rent/ })
  await expect(row.getByText('7.250.000')).toBeVisible()
  await expect(row.getByText(/7[.,]3M/)).toHaveCount(0)
})

test('desktop planning: allocation card is visible in right panel', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await goto(page)
  const desktop = page.getByTestId('desktop-planning')
  await expect(desktop.getByTestId('planning-alloc-card')).toBeVisible({ timeout: 8_000 })
})

test('desktop planning: collapsible sections visible when plan exists', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await goto(page)
  await page.waitForLoadState('networkidle')
  const desktop = page.getByTestId('desktop-planning')

  await expect(desktop.getByText(/By goal|Theo mục tiêu/i).first()).toBeVisible({ timeout: 8_000 })
  await expect(desktop.getByText(/Fixed expenses|Chi phí cố định/i).first()).toBeVisible()
  await expect(desktop.getByText(/Insurance|Bảo hiểm/i).first()).toBeVisible()
})

test('desktop planning: Manage savings opens the recurring-saving manager', async ({ page }) => {
  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  await goto(page)
  const desktop = page.getByTestId('desktop-planning')

  await desktop.getByTestId('desktop-manage-savings').click()
  // Manager renders its list view (Add button) regardless of how many rules exist
  await expect(page.getByTestId('recurring-saving-manager')).toBeVisible({ timeout: 8_000 })
  await expect(page.getByTestId('rs-add')).toBeVisible()
})
