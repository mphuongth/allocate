import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TopUpControl, type InvRow } from '../goalDetailShared'
import { addDaysIso, todayIso } from '@/lib/dates'

const lockedBook: InvRow = {
  id: 'book-1', name: 'PVcomBank', type: 'bank', value: 10_000_000,
  gainPct: null, units: null, principal: 10_000_000, interestRate: 4,
  investmentDate: addDaysIso(todayIso(), -330), expiryDate: addDaysIso(todayIso(), 10),
  fund: null, depositGroupId: 'book-1', topUpLockDays: 30,
}

describe('TopUpControl', () => {
  it('keeps the form available so a valid historical top-up can be recorded', async () => {
    const { container } = render(<TopUpControl inv={lockedBook} isVi={false} onDone={() => {}} />)

    await screen.getByTestId('top-up-btn').click()
    expect(screen.getByTestId('top-up-locked')).toBeInTheDocument()

    const date = container.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(date, { target: { value: addDaysIso(todayIso(), -25) } })

    expect(screen.queryByTestId('top-up-locked')).not.toBeInTheDocument()
    expect(screen.getByTestId('top-up-submit')).toBeDisabled() // still needs an amount
  })

  // #638 Phase 2: a book the bank has closed to top-ups is not a dead end.
  it('offers the successor book while the entered date is inside the lock window', async () => {
    const { container } = render(<TopUpControl inv={lockedBook} isVi={false} onDone={() => {}} />)

    await screen.getByTestId('top-up-btn').click()
    fireEvent.change(screen.getByTestId('top-up-amount'), { target: { value: '2000000' } })

    // Locked today: the way forward is the next book, not a refused top-up.
    expect(screen.queryByTestId('top-up-submit')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('open-successor-btn'))

    const sheet = screen.getByTestId('successor-modal')
    expect(sheet).toBeInTheDocument()
    // The contribution the user already typed carries over, and the old book's
    // policy is the new book's default.
    expect((screen.getByTestId('successor-amount') as HTMLInputElement).value).toBe('2.000.000')
    expect((screen.getByTestId('successor-lock') as HTMLInputElement).value).toBe('30')
    // The maturity is the bank's to quote, so it starts empty and gates submit.
    expect((screen.getByTestId('successor-expiry') as HTMLInputElement).value).toBe('')
    expect(screen.getByTestId('successor-submit')).toBeDisabled()

    const dates = container.querySelectorAll('[data-testid="successor-expiry"]')
    fireEvent.change(dates[0], { target: { value: addDaysIso(todayIso(), 365) } })
    expect(screen.getByTestId('successor-submit')).toBeEnabled()
  })

  it('back to a date the book still accepts, the top-up itself returns', async () => {
    const { container } = render(<TopUpControl inv={lockedBook} isVi={false} onDone={() => {}} />)

    await screen.getByTestId('top-up-btn').click()
    const date = container.querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(date, { target: { value: addDaysIso(todayIso(), -25) } })

    expect(screen.getByTestId('top-up-submit')).toBeInTheDocument()
    expect(screen.queryByTestId('open-successor-btn')).not.toBeInTheDocument()
  })

  it('a book that already handed over says so instead of taking more money', () => {
    render(<TopUpControl inv={{ ...lockedBook, successorDepositTxId: 'book-2' }} isVi={false} onDone={() => {}} />)

    expect(screen.getByTestId('successor-planned')).toBeInTheDocument()
    expect(screen.queryByTestId('top-up-btn')).not.toBeInTheDocument()
  })
})
