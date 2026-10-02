import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalAllocationRow } from '../planningRows'
import { DGoalItemRow } from '../desktopPlanningRows'
import type { GoalItem, GoalRow } from '@/lib/planning'

// A month's fund DCA can be parked in a term deposit instead (20261002000002).
// The pending DCA line offers it beside Buy and Skip; a parked line says where
// the money went and offers the undo — deleting the deposit — instead of a
// "Restore" that the database would refuse.

const pending: GoalItem = {
  name: 'VFMVN30 ETF', type: 'fund', amount: 5_000_000, isDCA: true, isFundDca: true,
  fundId: 'f-e1', transactionId: 'seed-1', recorded: false,
}
const parked: GoalItem = {
  name: 'VFMVN30 ETF', type: 'fund', amount: 5_000_000, baseAmount: 5_000_000, isDCA: true, isFundDca: true,
  fundId: 'f-e1', skipped: false, parkedIn: { transactionId: 'dep-1', name: 'Sổ VCB 6 th.', amount: 5_000_000 },
}

const handlers = () => ({
  onRecSkip: vi.fn(), onRecRestore: vi.fn(), onRecOverride: vi.fn(), onRecEdit: vi.fn(),
  onRecordBuy: vi.fn(), onRecordDeposit: vi.fn(), onLogContribution: vi.fn(),
  onDcaSkip: vi.fn(), onDcaRestore: vi.fn(), onDcaPark: vi.fn(), onDcaUnpark: vi.fn(),
})

const row = (item: GoalItem): GoalRow => ({
  goalId: 'g-1', goalName: 'Wealth Max', totalAllocated: 5_000_000, contributed: 0, isUnallocated: false, items: [item],
})

function renderDesktop(item: GoalItem) {
  const h = handlers()
  render(
    <table><tbody>
      <DGoalItemRow item={item} isVI
        onSkip={h.onRecSkip} onRestore={h.onRecRestore} onOverride={h.onRecOverride} onEdit={h.onRecEdit}
        onRecordBuy={h.onRecordBuy} onRecordDeposit={h.onRecordDeposit}
        onDcaSkip={h.onDcaSkip} onDcaRestore={h.onDcaRestore} onDcaPark={h.onDcaPark} onDcaUnpark={h.onDcaUnpark} />
    </tbody></table>,
  )
  return h
}

describe.each([
  ['mobile', (item: GoalItem) => {
    const h = handlers()
    render(<GoalAllocationRow entry={row(item)} isVI {...h} />)
    fireEvent.click(screen.getByText('Wealth Max')) // the line items show once the goal is expanded
    return h
  }],
  ['desktop', renderDesktop],
])('%s DCA line — parked in a deposit', (_label, renderRow) => {
  it('offers parking the pending DCA in a deposit', async () => {
    const user = userEvent.setup()
    const h = renderRow(pending)
    await user.click(screen.getByRole('button', { name: 'DCA actions' }))
    await user.click(within(screen.getByRole('menu')).getByText('Gửi tiết kiệm thay'))
    expect(h.onDcaPark).toHaveBeenCalledTimes(1)
  })

  it('says where a parked DCA went, and offers the undo instead of Buy or Restore', async () => {
    const user = userEvent.setup()
    const h = renderRow(parked)
    expect(screen.getByText('Gửi tiết kiệm thay · Sổ VCB 6 th.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ghi nhận mua/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore DCA' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Parked DCA actions' }))
    await user.click(within(screen.getByRole('menu')).getByText('Huỷ gửi tiết kiệm (xoá sổ)'))
    expect(h.onDcaUnpark).toHaveBeenCalledTimes(1)
  })
})
