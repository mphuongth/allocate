import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InsuranceDetailSheet from '../InsuranceDetailSheet'
import type { InsuranceData } from '@/features/dashboard/contracts'

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

// Guard for #688. The sheet covers the whole screen, so a keyboard user who
// could still Tab into the page underneath had no way of knowing they had left
// it — and nothing announced the overlay as a modal at all.
describe('InsuranceDetailSheet — dialog contract (#688)', () => {
  const ins = {
    insuranceId: 'i1', insuranceName: 'Manulife', coverageType: 'life',
    annualPremium: 12_000_000, amountSaved: 3_000_000, savingsProgressPercentage: 25,
    status: 'on_track' as const, nextPaymentDate: '2026-09-01', lastPaymentDate: null,
  }

  it('is a modal dialog named by the policy it shows', () => {
    render(<InsuranceDetailSheet ins={ins} open locale="en" onClose={() => {}} />)

    const dialog = screen.getByRole('dialog', { name: 'Manulife' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toBe(screen.getByTestId('insurance-detail-sheet'))
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<InsuranceDetailSheet ins={ins} open locale="en" onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus into the sheet on open', () => {
    render(<InsuranceDetailSheet ins={ins} open locale="en" onClose={() => {}} />)

    expect(screen.getByTestId('insurance-detail-sheet')).toContainElement(document.activeElement as HTMLElement)
  })
})
