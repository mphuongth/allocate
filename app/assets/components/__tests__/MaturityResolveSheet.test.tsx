import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaturityResolveBody } from '../MaturityResolveSheet'
import { addMonths, monthsBetween, allocateCumulative } from '@/lib/maturity'
import { fmt } from '@/lib/formatters'
import type { InvRow } from '../goalDetailShared'

// A YYYY-MM-DD string `n` days from today (deterministic regardless of run date).
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
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
  it('previews the rolled-up principal and a maturity measured from the OLD maturity date', () => {
    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    // Default mode is principal + interest: 35,000,000 + (37,030,000 − 35,000,000) = 37,030,000
    expect(screen.getByTestId('maturity-new-principal').textContent).toContain(fmt(37_030_000))
    // New term extends from the OLD maturity date (not today), even when overdue,
    // so an overdue book's next cycle lands at old-maturity + term — not today + term.
    const expectedMaturity = addMonths(maturedDeposit.expiryDate!, 12)
    expect((screen.getByTestId('maturity-date-input') as HTMLInputElement).value).toBe(expectedMaturity)
    expect(screen.getByTestId('maturity-new-date').textContent).toContain(expectedMaturity.slice(0, 4))
  })

  it('renews via the renew route, anchoring the new cycle to the old maturity date', async () => {
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
      // New maturity = old maturity + term (overdue days are NOT skipped forward).
      expiry_date: addMonths(maturedDeposit.expiryDate!, 12),
      // Accrual base = the OLD maturity date, so the new cycle's interest does not
      // lose the days the book sat overdue. (≤ tomorrow, so never future-rejected.)
      investment_date: maturedDeposit.expiryDate,
      interest_earned_vnd: 2_030_000, // realized interest (value − principal) recorded permanently
    })
  })

  it('lets the user override the new maturity date and freezes it from the term', async () => {
    const user = userEvent.setup()
    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    const dateInput = screen.getByTestId('maturity-date-input') as HTMLInputElement
    // Defaults to old maturity + the (12-month fallback) term.
    expect(dateInput.value).toBe(addMonths(maturedDeposit.expiryDate!, 12))

    // Manual edit freezes the date — changing the term no longer moves it.
    fireEvent.change(dateInput, { target: { value: '2027-03-15' } })
    expect(dateInput.value).toBe('2027-03-15')
    fireEvent.change(screen.getByTestId('maturity-term-input'), { target: { value: '6' } })
    expect(dateInput.value).toBe('2027-03-15')

    // Reset re-couples the date to the term (now 6 months from the old maturity).
    await user.click(screen.getByRole('button', { name: /Reset|Đặt lại/i }))
    expect(dateInput.value).toBe(addMonths(maturedDeposit.expiryDate!, 6))
  })

  it('sends the manually edited maturity date through to the renew route', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    fireEvent.change(screen.getByTestId('maturity-date-input'), { target: { value: '2027-03-15' } })
    await user.click(screen.getByRole('button', { name: /Confirm renewal/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      expiry_date: '2027-03-15',
      investment_date: maturedDeposit.expiryDate, // still anchored to the old maturity
    })
  })

  it('blocks confirm when the new maturity is not after the old maturity date', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    // Equal to the old maturity → zero-length cycle, must be rejected.
    fireEvent.change(screen.getByTestId('maturity-date-input'), { target: { value: maturedDeposit.expiryDate! } })

    const confirm = screen.getByRole('button', { name: /Confirm renewal/i })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(fetchMock).not.toHaveBeenCalled()
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

  // ── Merge-on-renew: fold sibling bank deposits into the re-deposit ──────────
  // With goalId wired the body fetches the goal's recurring savings; we stub an
  // empty list so combine is reached via mergeable siblings (not a recurring),
  // which is also the inert default for the other suites that omit goalId.
  describe('merge sibling deposits', () => {
    function stubEmptyRecurring() {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.startsWith('/api/v1/recurring-savings')) {
          return Promise.resolve({ ok: true, json: async () => ({ savings: [] }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    const sibBank: InvRow = {
      id: 'sib-bank', name: 'Vikki sibling', type: 'bank', value: 8_000_000, gainPct: null,
      units: null, principal: 8_000_000, interestRate: 6, expiryDate: daysFromNow(40),
      investmentDate: daysFromNow(-150), fund: null,
    }
    const sibBank2: InvRow = {
      id: 'sib-bank-2', name: 'PVCombank sibling', type: 'bank', value: 4_000_000, gainPct: null,
      units: null, principal: 4_000_000, interestRate: 5, expiryDate: daysFromNow(60),
      investmentDate: daysFromNow(-100), fund: null,
    }
    const sibBook: InvRow = {
      id: 'sib-book', name: 'Accumulating book', type: 'bank', value: 5_000_000, gainPct: null,
      units: null, principal: 5_000_000, interestRate: 6, expiryDate: daysFromNow(30),
      investmentDate: daysFromNow(-90), fund: null, depositGroupId: 'book-1',
    }
    const sibStock: InvRow = {
      id: 'sib-stock', name: 'VNM', type: 'stock', value: 3_000_000, gainPct: 2,
      units: 100, principal: 3_000_000, interestRate: null, expiryDate: null,
      investmentDate: daysFromNow(-80), fund: null,
    }

    it('lists only same-goal non-book bank siblings (excludes self, books, non-bank)', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1"
          siblingDeposits={[maturedDeposit, sibBank, sibBook, sibStock]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      // Enter combine (available because there is a mergeable sibling).
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))

      expect(screen.getByTestId('merge-source-sib-bank')).toBeTruthy()
      expect(screen.queryByTestId('merge-source-tx-bank-1')).toBeNull()   // self (D) excluded
      expect(screen.queryByTestId('merge-source-sib-book')).toBeNull()    // accumulating book excluded
      expect(screen.queryByTestId('merge-source-sib-stock')).toBeNull()   // non-bank excluded
    })

    it('prefills each selected source with its current value and shows the penalty caption', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1" siblingDeposits={[sibBank]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      expect(screen.queryByTestId('merge-penalty-caption')).toBeNull() // hidden until a source is picked

      await user.click(screen.getByTestId('merge-source-sib-bank'))
      expect((screen.getByTestId('merge-received-sib-bank') as HTMLInputElement).value).toBe('8000000')
      expect(screen.getByTestId('merge-penalty-caption')).toBeTruthy()
    })

    it('splits the editable total across selected sources via allocateCumulative', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1" siblingDeposits={[sibBank, sibBank2]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      // Select both (ordered by investmentDate, id → sib-bank-2 opened later? -100 > -150 → sib-bank first).
      await user.click(screen.getByTestId('merge-source-sib-bank'))
      await user.click(screen.getByTestId('merge-source-sib-bank-2'))

      fireEvent.change(screen.getByTestId('merge-total'), { target: { value: '10000000' } })

      // Weights ordered by (investmentDate, id): sib-bank (−150d) then sib-bank-2 (−100d).
      const [a1, a2] = allocateCumulative(10_000_000, [8_000_000, 4_000_000])
      expect((screen.getByTestId('merge-received-sib-bank') as HTMLInputElement).value).toBe(String(a1))
      expect((screen.getByTestId('merge-received-sib-bank-2') as HTMLInputElement).value).toBe(String(a2))
    })

    it('previews base + Σreceived but submits amount_vnd == BASE plus merge_sources', async () => {
      const user = userEvent.setup()
      const fetchMock = stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1" siblingDeposits={[sibBank]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-source-sib-bank'))

      // BASE = principal + interest + recurring(0) = 35,000,000 + 2,030,000.
      const BASE = 37_030_000
      const received = 8_000_000
      // Preview principal includes the merged cash.
      expect(screen.getByTestId('maturity-new-principal').textContent).toContain(fmt(BASE + received))

      await user.click(screen.getByRole('button', { name: /Save new deposit/i }))
      await waitFor(() => {
        const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))
        expect(renewCall).toBeTruthy()
      })
      const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))!
      const body = JSON.parse(renewCall[1].body)
      expect(body.amount_vnd).toBe(BASE) // BASE only — the RPC adds Σreceived
      expect(body.merge_sources).toEqual([{ tx_id: 'sib-bank', received }])
    })
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
