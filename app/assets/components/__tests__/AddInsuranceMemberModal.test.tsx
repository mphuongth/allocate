import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddInsuranceMemberModal from '../AddInsuranceMemberModal'

describe('AddInsuranceMemberModal — responsive presentation', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AddInsuranceMemberModal open={false} onClose={vi.fn()} locale="en" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('presents as a centered modal on desktop', () => {
    render(<AddInsuranceMemberModal open onClose={vi.fn()} locale="en" desktop />)
    const overlay = screen.getByTestId('add-insurance-modal')
    expect(overlay).toHaveStyle({ alignItems: 'center' })
    expect(screen.queryByTestId('add-insurance-sheet-handle')).not.toBeInTheDocument()
  })

  it('presents as a bottom sheet on mobile (desktop falsy)', () => {
    render(<AddInsuranceMemberModal open onClose={vi.fn()} locale="en" />)
    const overlay = screen.getByTestId('add-insurance-modal')
    expect(overlay).toHaveStyle({ alignItems: 'flex-end' })
    // bottom sheets carry a drag handle
    expect(screen.getByTestId('add-insurance-sheet-handle')).toBeInTheDocument()
  })

  it('shows the form fields in both presentations', () => {
    render(<AddInsuranceMemberModal open onClose={vi.fn()} locale="en" />)
    expect(screen.getByText('Add insurance member')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument()
  })

  it('labels the relationship picker and the payment-date field accurately (not "Coverage type"/"Start date")', () => {
    render(<AddInsuranceMemberModal open onClose={vi.fn()} locale="en" />)
    // The picker holds relationships (Self/Spouse/Parent…), not coverage tiers.
    expect(screen.getByText('Relationship')).toBeInTheDocument()
    expect(screen.queryByText('Coverage type')).not.toBeInTheDocument()
    // The date is the annual premium due date, not a policy start date.
    expect(screen.getByText('Payment date')).toBeInTheDocument()
    expect(screen.queryByText('Start date')).not.toBeInTheDocument()
  })

  it('offers the full relationship set including Parent and Other (no Husband/Wife)', () => {
    render(<AddInsuranceMemberModal open onClose={vi.fn()} locale="en" />)
    for (const label of ['Self', 'Spouse', 'Child', 'Parent', 'Other']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Husband' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Wife' })).not.toBeInTheDocument()
  })
})
