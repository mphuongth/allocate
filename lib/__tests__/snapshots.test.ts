import { describe, it, expect, vi, afterEach } from 'vitest'
import { shouldWriteSnapshot, persistSnapshot, SNAPSHOT_WRITE_TIMEOUT_MS } from '../snapshots'

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

describe('persistSnapshot (#592)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves ok when the write succeeds', async () => {
    await expect(persistSnapshot(async () => ({ error: null }))).resolves.toEqual({ ok: true })
  })

  it('reports a Supabase error without throwing', async () => {
    const result = await persistSnapshot(async () => ({ error: { message: 'permission denied' } }))
    expect(result).toEqual({ ok: false, reason: 'permission denied' })
  })

  it('reports a rejected write without throwing', async () => {
    const result = await persistSnapshot(async () => { throw new Error('connection reset') })
    expect(result).toEqual({ ok: false, reason: 'connection reset' })
  })

  it('reports a thrown non-Error without throwing', async () => {
    const result = await persistSnapshot(async () => { throw 'boom' })
    expect(result).toEqual({ ok: false, reason: 'boom' })
  })

  it('gives up after the timeout instead of holding the response open', async () => {
    vi.useFakeTimers()
    const pending = persistSnapshot(() => new Promise(() => { /* never settles */ }))
    await vi.advanceTimersByTimeAsync(SNAPSHOT_WRITE_TIMEOUT_MS + 1)
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  it('honours a caller-supplied timeout', async () => {
    vi.useFakeTimers()
    const pending = persistSnapshot(() => new Promise(() => {}), { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(51)
    await expect(pending).resolves.toEqual({ ok: false, reason: 'timeout' })
  })

  it('clears the timeout timer once the write settles', async () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    await persistSnapshot(async () => ({ error: null }))
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
