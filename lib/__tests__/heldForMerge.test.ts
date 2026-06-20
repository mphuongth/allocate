import { describe, it, expect } from 'vitest'
import { heldForMergeContributions, type HeldWithdrawalRow } from '../heldForMerge'

// A held settlement (withdrawal) row as the overview reads it. Only the fields the
// synthesizer needs; everything else on the real row is irrelevant here.
const mk = (over: Partial<HeldWithdrawalRow>): HeldWithdrawalRow => ({
  transaction_id: 'w1',
  amount_vnd: 8_000_000,
  merge_target_goal_id: 'g1',
  merge_anchor_inv_id: 'D',
  held_for_merge: true,
  consumed_by_inv_id: null,
  ...over,
})

describe('heldForMergeContributions', () => {
  it('synthesizes one contribution per held, unconsumed row, carrying id + anchor', () => {
    const out = heldForMergeContributions([mk({ transaction_id: 'w1', amount_vnd: 8_000_000, merge_target_goal_id: 'g1', merge_anchor_inv_id: 'D' })])
    expect(out).toEqual([{ transactionId: 'w1', goalId: 'g1', amount: 8_000_000, anchorInvId: 'D' }])
  })

  it('drops a consumed holding (its cash now lives in the renewed deposit)', () => {
    expect(heldForMergeContributions([mk({ consumed_by_inv_id: 'D-renewed' })])).toEqual([])
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

  it('carries a null anchor through (the anchor is informational only)', () => {
    const out = heldForMergeContributions([mk({ transaction_id: 'w2', merge_anchor_inv_id: null })])
    expect(out).toEqual([{ transactionId: 'w2', goalId: 'g1', amount: 8_000_000, anchorInvId: null }])
  })

  it('keeps each holding separate (no per-goal aggregation — the caller sums)', () => {
    const out = heldForMergeContributions([
      mk({ transaction_id: 'a', amount_vnd: 5_000_000, merge_target_goal_id: 'g1' }),
      mk({ transaction_id: 'b', amount_vnd: 3_000_000, merge_target_goal_id: 'g1' }),
      mk({ transaction_id: 'c', amount_vnd: 2_000_000, merge_target_goal_id: 'g2' }),
    ])
    expect(out.map((h) => h.transactionId)).toEqual(['a', 'b', 'c'])
    expect(out.reduce((s, h) => s + h.amount, 0)).toBe(10_000_000)
  })

  it('tolerates null/undefined held flags (legacy rows) as not held', () => {
    const out = heldForMergeContributions([
      { transaction_id: 'x', amount_vnd: 1_000_000, merge_target_goal_id: 'g1', merge_anchor_inv_id: null, held_for_merge: null, consumed_by_inv_id: null },
    ])
    expect(out).toEqual([])
  })
})
