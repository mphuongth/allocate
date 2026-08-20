import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopUpControl, type InvRow } from '../goalDetailShared'
import { addDaysIso, todayIso } from '@/lib/dates'

// Guard for #688. The top-up dialog was a bare fixed <div>, and it is also the
// one that opens ANOTHER dialog: the successor sheet launches from inside it, so
// this file is where the nested rules get pinned.

const openBook: InvRow = {
  id: 'book-1', name: 'PVcomBank', type: 'bank', value: 10_000_000,
  gainPct: null, units: null, principal: 10_000_000, interestRate: 4,
  investmentDate: addDaysIso(todayIso(), -330), expiryDate: addDaysIso(todayIso(), 200),
  fund: null, depositGroupId: 'book-1', topUpLockDays: null,
}
const lockedBook: InvRow = { ...openBook, expiryDate: addDaysIso(todayIso(), 10), topUpLockDays: 30 }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => vi.unstubAllGlobals())

/** The dialog only exists once its trigger is pressed. */
function OpenedTopUp({ onClose }: { onClose: () => void }) {
  return <TopUpControl inv={openBook} isVi={false} onDone={onClose} />
}

describe('TopUpControl — the dialog opens from its trigger (#688)', () => {
  it('is a modal dialog named by its title', async () => {
    render(<OpenedTopUp onClose={() => {}} />)

    await userEvent.click(screen.getByTestId('top-up-btn'))

    const dialog = screen.getByRole('dialog', { name: 'Top up deposit' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('moves focus in, and back to the trigger on Escape', async () => {
    render(<OpenedTopUp onClose={() => {}} />)
    const trigger = screen.getByTestId('top-up-btn')

    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement)

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps Tab inside the dialog', async () => {
    render(<OpenedTopUp onClose={() => {}} />)
    await userEvent.click(screen.getByTestId('top-up-btn'))
    const dialog = screen.getByRole('dialog')
    const focusables = dialog.querySelectorAll<HTMLElement>('button, input')
    focusables[focusables.length - 1].focus()

    await userEvent.tab()

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('types at 16px so iOS Safari does not zoom (#265)', async () => {
    render(<OpenedTopUp onClose={() => {}} />)
    await userEvent.click(screen.getByTestId('top-up-btn'))

    for (const input of screen.getByRole('dialog').querySelectorAll<HTMLInputElement>('input')) {
      if (!input.style.fontSize) continue
      expect(Number.parseFloat(input.style.fontSize)).toBeGreaterThanOrEqual(16)
    }
  })
})

// The nested flow named in the acceptance criteria: top-up → successor.
describe('TopUpControl — nested successor dialog (#688)', () => {
  async function openBoth() {
    render(<TopUpControl inv={lockedBook} isVi={false} onDone={() => {}} />)
    await userEvent.click(screen.getByTestId('top-up-btn'))
    fireEvent.change(screen.getByTestId('top-up-amount'), { target: { value: '2000000' } })
    fireEvent.click(screen.getByTestId('open-successor-btn'))
    return screen.getByTestId('successor-modal')
  }

  it('Escape closes only the successor sheet, leaving the top-up dialog open', async () => {
    // Both dialogs listen on document. Without a stack this Escape collapsed the
    // pile and the user lost the sheet they were not even in.
    await openBoth()
    expect(screen.getByTestId('top-up-modal')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('successor-modal')).not.toBeInTheDocument())
    expect(screen.getByTestId('top-up-modal')).toBeInTheDocument()
  })

  it('a second Escape then closes the top-up dialog', async () => {
    await openBoth()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('successor-modal')).not.toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('top-up-modal')).not.toBeInTheDocument())
  })

  it('traps Tab in the successor sheet, not the dialog underneath', async () => {
    const sheet = await openBoth()
    const focusables = sheet.querySelectorAll<HTMLElement>('button, input')
    focusables[focusables.length - 1].focus()

    await userEvent.tab()

    expect(sheet).toContainElement(document.activeElement as HTMLElement)
  })

  it('returns focus to the top-up dialog when the successor sheet closes', async () => {
    await openBoth()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByTestId('successor-modal')).not.toBeInTheDocument())
    // Back inside the parent dialog, not stranded on the page behind it.
    expect(screen.getByTestId('top-up-modal')).toContainElement(document.activeElement as HTMLElement)
  })
})
