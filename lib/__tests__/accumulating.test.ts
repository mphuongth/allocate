import { describe, it, expect } from 'vitest'
import { isAccumulating, blendedRate, anchorId } from '../accumulating'

describe('isAccumulating', () => {
  it('is true when the row carries a deposit_group_id', () => {
    expect(isAccumulating({ depositGroupId: 'grp-1' })).toBe(true)
  })
  it('is false for an ungrouped (term / one-off) holding', () => {
    expect(isAccumulating({ depositGroupId: null })).toBe(false)
    expect(isAccumulating({ depositGroupId: undefined })).toBe(false)
  })
})

describe('anchorId — the book id a row belongs to', () => {
  it('uses deposit_group_id when grouped, else the row is its own (term)', () => {
    expect(anchorId({ transactionId: 'tx-1', depositGroupId: 'anchor-9' })).toBe('anchor-9')
    expect(anchorId({ transactionId: 'tx-1', depositGroupId: null })).toBe('tx-1')
  })
})

describe('blendedRate — amount-weighted average rate across tranches', () => {
  it('weights each tranche rate by its amount', () => {
    // (50M·3.0 + 2M·3.4 + 2M·3.5) / 54M = 3.0296…%
    const r = blendedRate([
      { amount: 50_000_000, rate: 3.0 },
      { amount: 2_000_000, rate: 3.4 },
      { amount: 2_000_000, rate: 3.5 },
    ])
    expect(r).toBeCloseTo((50 * 3.0 + 2 * 3.4 + 2 * 3.5) / 54, 6)
  })
  it('returns the single rate for one tranche', () => {
    expect(blendedRate([{ amount: 10_000_000, rate: 4.2 }])).toBe(4.2)
  })
  it('treats a null rate as 0 in the weighting', () => {
    expect(blendedRate([{ amount: 1_000_000, rate: null }, { amount: 1_000_000, rate: 4 }])).toBe(2)
  })
  it('returns 0 when there is no principal', () => {
    expect(blendedRate([])).toBe(0)
    expect(blendedRate([{ amount: 0, rate: 5 }])).toBe(0)
  })
})
