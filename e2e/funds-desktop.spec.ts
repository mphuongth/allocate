// Desktop Fund Library E2E tests — runs on Chromium (1280px viewport)
import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

// Presence/render + filter coverage (toolbar, table columns, NAV-age banner,
// type/search filter, add/edit/delete modals, gold-excluded type dropdown,
// localized chrome, DCA reveal) lives in the fast component + lib tests:
//   app/(app)/funds/components/__tests__/DesktopFundLibraryView.render.test.tsx
//   lib/__tests__/formatters.test.ts (fmtNav "₫ 55.000,00")
// Only what a mocked component test can't prove stays here: the in-flight DCA
// disable (real network timing), the cross-viewport state hand-off, and the DCA
// persist-across-reload round-trips.

test('desktop funds DCA toggle is disabled while the update is in flight (#8)', async ({ page }) => {
  // #8: the desktop DCA handlers had no in-flight guard (mobile dims + disables
  // via togglingIds), so fast clicks could fire overlapping PUTs. The toggle is
  // now disabled until the PUT resolves.
  const fund = await api.createFund({
    name: 'E2E Desktop DCA Guard', code: 'DTGRD1', fund_type: 'equity', nav: 15000,
    is_dca: true, dca_monthly_amount_vnd: 2_000_000,
  })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  // Delay the PUT so the in-flight window is observable.
  await page.route(`**/api/funds/${fund.id}`, async route => {
    if (route.request().method() === 'PUT') await new Promise(r => setTimeout(r, 1200))
    await route.continue()
  })

  const row = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  const toggle = row.getByTestId('dca-toggle')
  await expect(toggle).toBeEnabled({ timeout: 8_000 })
  await toggle.click()
  // While the PUT is outstanding the toggle must be disabled.
  await expect(toggle).toBeDisabled()
})

test('DCA enabled on desktop is reflected when switching to mobile viewport', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Cross View DCA', code: 'DXVDCA', fund_type: 'equity', nav: 20000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  // Enable DCA on desktop
  const row = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  const amountInput = row.getByPlaceholder(/amount|số tiền/i)
  await amountInput.fill('1500000')
  await amountInput.press('Enter')
  await page.waitForLoadState('networkidle')

  // Switch to mobile viewport
  await page.setViewportSize({ width: 390, height: 844 })

  // Mobile card must show DCA as active
  const card = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(card).toBeVisible({ timeout: 8_000 })
  await expect(card.getByRole('button', { name: /disable dca|tắt dca/i })).toBeVisible({ timeout: 5_000 })
})

// The "brand-new enable" marker is per-view editor state while the funds copy
// is shared, so a pending enable crossing the breakpoint would look like an
// existing DCA to the other view — and a first failed save would then restore
// a locally enabled row the server never had (#590). It can't: hiding the
// desktop view blurs its focused amount input, which cancels the pending
// enable. Only a real browser does that — jsdom keeps focus on hidden nodes —
// so this invariant can only be pinned here.
test('a pending DCA enable does not survive crossing to the mobile viewport (#590)', async ({ page }) => {
  const fund = await api.createFund({ name: 'E2E Pending Enable Handoff', code: 'DPENDH', fund_type: 'equity', nav: 20000 })
  cleanup.add(() => api.deleteFund(fund.id))

  const puts: string[] = []
  page.on('request', r => {
    if (r.method() === 'PUT' && r.url().includes(`/api/funds/${fund.id}`)) puts.push(r.url())
  })

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  // Toggle DCA on and leave the amount editor open — nothing is persisted yet.
  const row = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  await expect(row.getByTestId(`dca-amount-input-${fund.id}`)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })

  // The mobile card shows DCA off, and nothing was written.
  const card = page.getByTestId('mobile-funds').getByTestId(`fund-card-${fund.id}`)
  await expect(card.getByRole('button', { name: /enable dca|bật dca/i })).toBeVisible({ timeout: 5_000 })
  expect(puts).toEqual([])
})

test('desktop funds DCA goal selection persists across reload', async ({ page }) => {
  const goal = await api.createGoal({ goal_name: 'E2E Desktop DCA Goal Target' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({ name: 'E2E Desktop DCA Persist', code: 'DTDCP1', fund_type: 'equity', nav: 15000 })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  const row = table.getByTestId(`fund-row-${fund.id}`)
  await row.getByTestId('dca-toggle').click()
  const select = row.getByTestId(`dca-goal-${fund.id}`)
  await expect(select).toBeVisible({ timeout: 5_000 })
  // Wait for the persisting PUT to land before reloading (avoids racing the save).
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    select.selectOption(goal.goal_id),
  ])

  await page.reload()
  await page.waitForLoadState('networkidle')
  const rowAfter = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await expect(rowAfter.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })
})

test('desktop funds: editing the DCA amount keeps the assigned goal (#1)', async ({ page }) => {
  // Regression: handleSaveDcaAmount used to omit dca_goal_id from the PUT body,
  // so the API reset dca_goal_id to null. The component test proves the PUT
  // payload keeps the goal; this proves the real DB round-trip survives a reload.
  const goal = await api.createGoal({ goal_name: 'E2E Desktop DCA Amount-Edit Goal' })
  cleanup.add(() => api.deleteGoal(goal.goal_id))
  const fund = await api.createFund({
    name: 'E2E Desktop DCA Amount Edit',
    code: 'DTDAE1',
    fund_type: 'equity',
    nav: 15000,
    is_dca: true,
    dca_monthly_amount_vnd: 3_000_000,
    dca_goal_id: goal.goal_id,
  })
  cleanup.add(() => api.deleteFund(fund.id))

  await page.goto('/funds')
  await page.waitForLoadState('networkidle')

  const table = page.getByTestId('desktop-funds-table')
  const row = table.getByTestId(`fund-row-${fund.id}`)
  // Goal starts assigned.
  await expect(row.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })

  // Re-edit just the amount.
  await row.getByTestId(`dca-amount-btn-${fund.id}`).click()
  const input = row.getByTestId(`dca-amount-input-${fund.id}`)
  await expect(input).toBeVisible({ timeout: 5_000 })
  await input.fill('5000000')
  await Promise.all([
    page.waitForResponse(r => r.url().includes(`/api/funds/${fund.id}`) && r.request().method() === 'PUT' && r.ok()),
    input.press('Enter'),
  ])

  // After reload the goal must still be assigned (not reset to Unallocated).
  await page.reload()
  await page.waitForLoadState('networkidle')
  const rowAfter = page.getByTestId('desktop-funds-table').getByTestId(`fund-row-${fund.id}`)
  await expect(rowAfter.getByTestId(`dca-goal-${fund.id}`)).toHaveValue(goal.goal_id, { timeout: 8_000 })
})
