import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// This spec runs in the 'mobile' Playwright project (viewport 390x844) so md:hidden
// does not apply and the mobile-funds container is always visible.
//
// Presence/render + filter coverage (chips, search, card, form open, no-results,
// localized labels, DCA toggle reveals input/goal, NAV format) lives in the fast
// component + lib tests:
//   app/(app)/funds/components/__tests__/MobileFundLibraryView.render.test.tsx
//   lib/__tests__/formatters.test.ts (fmtNav "₫ 45.000,00")
// Only what a mocked component test can't prove stays here: the top-bar actions
// (pushed via NavigationContext, not rendered by the view in isolation), the two
// real-layout checks (≥44px touch targets, long-goal overflow), and the DCA
// persist-across-reload round-trips.

test('mobile funds shows header with title and action buttons', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const topBar = page.getByTestId('mobile-top-bar')
  await expect(topBar.getByText(/quỹ đầu tư|fund library/i)).toBeVisible({ timeout: 10_000 })
  await expect(topBar.getByRole('button', { name: /add fund|thêm quỹ/i })).toBeVisible()
  await expect(topBar.getByRole('button', { name: /refresh nav|làm mới/i })).toBeVisible()
})

test('mobile funds add button opens add fund sheet', async ({ page }) => {
  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const topBar = page.getByTestId('mobile-top-bar')
  await topBar.getByRole('button', { name: /add fund|thêm quỹ/i }).click()
  await expect(page.getByTestId('fund-sheet')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('fund-sheet').getByText(/add fund|thêm quỹ/i)).toBeVisible()
})

test('mobile funds card touch targets are at least 44px (#4)', async ({ page }) => {
  // #4: the DCA toggle (36×20) and the edit/delete icon buttons (~26px) were
  // below the 44px recommended touch target. The visual size is unchanged but
  // the tappable area is now ≥44×44. jsdom has no layout, so this stays E2E.
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

test('mobile funds DCA goal select stays within the card for long goal names (#363)', async ({ page }) => {
  // A long goal name must truncate inside the select, not overflow the card's
  // right edge and get hard-clipped at the card border (issue #363). Real layout.
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
  // already has a goal must NOT silently revert the goal to Unallocated. The
  // component test proves the PUT payload keeps the goal; this proves the real
  // DB round-trip survives a reload.
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
