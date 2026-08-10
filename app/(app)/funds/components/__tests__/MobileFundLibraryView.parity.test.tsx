import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileFundLibraryView from '../MobileFundLibraryView'
import type { Fund } from '../useFundsData'
import { useFundsBusy } from './helpers/fundsBusy'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))
vi.mock('@/lib/formatters', () => ({ fmtNav: (n: number) => String(n), fmtCompact: (n: number) => `${n}` }))
vi.mock('@/components/navigation/NavigationContext', () => ({ useNavigation: () => ({ setMobileTopBar: vi.fn() }) }))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1', name: 'VFMVF1 Equity Fund', code: 'VFMVF1', fund_type: 'equity', nav: 36120,
    nav_auto_sync: false, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}
function Harness({ initial }: { initial: Fund[] }) {
  const [funds, setFunds] = useState(initial)
  return <MobileFundLibraryView {...useFundsBusy()} funds={funds} setFunds={setFunds} goals={[]} loading={false} error={false} reload={() => Promise.resolve()} />
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('MobileFundLibraryView — P2 parity/reversibility', () => {
  it('the delete sheet shows the permanent-delete impact line (parity with desktop)', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(screen.getByLabelText('deleteBtn'))
    const sheet = screen.getByTestId('delete-fund-sheet')
    // Desktop shows deleteWarning + deleteCannotUndo; mobile must not drop the warning.
    expect(sheet.textContent).toContain('deleteWarning')
    expect(sheet.textContent).toContain('deleteCannotUndo')
  })

  it('the Add/Edit form sheet does NOT close on a backdrop tap (avoids losing typed input)', async () => {
    render(<Harness initial={[makeFund()]} />)
    await userEvent.click(screen.getByLabelText('editFund'))
    const sheet = screen.getByTestId('fund-sheet')
    fireEvent.click(sheet.parentElement as HTMLElement) // the backdrop overlay
    expect(screen.getByTestId('fund-sheet')).toBeInTheDocument()
  })
})
