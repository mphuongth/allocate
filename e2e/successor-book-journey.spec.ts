import { test, expect } from '@playwright/test'
import * as api from './helpers/api'
import { makeCleanupStack } from './helpers/cleanup'

// The one E2E #638 asks for: the whole successor-book journey, end to end.
//
// Every rule inside this flow is already pinned lower down — the lock-window
// boundaries in lib/__tests__/accumulatingTopUp.test.ts, the atomic handover in
// supabase/tests/successor_book.test.sql, the merge's conservation and lineage in
// merge_successor_book.test.sql, the refusals in the route tests. None of that is
// repeated here.
//
// What only a browser can show is the seam between them: the plan's "Saved" pill
// discovering the lock through a live deposit read, the handover moving the
// recurring link while the month is filed, and the dashboard totalling the result
// afterwards. The Phase 4 double-count bug lived in exactly that seam — a name-only
// lookup fed into the holdings input, so a dissolved source counted twice — and it
// was found by hand, not by a test.
//
// Deliberately NOT tagged @smoke: this is a five-round-trip journey and the smoke
// lane has a three-minute budget for the whole suite.

test.use({ viewport: { width: 1280, height: 800 } })

const cleanup = makeCleanupStack()
test.afterEach(() => cleanup.run())

const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

const today = new Date()
const MONTH = today.getMonth() + 1
const YEAR = today.getFullYear()

const BOOK_PRINCIPAL = 50_000_000
const MONTHLY = 2_000_000

