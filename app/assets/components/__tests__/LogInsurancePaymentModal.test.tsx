import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogInsurancePaymentModal from '../LogInsurancePaymentModal'
import type { InsuranceData } from '@/features/dashboard/contracts'
import { todayIso } from '@/lib/dates'

const ins: InsuranceData = {
  insuranceId: 'ins-1',
  insuranceName: 'John Doe',
  coverageType: 'Self',
  annualPremium: 12_000_000,
  amountSaved: 0,
  savingsProgressPercentage: 0,
  status: 'overdue',
  nextPaymentDate: null,
} as InsuranceData

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'x' }) }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('LogInsurancePaymentModal (issue #223)', () => {
  // The date defaults to the business day (Asia/Ho_Chi_Minh), not the browser's
  // local one — otherwise a contribution logged abroad, or in a UTC browser
  // between 00:00 and 06:59 Vietnam time, is filed under the wrong day (#591).
  it('posts the amount and the business saved_date', async () => {
    render(<LogInsurancePaymentModal open ins={ins} locale="en" onClose={vi.fn()} onSaved={vi.fn()} />)

    await userEvent.type(screen.getByRole('textbox'), '1500000')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/insurance-savings')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.amount_saved_vnd).toBe(1_500_000)

    const expected = todayIso()
    expect(body.saved_date).toBe(expected)
  })
})

describe('LogInsurancePaymentModal — iOS zoom guard (issue #265)', () => {
  // iOS Safari zooms when a focused native field is < 16px. The amount input
  // must render at >= 16px on mobile.
  it('renders the amount input at >=16px', () => {
    render(<LogInsurancePaymentModal open ins={ins} locale="en" onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16)
  })
})

describe('LogInsurancePaymentModal — settle mode', () => {
  // In settle mode the modal confirms a premium payment: it calls mark-paid
  // (which advances the cycle and records the settlement) rather than logging a
  // savings contribution. The chosen date is sent as paid_date.
  it('calls mark-paid with the chosen paid_date instead of logging savings', async () => {
    render(<LogInsurancePaymentModal open settle ins={ins} locale="en" onClose={vi.fn()} onSaved={vi.fn()} />)

    // Settle mode has no amount to enter — confirm directly.
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/insurance-members/ins-1/mark-paid')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    const expected = todayIso()
    expect(body.paid_date).toBe(expected)
  })
})
