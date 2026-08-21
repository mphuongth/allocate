import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { expectRenewalCommitted } from './helpers/maturity'

// All tests run on Desktop Chrome (1280×800) by default from playwright config.
// These verify the two-column desktop layout for the Overview page.
//
// Presence/render that doesn't depend on real layout moved to component tests:
//   DesktopNetWorthPanel.test.tsx — Net worth label, allocation bar, download report
//   DesktopInsuranceList.test.tsx — Add button present + calls onAdd (no navigate)
//   DesktopInsuranceDetail.test.tsx — avatar initials, Remove member control
// What stays here is genuinely viewport/breakpoint/CSS-bound (jsdom has no layout)
// or a real DB round-trip (maturity renew, mark-paid), plus the container-level
// header/orchestration that DashboardClient owns.

// Force a fresh dashboard load that bypasses the localStorage overview cache
// (2-min TTL), so data created via the API after the beforeEach navigation is
// guaranteed to render rather than being masked by a stale snapshot.
async function gotoFreshDashboard(page: Page) {
  await page.goto('/settings') // unmount DashboardClient
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('dashboardOverviewCache')).forEach((k) => localStorage.removeItem(k))
  })
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])
}

test.describe('Desktop overview layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('renders two-column desktop layout container', async ({ page }) => {
    await expect(page.getByTestId('desktop-overview')).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel is visible on the right side', async ({ page }) => {
    await expect(page.getByTestId('desktop-net-worth-panel')).toBeVisible({ timeout: 10_000 })
  })

  test('desktop layout is not visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('desktop-overview')).not.toBeVisible()
  })

  test('crossing the desktop↔mobile breakpoint clears a goal selection (#4)', async ({ page }) => {
    // Selecting a goal on desktop only shows a right-side panel; mobile gates its
    // goal sheet on different state. Crossing 768px used to leave the selection
    // set-but-invisible, so resizing back to desktop popped the stale goal detail
    // open again. The fix clears selection when the breakpoint flips.
    const goal = await api.createGoal({ goal_name: 'E2E Resize Selection Goal', target_amount: 20_000_000 })
    try {
      await gotoFreshDashboard(page)

      // Select the goal on desktop → right panel shows its detail.
      await page.getByText('E2E Resize Selection Goal', { exact: true }).first().click()
      await expect(page.getByTestId('desktop-goal-detail')).toBeVisible({ timeout: 8_000 })
      await expect(page.getByTestId('desktop-net-worth-panel')).not.toBeVisible()

      // Shrink to mobile, then back to desktop. Selection should have been cleared,
      // so the right panel reverts to net worth instead of restoring the goal detail.
      //
      // The two resizes must not be back-to-back: with nothing awaited between them the
      // browser can coalesce both into a single frame, so the app never observes the
      // mobile breakpoint and never runs the clearing effect — the test then fails
      // claiming a regression that isn't there. It only showed up when the dashboard
      // carried enough data from earlier specs to slow the re-render down, which is why
      // this file passed in isolation and failed in the full suite. Waiting for the
      // mobile layout to actually render makes the crossing real.
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.getByTestId('desktop-overview')).not.toBeVisible({ timeout: 8_000 })
      await page.setViewportSize({ width: 1280, height: 800 })

      await expect(page.getByTestId('desktop-net-worth-panel')).toBeVisible({ timeout: 8_000 })
      await expect(page.getByTestId('desktop-goal-detail')).not.toBeVisible()
    } finally {
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('net-worth chart range persists across the desktop↔mobile breakpoint (#5)', async ({ page }) => {
    // The range was owned by each net-worth card, so crossing 768px remounted a
    // fresh card that reset to 1Y. The state now lives in the parent and carries
    // over. (Global setup seeds a bank tx, so the panel always renders.)
    const panel = page.getByTestId('desktop-net-worth-panel')
    await expect(panel).toBeVisible({ timeout: 10_000 })

    // Pick a non-default range on desktop.
    const desktop3M = panel.getByRole('button', { name: '3M', exact: true })
    await desktop3M.click()
    await expect(desktop3M).toHaveAttribute('aria-pressed', 'true')

    // Shrink to mobile — the mobile card should still show 3M, not reset to 1Y.
    await page.setViewportSize({ width: 390, height: 844 })
    const card = page.getByTestId('net-worth-card')
    await expect(card).toBeVisible({ timeout: 8_000 })
    await expect(card.getByRole('button', { name: '3M', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(card.getByRole('button', { name: '1Y', exact: true })).toHaveAttribute('aria-pressed', 'false')
  })

  test('sidebar has light background (not dark navy)', async ({ page }) => {
    const sidebar = page.getByTestId('desktop-sidebar')
    await expect(sidebar).toBeVisible({ timeout: 10_000 })
    const bg = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)
    // Dark navy = rgb(15, 42, 74) — sidebar must NOT be that color
    expect(bg).not.toBe('rgb(15, 42, 74)')
  })

  test('desktop layout shows Overview page title', async ({ page }) => {
    await expect(page.getByTestId('desktop-page-title')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('desktop-page-title')).toContainText(/overview|tổng quan/i)
  })

  test('Overview header has horizontal separator like other desktop pages', async ({ page }) => {
    // Plan / Funds / Settings all render their page header with a 1px
    // border-bottom against var(--c-line). Overview's header was missing it.
    await expect(page.getByTestId('desktop-page-title')).toBeVisible({ timeout: 10_000 })
    const headerEl = page.getByTestId('desktop-page-title').locator('xpath=ancestor::header[1]')
    const borderBottomWidth = await headerEl.evaluate((el) => getComputedStyle(el).borderBottomWidth)
    expect(borderBottomWidth).toBe('1px')
  })

  test('Overview page header sits outside any scrollable ancestor (structurally pinned)', async ({ page }) => {
    // Structural assertion — the header is pinned because no ancestor between it
    // and the desktop-overview wrapper is a scroll container. This is robust
    // against viewport size / seeded data variability.
    await expect(page.getByTestId('desktop-overview')).toBeVisible({ timeout: 10_000 })

    const isOutsideScroll = await page.evaluate(() => {
      const overview = document.querySelector('[data-testid="desktop-overview"]')
      if (!overview) return null
      const header = overview.querySelector('header')
      if (!header) return null
      // Walk up from header — must NOT encounter an overflow:auto/scroll ancestor
      // before reaching the desktop-overview wrapper.
      let el: HTMLElement | null = header.parentElement
      while (el && el !== overview) {
        const cs = getComputedStyle(el)
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return false
        el = el.parentElement
      }
      return true
    })
    expect(isOutsideScroll).toBe(true)
  })

  test('Add-transaction FAB is hidden at desktop viewport', async ({ page }) => {
    // The mobile FAB ("Add transaction") was leaking onto desktop because its
    // inline `display: flex` overrode the `md:hidden` class. Each desktop page
    // already exposes its own add buttons in the header, so the FAB must not
    // appear on md+ viewports.
    const fab = page.getByRole('button', { name: 'Add transaction' })
    await expect(fab).toBeHidden()
  })

  test('unallocated section shows wallet icon header inside card', async ({ page }) => {
    await expect(page.getByTestId('unallocated-card-header')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking insurance row shows insurance detail panel', async ({ page }) => {
    const row = page.getByTestId('insurance-row').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()
    await expect(page.getByTestId('insurance-detail-panel')).toBeVisible({ timeout: 5_000 })
  })

  // PR2: a matured term deposit surfaces the dashboard "Needs attention" card
  // and the sidebar nav badge; renewing it from the card rolls it forward so it
  // leaves the card (closing the UI loop).
  //
  // Uses a GOAL-ASSIGNED deposit on purpose — the overview API built goal-assigned
  // nonFunds without expiryDate, so isTermDeposit returned false and the card
  // never showed for a deposit attached to a goal (the common case). Regression
  // guard for that fix.
  test('matured deposit shows the Needs attention card + nav badge, and renewing clears it', async ({ page }) => {
    test.slow()
    const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
    const goal = await api.createGoal({ goal_name: 'E2E Maturity Goal', target_amount: 50_000_000 })
    const tx = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 12_000_000,
      investment_date: iso(-400),
      interest_rate: 6,
      expiry_date: iso(-20), // matured
      goal_id: goal.goal_id, // assigned to a goal — the case the card used to miss
      notes: 'E2E Maturing Deposit',
    })
    try {
      // The beforeEach already cached an overview snapshot taken before this
      // deposit existed; bust it so the matured deposit's card actually renders.
      await gotoFreshDashboard(page)

      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card.getByText('E2E Maturing Deposit')).toBeVisible({ timeout: 10_000 })
      // Sidebar badge (scope to the sidebar — the hidden mobile tabs also render one).
      await expect(page.getByTestId('desktop-sidebar').getByTestId('nav-maturity-badge')).toBeVisible({ timeout: 10_000 })

      // Renew via the card → desktop resolve modal → confirm the default renewal.
      await card.getByRole('button', { name: /Handle|Xử lý/i }).first().click()
      await page.getByRole('button', { name: /Confirm renewal|Xác nhận tái tục/i }).click()
      await expectRenewalCommitted(page)

      // After it rolls forward (future maturity), the deposit leaves the card.
      await expect(card.getByText('E2E Maturing Deposit')).toHaveCount(0, { timeout: 30_000 })
    } finally {
      await api.deleteTransactionCascade(tx.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})

test.describe('Desktop insurance — mark as paid (issue #227)', () => {
  const MEMBER = 'E2E Pay Member'
  let memberId: string

  test.beforeAll(async () => {
    // Future due date (~60 days out) → status on_track → "Mark as paid" CTA.
    const due = new Date()
    due.setDate(due.getDate() + 60)
    const m = await api.createInsuranceMember({
      member_name: MEMBER,
      relationship: 'Self',
      annual_payment_vnd: 12_000_000,
      payment_date: due.toISOString().slice(0, 10),
    })
    memberId = m.member_id
  })

  test.afterAll(async () => {
    if (memberId) await api.deleteInsuranceMember(memberId)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('clicking "Mark as paid" updates the panel to the paid-for-year state', async ({ page }) => {
    // Regression: the panel rendered a stale snapshot, so after mark-paid the
    // CTA stayed and "nothing happened". The detail must reflect fresh data and
    // show the "Paid for <year>" state.
    const row = page.getByTestId('insurance-row').filter({ hasText: MEMBER })
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()

    const panel = page.getByTestId('insurance-detail-panel')
    await expect(panel).toBeVisible({ timeout: 5_000 })

    const cta = page.getByTestId('insurance-cta-status')
    await expect(cta).toBeVisible({ timeout: 5_000 })
    await cta.click()

    // The CTA opens the payment modal in settle mode; confirm to settle.
    const modal = page.getByTestId('log-payment-modal')
    await expect(modal).toBeVisible({ timeout: 5_000 })
    await modal.getByRole('button', { name: /confirm|xác nhận/i }).click()

    const year = new Date().getFullYear()
    await expect(panel.getByText(new RegExp(`Paid for ${year}|Đã thanh toán ${year}`))).toBeVisible({ timeout: 8_000 })
    await expect(page.getByTestId('insurance-cta-status')).not.toBeVisible()
  })
})
