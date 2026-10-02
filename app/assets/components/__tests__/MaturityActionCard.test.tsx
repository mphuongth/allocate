import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MaturityActionCard from '../MaturityActionCard'
import type { InvRow } from '../goalDetailShared'
import { todayIso, addDaysIso } from '@/lib/dates'

// Built on the BUSINESS calendar, because that is what daysUntil/fmtMaturity
// measure against. Deriving these from the runtime's local clock made every
// maturity assertion off by one whenever the runner's date differed from
// Vietnam's — on a UTC runner, that is 17:00–23:59 every day (#591).
function daysFromNow(n: number): string {
  return addDaysIso(todayIso(), n)
}

const mk = (over: Partial<InvRow>): InvRow => ({
  id: 'tx', name: 'Deposit', type: 'bank', value: 10_500_000, gainPct: 5,
  units: null, principal: 10_000_000, interestRate: 6,
  expiryDate: daysFromNow(-2), investmentDate: daysFromNow(-360), fund: null,
  ...over,
})

describe('MaturityActionCard', () => {
  it('renders nothing when there are no actionable deposits', () => {
    const { container } = render(<MaturityActionCard items={[]} isVi={false} onResolve={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each deposit with the count and fires onResolve with the row', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const items = [
      mk({ id: 'a', name: 'TCB Term' }),
      mk({ id: 'b', name: 'VCB Savings', expiryDate: daysFromNow(0) }),
    ]
    render(<MaturityActionCard items={items} isVi={false} onResolve={onResolve} />)

    expect(screen.getByTestId('maturity-action-count').textContent).toBe('2')
    expect(screen.getByText('TCB Term')).toBeInTheDocument()
    expect(screen.getByText('VCB Savings')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /Handle/i })[0])
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('renders a row without a status pill (no crash) when the expiry date is missing', () => {
    render(<MaturityActionCard items={[mk({ name: 'No Expiry', expiryDate: null })]} isVi={false} onResolve={() => {}} />)
    // The row still renders (name + Handle), just with no maturity pill.
    expect(screen.getByText('No Expiry')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Handle/i })).toBeInTheDocument()
    expect(screen.queryByText(/overdue|Matured|Matures/i)).not.toBeInTheDocument()
  })

  it('shows an accurate maturity pill for each lead time (not a hardcoded "tomorrow")', () => {
    const { rerender } = render(
      <MaturityActionCard items={[mk({ expiryDate: daysFromNow(0) })]} isVi onResolve={() => {}} />,
    )
    expect(screen.getByText('Đáo hạn hôm nay')).toBeInTheDocument()

    rerender(<MaturityActionCard items={[mk({ expiryDate: daysFromNow(1) })]} isVi onResolve={() => {}} />)
    expect(screen.getByText('Đáo hạn ngày mai')).toBeInTheDocument()

    // Within the 7-day window but more than a day out — must NOT say "ngày mai".
    rerender(<MaturityActionCard items={[mk({ expiryDate: daysFromNow(5) })]} isVi onResolve={() => {}} />)
    expect(screen.getByText('Đáo hạn sau 5 ngày')).toBeInTheDocument()
    expect(screen.queryByText('Đáo hạn ngày mai')).not.toBeInTheDocument()

    rerender(<MaturityActionCard items={[mk({ expiryDate: daysFromNow(5) })]} isVi={false} onResolve={() => {}} />)
    expect(screen.getByText('Matures in 5d')).toBeInTheDocument()
  })

  it('shows no merge banner when there are no clusters', () => {
    render(<MaturityActionCard items={[mk({ id: 'a' }), mk({ id: 'b' })]} isVi={false} onResolve={() => {}} />)
    expect(screen.queryByTestId(/^merge-cluster-banner-/)).not.toBeInTheDocument()
  })

  it('renders a merge-cluster banner and fires onMergeCluster with the anchor id', async () => {
    const user = userEvent.setup()
    const onMergeCluster = vi.fn()
    render(
      <MaturityActionCard
        items={[mk({ id: 'a' }), mk({ id: 'b' })]}
        isVi
        onResolve={() => {}}
        clusters={[{ anchorId: 'b', size: 2 }]}
        onMergeCluster={onMergeCluster}
      />,
    )
    const banner = screen.getByTestId('merge-cluster-banner-b')
    expect(banner).toBeInTheDocument()
    // The count is surfaced so the call-out reads "2 sổ ...".
    expect(banner.textContent).toMatch(/2/)
    await user.click(within(banner).getByRole('button'))
    expect(onMergeCluster).toHaveBeenCalledTimes(1)
    expect(onMergeCluster).toHaveBeenCalledWith('b')
  })
})

describe('MaturityActionCard — renew-or-move and estimated-units reminders', () => {
  const estimate = {
    transactionId: 'buy-1', fundId: 'f-e1', fundName: 'VFMVN30 ETF', fundCode: 'E1VFVN30', goalId: 'g1',
    amount: 102_991_781, units: 4119.67, unitPrice: 25_000, investmentDate: daysFromNow(-2),
  }

  it("reminds the user to check today's 12-month rate before deciding a term deposit", () => {
    render(<MaturityActionCard items={[mk({ id: 'a', name: 'VCB 6 th.', expiryDate: daysFromNow(3) })]} isVi={false} onResolve={() => {}} />)
    expect(screen.getByTestId('maturity-rate-reminder-a')).toHaveTextContent(/today's 12-month rate/i)
  })

  it('does not ask about the rate for an accumulating book, which has no renew-or-move choice', () => {
    render(<MaturityActionCard items={[mk({ id: 'b', depositGroupId: 'b' })]} isVi={false} onResolve={() => {}} />)
    expect(screen.queryByTestId('maturity-rate-reminder-b')).not.toBeInTheDocument()
  })

  it('asks for the filled units of a purchase priced at an estimated NAV, and opens it to correct', async () => {
    const user = userEvent.setup()
    const onFixEstimate = vi.fn()
    render(<MaturityActionCard items={[]} estimates={[estimate]} isVi onResolve={() => {}} onFixEstimate={onFixEstimate} />)

    // The card shows even with no deposit to decide, and counts the purchase.
    expect(screen.getByTestId('maturity-action-count').textContent).toBe('1')
    const row = screen.getByTestId('unit-estimate-buy-1')
    expect(row).toHaveTextContent('E1VFVN30')
    expect(row).toHaveTextContent(/Cập nhật số CCQ khớp lệnh/)

    await user.click(within(row).getByRole('button', { name: /Cập nhật/ }))
    expect(onFixEstimate).toHaveBeenCalledWith(estimate)
  })

  it('counts deposits and purchases together', () => {
    render(<MaturityActionCard items={[mk({ id: 'a' })]} estimates={[estimate]} isVi={false} onResolve={() => {}} onFixEstimate={() => {}} />)
    expect(screen.getByTestId('maturity-action-count').textContent).toBe('2')
  })
})
