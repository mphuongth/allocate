import { describe, it, expect } from 'vitest'
import { txKind, txDir, txPrimaryName } from '../transactionUtils'

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

  // #638 Phase 4. Folding a book into its successor closes every tranche with a
  // withdrawal whose cash goes straight into the new book — it never left. Those
  // rows carry consumed_by_inv_id but not held_for_merge, so they read as red
  // spending: a merged book looked like the account had been emptied. What makes
  // a row neutral is where the cash went, not which path parked it.
  it('a withdrawal folded into another deposit is neutral, held or not', () => {
    const tx = { transaction_type: 'withdrawal', held_for_merge: false, consumed_by_inv_id: 'new-tranche' }
    expect(txKind(tx)).toBe('consumed')
    expect(txDir(tx)).toMatchObject({ kind: 'consumed', tone: 'muted', sign: '' })
  })

  it('...and the same when held_for_merge was never set at all', () => {
    const tx = { transaction_type: 'withdrawal', consumed_by_inv_id: 'new-tranche' }
    expect(txDir(tx)).toMatchObject({ kind: 'consumed', tone: 'muted', sign: '' })
  })

  it('a missing transaction_type defaults to investment (no held flags)', () => {
    expect(txKind({})).toBe('investment')
  })
})

// A withdrawal row carries no notes of its own — SellWithdrawSheet posts only
// parent_transaction_id, amount and principal — so it fell through to the
// generic asset-type label ("Ngân hàng") instead of naming the bank the money
// was withdrawn FROM. The source's own name — "PVcombank", or whatever the
// user typed — already answers that, and the DB carries it: a renewal
// re-parents the closed cycle's withdrawal rows onto the SNAPSHOT
// (20260815000001, 20260904000001), which keeps the label the bank had at the
// time, not the live row's post-renewal name. So this is a straight read, not
// a guess: the API attaches it as `parentNotes`.
describe('txPrimaryName — a withdrawal names the source it drew from (#712 follow-up)', () => {
  it('falls back to the parent source name when the withdrawal has no notes', () => {
    const tx = { transaction_type: 'withdrawal', notes: null, parentNotes: 'PVcombank', funds: null }
    expect(txPrimaryName(tx as never, 'Ngân hàng')).toBe('PVcombank')
  })

  it('still prefers the fund name over the parent source, for a fund withdrawal', () => {
    const withFund = { transaction_type: 'withdrawal', notes: null, parentNotes: 'PVcombank', funds: { id: 'f1', name: 'VESAF', nav: 1 } }
    expect(txPrimaryName(withFund as never, 'Quỹ')).toBe('VESAF')
  })

  it('falls back to the asset-type label when neither the row nor its parent has a name', () => {
    const tx = { transaction_type: 'withdrawal', notes: null, parentNotes: null, funds: null }
    expect(txPrimaryName(tx as never, 'Ngân hàng')).toBe('Ngân hàng')
  })

  it('does not reach for the parent on a non-withdrawal row (an investment names only itself)', () => {
    const tx = { transaction_type: 'investment', notes: null, parentNotes: 'should not surface', funds: null }
    expect(txPrimaryName(tx as never, 'Ngân hàng')).toBe('Ngân hàng')
  })

  // A withdrawal that ALSO carries its own free-text note used to show the note
  // ("Rút để gộp gửi") over the source's name — but SellWithdrawSheet never
  // posts `notes` for ANY withdrawal at creation (fund, bank, or gold); a note
  // on a withdrawal only ever gets there via a later manual edit describing the
  // ACTION being taken, not where the money came from. The source's name is
  // what every other row in the ledger identifies itself by, so it outranks
  // the row's own note — for every withdrawal, not just bank.
  it('a withdrawal prefers the source name over its own descriptive note', () => {
    const tx = { transaction_type: 'withdrawal', asset_type: 'bank', notes: 'Rút để gộp gửi', parentNotes: 'PVcombank', funds: null }
    expect(txPrimaryName(tx as never, 'Ngân hàng')).toBe('PVcombank')
  })

  it('falls back to its own note when the source has none', () => {
    const tx = { transaction_type: 'withdrawal', asset_type: 'bank', notes: 'Rút để gộp gửi', parentNotes: null, funds: null }
    expect(txPrimaryName(tx as never, 'Ngân hàng')).toBe('Rút để gộp gửi')
  })

  // Real production data: a legacy withdrawal row with asset_type = null (not
  // set at creation, or lost some other way) still has a parent that names it.
  // The swap must not depend on the withdrawal's OWN asset_type — that field
  // can be missing on old rows in a way the parent link and its name are not.
  it('prefers the source name even when the withdrawal itself has no asset_type on record', () => {
    const tx = { transaction_type: 'withdrawal', asset_type: null, notes: 'Rút để gộp gửi', parentNotes: 'PVCombank', funds: null }
    expect(txPrimaryName(tx as never, 'Ngân hàng')).toBe('PVCombank')
  })

  it('a gold withdrawal follows the same rule — the source outranks its own note', () => {
    const tx = { transaction_type: 'withdrawal', asset_type: 'gold', notes: 'Bán vàng trả nợ', parentNotes: 'PNJ', funds: null }
    expect(txPrimaryName(tx as never, 'Vàng')).toBe('PNJ')
  })
})
