import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BankInfoStrip } from '../goalDetailShared'
import type { InvRow } from '@/features/dashboard/contracts'

// A book's top-up history is where its money visibly came from. After a merge
// (#638 Phase 4) one of those tranches did not come from the user at all — it is
// another book's payout, and that book is dissolved by then, so this line is the
// only trace left of where the jump came from.
const book: InvRow = {
  id: 'B', name: 'PVcomBank B', type: 'bank', value: 10_300_000, gainPct: null,
  units: null, principal: 10_300_000, interestRate: 5, expiryDate: '2027-01-01',
  investmentDate: '2026-06-01', fund: null, depositGroupId: 'B',
  tranches: [
    { id: 'credited', date: '2026-08-11', amount: 8_300_000, rate: 5, value: 8_300_000, mergedFrom: 'PVcomBank A' },
    { id: 'own', date: '2026-06-01', amount: 2_000_000, rate: 5, value: 2_000_000 },
  ],
}

describe('BankInfoStrip — merged-in provenance (#638)', () => {
  it('says which book a credited tranche was folded in from', () => {
    render(<BankInfoStrip inv={book} isVi={false} />)

    expect(screen.getByTestId('tranche-merged-from')).toHaveTextContent('Merged from PVcomBank A')
  })

  it('says nothing on the tranches the user paid in themselves', () => {
    render(<BankInfoStrip inv={{ ...book, tranches: [book.tranches![1]] }} isVi={false} />)

    expect(screen.queryByTestId('tranche-merged-from')).not.toBeInTheDocument()
  })

  it('falls back to the plain date when the source name is unknown', () => {
    render(<BankInfoStrip inv={{ ...book, tranches: [{ ...book.tranches![0], mergedFrom: null }] }} isVi={false} />)

    expect(screen.queryByTestId('tranche-merged-from')).not.toBeInTheDocument()
    expect(screen.getByTestId('tranche-row')).toBeInTheDocument()
  })
})
