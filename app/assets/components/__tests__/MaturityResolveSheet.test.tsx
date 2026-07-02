import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaturityResolveBody } from '../MaturityResolveSheet'
import { addMonths, monthsBetween, allocateCumulative } from '@/lib/maturity'
import { fmt } from '@/lib/formatters'
import { SUCCESS_FLASH_MS } from '../../successFlash'
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

  it('blocks renewal for a not-yet-matured deposit (wider reminder window) and shows a hint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    // Maturing in 5 days: surfaced by the 7-day reminder window, but its new cycle
    // would start on that future date — which the renew route/RPC reject. Renewal
    // is gated; the user records it at maturity.
    const earlyDeposit: InvRow = { ...maturedDeposit, id: 'tx-early', expiryDate: daysFromNow(5) }
    const user = userEvent.setup()
    render(
      <MaturityResolveBody inv={earlyDeposit} isVi onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )

    expect(screen.getByTestId('maturity-too-early-hint').textContent).toContain('còn 5 ngày')
    const confirm = screen.getByRole('button', { name: /Xác nhận tái tục|Confirm renewal/i })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still allows renewal for a deposit maturing tomorrow (within the route tolerance)', () => {
    const tomorrowDeposit: InvRow = { ...maturedDeposit, id: 'tx-tmrw', expiryDate: daysFromNow(1) }
    render(
      <MaturityResolveBody inv={tomorrowDeposit} isVi onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
    )
    expect(screen.queryByTestId('maturity-too-early-hint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Xác nhận tái tục|Confirm renewal/i })).not.toBeDisabled()
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

    it('formats the re-deposit amount with thousands separators', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1" siblingDeposits={[sibBank]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      // Default = principal + interest + recurring(0) = 37,030,000, shown grouped.
      expect((screen.getByTestId('maturity-redeposit') as HTMLInputElement).value).toBe('37,030,000')
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

      // sibBank matures far past the anchor → out of window, folded in via override.
      await user.click(screen.getByTestId('merge-override-sib-bank'))
      // Money fields render thousands separators (user-visible), not the raw digits.
      expect((screen.getByTestId('merge-received-sib-bank') as HTMLInputElement).value).toBe('8,000,000')
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
      // Both mature far past the anchor → out of window, folded in via override.
      // (Ordered by investmentDate, id → sib-bank −150d before sib-bank-2 −100d.)
      await user.click(screen.getByTestId('merge-override-sib-bank'))
      await user.click(screen.getByTestId('merge-override-sib-bank-2'))

      fireEvent.change(screen.getByTestId('merge-total'), { target: { value: '10000000' } })

      // Weights ordered by (investmentDate, id): sib-bank (−150d) then sib-bank-2 (−100d).
      const [a1, a2] = allocateCumulative(10_000_000, [8_000_000, 4_000_000])
      expect((screen.getByTestId('merge-received-sib-bank') as HTMLInputElement).value).toBe(a1.toLocaleString('en-US'))
      expect((screen.getByTestId('merge-received-sib-bank-2') as HTMLInputElement).value).toBe(a2.toLocaleString('en-US'))
    })

    it('previews base + Σreceived but submits amount_vnd == BASE plus merge_sources', async () => {
      const user = userEvent.setup()
      const fetchMock = stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1" siblingDeposits={[sibBank]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-override-sib-bank'))

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

  // ── Multi-source merge UX (PR1) ─────────────────────────────────────────────
  // Destination bank picker, "Gộp nhiều nguồn" label + provenance when >1 source,
  // and the success state listing what was folded in.
  describe('multi-source merge UX', () => {
    const BANKS = [
      { code: 'TCB', name: 'Techcombank' },
      { code: 'VCB', name: 'Vietcombank' },
      { code: 'MB', name: 'MB Bank' },
    ]
    function stubBanksAndRecurring() {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.startsWith('/api/v1/recurring-savings')) {
          return Promise.resolve({ ok: true, json: async () => ({ savings: [] }) })
        }
        if (typeof url === 'string' && url.startsWith('/api/v1/banks')) {
          // The real route returns a bare array of { code, name, logo_url }.
          return Promise.resolve({ ok: true, json: async () => BANKS })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    // Anchor (D) sits at TCB; siblings at VCB / MB / no-bank.
    const anchorTCB: InvRow = { ...maturedDeposit, bankCode: 'TCB' }
    const sibVCB: InvRow = {
      id: 'sib-vcb', name: 'Vikki VCB', type: 'bank', value: 8_000_000, gainPct: null,
      units: null, principal: 8_000_000, interestRate: 6, expiryDate: daysFromNow(40),
      investmentDate: daysFromNow(-150), fund: null, bankCode: 'VCB',
    }
    const sibMB: InvRow = {
      id: 'sib-mb', name: 'PVCombank MB', type: 'bank', value: 4_000_000, gainPct: null,
      units: null, principal: 4_000_000, interestRate: 5, expiryDate: daysFromNow(60),
      investmentDate: daysFromNow(-100), fund: null, bankCode: 'MB',
    }
    const sibNoBank: InvRow = {
      id: 'sib-nobank', name: 'Legacy no bank', type: 'bank', value: 3_000_000, gainPct: null,
      units: null, principal: 3_000_000, interestRate: 5, expiryDate: daysFromNow(50),
      investmentDate: daysFromNow(-120), fund: null, bankCode: null,
    }

    it('shows a destination bank picker defaulting to the anchor bank once a source is selected', async () => {
      const user = userEvent.setup()
      stubBanksAndRecurring()
      render(
        <MaturityResolveBody inv={anchorTCB} goalId="goal-1" siblingDeposits={[anchorTCB, sibVCB]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      expect(screen.queryByTestId('merge-dest-bank')).toBeNull() // hidden until a source is picked
      await user.click(screen.getByTestId('merge-override-sib-vcb'))
      const sel = (await screen.findByTestId('merge-dest-bank')) as HTMLSelectElement
      expect(sel.value).toBe('TCB') // defaults to the settling deposit's bank
    })

    it('labels the section "Merge multiple sources" and shows provenance only when >1 source is selected', async () => {
      const user = userEvent.setup()
      stubBanksAndRecurring()
      render(
        <MaturityResolveBody inv={anchorTCB} goalId="goal-1" siblingDeposits={[anchorTCB, sibVCB, sibMB]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-override-sib-vcb'))
      // One source folded → 2 deposits combine, but the "multiple sources" label
      // only kicks in past one selected sibling.
      expect(screen.getByTestId('merge-section-title').textContent).toMatch(/Merge other deposits/i)

      await user.click(screen.getByTestId('merge-override-sib-mb'))
      expect(screen.getByTestId('merge-section-title').textContent).toMatch(/Merge multiple sources/i)
      // Provenance counts the anchor + folded sources (3) and their distinct banks
      // (TCB, VCB, MB = 3).
      const prov = screen.getByTestId('merge-provenance').textContent ?? ''
      expect(prov).toMatch(/3 sources/i)
      expect(prov).toMatch(/3 banks/i)
    })

    it('excludes NULL-bank sources from the bank count and submits the chosen destination bank_code', async () => {
      const user = userEvent.setup()
      const fetchMock = stubBanksAndRecurring()
      render(
        <MaturityResolveBody inv={anchorTCB} goalId="goal-1" siblingDeposits={[anchorTCB, sibVCB, sibNoBank]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-override-sib-vcb'))
      await user.click(screen.getByTestId('merge-override-sib-nobank'))
      // 3 sources combine (anchor + 2) but only TCB + VCB are real banks → 2 banks.
      const prov = screen.getByTestId('merge-provenance').textContent ?? ''
      expect(prov).toMatch(/3 sources/i)
      expect(prov).toMatch(/2 banks/i)

      // Move the destination to MB and confirm it rides the request.
      fireEvent.change(screen.getByTestId('merge-dest-bank'), { target: { value: 'MB' } })
      await user.click(screen.getByRole('button', { name: /Save new deposit/i }))
      await waitFor(() => {
        const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))
        expect(renewCall).toBeTruthy()
      })
      const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))!
      expect(JSON.parse(renewCall[1].body).bank_code).toBe('MB')
    })

    it('lists the merged sources in the success state', async () => {
      const user = userEvent.setup()
      stubBanksAndRecurring()
      render(
        <MaturityResolveBody inv={anchorTCB} goalId="goal-1" siblingDeposits={[anchorTCB, sibVCB]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-override-sib-vcb'))
      await user.click(screen.getByRole('button', { name: /Save new deposit/i }))

      const sources = await screen.findByTestId('maturity-renewed-sources')
      expect(sources.textContent).toContain('Vikki VCB')
    })
  })

  // ── Merge eligibility (PR2) ─────────────────────────────────────────────────
  // The window rules: a sibling maturing within N days of the anchor is eligible
  // and PRESELECTED; one maturing further out is blocked + dimmed but can be
  // folded in via a "Gộp sớm?" override; a different-currency / pledged sibling is
  // a HARD block (no override). The window slider re-runs the classification.
  describe('merge eligibility', () => {
    function stubEmptyRecurring() {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.startsWith('/api/v1/recurring-savings')) {
          return Promise.resolve({ ok: true, json: async () => ({ savings: [] }) })
        }
        return Promise.resolve({ ok: true, json: async () => [] })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    // Anchor (D) matured 12 days ago. An in-window sibling matures within 7 days of
    // that; an out-of-window one is the existing far-future fixture.
    const anchor: InvRow = { ...maturedDeposit, bankCode: 'TCB' }
    const sibInWindow: InvRow = {
      id: 'sib-in', name: 'VCB near', type: 'bank', value: 6_000_000, gainPct: null,
      units: null, principal: 6_000_000, interestRate: 6, expiryDate: daysFromNow(-10), // gap 2d
      investmentDate: daysFromNow(-180), fund: null, bankCode: 'VCB',
    }
    const sibOut: InvRow = {
      id: 'sib-out', name: 'MB far', type: 'bank', value: 8_000_000, gainPct: null,
      units: null, principal: 8_000_000, interestRate: 6, expiryDate: daysFromNow(40), // gap 52d
      investmentDate: daysFromNow(-150), fund: null, bankCode: 'MB',
    }

    it('preselects an in-window sibling and dims an out-of-window one behind a "merge early" override', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={anchor} goalId="goal-1" siblingDeposits={[anchor, sibInWindow, sibOut]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))

      // In-window → preselected, so its received field is already shown + prefilled.
      expect((await screen.findByTestId('merge-received-sib-in') as HTMLInputElement).value).toBe('6,000,000')
      // Out-of-window → not selected; offered behind an override, no received field yet.
      expect(screen.getByTestId('merge-override-sib-out')).toBeTruthy()
      expect(screen.queryByTestId('merge-received-sib-out')).toBeNull()
    })

    it('widening the window via the slider reclassifies an out-of-window sibling as eligible', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={anchor} goalId="goal-1" siblingDeposits={[anchor, sibOut]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      expect(screen.getByTestId('merge-override-sib-out')).toBeTruthy()
      expect(screen.queryByTestId('merge-received-sib-out')).toBeNull()

      // Push the window past the 52-day gap → it becomes eligible and auto-selects.
      fireEvent.change(screen.getByTestId('merge-window-slider'), { target: { value: '60' } })
      expect(screen.queryByTestId('merge-override-sib-out')).toBeNull()
      expect((screen.getByTestId('merge-received-sib-out') as HTMLInputElement).value).toBe('8,000,000')
    })

    it('hard-blocks a different-currency sibling with no override', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      const sibUSD: InvRow = { ...sibInWindow, id: 'sib-usd', name: 'USD savings', currency: 'USD' }
      render(
        <MaturityResolveBody inv={anchor} goalId="goal-1" siblingDeposits={[anchor, sibUSD]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))

      const row = await screen.findByTestId('merge-source-sib-usd')
      expect(row.textContent).toMatch(/currency/i)              // reason shown
      expect(screen.queryByTestId('merge-override-sib-usd')).toBeNull()   // not overridable
      expect(screen.queryByTestId('merge-received-sib-usd')).toBeNull()   // not selectable
    })

    it('folds an out-of-window sibling in via the override, prefilling its received cash', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      render(
        <MaturityResolveBody inv={anchor} goalId="goal-1" siblingDeposits={[anchor, sibOut]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-override-sib-out'))

      expect((screen.getByTestId('merge-received-sib-out') as HTMLInputElement).value).toBe('8,000,000')
      // Anchor + the one folded source = 2 sources of provenance.
      expect(screen.getByTestId('merge-provenance').textContent).toMatch(/2 sources/i)
    })
  })

  // ── "Ví chờ gộp" holding pool (PR4) ─────────────────────────────────────────
  // A deposit maturing before a later eligible anchor in the same goal can be
  // settled-with-hold (park the cash for that merge); the anchor's sheet then
  // shows pooled holdings preselected and folds them in as held_sources.
  describe('merge holding pool', () => {
    function stubHold() {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.startsWith('/api/v1/recurring-savings')) {
          return Promise.resolve({ ok: true, json: async () => ({ savings: [] }) })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    // This deposit matured 2 days ago; a sibling in the same goal matures in 3 days
    // (gap 5 ≤ window 7) → an eligible LATER anchor, so the hold fork appears.
    const sourceNow: InvRow = {
      id: 'src', name: 'VCB 3m', type: 'bank', value: 10_500_000, gainPct: null,
      units: null, principal: 10_000_000, interestRate: 6, expiryDate: daysFromNow(-2),
      investmentDate: daysFromNow(-90), fund: null,
    }
    const laterAnchor: InvRow = {
      id: 'anc', name: 'MB 6m', type: 'bank', value: 20_000_000, gainPct: null,
      units: null, principal: 20_000_000, interestRate: 6, expiryDate: daysFromNow(3),
      investmentDate: daysFromNow(-180), fund: null,
    }

    it('nudges, preselects "hold", and posts a held settlement when an eligible later anchor exists', async () => {
      const user = userEvent.setup()
      const fetchMock = stubHold()
      render(
        <MaturityResolveBody inv={sourceNow} goalId="goal-1" siblingDeposits={[laterAnchor]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      // Discoverability nudge names the anchor.
      expect((await screen.findByTestId('maturity-hold-nudge')).textContent).toContain('MB 6m')

      // Enter the withdraw branch → the 2-card fork appears with "hold" preselected.
      await user.click(screen.getByRole('button', { name: /Don.t renew/i }))
      expect(screen.getByTestId('maturity-hold-fork')).toBeTruthy()
      // The received field (hold path) is shown, defaulted to the current value.
      expect((screen.getByTestId('maturity-hold-received') as HTMLInputElement).value).toBe('10,500,000')

      await user.click(screen.getByRole('button', { name: /Confirm hold/i }))
      await waitFor(() => {
        const post = fetchMock.mock.calls.find((c) => c[0] === '/api/v1/investment-transactions' && c[1]?.method === 'POST')
        expect(post).toBeTruthy()
      })
      const post = fetchMock.mock.calls.find((c) => c[0] === '/api/v1/investment-transactions' && c[1]?.method === 'POST')!
      expect(JSON.parse(post[1].body)).toMatchObject({
        transaction_type: 'withdrawal',
        parent_transaction_id: 'src',
        amount_vnd: 10_500_000,
        held_for_merge: true,
        merge_target_goal_id: 'goal-1',
        merge_anchor_inv_id: 'anc',
        affects_progress: true,
      })
    })

    it('shows no hold fork (plain withdraw) when the only siblings mature earlier', async () => {
      const user = userEvent.setup()
      const onWithdraw = vi.fn()
      stubHold()
      const earlierSib: InvRow = { ...laterAnchor, id: 'early', expiryDate: daysFromNow(-9) }
      render(
        <MaturityResolveBody inv={sourceNow} goalId="goal-1" siblingDeposits={[earlierSib]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={onWithdraw} />,
      )
      expect(screen.queryByTestId('maturity-hold-nudge')).toBeNull()
      await user.click(screen.getByRole('button', { name: /Don.t renew/i }))
      expect(screen.queryByTestId('maturity-hold-fork')).toBeNull()
      // Falls through to the plain withdraw hand-off.
      await user.click(screen.getByRole('button', { name: /Mark for withdrawal/i }))
      await waitFor(() => expect(onWithdraw).toHaveBeenCalled())
    })

    it('preselects pooled holdings on the anchor and folds them in as held_sources', async () => {
      const user = userEvent.setup()
      const fetchMock = stubHold()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1"
          heldSiblings={[{ id: 'held-w', name: 'VCB 3m', amount: 8_000_000 }]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      // Opens straight into combine; the pooled holding is listed (preselected).
      const held = await screen.findByTestId('merge-held-held-w')
      expect(held.textContent).toContain('VCB 3m')
      // Preview folds the held cash into the new principal (BASE 37.03M + 8M).
      expect(screen.getByTestId('maturity-new-principal').textContent).toContain(fmt(37_030_000 + 8_000_000))

      await user.click(screen.getByRole('button', { name: /Save new deposit/i }))
      await waitFor(() => {
        const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))
        expect(renewCall).toBeTruthy()
      })
      const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))!
      const body = JSON.parse(renewCall[1].body)
      expect(body.amount_vnd).toBe(37_030_000) // BASE only — the RPC adds the held cash
      expect(body.held_sources).toEqual(['held-w'])
    })

    it('deselecting a pooled holding drops it from held_sources (left in the pool)', async () => {
      const user = userEvent.setup()
      const fetchMock = stubHold()
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1"
          heldSiblings={[{ id: 'held-w', name: 'VCB 3m', amount: 8_000_000 }]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByTestId('merge-held-held-w')) // deselect
      await user.click(screen.getByRole('button', { name: /Save new deposit/i }))
      await waitFor(() => {
        const renewCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))
        expect(renewCall).toBeTruthy()
      })
      const body = JSON.parse(fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/renew'))![1].body)
      expect(body.held_sources).toBeUndefined()
    })
  })

  // ── iOS Safari autozoom guard ───────────────────────────────────────────────
  // iOS zooms the viewport on focus of any native field sized < 16px and never
  // resets it — jolting the bottom sheet so the save button drifts out of reach.
  // The globals.css 16px floor (input/textarea/select) is an element-selector, so
  // these inline-styled fields must carry >= 16px themselves to be protected.
  describe('iOS autozoom guard (fields must be >= 16px)', () => {
    function fontPx(el: Element): number {
      return parseFloat((el as HTMLElement).style.fontSize || getComputedStyle(el).fontSize || '0')
    }

    function stubEmptyRecurring() {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.startsWith('/api/v1/recurring-savings')) {
          return Promise.resolve({ ok: true, json: async () => ({ savings: [] }) })
        }
        return Promise.resolve({ ok: true, json: async () => [] })
      })
      vi.stubGlobal('fetch', fetchMock)
      return fetchMock
    }

    it('renders the renew form fields (term, rate, maturity date) at >= 16px', async () => {
      const user = userEvent.setup()
      render(
        <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      expect(fontPx(screen.getByTestId('maturity-term-input'))).toBeGreaterThanOrEqual(16)
      expect(fontPx(screen.getByTestId('maturity-date-input'))).toBeGreaterThanOrEqual(16)
      // The "Change amount" field shares the same moneyInput style.
      await user.click(screen.getByRole('button', { name: /Change amount/i }))
      expect(fontPx(screen.getByTestId('maturity-new-amount'))).toBeGreaterThanOrEqual(16)
    })

    it('renders the per-source merge-received field at >= 16px', async () => {
      const user = userEvent.setup()
      stubEmptyRecurring()
      const sibBank: InvRow = {
        id: 'sib-bank', name: 'Vikki sibling', type: 'bank', value: 8_000_000, gainPct: null,
        units: null, principal: 8_000_000, interestRate: 6, expiryDate: daysFromNow(40),
        investmentDate: daysFromNow(-150), fund: null,
      }
      render(
        <MaturityResolveBody inv={maturedDeposit} goalId="goal-1" siblingDeposits={[sibBank]}
          isVi={false} onClose={() => {}} onRenewed={() => {}} onWithdraw={() => {}} />,
      )
      await user.click(await screen.findByRole('button', { name: /Settle & re-deposit/i }))
      await user.click(screen.getByTestId('merge-override-sib-bank'))
      // The compact per-source "received" field is the worst offender (was 13px).
      expect(fontPx(screen.getByTestId('merge-received-sib-bank'))).toBeGreaterThanOrEqual(16)
    })
  })

  // ── Success-flash timing ────────────────────────────────────────────────────
  // After a successful renew the sheet shows a "done" confirmation, then closes
  // and tells the parent to refresh. That hand-off was a 1.7s wait that read as
  // the sheet being stuck; it's now a brief SUCCESS_FLASH_MS flash.
  describe('renew success flash is brief', () => {
    it('keeps the flash short, then auto-closes + refreshes (was a 1.7s wait)', async () => {
      const user = userEvent.setup()
      const onRenewed = vi.fn()
      const onClose = vi.fn()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))

      render(
        <MaturityResolveBody inv={maturedDeposit} isVi={false} onClose={onClose} onRenewed={onRenewed} onWithdraw={() => {}} />,
      )
      await user.click(screen.getByRole('button', { name: /Confirm renewal/i }))

      // The done confirmation shows first; the parent hasn't been told yet.
      await screen.findByTestId('maturity-renewed')
      expect(onRenewed).not.toHaveBeenCalled()

      // It closes + refreshes well within ~1s — the old 1.7s wait would still be
      // pending at this 1.3s deadline, so this fails on a regression back to it.
      await waitFor(() => expect(onRenewed).toHaveBeenCalledTimes(1), { timeout: 1300 })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('uses a short, non-blocking flash duration', () => {
      expect(SUCCESS_FLASH_MS).toBeLessThanOrEqual(1000)
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
