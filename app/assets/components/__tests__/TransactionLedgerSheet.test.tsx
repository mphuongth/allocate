import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TransactionLedgerSheet from '../TransactionLedgerSheet'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
// Nested sheets fetch/render on their own; stub them so this test only exercises
// the ledger rows.
vi.mock('../AddTransactionSheet', () => ({ default: () => null }))

// The ledger ("Xem tất cả") shares txKind with the Recent activity card and the
// goal-detail History tab. A held-for-merge settlement is parked cash, not a spend,
// so it must read neutrally here too — never the red "−" of a withdrawal. This locks
// that the LEDGER calls txKind at render time (a logic-only txKind test can't).
// (t mock returns the key, so the direction label == the i18n key.)
describe('TransactionLedgerSheet — held-for-merge rows read neutrally', () => {
  const base = {
    asset_type: 'bank', investment_date: '2026-06-01', amount_vnd: 10_000_000,
    savings_goals: { goal_name: 'House' },
  }
  const heldTx = { ...base, transaction_id: 'h1', transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: null }
  const withdrawTx = { ...base, transaction_id: 'w1', transaction_type: 'withdrawal' }

  const mockTxs = (list: unknown[]) => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('savings-goals')) return Promise.resolve({ ok: true, json: async () => ({ goals: [] }) })
      if (url.includes('/api/funds')) return Promise.resolve({ ok: true, json: async () => ({ funds: [] }) })
      if (url.includes('investment-transactions')) return Promise.resolve({ ok: true, json: async () => ({ transactions: list, total: list.length }) })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  }

  beforeEach(() => { mockTxs([]) })

  const props = { open: true, desktop: true, locale: 'en', onClose: vi.fn() }

  it('a held settlement reads as "held" with no minus sign', async () => {
    mockTxs([heldTx])
    render(<TransactionLedgerSheet {...props} />)
    const row = await screen.findByTestId('tx-ledger-row')
    expect(screen.getByText('held')).toBeInTheDocument()
    expect(screen.queryByText('withdrawal')).toBeNull()
    expect(row.textContent).not.toContain('−')
  })

  it('a plain withdrawal still reads as a red "−" (so the neutral assertion is not vacuous)', async () => {
    mockTxs([withdrawTx])
    render(<TransactionLedgerSheet {...props} />)
    const row = await screen.findByTestId('tx-ledger-row')
    expect(screen.getByText('withdrawal')).toBeInTheDocument()
    expect(row.textContent).toContain('−')
  })
})
