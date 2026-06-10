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
