import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'

// "Ví chờ gộp" (merge holding pool) — PR4 of "Gộp nhiều nguồn". An earlier-
// maturing deposit can be settled with "Để dành gộp": it is closed by a held
// withdrawal, but its cash stays earmarked to the goal (synthesized straight back,
// so the goal value never dips and it never shows as a stray deposit). When the
// anchor matures the merge consumes the holding — folds the parked cash into the
// re-deposit with NO second withdrawal, so nothing is double-counted. Changing
// your mind ("Bỏ chờ gộp") restores the original deposit.
//
// Closes the loop on the rendered overview at every step:
//   • hold → goal value unchanged, the deposit leaves holdings, a held entry
//     appears (the cash keeps counting), and
//   • consume → goal value STILL unchanged (no double-count) and the held entry
//     is gone, and
//   • unhold → the original deposit is back and the value is unchanged.
// Desktop viewport — the flow is driven from the goal-detail panel (same place
// the merge spec opens it).

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

// The goal's progress value, holdings, and pooled-holding entries, from the
// overview API (the source of truth the UI renders).
async function goalSnapshot(page: Page, goalId: string): Promise<{
  progressValue: number; holdingIds: string[]; held: { transactionId: string; amount: number }[]
}> {
  const res = await page.request.get('/api/v1/dashboard/overview')
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  const g = (json.goals ?? []).find((x: { goalId: string }) => x.goalId === goalId)
  return {
    progressValue: g?.progressValue ?? 0,
    holdingIds: (g?.nonFunds ?? []).map((n: { transactionId: string }) => n.transactionId),
    held: (g?.heldForMerge ?? []).map((h: { transactionId: string; amount: number }) => ({ transactionId: h.transactionId, amount: h.amount })),
  }
}

// Open the goal-detail panel and run a deposit's row → Options → Handle maturity.
async function openHandleMaturity(page: Page, goalName: string, depositNotes: string) {
  const panel = page.getByTestId('desktop-goal-detail')
  // The panel fetches its OWN tx list on open; wait for that response so the
  // investments tab is populated before we hunt for a deposit row (otherwise we
  // can race the empty-state "no investments yet").
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/investment-transactions?goal_id=') && r.status() === 200, { timeout: 20_000 }),
    page.getByText(goalName).first().click(),
  ])
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByText(depositNotes)).toBeVisible({ timeout: 10_000 })
  // The list renders every deposit; target the row that actually names this one
  // (Options buttons are otherwise indistinguishable).
  const row = panel.locator('div')
    .filter({ has: page.getByRole('button', { name: 'Options', exact: true }) })
    .filter({ hasText: depositNotes })
    .last()
  await row.getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByText(/^(Handle maturity|Xử lý đáo hạn)$/).click()
}

