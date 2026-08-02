import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
vi.mock('@/app/components/navigation/NavigationContext', () => ({ useNavigation: () => ({ setMobileTopBar: vi.fn() }) }))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1', name: 'VFMVF1 Equity Fund', code: 'VFMVF1', fund_type: 'equity', nav: 36120,
    nav_source_url: null, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
  }
}
function Harness() {
  const [funds, setFunds] = useState([makeFund()])
  return <MobileFundLibraryView {...useFundsBusy()} funds={funds} setFunds={setFunds} goals={[]} loading={false} error={false} reload={() => Promise.resolve()} />
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('MobileFundLibraryView — sheet a11y (Esc)', () => {
  it('Escape closes the edit sheet', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('editFund'))
    expect(screen.getByTestId('fund-sheet')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('fund-sheet')).not.toBeInTheDocument())
  })
})

// The bottom sheets had focus-trap (useDialogA11y) but no dialog semantics — no
// role="dialog"/aria-modal/aria-label — so AT didn't announce them as modals.
describe('MobileFundLibraryView — sheet dialog semantics + names', () => {
  it('the edit sheet is a role=dialog named by its title', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('editFund'))
    expect(screen.getByRole('dialog', { name: 'editModal' })).toBeInTheDocument()
  })

  it('the delete sheet is a role=dialog with an accessible name', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('deleteBtn'))
    const sheet = screen.getByTestId('delete-fund-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet.getAttribute('aria-label')).toBeTruthy()
  })
})
