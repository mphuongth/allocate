import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import RecentActivityCard from '../RecentActivityCard'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
}))
// The ledger sheet fetches on its own; stub it so this test only exercises the card.
vi.mock('../TransactionLedgerSheet', () => ({ default: () => null }))

const mockTx = {
  transaction_id: 'tx-1',
  transaction_type: 'buy',
  asset_type: 'fund',
  fund_name: 'VNINDEX ETF',
  investment_date: '2024-01-15',
  amount_vnd: 2_200_000,
  savings_goals: { goal_name: 'House' },
}

// Issue #235 · §04 ("PR 4"): the dashboard's Recent activity used to pop in with
// no loading indicator. It must now show the shared row skeleton on first load,
// the same vocabulary as the detail panels/sheets.
describe('RecentActivityCard — first-load skeleton', () => {
  it('shows the row skeleton while loading, then the real rows', async () => {
    let resolveFetch: () => void = () => {}
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolveFetch = () => r({ ok: true, json: async () => ({ transactions: [mockTx], total: 1 }) })
        }),
    )

    render(<RecentActivityCard locale="en" />)

    // First paint: skeleton, not an empty card that pops in later.
    expect(screen.getByTestId('skeleton-tx-rows')).toBeInTheDocument()
    expect(screen.queryByTestId('recent-activity-row')).toBeNull()

    resolveFetch()
    await waitFor(() => expect(screen.getByTestId('recent-activity-row')).toBeInTheDocument())
    expect(screen.queryByTestId('skeleton-tx-rows')).toBeNull()
  })

  it('replaces the skeleton with the empty state when there are no transactions', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transactions: [], total: 0 }) })

    render(<RecentActivityCard locale="en" />)

    await waitFor(() => expect(screen.queryByTestId('skeleton-tx-rows')).toBeNull())
    expect(screen.getByText('recentActivityEmpty')).toBeInTheDocument()
  })
})

// A held-for-merge settlement is a withdrawal whose cash was PARKED for a merge, not
// spent. It must NOT render as the red "−" loss of a real withdrawal. The txKind/txDir
// unit tests prove the logic; this proves the CARD actually calls it at render time —
// the gap a logic-only test can't catch if the component forgets the branch. (tt mock
// returns the key, so badge text == the i18n key.)
describe('RecentActivityCard — held-for-merge rows read neutrally', () => {
  const base = {
    asset_type: 'bank', investment_date: '2026-06-01', amount_vnd: 10_000_000,
    savings_goals: { goal_name: 'House' },
  }
  const heldTx = { ...base, transaction_id: 'h1', transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: null }
  const consumedTx = { ...base, transaction_id: 'c1', transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: 'anchor-1' }
  const withdrawTx = { ...base, transaction_id: 'w1', transaction_type: 'withdrawal' }

  const mockTxs = (list: unknown[]) => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transactions: list, total: list.length }) })
  }

  it('a held settlement shows the neutral "held" badge — not "withdrawal", no "−"', async () => {
    mockTxs([heldTx])
    render(<RecentActivityCard locale="en" />)
    const row = await screen.findByTestId('recent-activity-row')
    expect(screen.getByText('held')).toBeInTheDocument()
    expect(screen.queryByText('withdrawal')).toBeNull()
    expect(row.textContent).not.toContain('−')
  })

  it('a consumed holding shows "merged", still neutral', async () => {
    mockTxs([consumedTx])
    render(<RecentActivityCard locale="en" />)
    const row = await screen.findByTestId('recent-activity-row')
    expect(screen.getByText('merged')).toBeInTheDocument()
    expect(row.textContent).not.toContain('−')
  })

  it('a plain withdrawal still reads as a red "−" (the neutral assertions are not vacuous)', async () => {
    mockTxs([withdrawTx])
    render(<RecentActivityCard locale="en" />)
    const row = await screen.findByTestId('recent-activity-row')
    expect(screen.getByText('withdrawal')).toBeInTheDocument()
    expect(row.textContent).toContain('−')
  })
})
