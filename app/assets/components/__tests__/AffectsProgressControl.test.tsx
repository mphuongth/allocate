import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AffectsProgressControl } from '../goalDetailShared'

// The OFF copy used to read "for rebalancing or moving money within the goal",
// which advertises a within-goal transfer the flow never performs: proceeds
// route to Unallocated, and re-buying into the same goal double-counts the bar
// (issue #342). The honest framing keeps it to what the toggle actually does —
// hold the bar steady for a withdrawal that doesn't reduce your commitment —
// without implying a transfer.
describe('AffectsProgressControl — OFF copy does not promise a within-goal transfer', () => {
  function renderOff(isVi: boolean) {
    render(
      <AffectsProgressControl
        checked={false}
        onChange={() => {}}
        isVi={isVi}
        currentValue={20_000_000}
        targetAmount={50_000_000}
        withdrawnValue={4_000_000}
      />,
    )
    return screen.getByTestId('affects-progress-control').textContent ?? ''
  }

  it('drops the misleading "moving money / rebalancing" framing (en)', () => {
    const text = renderOff(false)
    expect(text).not.toMatch(/moving money/i)
    expect(text).not.toMatch(/rebalanc/i)
    expect(text).not.toMatch(/within the goal/i)
    // States the real semantics instead: it's about commitment, not a transfer.
    expect(text).toMatch(/commitment/i)
  })

  it('drops the misleading "luân chuyển / cân đối" framing (vi)', () => {
    const text = renderOff(true)
    expect(text).not.toMatch(/luân chuyển/i)
    expect(text).not.toMatch(/cân đối/i)
    expect(text).toMatch(/cam kết/i)
  })
})
