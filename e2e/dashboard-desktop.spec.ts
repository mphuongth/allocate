import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// All tests run on Desktop Chrome (1280×800) by default from playwright config.
// These verify the two-column desktop layout for the Overview page.

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

  test('net worth panel shows Net worth label', async ({ page }) => {
    await expect(
      page.getByTestId('desktop-net-worth-panel').getByText(/net worth|tài sản ròng/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel shows allocation bar when investments exist', async ({ page }) => {
    // Global setup seeds a bank transaction so allocation data is always present
    await expect(page.getByTestId('allocation-bar')).toBeVisible({ timeout: 10_000 })
  })

  test('net worth panel shows download report button', async ({ page }) => {
    await expect(page.getByTestId('generate-report-btn')).toBeVisible({ timeout: 10_000 })
  })

  test('desktop layout is not visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('desktop-overview')).not.toBeVisible()
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

  test('insurance section shows Add button', async ({ page }) => {
    await expect(page.getByTestId('insurance-add-btn')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking insurance row shows insurance detail panel', async ({ page }) => {
    const row = page.getByTestId('insurance-row').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()
    await expect(page.getByTestId('insurance-detail-panel')).toBeVisible({ timeout: 5_000 })
  })

  test('clicking Add insurance opens inline modal instead of navigating away', async ({ page }) => {
    // Previously the Add button called window.open('/settings?tab=insurance')
    // which navigated away. Now it opens an inline modal on the dashboard.
    const startUrl = page.url()
    const addBtn = page.getByTestId('insurance-add-btn')
    await expect(addBtn).toBeVisible({ timeout: 10_000 })
    await addBtn.click()
    await expect(page.getByTestId('add-insurance-modal')).toBeVisible({ timeout: 5_000 })
    expect(page.url()).toBe(startUrl)
  })

  test('insurance detail panel shows avatar initials, not just shield icon', async ({ page }) => {
    const row = page.getByTestId('insurance-row').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()
    const avatar = page.getByTestId('insurance-avatar')
    await expect(avatar).toBeVisible({ timeout: 5_000 })
    const text = (await avatar.innerText()).trim()
    // Initials are 1–2 uppercase letters derived from the member name
    expect(text).toMatch(/^[A-ZÀ-Ỹ]{1,2}$/)
  })

  test('insurance detail panel exposes Remove member control', async ({ page }) => {
    const row = page.getByTestId('insurance-row').first()
    await expect(row).toBeVisible({ timeout: 10_000 })
    await row.click()
    await expect(page.getByTestId('insurance-remove-btn')).toBeVisible({ timeout: 5_000 })
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
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card.getByText('E2E Maturing Deposit')).toBeVisible({ timeout: 10_000 })
      // Sidebar badge (scope to the sidebar — the hidden mobile tabs also render one).
      await expect(page.getByTestId('desktop-sidebar').getByTestId('nav-maturity-badge')).toBeVisible({ timeout: 10_000 })

      // Renew via the card → desktop resolve modal → confirm the default renewal.
      await card.getByRole('button', { name: /Handle|Xử lý/i }).first().click()
      await page.getByRole('button', { name: /Confirm renewal|Xác nhận tái tục/i }).click()
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

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
