import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.queryByText('Due soon')).not.toBeInTheDocument()
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
