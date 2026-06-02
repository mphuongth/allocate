import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DesktopInsuranceDetail from '../DesktopInsuranceDetail'
import type { InsuranceData } from '../../DashboardClient'

const ins: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 2_500_000,
  savingsProgressPercentage: 20.8,
  status: 'upcoming',
  nextPaymentDate: '2026-08-01',
} as InsuranceData

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/savings')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          entries: [
            { id: 's1', amount: 1_500_000, date: '2026-03-15', kind: 'logged' },
            { id: 'plan-p1', amount: 1_000_000, date: '2026-03-01', kind: 'plan' },
          ],
          totalSaved: 2_500_000,
        }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})

describe('DesktopInsuranceDetail — payment history (issue #223)', () => {
  it('shows the exact logged amount, not a lossy compact value', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(await screen.findByText(/₫\s?1\.500\.000/)).toBeInTheDocument()
    expect(screen.queryByText('1.5M ₫')).not.toBeInTheDocument()
  })

  it('itemizes the auto monthly plan contribution alongside logged payments', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(await screen.findByText('Logged payment')).toBeInTheDocument()
    expect(screen.getByText('Monthly plan')).toBeInTheDocument()
    // logged uses its saved date (15 Mar), plan shows month/year
    expect(screen.getByText('15 Mar 2026')).toBeInTheDocument()
    expect(screen.getByText('Mar 2026')).toBeInTheDocument()
  })

  it('shows a total that reconciles with the Saved amount', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    const total = await screen.findByTestId('insurance-history-total')
    // 1,500,000 + 1,000,000 = 2,500,000 == amountSaved
    expect(total).toHaveTextContent(/₫\s?2\.500\.000/)
  })
})

describe('DesktopInsuranceDetail — coverage round-trips through relationship', () => {
  it('preselects the member’s coverage in the edit form and offers Parent/Other', async () => {
    const parentIns = { ...ins, coverageType: 'Parent' } as InsuranceData
    render(<DesktopInsuranceDetail ins={parentIns} locale="en" onClose={vi.fn()} />)

    // Coverage shown on the header (proves it round-trips, not stuck on Self).
    expect(screen.getByText('Parent')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('insurance-edit-btn'))

    // Full option set available, Husband/Wife folded away.
    for (const label of ['Self', 'Spouse', 'Child', 'Parent', 'Other']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Husband' })).not.toBeInTheDocument()

    // The member's current coverage (Parent) is the selected/active option.
    expect(screen.getByRole('button', { name: 'Parent' })).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    expect(screen.getByRole('button', { name: 'Self' })).not.toHaveStyle({ color: 'rgb(255, 255, 255)' })
  })
})

describe('DesktopInsuranceDetail — paid-for-the-year state (issue #227)', () => {
  afterEach(() => vi.useRealTimers())

  // After mark-paid the backend sets last_payment_date to today, advances the
  // due date a year, and resets savings — so status recomputes to on_track.
  const paidIns: InsuranceData = {
    ...ins,
    status: 'on_track',
    amountSaved: 0,
    savingsProgressPercentage: 0,
    nextPaymentDate: '2027-05-28',
    lastPaymentDate: '2026-05-28',
  } as InsuranceData

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28))
  })

  it('shows a "Paid for <year>" status badge instead of the computed status', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.getByText('Paid for 2026')).toBeInTheDocument()
    // on_track now renders "Not due"; the paid badge replaces it.
    expect(screen.queryByText('Not due')).not.toBeInTheDocument()
  })

  it('shows the "<year> premium settled" confirmation chip', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.getByText('2026 premium settled')).toBeInTheDocument()
  })

  it('reframes the savings block as saving for the next year', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.getByText('Saving for 2027')).toBeInTheDocument()
  })

  it('hides the "Mark as paid" status CTA once paid this year', () => {
    render(<DesktopInsuranceDetail ins={paidIns} locale="en" onClose={vi.fn()} />)
    expect(screen.queryByTestId('insurance-cta-status')).not.toBeInTheDocument()
  })

  it('does NOT show the paid state when the last payment was a previous year', () => {
    const stale: InsuranceData = { ...paidIns, lastPaymentDate: '2025-05-28' } as InsuranceData
    render(<DesktopInsuranceDetail ins={stale} locale="en" onClose={vi.fn()} />)
    expect(screen.queryByText('Paid for 2025')).not.toBeInTheDocument()
    expect(screen.queryByText(/premium settled/)).not.toBeInTheDocument()
  })
})

describe('DesktopInsuranceDetail — settle via the payment modal', () => {
  // The status CTA opens the editable payment modal (like the design). The
  // overdue case must reach a modal that, on confirm, settles via mark-paid.
  it('opens the payment modal in settle mode when the overdue CTA is clicked', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const overdue = { ...ins, status: 'overdue' } as InsuranceData

    render(<DesktopInsuranceDetail ins={overdue} locale="en" onClose={vi.fn()} onChanged={vi.fn()} />)

    // Clicking the CTA opens the modal in settle mode (it does NOT settle on its own).
    fireEvent.click(screen.getByTestId('insurance-cta-status'))
    expect(screen.getByTestId('log-payment-modal')).toBeInTheDocument()
    expect(screen.getByText(/transferred the .* premium to the insurer/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/mark-paid'),
      expect.anything()
    )
  })

  it('settles via mark-paid when the modal is confirmed', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/savings')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [], totalSaved: 0 }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()
    const overdue = { ...ins, status: 'overdue' } as InsuranceData

    render(<DesktopInsuranceDetail ins={overdue} locale="en" onClose={vi.fn()} onChanged={onChanged} />)

    fireEvent.click(screen.getByTestId('insurance-cta-status'))
    // Settle mode has no amount — confirm directly.
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/insurance-members/ins-1/mark-paid'),
        expect.objectContaining({ method: 'POST' })
      )
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })
})
