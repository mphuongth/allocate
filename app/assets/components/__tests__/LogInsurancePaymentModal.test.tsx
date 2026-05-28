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
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.amount_saved_vnd).toBe(1_500_000)

    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(body.saved_date).toBe(expected)
  })
})
