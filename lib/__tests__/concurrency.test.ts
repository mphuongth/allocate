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

  // Waiting for a permit is part of an operation's elapsed time. Without an
  // abortable wait, a caller's "absolute" deadline only starts once it reaches
  // the front of the queue, so the real bound is queue time + deadline (#530).
  describe('abortable acquisition', () => {
    it('rejects a queued caller when its signal aborts, and never runs its op', async () => {
      const sem = new Semaphore(1)
      let ran = false
      let releaseFirst: () => void = () => {}
      const first = sem.run(() => new Promise<void>((r) => { releaseFirst = () => r() }))

      const controller = new AbortController()
      const queued = sem.run(async () => { ran = true }, controller.signal)
      controller.abort(new Error('deadline exceeded'))

      await expect(queued).rejects.toThrow('deadline exceeded')
      expect(ran).toBe(false)

      releaseFirst()
      await first
    })

    it('does not run the op at all when the signal is already aborted', async () => {
      const sem = new Semaphore(1)
      let ran = false
      await expect(
        sem.run(async () => { ran = true }, AbortSignal.abort(new Error('too late'))),
      ).rejects.toThrow('too late')
      expect(ran).toBe(false)
    })

    it('leaves the queue usable for everyone else after an abort', async () => {
      const sem = new Semaphore(1)
      let releaseFirst: () => void = () => {}
      const first = sem.run(() => new Promise<void>((r) => { releaseFirst = () => r() }))

      const controller = new AbortController()
      const abandoned = sem.run(async () => 'never', controller.signal)
      const waiting = sem.run(async () => 'ran')

      controller.abort(new Error('gone'))
      await expect(abandoned).rejects.toThrow('gone')

      releaseFirst()
      await first
      // The abandoned waiter must not have consumed the permit it never got.
      await expect(waiting).resolves.toBe('ran')
    })

    it('is unaffected by a signal that never aborts', async () => {
      const sem = new Semaphore(1)
      const controller = new AbortController()
      await expect(sem.run(async () => 'ok', controller.signal)).resolves.toBe('ok')
      await expect(sem.run(async () => 'ok again')).resolves.toBe('ok again')
    })
  })
})
