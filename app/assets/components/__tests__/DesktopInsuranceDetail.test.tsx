import { describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('DesktopInsuranceDetail — overdue can be settled', () => {
  // An overdue policy must be able to settle the missed renewal. The CTA now
  // calls mark-paid (advances the cycle + records the payment) rather than only
  // opening the savings log, which never settled the premium.
  it('settles via mark-paid when the overdue CTA is clicked', async () => {
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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/insurance-members/ins-1/mark-paid'),
        expect.objectContaining({ method: 'POST' })
      )
    )
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    // Overdue no longer routes to the savings-only log modal.
    expect(screen.queryByTestId('log-payment-modal')).not.toBeInTheDocument()
  })
})