test('a locked book hands over to a successor, which absorbs it at maturity', async ({ page }) => {
  test.slow()

  const stamp = Date.now()
  const goal = await api.createGoal({ goal_name: `E2E Successor Goal ${stamp}`, target_amount: 200_000_000 })
  cleanup.add(() => api.deleteGoal(goal.goal_id))

  // Book A: live, but inside a 30-day lock window — the bank stopped taking
  // top-ups 20 days before maturity, which is the situation #638 exists for.
  const bookA = await (await page.request.post('/api/v1/investment-transactions', {
    data: {
      asset_type: 'bank', accumulating: true, goal_id: goal.goal_id,
      notes: `E2E Successor Source ${stamp}`,
      amount_vnd: BOOK_PRINCIPAL, interest_rate: 3.0,
      investment_date: iso(-150), expiry_date: iso(20), top_up_lock_days: 30,
    },
  })).json()
  expect(bookA.deposit_group_id).toBe(bookA.transaction_id)

  // Registered HERE, not after the handover: everything between this line and the
  // successor POST can fail — and the run that matters most, a genuine regression
  // in the handover, is exactly the one that would leave the source book behind.
  // A deleted goal does not take it with it (the goal FK is ON DELETE SET NULL),
  // so it would drift into Unallocated and into every later spec's view of the
  // dashboard, including this test's own CI retry.
  //
  // One cleanup for the pair, because a merged pair cannot be torn down a book at
  // a time: B's credited tranche is referenced by A's closing withdrawal through
  // `consumed_by_inv_id`, and `move_merge_lineage_to_book` refuses to delete it
  // while that reference stands — deliberately, so an ordinary delete cannot walk
  // off with the successor's payout. `deleteBookCascade` swallows that error, so
  // the order is load-bearing: A's cascade removes the withdrawals, and with them
  // the reference that was blocking B. `bookB` is read at teardown time, so this
  // covers both the early failures and the completed journey.
  let bookB: { transaction_id: string; deposit_group_id: string; amount_vnd: number } | null = null
  cleanup.add(async () => {
    await api.deleteBookCascade(bookA.transaction_id)
    if (bookB) await api.deleteBookCascade(bookB.transaction_id)
  })

  // The monthly contribution the bank will refuse, aimed at A.
  const saving = await api.createRecurringSaving({
    name: `E2E Successor Saving ${stamp}`, goal_id: goal.goal_id, amount_vnd: MONTHLY,
    linked_deposit_tx_id: bookA.transaction_id,
  })
  cleanup.add(() => api.deleteRecurringFulfillments(saving.saving_id))
  cleanup.add(() => api.deleteRecurringSaving(saving.saving_id))

  const plan = await api.createMonthlyPlan({ month: MONTH, year: YEAR, salary_vnd: 30_000_000 })
  cleanup.add(() => api.deleteMonthlyPlan(plan.id))

  // ── 1. The plan discovers the lock and offers the successor ────────────────
  await page.goto('/planning')
  await page.waitForLoadState('networkidle')
  const desktop = page.getByTestId('desktop-planning')
  const line = desktop.getByTestId(`plan-recurring-${saving.saving_id}`)
  await expect(line).toBeVisible({ timeout: 10_000 })

  // "Saved" reads the linked book before deciding what to open. A is inside its
  // lock window, so the answer is a new book rather than a top-up sheet.
  await line.getByRole('button', { name: /Record deposit|Ghi nhận đã gửi/i }).click()
  const sheet = page.getByTestId('successor-modal')
  await expect(sheet).toBeVisible({ timeout: 10_000 })

  // Prefilled with the month the plan already knows about, and with A's own lock
  // window — the new book is the same product.
  await expect(sheet.getByTestId('successor-amount')).toHaveValue('2.000.000')
  await expect(sheet.getByTestId('successor-lock')).toHaveValue('30')

  // The bank's terms for a NEW deposit are the user's to supply.
  await sheet.getByTestId('successor-expiry').fill(iso(180))
  await sheet.getByTestId('successor-rate').fill('4,2')

  const [openRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/successor') && r.request().method() === 'POST', { timeout: 20_000 }),
    sheet.getByTestId('successor-submit').click(),
  ])
  expect(openRes.status()).toBe(201)
  bookB = await openRes.json()

  // ── 2. The month landed in B, and the plan says so ─────────────────────────
  await expect(line).toHaveAttribute('data-recorded', 'true', { timeout: 15_000 })
  expect(bookB!.deposit_group_id).toBe(bookB!.transaction_id)
  expect(bookB!.amount_vnd).toBe(MONTHLY)

  // ── 3. The recurring link followed the money ───────────────────────────────
  const linked = await api.getRecurringSaving(saving.saving_id)
  expect(linked!.linked_deposit_tx_id).toBe(bookB!.transaction_id)

  // ── 4. A matures, and goal detail offers the merge it was promised ─────────
  const matured = await page.request.put(`/api/v1/investment-transactions/${bookA.transaction_id}`, {
    data: { expiry_date: iso(-2) },
  })
  expect(matured.ok()).toBeTruthy()

  // Read the totals from the overview route directly rather than off the wire:
  // a response body captured during a navigation is gone by the time the page
  // settles. Same route the panel renders from, and uncached.
  const before = await (await page.request.get('/api/v1/dashboard/overview')).json()
  const goalBefore = before.goals.find((g: { goalId: string }) => g.goalId === goal.goal_id)
  expect(goalBefore).toBeTruthy()

  await page.goto('/settings')
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('dashboardOverviewCache')).forEach((k) => localStorage.removeItem(k))
  })
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])

  // The merge is offered from goal detail, which is the only surface that knows
  // a book was promised: the dashboard's needs-attention card builds its rows
  // without `successorDepositTxId`, so the same book opens the ordinary renewal
  // there. Filed separately — this test takes the path that works.
  await page.getByText(`E2E Successor Goal ${stamp}`).first().click()
  const panel = page.getByTestId('desktop-goal-detail')
  await expect(panel).toBeVisible({ timeout: 10_000 })

  // Both books are in this goal and they share a NAME: open_successor_book copies
  // the source's notes when the caller supplies none, and the sheet supplies
  // none. So the rows are told apart by their amounts, which this test chose to
  // be an order of magnitude apart (50M source, 2M successor).
  const options = panel.getByRole('button', { name: 'Options', exact: true })
  await expect(options).toHaveCount(2)
  const rowA = panel.locator('div')
    .filter({ hasText: /5\d[.,]\dM/ })
    .filter({ has: page.getByRole('button', { name: 'Options', exact: true }) })
    .last()
  await rowA.getByRole('button', { name: 'Options', exact: true }).click()
  await page.getByRole('button', { name: /Handle maturity|Xử lý đáo hạn/i }).first().click()

  // The maturity sheet leads with the promise rather than the ordinary renewal.
  const mergePanel = page.getByTestId('merge-successor-panel')
  await expect(mergePanel).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('merge-not-due')).toHaveCount(0)

  // Take the prefilled payout as-is: it is the same value the dashboard is
  // currently carrying for A, which is what makes step 6 an exact statement
  // rather than an approximate one.
  const received = Number((await mergePanel.getByTestId('merge-received').inputValue()).replace(/\D/g, ''))
  expect(received).toBeGreaterThan(BOOK_PRINCIPAL) // principal + interest, not bare principal

  const [mergeRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/merge-successor') && r.request().method() === 'POST', { timeout: 20_000 }),
    mergePanel.getByTestId('merge-successor-submit').click(),
  ])
  expect(mergeRes.status()).toBe(201) // a tranche was created in B

  // ── 5. The ledger: A closed, B holding exactly what arrived ────────────────
  const all = await (await page.request.get('/api/v1/investment-transactions?include_history=true&limit=1000')).json()
  const rows = all.transactions as Array<{
    transaction_id: string; deposit_group_id: string | null; transaction_type: string
    amount_vnd: number; principal_withdrawn: number | null; consumed_by_inv_id: string | null
    renewed_from_transaction_id: string | null
  }>

  // By id, not by group: the merge DISSOLVES the source book, so a filter on
  // `deposit_group_id === bookA` matches nothing afterwards and would report a
  // closed book whether or not the merge did anything at all.
  const anchorA = rows.find((r) => r.transaction_id === bookA.transaction_id)
  expect(anchorA).toBeTruthy()
  const drawnFromA = rows
    .filter((w) => w.transaction_type === 'withdrawal' && (w as { parent_transaction_id?: string }).parent_transaction_id === bookA.transaction_id)
    .reduce((x, w) => x + (w.principal_withdrawn ?? 0), 0)
  expect(anchorA!.amount_vnd - drawnFromA).toBe(0)
  expect(drawnFromA).toBe(BOOK_PRINCIPAL)

  const inB = rows.filter((r) => r.deposit_group_id === bookB!.transaction_id && r.transaction_type === 'investment' && !r.renewed_from_transaction_id)
  expect(inB).toHaveLength(2) // B's own opening tranche + the one the merge added
  expect(inB.reduce((s, t) => s + t.amount_vnd, 0)).toBe(MONTHLY + received)

  // ── 6. The dashboard: the money moved, it did not multiply or vanish ───────
  const after = await (await page.request.get('/api/v1/dashboard/overview')).json()
  const goalAfter = after.goals.find((g: { goalId: string }) => g.goalId === goal.goal_id)

  // A double-count would add a whole book (+50M); a disappearance would drop one.
  // The tolerance covers only the projection being recomputed either side of the
  // merge — the source's own accrual was folded into `received`, but the two
  // numbers come from different code paths (the merge preview and the overview
  // valuation), so they are allowed to disagree by rounding, not by a holding.
  const slack = BOOK_PRINCIPAL * 0.01
  expect(Math.abs(goalAfter.currentValue - goalBefore.currentValue)).toBeLessThan(slack)
  expect(Math.abs(after.netWorth.totalAssets - before.netWorth.totalAssets)).toBeLessThan(slack)

  // And the source is gone from the goal's live holdings rather than lingering
  // beside the book that now holds its cash. Counted, not named: the successor
  // inherited the source's notes, so "the label disappeared" would be false even
  // on a perfect merge — and it would pass anyway on an empty panel that had not
  // finished loading.
  await page.goto('/settings')
  await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith('dashboardOverviewCache')).forEach((k) => localStorage.removeItem(k))
  })
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/v1/dashboard/overview') && r.status() === 200, { timeout: 20_000 }),
    page.goto('/dashboard'),
  ])
  await page.getByText(`E2E Successor Goal ${stamp}`).first().click()
  await expect(panel).toBeVisible({ timeout: 10_000 })
  await expect(panel.getByRole('button', { name: 'Options', exact: true })).toHaveCount(1)

  // The one left is the book that absorbed the other: its top-up history carries
  // the provenance line Phase 4 added, which only a merged tranche renders.
  await panel.getByRole('button', { name: 'Options', exact: true }).click()
  await expect(page.getByTestId('tranche-merged-from')).toBeVisible({ timeout: 10_000 })
})
