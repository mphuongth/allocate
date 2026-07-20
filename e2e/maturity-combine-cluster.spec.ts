import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// PR3 — cluster auto-detection on the dashboard "Cần xử lý" card. When a goal has
// two (or more) bank deposits maturing close together, the card surfaces a one-tap
// "Gộp lại" (merge) banner. Tapping it opens the resolve sheet ON THE ANCHOR (the
// latest-maturing deposit) with the close siblings PRESELECTED — so the user can
// fold them into one re-deposit without first opening one and discovering the
// merge UI. This is a NEW entry point: the merge flow itself was previously
// reachable only from the goal-detail panel (see maturity-combine-merge.spec.ts).
//
// Closes the loop on the rendered UI: assert the banner renders with the right
// count, that opening it preselects the sibling, and that completing the merge
// removes the sibling from the goal's holdings (the merge is an internal transfer,
// no double-count).

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

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

async function goalHoldingIds(page: Page, goalId: string): Promise<string[]> {
  const res = await page.request.get('/api/v1/dashboard/overview')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  const g = (json.goals ?? []).find((x: { goalId: string }) => x.goalId === goalId)
  return (g?.nonFunds ?? []).map((n: { transactionId: string }) => n.transactionId)
}

test.describe('Maturity card — merge-cluster auto-detection', () => {
  test('surfaces a merge banner for close-maturing siblings and opens the sheet preselected', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Cluster Goal', target_amount: 200_000_000 })
    // Two matured bank deposits in the same goal, maturing 3 days apart (within the
    // 7-day window). D is the LATER maturity → the cluster anchor.
    const D = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-2), goal_id: goal.goal_id, notes: 'E2E Cluster D',
    })
    const sIn = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 8_000_000, investment_date: iso(-200),
      interest_rate: 6, expiry_date: iso(-5), goal_id: goal.goal_id, notes: 'E2E Cluster Sib',
    })
    try {
      await gotoFreshDashboard(page)
      const before = await goalHoldingIds(page, goal.goal_id)
      expect(before).toContain(sIn.transaction_id)

      // The card shows a merge banner anchored on D, reading "2 …".
      const banner = page.getByTestId(`merge-cluster-banner-${D.transaction_id}`)
      await expect(banner).toBeVisible({ timeout: 10_000 })
      await expect(banner).toContainText('2')

      // Tap "Gộp lại" → opens the resolve sheet on D (the anchor).
      await banner.getByRole('button').click()
      await page.getByRole('button', { name: /Settle & re-deposit|Tất toán & gửi lại/i }).click()

      // The close sibling is PRESELECTED — its received field shows with no click.
      await expect(page.getByTestId(`merge-received-${sIn.transaction_id}`)).toBeVisible()

      // Complete the merge and assert the sibling left the goal's holdings (folded
      // in, not duplicated).
      await Promise.all([
        page.waitForRequest((r) => r.url().endsWith(`/${D.transaction_id}/renew`) && r.method() === 'POST'),
        page.getByRole('button', { name: /Save new deposit|Lưu sổ mới/i }).click(),
      ])
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

      await gotoFreshDashboard(page)
      const after = await goalHoldingIds(page, goal.goal_id)
      expect(after).not.toContain(sIn.transaction_id)
    } finally {
      await api.deleteTransactionCascade(sIn.transaction_id)
      await api.deleteTransactionCascade(D.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('surfaces the banner even when the close sibling is not itself due yet', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E NotDue Goal', target_amount: 200_000_000 })
    // Two windows are in play and they are both 7 days, which is what the original
    // fixture missed:
    //   • actionable  — MATURITY_REMINDER_DAYS from TODAY (lib/maturity.ts)
    //   • merge window — 7 days between the sibling's and the ANCHOR's maturity
    // The original dates (D at -1, B at +4) made B 4 days out, i.e. inside the reminder
    // window, so B was actionable too and the Handle count was always 2 — this test could
    // never have passed. A matured anchor makes the case impossible: any sibling within 7
    // days of it is also within 7 days of today. So the anchor is actionable-but-not-yet-
    // matured instead, which pushes the sibling past the reminder window while keeping it
    // inside the merge window.
    //
    // D at +6: actionable ('maturing'), the only Handle row → the anchor.
    // B at +12: 12 > 7 so NOT actionable on its own, yet 6 days from D → cluster sibling.
    const D = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(6), goal_id: goal.goal_id, notes: 'E2E NotDue D',
    })
    const B = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 7_000_000, investment_date: iso(-200),
      interest_rate: 6, expiry_date: iso(12), goal_id: goal.goal_id, notes: 'E2E NotDue B',
    })
    try {
      await gotoFreshDashboard(page)
      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      // Only D is actionable → the card lists a single Handle row…
      await expect(page.getByTestId('maturity-action-count')).toHaveText('1')
      // …yet the banner advertises the 2-deposit cluster anchored on D.
      const banner = page.getByTestId(`merge-cluster-banner-${D.transaction_id}`)
      await expect(banner).toBeVisible()
      await expect(banner).toContainText('2')

      // Opening it preselects B even though B isn't due on its own.
      await banner.getByRole('button').click()
      await page.getByRole('button', { name: /Settle & re-deposit|Tất toán & gửi lại/i }).click()
      await expect(page.getByTestId(`merge-received-${B.transaction_id}`)).toBeVisible()
    } finally {
      await api.deleteTransactionCascade(B.transaction_id)
      await api.deleteTransactionCascade(D.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('shows no merge banner when a goal has a single maturing deposit', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Solo Goal', target_amount: 100_000_000 })
    const D = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 15_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-2), goal_id: goal.goal_id, notes: 'E2E Solo D',
    })
    try {
      await gotoFreshDashboard(page)
      // The deposit is actionable (its Handle row shows) but there's no sibling to
      // merge with, so no cluster banner.
      await expect(page.getByTestId(`merge-cluster-banner-${D.transaction_id}`)).toHaveCount(0)
    } finally {
      await api.deleteTransactionCascade(D.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
