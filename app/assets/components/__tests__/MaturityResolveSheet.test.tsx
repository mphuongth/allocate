import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaturityResolveBody } from '../MaturityResolveSheet'
import { addMonths, monthsBetween } from '@/lib/maturity'
import { fmt } from '@/lib/formatters'
import type { InvRow } from '../goalDetailShared'

// A YYYY-MM-DD string `n` days from today (deterministic regardless of run date).
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const today = () => daysFromNow(0)

// A matured term deposit: value (compounded) > principal, expiry in the past.
const maturedDeposit: InvRow = {
  id: 'tx-bank-1',
  name: 'TCB Term Deposit',
  type: 'bank',
  value: 37_030_000,
  gainPct: 5.8,
  units: null,
  principal: 35_000_000,
  interestRate: 5.8,
  expiryDate: daysFromNow(-12), // already matured
  investmentDate: null,         // no stored open date → term falls back to 12
  fund: null,
}

afterEach(() => vi.restoreAllMocks())

describe('MaturityResolveBody', () => {
  it('previews the rolled-up principal and a future maturity for principal + interest', () => {
    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    // Default mode is principal + interest: 35,000,000 + (37,030,000 − 35,000,000) = 37,030,000
    expect(screen.getByTestId('maturity-new-principal').textContent).toContain(fmt(37_030_000))
    // Matured → new term extends from today (12 months default), always in the future.
    const expectedMaturity = addMonths(today(), 12)
    expect(screen.getByTestId('maturity-new-date').textContent).toContain(expectedMaturity.slice(0, 4))
  })

  it('renews via the renew route that rolls the deposit forward from today', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: /Confirm renewal/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/investment-transactions/tx-bank-1/renew')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toMatchObject({
      amount_vnd: 37_030_000,
      interest_rate: 5.8,
      expiry_date: addMonths(today(), 12), // new maturity from today (matured)
      investment_date: today(),            // accrual reset, never future-dated
    })
  })

  it('suggests the original term length derived from the open + maturity dates', () => {
    const deposit: InvRow = { ...maturedDeposit, investmentDate: daysFromNow(-190), expiryDate: daysFromNow(-7) }
    const expectedTerm = monthsBetween(deposit.investmentDate!, deposit.expiryDate!)
    render(
      <MaturityResolveBody inv={deposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    expect((screen.getByTestId('maturity-term-input') as HTMLInputElement).value).toBe(String(expectedTerm))
  })

  it('disables Confirm and never writes 0₫ when the change-amount field is cleared', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    await user.click(screen.getByRole('button', { name: /Change amount/i }))
    await user.clear(screen.getByTestId('maturity-new-amount'))

    const confirm = screen.getByRole('button', { name: /Confirm renewal/i })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hands off to the existing withdraw flow instead of renewing', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    const onWithdraw = vi.fn()
    const onClose = vi.fn()

    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={onClose} onRenewed={() => {}} onWithdraw={onWithdraw} />,
    )
    await user.click(screen.getByRole('button', { name: /Don.t renew/i }))
    await user.click(screen.getByRole('button', { name: /Mark for withdrawal/i }))

    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(onWithdraw).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
