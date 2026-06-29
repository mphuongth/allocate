import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopFundLibraryView from '../DesktopFundLibraryView'
import type { Fund } from '../useFundsData'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))
vi.mock('@/lib/formatters', () => ({ fmtNav: (n: number) => String(n), fmtCompact: (n: number) => `${n}` }))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1', name: 'VFMVF1 Equity Fund', code: 'VFMVF1', fund_type: 'equity', nav: 36120,
    nav_source_url: null, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}
function Harness({ initial }: { initial: Fund[] }) {
  const [funds, setFunds] = useState(initial)
  return <DesktopFundLibraryView funds={funds} setFunds={setFunds} goals={[]} loading={false} error={false} reload={() => Promise.resolve()} />
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('DesktopFundLibraryView — P2 parity/feedback', () => {
  it('Refresh button carries an explanatory title when disabled (no NAV source URL on any fund)', () => {
    render(<Harness initial={[makeFund({ nav_source_url: null })]} />)
    const btn = screen.getByRole('button', { name: /refresh/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'refreshDisabledHint')
  })

  it('the Add/Edit form modal does NOT close on a backdrop click (avoids losing typed input)', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(screen.getByRole('button', { name: 'add' }))
    const modal = screen.getByTestId('fund-modal')
    fireEvent.click(modal.parentElement as HTMLElement) // the backdrop
    expect(screen.getByTestId('fund-modal')).toBeInTheDocument()
  })
})
