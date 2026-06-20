import { describe, it, expect } from 'vitest'
import { txKind, txDir } from '../transactionUtils'

// A held-for-merge settlement is a withdrawal whose cash was PARKED for a future
// merge, not spent — so across the History tab, Recent activity, and the ledger it
// must read neutrally (no red "−" loss). Once the merge consumes it it reads as
// "merged". These pure helpers are the single source of that distinction.
describe('txKind / txDir — held-for-merge labeling', () => {
  it('a plain investment is positive (+)', () => {
    const tx = { transaction_type: 'investment' }
    expect(txKind(tx)).toBe('investment')
    expect(txDir(tx)).toMatchObject({ kind: 'investment', tone: 'pos', sign: '+' })
  })

  it('a plain withdrawal is negative (−)', () => {
    const tx = { transaction_type: 'withdrawal' }
    expect(txKind(tx)).toBe('withdrawal')
    expect(txDir(tx)).toMatchObject({ kind: 'withdrawal', tone: 'neg', sign: '−' })
  })

  it('a held (unconsumed) settlement is neutral with no loss sign', () => {
    const tx = { transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: null }
    expect(txKind(tx)).toBe('held')
    // The whole point: NOT 'neg', and the sign carries no "−".
    expect(txDir(tx)).toMatchObject({ kind: 'held', tone: 'muted', sign: '' })
  })

  it('a consumed holding reads as merged, still neutral', () => {
    const tx = { transaction_type: 'withdrawal', held_for_merge: true, consumed_by_inv_id: 'anchor-id' }
    expect(txKind(tx)).toBe('consumed')
    expect(txDir(tx)).toMatchObject({ kind: 'consumed', tone: 'muted', sign: '' })
  })

  it('held_for_merge=false is just a plain withdrawal', () => {
    expect(txKind({ transaction_type: 'withdrawal', held_for_merge: false })).toBe('withdrawal')
  })

  it('a missing transaction_type defaults to investment (no held flags)', () => {
    expect(txKind({})).toBe('investment')
  })
})
