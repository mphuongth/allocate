import { describe, it, expect } from 'vitest'
import type { InvRow } from '../../contracts'
import { holdAnchorsFor, mergeProvenance, defaultReceivedFor } from '../mergeSelection'

// The merge half of the maturity-resolve flow (#602). These three ran inline
// inside MaturityResolveBody, below its 25 useState calls — so the rules that
// decide whether "settle with hold" is offered at all, and what the new
// deposit's provenance line claims, could only be exercised by rendering the
// whole sheet.

const row = (over: Partial<InvRow> = {}): InvRow => ({
  id: 'd', name: 'Sổ', type: 'bank', value: 1_050_000, gainPct: null, units: null,
  principal: 1_000_000, interestRate: 6, expiryDate: '2026-08-10',
  investmentDate: '2025-08-10', fund: null, depositGroupId: null,
  bankCode: 'VCB', currency: 'VND', isPledged: false, ...over,
})

describe('holdAnchorsFor', () => {
  const anchor = row({ id: 'later', expiryDate: '2026-08-14' })
  const inv = row({ id: 'me', expiryDate: '2026-08-10' })

  it('offers a later-maturing sibling in the same window as an anchor', () => {
    expect(holdAnchorsFor(inv, [inv, anchor], 'g1', false, 7).map((a) => a.id)).toEqual(['later'])
  })

  it('never offers an EARLIER-maturing sibling', () => {
    // Holding cash until an anchor that already matured is meaningless.
    const earlier = row({ id: 'earlier', expiryDate: '2026-08-01' })
    expect(holdAnchorsFor(inv, [inv, earlier], 'g1', false, 7)).toEqual([])
  })

  it('picks the NEAREST later maturity first', () => {
    const far = row({ id: 'far', expiryDate: '2026-08-16' })
    const near = row({ id: 'near', expiryDate: '2026-08-12' })
    expect(holdAnchorsFor(inv, [inv, far, near], 'g1', false, 7).map((a) => a.id)).toEqual(['near', 'far'])
  })

  it('offers nothing for an unassigned deposit or a book', () => {
    // Hold pools cash inside a goal, and a book settles as a whole — neither
    // has a hold fork, so the sheet falls back to a plain withdraw.
    expect(holdAnchorsFor(inv, [inv, anchor], null, false, 7)).toEqual([])
    expect(holdAnchorsFor(row({ id: 'me', depositGroupId: 'me' }), [inv, anchor], 'g1', true, 7)).toEqual([])
  })

  it('skips siblings that are not plain positive bank deposits', () => {
    expect(holdAnchorsFor(inv, [inv, row({ id: 'gold', type: 'gold', expiryDate: '2026-08-14' })], 'g1', false, 7)).toEqual([])
    expect(holdAnchorsFor(inv, [inv, row({ id: 'book', depositGroupId: 'book', expiryDate: '2026-08-14' })], 'g1', false, 7)).toEqual([])
    expect(holdAnchorsFor(inv, [inv, row({ id: 'zero', principal: 0, value: 0, expiryDate: '2026-08-14' })], 'g1', false, 7)).toEqual([])
  })

  it('rejects a foreign-currency anchor', () => {
    expect(holdAnchorsFor(inv, [inv, row({ id: 'usd', expiryDate: '2026-08-14', currency: 'USD' })], 'g1', false, 7)).toEqual([])
  })

  it('accepts a PLEDGED anchor — the pledged rule only guards the source side', () => {
    // Documenting today's behavior, not endorsing it. classifyMergeSources
    // blocks a pledged *source* (it can't be liquidated); it says nothing about
    // a pledged destination, and holdAnchorsFor calls it with the roles
    // reversed. Whether topping up collateral should be allowed is a domain
    // question, deliberately not settled inside this refactor.
    const pledgedAnchor = row({ id: 'pledged', expiryDate: '2026-08-14', isPledged: true })
    expect(holdAnchorsFor(inv, [inv, pledgedAnchor], 'g1', false, 7).map((a) => a.id)).toEqual(['pledged'])
  })

  it('respects the window — a far-off anchor is out until the window widens', () => {
    const far = row({ id: 'far', expiryDate: '2026-09-30' })
    expect(holdAnchorsFor(inv, [inv, far], 'g1', false, 7)).toEqual([])
    expect(holdAnchorsFor(inv, [inv, far], 'g1', false, 90).map((a) => a.id)).toEqual(['far'])
  })

  it('tolerates a caller that wires no siblings', () => {
    expect(holdAnchorsFor(inv, undefined, 'g1', false, 7)).toEqual([])
  })
})

describe('mergeProvenance', () => {
  it('counts the anchor plus every folded source', () => {
    const p = mergeProvenance(row({ bankCode: 'VCB' }), [row({ id: 's1', bankCode: 'TCB' })])
    expect(p.sourceCount).toBe(2)
    expect(p.bankCount).toBe(2)
    expect(p.isMultiSource).toBe(false)
  })

  it('counts distinct banks, not sources', () => {
    const p = mergeProvenance(row({ bankCode: 'VCB' }), [
      row({ id: 's1', bankCode: 'VCB' }),
      row({ id: 's2', bankCode: 'TCB' }),
    ])
    expect(p.sourceCount).toBe(3)
    expect(p.bankCount).toBe(2)
    expect(p.isMultiSource).toBe(true)
  })

  it('excludes a legacy deposit with no bank set from the bank count', () => {
    // A null bank_code must not inflate "M ngân hàng" into claiming a bank
    // the user never recorded.
    const p = mergeProvenance(row({ bankCode: null }), [row({ id: 's1', bankCode: null })])
    expect(p.sourceCount).toBe(2)
    expect(p.bankCount).toBe(0)
  })

  it('is just the anchor when nothing is folded in', () => {
    expect(mergeProvenance(row(), [])).toEqual({ sourceCount: 1, bankCount: 1, isMultiSource: false })
  })
})

describe('defaultReceivedFor', () => {
  it('prefills a source at its current value — the user edits it down if settling early is penalised', () => {
    expect(defaultReceivedFor(row({ value: 1_050_400, principal: 1_000_000 }))).toBe(1_050_400)
  })

  it('falls back to the principal, then to zero', () => {
    expect(defaultReceivedFor(row({ value: null as unknown as number, principal: 900_000 }))).toBe(900_000)
    expect(defaultReceivedFor(row({ value: null as unknown as number, principal: null }))).toBe(0)
  })
})
