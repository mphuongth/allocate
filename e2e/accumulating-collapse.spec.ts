import { test, expect, type Page } from '@playwright/test'
import * as api from './helpers/api'
import { expectRenewalCommitted } from './helpers/maturity'

// Book-level renewal for accumulating ("Loại 2") deposits: at maturity the whole
// book COLLAPSES into one fresh lump. This closes the loop on the design call
// from #349 — settle every tranche into one lump, but keep each tranche's closed
// cycle in history so the "topped up N×" story survives.
//
// Since #748 the renewed lump STAYS a book by default ("Tiếp tục là sổ tích
// luỹ", ticked), so its linked recurring saving keeps topping it up; unticked it
// becomes a plain term deposit, as every renewal did before. The two UI tests
// below take one path each.
//
// What this asserts: (1) a matured book surfaces the "Handle maturity" action and
// the collapse flow completes from the UI; (2) afterwards the anchor is the only
// live row of the book — still self-grouped by default, a plain term deposit
// (deposit_group_id cleared) when unticked; and (3) every tranche became its own
// history snapshot carrying real interest, so nothing is double-counted and the
// lineage is preserved.

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

async function gotoFreshDashboard(page: Page) {
  await page.goto('/settings')
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('dashboardOverviewCache')).forEach((k) => localStorage.removeItem(k))
  })
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])
}

