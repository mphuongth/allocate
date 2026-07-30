import { describe, it, expect } from 'vitest'
import { previewBankWithdrawal, estimateReceivedForPrincipal } from '../bankWithdrawal'

// The withdrawal sheet used to treat the entered amount as a slice of the
// deposit's *current value* (principal + projected interest) and then apply that
// fraction to the principal — so the principal it recorded was never the number
// the user typed (#578). The entered amount IS the principal leaving the book;
// interest is whatever the bank paid on top of it.

describe('previewBankWithdrawal — the reported PVcombank case (#578)', () => {
  // App value 20,385,398 on a principal of 20,239,452. The user asks the bank for
  // 4,365,100 of principal and receives 4,366,416.
  const CASE = { currentPrincipal: 20_239_452, amount: 4_365_100, received: 4_366_416 }

  it('withdraws exactly the principal the user entered', () => {
    // The old proportional conversion produced 4,333,849 here — 31,251 short.
    expect(previewBankWithdrawal(CASE).principal).toBe(4_365_100)
  })

  it('reports the interest actually received', () => {
    expect(previewBankWithdrawal(CASE).interest).toBe(1_316)
  })

  it('leaves the principal the bank says remains', () => {
    expect(previewBankWithdrawal(CASE).remainingPrincipal).toBe(15_874_352)
  })
})

describe('previewBankWithdrawal', () => {
  it('reports a loss when an early withdrawal pays back less than the principal', () => {
    const p = previewBankWithdrawal({ currentPrincipal: 10_000_000, amount: 5_000_000, received: 4_900_000 })
    expect(p.interest).toBe(-100_000)
    expect(p.principal).toBe(5_000_000)
  })

  it('empties the book on a full withdrawal', () => {
    const p = previewBankWithdrawal({ currentPrincipal: 10_000_000, amount: 10_000_000, received: 10_300_000 })
    expect(p.remainingPrincipal).toBe(0)
    expect(p.exceedsPrincipal).toBe(false)
    expect(p.interest).toBe(300_000)
  })

  it('flags an amount above the remaining principal', () => {
    // The old cap was currentValue, so a user could withdraw more principal than
    // the book holds and the recorded principal would silently be scaled down.
    const p = previewBankWithdrawal({ currentPrincipal: 10_000_000, amount: 10_000_001, received: 10_300_000 })
    expect(p.exceedsPrincipal).toBe(true)
  })

  it('never reports a negative remaining principal', () => {
    const p = previewBankWithdrawal({ currentPrincipal: 10_000_000, amount: 12_000_000, received: 12_000_000 })
    expect(p.remainingPrincipal).toBe(0)
  })

  it('rounds both money inputs to whole đồng', () => {
    const p = previewBankWithdrawal({ currentPrincipal: 10_000_000, amount: 4_365_100.6, received: 4_366_416.4 })
    expect(p.principal).toBe(4_365_101)
    expect(p.received).toBe(4_366_416)
    expect(p.interest).toBe(1_315)
  })

  it('treats a book with no principal left as fully withdrawn', () => {
    const p = previewBankWithdrawal({ currentPrincipal: 0, amount: 1_000, received: 1_000 })
    expect(p.exceedsPrincipal).toBe(true)
    expect(p.remainingPrincipal).toBe(0)
  })
})

// The "amount you'll receive" field is a prefill the user confirms against their
// bank slip. Because the amount field is now principal, the prefill has to add
// back the accrued interest or an unedited field would record zero interest.
describe('estimateReceivedForPrincipal', () => {
  const BOOK = { currentPrincipal: 20_239_452, currentValue: 20_385_398 }

  it('adds the accrued interest in proportion to the principal withdrawn', () => {
    // 145,946 accrued × 4,365,100/20,239,452 = 31,477.
    expect(estimateReceivedForPrincipal({ ...BOOK, amount: 4_365_100 })).toBe(4_396_577)
  })

  it('estimates the whole current value for a full withdrawal', () => {
    // This is what "All" fills in, and it keeps the pre-#578 behaviour of the
    // received field for a full close: principal + all accrued interest.
    expect(estimateReceivedForPrincipal({ ...BOOK, amount: BOOK.currentPrincipal })).toBe(20_385_398)
  })

  it('never estimates above the current value', () => {
    expect(estimateReceivedForPrincipal({ ...BOOK, amount: 30_000_000 })).toBe(20_385_398)
  })

  it('estimates nothing extra when the deposit has accrued nothing', () => {
    expect(estimateReceivedForPrincipal({ currentPrincipal: 10_000_000, currentValue: 10_000_000, amount: 4_000_000 })).toBe(4_000_000)
  })

  it('ignores a current value below the principal instead of estimating a loss', () => {
    // Stale valuation, not a real loss — a savings book cannot accrue negative
    // interest, and guessing one would understate what the user receives.
    expect(estimateReceivedForPrincipal({ currentPrincipal: 10_000_000, currentValue: 9_500_000, amount: 4_000_000 })).toBe(4_000_000)
  })

  it('falls back to the entered amount when the book has no principal', () => {
    expect(estimateReceivedForPrincipal({ currentPrincipal: 0, currentValue: 0, amount: 1_000 })).toBe(1_000)
  })
})
