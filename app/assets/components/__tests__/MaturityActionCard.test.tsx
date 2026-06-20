import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MaturityActionCard from '../MaturityActionCard'
import type { InvRow } from '../goalDetailShared'

function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
