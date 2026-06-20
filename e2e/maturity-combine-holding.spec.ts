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

  test('rejects a held settlement that resolves no target goal (would silently lose net worth)', async ({ page }) => {
    // The held cash leaves net worth and is synthesized back ONLY via
    // merge_target_goal_id. With no goal AND no explicit target it resolves to
    // null → heldForMergeContributions skips it → the money vanishes from total
    // assets, shown nowhere. The UI always supplies a goal; the raw API must not
    // accept the unresolvable case.
    const res = await page.request.post('/api/v1/investment-transactions', {
      data: {
        transaction_type: 'withdrawal', asset_type: 'bank', investment_date: iso(0),
        amount_vnd: 5_000_000, principal_withdrawn: 5_000_000, affects_progress: true,
        held_for_merge: true, // no goal_id, no merge_target_goal_id
      },
    })
    expect(res.status()).toBe(400)
  })

  test('a held settlement reads neutrally in the History tab — not a red withdrawal', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Held Label Goal', target_amount: 200_000_000 })
    const D1 = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 10_000_000, investment_date: iso(-370),
      interest_rate: 6, expiry_date: iso(-5), goal_id: goal.goal_id, notes: 'E2E Held Label D1',
    })
    const A = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-1), goal_id: goal.goal_id, notes: 'E2E Held Label Anchor',
    })
    try {
      // Park D1 (held withdrawal) directly — the hold UI is covered above; here the
      // point is purely how the settlement is LABELLED downstream.
      const holdRes = await page.request.post('/api/v1/investment-transactions', {
        data: {
          goal_id: goal.goal_id, transaction_type: 'withdrawal', asset_type: 'bank',
          investment_date: iso(0), amount_vnd: 10_000_000, principal_withdrawn: 10_000_000,
          affects_progress: true, parent_transaction_id: D1.transaction_id,
          held_for_merge: true, merge_target_goal_id: goal.goal_id, merge_anchor_inv_id: A.transaction_id,
        },
      })
      expect(holdRes.status()).toBe(201)

      // Open the goal detail and its History tab (it fetches the goal's tx list).
      await gotoFreshDashboard(page)
      const panel = page.getByTestId('desktop-goal-detail')
      await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/v1/investment-transactions?goal_id=') && r.status() === 200, { timeout: 20_000 }),
        page.getByText('E2E Held Label Goal').first().click(),
      ])
      await expect(panel).toBeVisible({ timeout: 10_000 })
      await panel.getByText(/^(Lịch sử|History)$/).click()

      // The parked settlement reads as "Chờ gộp" / "For merge" — a neutral badge
      // this code path renders ONLY for a held row (before the fix it was a red
      // down-arrow withdrawal). Its presence is the red→green proof.
      await expect(panel.getByText(/Chờ gộp|For merge/).first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await api.deleteTransactionCascade(A.transaction_id)
      await api.deleteTransactionCascade(D1.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})

