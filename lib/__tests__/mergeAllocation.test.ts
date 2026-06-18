import { describe, it, expect } from 'vitest'
import { allocateCumulative } from '../maturity'

// allocateCumulative splits an integer `total` across ordered `weights` using the
// exact cumulative-window method the withdraw/collapse SQL uses
// (20260618000009 lines 89–95): alloc_i = round(total·cum_i/Σ) − round(total·cum_(i-1)/Σ).
// The rounding residual lands on the slices so Σ alloc === total EXACTLY — the
// invariant the merge-on-renew net-worth guarantee leans on (client preview and
// server allocation must never diverge).
describe('allocateCumulative', () => {
  it('splits equal weights with the residual on a slice, summing to total', () => {
    const alloc = allocateCumulative(100, [1, 1, 1])
    expect(alloc).toEqual([33, 34, 33])
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('splits unequal weights proportionally', () => {
    const alloc = allocateCumulative(1000, [1, 3])
    expect(alloc).toEqual([250, 750])
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('gives the whole total to a single source', () => {
    expect(allocateCumulative(500, [7])).toEqual([500])
  })

  it('keeps Σ === total exactly even when the proportional split is not integral', () => {
    const alloc = allocateCumulative(10, [1, 1, 1])
    expect(alloc).toEqual([3, 4, 3])
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('returns all-zero (Σ === total) when total is 0', () => {
    const alloc = allocateCumulative(0, [5, 9, 2])
    expect(alloc).toEqual([0, 0, 0])
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('returns all-zero when the weights sum to 0 (no div-by-zero)', () => {
    expect(allocateCumulative(100, [0, 0])).toEqual([0, 0])
  })

  // SQL-parity worked example: the same numbers Postgres' round() produces for a
  // two-source close. round() rounds half away from zero; Math.round matches it
  // for the non-negative money values this only ever handles.
  it('matches the SQL window allocation byte-for-byte on a worked example', () => {
    const total = 8_483_563
    const weights = [3_000_000, 5_000_000] // Σ = 8,000,000
    const sum = 8_000_000
    const cum1 = 3_000_000
    const cum2 = 8_000_000
    const a1 = Math.round((total * cum1) / sum) - 0
    const a2 = Math.round((total * cum2) / sum) - Math.round((total * cum1) / sum)
    expect(allocateCumulative(total, weights)).toEqual([a1, a2])
    expect(a1 + a2).toBe(total)
  })
})
