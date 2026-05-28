import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DesktopInsuranceDetail from '../DesktopInsuranceDetail'
import type { InsuranceData } from '../../DashboardClient'

const ins: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 6_000_000,
  savingsProgressPercentage: 50,
  status: 'upcoming',
  nextPaymentDate: '2026-08-01',
} as InsuranceData

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/savings')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          savings: [
            // saved_date intentionally differs from created_at's day to prove
            // the row uses saved_date, not the created_at timestamp.
            { id: 's1', amount_saved_vnd: 1_500_000, saved_date: '2026-03-15', created_at: '2026-05-27T10:00:00+00:00' },
          ],
        }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
})

describe('DesktopInsuranceDetail — payment history (issue #223)', () => {
  it('shows the exact logged amount, not a lossy compact value', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    // exact: ₫ 1.500.000 (vi-VN grouping); NOT the compact "1.5M ₫"
    expect(await screen.findByText(/₫\s?1\.500\.000/)).toBeInTheDocument()
    expect(screen.queryByText('1.5M ₫')).not.toBeInTheDocument()
  })

  it('shows the saved_date for the entry, not the created_at timestamp', async () => {
    render(<DesktopInsuranceDetail ins={ins} locale="en" onClose={vi.fn()} />)
    expect(await screen.findByText('15 Mar 2026')).toBeInTheDocument()
    expect(screen.queryByText(/27 May 2026/)).not.toBeInTheDocument()
  })
})
