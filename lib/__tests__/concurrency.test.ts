import { describe, it, expect } from 'vitest'
import { mapWithConcurrency, Semaphore } from '../concurrency'

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const out = await mapWithConcurrency([10, 1, 5], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms))
      return i * 100 + ms
    })
    expect(out).toEqual([10, 101, 205])
  })

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1) // actually ran things in parallel
  })

  it('processes every item exactly once', async () => {
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => { seen.push(n) })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('handles an empty list without spawning workers', async () => {
    const out = await mapWithConcurrency([], 4, async () => 1)
    expect(out).toEqual([])
  })

  it('clamps a limit larger than the item count', async () => {
    let peak = 0
    let inFlight = 0
    await mapWithConcurrency([1, 2], 99, async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5)); inFlight--
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('rejects if the mapper rejects', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })
})

describe('Semaphore', () => {
  it('never runs more than `permits` operations at once, even across nested fan-out', async () => {
    const sem = new Semaphore(2)
    let inFlight = 0
    let peak = 0
    // 10 tasks contend for 2 permits (mimics Dragon's 15-way fan-out under a cap)
    await Promise.all(
      Array.from({ length: 10 }, () =>
        sem.run(async () => {
          inFlight++
          peak = Math.max(peak, inFlight)
          await new Promise((r) => setTimeout(r, 5))
          inFlight--
        }),
      ),
    )
    expect(peak).toBe(2)
    expect(inFlight).toBe(0)
  })

  it('releases the permit even when the wrapped op throws', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    // If the permit leaked, this second run would hang forever.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok')
  })
})
