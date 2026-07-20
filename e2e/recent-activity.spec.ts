import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// Recent activity card on the dashboard + the "View all" transaction ledger.
// Replaces the legacy Settings → Transactions tab. The card is the headline
// surface; "View all" opens the full ledger (filters + add/import/edit/delete).

test.beforeEach(async ({ page }) => {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'
  const hostname = new URL(baseURL).hostname
  await page.context().addCookies([{ name: 'locale', value: 'en', domain: hostname, path: '/' }])
})

// ─── Desktop (default 1280×800 viewport from config) ─────────────────────────

test.describe('Recent activity — desktop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('recent activity card is visible with heading and View all', async ({ page }) => {
    const card = page.getByTestId('recent-activity')
    await expect(card).toBeVisible({ timeout: 10_000 })
    await expect(card.getByText(/recent activity|hoạt động gần đây/i).first()).toBeVisible()
    await expect(page.getByTestId('recent-activity-view-all')).toBeVisible()
  })

  test('View all opens the transaction ledger with Add and Import', async ({ page }) => {
    await page.getByTestId('recent-activity-view-all').click()
    const ledger = page.getByTestId('tx-ledger')
    await expect(ledger).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('tx-ledger-add')).toBeVisible()
    await expect(page.getByTestId('tx-ledger-import')).toBeVisible()
  })
})

// ─── Mobile ──────────────────────────────────────────────────────────────────

test.describe('Recent activity — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
  })

  test('recent activity card is visible with View all', async ({ page }) => {
    await expect(page.getByTestId('recent-activity')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('recent-activity-view-all')).toBeVisible()
  })

  test('View all opens the transaction ledger', async ({ page }) => {
    await page.getByTestId('recent-activity-view-all').click()
    await expect(page.getByTestId('tx-ledger')).toBeVisible({ timeout: 5_000 })
  })

  // Issue #362: on iOS an empty <input type="date"> renders fully blank (no
  // "mm/dd/yyyy" placeholder like Chrome), so the date filters looked like two
  // empty boxes "off UI". They must carry visible From/To labels like desktop.
  test('mobile date filters show visible From/To labels', async ({ page }) => {
    // Several rows, with names long enough to be worth eliding. The overflow this test
    // guards is driven by the ROWS' min-content, so a single short-named transaction does
    // not reproduce it — the assertion below used to pass or fail purely on how much data
    // earlier specs happened to leave behind on the shared user. Seeding the condition
    // makes it deterministic.
    const txs = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        api.createTransaction({
          asset_type: 'bank',
          amount_vnd: 5_000_000 + i,
          investment_date: new Date().toISOString().slice(0, 10),
          interest_rate: 5,
          notes: `E2E 362 filter — long transaction label ${i}`,
        }),
      ),
    )
    try {
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')
      await page.getByTestId('recent-activity-view-all').click()

      const ledger = page.getByTestId('tx-ledger')
      await expect(ledger).toBeVisible({ timeout: 5_000 })
      // The filter row (gated on having transactions) renders both date inputs…
      const dateInputs = ledger.locator('input[type="date"]')
      await expect(dateInputs).toHaveCount(2)
      // …each labeled, so a blank iOS date field is still identifiable.
      await expect(ledger.getByText('From', { exact: true })).toBeVisible()
      await expect(ledger.getByText('To', { exact: true })).toBeVisible()
      // …and an overlaid placeholder fills the otherwise-blank iOS empty state.
      // Both fields start empty → two placeholders; pick one and it disappears.
      await expect(ledger.getByText('dd/mm/yyyy')).toHaveCount(2)
      await dateInputs.first().fill('2026-06-19')
      await expect(ledger.getByText('dd/mm/yyyy')).toHaveCount(1)
      // …and nothing in the sheet overflows to the right.
      //
      // Widened past the two date fields on purpose. The regression this caught clipped
      // the Add button and the goal select too: the sheet's grids had no explicit column,
      // so the implicit `auto` track was floored at the ledger rows' min-content (~445px
      // against a 358px sheet) and every sibling inherited that width. Measuring only the
      // date fields understated it, and would miss the same class of break next time.
      const ledgerBox = await ledger.boundingBox()
      const rightEdge = ledgerBox!.x + ledgerBox!.width + 1
      const mustFit = [
        ledger.getByTestId('tx-ledger-add'),
        ledger.getByTestId('tx-ledger-import'),
        ledger.locator('select').nth(0),
        ledger.locator('select').nth(1),
        dateInputs.nth(0),
        dateInputs.nth(1),
      ]
      for (const el of mustFit) {
        const box = await el.boundingBox()
        expect(box!.x + box!.width).toBeLessThanOrEqual(rightEdge)
      }
    } finally {
      for (const tx of txs) await api.deleteTransactionCascade(tx.transaction_id)
    }
  })
})

// ─── Data-backed: an investment renders as a positive (+) row ────────────────
// Per the TDD lesson: assert the rendered outcome, not just storage. A seeded
// investment must surface in the card as a "+amount" row.

test.describe('Recent activity — rendered row', () => {
  const NOTE = 'E2E recent activity bank'
  let txId: string

  test.beforeAll(async () => {
    const tx = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 7_654_321,
      investment_date: new Date().toISOString().slice(0, 10),
      interest_rate: 5.2,
      notes: NOTE,
    })
    txId = tx.transaction_id
  })

  test.afterAll(async () => {
    if (txId) await api.deleteTransactionCascade(txId)
  })

  test('seeded investment shows as a positive row in the card', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    const card = page.getByTestId('recent-activity')
    await expect(card).toBeVisible({ timeout: 10_000 })

    // An investment surfaces as a "+" signed amount (green), never a "−".
    // fmtCompact renders 7,654,321 as "7.7M ₫".
    //
    // Matched by amount rather than by taking `.first()`: this transaction is dated today,
    // and so are several seeded by other specs, so "the top row is mine" only held when
    // this file ran alone. The behaviour under test is the sign, not the ordering.
    const row = card.getByTestId('recent-activity-row').filter({ hasText: /7\.7M/ })
    await expect(row).toBeVisible({ timeout: 5_000 })
    await expect(row).toContainText('+')
  })
})

// ─── Ledger CRUD: delete from "View all" ─────────────────────────────────────
// Replaces the legacy Settings-tab delete test now that the tab is removed.
// Default viewport is desktop, so the ledger opens as the desktop table modal.

test.describe('Recent activity — delete from ledger', () => {
  const NOTE = 'E2E Ledger Delete'

  test.beforeEach(async () => { await api.deleteAllTransactionsByNotes(NOTE) })
  test.afterEach(async () => { await api.deleteAllTransactionsByNotes(NOTE) })

  test('a transaction can be deleted from the View all ledger', async ({ page }) => {
    await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 3_210_000,
      investment_date: new Date().toISOString().slice(0, 10),
      notes: NOTE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await page.getByTestId('recent-activity-view-all').click()
    await expect(page.getByTestId('tx-ledger')).toBeVisible({ timeout: 5_000 })

    const row = page.getByTestId('tx-ledger-row').filter({ hasText: NOTE })
    await expect(row).toBeVisible({ timeout: 10_000 })

    await row.getByTestId('tx-ledger-delete').click()
    await page.getByTestId('tx-ledger-delete-confirm').click()

    await expect(page.getByTestId('tx-ledger-row').filter({ hasText: NOTE })).toHaveCount(0, { timeout: 10_000 })
  })
})
