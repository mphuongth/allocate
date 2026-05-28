import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DesktopInsuranceList from '../DesktopInsuranceList'
import type { InsuranceData } from '../../DashboardClient'

const member: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 0,
  savingsProgressPercentage: 0,
  status: 'on_track',
  nextPaymentDate: '2027-05-28',
  lastPaymentDate: '2026-05-28',
}

describe('DesktopInsuranceList — paid-for-the-year badge (issue #227)', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28))
  })

  it('shows "Paid for <year>" when the last payment is in the current year', () => {
    render(<DesktopInsuranceList insurance={[member]} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('Paid for 2026')).toBeInTheDocument()
    expect(screen.queryByText('Due soon')).not.toBeInTheDocument()
  })

  it('shows the computed status when not paid this year', () => {
    const stale = { ...member, lastPaymentDate: '2025-05-28' }
    render(<DesktopInsuranceList insurance={[stale]} locale="en" onOpen={vi.fn()} onAdd={vi.fn()} />)
    expect(screen.getByText('Due soon')).toBeInTheDocument()
    expect(screen.queryByText(/Paid for/)).not.toBeInTheDocument()
  })
})
