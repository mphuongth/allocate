import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsuranceCard from '../InsuranceCard'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars && 'year' in vars ? `${key}:${vars.year}` : key,
}))

const baseProps = {
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

describe('InsuranceCard — paid-for-the-year badge (issue #227)', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28))
  })

  it('shows the "Paid for <year>" badge when the last payment is in the current year', () => {
    render(<InsuranceCard {...baseProps} status="on_track" lastPaymentDate="2026-05-28" />)
    expect(screen.getByText('statusPaidForYear:2026')).toBeInTheDocument()
    // on_track maps to statusNotDue; the paid badge replaces it.
    expect(screen.queryByText('statusNotDue')).not.toBeInTheDocument()
  })

  it('falls back to the computed status when not paid this year', () => {
    render(<InsuranceCard {...baseProps} status="on_track" lastPaymentDate="2025-05-28" />)
    expect(screen.getByText('statusNotDue')).toBeInTheDocument()
    expect(screen.queryByText(/statusPaidForYear/)).not.toBeInTheDocument()
  })
})
