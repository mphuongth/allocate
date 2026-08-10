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
})