test.describe('Accumulating book collapse (Loại 2 book-level renewal)', () => {
  test('a matured book collapses into one lump that stays a book by default, snapshotting each tranche', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Collapse Goal', target_amount: 200_000_000 })
    // A live book (future maturity) so the top-up is accepted, then mature it.
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Collapse Book', amount_vnd: 50_000_000, interest_rate: 3.0, investment_date: iso(-150), expiry_date: iso(30) },
    })).json()
    expect(anchor.deposit_group_id).toBe(anchor.transaction_id)
    const topUp = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })).json()
    expect(topUp.deposit_group_id).toBe(anchor.transaction_id)
    // An EXPLICIT recurring link (#348) pointing at the NON-anchor tranche — the
    // tranche the collapse will delete. The link must survive (re-pointed to the
    // surviving anchor), not be silently nulled by the FK's ON DELETE SET NULL.
    const saving = await api.createRecurringSaving({
      name: 'E2E Collapse Linked Saving', goal_id: goal.goal_id, amount_vnd: 2_000_000,
      linked_deposit_tx_id: topUp.transaction_id,
    })
    // Mature the whole book (PUT cascades the maturity to every tranche) so it
    // needs a book-level decision.
    const matured = await page.request.put(`/api/v1/investment-transactions/${anchor.transaction_id}`, { data: { expiry_date: iso(-2) } })
    expect(matured.ok()).toBeTruthy()

    try {
      await gotoFreshDashboard(page)
      await page.getByText('E2E Collapse Goal').first().click()
      const panel = page.getByTestId('desktop-goal-detail')
      await expect(panel).toBeVisible({ timeout: 5_000 })

      // The book rolls up to ONE holding; open its options.
      await expect(panel.getByRole('button', { name: 'Options', exact: true })).toHaveCount(1)
      await panel.getByRole('button', { name: 'Options', exact: true }).first().click()

      // A matured book now surfaces "Handle maturity" (the single-row path excludes
      // books — this is the book-only entry point).
      await page.getByRole('button', { name: /Handle maturity|Xử lý đáo hạn/i }).first().click()

      // The lump prefills with the PLAN TOTAL (Σ principal + accrued interest), not
      // bare principal — both in the default roll mode and the editable change mode.
      const PRINCIPAL = 60_000_000 // 50M anchor + 10M top-up
      const defaultLump = Number((await page.getByTestId('maturity-new-principal').textContent() ?? '').replace(/[^0-9]/g, ''))
      expect(defaultLump).toBeGreaterThan(PRINCIPAL)
      await page.getByRole('button', { name: /Change amount|Đổi số tiền/i }).click()
      const changeLump = Number((await page.getByTestId('maturity-new-amount').inputValue()).replace(/[^0-9]/g, ''))
      expect(changeLump).toBeGreaterThan(PRINCIPAL)
      await page.getByRole('button', { name: /Renew principal \+ interest|Tái tục gốc \+ lãi/i }).click()

      // Collapse form (defaults to roll principal + interest). Give it a clean term
      // and confirm — the route values each tranche's interest server-side.
      await page.getByTestId('maturity-term-input').fill('12')
      // Left at its default: the renewed lump stays a book (#748).
      await expect(page.getByTestId('maturity-keep-book')).toBeChecked()
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/collapse') && r.request().method() === 'POST'),
        page.getByRole('button', { name: /Confirm renewal|Xác nhận tái tục/i }).click(),
      ])
      expect(resp.status()).toBe(200)
      await expectRenewalCommitted(page)

      // ── Assert the persisted outcome ──────────────────────────────────────────
      const all = await (await page.request.get('/api/v1/investment-transactions?include_history=true&limit=1000')).json()
      const rows = all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null; renewed_from_transaction_id: string | null; interest_earned_vnd: number | null; transaction_type: string }>

      // (1) The anchor survived as a book of its own — still self-grouped, so the
      // linked recurring saving tops it up next month instead of opening a deposit.
      const anchorNow = rows.find((r) => r.transaction_id === anchor.transaction_id)
      expect(anchorNow).toBeTruthy()
      expect(anchorNow!.deposit_group_id).toBe(anchor.transaction_id)

      // (2) The renewed book starts with exactly one member: the lump. Every old
      // tranche was collapsed into it.
      const liveGrouped = rows.filter((r) => r.deposit_group_id === anchor.transaction_id && !r.renewed_from_transaction_id)
      expect(liveGrouped.map((r) => r.transaction_id)).toEqual([anchor.transaction_id])
      // The non-anchor tranche row is gone entirely (folded into the lump + snapshot).
      expect(rows.some((r) => r.transaction_id === topUp.transaction_id)).toBe(false)

      // (3) Each of the two tranches became its own history snapshot carrying its
      // real (positive) interest — the per-tranche lineage is preserved.
      const snaps = rows.filter((r) => r.renewed_from_transaction_id === anchor.transaction_id)
      expect(snaps).toHaveLength(2)
      expect(snaps.every((s) => (s.interest_earned_vnd ?? 0) > 0)).toBeTruthy()

      // (4) The EXPLICIT link survived: it was re-pointed from the deleted tranche
      // onto the surviving anchor (NOT silently nulled by ON DELETE SET NULL).
      const savingNow = await api.getRecurringSaving(saving.saving_id)
      expect(savingNow!.linked_deposit_tx_id).toBe(anchor.transaction_id)
    } finally {
      await api.deleteRecurringSaving(saving.saving_id)
      // Snapshots first: a kept book's anchor is self-grouped, so the group
      // delete would take the anchor out from under its own history.
      await api.deleteTransactionCascade(anchor.transaction_id) // collapsed anchor + snapshots
      await api.deleteDepositGroup(anchor.transaction_id) // live tranches (if not collapsed)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('a matured book, unticked from staying a book, collapses into a plain term deposit from the Needs-attention card', async ({ page }) => {
    test.slow()
    const goal = await api.createGoal({ goal_name: 'E2E Card Collapse Goal', target_amount: 200_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Card Collapse Book', amount_vnd: 40_000_000, interest_rate: 3.0, investment_date: iso(-150), expiry_date: iso(30) },
    })).json()
    await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 8_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })
    await page.request.put(`/api/v1/investment-transactions/${anchor.transaction_id}`, { data: { expiry_date: iso(-2) } })

    try {
      await gotoFreshDashboard(page)
      // The book shows as ONE grouped row in the card — open its collapse flow.
      const card = page.getByTestId('maturity-action-card')
      await expect(card).toBeVisible({ timeout: 10_000 })
      await expect(card).toContainText('E2E Card Collapse Book')
      await card.locator('div').filter({ hasText: 'E2E Card Collapse Book' })
        .getByRole('button', { name: /Handle|Xử lý/i }).first().click()

      await page.getByTestId('maturity-term-input').fill('12')
      // Opt out of #748's default: this renewal becomes a plain term deposit.
      await page.getByTestId('maturity-keep-book').uncheck()
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/collapse') && r.request().method() === 'POST'),
        page.getByRole('button', { name: /Confirm renewal|Xác nhận tái tục/i }).click(),
      ])
      expect(resp.status()).toBe(200)
      await expectRenewalCommitted(page)

      // Collapsed → a plain term deposit with a future maturity, so it drops off
      // the card. (No deposit_group_id; sibling tranche folded in.)
      const all = await (await page.request.get('/api/v1/investment-transactions?include_history=true&limit=1000')).json()
      const anchorNow = (all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null }>)
        .find((r) => r.transaction_id === anchor.transaction_id)
      expect(anchorNow!.deposit_group_id).toBeNull()
      await gotoFreshDashboard(page)
      const cardAfter = page.getByTestId('maturity-action-card')
      if (await cardAfter.isVisible().catch(() => false)) {
        await expect(cardAfter).not.toContainText('E2E Card Collapse Book')
      }
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteTransactionCascade(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })

  test('a book that changed since load (a top-up landed mid-flight) aborts the collapse, losing nothing', async ({ page }) => {
    const goal = await api.createGoal({ goal_name: 'E2E Collapse Race Goal', target_amount: 200_000_000 })
    const anchor = await (await page.request.post('/api/v1/investment-transactions', {
      data: { asset_type: 'bank', accumulating: true, goal_id: goal.goal_id, notes: 'E2E Collapse Race', amount_vnd: 50_000_000, interest_rate: 3.0, investment_date: iso(-150), expiry_date: iso(30) },
    })).json()
    const topUp = await (await page.request.post('/api/v1/investment-transactions', {
      data: { tops_up_deposit_id: anchor.transaction_id, asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 3.6, investment_date: iso(-20) },
    })).json()
    try {
      // Reproduce the TOCTOU: the route read only the anchor (T1), then this top-up
      // committed. Call the RPC with that STALE tranche set (omitting the top-up).
      // The loop meets a live tranche it wasn't given → it must abort, not snapshot
      // + delete the top-up (which would vanish, its principal never in the lump).
      const { error } = await api.rpcCollapseBook({
        p_group_id: anchor.transaction_id,
        p_amount_vnd: 50_000_000,
        p_interest_rate: 3.0,
        p_expiry_date: iso(120),
        p_investment_date: iso(0),
        p_tranche_ids: [anchor.transaction_id],
        p_tranche_interest: [0],
      })
      expect(error).toBeTruthy()
      expect(error!.message).toContain('book changed since load')

      // Atomic abort: both tranches still live + grouped, no stray snapshots.
      const all = await (await page.request.get('/api/v1/investment-transactions?include_history=true&limit=1000')).json()
      const rows = all.transactions as Array<{ transaction_id: string; deposit_group_id: string | null; renewed_from_transaction_id: string | null }>
      const live = rows.filter((r) => r.deposit_group_id === anchor.transaction_id && !r.renewed_from_transaction_id)
      expect(live).toHaveLength(2)
      expect(rows.some((r) => r.transaction_id === topUp.transaction_id)).toBe(true)
      expect(rows.filter((r) => r.renewed_from_transaction_id === anchor.transaction_id)).toHaveLength(0)
    } finally {
      await api.deleteDepositGroup(anchor.transaction_id)
      await api.deleteTransactionCascade(anchor.transaction_id)
      await api.deleteGoal(goal.goal_id)
    }
  })
})
