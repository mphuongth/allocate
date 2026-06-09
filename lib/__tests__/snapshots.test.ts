import { describe, it, expect } from 'vitest'
import { shouldWriteSnapshot } from '../snapshots'

describe('shouldWriteSnapshot', () => {
  it('writes when there is no existing snapshot for today', () => {
    expect(shouldWriteSnapshot(null, 1_000_000)).toBe(true)
    expect(shouldWriteSnapshot(undefined, 1_000_000)).toBe(true)
  })

  it('skips the write when the rounded total is unchanged', () => {
    expect(shouldWriteSnapshot({ total_assets: 1_000_000 }, 1_000_000)).toBe(false)
  })

  it('skips the write when the value only differs by a sub-integer fraction', () => {
    // total_assets is stored as a rounded BIGINT, so 1_000_000.4 rounds to the
    // same stored value and must not trigger a redundant row rewrite.
    expect(shouldWriteSnapshot({ total_assets: 1_000_000 }, 1_000_000.4)).toBe(false)
  })

  it('writes when the rounded total changed', () => {
    expect(shouldWriteSnapshot({ total_assets: 1_000_000 }, 1_000_001)).toBe(true)
    expect(shouldWriteSnapshot({ total_assets: 1_000_000 }, 999_999)).toBe(true)
  })
})
