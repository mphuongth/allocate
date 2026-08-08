import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FundLibraryClient from '../FundLibraryClient'
import type { Fund } from '../components/useFundsData'

// Both fund views stay mounted at once — the desktop one is hidden with a CSS
// breakpoint, not unmounted — so a request started in one is still in flight
// when a resize hands the user the other. The in-flight bookkeeping has to be
// shared or the second view happily starts a stacked write, and the two
// rollbacks then aim at each other's optimistic values instead of at the
// server's state (#590 review).

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/formatters', () => ({
  fmtNav: (n: number) => String(n),
  fmtCompact: (n: number) => `${n}`,
}))

vi.mock('@/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn() }),
}))

const FUND: Fund = {
  id: 'f1',
  name: 'VFMVF1 Equity Fund',
  code: 'VFMVF1',
  fund_type: 'equity',
  nav: 36120,
  nav_auto_sync: false,
  is_dca: true,
  dca_monthly_amount_vnd: 2_000_000,
  dca_goal_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

vi.mock('../components/useFundsData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/useFundsData')>()),
  useFundsData: () => {
    const [funds, setFunds] = useState<Fund[]>([FUND])
    return { funds, setFunds, goals: [], loading: false, error: false, reload: async () => {} }
  },
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(() => new Promise(() => {}))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('FundLibraryClient — DCA busy state is shared by both mounted views', () => {
  it('marks the fund busy in the mobile card while the desktop save is in flight', async () => {
    render(<FundLibraryClient />)

    const row = screen.getByTestId('fund-row-f1')
    await userEvent.click(within(row).getByTestId('dca-amount-btn-f1'))
    const input = within(row).getByTestId('dca-amount-input-f1')
    await userEvent.clear(input)
    await userEvent.type(input, '3000000')
    fireEvent.blur(input)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // The other viewport must not offer a second write on the same fund.
    const card = screen.getByTestId('fund-card-f1')
    expect(within(card).getByTestId('dca-amount-btn-f1')).toBeDisabled()
    expect(within(card).getByLabelText('disableDca')).toBeDisabled()
    await userEvent.click(within(card).getByTestId('dca-amount-btn-f1'))
    expect(within(card).queryByTestId('dca-amount-input-f1')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