test.describe('Term-deposit maturity — "Ví chờ gộp" holding pool', () => {
  test('holds an earlier deposit, then consumes it into the anchor with no double-count', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Hold Goal', target_amount: 200_000_000 })
    // D1 matured 5d ago (the earlier deposit we hold). A matured 1d ago (the later
    // anchor, gap 4 ≤ window 7) — its merge sheet will consume the holding.
    const D1 = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 10_000_000, investment_date: iso(-370),
      interest_rate: 6, expiry_date: iso(-5), goal_id: goal.goal_id, notes: 'E2E Hold D1',
    })
    const A = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-1), goal_id: goal.goal_id, notes: 'E2E Hold Anchor',
    })
    try {
      await gotoFreshDashboard(page)
      const before = await goalSnapshot(page, goal.goal_id)
      expect(before.holdingIds).toContain(D1.transaction_id)

      // ── Hold D1 for merge into A ──
      await openHandleMaturity(page, 'E2E Hold Goal', 'E2E Hold D1')
      // The nudge names the anchor, and the withdraw branch forks (hold preselected).
      await expect(page.getByTestId('maturity-hold-nudge')).toBeVisible()
      await page.getByRole('button', { name: /Don.t renew|Không tái tục/i }).click()
      await expect(page.getByTestId('maturity-hold-fork')).toBeVisible()
      const [holdReq] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/api/v1/investment-transactions') && r.method() === 'POST'),
        page.getByRole('button', { name: /Confirm hold|Xác nhận để dành/i }).click(),
      ])
      expect(holdReq.postDataJSON()).toMatchObject({
        transaction_type: 'withdrawal', parent_transaction_id: D1.transaction_id,
        held_for_merge: true, merge_target_goal_id: goal.goal_id, merge_anchor_inv_id: A.transaction_id,
      })
      await expect(page.getByTestId('maturity-held')).toBeVisible({ timeout: 20_000 })

      // Held: D1 left the holdings list but the goal value held steady (cash parked,
      // synthesized straight back), and a pooled entry now carries it.
      await gotoFreshDashboard(page)
      const afterHold = await goalSnapshot(page, goal.goal_id)
      expect(afterHold.holdingIds).not.toContain(D1.transaction_id)
      expect(afterHold.held).toHaveLength(1)
      expect(Math.abs(afterHold.progressValue - before.progressValue)).toBeLessThan(1_000_000)
      const heldId = afterHold.held[0].transactionId

      // ── Consume the holding into A ──
      await openHandleMaturity(page, 'E2E Hold Goal', 'E2E Hold Anchor')
      // Opens straight into combine; the pooled holding is listed + preselected.
      await expect(page.getByTestId(`merge-held-${heldId}`)).toBeVisible({ timeout: 10_000 })
      const [renewReq] = await Promise.all([
        page.waitForRequest((r) => r.url().endsWith(`/${A.transaction_id}/renew`) && r.method() === 'POST'),
        page.getByRole('button', { name: /Save new deposit|Lưu sổ mới/i }).click(),
      ])
      expect(renewReq.postDataJSON().held_sources).toEqual([heldId])
      await expect(page.getByTestId('maturity-renewed')).toBeVisible({ timeout: 20_000 })

      // Consumed: the pool is empty and the goal value STILL matches the start —
      // the held cash moved into A's principal, never counted twice.
      await gotoFreshDashboard(page)
      const afterConsume = await goalSnapshot(page, goal.goal_id)
      expect(afterConsume.held).toHaveLength(0)
      expect(Math.abs(afterConsume.progressValue - before.progressValue)).toBeLessThan(1_000_000)

      // The holding row is consumed in place — no second withdrawal opened.
      const { createClient } = await import('@supabase/supabase-js')
      const supabase = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
      const { data: held } = await supabase
        .from('investment_transactions').select('consumed_by_inv_id').eq('transaction_id', heldId).single()
      expect(held?.consumed_by_inv_id).toBe(A.transaction_id)

      // A stale tab still showing the "Bỏ chờ gộp" chip must NOT be able to unhold a
      // holding the merge already consumed — deleting it would re-open D1 while its
      // cash already lives in A's principal (double-count). The server guards with a
      // 409 instead of trusting the UI to have hidden the chip.
      const staleUnhold = await page.request.delete(`/api/v1/investment-transactions/${heldId}`)
      expect(staleUnhold.status()).toBe(409)
      // The row survives the rejected delete, and the goal value is unmoved.
      const stillThere = await page.request.get(`/api/v1/investment-transactions/${heldId}`)
      expect(stillThere.ok()).toBeTruthy()
      const afterReject = await goalSnapshot(page, goal.goal_id)
      expect(afterReject.holdingIds).not.toContain(D1.transaction_id)
      expect(Math.abs(afterReject.progressValue - before.progressValue)).toBeLessThan(1_000_000)
    } finally {
      await api.deleteTransactionCascade(A.transaction_id)
      await api.deleteTransactionCascade(D1.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('"Bỏ chờ gộp" restores the original deposit', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Unhold Goal', target_amount: 200_000_000 })
    const D1 = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 10_000_000, investment_date: iso(-370),
      interest_rate: 6, expiry_date: iso(-5), goal_id: goal.goal_id, notes: 'E2E Unhold D1',
    })
    const A = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-1), goal_id: goal.goal_id, notes: 'E2E Unhold Anchor',
    })
    try {
      await gotoFreshDashboard(page)
      const before = await goalSnapshot(page, goal.goal_id)

      // Hold D1.
      await openHandleMaturity(page, 'E2E Unhold Goal', 'E2E Unhold D1')
      await page.getByRole('button', { name: /Don.t renew|Không tái tục/i }).click()
      await Promise.all([
        page.waitForRequest((r) => r.url().endsWith('/api/v1/investment-transactions') && r.method() === 'POST'),
        page.getByRole('button', { name: /Confirm hold|Xác nhận để dành/i }).click(),
      ])
      await expect(page.getByTestId('maturity-held')).toBeVisible({ timeout: 20_000 })

      await gotoFreshDashboard(page)
      const afterHold = await goalSnapshot(page, goal.goal_id)
      expect(afterHold.holdingIds).not.toContain(D1.transaction_id)
      const heldId = afterHold.held[0].transactionId

      // Open the goal detail → the "Đang chờ gộp" chip with its "Bỏ chờ gộp" action.
      await page.getByText('E2E Unhold Goal').first().click()
      await expect(page.getByTestId('desktop-goal-detail')).toBeVisible({ timeout: 10_000 })
      await page.getByTestId(`unhold-${heldId}`).click()

      // Restored: D1 is back in the holdings and the value is unchanged.
      await expect.poll(async () => (await goalSnapshot(page, goal.goal_id)).holdingIds, { timeout: 15_000 })
        .toContain(D1.transaction_id)
      const restored = await goalSnapshot(page, goal.goal_id)
      expect(restored.held).toHaveLength(0)
      expect(Math.abs(restored.progressValue - before.progressValue)).toBeLessThan(1_000_000)
    } finally {
      await api.deleteTransactionCascade(A.transaction_id)
      await api.deleteTransactionCascade(D1.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
