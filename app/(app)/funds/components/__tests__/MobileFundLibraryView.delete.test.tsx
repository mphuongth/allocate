import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobileFundLibraryView from '../MobileFundLibraryView'
import type { Fund } from '../useFundsData'

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
function Harness({ reload }: { reload: () => Promise<void> }) {
  const [funds, setFunds] = useState([makeFund()])
  return <MobileFundLibraryView funds={funds} setFunds={setFunds} goals={[]} loading={false} error={false} reload={reload} />
}

let reload: ReturnType<typeof vi.fn>
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => { reload = vi.fn(() => Promise.resolve()) })

describe('MobileFundLibraryView — delete of an in-use fund is hard-blocked with a clear message (#1)', () => {
  it('shows the in-use message and does NOT reload when the API returns 409', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ code: 'fund_in_use' }) })))
    render(<Harness reload={reload} />)
    await userEvent.click(screen.getByLabelText('deleteBtn'))
    const sheet = screen.getByTestId('delete-fund-sheet')
    await userEvent.click(within(sheet).getByRole('button', { name: 'delete' }))

    expect(await screen.findByText('toastDeleteInUse')).toBeInTheDocument()
    expect(screen.queryByText('toastDeleted')).not.toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
  })

  it('a normal (204) delete still reloads and reports success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) })))
    render(<Harness reload={reload} />)
    await userEvent.click(screen.getByLabelText('deleteBtn'))
    const sheet = screen.getByTestId('delete-fund-sheet')
    await userEvent.click(within(sheet).getByRole('button', { name: 'delete' }))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(await screen.findByText('toastDeleted')).toBeInTheDocument()
  })
})
