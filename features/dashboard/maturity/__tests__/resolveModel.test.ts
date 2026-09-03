import { describe, it, expect } from 'vitest'
import { computeNewPrincipal, renewEndpoint, buildRenewBody } from '../resolveModel'

// The maturity-resolve write model (#467): the new principal + the renew/collapse
// request body, per resolution mode. Extracted from MaturityResolveBody so the
// money that persists can be pinned without a full sheet render.

describe('computeNewPrincipal', () => {
  const base = { principal: 10_000_000, iNum: 600_000, newAmountNum: null, redepositNum: 0, mergeReceivedTotal: 0, heldReceivedTotal: 0 }

  it('withdraw keeps the principal unchanged', () => {
    expect(computeNewPrincipal('withdraw', base)).toBe(10_000_000)
  })

  it('combine folds the re-deposit + merged + held cash together', () => {
    expect(computeNewPrincipal('combine', { ...base, redepositNum: 12_000_000, mergeReceivedTotal: 3_000_000, heldReceivedTotal: 1_000_000 })).toBe(16_000_000)
  })

  it('principal_interest compounds interest back in', () => {
    expect(computeNewPrincipal('principal_interest', base)).toBe(10_600_000)
  })

  it('principal_only keeps just the principal', () => {
    expect(computeNewPrincipal('principal_only', base)).toBe(10_000_000)
  })

  it('change uses the manual new amount (falls back to principal when empty)', () => {
    expect(computeNewPrincipal('change', { ...base, newAmountNum: 8_000_000 })).toBe(8_000_000)
    expect(computeNewPrincipal('change', { ...base, newAmountNum: null })).toBe(10_000_000)
  })
})

describe('renewEndpoint', () => {
  it('a book collapses, a single deposit renews', () => {
    expect(renewEndpoint(true)).toBe('collapse')
    expect(renewEndpoint(false)).toBe('renew')
  })
})

const bodyBase = {
  isBook: false, newPrincipal: 10_600_000, redepositNum: 0, rate: '6.5',
  newMaturity: '2027-01-01', baseDate: '2026-07-01', iNum: 600_000,
  pickedCand: null as { saving_id: string } | null, markFulfilled: true, fulfillYm: '2026-07', linkedAmt: 0,
  selectedSources: [] as { id: string; name?: string | null }[], mergeRecv: {} as Record<string, string>,
  destBank: '', currentBank: '', selectedHeld: [] as { id: string; name?: string | null }[],
}

describe('buildRenewBody', () => {
  it('single renew: full new principal + realized interest, no combine fields', () => {
    const b = buildRenewBody({ mode: 'principal_interest', ...bodyBase })
    expect(b.amount_vnd).toBe(10_600_000)
    expect(b.interest_rate).toBe(6.5)
    expect(b.expiry_date).toBe('2027-01-01')
    expect(b.investment_date).toBe('2026-07-01')
    expect(b.interest_earned_vnd).toBe(600_000)
    expect(b.merge_sources).toBeUndefined()
    expect(b.held_sources).toBeUndefined()
    expect(b.bank_code).toBeUndefined()
    expect(b.fulfill_recurring).toBeUndefined()
  })

  it('book collapse omits interest_earned_vnd (derived per tranche server-side)', () => {
    const b = buildRenewBody({ mode: 'principal_interest', ...bodyBase, isBook: true })
    expect('interest_earned_vnd' in b).toBe(false)
  })

  it('combine sends the BASE re-deposit and folds in merge + held sources + bank + fulfillment', () => {
    const b = buildRenewBody({
      mode: 'combine', ...bodyBase, newPrincipal: 16_000_000, redepositNum: 12_000_000,
      pickedCand: { saving_id: 'sav1' }, markFulfilled: true, linkedAmt: 1_000_000,
      selectedSources: [{ id: 'tx2', name: 'B' }], mergeRecv: { tx2: '3000000' }, destBank: 'VCB',
      selectedHeld: [{ id: 'h1', name: 'H' }],
    })
    expect(b.amount_vnd).toBe(12_000_000)                                    // BASE, not 16M
    expect(b.merge_sources).toEqual([{ tx_id: 'tx2', received: 3_000_000 }])
    expect(b.bank_code).toBe('VCB')
    expect(b.held_sources).toEqual(['h1'])
    expect(b.fulfill_recurring).toEqual({ saving_id: 'sav1', ym: '2026-07', amount: 1_000_000 })
  })

  it('combine with no merge sources leaves merge_sources undefined but still moves the bank', () => {
    // Settling one deposit, folding this month's recurring in, and re-depositing
    // at ANOTHER bank has no sibling to merge — the destination bank used to be
    // dropped here, which left the user no way to change bank at all (#640).
    const b = buildRenewBody({ mode: 'combine', ...bodyBase, redepositNum: 12_000_000, currentBank: 'PVCB', destBank: 'VCB' })
    expect(b.amount_vnd).toBe(12_000_000)
    expect(b.merge_sources).toBeUndefined()
    expect(b.bank_code).toBe('VCB')
  })

  it('a plain renewal can move the deposit to another bank', () => {
    const b = buildRenewBody({ mode: 'principal_interest', ...bodyBase, currentBank: 'PVCB', destBank: 'MB' })
    expect(b.bank_code).toBe('MB')
    expect(b.merge_sources).toBeUndefined()
  })

  // A book re-deposits at maturity exactly as a lone deposit does, and had no way
  // to change bank purely because collapse_accumulating_book took no bank_code.
  // It does now, so the book path sends it on the same terms as every other.
  it('a book collapse can move to another bank too', () => {
    const b = buildRenewBody({ mode: 'principal_interest', ...bodyBase, isBook: true, currentBank: 'PVCB', destBank: 'MB' })
    expect(b.bank_code).toBe('MB')
    // Still no client-side interest: the collapse route derives it per tranche.
    expect(b.interest_earned_vnd).toBeUndefined()
  })

  it('omits bank_code when the bank is unchanged, or unset, or the deposit is being withdrawn', () => {
    // Unchanged: nothing to move, so the request stays a plain renewal.
    expect(buildRenewBody({ mode: 'principal_interest', ...bodyBase, currentBank: 'PVCB', destBank: 'PVCB' }).bank_code).toBeUndefined()
    // "Không đặt" can't clear a bank (the RPC reads null as "leave as is").
    expect(buildRenewBody({ mode: 'principal_interest', ...bodyBase, currentBank: 'PVCB', destBank: '' }).bank_code).toBeUndefined()
    expect(buildRenewBody({ mode: 'principal_interest', ...bodyBase, isBook: true, currentBank: 'PVCB', destBank: 'PVCB' }).bank_code).toBeUndefined()
    // Withdrawing opens no new cycle to place at a bank.
    expect(buildRenewBody({ mode: 'withdraw', ...bodyBase, currentBank: 'PVCB', destBank: 'MB' }).bank_code).toBeUndefined()
  })

  it('combine without a recurring pick or unchecked fulfillment omits fulfill_recurring', () => {
    expect(buildRenewBody({ mode: 'combine', ...bodyBase, pickedCand: { saving_id: 's' }, markFulfilled: false }).fulfill_recurring).toBeUndefined()
    expect(buildRenewBody({ mode: 'combine', ...bodyBase, pickedCand: null }).fulfill_recurring).toBeUndefined()
  })
})
