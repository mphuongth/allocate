import { describe, it, expect } from 'vitest'
import { buildCompositionSegments } from '../goalDetailShared'

// The goal-detail "Cơ cấu / Composition" segments are built from the active
// investment rows. Held-for-merge cash CLOSED its source deposit, so it is absent
// from those rows — yet it still counts toward the goal's headline value via the
// overview synthesis. Without a held segment the bar sums SHORT of the headline.
// buildCompositionSegments adds that segment so the two reconcile.
describe('buildCompositionSegments — held-for-merge reconciliation', () => {
  const rows = [
    { type: 'bank', value: 20_000_000 },
    { type: 'gold', value: 5_000_000 },
  ]

  it('with no held cash, segments are exactly the asset rows', () => {
    const segs = buildCompositionSegments(rows, 0, true)
    expect(segs.map((s) => s.label)).toEqual(['bank', 'gold'])
    expect(segs.reduce((a, s) => a + s.value, 0)).toBe(25_000_000)
  })

  it('adds a neutral held segment so the total reconciles with the headline', () => {
    const segs = buildCompositionSegments(rows, 10_000_000, true)
    const held = segs.find((s) => s.label === 'Chờ gộp')
    expect(held).toBeDefined()
    expect(held!.value).toBe(10_000_000)
    // Held cash is parked, not invested — it must not borrow an asset colour.
    expect(held!.color).toBe('var(--c-muted)')
    // The whole point: bank + gold + held == headline (asset rows + held synthesis).
    expect(segs.reduce((a, s) => a + s.value, 0)).toBe(35_000_000)
  })

  it('localizes the held label (English)', () => {
    const segs = buildCompositionSegments(rows, 1, false)
    expect(segs.some((s) => s.label === 'For merge')).toBe(true)
  })

  it('omits the held segment when there is no held cash', () => {
    const segs = buildCompositionSegments(rows, 0, false)
    expect(segs.some((s) => s.label === 'For merge')).toBe(false)
  })
})
