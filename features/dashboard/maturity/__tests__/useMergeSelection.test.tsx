import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { InvRow } from '../../contracts'
import { useMergeSelection } from '../useMergeSelection'

// The merge picker's selection state (#602), lifted out of MaturityResolveBody
// where it was four useState maps and five closures over them.

const row = (id: string, over: Partial<InvRow> = {}): InvRow => ({
  id, name: id, type: 'bank', value: 1_000_000, gainPct: null, units: null,
  principal: 1_000_000, interestRate: 6, expiryDate: '2026-08-10',
  investmentDate: '2025-08-10', fund: null, depositGroupId: null,
  bankCode: 'VCB', currency: 'VND', isPledged: false, ...over,
})

/** Eligibility, as the sheet computes it before handing it to the hook. */
const eligibility = (eligible: Record<string, boolean>) => (id: string) => !!eligible[id]

function setup(sources: InvRow[], eligible: Record<string, boolean> = {}, windowDays = 7) {
  return renderHook(
    ({ w }: { w: number }) => useMergeSelection(sources, eligibility(eligible), w),
    { initialProps: { w: windowDays } },
  )
}

describe('useMergeSelection', () => {
  it('starts with the eligible sources selected, and prefills their received cash', () => {
    // A preselected sibling that never got a received value would submit 0₫.
    const { result } = setup([row('a', { value: 1_050_000 }), row('b')], { a: true })
    expect(result.current.selectedSources.map((s) => s.id)).toEqual(['a'])
    expect(result.current.mergeRecv.a).toBe('1050000')
    expect(result.current.mergeReceivedTotal).toBe(1_050_000)
  })

  it('toggles a source off and back on', () => {
    const { result } = setup([row('a')], { a: true })
    act(() => result.current.toggleSource(row('a')))
    expect(result.current.selectedSources).toEqual([])
    act(() => result.current.toggleSource(row('a')))
    expect(result.current.selectedSources.map((s) => s.id)).toEqual(['a'])
  })

  it('folds an out-of-window source in early, and dropping it returns it to the dimmed row', () => {
    const { result } = setup([row('a')], {}) // not eligible
    expect(result.current.selectedSources).toEqual([])

    act(() => result.current.overrideSource(row('a')))
    expect(result.current.selectedSources.map((s) => s.id)).toEqual(['a'])
    expect(result.current.isOverridden('a')).toBe(true)

    act(() => result.current.toggleSource(row('a')))
    expect(result.current.selectedSources).toEqual([])
    expect(result.current.isOverridden('a')).toBe(false)
  })

  it('does not overwrite a received value the user already edited', () => {
    const { result } = setup([row('a')], { a: true })
    act(() => result.current.setReceived('a', '999'))
    act(() => result.current.toggleSource(row('a')))
    act(() => result.current.toggleSource(row('a')))
    expect(result.current.mergeRecv.a).toBe('999')
  })

  it('splits an edited TOTAL across the selected sources so the parts sum exactly', () => {
    // The allocation must match the SQL's, or the client preview and the
    // server's Σ(received) disagree by a rounding unit.
    const { result } = setup([row('a', { principal: 1_000_000 }), row('b', { principal: 2_000_000 })], { a: true, b: true })
    act(() => result.current.onMergeTotalChange('3000001'))
    const parts = ['a', 'b'].map((id) => Number(result.current.mergeRecv[id]))
    expect(parts.reduce((x, y) => x + y, 0)).toBe(3_000_001)
    expect(result.current.mergeReceivedTotal).toBe(3_000_001)
  })

  it('allocates the total only across SELECTED sources', () => {
    const { result } = setup([row('a'), row('b')], { a: true })
    act(() => result.current.onMergeTotalChange('500000'))
    expect(Number(result.current.mergeRecv.a)).toBe(500_000)
    expect(result.current.mergeRecv.b).toBeUndefined()
  })

  it('prefills a source that becomes eligible when the window widens', () => {
    const sources = [row('a'), row('b')]
    const { result, rerender } = renderHook(
      ({ w }: { w: number }) => useMergeSelection(sources, (id) => (w >= 30 ? true : id === 'a'), w),
      { initialProps: { w: 7 } },
    )
    expect(result.current.mergeRecv.b).toBeUndefined()

    rerender({ w: 30 })
    expect(result.current.selectedSources.map((s) => s.id)).toEqual(['a', 'b'])
    expect(result.current.mergeRecv.b).toBe('1000000')
  })
})

describe('useMergeSelection — total vs. parts', () => {
  it('clears the typed TOTAL once the user edits one part by hand', () => {
    // The total no longer describes the split, so leaving it on screen would
    // claim a figure that is no longer what gets submitted.
    const { result } = setup([row('a'), row('b')], { a: true, b: true })
    act(() => result.current.onMergeTotalChange('3000000'))
    expect(result.current.mergeTotal).toBe('3000000')

    act(() => result.current.setReceived('a', '1'))
    expect(result.current.mergeTotal).toBe('')
    expect(result.current.mergeRecv.a).toBe('1')
  })
})
