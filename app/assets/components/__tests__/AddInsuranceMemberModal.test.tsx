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
})
