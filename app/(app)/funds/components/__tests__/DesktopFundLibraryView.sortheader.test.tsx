import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopFundLibraryView from '../DesktopFundLibraryView'
import type { Fund } from '../useFundsData'
import { useFundsBusy } from './helpers/fundsBusy'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))
vi.mock('@/lib/formatters', () => ({ fmtNav: (n: number) => String(n), fmtCompact: (n: number) => `${n}` }))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1', name: 'Alpha Fund', code: 'AAA', fund_type: 'equity', nav: 100,
    nav_auto_sync: false, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}
function Harness() {
  const [funds, setFunds] = useState([
    makeFund(),
    makeFund({ id: 'f2', code: 'BBB', name: 'Beta Fund', nav: 200 }),
  ])
  return <DesktopFundLibraryView {...useFundsBusy()} funds={funds} setFunds={setFunds} goals={[]} loading={false} error={false} reload={() => Promise.resolve()} />
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('DesktopFundLibraryView — sortable column headers are keyboard-operable', () => {
  it('renders the Fund and NAV sort controls as real buttons', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: /colFund/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /colNav/i })).toBeInTheDocument()
  })

  it('activating the NAV header sorts by NAV and reflects it via aria-sort', async () => {
    render(<Harness />)
    const navBtn = screen.getByRole('button', { name: /colNav/i })
    await userEvent.click(navBtn)
    expect(navBtn.closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })
})
