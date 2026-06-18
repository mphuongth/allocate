import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// Term-deposit maturity "combine" — folding a SIBLING bank deposit into the
// re-deposit (merge-on-renew). The bug this guards: a user settles a sibling S
// by hand into the renewed deposit D's principal but never closes S, so S's money
// is counted twice (in D's principal AND as a still-active standalone deposit).
//
// The fix closes S with a full-withdrawal (affects_progress=TRUE) inside the same
// atomic renewal and adds Σ(received) to D server-side. This closes the loop:
// drive the merge from the desktop goal-detail UI, then assert
//   • the server added exactly Σ(received) to D (net-worth invariant), and
//   • S is gone from the goal's holdings (no double-count), and
//   • the goal's progress value did NOT jump by S's value (the bar stays steady).
// Desktop viewport (Desktop Chrome default). The merge UI is wired in the
// goal-detail sheet/modal — not the dashboard maturity card — so we open it there.

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

// The goal's progress value + its holdings, straight from the overview API.
async function goalSnapshot(page: Page, goalId: string): Promise<{ progressValue: number; holdingIds: string[] }> {
  const res = await page.request.get('/api/v1/dashboard/overview')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  const g = (json.goals ?? []).find((x: { goalId: string }) => x.goalId === goalId)
  return {
    progressValue: g?.progressValue ?? 0,
    holdingIds: (g?.nonFunds ?? []).map((n: { transactionId: string }) => n.transactionId),
  }
}

test.describe('Term-deposit maturity — merge a sibling deposit into the re-deposit', () => {
  test('settles the sibling early and folds its cash into the renewed principal, no double-count', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Merge Goal', target_amount: 200_000_000 })
    // D: matured term deposit (rolls forward on renewal). S: an active sibling
    // bank deposit in the same goal — the one we fold in.
    const D = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-15), goal_id: goal.goal_id, notes: 'E2E Merge D',
    })
    const S = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 8_000_000, investment_date: iso(-120),
      interest_rate: 6, expiry_date: iso(60), goal_id: goal.goal_id, notes: 'E2E Merge S',
    })
    try {
      await gotoFreshDashboard(page)
      const before = await goalSnapshot(page, goal.goal_id)
      expect(before.holdingIds).toContain(S.transaction_id) // S is a standalone holding

      // Open the goal → desktop detail panel.
      await page.getByText('E2E Merge Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await expect(panel.getByText('E2E Merge D')).toBeVisible({ timeout: 10_000 })

      // D's Options → Handle maturity → choose "Settle & re-deposit" (merge).
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()
      await page.getByText(/^(Handle maturity|Xử lý đáo hạn)$/).click()
      await page.getByRole('button', { name: /Settle & re-deposit|Tất toán & gửi lại/i }).click()

      // Select S in the merge list; its received prefills to S's current value.
      await page.getByTestId(`merge-source-${S.transaction_id}`).click()
      await expect(page.getByTestId('merge-penalty-caption')).toBeVisible()

      // Capture the renew request so we can prove the server (not the client)
      // summed in the received cash: D.amount === BASE + Σ(received).
      const [renewReq] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith(`/${D.transaction_id}/renew`) && r.method() === 'POST'),
        page.getByRole('button', { name: /Save new deposit|Lưu sổ mới/i }).click(),
      ])
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

      const body = renewReq.postDataJSON()
      const base: number = body.amount_vnd
      const received: number = body.merge_sources[0].received
      expect(body.merge_sources).toEqual([{ tx_id: S.transaction_id, received }])

      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)

      // Net-worth invariant: D's principal grew by EXACTLY the received cash.
      await expect.poll(async () => {
        const { data } = await supabase
          .from('investment_transactions').select('amount_vnd')
          .eq('transaction_id', D.transaction_id).single()
        return data?.amount_vnd
      }, { timeout: 15_000 }).toBe(base + received)

      // S was fully closed: one withdrawal child, full principal, affects_progress TRUE.
      const { data: wds } = await supabase
        .from('investment_transactions')
        .select('amount_vnd, principal_withdrawn, affects_progress, transaction_type')
        .eq('parent_transaction_id', S.transaction_id)
      expect(wds).toHaveLength(1)
      expect(wds![0]).toMatchObject({
        transaction_type: 'withdrawal',
        principal_withdrawn: 8_000_000, // S's full effective principal
        amount_vnd: received,
        affects_progress: true,
      })

      // Loop closed via the rendered overview: S is gone from the goal's holdings
      // (settled, not duplicated), and the progress value did NOT jump by S's
      // value — the merge is an internal transfer, so the bar stays steady.
      await gotoFreshDashboard(page)
      const after = await goalSnapshot(page, goal.goal_id)
      expect(after.holdingIds).not.toContain(S.transaction_id)
      expect(after.progressValue).toBeLessThan(before.progressValue + 8_000_000 / 2) // no double-count
      expect(after.progressValue).toBeGreaterThan(before.progressValue - 8_000_000)  // didn't lose the money either
    } finally {
      await api.deleteTransactionCascade(S.transaction_id)
      await api.deleteTransactionCascade(D.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
