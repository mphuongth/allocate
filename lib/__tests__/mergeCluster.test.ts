import { describe, it, expect } from 'vitest'
import { detectMergeClusters, type MergeClusterInput } from '../mergeCluster'

// Deterministic dates (no Date.now): the rules read whole-day gaps, so fixed
// ISO strings keep these tests stable across the calendar.
const mk = (over: Partial<MergeClusterInput>): MergeClusterInput => ({
  id: 'tx',
  goalId: 'g1',
  type: 'bank',
  expiryDate: '2026-07-01',
  principal: 10_000_000,
  value: 10_500_000,
  depositGroupId: null,
  currency: 'VND',
  isPledged: false,
  ...over,
})

describe('detectMergeClusters', () => {
  it('groups two same-goal in-window deposits, anchoring on the latest maturity', () => {
    const a = mk({ id: 'a', expiryDate: '2026-07-01' })
    const b = mk({ id: 'b', expiryDate: '2026-07-05' }) // 4 days later → latest
    const clusters = detectMergeClusters([a, b], 7)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ goalId: 'g1', anchorId: 'b', size: 2 })
    expect(clusters[0].siblingIds).toEqual(['a'])
  })

  it('excludes an out-of-window sibling (no cluster when the only other is too far)', () => {
    const a = mk({ id: 'a', expiryDate: '2026-07-01' })
    const far = mk({ id: 'far', expiryDate: '2026-09-01' }) // ~62 days → out of window
    expect(detectMergeClusters([a, far], 7)).toHaveLength(0)
  })

  it('needs at least two deposits — a lone maturing deposit is not a cluster', () => {
    expect(detectMergeClusters([mk({ id: 'solo' })], 7)).toHaveLength(0)
  })

  it('does not cluster deposits across different goals', () => {
    const a = mk({ id: 'a', goalId: 'g1', expiryDate: '2026-07-01' })
    const b = mk({ id: 'b', goalId: 'g2', expiryDate: '2026-07-02' })
    expect(detectMergeClusters([a, b], 7)).toHaveLength(0)
  })

  it('ignores books, non-bank, and zero-balance rows', () => {
    const anchor = mk({ id: 'anchor', expiryDate: '2026-07-03' })
    const book = mk({ id: 'book', expiryDate: '2026-07-01', depositGroupId: 'grp-1' })
    const gold = mk({ id: 'gold', type: 'gold', expiryDate: '2026-07-02' })
    const empty = mk({ id: 'empty', expiryDate: '2026-07-02', principal: 0, value: 0 })
    expect(detectMergeClusters([anchor, book, gold, empty], 7)).toHaveLength(0)
  })

  it('skips deposits with no goal (a cluster is goal-scoped)', () => {
    const a = mk({ id: 'a', goalId: null, expiryDate: '2026-07-01' })
    const b = mk({ id: 'b', goalId: null, expiryDate: '2026-07-02' })
    expect(detectMergeClusters([a, b], 7)).toHaveLength(0)
  })

  it('excludes a hard-blocked (different-currency) sibling from the cluster', () => {
    const a = mk({ id: 'a', expiryDate: '2026-07-01', currency: 'VND' })
    const usd = mk({ id: 'usd', expiryDate: '2026-07-02', currency: 'USD' })
    expect(detectMergeClusters([a, usd], 7)).toHaveLength(0)
  })

  it('excludes a pledged sibling from the cluster', () => {
    const a = mk({ id: 'a', expiryDate: '2026-07-01' })
    const pledged = mk({ id: 'pledged', expiryDate: '2026-07-02', isPledged: true })
    expect(detectMergeClusters([a, pledged], 7)).toHaveLength(0)
  })

  it('widens with the window param — a far sibling clusters once the window grows', () => {
    const a = mk({ id: 'a', expiryDate: '2026-07-01' })
    const b = mk({ id: 'b', expiryDate: '2026-07-20' }) // 19 days
    expect(detectMergeClusters([a, b], 7)).toHaveLength(0)
    const wide = detectMergeClusters([a, b], 30)
    expect(wide).toHaveLength(1)
    expect(wide[0]).toMatchObject({ anchorId: 'b', size: 2 })
    expect(wide[0].siblingIds).toEqual(['a'])
  })

  it('clusters three in-window same-goal deposits (anchor + two siblings)', () => {
    const a = mk({ id: 'a', expiryDate: '2026-07-01' })
    const b = mk({ id: 'b', expiryDate: '2026-07-03' })
    const c = mk({ id: 'c', expiryDate: '2026-07-05' }) // latest → anchor
    const clusters = detectMergeClusters([a, b, c], 7)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].anchorId).toBe('c')
    expect(clusters[0].size).toBe(3)
    expect([...clusters[0].siblingIds].sort()).toEqual(['a', 'b'])
  })

  it('emits a separate cluster per goal', () => {
    const a1 = mk({ id: 'a1', goalId: 'g1', expiryDate: '2026-07-01' })
    const a2 = mk({ id: 'a2', goalId: 'g1', expiryDate: '2026-07-03' })
    const b1 = mk({ id: 'b1', goalId: 'g2', expiryDate: '2026-08-01' })
    const b2 = mk({ id: 'b2', goalId: 'g2', expiryDate: '2026-08-02' })
    const clusters = detectMergeClusters([a1, a2, b1, b2], 7)
    expect(clusters).toHaveLength(2)
    expect(clusters.map((c) => c.goalId).sort()).toEqual(['g1', 'g2'])
  })
})
