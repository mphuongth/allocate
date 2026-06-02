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

    // The most recent investment surfaces as a "+" signed amount (green), never
    // a "−". fmtCompact renders 7,654,321 as "7.7M ₫".
    const row = card.getByTestId('recent-activity-row').first()
    await expect(row).toBeVisible({ timeout: 5_000 })
    await expect(row).toContainText('+')
    await expect(row).toContainText(/7\.7M/)
  })
})
