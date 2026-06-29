import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
function Harness() {
  const [funds, setFunds] = useState([makeFund()])
  return <DesktopFundLibraryView funds={funds} setFunds={setFunds} goals={[]} loading={false} error={false} reload={() => Promise.resolve()} />
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))) })
afterEach(() => vi.unstubAllGlobals())

describe('DesktopFundLibraryView — dialog a11y (Esc + focus)', () => {
  it('Escape closes the Add/Edit form modal', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'add' }))
    expect(screen.getByTestId('fund-modal')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('fund-modal')).not.toBeInTheDocument())
  })

  it('Escape closes the delete modal, and focus moves into it on open', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByTestId('fund-delete-btn'))
    const modal = screen.getByTestId('delete-fund-modal')
    await waitFor(() => expect(modal.contains(document.activeElement)).toBe(true))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('delete-fund-modal')).not.toBeInTheDocument())
  })
})
