import { describe, it, expect } from 'vitest'
import { heldForMergeContributions, type HeldWithdrawalRow } from '../heldForMerge'

// A held settlement (withdrawal) row as the overview reads it. Only the fields the
// synthesizer needs; everything else on the real row is irrelevant here.
const mk = (over: Partial<HeldWithdrawalRow>): HeldWithdrawalRow => ({
  amount_vnd: 8_000_000,
  merge_target_goal_id: 'g1',
  held_for_merge: true,
  consumed_by_inv_id: null,
  ...over,
})

describe('heldForMergeContributions', () => {
  it('synthesizes one contribution per held, unconsumed row, keyed to its target goal', () => {
    const out = heldForMergeContributions([mk({ amount_vnd: 8_000_000, merge_target_goal_id: 'g1' })])
    expect(out).toEqual([{ goalId: 'g1', amount: 8_000_000 }])
  })

  it('drops a consumed holding (its cash now lives in the renewed deposit)', () => {
    const out = heldForMergeContributions([mk({ consumed_by_inv_id: 'D-renewed' })])
    expect(out).toEqual([])
  })

  it('ignores a non-held withdrawal (plain settle-to-cash)', () => {
    expect(heldForMergeContributions([mk({ held_for_merge: false })])).toEqual([])
  })

  it('skips a holding with no target goal (nothing to add it back to)', () => {
    expect(heldForMergeContributions([mk({ merge_target_goal_id: null })])).toEqual([])
  })

  it('skips a non-positive held amount', () => {
    expect(heldForMergeContributions([mk({ amount_vnd: 0 })])).toEqual([])
  })

  it('keeps each holding separate (no per-goal aggregation — the caller sums)', () => {
    const out = heldForMergeContributions([
      mk({ amount_vnd: 5_000_000, merge_target_goal_id: 'g1' }),
      mk({ amount_vnd: 3_000_000, merge_target_goal_id: 'g1' }),
      mk({ amount_vnd: 2_000_000, merge_target_goal_id: 'g2' }),
    ])
    expect(out).toEqual([
      { goalId: 'g1', amount: 5_000_000 },
      { goalId: 'g1', amount: 3_000_000 },
      { goalId: 'g2', amount: 2_000_000 },
    ])
  })

  it('tolerates null/undefined held flags (legacy rows) as not held', () => {
    const out = heldForMergeContributions([
      { amount_vnd: 1_000_000, merge_target_goal_id: 'g1', held_for_merge: null, consumed_by_inv_id: null },
    ])
    expect(out).toEqual([])
  })
})
