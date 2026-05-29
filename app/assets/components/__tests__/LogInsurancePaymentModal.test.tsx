import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LogInsurancePaymentModal from '../LogInsurancePaymentModal'
import type { InsuranceData } from '../../DashboardClient'

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
  it('posts the amount and the local saved_date', async () => {
    render(<LogInsurancePaymentModal open ins={ins} locale="en" onClose={vi.fn()} onSaved={vi.fn()} />)

    await userEvent.type(screen.getByRole('textbox'), '1500000')
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/insurance-savings')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.amount_saved_vnd).toBe(1_500_000)

    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(body.saved_date).toBe(expected)
  })
})

describe('LogInsurancePaymentModal — settle mode', () => {
  // In settle mode the modal confirms a premium payment: it calls mark-paid
  // (which advances the cycle and records the settlement) rather than logging a
  // savings contribution. The chosen date is sent as paid_date.
  it('calls mark-paid with the chosen paid_date instead of logging savings', async () => {
    render(<LogInsurancePaymentModal open settle ins={ins} locale="en" onClose={vi.fn()} onSaved={vi.fn()} />)

    // Fill the amount via the Suggested shortcut so Confirm is enabled.
    await userEvent.click(screen.getByRole('button', { name: /suggested/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/insurance-members/ins-1/mark-paid')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(body.paid_date).toBe(expected)
  })
})
