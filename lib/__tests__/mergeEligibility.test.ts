import { describe, it, expect } from 'vitest'
import { classifyMergeSource, classifyMergeSources, type MergeEligInput } from '../mergeEligibility'

// A YYYY-MM-DD string `n` days from the anchor's maturity, so gaps are explicit.
function plusDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const ANCHOR_MAT = '2026-07-05'
const anchor: MergeEligInput = {
  id: 'D', type: 'bank', expiryDate: ANCHOR_MAT, principal: 50_000_000,
  currency: 'VND', isPledged: false, goalId: 'goal-1',
}

// A liquidatable, same-currency, unpledged, same-goal bank deposit maturing `gap`
// days from the anchor.
function sib(over: Partial<MergeEligInput> & { id: string }): MergeEligInput {
  return {
    type: 'bank', expiryDate: ANCHOR_MAT, principal: 10_000_000,
    currency: 'VND', isPledged: false, goalId: 'goal-1', ...over,
  }
}

describe('classifyMergeSource', () => {
  it('marks a same-goal, in-window, same-currency, unpledged bank deposit eligible', () => {
    const c = classifyMergeSource(anchor, sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, 3) }), 7)
    expect(c.eligible).toBe(true)
    expect(c.reason).toBeNull()
    expect(c.maturityGapDays).toBe(3)
  })

  it('blocks a deposit maturing outside the window — overridable ("Gộp sớm?")', () => {
    const c = classifyMergeSource(anchor, sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, 30) }), 7)
    expect(c.eligible).toBe(false)
    expect(c.reason).toBe('out-of-window')
    expect(c.overridable).toBe(true)
    expect(c.maturityGapDays).toBe(30)
  })

  it('counts the window symmetrically — a deposit maturing earlier is still in-window', () => {
    const c = classifyMergeSource(anchor, sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, -7) }), 7)
    expect(c.eligible).toBe(true)
    expect(c.maturityGapDays).toBe(7) // |−7| = 7, exactly on the boundary (inclusive)
  })

  it('blocks a different currency — a hard block (not overridable)', () => {
    const c = classifyMergeSource(anchor, sib({ id: 's', currency: 'USD', expiryDate: plusDays(ANCHOR_MAT, 1) }), 7)
    expect(c.eligible).toBe(false)
    expect(c.reason).toBe('different-currency')
    expect(c.overridable).toBe(false)
  })

  it('blocks a pledged deposit — a hard block (not overridable)', () => {
    const c = classifyMergeSource(anchor, sib({ id: 's', isPledged: true, expiryDate: plusDays(ANCHOR_MAT, 1) }), 7)
    expect(c.eligible).toBe(false)
    expect(c.reason).toBe('pledged')
    expect(c.overridable).toBe(false)
  })

  // #635: the rule used to read source.isPledged only, so cash could be folded
  // INTO collateral — the money lands inside a frozen balance and cannot be
  // taken out again until the pledge is released, with nothing in the flow
  // saying so. Blocked symmetrically: release the pledge first.
  it('blocks a PLEDGED anchor — the destination is frozen collateral too', () => {
    const c = classifyMergeSource({ ...anchor, isPledged: true }, sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, 1) }), 7)
    expect(c.eligible).toBe(false)
    expect(c.reason).toBe('pledged-anchor')
    expect(c.overridable).toBe(false)
  })

  // Distinct from 'pledged' because the sentence the user reads is different:
  // one is about the deposit they picked to keep, the other about the one they
  // are folding in.
  it('reports the anchor before the source when both are pledged', () => {
    const c = classifyMergeSource({ ...anchor, isPledged: true }, sib({ id: 's', isPledged: true, expiryDate: ANCHOR_MAT }), 7)
    expect(c.reason).toBe('pledged-anchor')
  })

  // A pledged anchor blocks every source, whatever else is wrong with them —
  // there is no merge to have.
  it('blocks even a perfect source when the anchor is pledged', () => {
    const out = classifyMergeSources({ ...anchor, isPledged: true }, [sib({ id: 'a', expiryDate: ANCHOR_MAT })], 7)
    expect(out.map((c) => c.reason)).toEqual(['pledged-anchor'])
  })

  it('blocks a non-liquidatable source (a fund / book / fully-withdrawn deposit)', () => {
    expect(classifyMergeSource(anchor, sib({ id: 'f', type: 'fund' }), 7).reason).toBe('not-liquidatable')
    expect(classifyMergeSource(anchor, sib({ id: 'bk', depositGroupId: 'book-1' }), 7).reason).toBe('not-liquidatable')
    expect(classifyMergeSource(anchor, sib({ id: 'z', principal: 0, value: 0 }), 7).reason).toBe('not-liquidatable')
  })

  it('blocks a different-goal source when both goals are known (hard block)', () => {
    const c = classifyMergeSource(anchor, sib({ id: 's', goalId: 'goal-2', expiryDate: plusDays(ANCHOR_MAT, 1) }), 7)
    expect(c.eligible).toBe(false)
    expect(c.reason).toBe('different-goal')
    expect(c.overridable).toBe(false)
  })

  it('skips the goal check when a goal id is missing on either side (same-goal scoping is the caller\'s job)', () => {
    const c = classifyMergeSource({ ...anchor, goalId: null }, sib({ id: 's', goalId: 'goal-2', expiryDate: plusDays(ANCHOR_MAT, 1) }), 7)
    expect(c.eligible).toBe(true)
  })

  it('treats an absent currency as VND (legacy deposits) so it does not falsely block', () => {
    const c = classifyMergeSource(
      { ...anchor, currency: null },
      sib({ id: 's', currency: undefined, expiryDate: plusDays(ANCHOR_MAT, 1) }),
      7,
    )
    expect(c.eligible).toBe(true)
  })

  it('defaults the window to 7 days', () => {
    expect(classifyMergeSource(anchor, sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, 7) })).eligible).toBe(true)
    expect(classifyMergeSource(anchor, sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, 8) })).eligible).toBe(false)
  })

  it('widening the window reclassifies an out-of-window source as eligible', () => {
    const s = sib({ id: 's', expiryDate: plusDays(ANCHOR_MAT, 14) })
    expect(classifyMergeSource(anchor, s, 7).eligible).toBe(false)
    expect(classifyMergeSource(anchor, s, 14).eligible).toBe(true)
  })

  it('out-of-window takes precedence only after the hard blocks (currency before window)', () => {
    // Both out-of-window AND different currency → the hard currency block wins, so
    // the UI never offers a "Gộp sớm?" override for a deposit it can never merge.
    const c = classifyMergeSource(anchor, sib({ id: 's', currency: 'USD', expiryDate: plusDays(ANCHOR_MAT, 30) }), 7)
    expect(c.reason).toBe('different-currency')
    expect(c.overridable).toBe(false)
  })
})

describe('classifyMergeSources', () => {
  it('classifies each sibling and preserves order', () => {
    const out = classifyMergeSources(anchor, [
      sib({ id: 'a', expiryDate: plusDays(ANCHOR_MAT, 2) }),
      sib({ id: 'b', expiryDate: plusDays(ANCHOR_MAT, 40) }),
      sib({ id: 'c', isPledged: true }),
    ], 7)
    expect(out.map((c) => c.source.id)).toEqual(['a', 'b', 'c'])
    expect(out.map((c) => c.eligible)).toEqual([true, false, false])
    expect(out.map((c) => c.reason)).toEqual([null, 'out-of-window', 'pledged'])
  })
})
