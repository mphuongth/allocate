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

function Harness({ unparkDca, planId = 'plan-1' }: { unparkDca: (i: GoalItem) => Promise<void>; planId?: string | null }) {
  const park = useParkDca({ planId, isVI: true, variant: 'modal', onRefresh: () => {}, onToast: () => {}, unparkDca })
  return (
    <>
      <button onClick={() => park.openPark(pending)}>open-park</button>
      <button onClick={() => park.askUnpark(parked)}>ask-unpark</button>
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
})
