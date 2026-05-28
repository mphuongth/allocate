import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// Desktop viewport (Desktop Chrome default) — all tests run in 1280×800+

test.describe('Desktop goal detail panel', () => {
  let goalId: string

  test.beforeAll(async () => {
    const goal = await api.createGoal({
      goal_name: 'E2E Desktop Goal',
      target_amount: 100_000_000,
    })
    goalId = goal.goal_id
  })

  test.afterAll(async () => {
    if (goalId) await api.deleteGoal(goalId)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('clicking a goal card opens goal detail in right panel', async ({ page }) => {
    const goalCard = page.getByText('E2E Desktop Goal').first()
    await expect(goalCard).toBeVisible({ timeout: 10_000 })
    await goalCard.click()
    await expect(page.getByTestId('desktop-goal-detail')).toBeVisible({ timeout: 5_000 })
  })

  test('goal detail panel shows goal name', async ({ page }) => {
    await page.getByText('E2E Desktop Goal').first().click()
    await expect(page.getByTestId('desktop-goal-detail')).toContainText('E2E Desktop Goal', { timeout: 5_000 })
  })

  test('goal detail panel shows current value', async ({ page }) => {
    await page.getByText('E2E Desktop Goal').first().click()
    await expect(page.getByTestId('desktop-goal-detail-value')).toBeVisible({ timeout: 5_000 })
  })

  test('goal detail panel has Investments tab', async ({ page }) => {
    await page.getByText('E2E Desktop Goal').first().click()
    await expect(page.getByTestId('desktop-goal-detail')).toContainText(/Investments|Khoản đầu tư/i, { timeout: 5_000 })
  })

  test('back button closes goal detail and restores net worth panel', async ({ page }) => {
    await page.getByText('E2E Desktop Goal').first().click()
    await expect(page.getByTestId('desktop-goal-detail')).toBeVisible({ timeout: 5_000 })
    await page.getByTestId('desktop-goal-detail-back').click()
    await expect(page.getByTestId('desktop-net-worth-panel')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('desktop-goal-detail')).not.toBeVisible()
  })

  test('goal detail is not visible before clicking a goal', async ({ page }) => {
    await expect(page.getByTestId('desktop-goal-detail')).not.toBeVisible()
    await expect(page.getByTestId('desktop-net-worth-panel')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking an insurance row while goal detail is open switches to insurance detail', async ({ page }) => {
    // Bug #226: with goal detail open in the right panel, clicking an insurance
    // member did nothing because the panel prioritised the still-selected goal.
    await page.getByText('E2E Desktop Goal').first().click()
    await expect(page.getByTestId('desktop-goal-detail')).toBeVisible({ timeout: 5_000 })

    await page.getByTestId('insurance-row').first().click()
    await expect(page.getByTestId('insurance-detail-panel')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('desktop-goal-detail')).not.toBeVisible()
  })
})
