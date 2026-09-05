import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AffectsProgressControl } from '../goalDetailShared'

// The OFF copy used to read "for rebalancing or moving money within the goal",
// which advertises a within-goal transfer the flow never performs: proceeds
// route to Unallocated, and re-buying into the same goal double-counts the bar
// (issue #342). The honest framing states what actually happens — the money
// still leaves, but it keeps counting toward the goal — without implying a
// transfer between holdings.
describe('AffectsProgressControl — OFF copy does not promise a within-goal transfer', () => {
  function renderOff(isVi: boolean) {
    render(
      <AffectsProgressControl
        checked={false}
        onChange={() => {}}
        isVi={isVi}
        progressValue={20_000_000}
        targetAmount={50_000_000}
        withdrawnValue={4_000_000}
      />,
    )
    return screen.getByTestId('affects-progress-control').textContent ?? ''
  }

  it('drops the misleading "moving money within the goal" framing (en)', () => {
    const text = renderOff(false)
    expect(text).not.toMatch(/moving money/i)
    expect(text).not.toMatch(/within the goal/i)
    // States the real semantics instead: the money leaves but still counts.
    expect(text).toMatch(/still leaves/i)
    expect(text).toMatch(/counting toward/i)
  })

  it('drops the misleading "luân chuyển trong mục tiêu" framing (vi)', () => {
    const text = renderOff(true)
    expect(text).not.toMatch(/luân chuyển/i)
    expect(text).toMatch(/vẫn rời mục tiêu/i)
    expect(text).toMatch(/vẫn được tính vào tiến độ/i)
  })
})