// The dashboard side of the invariant is covered above (progressValue never dips,
// never double-counts). This block closes the OTHER half on the Plan page: a goal
// with a monthly plan + a due recurring saving must not have its CONTRIBUTED /
// PLANNED perturbed merely by parking a deposit, and when the anchor's merge folds
// that recurring in, the line must read "đã ghi nhận" (recorded) exactly once — no
// double-count from the held cash ALSO landing there. Asserts the RENDERED Plan
// (data-* on the by-goal rows), not just the stored fulfillment.
test.describe('Term-deposit holding pool — Plan-page invariant', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  const now = new Date()
  const PMONTH = now.getMonth() + 1
  const PYEAR = now.getFullYear()
  const YM = `${PYEAR}-${String(PMONTH).padStart(2, '0')}`

  // Navigate to the Plan page for the current month and wait for its data.
  async function gotoPlanning(page: Page) {
    await page.goto('/settings') // unmount, force a fresh fetch
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/v1/monthly-plans') && r.status() === 200, { timeout: 20_000 }),
      page.goto('/planning'),
    ])
    await expect(page.getByTestId('desktop-planning')).toBeVisible({ timeout: 10_000 })
  }

  // The goal's PLANNED / CONTRIBUTED as the by-goal row renders them (data-* carry
  // the exact numbers buildByGoal computed, so we read the rendered value directly).
  async function planGoal(page: Page, goalId: string): Promise<{ planned: number; contributed: number }> {
    const planned = await page.getByTestId(`plan-goal-planned-${goalId}`).getAttribute('data-planned')
    const contributed = await page.getByTestId(`plan-goal-contributed-${goalId}`).getAttribute('data-contributed')
    return { planned: Number(planned), contributed: Number(contributed) }
  }

  test('parking a deposit leaves the plan untouched; a fold-on-consume records the recurring exactly once', async ({ page }) => {
    test.slow()
    const REC = 3_000_000
    const goal = await api.createGoal({ goal_name: 'E2E Plan Hold Goal', target_amount: 200_000_000 })
    const plan = await api.createMonthlyPlan({ month: PMONTH, year: PYEAR, salary_vnd: 30_000_000 })
    // D1 matured 5d ago; A matured 1d ago (the anchor). A recurring saving for the
    // goal is due this month AND is linked to D1 (it had been feeding that deposit)
    // — so holding D1 must also unlink it (hygiene: no dangling link to a closed row).
    const D1 = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 10_000_000, investment_date: iso(-370),
      interest_rate: 6, expiry_date: iso(-5), goal_id: goal.goal_id, notes: 'E2E Plan Hold D1',
    })
    const A = await api.createTransaction({
      asset_type: 'bank', amount_vnd: 20_000_000, investment_date: iso(-380),
      interest_rate: 6, expiry_date: iso(-1), goal_id: goal.goal_id, notes: 'E2E Plan Hold Anchor',
    })
    const rec = await api.createRecurringSaving({
      name: 'E2E Plan Recurring', goal_id: goal.goal_id, amount_vnd: REC,
      effective_from: `${YM}-01`, linked_deposit_tx_id: D1.transaction_id,
    })
    const { createClient } = await import('@supabase/supabase-js')
    const svc = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!)
    const recRow = page.getByTestId(`plan-recurring-${rec.saving_id}`)
    try {
      // ── Baseline: planned = the recurring; nothing contributed; line not recorded ──
      await gotoPlanning(page)
      const base = await planGoal(page, goal.goal_id)
      expect(base.planned).toBe(REC)
      expect(base.contributed).toBe(0)
      await expect(recRow).toHaveAttribute('data-recorded', 'false')

      // ── Park D1 (hold for merge into A) ──
      const holdRes = await page.request.post('/api/v1/investment-transactions', {
        data: {
          goal_id: goal.goal_id, transaction_type: 'withdrawal', asset_type: 'bank',
          investment_date: iso(0), amount_vnd: 10_000_000, principal_withdrawn: 10_000_000,
          affects_progress: true, parent_transaction_id: D1.transaction_id,
          held_for_merge: true, merge_target_goal_id: goal.goal_id, merge_anchor_inv_id: A.transaction_id,
        },
      })
      expect(holdRes.status()).toBe(201)
      const heldId = (await holdRes.json()).transaction_id

      // Hygiene: the recurring's link to the now-closed D1 is cleared on hold.
      const { data: afterHoldLink } = await svc
        .from('recurring_savings').select('linked_deposit_tx_id').eq('saving_id', rec.saving_id).single()
      expect(afterHoldLink?.linked_deposit_tx_id).toBeNull()

      // ── Assert A: the plan is exactly as it was — holding touches none of it ──
      await gotoPlanning(page)
      const afterHold = await planGoal(page, goal.goal_id)
      expect(afterHold.planned).toBe(REC)
      expect(afterHold.contributed).toBe(0)
      await expect(recRow).toHaveAttribute('data-recorded', 'false')

      // ── Consume D1 into A and fold this month's recurring in the same renewal ──
      const renewRes = await page.request.post(`/api/v1/investment-transactions/${A.transaction_id}/renew`, {
        data: {
          amount_vnd: 20_000_000, interest_rate: 6, expiry_date: iso(180), investment_date: iso(0),
          interest_earned_vnd: 0, held_sources: [heldId],
          fulfill_recurring: { saving_id: rec.saving_id, ym: YM, amount: REC },
        },
      })
      expect(renewRes.ok()).toBeTruthy()

      // ── Assert B: recorded EXACTLY ONCE — the line reads recorded, contributed
      //    rose by precisely the recurring amount (not twice), and the data layer
      //    holds a single fulfillment row. The held cash went into A's principal,
      //    NOT into the plan's contributed. ──
      await gotoPlanning(page)
      const afterFold = await planGoal(page, goal.goal_id)
      expect(afterFold.planned).toBe(REC)
      expect(afterFold.contributed).toBe(REC)
      await expect(recRow).toHaveAttribute('data-recorded', 'true')
      await expect(recRow.getByText(/Đã gửi|Saved/).first()).toBeVisible()

      const { data: fulfillments } = await svc
        .from('recurring_saving_fulfillments').select('*').eq('recurring_saving_id', rec.saving_id)
      expect(fulfillments).toHaveLength(1)
    } finally {
      await api.deleteRecurringFulfillments(rec.saving_id)
      await api.deleteRecurringSaving(rec.saving_id)
      await api.deleteMonthlyPlan(plan.id)
      await api.deleteTransactionCascade(A.transaction_id)
      await api.deleteTransactionCascade(D1.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
