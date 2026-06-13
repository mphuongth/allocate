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

  // Issue #261: after fully withdrawing a bank deposit from the goal detail,
  // it must no longer appear on the Investments tab. Attach the deposit to the
  // shared goal (reliably rendered) — the Investments tab fetches transactions
  // no-store, so the row shows even though the overview may be cached.
  test('fully withdrawn bank deposit disappears from the Investments tab', async ({ page }) => {
    // Heavy flow (two dashboard loads + a withdrawal round-trip). Tolerate a
    // slow / IO-throttled backend rather than racing the default 30s cap.
    test.slow()
    const tx = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 10_000_000,
      investment_date: '2026-01-01',
      interest_rate: 6,
      goal_id: goalId,
      notes: 'E2E TCB Deposit',
    })
    try {
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      await page.getByText('E2E Desktop Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('E2E TCB Deposit')).toBeVisible({ timeout: 10_000 })

      // Open the holding's options → Withdraw → withdraw the full balance.
      // exact: true so we hit the row's "Options" button, not the hero's
      // "Goal options" (substring matches would pick the hero first).
      // UI text is localised (the suite may run in Vietnamese), so match both.
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      await page.getByText(/^(Withdraw|Rút tiền)$/).click()
      await page.getByRole('button', { name: /^(All|Tất cả)$/ }).click()
      await page.getByRole('button', { name: /Confirm withdrawal|Xác nhận rút/i }).click()

      // The withdrawal shows a ~2s success state (which itself displays the
      // deposit name), then auto-closes and triggers the Investments-tab
      // refetch. Wait for that confirmation first — it proves the withdrawal
      // registered — then assert the row is gone. Asserting count(0) directly
      // races both the success modal's own name text and a not-yet-settled
      // refetch, which flakes whenever the backend is slow.
      await expect(page.getByText(/Đã rút thành công|Withdrawal successful/)).toBeVisible({ timeout: 20_000 })

      // The fully-withdrawn deposit must no longer be listed. Generous timeout
      // so a slow post-withdrawal refetch can land instead of being raced.
      await expect(panel.getByText('E2E TCB Deposit')).toHaveCount(0, { timeout: 30_000 })
    } finally {
      // Also removes the withdrawal row created during the test (parent FK is
      // ON DELETE SET NULL, so it would otherwise linger on the shared goal).
      await api.deleteTransactionCascade(tx.transaction_id)
    }
  })

  // Withdrawing from the goal detail can opt out of affecting goal progress
  // via the "Count toward goal progress" toggle (ported from the legacy
  // Settings view). Toggling it off must persist affects_progress=false.
  test('withdraw with progress toggle off stores affects_progress=false', async ({ page }) => {
    // Heavy flow (two dashboard loads + a withdrawal round-trip). Tolerate a
    // slow / IO-throttled backend rather than racing the default 30s cap.
    test.slow()
    const tx = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 10_000_000,
      investment_date: '2026-01-01',
      interest_rate: 6,
      goal_id: goalId,
      notes: 'E2E Progress Toggle Deposit',
    })
    try {
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      await page.getByText('E2E Desktop Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('E2E Progress Toggle Deposit')).toBeVisible({ timeout: 10_000 })

      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      await page.getByText(/^(Withdraw|Rút tiền)$/).click()

      // Switch off "Count toward goal progress", then withdraw the full balance.
      await page.getByTestId('affects-progress-switch').click()
      await page.getByRole('button', { name: /^(All|Tất cả)$/ }).click()
      await page.getByRole('button', { name: /Confirm withdrawal|Xác nhận rút/i }).click()

      // Same as the sibling test: wait for the success confirmation before
      // asserting the row is gone, with a generous timeout for a slow refetch.
      await expect(page.getByText(/Đã rút thành công|Withdrawal successful/)).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByText('E2E Progress Toggle Deposit')).toHaveCount(0, { timeout: 30_000 })

      // The withdrawal must have been stored with affects_progress=false.
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
      const { data: withdrawals } = await supabase
        .from('investment_transactions')
        .select('affects_progress')
        .eq('parent_transaction_id', tx.transaction_id)
        .eq('transaction_type', 'withdrawal')
      expect(withdrawals).toHaveLength(1)
      expect(withdrawals![0].affects_progress).toBe(false)
    } finally {
      await api.deleteTransactionCascade(tx.transaction_id)
    }
  })

  // Term-deposit maturity: a deposit past its maturity date surfaces a
  // "Handle maturity" action; renewing it rolls the principal forward, sets a
  // future maturity and resets the accrual date — closing the UI→DB loop.
  test('renewing a matured term deposit rolls it forward in the DB', async ({ page }) => {
    test.slow()
    const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
    const today = iso(0)
    // Invested ~13 months ago, matured ~30 days ago → there is accrued interest
    // to roll in, and the deposit reads as "matured".
    const tx = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 10_000_000,
      investment_date: iso(-400),
      interest_rate: 6,
      expiry_date: iso(-30),
      goal_id: goalId,
      notes: 'E2E Maturity Deposit',
    })
    try {
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')

      await page.getByText('E2E Desktop Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('E2E Maturity Deposit')).toBeVisible({ timeout: 10_000 })

      // Open the holding options → Handle maturity → confirm the default renewal
      // (principal + interest).
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      await page.getByText(/^(Handle maturity|Xử lý đáo hạn)$/).click()
      await page.getByRole('button', { name: /Confirm renewal|Xác nhận tái tục/i }).click()

      // Success confirmation proves the PUT landed.
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

      // Close the loop: the stored deposit must now have a future maturity, a
      // larger principal (interest rolled in) and today's accrual date.
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
      await expect.poll(async () => {
        const { data } = await supabase
          .from('investment_transactions')
          .select('amount_vnd, expiry_date, investment_date')
          .eq('transaction_id', tx.transaction_id)
          .single()
        return data
      }, { timeout: 15_000 }).toMatchObject({ investment_date: today })

      const { data: renewed } = await supabase
        .from('investment_transactions')
        .select('amount_vnd, expiry_date, investment_date')
        .eq('transaction_id', tx.transaction_id)
        .single()
      expect(renewed!.amount_vnd).toBeGreaterThan(10_000_000) // interest rolled into principal
      expect(renewed!.expiry_date > today).toBe(true)         // maturity moved into the future

      // Lineage: a history snapshot of the cycle that just closed was appended,
      // preserving the original open date + principal, and excluded from totals.
      await expect.poll(async () => {
        const { count } = await supabase
          .from('investment_transactions')
          .select('transaction_id', { count: 'exact', head: true })
          .eq('renewed_from_transaction_id', tx.transaction_id)
        return count
      }, { timeout: 15_000 }).toBe(1)

      const { data: snapshot } = await supabase
        .from('investment_transactions')
        .select('amount_vnd, investment_date, affects_progress, interest_earned_vnd')
        .eq('renewed_from_transaction_id', tx.transaction_id)
        .single()
      expect(snapshot!.investment_date).toBe(iso(-400)) // original open date preserved
      expect(snapshot!.amount_vnd).toBe(10_000_000)     // original principal preserved
      expect(snapshot!.affects_progress).toBe(false)    // never counts toward progress/net worth
      expect(snapshot!.interest_earned_vnd).toBeGreaterThan(0) // realized interest captured

      // UI loop: reopening the (still-active) deposit's options now shows the
      // renewal-history summary. The panel stays open and refetches after the
      // renewal, so the holding's Options button is the still-active deposit.
      await expect(panel.getByText('E2E Maturity Deposit')).toBeVisible({ timeout: 15_000 })
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      const summary = page.getByTestId('renewal-summary')
      await expect(summary).toBeVisible({ timeout: 10_000 })
      await expect(summary).toContainText(/Renewed 1|Đã tái tục 1/)
    } finally {
      await api.deleteTransactionCascade(tx.transaction_id)
    }
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
