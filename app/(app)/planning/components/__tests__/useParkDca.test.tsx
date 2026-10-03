import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useParkDca } from '../useParkDca'
import type { GoalItem } from '@/lib/planning'

// Both plan views open the same two dialogs for a DCA line: the "Gửi tiết
// kiệm thay" sheet, and — because undoing it deletes a deposit — a confirm
// before the undo.

const pending = { name: 'VFMVN30 ETF', type: 'fund', amount: 5_000_000, isFundDca: true, fundId: 'f-e1' } as GoalItem
const parked = { ...pending, parkedIn: { transactionId: 'dep-1', name: 'Sổ VCB', amount: 5_000_000 } } as GoalItem

// The goal's other DCA lines, in every state a line can be in.
const other = { name: 'DCDS', type: 'fund', amount: 1_500_000, isFundDca: true, fundId: 'f-2' } as GoalItem
const bought = { ...other, name: 'Bought', fundId: 'f-b', recorded: true } as GoalItem
const skipped = { ...other, name: 'Skipped', fundId: 'f-s', skipped: true } as GoalItem
const parkedElsewhere = { ...other, name: 'Elsewhere', fundId: 'f-x', parkedIn: { transactionId: 'dep-9', name: 'Sổ TCB', amount: 1 } } as GoalItem
const recurring = { name: 'Rec', type: 'bank', amount: 3_000_000, isRecurring: true } as GoalItem
const parkedSibling = { ...other, name: 'DCDS', parkedIn: parked.parkedIn } as GoalItem

function Harness({ unparkDca, planId = 'plan-1', goalItems }: { unparkDca: (i: GoalItem) => Promise<void>; planId?: string | null; goalItems?: GoalItem[] }) {
  const park = useParkDca({ planId, isVI: true, variant: 'modal', onRefresh: () => {}, onToast: () => {}, unparkDca })
  return (
    <>
      <button onClick={() => park.openPark(pending, goalItems)}>open-park</button>
      <button onClick={() => park.askUnpark(parked, goalItems)}>ask-unpark</button>
      {park.dialogs}
    </>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('useParkDca', () => {
  it('opens the park sheet for the DCA line, at the DCA amount', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
    const user = userEvent.setup()
    render(<Harness unparkDca={vi.fn()} />)
    await user.click(screen.getByText('open-park'))
    expect(await screen.findByTestId('park-dca-modal')).toBeInTheDocument()
    expect(screen.getByTestId('park-dca-amount')).toHaveValue('5.000.000')
  })

  it('asks before deleting the deposit, and only then undoes', async () => {
    const user = userEvent.setup()
    const unparkDca = vi.fn().mockResolvedValue(undefined)
    render(<Harness unparkDca={unparkDca} />)
    await user.click(screen.getByText('ask-unpark'))
    expect(screen.getByText(/Sổ VCB/)).toBeInTheDocument()
    expect(unparkDca).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('park-delete-confirm'))
    await waitFor(() => expect(unparkDca).toHaveBeenCalledWith(parked))
    await waitFor(() => expect(screen.queryByTestId('park-delete-confirm')).not.toBeInTheDocument())
  })

  it('does nothing without a plan', async () => {
    const user = userEvent.setup()
    render(<Harness unparkDca={vi.fn()} planId={null} />)
    await user.click(screen.getByText('open-park'))
    expect(screen.queryByTestId('park-dca-modal')).not.toBeInTheDocument()
  })

  it("offers only the goal's other DCA lines still waiting to be bought", async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })))
    const user = userEvent.setup()
    render(<Harness unparkDca={vi.fn()} goalItems={[pending, other, bought, skipped, parkedElsewhere, recurring]} />)
    await user.click(screen.getByText('open-park'))
    await screen.findByTestId('park-dca-modal')
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual([
      expect.stringContaining('DCDS'),
    ])
  })

  it('names every DCA line the deposit carries before deleting it', async () => {
    const user = userEvent.setup()
    render(<Harness unparkDca={vi.fn()} goalItems={[parked, parkedSibling, parkedElsewhere]} />)
    await user.click(screen.getByText('ask-unpark'))
    expect(screen.getByText(/các dòng DCA VFMVN30 ETF, DCDS quay lại chờ mua/)).toBeInTheDocument()
    expect(screen.queryByText(/Elsewhere/)).toBeNull()
  })
})
