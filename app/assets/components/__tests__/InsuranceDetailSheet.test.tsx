import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsuranceDetailSheet from '../InsuranceDetailSheet'
import type { InsuranceData } from '../../DashboardClient'

const ins: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 6_000_000,
  savingsProgressPercentage: 50,
  status: 'on_track',
  nextPaymentDate: '2026-08-01',
} as InsuranceData

beforeEach(() => {
  document.body.style.overflow = ''
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ savings: [] }) })))
})

describe('InsuranceDetailSheet (issue #222)', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <InsuranceDetailSheet ins={ins} open={false} locale="en" onClose={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the insurance member details when open', () => {
    render(<InsuranceDetailSheet ins={ins} open locale="en" onClose={vi.fn()} />)
    expect(screen.getByTestId('insurance-detail-sheet')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    // KPI details from DesktopInsuranceDetail
    expect(screen.getByText('Annual premium')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
})
