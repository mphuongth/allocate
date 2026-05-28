import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsuranceCard from '../InsuranceCard'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const baseProps = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 6_000_000,
  savingsProgressPercentage: 50,
  status: 'on_track' as const,
}

describe('InsuranceCard — tappable on mobile (issue #222)', () => {
  it('calls onClick when the row is tapped', async () => {
    const onClick = vi.fn()
    render(<InsuranceCard {...baseProps} onClick={onClick} />)
    await userEvent.click(screen.getByText('John Doe'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('exposes the row as an interactive button when onClick is provided', () => {
    render(<InsuranceCard {...baseProps} onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /john doe/i })).toBeInTheDocument()
  })
})
